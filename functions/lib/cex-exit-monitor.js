'use strict'
// cex-exit-monitor.js — closes open `cexTrades` docs with realized PnL so the
// executed-trade record is complete (signals track the CALL, this tracks the
// TRADE). Runs on a schedule from index.js (processCexExits).
//
// Resolution ladder per trade — exchange truth first, estimate as fallback:
//   1. Binance futures  → position flat? real PnL from /fapi/v1/userTrades fills
//   2. Bybit  futures   → position flat? real PnL from /v5/position/closed-pnl
//   3. Binance spot OCO → which bracket leg FILLED → real exit price
//   4. Everything else (spot non-bracket, MEXC futures, API hiccups) → candle
//      walk against TP1/SL from open time (same rules as the signal tracker),
//      flagged pnlEstimated: true
//   5. Nothing hit after MAX_OPEN_MS → close as 'timeout' at last close price
//
// Closed doc shape (merged onto the trade):
//   { status: 'closed', closedAt, exitPrice, exitReason: 'tp1'|'sl'|'manual'|'timeout',
//     pnl (USDT), pnlPct (% of tradeUSDT margin), pnlEstimated: bool }
const axios = require('axios')
const crypto = require('crypto')

const API_TIMEOUT = 10000
const MAX_OPEN_MS = 30 * 24 * 3600000 // close as 'timeout' after 30 days
const hmacHex = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('hex')

// ── Binance futures (fapi/fapi1/fapi2 rotation, matching cex-trader) ─────────
const FAPI_BASES = ['https://fapi.binance.com', 'https://fapi1.binance.com', 'https://fapi2.binance.com']
async function fapiGet(path, qs, apiKey) {
  let last = null
  for (const base of FAPI_BASES) {
    try { return await axios.get(`${base}${path}?${qs}`, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: API_TIMEOUT }) }
    catch (e) { last = e; if (e?.response?.status === 451) continue; throw e }
  }
  throw last || new Error('binance futures unreachable')
}

async function binanceFuturesPositionAmt(apiKey, secret, symbol) {
  const qs  = `symbol=${symbol}&timestamp=${Date.now()}&recvWindow=5000`
  const r   = await fapiGet('/fapi/v2/positionRisk', `${qs}&signature=${hmacHex(secret, qs)}`, apiKey)
  const pos = (r.data || []).find((p) => p.symbol === symbol)
  return Math.abs(parseFloat(pos?.positionAmt || 0))
}

// Realized PnL for the closing fills since `sinceMs`. Binance futures userTrades
// only reaches back ~7 days with a time filter — returns null when nothing is
// found so the caller can fall back to an estimate.
async function binanceFuturesRealized(apiKey, secret, symbol, sinceMs) {
  const start = Math.max(sinceMs, Date.now() - 6.5 * 24 * 3600000)
  const qs = `symbol=${symbol}&startTime=${Math.floor(start)}&limit=1000&timestamp=${Date.now()}&recvWindow=5000`
  const r  = await fapiGet('/fapi/v1/userTrades', `${qs}&signature=${hmacHex(secret, qs)}`, apiKey)
  const fills = Array.isArray(r.data) ? r.data : []
  if (!fills.length) return null
  let pnl = 0, fee = 0, exitQty = 0, exitQuote = 0
  for (const f of fills) {
    const rp = parseFloat(f.realizedPnl || 0)
    pnl += rp
    if ((f.commissionAsset || 'USDT') === 'USDT') fee += parseFloat(f.commission || 0)
    if (rp !== 0) { exitQty += parseFloat(f.qty || 0); exitQuote += parseFloat(f.quoteQty || 0) }
  }
  if (exitQty <= 0) return null // no closing fills recorded in the window
  return { pnl: pnl - fee, exitPrice: exitQuote / exitQty }
}

// ── Bybit linear ──────────────────────────────────────────────────────────────
async function bybitGet(apiKey, secret, path, qs) {
  const ts = Date.now().toString(), rw = '5000'
  const sig = hmacHex(secret, ts + apiKey + rw + qs)
  const r = await axios.get(`https://api.bybit.com${path}?${qs}`, {
    headers: { 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': rw },
    timeout: API_TIMEOUT,
  })
  if (r.data?.retCode !== 0) throw new Error(r.data?.retMsg || 'bybit error')
  return r.data.result
}

async function bybitPositionSize(apiKey, secret, symbol) {
  const res = await bybitGet(apiKey, secret, '/v5/position/list', `category=linear&symbol=${symbol}`)
  const pos = (res?.list || []).find((p) => p.symbol === symbol)
  return Math.abs(parseFloat(pos?.size || 0))
}

async function bybitClosedPnl(apiKey, secret, symbol, sinceMs) {
  const res = await bybitGet(apiKey, secret, '/v5/position/closed-pnl', `category=linear&symbol=${symbol}&startTime=${Math.floor(sinceMs)}&limit=50`)
  const recs = (res?.list || []).filter((x) => +x.updatedTime > sinceMs)
  if (!recs.length) return null
  let pnl = 0, exitQty = 0, exitQuote = 0
  for (const x of recs) {
    pnl += parseFloat(x.closedPnl || 0)
    const q = parseFloat(x.closedSize || x.qty || 0), px = parseFloat(x.avgExitPrice || 0)
    if (q > 0 && px > 0) { exitQty += q; exitQuote += q * px }
  }
  return { pnl, exitPrice: exitQty > 0 ? exitQuote / exitQty : null }
}

// ── MEXC contract ─────────────────────────────────────────────────────────────
async function mexcOpenPosition(apiKey, secret, symbol) {
  const fxSym = symbol.endsWith('USDT') ? symbol.slice(0, -4) + '_USDT' : symbol
  const ts = String(Date.now())
  const qs = `symbol=${fxSym}`
  const sig = hmacHex(secret, apiKey + ts + qs)
  const r = await axios.get(`https://contract.mexc.com/api/v1/private/position/open_positions?${qs}`, {
    headers: { ApiKey: apiKey, 'Request-Time': ts, Signature: sig, 'Content-Type': 'application/json' },
    timeout: API_TIMEOUT,
  })
  if (r.data?.code !== 0) throw new Error(r.data?.message || 'mexc position error')
  return (r.data?.data || []).reduce((s, p) => s + Math.abs(parseFloat(p.holdVol || 0)), 0)
}

// ── Binance spot OCO status ───────────────────────────────────────────────────
const SPOT_BASES = ['https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com', 'https://api3.binance.com', 'https://api4.binance.com']
async function spotGet(path, qs, apiKey) {
  let last = null
  for (const base of SPOT_BASES) {
    try { return await axios.get(`${base}${path}?${qs}`, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: API_TIMEOUT }) }
    catch (e) { last = e; if (e?.response?.status === 451) continue; throw e }
  }
  throw last || new Error('binance unreachable')
}

// Returns { done: bool, exitPrice, exitReason } or null while the OCO is live.
async function binanceOcoOutcome(apiKey, secret, symbol, orderListId) {
  const qs1 = `orderListId=${orderListId}&timestamp=${Date.now()}&recvWindow=5000`
  const list = (await spotGet('/api/v3/orderList', `${qs1}&signature=${hmacHex(secret, qs1)}`, apiKey)).data
  if (!list) return null
  if (list.listOrderStatus !== 'ALL_DONE') return null // still live
  // One leg filled (or both cancelled = manual). Check each leg's final state.
  for (const o of list.orders || []) {
    const qs2 = `symbol=${symbol}&orderId=${o.orderId}&timestamp=${Date.now()}&recvWindow=5000`
    const ord = (await spotGet('/api/v3/order', `${qs2}&signature=${hmacHex(secret, qs2)}`, apiKey)).data
    if (ord && ord.status === 'FILLED' && parseFloat(ord.executedQty) > 0) {
      const exitPrice = parseFloat(ord.cummulativeQuoteQty) / parseFloat(ord.executedQty)
      const exitReason = ord.type === 'LIMIT_MAKER' ? 'tp1' : 'sl'
      return { done: true, exitPrice, exitReason }
    }
  }
  return { done: true, exitPrice: null, exitReason: 'manual' } // both legs cancelled
}

// ── Candle-based estimate (fallback) ─────────────────────────────────────────
// Walk 1h candles from open: TP1 before SL → tp1; SL first (or same candle,
// conservative) → sl. Uses the signal-tracker's multi-venue fetchCandles.
function walkTp1Sl(candles, openedMs, bias, tp1, sl) {
  const long = bias !== 'short'
  for (const c of candles || []) {
    if (c.time + 3600000 <= openedMs) continue
    const slHit = long ? c.low <= sl : c.high >= sl
    const tpHit = long ? c.high >= tp1 : c.low <= tp1
    if (slHit) return { exitReason: 'sl', exitPrice: sl, at: c.time }   // same-candle → sl
    if (tpHit) return { exitReason: 'tp1', exitPrice: tp1, at: c.time }
  }
  return null
}

// Trade quantity in base units. tradeUSDT is MARGIN for futures (notional =
// margin × leverage, matching how placeOrderSafe sizes the order) and the full
// spend for spot.
function baseQty(trade) {
  const entry = parseFloat(trade.entryPrice) || 0
  if (!(entry > 0)) return 0
  const usd = parseFloat(trade.tradeUSDT) || 0
  const lev = trade.marketType === 'futures' ? (parseFloat(trade.leverage) || 1) : 1
  return (usd * lev) / entry
}

function estPnl(trade, exitPrice) {
  const entry = parseFloat(trade.entryPrice) || 0
  const qty = baseQty(trade)
  if (!(qty > 0) || !(exitPrice > 0)) return null
  const long = trade.bias !== 'short'
  return +(qty * (long ? exitPrice - entry : entry - exitPrice)).toFixed(4)
}

const openedMsOf = (t) => {
  const o = t.openedAt
  if (!o) return 0
  if (typeof o.toMillis === 'function') return o.toMillis()
  return +o || 0
}

// ── Per-trade resolution. Returns a patch to close the doc, or null to keep it
// open. Never throws (caller logs), exchange calls each guarded. ─────────────
async function resolveTrade(trade, creds, fetchCandles, now = Date.now()) {
  const openedMs = openedMsOf(trade)
  if (!openedMs) return null
  const symbol = trade.symbol
  const isFut = trade.marketType === 'futures'
  const margin = parseFloat(trade.tradeUSDT) || 0
  const finish = (exitReason, exitPrice, pnl, estimated) => ({
    status: 'closed', exitReason,
    exitPrice: exitPrice != null ? +exitPrice : null,
    pnl: pnl != null ? +(+pnl).toFixed(4) : null,
    pnlPct: pnl != null && margin > 0 ? +((pnl / margin) * 100).toFixed(2) : null,
    pnlEstimated: !!estimated,
  })
  // Label the exit by proximity to the trade's levels (for real fills).
  const labelExit = (exitPrice) => {
    const tp1 = parseFloat(trade.tp1), sl = parseFloat(trade.stopLoss)
    if (exitPrice > 0 && tp1 > 0 && Math.abs(exitPrice - tp1) / tp1 < 0.01) return 'tp1'
    if (exitPrice > 0 && sl > 0 && Math.abs(exitPrice - sl) / sl < 0.01) return 'sl'
    return 'manual'
  }

  // 1) Futures: is the position flat on the exchange?
  if (isFut && creds) {
    try {
      let size = null
      if (trade.exchange === 'binance') size = await binanceFuturesPositionAmt(creds.apiKey, creds.secret, symbol)
      else if (trade.exchange === 'bybit') size = await bybitPositionSize(creds.apiKey, creds.secret, symbol)
      else if (trade.exchange === 'mexc') size = await mexcOpenPosition(creds.apiKey, creds.secret, symbol)
      if (size != null && size > 0) return null // still open on the exchange — leave it
      if (size === 0) {
        // Flat → recover the real realized PnL where the venue exposes it.
        let real = null
        try {
          if (trade.exchange === 'binance') real = await binanceFuturesRealized(creds.apiKey, creds.secret, symbol, openedMs)
          else if (trade.exchange === 'bybit') real = await bybitClosedPnl(creds.apiKey, creds.secret, symbol, openedMs)
        } catch (_) { /* estimate below */ }
        if (real && real.pnl != null) {
          return finish(labelExit(real.exitPrice), real.exitPrice, real.pnl, false)
        }
        // Flat but no fill history (window passed / MEXC) → estimate off candles.
        const candles = await fetchCandles(symbol)
        const hit = candles && walkTp1Sl(candles, openedMs, trade.bias, parseFloat(trade.tp1), parseFloat(trade.stopLoss))
        if (hit) return finish(hit.exitReason, hit.exitPrice, estPnl(trade, hit.exitPrice), true)
        const last = candles && candles[candles.length - 1]
        return finish('manual', last ? last.close : null, last ? estPnl(trade, last.close) : null, true)
      }
    } catch (_) { /* position query failed — fall through to estimate path */ }
  }

  // 2) Binance spot bracket (OCO): exchange-truth exit.
  if (!isFut && trade.exchange === 'binance' && trade.bracketPlaced && trade.bracket?.orderListId && creds) {
    try {
      const oco = await binanceOcoOutcome(creds.apiKey, creds.secret, symbol, trade.bracket.orderListId)
      if (oco === null) return null // OCO still live
      if (oco.exitPrice != null) return finish(oco.exitReason, oco.exitPrice, estPnl(trade, oco.exitPrice), false)
      // Both legs cancelled (manual takeover) → estimate below.
    } catch (_) { /* fall through */ }
  }

  // 3) Candle estimate: TP1/SL walk from open (spot non-bracket & fallbacks).
  const candles = await fetchCandles(symbol)
  if (candles) {
    const hit = walkTp1Sl(candles, openedMs, trade.bias, parseFloat(trade.tp1), parseFloat(trade.stopLoss))
    if (hit) return finish(hit.exitReason, hit.exitPrice, estPnl(trade, hit.exitPrice), true)
  }

  // 4) Nothing hit: time the trade out after MAX_OPEN_MS, else keep waiting.
  if (now - openedMs > MAX_OPEN_MS) {
    const last = candles && candles[candles.length - 1]
    return finish('timeout', last ? last.close : null, last ? estPnl(trade, last.close) : null, true)
  }
  return null
}

// ── Scheduler entrypoint ──────────────────────────────────────────────────────
// ctx: { db, admin, encryption, masterSecret, fetchCandles, notify }
async function processCexExits(ctx) {
  const { db, admin, encryption, masterSecret, fetchCandles, notify } = ctx
  const snap = await db.collectionGroup('cexTrades').where('status', '==', 'open').limit(120).get()
  if (snap.empty) return { checked: 0, closed: 0 }

  // Candle fetches shared per symbol across trades/users.
  const candleCache = {}
  const getCandles = async (sym) => {
    if (!(sym in candleCache)) candleCache[sym] = await fetchCandles(sym).catch(() => null)
    return candleCache[sym]
  }
  // Per-user decrypted creds cache (per exchange).
  const userCreds = {}
  const getCreds = async (uid, exchange) => {
    const key = `${uid}/${exchange}`
    if (key in userCreds) return userCreds[key]
    let creds = null
    try {
      const u = await db.doc(`users/${uid}`).get()
      const k = (u.data()?.agentSettings?.cexKeys || {})[exchange]
      if (k?.encryptedApiKey) {
        creds = {
          apiKey: encryption.decrypt(k.encryptedApiKey, uid, masterSecret),
          secret: encryption.decrypt(k.encryptedSecret, uid, masterSecret),
        }
      }
    } catch (_) { creds = null }
    userCreds[key] = creds
    return creds
  }

  let closed = 0
  for (const doc of snap.docs) {
    const trade = doc.data()
    const uid = doc.ref.parent.parent && doc.ref.parent.parent.id
    if (!uid || !trade.symbol) continue
    try {
      const creds = await getCreds(uid, trade.exchange)
      const patch = await resolveTrade(trade, creds, getCandles)
      if (!patch) continue
      patch.closedAt = admin.firestore.FieldValue.serverTimestamp()
      await doc.ref.set(patch, { merge: true })
      closed++
      if (notify) {
        const sign = patch.pnl != null ? (patch.pnl >= 0 ? '+' : '−') : ''
        const amt = patch.pnl != null ? `${sign}$${Math.abs(patch.pnl).toFixed(2)}` : 'closed'
        const tag = patch.exitReason === 'tp1' ? '🎯 TP1' : patch.exitReason === 'sl' ? '🛑 SL' : patch.exitReason === 'timeout' ? '⌛' : '✅'
        await notify(uid, {
          category: 'trades',
          title: `${tag} ${trade.symbol} closed ${amt}${patch.pnlEstimated ? ' (est.)' : ''}`,
          body: `${(trade.bias || 'long').toUpperCase()} ${trade.marketType || 'spot'} · entry $${trade.entryPrice}${patch.exitPrice ? ` → exit $${patch.exitPrice}` : ''}`,
          link: '/?goto=signals', tag: 'cex-exit',
        }).catch(() => {})
      }
    } catch (e) {
      console.warn(`cex-exit ${trade.symbol} (${uid.slice(0, 6)}): ${e.message}`)
    }
  }
  return { checked: snap.size, closed }
}

module.exports = { processCexExits, resolveTrade, walkTp1Sl, estPnl, baseQty }

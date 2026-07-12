// signal-tracker.js — resolves every published CEX signal against its SL/TP
// levels using exchange candles, and rolls outcomes into daily aggregates that
// power the public track record (win rate / avg R on the Signals screen and
// paywall).
//
// Outcome model (stamped on the signal doc):
//   outcome    'tp1' | 'tp2' | 'tp3' | 'sl' | 'expired'
//   - entry must FILL (price touches entry) before the signal's expiresAt (4h);
//     otherwise → 'expired' (never counted as a win or a loss)
//   - after fill: outcome = highest TP level reached before the SL touch; SL
//     with no TP → 'sl'. Same-candle SL+TP ambiguity resolves to SL (conservative).
//   - filled but neither side hit within TRACK_WINDOW → highest TP reached, else 'expired'
//   outcomeR   R-multiple: wins (tpN−entry)/risk, sl −1, expired null
//
// Daily aggregates (server-only collection `signalStats/{YYYY-MM-DD}`):
//   { total, tp1, tp2, tp3, sl, expired, sumR, rCount }
const axios = require('axios')

const TRACK_WINDOW_MS = 7 * 24 * 3600000   // give a filled trade 7 days to resolve
const LOOKBACK_MS = 8 * 24 * 3600000       // query window (> track window + slack)

// 1h candles (up to ~8.3 days) as [{ time, high, low, close }], tried across
// venues in order so every signal source can resolve: Binance spot, Binance
// USDM futures (futures-only symbols like 1000PEPEUSDT), Bybit spot + linear,
// MEXC spot + contract, KuCoin spot. First venue with data wins — cross-venue
// 1h highs/lows track each other closely enough for TP/SL resolution.
async function fetchCandles(symbol) {
  // Binance-compatible kline rows: [openTime, open, high, low, close, …]
  // (fapi1/fapi2 are official alternates — same rotation market-analyzer uses.)
  for (const url of [
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`,
    `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=200`,
    `https://fapi1.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=200`,
    `https://fapi2.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=200`,
  ]) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 })
      if (Array.isArray(data) && data.length) return data.map((k) => ({ time: +k[0], high: +k[2], low: +k[3], close: +k[4] }))
    } catch (_) { /* fall through */ }
  }
  // Bybit v5 rows (newest first): [startTime, open, high, low, close, volume, turnover]
  for (const category of ['spot', 'linear']) {
    try {
      const { data } = await axios.get(`https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=60&limit=200`, { timeout: 10000 })
      const list = data?.result?.list
      if (Array.isArray(list) && list.length) {
        return list.map((k) => ({ time: +k[0], high: +k[2], low: +k[3], close: +k[4] })).sort((a, b) => a.time - b.time)
      }
    } catch (_) { /* fall through */ }
  }
  // MEXC spot (Binance-compatible; 1h interval is "60m")
  try {
    const { data } = await axios.get(`https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=60m&limit=200`, { timeout: 10000 })
    if (Array.isArray(data) && data.length) return data.map((k) => ({ time: +k[0], high: +k[2], low: +k[3], close: +k[4] }))
  } catch (_) { /* fall through */ }
  // MEXC contract (BTCUSDT → BTC_USDT; parallel arrays, time in seconds)
  try {
    const fxSym = symbol.replace(/USDT$/, '_USDT')
    const end = Math.floor(Date.now() / 1000), start = end - 205 * 3600
    const { data } = await axios.get(`https://contract.mexc.com/api/v1/contract/kline/${fxSym}?interval=Hour1&start=${start}&end=${end}`, { timeout: 10000 })
    const d = data?.data
    if (d?.time?.length) {
      return d.time.map((t, i) => ({ time: +t * 1000, high: +d.high[i], low: +d.low[i], close: +d.close[i] }))
    }
  } catch (_) { /* fall through */ }
  // KuCoin spot (BTCUSDT → BTC-USDT; rows newest first: [time(s), open, close, high, low, …])
  try {
    const kSym = symbol.replace(/USDT$/, '-USDT')
    const { data } = await axios.get(`https://api.kucoin.com/api/v1/market/candles?type=1hour&symbol=${kSym}`, { timeout: 10000 })
    const list = data?.data
    if (Array.isArray(list) && list.length) {
      return list.map((k) => ({ time: +k[0] * 1000, high: +k[3], low: +k[4], close: +k[2] })).sort((a, b) => a.time - b.time)
    }
  } catch (_) { /* no data anywhere */ }
  return null
}

// Pure resolution logic (unit-testable). Returns { outcome, outcomeR } or null
// if the signal is still live (no terminal event yet, window not over).
function resolveOutcome(signal, candles, now = Date.now()) {
  const s = signal
  const long = s.bias === 'long'
  const entry = +s.entry, sl = +s.stopLoss
  const tps = [+s.tp1, +s.tp2, +s.tp3]
  const risk = Math.abs(entry - sl)
  if (!isFinite(entry) || !isFinite(sl) || risk <= 0) return { outcome: 'expired', outcomeR: null, at: null }
  const fillDeadline = s.expiresAt || s.generatedAt + 4 * 3600000
  const trackDeadline = s.generatedAt + TRACK_WINDOW_MS
  const window = (candles || []).filter((c) => c.time + 3600000 > s.generatedAt) // include the candle containing generation

  // 1) entry fill: price must touch the entry level before the signal expires.
  let fillIdx = -1
  for (let i = 0; i < window.length; i++) {
    const c = window[i]
    if (c.time > fillDeadline) break
    if (long ? c.low <= entry : c.high >= entry) { fillIdx = i; break }
  }
  if (fillIdx < 0) {
    if (now > fillDeadline + 3600000) return { outcome: 'expired', outcomeR: null, at: null } // never filled
    return null // fill window still open
  }

  // 2) walk candles after fill: highest TP reached before the SL touch. Track the
  // candle time of the deciding event (`at`) so the record shows when it hit.
  let bestTp = 0, bestTpAt = null
  for (let i = fillIdx; i < window.length; i++) {
    const c = window[i]
    const slTouched = long ? c.low <= sl : c.high >= sl
    // Conservative same-candle rule: an SL touch beats any TP first reached in
    // that same candle (TPs banked in EARLIER candles still count).
    if (slTouched) {
      return bestTp > 0
        ? { outcome: 'tp' + bestTp, outcomeR: +(Math.abs(tps[bestTp - 1] - entry) / risk).toFixed(2), at: bestTpAt }
        : { outcome: 'sl', outcomeR: -1, at: c.time }
    }
    for (let t = bestTp; t < 3; t++) {
      if (long ? c.high >= tps[t] : c.low <= tps[t]) { bestTp = t + 1; bestTpAt = c.time }
      else break
    }
    if (bestTp === 3) return { outcome: 'tp3', outcomeR: +(Math.abs(tps[2] - entry) / risk).toFixed(2), at: bestTpAt }
  }

  // 3) no terminal event yet.
  if (now > trackDeadline) {
    return bestTp > 0
      ? { outcome: 'tp' + bestTp, outcomeR: +(Math.abs(tps[bestTp - 1] - entry) / risk).toFixed(2), at: bestTpAt }
      : { outcome: 'expired', outcomeR: null, at: null }
  }
  return null
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10)

// Durable, server-only record of each won/lost signal, written at resolution
// time. The per-user `signals` docs are ephemeral (they age out via TTL once
// `expiresAt` passes), so the track-record drill-down can't rely on them still
// existing — this collection is the permanent source for the outcome list.
const OUTCOMES_COL = 'signalOutcomes'
const OUTCOMES_D90 = 90 * 24 * 3600000
const num = (v) => (v != null && isFinite(+v) ? +v : null)
// Full, durable snapshot of a resolved signal so the track-record drill-down can
// show every detail (levels, timing, exchange, R) even after the ephemeral
// per-user signal doc is TTL-deleted. `res` = { outcome, outcomeR, at }, where
// `at` is the candle time the deciding TP/SL was hit.
const outcomeRecord = (uid, sigId, s, res) => ({
  id: `${uid}__${sigId}`,
  symbol: s.symbol || '', bias: s.bias || 'long',
  outcome: res.outcome, outcomeR: res.outcomeR != null ? res.outcomeR : null,
  won: String(res.outcome).startsWith('tp'),
  generatedAt: s.generatedAt || null,          // when the signal was called
  hitAt: res.at != null ? res.at : Date.now(), // when it hit TP/SL
  resolvedAt: Date.now(),                       // when the resolver recorded it
  entry: num(s.entry), stopLoss: num(s.stopLoss),
  tp1: num(s.tp1), tp2: num(s.tp2), tp3: num(s.tp3),
  riskReward: s.riskReward != null ? s.riskReward : null,
  confidence: num(s.confidence),
  exchange: s.exchange || null,
  timeframe: s.timeframe || null,
  marketType: s.marketType || 'spot',
  leverage: num(s.leverage),
})

// The scheduler entrypoint: resolve recent unresolved signals across all users
// and fold outcomes into the daily aggregates.
async function resolveSignals(db, admin) {
  const cutoff = Date.now() - LOOKBACK_MS
  // Generous limit: the query can't exclude already-resolved docs (Firestore
  // can't filter on a missing field), so a low cap risks starving unresolved
  // signals behind resolved ones.
  const snap = await db.collectionGroup('signals')
    .where('generatedAt', '>', cutoff).limit(1000).get()
  if (snap.empty) return { checked: 0, resolved: 0 }

  const unresolved = snap.docs.filter((d) => !d.data().outcome)
  if (!unresolved.length) return { checked: snap.size, resolved: 0 }

  // One candle fetch per symbol, shared across users/signals.
  const candleCache = {}
  const getCandles = async (symbol) => {
    if (!(symbol in candleCache)) candleCache[symbol] = await fetchCandles(symbol)
    return candleCache[symbol]
  }

  let resolved = 0, recorded = 0
  const dailyInc = {} // day → field increments
  for (const doc of unresolved) {
    const s = doc.data()
    if (!s.symbol || !s.generatedAt) continue
    const candles = await getCandles(s.symbol)
    if (!candles) continue // no market data this run — retry next tick until window closes
    const res = resolveOutcome(s, candles)
    if (!res) continue
    resolved++
    await doc.ref.set({ outcome: res.outcome, outcomeR: res.outcomeR, outcomeAt: Date.now() }, { merge: true }).catch(() => {})
    // Durably record terminal (won/lost) outcomes for the drill-down list, so it
    // survives the signal doc being TTL-deleted after it resolves.
    if (res.outcome && res.outcome !== 'expired') {
      const uid = (doc.ref.parent.parent && doc.ref.parent.parent.id) || 'u'
      const rec = outcomeRecord(uid, doc.id, s, res)
      await db.collection(OUTCOMES_COL).doc(rec.id).set(rec, { merge: true }).then(() => { recorded++ }).catch(() => {})
    }
    const day = dayKey(s.generatedAt)
    const inc = (dailyInc[day] = dailyInc[day] || { total: 0, tp1: 0, tp2: 0, tp3: 0, sl: 0, expired: 0, sumR: 0, rCount: 0 })
    inc.total++
    inc[res.outcome] = (inc[res.outcome] || 0) + 1
    if (res.outcomeR != null) { inc.sumR += res.outcomeR; inc.rCount++ }
  }

  const FieldValue = admin.firestore.FieldValue
  for (const [day, inc] of Object.entries(dailyInc)) {
    const patch = {}
    for (const [k, v] of Object.entries(inc)) if (v) patch[k] = FieldValue.increment(v)
    if (Object.keys(patch).length) await db.doc(`signalStats/${day}`).set(patch, { merge: true }).catch(() => {})
  }
  return { checked: snap.size, resolved, recorded }
}

// Aggregate the daily docs into 30/90-day windows for the app + paywall.
async function readStats(db) {
  const since = dayKey(Date.now() - 90 * 24 * 3600000)
  const snap = await db.collection('signalStats')
    .where(require('firebase-admin').firestore.FieldPath.documentId(), '>=', since).get()
  const mk = () => ({ total: 0, wins: 0, tp1: 0, tp2: 0, tp3: 0, sl: 0, expired: 0, sumR: 0, rCount: 0 })
  const w30 = mk(), w90 = mk()
  const since30 = dayKey(Date.now() - 30 * 24 * 3600000)
  snap.forEach((doc) => {
    const x = doc.data()
    for (const w of doc.id >= since30 ? [w30, w90] : [w90]) {
      w.total += x.total || 0
      w.tp1 += x.tp1 || 0; w.tp2 += x.tp2 || 0; w.tp3 += x.tp3 || 0
      w.sl += x.sl || 0; w.expired += x.expired || 0
      w.sumR += x.sumR || 0; w.rCount += x.rCount || 0
    }
  })
  const finish = (w) => {
    w.wins = w.tp1 + w.tp2 + w.tp3
    const decided = w.wins + w.sl
    return {
      total: w.total, wins: w.wins, losses: w.sl, expired: w.expired,
      winRate: decided ? +(100 * w.wins / decided).toFixed(1) : null,
      avgR: w.rCount ? +(w.sumR / w.rCount).toFixed(2) : null,
      tp1: w.tp1, tp2: w.tp2, tp3: w.tp3,
    }
  }
  return { d30: finish(w30), d90: finish(w90), updatedAt: Date.now() }
}

// The drill-down list behind the track-record card: individual resolved signals
// from the last 90 days (most recent first). Only terminal outcomes (a TP hit or
// an SL) are won/lost; 'expired' (never filled) is excluded — it was neither.
async function readOutcomes(db) {
  const cutoff = Date.now() - OUTCOMES_D90
  const clean = (r) => ({
    symbol: r.symbol || '', bias: r.bias || 'long', outcome: r.outcome,
    outcomeR: r.outcomeR != null ? r.outcomeR : null,
    won: r.won != null ? r.won : String(r.outcome).startsWith('tp'),
    generatedAt: r.generatedAt != null ? r.generatedAt : null,
    hitAt: r.hitAt != null ? r.hitAt : (r.resolvedAt != null ? r.resolvedAt : null),
    resolvedAt: r.resolvedAt != null ? r.resolvedAt : null,
    entry: r.entry != null ? r.entry : null,
    stopLoss: r.stopLoss != null ? r.stopLoss : null,
    tp1: r.tp1 != null ? r.tp1 : null, tp2: r.tp2 != null ? r.tp2 : null, tp3: r.tp3 != null ? r.tp3 : null,
    riskReward: r.riskReward != null ? r.riskReward : null,
    confidence: r.confidence != null ? r.confidence : null,
    exchange: r.exchange || null,
    timeframe: r.timeframe || null,
    marketType: r.marketType || 'spot',
    leverage: r.leverage != null ? r.leverage : null,
  })

  // Primary: durable outcome records (top-level collection → indexed orderBy).
  let recs = []
  try {
    const snap = await db.collection(OUTCOMES_COL)
      .where('generatedAt', '>', cutoff).orderBy('generatedAt', 'desc').limit(200).get()
    recs = snap.docs.map((d) => d.data())
  } catch (_) { recs = [] }

  // Bootstrap/self-heal: if nothing's been recorded yet, scan any signal docs
  // that are still present, capture their resolved outcomes into the durable
  // collection (so later opens are instant), and return them now.
  if (!recs.length) {
    try {
      const live = await db.collectionGroup('signals').where('generatedAt', '>', cutoff).limit(1000).get()
      const found = []
      live.forEach((doc) => {
        const s = doc.data()
        if (!s.outcome || s.outcome === 'expired') return
        const uid = (doc.ref.parent.parent && doc.ref.parent.parent.id) || 'u'
        found.push(outcomeRecord(uid, doc.id, s, { outcome: s.outcome, outcomeR: s.outcomeR, at: s.outcomeAt }))
      })
      found.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0))
      recs = found.slice(0, 200)
      await Promise.all(recs.map((r) => db.collection(OUTCOMES_COL).doc(r.id).set(r, { merge: true }).catch(() => {})))
    } catch (_) { /* leave recs empty */ }
  }

  recs.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0))
  return { outcomes: recs.map(clean), updatedAt: Date.now() }
}

module.exports = { resolveSignals, resolveOutcome, readStats, readOutcomes, fetchCandles }

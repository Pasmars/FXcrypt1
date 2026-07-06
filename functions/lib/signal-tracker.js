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

// 1h candles (up to ~8.3 days) as [{ time, high, low }]. Binance first (matches
// most signals), Bybit as fallback for pairs Binance doesn't list.
async function fetchCandles(symbol) {
  try {
    const { data } = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`, { timeout: 10000 })
    if (Array.isArray(data) && data.length) return data.map((k) => ({ time: k[0], high: +k[2], low: +k[3], close: +k[4] }))
  } catch (_) { /* fall through */ }
  try {
    const { data } = await axios.get(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=60&limit=200`, { timeout: 10000 })
    const list = data?.result?.list
    if (Array.isArray(list) && list.length) {
      return list.map((k) => ({ time: +k[0], high: +k[3], low: +k[4], close: +k[6] || +k[4] })).sort((a, b) => a.time - b.time)
    }
  } catch (_) { /* no data */ }
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
  if (!isFinite(entry) || !isFinite(sl) || risk <= 0) return { outcome: 'expired', outcomeR: null }
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
    if (now > fillDeadline + 3600000) return { outcome: 'expired', outcomeR: null } // never filled
    return null // fill window still open
  }

  // 2) walk candles after fill: highest TP reached before the SL touch.
  let bestTp = 0
  for (let i = fillIdx; i < window.length; i++) {
    const c = window[i]
    const slTouched = long ? c.low <= sl : c.high >= sl
    // Conservative same-candle rule: an SL touch beats any TP first reached in
    // that same candle (TPs banked in EARLIER candles still count).
    if (slTouched) {
      return bestTp > 0
        ? { outcome: 'tp' + bestTp, outcomeR: +(Math.abs(tps[bestTp - 1] - entry) / risk).toFixed(2) }
        : { outcome: 'sl', outcomeR: -1 }
    }
    for (let t = bestTp; t < 3; t++) {
      if (long ? c.high >= tps[t] : c.low <= tps[t]) bestTp = t + 1
      else break
    }
    if (bestTp === 3) return { outcome: 'tp3', outcomeR: +(Math.abs(tps[2] - entry) / risk).toFixed(2) }
  }

  // 3) no terminal event yet.
  if (now > trackDeadline) {
    return bestTp > 0
      ? { outcome: 'tp' + bestTp, outcomeR: +(Math.abs(tps[bestTp - 1] - entry) / risk).toFixed(2) }
      : { outcome: 'expired', outcomeR: null }
  }
  return null
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10)

// The scheduler entrypoint: resolve recent unresolved signals across all users
// and fold outcomes into the daily aggregates.
async function resolveSignals(db, admin) {
  const cutoff = Date.now() - LOOKBACK_MS
  const snap = await db.collectionGroup('signals')
    .where('generatedAt', '>', cutoff).limit(400).get()
  if (snap.empty) return { checked: 0, resolved: 0 }

  const unresolved = snap.docs.filter((d) => !d.data().outcome)
  if (!unresolved.length) return { checked: snap.size, resolved: 0 }

  // One candle fetch per symbol, shared across users/signals.
  const candleCache = {}
  const getCandles = async (symbol) => {
    if (!(symbol in candleCache)) candleCache[symbol] = await fetchCandles(symbol)
    return candleCache[symbol]
  }

  let resolved = 0
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
  return { checked: snap.size, resolved }
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
  const cutoff = Date.now() - 90 * 24 * 3600000
  // Where-only (no server-side orderBy): a collection-group query ordered by
  // generatedAt needs a COLLECTION_GROUP_DESC index we don't provision. Mirror
  // resolveSignals' proven pattern and sort in memory instead.
  const snap = await db.collectionGroup('signals')
    .where('generatedAt', '>', cutoff).limit(600).get()
  const list = []
  snap.forEach((doc) => {
    const s = doc.data()
    if (!s.outcome || s.outcome === 'expired') return
    const won = s.outcome.startsWith('tp')
    list.push({
      symbol: s.symbol || '', bias: s.bias || 'long',
      outcome: s.outcome, outcomeR: s.outcomeR != null ? s.outcomeR : null,
      generatedAt: s.generatedAt, entry: s.entry != null ? s.entry : null, won,
    })
  })
  list.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0))
  return { outcomes: list.slice(0, 200), updatedAt: Date.now() }
}

module.exports = { resolveSignals, resolveOutcome, readStats, readOutcomes, fetchCandles }

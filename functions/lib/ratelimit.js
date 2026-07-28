// ratelimit.js — per-user call ceilings for the expensive, unmetered callables.
//
// Pointer and the gem scanner are metered by credits, but the data endpoints
// (holder graphs, transfer history, RPC proxying, balance fan-outs) were not
// capped at all. They are the costly ones: getHolderGraph runs 120s at 512MB
// and burns paid Moralis/Helius quota on every call, so one signed-in account
// looping it is a direct bill-amplification attack — no auth bypass needed.
//
// Fixed-window counters in `rateLimits/{uid}__{key}`: a minute window stops
// bursts, a day window stops slow grinding. Both are enforced in one
// transaction so parallel calls can't race past the ceiling.

const functions = require('firebase-functions')

// [perMinute, perDay]. Generous enough that ordinary use never notices — these
// are ceilings on abuse, not quotas. rpcProxy is deliberately high: the wallet
// screens poll it for balances across several chains on every refresh.
const LIMITS = {
  getHolderGraph:   [6, 200],
  getPairTransfers: [15, 400],
  getTokenHolders:  [40, 1500],
  getWalletTokens:  [40, 1500],
  bridgeQuote:      [30, 600],
  rpcProxy:         [180, 12000],
  scanArbitrage:    [12, 300],
  getBalances:      [40, 1500],
  getCexBalances:   [30, 800],
}

const minuteWindow = () => Math.floor(Date.now() / 60000)
const dayWindow = () => Math.floor(Date.now() / 86400000)

// Throws a resource-exhausted HttpsError when the caller is over the ceiling.
// Never blocks on infrastructure trouble — a failed counter read must not take
// the endpoint down with it.
async function check(db, uid, key) {
  const limit = LIMITS[key]
  if (!limit || !uid) return
  const [perMin, perDay] = limit
  const ref = db.doc(`rateLimits/${uid}__${key}`)
  const min = minuteWindow(), day = dayWindow()

  let exceeded = null
  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref)
      const d = snap.exists ? snap.data() : {}
      const mCount = d.minWindow === min ? (d.minCount || 0) : 0
      const dCount = d.dayWindow === day ? (d.dayCount || 0) : 0
      if (mCount >= perMin) { exceeded = { scope: 'minute', retryAfter: 60 - (Math.floor(Date.now() / 1000) % 60) }; return }
      if (dCount >= perDay) { exceeded = { scope: 'day', retryAfter: 3600 }; return }
      t.set(ref, { minWindow: min, minCount: mCount + 1, dayWindow: day, dayCount: dCount + 1, at: Date.now() }, { merge: true })
    })
  } catch (_) { return } // counter unavailable → fail open rather than break the app

  if (exceeded) {
    throw new functions.https.HttpsError(
      'resource-exhausted',
      exceeded.scope === 'minute'
        ? 'Too many requests — slow down and try again in a moment.'
        : "You've hit today's limit for this feature. It resets tomorrow.",
      { code: 'rate_limited', scope: exceeded.scope, retryAfter: exceeded.retryAfter }
    )
  }
}

module.exports = { check, LIMITS }

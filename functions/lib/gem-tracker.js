// gem-tracker.js — "hindsight stats": measures how gems the scanner surfaced
// actually performed, so the scanner can show honest median/best 24h & 7d
// returns instead of asking users to take it on faith.
//
// Each token is recorded the FIRST time it's surfaced (gemSightings/{chain_addr},
// create-only so the first price wins). A resolver re-prices sightings at their
// +24h and +7d marks and stamps perf24h / perf7d. readStats aggregates the last
// 30 days into median/best/win-rate. Server-only collection (admin SDK).
const positions = require('./positions')

const sightingId = (chain, addr) => `${chain}_${String(addr).toLowerCase()}`
const H24 = 24 * 3600000
const D7 = 7 * 86400000

// Record up to `cap` freshly-surfaced gems. `.create()` dedupes by token — an
// already-sighted token throws ALREADY_EXISTS and is ignored (first price wins).
async function recordSightings(db, gems, cap = 20) {
  if (!Array.isArray(gems) || !gems.length) return { recorded: 0 }
  const top = gems.filter((g) => g && g.tokenAddress && g.chain && positions.NATIVE_SYM[g.chain] && parseFloat(g.priceUsd) > 0).slice(0, cap)
  let recorded = 0
  await Promise.all(top.map(async (g) => {
    const ref = db.doc(`gemSightings/${sightingId(g.chain, g.tokenAddress)}`)
    try {
      await ref.create({
        chain: g.chain, address: String(g.tokenAddress).toLowerCase(),
        sym: g.tokenSymbol || '', name: g.tokenName || '',
        firstPriceUsd: parseFloat(g.priceUsd), firstSeenAt: Date.now(),
        score: g.gemScore || null, perf24h: null, perf7d: null,
      })
      recorded++
    } catch (_) { /* already sighted — keep the original first price */ }
  }))
  return { recorded }
}

// Re-price sightings that have reached their 24h / 7d mark but aren't resolved.
async function resolveGemOutcomes(db) {
  const now = Date.now()
  // Single-field range+order (auto-indexed). 8-day window > the 7d mark + slack.
  const snap = await db.collection('gemSightings')
    .where('firstSeenAt', '>', now - 8 * 86400000)
    .orderBy('firstSeenAt', 'desc').limit(500).get()
  const due = snap.docs.filter((d) => {
    const x = d.data()
    return (x.perf24h == null && now - x.firstSeenAt >= H24) || (x.perf7d == null && now - x.firstSeenAt >= D7)
  })
  if (!due.length) return { checked: snap.size, resolved: 0 }

  const byChain = {}
  for (const d of due) { const x = d.data(); (byChain[x.chain] = byChain[x.chain] || new Set()).add(x.address) }
  const px = {}
  for (const [c, set] of Object.entries(byChain)) px[c] = await positions.batchPrices(c, [...set])

  let resolved = 0
  await Promise.all(due.map(async (d) => {
    const x = d.data()
    const cur = (px[x.chain] || {})[x.address]
    if (!cur || !(x.firstPriceUsd > 0)) return // no live price this run — retry next tick
    const ret = +((cur / x.firstPriceUsd - 1) * 100).toFixed(1)
    const patch = {}
    if (x.perf24h == null && now - x.firstSeenAt >= H24) patch.perf24h = ret
    if (x.perf7d == null && now - x.firstSeenAt >= D7) patch.perf7d = ret
    if (Object.keys(patch).length) { await d.ref.set(patch, { merge: true }).catch(() => {}); resolved++ }
  }))
  return { checked: snap.size, resolved }
}

// Median / best / win-rate over resolved sightings in the last 30 days.
async function readStats(db) {
  const snap = await db.collection('gemSightings')
    .where('firstSeenAt', '>', Date.now() - 30 * 86400000)
    .orderBy('firstSeenAt', 'desc').limit(600).get()
  const p24 = [], p7 = []
  snap.forEach((d) => { const x = d.data(); if (x.perf24h != null) p24.push(x.perf24h); if (x.perf7d != null) p7.push(x.perf7d) })
  const stat = (arr) => {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    return {
      count: arr.length,
      median: +s[Math.floor(s.length / 2)].toFixed(1),
      best: +s[s.length - 1].toFixed(1),
      winRate: +(100 * arr.filter((v) => v > 0).length / arr.length).toFixed(0),
    }
  }
  return { d1: stat(p24), d7: stat(p7), tracked: snap.size, updatedAt: Date.now() }
}

module.exports = { recordSightings, resolveGemOutcomes, readStats, sightingId }

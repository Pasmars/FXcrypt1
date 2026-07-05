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

const D90_MS = 90 * 86400000

// Pull the resolved-or-tracked sightings for the public track record. One query,
// shared by readStats (aggregates) and readOutcomes (the drill-down list).
async function fetchRecent(db) {
  const snap = await db.collection('gemSightings')
    .where('firstSeenAt', '>', Date.now() - D90_MS)
    .orderBy('firstSeenAt', 'desc').limit(1000).get()
  return snap.docs.map((d) => d.data())
}

// A gem's realized outcome is its 7-day return (falling back to 24h while the
// 7d mark is still pending), so a token is "resolved" once either mark is set.
const gemReturn = (x) => (x.perf7d != null ? x.perf7d : x.perf24h)
const isResolved = (x) => gemReturn(x) != null

// Median / best / win-rate (24h & 7d) + a 90-day win/loss track record that
// mirrors the CEX signal bot: win rate, avg return, W/L and outcome buckets.
async function readStats(db) {
  const rows = await fetchRecent(db)
  const p24 = [], p7 = []
  rows.forEach((x) => { if (x.perf24h != null) p24.push(x.perf24h); if (x.perf7d != null) p7.push(x.perf7d) })
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

  // 90-day track record over resolved gems. Buckets (by realized return):
  //   moon ≥ +100% (2x+) · up 0–100% · down ≤ 0%.  wins = moon + up.
  const resolved = rows.filter(isResolved).map(gemReturn)
  let moon = 0, up = 0, down = 0, sumR = 0
  for (const r of resolved) {
    sumR += r
    if (r >= 100) moon++
    else if (r > 0) up++
    else down++
  }
  const wins = moon + up, total = resolved.length
  const d90 = {
    total, wins, losses: down, moon, up, down,
    winRate: total ? +(100 * wins / total).toFixed(1) : null,
    avgReturn: total ? +(sumR / total).toFixed(1) : null,
  }

  return { d1: stat(p24), d7: stat(p7), d90, tracked: rows.length, updatedAt: Date.now() }
}

// The drill-down list behind the track-record card: individual resolved gems in
// the last 90 days (most recent first), each stamped won/lost by realized return.
async function readOutcomes(db) {
  const rows = await fetchRecent(db)
  const list = rows.filter(isResolved).map((x) => {
    const ret = gemReturn(x)
    return {
      chain: x.chain, address: x.address, sym: x.sym || '', name: x.name || '',
      firstSeenAt: x.firstSeenAt, score: x.score != null ? x.score : null,
      perf24h: x.perf24h != null ? x.perf24h : null,
      perf7d: x.perf7d != null ? x.perf7d : null,
      ret, won: ret > 0,
    }
  }).slice(0, 200)
  return { outcomes: list, updatedAt: Date.now() }
}

module.exports = { recordSightings, resolveGemOutcomes, readStats, readOutcomes, sightingId }

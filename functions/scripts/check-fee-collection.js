#!/usr/bin/env node
// Verifies that the platform trading fee is actually reaching the fee wallet.
//
// The dashboard reports what the app RECORDED; this reads the chain, so the two
// can be compared. Run it before and after a test trade — the delta is the
// proof that a fee leg really landed, independent of anything the app claims.
//
// Usage:
//   node functions/scripts/check-fee-collection.js <feeWalletAddress> [--json]
//
// A fee arrives as a plain native transfer from the trader's wallet, so it
// shows up as an incoming transaction with a non-zero value.

const EXPLORERS = {
  bsc:   { name: 'BNB Chain',       api: 'https://bnb.blockscout.com',              symbol: 'BNB' },
  rhood: { name: 'Robinhood Chain', api: 'https://robinhoodchain.blockscout.com',   symbol: 'ETH' },
  eth:   { name: 'Ethereum',        api: 'https://eth.blockscout.com',              symbol: 'ETH' },
  base:  { name: 'Base',            api: 'https://base.blockscout.com',             symbol: 'ETH' },
}

const addr = (process.argv[2] || '').trim()
const asJson = process.argv.includes('--json')
if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
  console.error('Usage: node functions/scripts/check-fee-collection.js <0x fee wallet> [--json]')
  process.exit(1)
}

async function get(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  // Blockscout answers 404 for an address it has never seen — that is a real
  // answer ("no activity"), not an error.
  if (res.status === 404) return { __empty: true }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function checkChain(key) {
  const cfg = EXPLORERS[key]
  const out = { chain: key, name: cfg.name, symbol: cfg.symbol, seen: false, balance: null, incoming: 0, total: 0, recent: [] }
  try {
    const info = await get(`${cfg.api}/api/v2/addresses/${addr}`)
    if (info.__empty) return out            // address unknown to this chain yet
    out.seen = true
    out.balance = info.coin_balance != null ? Number(info.coin_balance) / 1e18 : null

    const txs = await get(`${cfg.api}/api/v2/addresses/${addr}/transactions`)
    if (txs.__empty || !txs.items) return out
    const lower = addr.toLowerCase()
    for (const t of txs.items) {
      const to = (t.to?.hash || '').toLowerCase()
      const value = Number(t.value || 0) / 1e18
      if (to !== lower || !(value > 0)) continue   // only incoming, non-zero
      out.incoming++
      out.total += value
      if (out.recent.length < 5) {
        out.recent.push({ hash: t.hash, value, from: t.from?.hash || '', at: t.timestamp || null })
      }
    }
  } catch (e) {
    out.error = e.message
  }
  return out
}

async function main() {
  const results = []
  for (const key of Object.keys(EXPLORERS)) results.push(await checkChain(key))

  if (asJson) { console.log(JSON.stringify({ address: addr, checkedAt: new Date().toISOString(), results }, null, 2)); return }

  console.log(`\nFee wallet ${addr}`)
  console.log(`Checked ${new Date().toISOString()}\n`)
  let anyFees = false
  for (const r of results) {
    if (r.error) { console.log(`  ${r.name.padEnd(17)} error: ${r.error}`); continue }
    if (!r.seen) { console.log(`  ${r.name.padEnd(17)} no on-chain activity yet`); continue }
    const bal = r.balance != null ? `${r.balance} ${r.symbol}` : '—'
    console.log(`  ${r.name.padEnd(17)} balance ${bal} · ${r.incoming} incoming transfer(s) totalling ${r.total} ${r.symbol}`)
    if (r.incoming) anyFees = true
    for (const t of r.recent) {
      console.log(`      +${t.value} ${r.symbol}  from ${t.from.slice(0, 10)}…  ${t.at || ''}`)
    }
  }
  console.log(anyFees
    ? '\nIncoming transfers found — compare the totals against the dashboard\'s Gas-fee revenue.'
    : '\nNo incoming transfers yet. Expected until the fee is configured AND a trade runs.')
}

main().catch((e) => { console.error(e); process.exit(1) })

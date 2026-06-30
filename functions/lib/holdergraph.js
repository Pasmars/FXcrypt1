// Holder-graph engine (bubble map) — mirrors the getHolderGraph callable in
// index.js so the AI agent can analyze holder distribution + wallet clusters.
// EVM via Moralis (top holders + transfers), SOL via Helius (DAS).
const MORALIS_CHAIN_HEX = { eth: '0x1', bsc: '0x38', base: '0x2105' }

async function moralisGet(path, key) {
  const res = await fetch(`https://deep-index.moralis.io/api/v2.2/${path}`, {
    headers: { 'X-API-Key': key, accept: 'application/json' }
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Moralis error: ${res.status}`)
  }
  return res.json()
}

// Aggregate edges from a flat transfer list, keeping only those where both
// endpoints are in `nodeSet` (Set of lowercased addresses).
function buildEdges(transfers, nodeSet) {
  const map = new Map()
  for (const t of transfers) {
    const from = (t.from || '').toLowerCase()
    const to   = (t.to || '').toLowerCase()
    if (!from || !to || from === to) continue
    if (!nodeSet.has(from) || !nodeSet.has(to)) continue
    const key = from < to ? `${from}|${to}` : `${to}|${from}`
    const e = map.get(key) || { from, to, value: 0, count: 0, lastTs: 0, lastTx: '' }
    e.value += t.value || 0
    e.count += 1
    if ((t.ts || 0) > e.lastTs) { e.lastTs = t.ts || 0; e.lastTx = t.txHash || '' }
    map.set(key, e)
  }
  return [...map.values()]
}

// ── EVM holder graph (Moralis) ──────────────────────────────────────────────
async function evmHolderGraph(chain, addr, topN, key) {
  const hex = MORALIS_CHAIN_HEX[chain]

  let token = { address: addr, chain, name: '', symbol: '', decimals: 18, priceUsd: null }
  try {
    const price = await moralisGet(`erc20/${addr}/price?chain=${hex}`, key)
    token.priceUsd = price.usdPrice ?? null
    token.name     = price.tokenName || ''
    token.symbol   = price.tokenSymbol || ''
    token.decimals = price.tokenDecimals != null ? parseInt(price.tokenDecimals, 10) : 18
  } catch (_) {}

  const holders = []
  let cursor = ''
  const maxOwnerPages = Math.min(20, Math.ceil(topN / 100)) // up to 2000 holders (100/page)
  for (let page = 0; page < maxOwnerPages && holders.length < topN; page++) {
    const q = `erc20/${addr}/owners?chain=${hex}&order=DESC&limit=100${cursor ? `&cursor=${cursor}` : ''}`
    let json
    try { json = await moralisGet(q, key) } catch (e) { if (page === 0) throw e; break }
    const rows = json.result || []
    for (const r of rows) {
      const balance = parseFloat(r.balance_formatted ?? r.balance ?? 0)
      holders.push({
        address: (r.owner_address || '').toLowerCase(),
        balance,
        pct: r.percentage_relative_to_total_supply != null ? parseFloat(r.percentage_relative_to_total_supply) : null,
        usdValue: r.usd_value != null ? parseFloat(r.usd_value) : (token.priceUsd != null ? balance * token.priceUsd : null),
        isContract: !!r.is_contract,
        label: r.owner_address_label || r.entity || ''
      })
      if (holders.length >= topN) break
    }
    cursor = json.cursor || ''
    if (!cursor) break
  }

  // Deep transfer history → builds the wallet-to-wallet link graph & bundles.
  const transfers = []
  cursor = ''
  for (let page = 0; page < 14; page++) {
    const q = `erc20/${addr}/transfers?chain=${hex}&order=DESC&limit=100${cursor ? `&cursor=${cursor}` : ''}`
    let json
    try { json = await moralisGet(q, key) } catch (_) { break }
    for (const r of (json.result || [])) {
      transfers.push({ from: r.from_address, to: r.to_address, value: parseFloat(r.value_decimal ?? 0), txHash: r.transaction_hash, ts: r.block_timestamp ? Date.parse(r.block_timestamp) : 0 })
    }
    cursor = json.cursor || ''
    if (!cursor) break
  }

  // True total holder count (so the UI can show "N of TOTAL").
  let totalHolders = holders.length
  try {
    const hc = await moralisGet(`erc20/${addr}/holders?chain=${hex}`, key)
    totalHolders = hc.totalHolders ?? hc.total ?? hc.holders_count ?? totalHolders
  } catch (_) {}

  const nodeSet = new Set(holders.map(h => h.address))
  const edges = buildEdges(transfers, nodeSet)
  return { token, holders, edges, transfers, meta: { source: 'moralis', fetchedAt: Date.now(), totalHolders } }
}

// ── Solana holder graph (Helius DAS) ────────────────────────────────────────
async function solHolderGraph(addr, topN, key) {
  const rpc = `https://mainnet.helius-rpc.com/?api-key=${key}`

  let decimals = 0, supplyUi = 0
  const token = { address: addr, chain: 'sol', name: '', symbol: '', decimals: 0, priceUsd: null }
  try {
    const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: addr } }) })
    const j = await r.json()
    const ti = j?.result?.token_info || {}
    decimals = ti.decimals ?? 0
    token.decimals = decimals
    token.symbol = ti.symbol || j?.result?.content?.metadata?.symbol || ''
    token.name = j?.result?.content?.metadata?.name || ''
    token.priceUsd = ti.price_info?.price_per_token ?? null
    if (ti.supply != null) supplyUi = Number(ti.supply) / Math.pow(10, decimals)
  } catch (_) {}

  const ownerBal = new Map()
  for (let page = 1; page <= 8; page++) {
    let j
    try {
      const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccounts', params: { mint: addr, limit: 1000, page, options: { showZeroBalance: false } } }) })
      j = await r.json()
    } catch (_) { break }
    const accs = j?.result?.token_accounts || []
    if (!accs.length) break
    for (const a of accs) {
      const ui = Number(a.amount || 0) / Math.pow(10, decimals)
      ownerBal.set(a.owner, (ownerBal.get(a.owner) || 0) + ui)
    }
    if (accs.length < 1000) break
  }
  if (!supplyUi) supplyUi = [...ownerBal.values()].reduce((s, v) => s + v, 0)
  const totalHolders = ownerBal.size

  const holders = [...ownerBal.entries()]
    .map(([address, balance]) => ({ address, balance, pct: supplyUi ? (balance / supplyUi) * 100 : null, usdValue: token.priceUsd != null ? balance * token.priceUsd : null, isContract: false, label: '' }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, topN)

  // Probe the top holders' transfer history to map wallet-to-wallet links &
  // bundles. Batched to respect rate limits while covering more wallets.
  const nodeSet = new Set(holders.map(h => h.address))
  const transfers = []
  const probe = holders.slice(0, 40)
  for (let i = 0; i < probe.length; i += 10) {
    await Promise.allSettled(probe.slice(i, i + 10).map(async (h) => {
      try {
        const r = await fetch(`https://api.helius.xyz/v0/addresses/${h.address}/transactions?api-key=${key}&type=TRANSFER&limit=100`)
        if (!r.ok) return
        const txs = await r.json()
        for (const tx of (Array.isArray(txs) ? txs : [])) {
          for (const tt of (tx.tokenTransfers || [])) {
            if (tt.mint !== addr) continue
            transfers.push({ from: tt.fromUserAccount, to: tt.toUserAccount, value: tt.tokenAmount || 0, txHash: tx.signature, ts: tx.timestamp ? tx.timestamp * 1000 : 0 })
          }
        }
      } catch (_) {}
    }))
  }

  const edges = buildEdges(transfers, nodeSet)
  return { token, holders, edges, transfers, meta: { source: 'helius', fetchedAt: Date.now(), totalHolders } }
}

module.exports = { evmHolderGraph, solHolderGraph, buildEdges, MORALIS_CHAIN_HEX }

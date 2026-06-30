// payments.js — premium entitlement engine: billing config, plan granting,
// and on-chain crypto payment verification (EVM via Moralis, SOL via Helius).
// Stripe itself is handled in index.js (needs the secret at call time); this
// module holds the shared, provider-agnostic logic.
const axios = require('axios')

// Hardcoded admin allowlist fallback so the panel works before config/billing
// exists. Extendable via the config/billing doc's `adminEmails`.
const FALLBACK_ADMINS = ['pasmars978@gmail.com']

const DEFAULT_PRICES = { pro: 29, elite: 99 } // USD; one-time = 30 days, sub = monthly

// Canonical stablecoin contracts + decimals per chain.
const STABLECOINS = {
  eth:  { usdt: { addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7', dec: 6 },  usdc: { addr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', dec: 6 } },
  bsc:  { usdt: { addr: '0x55d398326f99059fF775485246999027B3197955', dec: 18 }, usdc: { addr: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', dec: 18 } },
  base: { usdc: { addr: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', dec: 6 } },
}
const NATIVE_CG = { eth: 'ethereum', base: 'ethereum', bsc: 'binancecoin', sol: 'solana' }
const MORALIS_HEX = { eth: '0x1', bsc: '0x38', base: '0x2105' }

// ── Billing config (admin-editable Firestore doc) ──
async function billingConfig(db) {
  let c = {}
  try { const snap = await db.doc('config/billing').get(); if (snap.exists) c = snap.data() || {} } catch (e) {}
  const adminEmails = [...new Set([...(c.adminEmails || []), ...FALLBACK_ADMINS].map((e) => String(e).toLowerCase()))]
  return {
    adminEmails,
    receiving: c.receivingAddresses || {},      // { eth, bsc, base, sol }
    prices: { ...DEFAULT_PRICES, ...(c.planPricesUsd || {}) },
    stripePriceIds: c.stripePriceIds || {},     // { proMonthly, eliteMonthly }
    frontendUrl: c.frontendUrl || 'https://fxcrypt-app.web.app',
    raw: c,
  }
}

function isAdminEmail(context, cfg) {
  const email = (context.auth && context.auth.token && context.auth.token.email || '').toLowerCase()
  return !!email && cfg.adminEmails.includes(email)
}

// Server-only entitlement write. plan: 'free'|'pro'|'elite'.
async function grantPlan(db, uid, plan, opts = {}) {
  const now = Date.now()
  const patch = { plan, planUpdatedAt: now }
  if (plan === 'free') patch.planExpiry = null
  else if (opts.durationDays) patch.planExpiry = now + opts.durationDays * 86400000
  else if (opts.clearExpiry) patch.planExpiry = null // active subscription = no fixed expiry
  if (opts.subscription) patch.subscription = opts.subscription
  await db.doc(`users/${uid}`).set(patch, { merge: true })
  return patch
}

// ── Crypto amount calc ──
function isStable(asset) { return asset === 'usdt' || asset === 'usdc' }

async function computeCryptoAmount(plan, chain, asset, prices) {
  const usd = prices[plan] || DEFAULT_PRICES[plan] || 29
  if (isStable(asset)) {
    const meta = (STABLECOINS[chain] || {})[asset]
    if (!meta) throw new Error(`${asset.toUpperCase()} not supported on ${chain.toUpperCase()}`)
    return { amountUsd: usd, amountToken: usd, tokenContract: meta.addr, decimals: meta.dec, symbol: asset.toUpperCase() }
  }
  // native: price via CoinGecko
  const id = NATIVE_CG[chain]
  let px = 0
  try { const r = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, { timeout: 10000 }); px = r.data?.[id]?.usd || 0 } catch (e) {}
  if (!px) throw new Error('Could not fetch native price; try a stablecoin instead')
  const sym = chain === 'bsc' ? 'BNB' : chain === 'sol' ? 'SOL' : 'ETH'
  return { amountUsd: usd, amountToken: +(usd / px).toFixed(6), tokenContract: null, decimals: chain === 'sol' ? 9 : 18, symbol: sym, nativePrice: px }
}

// ── On-chain verification ──
// Returns { paid: bool, txHash } — looks for an incoming transfer to `receiving`
// of >= amountToken (1% tolerance) since `sinceMs`.
async function verifyEvmPayment({ moralisKey, chain, receiving, asset, tokenContract, amountToken, sinceMs }) {
  if (!moralisKey) throw new Error('Moralis key not configured on the server')
  const hex = MORALIS_HEX[chain]
  if (!hex) throw new Error('Unsupported EVM chain')
  const need = amountToken * 0.99
  const headers = { 'X-API-Key': moralisKey }
  if (isStable(asset)) {
    const meta = (STABLECOINS[chain] || {})[asset]
    const url = `https://deep-index.moralis.io/api/v2.2/${receiving}/erc20/transfers?chain=${hex}&order=DESC&limit=100`
    const { data } = await axios.get(url, { headers, timeout: 15000 })
    for (const t of (data.result || [])) {
      if ((t.to_address || '').toLowerCase() !== receiving.toLowerCase()) continue
      if ((t.address || '').toLowerCase() !== meta.addr.toLowerCase()) continue
      const ts = t.block_timestamp ? Date.parse(t.block_timestamp) : 0
      if (ts < sinceMs - 60000) continue
      const val = Number(t.value || 0) / Math.pow(10, meta.dec)
      if (val >= need) return { paid: true, txHash: t.transaction_hash }
    }
    return { paid: false }
  }
  // native
  const url = `https://deep-index.moralis.io/api/v2.2/${receiving}?chain=${hex}&order=DESC&limit=100`
  const { data } = await axios.get(url, { headers, timeout: 15000 })
  for (const t of (data.result || [])) {
    if ((t.to_address || '').toLowerCase() !== receiving.toLowerCase()) continue
    const ts = t.block_timestamp ? Date.parse(t.block_timestamp) : 0
    if (ts < sinceMs - 60000) continue
    const val = Number(t.value || 0) / 1e18
    if (val >= need) return { paid: true, txHash: t.hash }
  }
  return { paid: false }
}

async function verifySolPayment({ heliusKey, receiving, asset, amountToken, sinceMs }) {
  if (!heliusKey) throw new Error('Helius key not configured on the server')
  if (isStable(asset)) throw new Error('SOL stablecoin payments not supported yet — pay with SOL')
  const need = amountToken * 0.99
  const url = `https://api.helius.xyz/v0/addresses/${receiving}/transactions?api-key=${heliusKey}&limit=100`
  const { data } = await axios.get(url, { timeout: 15000 })
  for (const tx of (data || [])) {
    const ts = (tx.timestamp || 0) * 1000
    if (ts < sinceMs - 60000) continue
    for (const nt of (tx.nativeTransfers || [])) {
      if (nt.toUserAccount !== receiving) continue
      const val = Number(nt.amount || 0) / 1e9
      if (val >= need) return { paid: true, txHash: tx.signature }
    }
  }
  return { paid: false }
}

async function verifyPayment(ctx, invoice) {
  const { chain, asset, address, amountToken, tokenContract, createdAt } = invoice
  if (chain === 'sol') return verifySolPayment({ heliusKey: ctx.heliusKey, receiving: address, asset, amountToken, sinceMs: createdAt })
  return verifyEvmPayment({ moralisKey: ctx.moralisKey, chain, receiving: address, asset, tokenContract, amountToken, sinceMs: createdAt })
}

module.exports = {
  billingConfig, isAdminEmail, grantPlan, computeCryptoAmount, verifyPayment,
  STABLECOINS, DEFAULT_PRICES, isStable,
}

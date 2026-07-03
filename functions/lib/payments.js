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
    // Usage metering + controls (admin-editable; metering.js reads via cfg.raw).
    pointerQuota: { free: 10, pro: 50, elite: 200, ...(c.pointerQuota || {}) },
    gemScanQuota: { free: 5, pro: 50, elite: 200, ...(c.gemScanQuota || {}) },
    creditPack: { usd: 10, credits: 50, ...(c.creditPack || {}) },
    autoTrade: { globalEnabled: true, defaultMaxBuyUsd: 100, defaultDailyTradeCap: 10, ...(c.autoTrade || {}) },
    referral: { enabled: true, rewardCredits: 25, ...(c.referral || {}) },
    // Per-plan trading fee % + the wallet that receives it on each chain. A
    // trade only gets charged when both the plan's % > 0 AND the chain wallet
    // is set (so fees stay off until the admin configures a receiving wallet).
    tradingFee: { free: 1.0, pro: 0.5, elite: 0.2, ...(c.tradingFee || {}) },
    feeWallets: { bsc: '', eth: '', base: '', sol: '', ...(c.feeWallets || {}) },
    raw: c,
  }
}

// Resolve the fee for a user's plan on a chain → { pct, bps, wallet } or null.
// Null means "no fee" (unset wallet, zero %, or bad config) — the trade runs
// normally without a fee leg.
function resolveTradeFee(cfg, plan, chain) {
  const p = ['free', 'pro', 'elite'].includes(plan) ? plan : 'free'
  const pct = Math.max(0, Math.min(parseFloat((cfg.tradingFee || {})[p]) || 0, 5)) // hard cap 5%
  const wallet = String((cfg.feeWallets || {})[chain] || '').trim()
  if (!wallet || pct <= 0) return null
  return { pct, bps: Math.round(pct * 100), wallet }
}

// ── Referral reward — called from EVERY successful-payment path ──
// Grants the referrer their reward exactly once per referee, on the referee's
// FIRST payment (anti-abuse: unpaid signups earn nothing, self-referrals are
// rejected, and the `referralRewarded` latch makes it idempotent across
// webhook retries).
async function processReferralReward(db, uid, cfg) {
  try {
    if (!cfg.referral.enabled) return null
    const reward = Math.max(0, parseInt(cfg.referral.rewardCredits) || 0)
    if (!reward) return null
    const userRef = db.doc(`users/${uid}`)
    const snap = await userRef.get()
    const d = snap.exists ? snap.data() : {}
    if (d.referralRewarded) return null                        // already rewarded (idempotent)
    const code = String(d.referredBy || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
    if (!code) return null
    const regSnap = await db.doc(`referralCodes/${code}`).get()
    const refUid = regSnap.exists ? regSnap.data().uid : null
    if (!refUid || refUid === uid) return null                  // unknown code or self-referral
    const admin = require('firebase-admin')
    const inc = admin.firestore.FieldValue.increment
    await db.runTransaction(async (t) => {
      const fresh = await t.get(userRef)
      if (fresh.exists && fresh.data().referralRewarded) return // raced webhook retry
      t.set(userRef, { referralRewarded: true, referredByUid: refUid }, { merge: true })
      t.set(db.doc(`users/${refUid}`), {
        pointerCredits: inc(reward),
        referralStats: { paid: inc(1), earnedCredits: inc(reward) },
      }, { merge: true })
    })
    return { refUid, reward }
  } catch (e) { console.warn(`referral reward failed for ${uid}:`, e.message); return null }
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
  processReferralReward, resolveTradeFee,
  STABLECOINS, DEFAULT_PRICES, isStable,
}

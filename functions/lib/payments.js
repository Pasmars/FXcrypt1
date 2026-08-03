// payments.js — premium entitlement engine: billing config, plan granting,
// and on-chain crypto payment verification (EVM via Moralis, SOL via Helius).
// Stripe itself is handled in index.js (needs the secret at call time); this
// module holds the shared, provider-agnostic logic.
const axios = require('axios')
const crypto = require('crypto')

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
    feeWallets: { bsc: '', eth: '', base: '', sol: '', rhood: '', ...(c.feeWallets || {}) },
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

// The allowlist is matched on the token's email — which is only trustworthy if
// the provider actually proved ownership of it. Email/password signup lets
// anyone self-assert ANY address, so without the email_verified check a stranger
// could register an allowlisted address and walk into the admin panel (which can
// rewrite the crypto receiving addresses, the fee wallets, and the allowlist
// itself). Google sign-in sets email_verified; password signup does not until
// the user completes verification.
function isAdminEmail(context, cfg) {
  const token = (context.auth && context.auth.token) || {}
  const email = (token.email || '').toLowerCase()
  if (!email || token.email_verified !== true) return false
  return cfg.adminEmails.includes(email)
}

// ── Pointer model entitlement by plan ───────────────────────────────────────
// Free plans run on DeepSeek only; paid plans (pro/elite) may use either DeepSeek
// or ChatGPT. This is an entitlement, so it is decided SERVER-SIDE on the caller's
// stored plan — a client asking for 'openai' on a free account is downgraded, not
// trusted, and it holds for automated runs (watch-tasks, digests) too.
const PAID_PLANS = ['pro', 'elite']

function pointerProvidersFor(plan) {
  return PAID_PLANS.includes(plan) ? ['deepseek', 'openai'] : ['deepseek']
}

// Resolve which provider a turn actually runs on.
//   plan      — the user's stored plan
//   requested — what the client asked for (may be undefined/absent)
//   cfg       — billingConfig(); cfg.raw.aiProvider is the admin default
// Returns { provider, allowed, downgraded } — `downgraded` is true when a paid-only
// model was asked for on a free plan, so the caller can surface an upsell.
function resolvePointerProvider({ plan, requested, cfg }) {
  const allowed = pointerProvidersFor(plan)
  const adminDefault = (cfg && cfg.raw && cfg.raw.aiProvider) === 'openai' ? 'openai' : 'deepseek'
  const want = requested === 'openai' || requested === 'deepseek' ? requested : null
  // Paid: honour an explicit choice, else the admin default.
  if (allowed.includes('openai')) return { provider: want || adminDefault, allowed, downgraded: false }
  // Free: always DeepSeek, whatever the client or the admin default says.
  return { provider: 'deepseek', allowed, downgraded: (want || adminDefault) === 'openai' }
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

// Every invoice gets its own slightly-unique amount. Two users buying the same
// plan on the same chain must NOT ask for the identical figure — otherwise one
// user's payment satisfies the other's invoice and a single transfer can be
// claimed by many accounts.
//
// `step` is the dust granularity, and it is also what makes the amounts
// *distinguishable*: the matcher accepts a payment only within step/4 of the
// invoiced figure, so two invoices (which always differ by at least one whole
// step) can never fall inside each other's window. It is chosen per asset —
// fine enough to cost the payer almost nothing, coarse enough to survive the
// token's decimal precision.
// DUST_SLOTS is the size of the space, and it has to be big: with only a few
// hundred slots, a few hundred live invoices collide by the birthday bound and
// the uniqueness buys nothing. 100k slots keeps expected collisions negligible
// at realistic concurrency while the dust stays trivial — ≤ $0.10 on a
// stablecoin, ≤ 0.0001 ETH/BNB/SOL on a native transfer.
const DUST_SLOTS  = 100000
const STABLE_STEP = 1e-6 // USDT/USDC have ≥6 decimals everywhere we accept them
const NATIVE_STEP = 1e-9 // SOL has 9 decimals; ETH/BNB have 18

function uniquify(amount, step) {
  const dp = Math.round(-Math.log10(step))
  return +(amount + crypto.randomInt(1, DUST_SLOTS + 1) * step).toFixed(dp)
}

async function computeCryptoAmount(plan, chain, asset, prices) {
  const usd = prices[plan] || DEFAULT_PRICES[plan] || 29
  if (isStable(asset)) {
    const meta = (STABLECOINS[chain] || {})[asset]
    if (!meta) throw new Error(`${asset.toUpperCase()} not supported on ${chain.toUpperCase()}`)
    return { amountUsd: usd, amountToken: uniquify(usd, STABLE_STEP), amountStep: STABLE_STEP, tokenContract: meta.addr, decimals: meta.dec, symbol: asset.toUpperCase() }
  }
  // native: price via CoinGecko
  const id = NATIVE_CG[chain]
  let px = 0
  try { const r = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, { timeout: 10000 }); px = r.data?.[id]?.usd || 0 } catch (e) {}
  if (!px) throw new Error('Could not fetch native price; try a stablecoin instead')
  const sym = chain === 'bsc' ? 'BNB' : chain === 'sol' ? 'SOL' : 'ETH'
  return { amountUsd: usd, amountToken: uniquify(+(usd / px).toFixed(6), NATIVE_STEP), amountStep: NATIVE_STEP, tokenContract: null, decimals: chain === 'sol' ? 9 : 18, symbol: sym, nativePrice: px }
}

// ── On-chain verification ──
// Returns { paid: bool, txHash } — looks for an incoming transfer to `receiving`
// that matches THIS invoice's amount since `sinceMs`.
//
// Two rules keep one payment from settling more than one invoice:
//   * the amount must land in a tight band around the invoice's unique figure
//     (see uniquify) instead of the old open-ended ">= 99% of the price", which
//     let any sufficiently large transfer satisfy every pending invoice; and
//   * `isSpent` rejects a tx hash already credited to some other invoice.
// Quarter of a dust step: wide enough to absorb float/decimal rounding, far
// narrower than the gap between any two invoices' amounts.
function amountMatches(val, want, step) {
  const tol = (step || STABLE_STEP) / 4
  return val >= want - tol && val <= want + tol
}

const notSpent = async () => false

async function verifyEvmPayment({ moralisKey, chain, receiving, asset, tokenContract, amountToken, amountStep, sinceMs, isSpent = notSpent }) {
  if (!moralisKey) throw new Error('Moralis key not configured on the server')
  const hex = MORALIS_HEX[chain]
  if (!hex) throw new Error('Unsupported EVM chain')
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
      if (amountMatches(val, amountToken, amountStep) && !(await isSpent(t.transaction_hash))) return { paid: true, txHash: t.transaction_hash }
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
    if (amountMatches(val, amountToken, amountStep) && !(await isSpent(t.hash))) return { paid: true, txHash: t.hash }
  }
  return { paid: false }
}

async function verifySolPayment({ heliusKey, receiving, asset, amountToken, amountStep, sinceMs, isSpent = notSpent }) {
  if (!heliusKey) throw new Error('Helius key not configured on the server')
  if (isStable(asset)) throw new Error('SOL stablecoin payments not supported yet — pay with SOL')
  const url = `https://api.helius.xyz/v0/addresses/${receiving}/transactions?api-key=${heliusKey}&limit=100`
  const { data } = await axios.get(url, { timeout: 15000 })
  for (const tx of (data || [])) {
    const ts = (tx.timestamp || 0) * 1000
    if (ts < sinceMs - 60000) continue
    for (const nt of (tx.nativeTransfers || [])) {
      if (nt.toUserAccount !== receiving) continue
      const val = Number(nt.amount || 0) / 1e9
      if (amountMatches(val, amountToken, amountStep) && !(await isSpent(tx.signature))) return { paid: true, txHash: tx.signature }
    }
  }
  return { paid: false }
}

async function verifyPayment(ctx, invoice) {
  const { chain, asset, address, amountToken, tokenContract, createdAt } = invoice
  const isSpent = ctx.isSpent || notSpent
  // Invoices issued before per-invoice amounts existed carry no step; fall back
  // to the asset default so they still verify.
  const amountStep = invoice.amountStep || (isStable(asset) ? STABLE_STEP : NATIVE_STEP)
  if (chain === 'sol') return verifySolPayment({ heliusKey: ctx.heliusKey, receiving: address, asset, amountToken, amountStep, sinceMs: createdAt, isSpent })
  return verifyEvmPayment({ moralisKey: ctx.moralisKey, chain, receiving: address, asset, tokenContract, amountToken, amountStep, sinceMs: createdAt, isSpent })
}

// Resolve the trading fee for a user on a chain, loading the billing config and
// (if not already to hand) their plan. For the automated paths — gem auto-buy,
// sniper, agent, copy-trade, auto-exit, Telegram — which have no billing config
// in scope the way the manual callable does.
//
// Returns null on any failure. A fee is a side-effect of the trade, never a
// precondition: a Firestore hiccup reading config must not stop someone's
// stop-loss from firing. Null is the same "no fee leg" the traders already
// handle when the fee is unconfigured.
async function tradeFeeFor(db, uid, chain, userData) {
  try {
    const cfg = await billingConfig(db)
    let plan = userData && userData.plan
    if (!plan) {
      const snap = await db.doc(`users/${uid}`).get()
      plan = snap.exists ? (snap.data() || {}).plan : 'free'
    }
    return resolveTradeFee(cfg, plan, chain)
  } catch (e) { return null }
}

// ── Fee disclosure ──
// One line naming what was actually taken, for trade confirmations (Telegram
// messages and push notifications). Reads the fee off the trade RESULT, not the
// config, so it reports the amount genuinely charged: a fee leg that was
// skipped or failed reports nothing rather than claiming a charge that never
// happened. Returns '' when no fee was taken, so callers can concatenate it
// unconditionally.
const FEE_SYM = { bsc: 'BNB', eth: 'ETH', base: 'ETH', rhood: 'ETH', matic: 'MATIC', sol: 'SOL', ton: 'TON' }
function feeLine(feeCfg, result, chain) {
  const n = parseFloat(result && result.feeNative)
  if (!(n > 0)) return ''
  // Trim trailing zeros but keep small fees legible (wei-scale strings).
  const amount = n < 1e-6 ? n.toExponential(2) : String(+n.toFixed(8))
  const sym = FEE_SYM[chain] || ''
  // Joined rather than interpolated so an unknown chain (no ticker) does not
  // leave a double space in the middle of the line.
  const head = ['Platform fee:', amount, sym].filter(Boolean).join(' ')
  return feeCfg && feeCfg.pct != null ? `${head} (${feeCfg.pct}%)` : head
}

// ── Trading-fee revenue rollup ──
// Pure: the caller supplies already-read trade rows and the clock, so the
// reporting maths is testable on its own and the callable stays I/O only.
// A row is { feeNative, chain, at, feePct, type, txHash, uid }; rows without a
// positive fee leg (the vast majority — only fee-charging trades have one) are
// skipped entirely.
function aggregateTradeFees(rows, now) {
  const t0 = now || Date.now()
  const windows = { h24: t0 - 86400000, d7: t0 - 7 * 86400000, d30: t0 - 30 * 86400000 }
  const byChain = {}
  const totals = { all: {}, h24: {}, d7: {}, d30: {} }
  const recent = []
  let feeTrades = 0
  for (const t of rows || []) {
    const native = parseFloat(t.feeNative)
    if (!(native > 0)) continue
    const chain = t.chain || 'unknown'
    const at = Number(t.at) || 0
    feeTrades++
    byChain[chain] = byChain[chain] || { native: 0, count: 0 }
    byChain[chain].native += native
    byChain[chain].count++
    totals.all[chain] = (totals.all[chain] || 0) + native
    for (const w of Object.keys(windows)) {
      if (at >= windows[w]) totals[w][chain] = (totals[w][chain] || 0) + native
    }
    recent.push({ chain, native, at, pct: t.feePct != null ? t.feePct : null, type: t.type || '', txHash: t.txHash || '', uid: t.uid || null })
  }
  recent.sort((a, b) => b.at - a.at)
  return { byChain, totals, feeTrades, recent }
}

// Value a { chain -> nativeAmount } map in USD. Unknown/unpriced chains
// contribute 0 rather than NaN, so one missing price cannot void the total.
function feeUsd(map, px) {
  let sum = 0
  for (const c of Object.keys(map || {})) sum += (map[c] || 0) * ((px || {})[c] || 0)
  return +sum.toFixed(2)
}

module.exports = {
  billingConfig, isAdminEmail, grantPlan, computeCryptoAmount, verifyPayment,
  pointerProvidersFor, resolvePointerProvider,
  processReferralReward, resolveTradeFee, tradeFeeFor, feeLine, aggregateTradeFees, feeUsd,
  STABLECOINS, DEFAULT_PRICES, isStable,
}

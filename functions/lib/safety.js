/**
 * Multi-layer token safety filter.
 * Runs BEFORE the scoring engine so only clean tokens are ever scored.
 *
 * Layers:
 *   EVM (BSC/ETH) — GoPlus Security (batch) + Honeypot.is (individual, BSC only)
 *   Solana        — GoPlus Solana  (batch) + RugCheck.xyz (individual)
 *
 * A token is rejected if:
 *   • Any API returns a hard-fail flag (honeypot, hidden owner, dangerous mint, etc.)
 *   • OR the combined soft risk score reaches the RISK_THRESHOLD
 *
 * If ALL APIs are unreachable for a token it passes with riskLevel = 'UNVERIFIED'.
 * This prevents a temporary outage from zeroing out the scanner.
 */

const axios = require('axios')

const TIMEOUT        = 10000
const GOPLUS_BASE    = 'https://api.gopluslabs.io/api/v1'
const HONEYPOT_API   = 'https://api.honeypot.is/v2/IsHoneypot'
const RUGCHECK_BASE  = 'https://api.rugcheck.xyz/v1'
const RISK_THRESHOLD = 70   // soft risk points at which a token is rejected
const HP_CONCUR      = 5    // max concurrent Honeypot.is / RugCheck requests

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Concurrency-limited map ───────────────────────────────────────────────
async function concurrentMap(items, fn, limit = HP_CONCUR) {
  const out = []
  for (let i = 0; i < items.length; i += limit) {
    const chunk = await Promise.all(items.slice(i, i + limit).map(fn))
    out.push(...chunk)
    if (i + limit < items.length) await delay(200)
  }
  return out
}

// ── GoPlus EVM batch (BSC chain_id=56, ETH chain_id=1) ───────────────────
async function batchGoPlusEVM(addresses, chainId) {
  const out = {}
  const BATCH = 50
  for (let i = 0; i < addresses.length; i += BATCH) {
    const chunk = addresses.slice(i, i + BATCH).join(',')
    try {
      const { data } = await axios.get(
        `${GOPLUS_BASE}/token_security/${chainId}`,
        { params: { contract_addresses: chunk }, timeout: TIMEOUT }
      )
      Object.assign(out, data?.result || {})
    } catch (e) {
      console.warn('[Safety] GoPlus EVM batch failed:', e.message)
    }
    if (i + BATCH < addresses.length) await delay(400)
  }
  return out
}

// ── GoPlus Solana batch ───────────────────────────────────────────────────
async function batchGoPlusSOL(addresses) {
  const out = {}
  const BATCH = 50
  for (let i = 0; i < addresses.length; i += BATCH) {
    const chunk = addresses.slice(i, i + BATCH).join(',')
    try {
      const { data } = await axios.get(
        `${GOPLUS_BASE}/solana/token_security`,
        { params: { contract_addresses: chunk }, timeout: TIMEOUT }
      )
      Object.assign(out, data?.result || {})
    } catch (e) {
      console.warn('[Safety] GoPlus SOL batch failed:', e.message)
    }
    if (i + BATCH < addresses.length) await delay(400)
  }
  return out
}

// ── Honeypot.is (EVM — BSC chainId=56, Base chainId=8453) ────────────────
async function checkHoneypotIs(address, chainId = 56) {
  try {
    const { data } = await axios.get(HONEYPOT_API, {
      params: { address, chainID: chainId },
      timeout: TIMEOUT,
    })
    const hp  = data.honeypotResult  || {}
    const sim = data.simulationResult || {}
    return {
      isHoneypot:   hp.isHoneypot === true,
      buyTax:       (sim.buyTax  != null && isFinite(parseFloat(sim.buyTax)))  ? parseFloat(sim.buyTax)  : null,
      sellTax:      (sim.sellTax != null && isFinite(parseFloat(sim.sellTax))) ? parseFloat(sim.sellTax) : null,
      isOpenSource: data.contractCode?.openSource === true,
    }
  } catch {
    return null
  }
}

// ── RugCheck.xyz (Solana individual) ──────────────────────────────────────
async function checkRugCheck(mintAddress) {
  try {
    const { data } = await axios.get(
      `${RUGCHECK_BASE}/tokens/${mintAddress}/report/summary`,
      { timeout: TIMEOUT }
    )
    return data
  } catch {
    return null
  }
}

// ── Evaluate GoPlus EVM result ────────────────────────────────────────────
function evalGoPlusEVM(r) {
  if (!r) return { hardFail: false, riskScore: 0, flags: [], available: false }

  // NaN-safe: GoPlus often returns '' for missing fields, and parseFloat('') is
  // NaN — which later breaks JSON encoding of the gem result. Coerce to 0.
  const n = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0 }
  const flags    = []
  let hardFail   = false
  let riskScore  = 0

  // Hard fails — immediate rejection
  if (r.is_honeypot === '1')             { hardFail = true; flags.push('Honeypot detected') }
  if (n(r.buy_tax)  > 15)                { hardFail = true; flags.push(`Buy tax ${n(r.buy_tax).toFixed(1)}%`) }
  if (n(r.sell_tax) > 15)                { hardFail = true; flags.push(`Sell tax ${n(r.sell_tax).toFixed(1)}%`) }
  if (r.hidden_owner === '1')            { hardFail = true; flags.push('Hidden owner') }
  if (r.can_take_back_ownership === '1') { hardFail = true; flags.push('Owner can be reclaimed') }

  // Soft risk scoring
  if (r.is_open_source !== '1')          riskScore += 30   // unverified contract
  if (r.is_mintable === '1')             riskScore += 20
  if (r.is_proxy === '1')                riskScore += 15
  if (n(r.owner_percent) > 40)           riskScore += 25
  else if (n(r.owner_percent) > 20)      riskScore += 15
  if (r.is_blacklisted === '1')          riskScore += 20
  if (r.is_whitelisted === '1')          riskScore += 10
  if (n(r.buy_tax)  > 5)                 riskScore += 10
  if (n(r.sell_tax) > 5)                 riskScore += 15
  if (n(r.holder_count) > 0 && n(r.holder_count) < 30)  riskScore += 25
  else if (n(r.holder_count) < 100)      riskScore += 10

  return {
    hardFail,
    riskScore,
    flags,
    available:    true,
    buyTax:       n(r.buy_tax),
    sellTax:      n(r.sell_tax),
    holderCount:  n(r.holder_count),
    isOpenSource: r.is_open_source === '1',
    isMintable:   r.is_mintable    === '1',
    ownerPercent: n(r.owner_percent),
  }
}

// ── Evaluate GoPlus Solana result ─────────────────────────────────────────
function evalGoPlusSOL(r) {
  if (!r) return { hardFail: false, riskScore: 0, flags: [], available: false }

  const flags   = []
  let hardFail  = false
  let riskScore = 0

  if (r.closable === '1')          { hardFail = true; flags.push('Mint can be closed') }
  if (r.freezable === '1')           riskScore += 30
  if (r.mintable  === '1')           riskScore += 30
  if (r.metadata_mutable === '1')    riskScore += 15

  const feeBps = parseFloat(r.transfer_fee_data?.transfer_fee_basis_points ?? '0')
  const feePct = feeBps / 100
  if (feePct > 10)  { hardFail = true; flags.push(`Transfer fee ${feePct.toFixed(1)}%`) }
  else if (feePct > 5) riskScore += 20
  else if (feePct > 2) riskScore += 10

  return { hardFail, riskScore, flags, available: true, transferFeePct: feePct }
}

// ── Evaluate RugCheck.xyz Solana result ───────────────────────────────────
function evalRugCheck(r) {
  if (!r) return { hardFail: false, riskScore: 0, flags: [], available: false }

  const risks       = r.risks || []
  const danger      = risks.filter((x) => x.level === 'danger')
  const warn        = risks.filter((x) => x.level === 'warn')
  const rugScore    = r.score || 0   // 0 = safe, higher = risky
  const flags       = []
  let hardFail      = false
  let riskScore     = 0

  if (danger.length > 0) {
    hardFail = true
    flags.push(...danger.map((x) => `RugCheck: ${x.name}`))
  }
  if (rugScore > 700) { hardFail = true; flags.push(`RugCheck score ${rugScore}`) }
  else if (rugScore > 300) riskScore += 25

  riskScore += warn.length * 12

  return { hardFail, riskScore, flags, available: true, rugScore }
}

// ── Evaluate Honeypot.is result ───────────────────────────────────────────
function evalHoneypotIs(r) {
  if (!r) return { hardFail: false, riskScore: 0, flags: [], available: false }

  const flags  = []
  let hardFail = false
  let riskScore = 0

  if (r.isHoneypot === true) { hardFail = true; flags.push('Honeypot.is: honeypot') }
  const st = r.sellTax ?? 0
  const bt = r.buyTax  ?? 0
  if (st > 15) { hardFail = true; flags.push(`Honeypot.is: sell tax ${st}%`) }
  else if (st > 5)  riskScore += 15
  if (bt > 5)       riskScore += 10

  return {
    hardFail,
    riskScore,
    flags,
    available:    true,
    buyTax:       bt,
    sellTax:      st,
    isOpenSource: r.isOpenSource ?? null,
  }
}

// ── Main: batch safety filter ─────────────────────────────────────────────
// Input:  candidates[] = [{ address, ...anything }]
// Output: passing candidates with `.safetyData` attached
async function filterSafeTokens(candidates, chain) {
  if (!candidates.length) return []

  const addresses = candidates.map((c) => c.address)

  // ── Fetch all data in parallel ────────────────────────────────────────
  const gpChainId = chain === 'bsc'  ? '56'
    : chain === 'eth'  ? '1'
    : chain === 'base' ? '8453'
    : null

  const hpChainId = chain === 'base' ? 8453 : 56

  const [gpBatch, hpResults, rcResults] = await Promise.all([
    gpChainId
      ? batchGoPlusEVM(addresses, gpChainId)
      : chain === 'sol' ? batchGoPlusSOL(addresses) : Promise.resolve({}),
    (chain === 'bsc' || chain === 'base')
      ? concurrentMap(addresses, (a) => checkHoneypotIs(a, hpChainId))
      : Promise.resolve(addresses.map(() => null)),
    chain === 'sol'
      ? concurrentMap(addresses, checkRugCheck)
      : Promise.resolve(addresses.map(() => null)),
  ])

  // Index individual results by address (lowercase)
  const hpMap = {}
  const rcMap = {}
  addresses.forEach((a, i) => {
    hpMap[a.toLowerCase()] = hpResults[i]
    rcMap[a.toLowerCase()] = rcResults[i]
  })

  const passed  = []
  let   total   = 0
  let   rejected = 0

  for (const candidate of candidates) {
    total++
    const key = candidate.address.toLowerCase()

    const gpRaw = gpBatch[key] || gpBatch[candidate.address] || null
    const hpRaw = hpMap[key]   || null
    const rcRaw = rcMap[key]   || null

    // Evaluate each layer
    const evGP = chain === 'sol' ? evalGoPlusSOL(gpRaw) : evalGoPlusEVM(gpRaw)
    const evHP = evalHoneypotIs(hpRaw)
    const evRC = evalRugCheck(rcRaw)

    const anyApiReached = evGP.available || evHP.available || evRC.available
    const hardFailed    = evGP.hardFail  || evHP.hardFail  || evRC.hardFail
    const combinedRisk  = evGP.riskScore + evHP.riskScore  + evRC.riskScore
    const allFlags      = [...evGP.flags, ...evHP.flags, ...evRC.flags]

    if (hardFailed || (anyApiReached && combinedRisk >= RISK_THRESHOLD)) {
      rejected++
      console.log(
        `[Safety] FAIL ${candidate.address} (${chain}) — ` +
        (allFlags.length ? allFlags.join(', ') : `risk=${combinedRisk}`)
      )
      continue
    }

    // Determine risk level label
    const riskLevel = !anyApiReached
      ? 'UNVERIFIED'
      : combinedRisk >= 45 ? 'MEDIUM'
      : 'LOW'

    // Merge the best tax data from whichever source provided it
    const buyTax  = evGP.buyTax  ?? evHP.buyTax  ?? null
    const sellTax = evGP.sellTax ?? evHP.sellTax ?? null

    candidate.safetyData = {
      riskLevel,
      riskScore:    combinedRisk,
      flags:        allFlags,
      buyTax,
      sellTax,
      isOpenSource: evGP.isOpenSource ?? evHP.isOpenSource ?? null,
      isMintable:   evGP.isMintable ?? null,
      holderCount:  evGP.holderCount ?? null,
      ownerPercent: evGP.ownerPercent ?? null,
      rugScore:     evRC.rugScore ?? null,
      transferFee:  evGP.transferFeePct ?? null,
      gpChecked:    evGP.available,
      hpChecked:    evHP.available,
      rcChecked:    evRC.available,
    }

    passed.push(candidate)
  }

  console.log(
    `[Safety] ${chain.toUpperCase()}: ${total} candidates → ` +
    `${passed.length} passed, ${rejected} rejected`
  )
  return passed
}

module.exports = { filterSafeTokens, checkHoneypotIs, checkRugCheck }

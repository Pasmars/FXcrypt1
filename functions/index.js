const functions      = require('firebase-functions')
const { defineSecret } = require('firebase-functions/params')
const admin          = require('firebase-admin')
const crypto         = require('crypto')
admin.initializeApp()

const db             = admin.firestore()
const encryption     = require('./lib/encryption')
const trader         = require('./lib/trader')
const tg             = require('./lib/telegram')
const arbitrage      = require('./lib/arbitrage')
const gemscanner     = require('./lib/gemscanner')
const marketAnalyzer = require('./lib/market-analyzer')
const { scanFuturesExchange } = marketAnalyzer
const cexTrader      = require('./lib/cex-trader')
const signalGen      = require('./lib/signal-generator')
const agentLib       = require('./lib/agent')
const discordLib     = require('./lib/discord')
const payments       = require('./lib/payments')
const metering       = require('./lib/metering')
const positions      = require('./lib/positions')
const signalTracker  = require('./lib/signal-tracker')
const gemTracker     = require('./lib/gem-tracker')
const notify         = require('./lib/notify')
const copytrader     = require('./lib/copytrader')
const crypto2        = require('crypto')

const DISCORD_TOPIC = 'fxcrypt-discord-jobs'

// ── Secrets (Cloud Secret Manager) ────────────────────────────────────────
// Set values once with:
//   firebase functions:secrets:set BOT_SECRET
//   firebase functions:secrets:set TELEGRAM_TOKEN
//   firebase functions:secrets:set MORALIS_API_KEY
//   firebase functions:secrets:set HELIUS_API_KEY
const SECRET_BOT     = defineSecret('BOT_SECRET')
const SECRET_TG      = defineSecret('TELEGRAM_TOKEN')
const SECRET_MORALIS = defineSecret('MORALIS_API_KEY')
const SECRET_HELIUS  = defineSecret('HELIUS_API_KEY')
const ALL_SECRETS = [SECRET_BOT, SECRET_TG, SECRET_MORALIS, SECRET_HELIUS]

// Discord AI agent secrets (set with: firebase functions:secrets:set <NAME>)
const SECRET_DEEPSEEK       = defineSecret('DEEPSEEK_API_KEY')    // DeepSeek (open-source) key
const SECRET_OPENAI         = defineSecret('OPENAI_API_KEY')      // OpenAI / ChatGPT key
const SECRET_DISCORD_PUBKEY = defineSecret('DISCORD_PUBLIC_KEY')  // app public key (verify signatures)
const SECRET_DISCORD_APPID  = defineSecret('DISCORD_APP_ID')      // application id (for followups)
const DISCORD_SECRETS = [...ALL_SECRETS, SECRET_DEEPSEEK, SECRET_OPENAI, SECRET_DISCORD_PUBKEY, SECRET_DISCORD_APPID]

// Billing secrets (set with: firebase functions:secrets:set <NAME>)
const SECRET_STRIPE     = defineSecret('STRIPE_SECRET_KEY')     // sk_live_… / sk_test_…
const SECRET_STRIPE_WH  = defineSecret('STRIPE_WEBHOOK_SECRET') // whsec_…
const BILLING_SECRETS   = [SECRET_STRIPE, SECRET_STRIPE_WH]
// Crypto verification reuses the existing Moralis/Helius keys.
const CRYPTO_PAY_SECRETS = [SECRET_MORALIS, SECRET_HELIUS]


// Pre-bound function builder — europe-west1 avoids Binance geo-block (HTTP 451) on GCP us-central1
const fn = functions.region('europe-west1').runWith({ secrets: ALL_SECRETS })
const discordFn = functions.region('europe-west1').runWith({ secrets: DISCORD_SECRETS, timeoutSeconds: 120 })

// Fail fast if secrets not configured — prevents silently using weak defaults
const MASTER_SECRET = () => {
  const s = SECRET_BOT.value()
  if (!s) throw new functions.https.HttpsError('internal', 'BOT_SECRET not set. Run: firebase functions:secrets:set BOT_SECRET')
  return s
}
const TG_TOKEN = () => {
  const t = SECRET_TG.value()
  if (!t) throw new Error('TELEGRAM_TOKEN not set. Run: firebase functions:secrets:set TELEGRAM_TOKEN')
  return t
}

// ── Input validators ───────────────────────────────────────────────────────
const VALID_CHAINS = new Set(['bsc', 'eth', 'sol', 'base', 'ton'])

function validateChain(chain) {
  if (!VALID_CHAINS.has(chain))
    throw new functions.https.HttpsError('invalid-argument', 'Chain must be bsc, eth, sol, base, or ton')
}

function validateAddress(chain, address) {
  if (typeof address !== 'string' || !address.trim())
    throw new functions.https.HttpsError('invalid-argument', 'Address is required')
  const isEvm = chain === 'bsc' || chain === 'eth' || chain === 'base'
  if (isEvm && !/^0x[0-9a-fA-F]{40}$/.test(address))
    throw new functions.https.HttpsError('invalid-argument', 'Invalid EVM address format')
  if (chain === 'sol' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    throw new functions.https.HttpsError('invalid-argument', 'Invalid Solana address format')
  if (chain === 'ton' && !/^[A-Za-z0-9_+/=-]{48}$/.test(address) && !/^0:[0-9a-fA-F]{64}$/.test(address))
    throw new functions.https.HttpsError('invalid-argument', 'Invalid TON address format')
}

function validateSlippage(slip) {
  const n = parseFloat(slip)
  if (!isFinite(n) || n < 0.1 || n > 50)
    throw new functions.https.HttpsError('invalid-argument', 'Slippage must be between 0.1% and 50%')
  return n
}

function validateAmount(amount) {
  const n = parseFloat(amount)
  if (!isFinite(n) || n <= 0)
    throw new functions.https.HttpsError('invalid-argument', 'Amount must be a positive number')
  return n
}

function validatePercent(percent) {
  const n = parseInt(percent, 10)
  if (!isFinite(n) || n < 1 || n > 100)
    throw new functions.https.HttpsError('invalid-argument', 'Percent must be between 1 and 100')
  return n
}

// ── Get Token Holders (backend API key — no per-user key needed) ──────────
exports.getTokenHolders = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const { chain, contractAddress } = data
  validateChain(chain)
  if (typeof contractAddress !== 'string' || !contractAddress.trim())
    throw new functions.https.HttpsError('invalid-argument', 'contractAddress is required')

  const addr = contractAddress.trim()

  if (chain === 'sol') {
    const heliusKey = SECRET_HELIUS.value()
    if (!heliusKey) return { holders: null }
    try {
      const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: addr } })
      })
      if (!res.ok) return { holders: null }
      const json = await res.json()
      const holders = json?.result?.token_info?.holder_count
      return { holders: holders != null ? parseInt(holders, 10) : null }
    } catch (_) { return { holders: null } }
  }

  // EVM — try Moralis first, then Ethplorer for ETH
  const moralisKey = SECRET_MORALIS.value()
  if (moralisKey) {
    const chainHex = chain === 'bsc' ? '0x38' : '0x1'
    try {
      const res = await fetch(
        `https://deep-index.moralis.io/api/v2.2/erc20/${addr}/holders?chain=${chainHex}`,
        { headers: { 'X-API-Key': moralisKey } }
      )
      if (res.ok) {
        const json = await res.json()
        const count = json.totalHolders ?? json.holders_count ?? json.owners_count
        if (count != null) return { holders: parseInt(count, 10) }
      }
    } catch (_) {}
  }
  if (chain === 'eth') {
    try {
      const res = await fetch(`https://api.ethplorer.io/getTokenInfo/${addr}?apiKey=freekey`)
      if (res.ok) {
        const json = await res.json()
        if (json.holdersCount != null) return { holders: parseInt(json.holdersCount, 10) }
      }
    } catch (_) {}
  }
  return { holders: null }
})

// ── Get Wallet Tokens (backend API key — no per-user key needed) ──────────
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

exports.getWalletTokens = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const { chain, address } = data
  validateChain(chain)
  validateAddress(chain, address)

  const addr = address.trim()

  if (chain === 'sol') {
    const heliusKey = SECRET_HELIUS.value()
    if (!heliusKey)
      throw new functions.https.HttpsError('failed-precondition', 'Solana RPC not configured on the backend.')
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [addr, { programId: TOKEN_PROGRAM_ID }, { encoding: 'jsonParsed' }]
      })
    })
    if (!res.ok) throw new functions.https.HttpsError('internal', `Solana RPC error: ${res.status}`)
    const json = await res.json()
    if (json.error) throw new functions.https.HttpsError('internal', `Solana RPC: ${json.error.message}`)
    const tokens = json.result.value
      .map(a => {
        const info = a.account.data.parsed.info
        return { mint: info.mint, balance: info.tokenAmount.uiAmount, decimals: info.tokenAmount.decimals }
      })
      .filter(t => t.balance > 0)
    return { tokens }
  }

  // EVM
  const moralisKey = SECRET_MORALIS.value()
  if (!moralisKey)
    throw new functions.https.HttpsError('failed-precondition', 'Wallet tracking API not configured on the backend.')

  const chainHex = chain === 'bsc' ? '0x38' : '0x1'
  const moralisRes = await fetch(
    `https://deep-index.moralis.io/api/v2.2/${addr}/erc20?chain=${chainHex}`,
    { headers: { 'X-API-Key': moralisKey } }
  )
  if (!moralisRes.ok) {
    const err = await moralisRes.json().catch(() => ({}))
    throw new functions.https.HttpsError('internal', err.message || `Moralis error: ${moralisRes.status}`)
  }
  const json = await moralisRes.json()
  if (!Array.isArray(json)) throw new functions.https.HttpsError('internal', 'Unexpected response from Moralis.')

  const raw = json.filter(t => parseFloat(t.balance) > 0)

  // Moralis price data is null for most tokens — enrich with DexScreener prices
  const dsChain = chain === 'bsc' ? 'bsc' : 'ethereum'
  const BATCH = 30
  const pairMap = {}
  for (let i = 0; i < raw.length; i += BATCH) {
    const chunk = raw.slice(i, i + BATCH).map(t => t.token_address).join(',')
    try {
      const dsRes = await fetch(`https://api.dexscreener.com/tokens/v1/${dsChain}/${chunk}`)
      if (dsRes.ok) {
        const pairs = await dsRes.json()
        if (Array.isArray(pairs)) {
          for (const p of pairs) {
            const a = p.baseToken?.address?.toLowerCase()
            if (a && (!pairMap[a] || (p.liquidity?.usd || 0) > (pairMap[a].liquidity?.usd || 0))) {
              pairMap[a] = p
            }
          }
        }
      }
    } catch (_) {}
  }

  const tokens = raw.map(t => {
    const bal = parseFloat(t.balance) / Math.pow(10, parseInt(t.decimals || 18))
    const pair = pairMap[t.token_address.toLowerCase()]
    const priceUsd = t.usd_price != null ? t.usd_price
      : (pair?.priceUsd ? parseFloat(pair.priceUsd) : null)
    const change24h = t.usd_price_24hr_percent_change ?? (pair?.priceChange?.h24 ?? null)
    return {
      symbol: t.symbol || pair?.baseToken?.symbol || '',
      name: t.name || pair?.baseToken?.name || '',
      contractAddress: t.token_address,
      balance: bal,
      priceUsd,
      change24h,
      usdValue: priceUsd != null ? bal * priceUsd : null
    }
  })
  return { tokens }
})

// ════════════════════════════════════════════════════════════════════════════
// BUBBLE MAP — holder graph + transfer edges (live, no cache)
// ════════════════════════════════════════════════════════════════════════════
const MORALIS_CHAIN_HEX = { eth: '0x1', bsc: '0x38', base: '0x2105' }

async function moralisGet(path, key) {
  const res = await fetch(`https://deep-index.moralis.io/api/v2.2/${path}`, {
    headers: { 'X-API-Key': key, accept: 'application/json' }
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new functions.https.HttpsError('internal', err.message || `Moralis error: ${res.status}`)
  }
  return res.json()
}

// Build aggregated edges from a flat transfer list, keeping only those where
// both endpoints are in `nodeSet` (Set of lowercased addresses).
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

  // Token metadata + price (one call)
  let token = { address: addr, chain, name: '', symbol: '', decimals: 18, priceUsd: null }
  try {
    const price = await moralisGet(`erc20/${addr}/price?chain=${hex}`, key)
    token.priceUsd = price.usdPrice ?? null
    token.name     = price.tokenName || ''
    token.symbol   = price.tokenSymbol || ''
    token.decimals = price.tokenDecimals != null ? parseInt(price.tokenDecimals, 10) : 18
  } catch (_) {}

  // Top holders (paginate, 100/page, up to topN)
  const holders = []
  let cursor = ''
  for (let page = 0; page < 3 && holders.length < topN; page++) {
    const q = `erc20/${addr}/owners?chain=${hex}&order=DESC&limit=100${cursor ? `&cursor=${cursor}` : ''}`
    let json
    try { json = await moralisGet(q, key) } catch (e) { if (page === 0) throw e; break }
    const rows = json.result || []
    for (const r of rows) {
      const balance = parseFloat(r.balance_formatted ?? r.balance ?? 0)
      holders.push({
        address: (r.owner_address || '').toLowerCase(),
        balance,
        pct: r.percentage_relative_to_total_supply != null
          ? parseFloat(r.percentage_relative_to_total_supply) : null,
        usdValue: r.usd_value != null ? parseFloat(r.usd_value)
          : (token.priceUsd != null ? balance * token.priceUsd : null),
        isContract: !!r.is_contract,
        label: r.owner_address_label || r.entity || ''
      })
      if (holders.length >= topN) break
    }
    cursor = json.cursor || ''
    if (!cursor) break
  }

  // Recent transfer sample (up to 3 pages = ~300)
  const transfers = []
  cursor = ''
  for (let page = 0; page < 3; page++) {
    const q = `erc20/${addr}/transfers?chain=${hex}&order=DESC&limit=100${cursor ? `&cursor=${cursor}` : ''}`
    let json
    try { json = await moralisGet(q, key) } catch (_) { break }
    for (const r of (json.result || [])) {
      transfers.push({
        from: r.from_address, to: r.to_address,
        value: parseFloat(r.value_decimal ?? 0),
        txHash: r.transaction_hash,
        ts: r.block_timestamp ? Date.parse(r.block_timestamp) : 0
      })
    }
    cursor = json.cursor || ''
    if (!cursor) break
  }

  const nodeSet = new Set(holders.map(h => h.address))
  const edges = buildEdges(transfers, nodeSet)
  return { token, holders, edges, transfers, meta: { source: 'moralis', fetchedAt: Date.now() } }
}

// ── Solana holder graph (Helius) ────────────────────────────────────────────
async function solHolderGraph(addr, topN, key) {
  const rpc = `https://mainnet.helius-rpc.com/?api-key=${key}`

  // Asset meta (decimals, supply, price)
  let decimals = 0, supplyUi = 0
  const token = { address: addr, chain: 'sol', name: '', symbol: '', decimals: 0, priceUsd: null }
  try {
    const r = await fetch(rpc, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: addr } })
    })
    const j = await r.json()
    const ti = j?.result?.token_info || {}
    decimals = ti.decimals ?? 0
    token.decimals = decimals
    token.symbol = ti.symbol || j?.result?.content?.metadata?.symbol || ''
    token.name = j?.result?.content?.metadata?.name || ''
    token.priceUsd = ti.price_info?.price_per_token ?? null
    if (ti.supply != null) supplyUi = Number(ti.supply) / Math.pow(10, decimals)
  } catch (_) {}

  // Holders via DAS getTokenAccounts (aggregate by owner)
  const ownerBal = new Map()
  let page = 1
  for (; page <= 5; page++) {
    let j
    try {
      const r = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getTokenAccounts',
          params: { mint: addr, limit: 1000, page, options: { showZeroBalance: false } }
        })
      })
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

  const holders = [...ownerBal.entries()]
    .map(([address, balance]) => ({
      address, balance,
      pct: supplyUi ? (balance / supplyUi) * 100 : null,
      usdValue: token.priceUsd != null ? balance * token.priceUsd : null,
      isContract: false, label: ''
    }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, topN)

  // Transfers — best-effort: enhanced txs for top holders, keep tracked-mint transfers among holders
  const nodeSet = new Set(holders.map(h => h.address))
  const transfers = []
  const probe = holders.slice(0, 15)
  await Promise.allSettled(probe.map(async (h) => {
    try {
      const r = await fetch(`https://api.helius.xyz/v0/addresses/${h.address}/transactions?api-key=${key}&type=TRANSFER&limit=100`)
      if (!r.ok) return
      const txs = await r.json()
      for (const tx of (Array.isArray(txs) ? txs : [])) {
        for (const tt of (tx.tokenTransfers || [])) {
          if (tt.mint !== addr) continue
          transfers.push({
            from: tt.fromUserAccount, to: tt.toUserAccount,
            value: tt.tokenAmount || 0,
            txHash: tx.signature,
            ts: tx.timestamp ? tx.timestamp * 1000 : 0
          })
        }
      }
    } catch (_) {}
  }))

  const edges = buildEdges(transfers, nodeSet)
  return { token, holders, edges, transfers, meta: { source: 'helius', fetchedAt: Date.now() } }
}

exports.getHolderGraph = functions.region('europe-west1')
  .runWith({ secrets: ALL_SECRETS, timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const { chain, contractAddress } = data
  validateChain(chain)
  if (chain === 'ton')
    throw new functions.https.HttpsError('unimplemented', 'TON bubble maps are not supported yet.')
  if (typeof contractAddress !== 'string' || !contractAddress.trim())
    throw new functions.https.HttpsError('invalid-argument', 'contractAddress is required')
  const addr = contractAddress.trim()
  const topN = Math.min(Math.max(parseInt(data.limit || 500, 10), 10), 2000)

  if (chain === 'sol') {
    const key = SECRET_HELIUS.value()
    if (!key) throw new functions.https.HttpsError('failed-precondition', 'Solana provider not configured.')
    return solHolderGraph(addr, topN, key)
  }
  const key = SECRET_MORALIS.value()
  if (!key) throw new functions.https.HttpsError('failed-precondition', 'EVM provider not configured.')
  return evmHolderGraph(chain, addr.toLowerCase(), topN, key)
})

// ── Deep IN/OUT transfer history between two wallets ────────────────────────
exports.getPairTransfers = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const { chain, addrA, addrB } = data
  validateChain(chain)
  validateAddress(chain, addrA)
  validateAddress(chain, addrB)
  const a = addrA.trim(), b = addrB.trim()

  if (chain === 'sol') {
    const key = SECRET_HELIUS.value()
    if (!key) throw new functions.https.HttpsError('failed-precondition', 'Solana provider not configured.')
    const out = []
    try {
      const r = await fetch(`https://api.helius.xyz/v0/addresses/${a}/transactions?api-key=${key}&type=TRANSFER&limit=100`)
      const txs = await r.json()
      for (const tx of (Array.isArray(txs) ? txs : [])) {
        for (const tt of (tx.tokenTransfers || [])) {
          const f = tt.fromUserAccount, t = tt.toUserAccount
          if ((f === a && t === b) || (f === b && t === a)) {
            out.push({
              direction: f === a ? 'OUT' : 'IN',
              token: tt.mint, symbol: '', amount: tt.tokenAmount || 0,
              txHash: tx.signature, ts: tx.timestamp ? tx.timestamp * 1000 : 0
            })
          }
        }
      }
    } catch (_) {}
    return { transfers: out.sort((x, y) => y.ts - x.ts) }
  }

  const key = SECRET_MORALIS.value()
  if (!key) throw new functions.https.HttpsError('failed-precondition', 'EVM provider not configured.')
  const hex = MORALIS_CHAIN_HEX[chain]
  const bl = b.toLowerCase(), al = a.toLowerCase()
  const out = []
  let cursor = ''
  for (let page = 0; page < 3; page++) {
    let json
    try {
      json = await moralisGet(`${a}/erc20/transfers?chain=${hex}&limit=100${cursor ? `&cursor=${cursor}` : ''}`, key)
    } catch (_) { break }
    for (const r of (json.result || [])) {
      const f = (r.from_address || '').toLowerCase()
      const t = (r.to_address || '').toLowerCase()
      if ((f === al && t === bl) || (f === bl && t === al)) {
        out.push({
          direction: f === al ? 'OUT' : 'IN',
          token: r.address, symbol: r.token_symbol || '',
          amount: parseFloat(r.value_decimal ?? 0),
          txHash: r.transaction_hash,
          ts: r.block_timestamp ? Date.parse(r.block_timestamp) : 0
        })
      }
    }
    cursor = json.cursor || ''
    if (!cursor) break
  }
  return { transfers: out.sort((x, y) => y.ts - x.ts) }
})

// ── Telegram Webhook (HTTPS) ───────────────────────────────────────────────
exports.telegramWebhook = fn.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return }

  let token
  try { token = TG_TOKEN() } catch (e) { res.status(500).send(e.message); return }

  const bot = tg.createBot(token)
  try {
    await tg.handleUpdate(bot, req.body, admin, db, trader, encryption, MASTER_SECRET(), gemscanner, SECRET_HELIUS.value() || null, SECRET_MORALIS.value() || null)
  } catch (err) {
    console.error('Webhook error:', err)
  }
  res.status(200).json({ ok: true }) // Always 200 to Telegram
})

// ── Execute Trade (callable from web app) ─────────────────────────────────
exports.executeTrade = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid = context.auth.uid
  const { chain, tokenAddress, action, amount, percent } = data
  let { slippage } = data

  validateChain(chain)
  validateAddress(chain, tokenAddress)
  if (!['buy', 'sell'].includes(action))
    throw new functions.https.HttpsError('invalid-argument', 'Action must be buy or sell')

  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found')

  const settings = userSnap.data().botSettings || {}
  const wallets  = settings.wallets || {}

  // ── PAPER MODE: simulate the fill at the live price and return BEFORE any
  // wallet/key access. This early return is the server-side guarantee that
  // paper trading can never touch encryption.decrypt or on-chain execution —
  // and it's why free users can paper-trade without a funded wallet.
  if (userSnap.data().paperMode === true) {
    const info = await positions.tokenPrice(chain, tokenAddress)
    if (!info || !info.priceUsd) throw new functions.https.HttpsError('failed-precondition', 'No live market price for this token — paper fill unavailable.')
    const isBuy = action === 'buy'
    const trade = {
      chain, tokenAddress, type: action, paper: true,
      amountIn: isBuy ? String(validateAmount(amount)) : null,
      percentSold: isBuy ? null : validatePercent(percent),
      tokenSymbol: info.symbol || null,
      entryPriceUsd: isBuy ? info.priceUsd : null,
      exitPriceUsd: isBuy ? null : info.priceUsd,
      txHash: null, status: 'paper', source: 'manual',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }
    await db.collection(`users/${uid}/trades`).add(trade)
    return { status: 'paper', simulated: true, txHash: null, chain, tokenAddress, priceUsd: info.priceUsd }
  }

  if (!wallets[chain]?.encryptedKey)
    throw new functions.https.HttpsError('failed-precondition', `No ${chain.toUpperCase()} wallet configured`)

  const pk   = encryption.decrypt(wallets[chain].encryptedKey, uid, MASTER_SECRET())
  const slip = slippage ? validateSlippage(slippage) : (settings.defaultSlippage || 5)
  const gasX = settings.defaultGasMultiplier || 1.2

  const heliusKey = SECRET_HELIUS.value() || null

  // Platform trading fee — % by plan (admin-set), sent to the admin's per-chain
  // wallet. Null when the fee is off or no receiving wallet is configured.
  const feeCfgBilling = await payments.billingConfig(db)
  const userPlan = ['free', 'pro', 'elite'].includes(userSnap.data().plan) ? userSnap.data().plan : 'free'
  const feeCfg = payments.resolveTradeFee(feeCfgBilling, userPlan, chain)

  let result
  try {
    if (action === 'buy') {
      const amt = validateAmount(amount)
      result = chain === 'sol'
        ? await trader.buyTokenSOL(pk, tokenAddress, amt, slip, settings.solRpc, heliusKey, feeCfg)
        : await trader.buyTokenEVM(chain, pk, tokenAddress, amt, slip, settings[chain + 'Rpc'], gasX, feeCfg)
    } else {
      const pct = validatePercent(percent)
      result = chain === 'sol'
        ? await trader.sellTokenSOL(pk, tokenAddress, pct, slip, settings.solRpc, heliusKey, feeCfg)
        : await trader.sellTokenEVM(chain, pk, tokenAddress, pct, slip, settings[chain + 'Rpc'], gasX, feeCfg)
    }

    await db.collection(`users/${uid}/trades`).add({
      chain, tokenAddress, type: action,
      amountIn: amount || null, percentSold: percent || null,
      txHash: result.txHash, status: result.status, source: 'manual',
      feePct: feeCfg ? feeCfg.pct : 0,
      feeNative: result.feeNative || null,
      feeTxHash: result.feeTxHash || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    })

    return { ...result, feePct: feeCfg ? feeCfg.pct : 0 }
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err
    await db.collection(`users/${uid}/trades`).add({
      chain, tokenAddress, type: action,
      txHash: null, status: 'failed', error: err.message, source: 'manual',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    })
    throw new functions.https.HttpsError('internal', err.message || 'Trade execution failed')
  }
})

// ── Sign & Submit Solana Transaction (callable from web app) ──────────────
// Browser builds the Jupiter swap transaction; this function only signs + submits.
// Private key never leaves this Cloud Function.
exports.signAndSubmitSolTx = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid = context.auth.uid
  const { serializedTxBase64, tokenAddress } = data

  if (typeof serializedTxBase64 !== 'string' || serializedTxBase64.trim().length < 10)
    throw new functions.https.HttpsError('invalid-argument', 'serializedTxBase64 is required')
  if (typeof tokenAddress !== 'string' || !tokenAddress.trim())
    throw new functions.https.HttpsError('invalid-argument', 'tokenAddress is required')
  validateAddress('sol', tokenAddress.trim())

  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found')

  const settings = userSnap.data().botSettings || {}
  const wallets  = settings.wallets || {}

  if (!wallets.sol?.encryptedKey)
    throw new functions.https.HttpsError('failed-precondition', 'No SOL wallet configured')

  const pk        = encryption.decrypt(wallets.sol.encryptedKey, uid, MASTER_SECRET())
  const heliusKey = SECRET_HELIUS.value() || null

  try {
    const result = await trader.signAndSubmitSolTx(
      pk, serializedTxBase64.trim(), settings.solRpc || null, heliusKey
    )
    await db.collection(`users/${uid}/trades`).add({
      chain: 'sol', tokenAddress: tokenAddress.trim(), type: 'buy',
      amountIn: data.amountSol ? String(data.amountSol) : null, percentSold: null,
      txHash: result.txHash, status: result.status, source: 'gem-hybrid',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })
    return { txHash: result.txHash, status: result.status, chain: 'sol', tokenAddress: tokenAddress.trim() }
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err
    await db.collection(`users/${uid}/trades`).add({
      chain: 'sol', tokenAddress: tokenAddress.trim(), type: 'buy',
      txHash: null, status: 'failed', error: err.message, source: 'gem-hybrid',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })
    throw new functions.https.HttpsError('internal', err.message || 'Solana transaction failed')
  }
})

// ── Save Wallet (encrypts private key server-side) ────────────────────────
exports.saveWallet = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid = context.auth.uid
  const { chain, address, privateKey } = data

  validateChain(chain)
  validateAddress(chain, address)

  // TON is address-only — no private key required (trading not yet supported)
  if (chain === 'ton') {
    await db.doc(`users/${uid}`).set(
      { botSettings: { wallets: { ton: { address: address.trim() } } } },
      { merge: true }
    )
    return { success: true }
  }

  if (typeof privateKey !== 'string' || privateKey.trim().length < 32)
    throw new functions.https.HttpsError('invalid-argument', 'Private key is invalid')

  // EVM keys must be 64 hex chars (optionally 0x-prefixed)
  if (chain !== 'sol') {
    const raw = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey
    if (!/^[0-9a-fA-F]{64}$/.test(raw))
      throw new functions.https.HttpsError('invalid-argument', 'Invalid EVM private key format')
  }

  const encryptedKey = encryption.encrypt(privateKey.trim(), uid, MASTER_SECRET())

  await db.doc(`users/${uid}`).set(
    { botSettings: { wallets: { [chain]: { address, encryptedKey } } } },
    { merge: true }
  )
  return { success: true }
})

// ── Remove Wallet ─────────────────────────────────────────────────────────
exports.removeWallet = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid = context.auth.uid
  const { chain } = data

  validateChain(chain)

  await db.doc(`users/${uid}`).set(
    { botSettings: { wallets: { [chain]: admin.firestore.FieldValue.delete() } } },
    { merge: true }
  )
  return { success: true }
})

// ── Get Wallet Balances ────────────────────────────────────────────────────
exports.getBalances = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid      = context.auth.uid
  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) return { balances: {} }

  const settings = userSnap.data().botSettings || {}
  const wallets  = settings.wallets || {}
  const balances = {}

  const tasks = []
  if (wallets.bsc?.address) tasks.push(
    trader.getEVMBalance(wallets.bsc.address, 'bsc', settings.bscRpc)
      .then(b => { balances.bsc = b }).catch(e => { balances.bsc = { error: e.message } })
  )
  if (wallets.eth?.address) tasks.push(
    trader.getEVMBalance(wallets.eth.address, 'eth', settings.ethRpc)
      .then(b => { balances.eth = b }).catch(e => { balances.eth = { error: e.message } })
  )
  if (wallets.sol?.address) tasks.push(
    trader.getSOLBalance(wallets.sol.address, settings.solRpc)
      .then(b => { balances.sol = b }).catch(e => { balances.sol = { error: e.message } })
  )
  if (wallets.base?.address) tasks.push(
    trader.getEVMBalance(wallets.base.address, 'base', settings.baseRpc)
      .then(b => { balances.base = b }).catch(e => { balances.base = { error: e.message } })
  )
  if (wallets.ton?.address) tasks.push(
    trader.getTONBalance(wallets.ton.address)
      .then(b => { balances.ton = b }).catch(e => { balances.ton = { error: e.message } })
  )

  await Promise.all(tasks)
  return { balances }
})

// ── Generate Telegram Link Code ────────────────────────────────────────────
exports.generateTelegramCode = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid  = context.auth.uid
  // Use cryptographically secure random bytes instead of Math.random
  const code = crypto.randomBytes(4).toString('hex').toUpperCase()
  // Code expires in 10 minutes
  const expiry = Date.now() + 10 * 60 * 1000

  await db.doc(`users/${uid}`).set(
    { botSettings: { telegramLinkCode: code, telegramLinkExpiry: expiry, telegramVerified: false, telegramChatId: null } },
    { merge: true }
  )
  return { code }
})

// ── Get Telegram Bot Info ─────────────────────────────────────────────────
exports.getBotInfo = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const axios = require('axios')
  const token = TG_TOKEN()
  const resp  = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 8000 })
  const bot   = resp.data?.result || {}
  return { username: bot.username || null, firstName: bot.first_name || null }
})

// ── Scan Arbitrage Opportunities (callable) ───────────────────────────────
exports.scanArbitrage = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid      = context.auth.uid
  const chains   = Array.isArray(data?.chains) ? data.chains.filter(c => VALID_CHAINS.has(c)) : ['bsc', 'sol']
  const minSpread = Math.max(0.1, Math.min(parseFloat(data?.minSpread) || 0.3, 20))
  const minLiq    = Math.max(1000, parseInt(data?.minLiqUsd) || 20000)

  const userSnap = await db.doc(`users/${uid}`).get()
  const settings = userSnap.exists ? (userSnap.data().botSettings || {}) : {}

  const opportunities = await arbitrage.scanArbitrageOpportunities(chains, minSpread, minLiq)
  return { opportunities, scannedAt: Date.now() }
})

// ── Execute Arbitrage Trade (callable) ────────────────────────────────────
exports.executeArbitrage = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid     = context.auth.uid
  const { chain, opportunity } = data
  const amount  = validateAmount(data.tradeAmount)

  validateChain(chain)
  if (!opportunity || !opportunity.tokenAddress)
    throw new functions.https.HttpsError('invalid-argument', 'opportunity.tokenAddress is required')

  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found')

  const settings = userSnap.data().botSettings || {}
  const wallets  = settings.wallets || {}

  if (!wallets[chain]?.encryptedKey)
    throw new functions.https.HttpsError('failed-precondition', `No ${chain.toUpperCase()} wallet configured`)

  const pk = encryption.decrypt(wallets[chain].encryptedKey, uid, MASTER_SECRET())

  try {
    const result = await arbitrage.executeArbitrageOpp(chain, pk, opportunity, amount, settings)

    await db.collection(`users/${uid}/trades`).add({
      chain,
      type:          'arbitrage',
      pair:          opportunity.pair,
      buyDex:        opportunity.buyDexName,
      sellDex:       opportunity.sellDexName,
      spreadPercent: opportunity.spreadPercent,
      amountIn:      amount,
      txHashBuy:     result.txHashBuy  || null,
      txHashSell:    result.txHashSell || null,
      profit:        result.profit     || null,
      status:        result.status,
      source:        'manual-arbitrage',
      timestamp:     admin.firestore.FieldValue.serverTimestamp(),
    })

    return result
  } catch (err) {
    if (err.code) throw err
    throw new functions.https.HttpsError('internal', err.message)
  }
})

// ── Auto-Arbitrage Scheduler (runs every 2 minutes) ───────────────────────
exports.processArbitrageQueue = fn.pubsub
  .schedule('every 2 minutes')
  .onRun(async () => {
    const snap = await db.collection('users')
      .where('botSettings.arbEnabled', '==', true)
      .limit(10).get()

    if (snap.empty) return null

    await Promise.allSettled(snap.docs.map(async (userDoc) => {
      const uid      = userDoc.id
      const settings = userDoc.data().botSettings || {}
      const wallets  = settings.wallets || {}

      const chains     = ['bsc', 'sol'].filter(c => wallets[c]?.encryptedKey)
      if (!chains.length) return

      const minProfit = Math.max(0.1, parseFloat(settings.arbMinProfit) || 0.5)
      const maxAmount = Math.max(0.001, parseFloat(settings.arbMaxAmount) || 0.01)

      try {
        const opps = await arbitrage.scanArbitrageOpportunities(chains, minProfit)

        for (const opp of opps.slice(0, 3)) {
          if (!wallets[opp.chain]?.encryptedKey) continue

          const pk     = encryption.decrypt(wallets[opp.chain].encryptedKey, uid, MASTER_SECRET())
          const result = await arbitrage.executeArbitrageOpp(opp.chain, pk, opp, maxAmount, settings)

          await db.collection(`users/${uid}/trades`).add({
            chain:         opp.chain,
            type:          'arbitrage',
            pair:          opp.pair,
            buyDex:        opp.buyDexName,
            sellDex:       opp.sellDexName,
            spreadPercent: opp.spreadPercent,
            amountIn:      maxAmount,
            txHashBuy:     result.txHashBuy  || null,
            txHashSell:    result.txHashSell || null,
            profit:        result.profit     || null,
            status:        result.status,
            source:        'auto-arbitrage',
            timestamp:     admin.firestore.FieldValue.serverTimestamp(),
          })

          // Telegram notification
          let tgToken
          try { tgToken = TG_TOKEN() } catch (_) { tgToken = null }
          if (settings.telegramChatId && tgToken) {
            const bot = tg.createBot(tgToken)
            await bot.sendMessage(
              settings.telegramChatId,
              `💰 *Arbitrage Executed!*\n\n` +
              `Pair: ${opp.pair}\n` +
              `Buy: ${opp.buyDexName}\n` +
              `Sell: ${opp.sellDexName}\n` +
              `Spread: ${opp.spreadPercent}%\n` +
              `Status: ${result.status}` +
              (result.profit ? `\nProfit: ${result.profit}` : ''),
              { parse_mode: 'Markdown' }
            ).catch(() => {})
          }
        }
      } catch (err) {
        console.error(`Auto-arb error for ${uid}:`, err.message)
      }
    }))

    return null
  })

// ── Scan Gems (callable from web app) ─────────────────────────────────────
exports.scanGems = functions.region('europe-west1').runWith({ secrets: ALL_SECRETS, timeoutSeconds: 120, memory: '512MB' }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const chains       = Array.isArray(data?.chains) ? data.chains.filter(c => VALID_CHAINS.has(c)) : ['bsc', 'sol']
  const minLiquidity = Math.max(1000, parseInt(data?.minLiquidity) || 5000)
  // Age window in hours. Ceiling = ~10 years so users can scan by hours → years.
  const maxAgeHours  = Math.max(1, Math.min(parseInt(data?.maxAgeHours) || 24, 87600))
  const minAgeHours  = Math.max(0, Math.min(parseInt(data?.minAgeHours) || 0, 87600))
  const minScore     = Math.max(0, Math.min(parseInt(data?.minScore) || 40, 100))
  // Optional advanced filters (from the gem scanner settings sheet). Clamp/sanitize.
  const minVolume    = Math.max(0, parseInt(data?.minVolume) || 0)
  const maxVolume    = Math.max(0, parseInt(data?.maxVolume) || 0)
  const minMarketCap = Math.max(0, parseInt(data?.minMarketCap) || 0)
  const maxMarketCap = Math.max(0, parseInt(data?.maxMarketCap) || 0)
  const sort         = ['score', 'trending', 'new', 'gainers'].includes(data?.sort) ? data.sort : 'score'

  // Meter the scan against the user's monthly gem-scan quota (+ scanner flag).
  const uid = context.auth.uid
  const cfg = await payments.billingConfig(db)
  const uSnap = await db.doc(`users/${uid}`).get()
  const uDoc = uSnap.exists ? uSnap.data() : {}
  const plan = ['free', 'pro', 'elite'].includes(uDoc.plan) ? uDoc.plan : 'free'
  let scanUsage
  try {
    scanUsage = await metering.consume(db, uid, { kind: 'gemScan', plan, cfg, count: 1, flagKey: 'scanner' })
  } catch (e) {
    if (e.kind === 'feature-disabled') throw new functions.https.HttpsError('permission-denied', 'The gem scanner is disabled on your account.')
    if (e.kind === 'quota-exhausted') {
      const i = e.info || {}
      throw new functions.https.HttpsError('resource-exhausted', `You've used all ${i.quota} gem scans for this period. They reset next month, or upgrade your plan for more.`, { code: 'quota_exhausted', quota: i.quota, resetsAt: i.resetsAt })
    }
    throw new functions.https.HttpsError('internal', 'Usage check failed. Try again.')
  }

  try {
    const gems = await gemscanner.discoverGems(chains, {
      minLiquidity, maxAgeHours, minAgeHours, minScore, minVolume, maxVolume, minMarketCap, maxMarketCap, sort,
      dextoolsKey: process.env.DEXTOOLS_API_KEY || null,
    })
    await metering.track(db, uid, { gemScans: 1 })
    // Record surfaced gems for hindsight stats (first-seen price; deduped).
    await gemTracker.recordSightings(db, gems).catch(() => {})
    return { gems, scannedAt: Date.now(), usage: { used: scanUsage.used, remaining: scanUsage.remaining, quota: scanUsage.quota } }
  } catch (e) {
    await metering.refund(db, uid, { kind: 'gemScan', ...scanUsage })
    throw new functions.https.HttpsError('internal', e.message || 'Scan failed')
  }
})

// ── Gem Scanner Scheduler (runs every 5 minutes) ──────────────────────────
// A 4-chain safety-checked scan per user can take well over the platform's 60s
// default, so this scheduler gets its own extended timeout + memory — otherwise
// the run is killed mid-scan and no alerts go out.
const gemScanFn = functions.region('europe-west1').runWith({ secrets: ALL_SECRETS, timeoutSeconds: 300, memory: '512MB' })
exports.processGemScanner = gemScanFn.pubsub
  .schedule('every 5 minutes')
  .onRun(async () => {
    const snap = await db.collection('users')
      .where('botSettings.gemAutoEnabled', '==', true)
      .limit(25).get()

    if (snap.empty) return null

    let tgToken
    try { tgToken = TG_TOKEN() } catch (_) { tgToken = null }

    // Global auto-trade controls (admin kill-switch + default caps) + native USD
    // prices, fetched once per run for the maxBuyUsd clamp.
    const cfg = await payments.billingConfig(db)
    const autoTradeOn = cfg.autoTrade.globalEnabled !== false
    let nativePx = {}
    if (autoTradeOn) {
      try {
        const axios = require('axios')
        const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum,solana&vs_currencies=usd', { timeout: 10000 })
        nativePx = { bsc: data.binancecoin?.usd || 0, eth: data.ethereum?.usd || 0, base: data.ethereum?.usd || 0, sol: data.solana?.usd || 0 }
      } catch (_) { /* clamp simply won't apply without prices */ }
    }

    await Promise.allSettled(snap.docs.map(async (userDoc) => {
      const uid      = userDoc.id
      const settings = userDoc.data().botSettings || {}
      const flags    = userDoc.data().featureFlags || {}
      const limits   = userDoc.data().userLimits || {}
      const wallets  = settings.wallets || {}
      const chatId   = settings.telegramChatId
      const paperMode = userDoc.data().paperMode === true
      const userPlan = ['free', 'pro', 'elite'].includes(userDoc.data().plan) ? userDoc.data().plan : 'free'

      if (!chatId || !tgToken) return

      // Always scan every supported chain unless the owner explicitly narrowed it.
      const chains = (settings.gemChains || ['bsc', 'eth', 'sol', 'base']).filter(c => VALID_CHAINS.has(c))
      if (!chains.length) return

      const filters = {
        minLiquidity: settings.gemMinLiquidity || 5000,
        maxAgeHours:  settings.gemMaxAge       || 24,
        minAgeHours:  settings.gemMinAge       || 0,
        minScore:     settings.gemMinScore     || 60,
        minVolume:    settings.gemMinVolume != null ? settings.gemMinVolume : 1000,
        maxVolume:    settings.gemMaxVolume    || 0,
        narrative:    settings.gemNarrative    || 'all',
        minMarketCap: settings.gemMinMcap      || 0,
        maxMarketCap: settings.gemMaxMcap      || 0,
        sort:         settings.gemSort         || 'score',
        dextoolsKey:  process.env.DEXTOOLS_API_KEY || null,
      }

      try {
        const gems = await gemscanner.discoverGems(chains, filters)
        if (!gems.length) return

        // Record surfaced gems for hindsight stats (deduped; first price wins).
        await gemTracker.recordSightings(db, gems).catch(() => {})

        const bot = tg.createBot(tgToken)

        const sentCount = await gemscanner.sendGemAlerts(
          gems, settings, bot, chatId, db, uid
        )

        // Auto-buy if enabled — gated by the admin global kill-switch and the
        // per-user autoExecute feature flag.
        if (settings.gemAutoBuy && sentCount > 0 && autoTradeOn && flags.autoExecute !== false) {
          // Daily auto-trade cap: per-user override else admin default (0 = off).
          const dailyCap = (limits.dailyTradeCap != null ? limits.dailyTradeCap : cfg.autoTrade.defaultDailyTradeCap) || 0
          const maxBuyUsd = (limits.maxBuyUsd != null ? limits.maxBuyUsd : cfg.autoTrade.defaultMaxBuyUsd) || 0
          // Daily cap counts ALL automated trades — auto-buys AND automated exits.
          const autoTodayStart = dailyCap > 0 ? await positions.autoTradesToday(db, uid) : 0
          let autoToday = autoTodayStart
          for (const gem of gems.slice(0, 3)) {
            if (dailyCap > 0 && autoToday >= dailyCap) break
            if (gem.gemScore < (settings.gemMinScore || 60)) continue
            // Paper mode needs no wallet — that's the free-user unlock.
            if (!paperMode && !wallets[gem.chain]?.encryptedKey) continue
            // REAL auto-execution is a paid feature; Free users get the full
            // loop in paper mode only (plan repackaging, roadmap 4.3).
            if (!paperMode && userPlan === 'free') continue

            const alertSnap = await db.collection(`users/${uid}/gemAlerts`)
              .where('tokenAddress', '==', gem.tokenAddress)
              .where('chain', '==', gem.chain)
              .where('autoBought', '==', true)
              .limit(1).get()

            if (!alertSnap.empty) continue

            let buyAmount = gem.chain === 'bsc' ? (settings.gemBuyAmountBsc || 0.005)
              : (gem.chain === 'eth' || gem.chain === 'base') ? (settings.gemBuyAmountEth || 0.01)
              : (settings.gemBuyAmountSol || 0.05)
            // Clamp to the max USD buy size when a native price is available.
            const px = nativePx[gem.chain] || 0
            if (maxBuyUsd > 0 && px > 0 && buyAmount * px > maxBuyUsd) buyAmount = +(maxBuyUsd / px).toFixed(6)

            // ── PAPER MODE: record a simulated fill at the gem's live price —
            // never touches the wallet or chain. Exit defaults still arm, so the
            // exit monitor simulates the full round trip.
            if (paperMode) {
              if (!(gem.priceUsd > 0)) continue
              const exitDefaults = positions.normalizeExit({
                tp: settings.gemExitTp, sl: settings.gemExitSl,
                trail: settings.gemExitTrail, maxHoldHours: settings.gemExitMaxHold,
              })
              await db.collection(`users/${uid}/trades`).add({
                chain: gem.chain, tokenAddress: gem.tokenAddress,
                tokenName: gem.tokenName, tokenSymbol: gem.tokenSymbol,
                type: 'buy', amountIn: String(buyAmount), paper: true,
                txHash: null, status: 'paper', source: 'gem-auto',
                gemScore: gem.gemScore, entryPriceUsd: gem.priceUsd,
                exit: exitDefaults,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
              })
              const alertDocs = await db.collection(`users/${uid}/gemAlerts`)
                .where('tokenAddress', '==', gem.tokenAddress).where('chain', '==', gem.chain).limit(1).get()
              if (!alertDocs.empty) await alertDocs.docs[0].ref.set({ autoBought: true }, { merge: true }).catch(() => {})
              await bot.sendMessage(chatId,
                `📝 PAPER · *Auto-bought ${gem.tokenSymbol}* (simulated)\n\nScore: ${gem.gemScore}/100\nSize: ${buyAmount} ${gem.chain === 'bsc' ? 'BNB' : (gem.chain === 'eth' || gem.chain === 'base') ? 'ETH' : 'SOL'} @ $${gem.priceUsd}\nTrack it in Portfolio.`,
                { parse_mode: 'Markdown' }).catch(() => {})
              await notify.send(db, admin, uid, { category: 'gems', title: `📝 PAPER · Auto-bought ${gem.tokenSymbol}`, body: `Simulated buy · score ${gem.gemScore}/100 · track it in Portfolio`, link: '/?goto=portfolio', tag: 'gembuy-' + gem.tokenAddress })
              continue
            }

            try {
              const pk   = encryption.decrypt(wallets[gem.chain].encryptedKey, uid, MASTER_SECRET())
              const slip = Math.min(settings.gemBuySlippage || settings.defaultSlippage || 10, 50)
              const gasX = settings.defaultGasMultiplier || 1.2

              if (gem.chain === 'sol') {
                // SOL auto-buy requires browser-side Jupiter call — skip here, send manual alert
                await bot.sendMessage(chatId,
                  `💎 *New SOL Gem: ${gem.tokenSymbol}*\n\n` +
                  `Score: ${gem.gemScore}/100\n` +
                  `Open the web app → Gem Scanner to buy manually.`,
                  { parse_mode: 'Markdown' }
                ).catch(() => {})
                continue
              }

              const result = await trader.buyTokenEVM(gem.chain, pk, gem.tokenAddress, buyAmount, slip, settings[gem.chain + 'Rpc'], gasX)
              autoToday++
              await metering.track(db, uid, { autoBuys: 1 })

              // Exit defaults from the user's gem settings ride on the trade doc;
              // the onTradeCreated trigger arms them on the resulting position so
              // the bot manages the whole round trip, not just the entry.
              const exitDefaults = positions.normalizeExit({
                tp: settings.gemExitTp, sl: settings.gemExitSl,
                trail: settings.gemExitTrail, maxHoldHours: settings.gemExitMaxHold,
              })
              await db.collection(`users/${uid}/trades`).add({
                chain:        gem.chain,
                tokenAddress: gem.tokenAddress,
                tokenName:    gem.tokenName,
                tokenSymbol:  gem.tokenSymbol,
                type:         'buy',
                amountIn:     String(buyAmount),
                txHash:       result.txHash,
                status:       result.status,
                source:       'gem-auto',
                gemScore:     gem.gemScore,
                exit:         exitDefaults,
                timestamp:    admin.firestore.FieldValue.serverTimestamp(),
              })

              const alertDocs = await db.collection(`users/${uid}/gemAlerts`)
                .where('tokenAddress', '==', gem.tokenAddress)
                .where('chain', '==', gem.chain)
                .orderBy('alertedAt', 'desc')
                .limit(1).get()

              if (!alertDocs.empty) {
                await alertDocs.docs[0].ref.update({
                  autoBought: true,
                  txHash:     result.txHash,
                })
              }

              const txUrl = gemscanner.explorerTxUrl(gem.chain, result.txHash)
              await bot.sendMessage(chatId,
                `🤖 *Auto-Bought ${gem.tokenSymbol}!*\n\n` +
                `Score: ${gem.gemScore}/100\n` +
                `Amount: ${buyAmount} ${gem.chain === 'bsc' ? 'BNB' : (gem.chain === 'eth' || gem.chain === 'base') ? 'ETH' : 'SOL'}\n` +
                `Status: ${result.status}\n` +
                `[View TX](${txUrl})`,
                { parse_mode: 'Markdown', disable_web_page_preview: true }
              ).catch(() => {})
              await notify.send(db, admin, uid, { category: 'gems', title: `🤖 Auto-bought ${gem.tokenSymbol}`, body: `Score ${gem.gemScore}/100 · ${buyAmount} ${gem.chain === 'bsc' ? 'BNB' : (gem.chain === 'eth' || gem.chain === 'base') ? 'ETH' : 'SOL'} · exits armed`, link: '/?goto=portfolio', tag: 'gembuy-' + gem.tokenAddress })

            } catch (buyErr) {
              console.error(`Gem auto-buy failed for ${gem.tokenSymbol}:`, buyErr.message)
              await bot.sendMessage(chatId,
                `⚠️ Auto-buy failed for ${gem.tokenSymbol}: ${buyErr.message}`,
              ).catch(() => {})
            }
          }
        }

      } catch (err) {
        console.error(`Gem scan error for ${uid}:`, err.message)
      }
    }))

    return null
  })

// ── Position bookkeeping (Firestore trigger) ──────────────────────────────
// Every trade doc (manual, Pointer-approved, gem auto-buy, exit sell, sniper)
// folds into users/{uid}/positions — quantities, avg entry, realized PnL.
// Trade docs may carry an `exit` map (gem auto-buy defaults) which arms rules.
exports.onTradeCreated = functions.region('europe-west1')
  .runWith({ timeoutSeconds: 60 })
  .firestore.document('users/{uid}/trades/{tradeId}')
  .onCreate(async (snap, context) => {
    try { await positions.applyTrade(db, context.params.uid, snap.data()) }
    catch (e) { console.error('position bookkeeping failed:', e.message) }
    return null
  })

// ── Exit Monitor (runs every minute) ──────────────────────────────────────
// Prices every armed position and executes TP / SL / trailing / max-hold sells
// from the user's bot wallet. Same guardrails as auto-buy: admin kill-switch,
// per-user autoExecute flag, daily automated-trade cap.
exports.processExitMonitor = gemScanFn.pubsub
  .schedule('every 1 minutes')
  .onRun(async () => {
    let tgToken = null
    try { tgToken = TG_TOKEN() } catch (_) {}
    const cfg = await payments.billingConfig(db)
    const res = await positions.runExitMonitor({
      db, admin, trader, encryption,
      masterSecret: MASTER_SECRET(), tgToken, cfg,
      heliusKey: SECRET_HELIUS.value() || null,
      notify: (uid, msg) => notify.send(db, admin, uid, msg),
    })
    if (res.sold) console.log(`exit monitor: sold ${res.sold} of ${res.checked} armed positions`)
    return null
  })

// ── Price Alerts ───────────────────────────────────────────────────────────
// Alerts live at users/{uid}/priceAlerts (created ONLY via this callable so
// plan caps are server-enforced; clients may read/delete per rules).
const PRICE_ALERT_QUOTA = { free: 5, pro: 25, elite: 100 }
exports.savePriceAlert = functions.region('europe-west1').runWith({ timeoutSeconds: 30 }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const kind = ['above', 'below', 'move'].includes(data?.kind) ? data.kind : null
  const value = parseFloat(data?.value)
  const id = data?.id ? String(data.id) : null
  const on = data?.on !== false

  // Toggling an existing alert (id + on only) skips re-validation of the token.
  const ref = id ? db.doc(`users/${uid}/priceAlerts/${id}`) : db.collection(`users/${uid}/priceAlerts`).doc()
  let existing = null
  if (id) {
    const s = await ref.get()
    if (!s.exists) throw new functions.https.HttpsError('not-found', 'Alert not found')
    existing = s.data()
  }

  // Cap check whenever the result is an ACTIVE alert (create or re-enable).
  if (on) {
    const uSnap = await db.doc(`users/${uid}`).get()
    const d = uSnap.exists ? uSnap.data() : {}
    const plan = ['free', 'pro', 'elite'].includes(d.plan) ? d.plan : 'free'
    const ovr = parseInt((d.userLimits || {}).priceAlertQuota)
    const quota = Number.isFinite(ovr) ? ovr : PRICE_ALERT_QUOTA[plan]
    const activeSnap = await db.collection(`users/${uid}/priceAlerts`).where('on', '==', true).get()
    const activeOthers = activeSnap.docs.filter((x) => x.id !== ref.id).length
    if (activeOthers >= quota) {
      throw new functions.https.HttpsError('resource-exhausted',
        `Your plan allows ${quota} active alerts. Disable one or upgrade for more.`,
        { code: 'quota_exhausted', quota })
    }
  }

  if (existing && data.kind === undefined && data.value === undefined) {
    // pure toggle
    await ref.set({ on }, { merge: true })
    return { id: ref.id, ...existing, on }
  }

  if (!kind || !Number.isFinite(value) || value <= 0) throw new functions.https.HttpsError('invalid-argument', 'kind (above/below/move) and a positive value are required')
  const cg = data.cg ? String(data.cg).slice(0, 60) : null
  const chain = data.chain && VALID_CHAINS.has(data.chain) ? data.chain : null
  const address = data.address ? String(data.address).trim().slice(0, 80) : null
  if (!cg && !(chain && address)) throw new functions.https.HttpsError('invalid-argument', 'Pass a CoinGecko id or a chain + contract address')

  // 'move' alerts are relative — pin the base price at creation time.
  let basePrice = existing?.basePrice || null
  if (kind === 'move') {
    if (cg) {
      try {
        const axios = require('axios')
        const { data: px } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(cg)}&vs_currencies=usd`, { timeout: 10000 })
        basePrice = px?.[cg]?.usd || null
      } catch (_) {}
    } else {
      const info = await positions.tokenPrice(chain, address)
      basePrice = info?.priceUsd || null
    }
    if (!basePrice) throw new functions.https.HttpsError('failed-precondition', 'No live price for this token — % alerts need one.')
  }

  const alert = {
    kind, value, on, cg, chain, address,
    sym: String(data.sym || '').slice(0, 20), name: String(data.name || '').slice(0, 60),
    basePrice, fireCount: existing?.fireCount || 0,
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  }
  await ref.set(alert)
  return { id: ref.id, ...alert }
})

// Monitor: prices every active alert and fires push + Telegram, then disarms
// (one-shot). Runs every 2 minutes.
exports.processPriceAlerts = functions.region('europe-west1')
  .runWith({ secrets: ALL_SECRETS, timeoutSeconds: 120, memory: '512MB' })
  .pubsub.schedule('every 2 minutes')
  .onRun(async () => {
    const snap = await db.collectionGroup('priceAlerts').where('on', '==', true).limit(500).get()
    if (snap.empty) return null

    // Batch prices: CoinGecko ids in one call, chain tokens per chain.
    const axios = require('axios')
    const cgIds = new Set(), byChain = {}
    for (const doc of snap.docs) {
      const a = doc.data()
      if (a.cg) cgIds.add(a.cg)
      else if (a.chain && a.address) (byChain[a.chain] = byChain[a.chain] || new Set()).add(a.address.toLowerCase())
    }
    let cgPx = {}
    if (cgIds.size) {
      try {
        const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent([...cgIds].join(','))}&vs_currencies=usd`, { timeout: 10000 })
        cgPx = data || {}
      } catch (_) {}
    }
    const chainPx = {}
    for (const [chain, set] of Object.entries(byChain)) chainPx[chain] = await positions.batchPrices(chain, [...set])

    let tgToken = null
    try { tgToken = TG_TOKEN() } catch (_) {}
    const bot = tgToken ? tg.createBot(tgToken) : null

    for (const doc of snap.docs) {
      const a = doc.data()
      const px = a.cg ? (cgPx[a.cg] && cgPx[a.cg].usd) : (chainPx[a.chain] || {})[String(a.address || '').toLowerCase()]
      if (!px) continue
      let fired = null
      if (a.kind === 'above' && px >= a.value) fired = `${a.sym || 'Token'} is above $${a.value}`
      else if (a.kind === 'below' && px <= a.value) fired = `${a.sym || 'Token'} is below $${a.value}`
      else if (a.kind === 'move' && a.basePrice > 0) {
        const movePct = ((px - a.basePrice) / a.basePrice) * 100
        if (Math.abs(movePct) >= a.value) fired = `${a.sym || 'Token'} moved ${movePct >= 0 ? '+' : ''}${movePct.toFixed(1)}% since you set the alert`
      }
      if (!fired) continue

      const uid = doc.ref.parent.parent.id
      await doc.ref.set({ on: false, firedAt: Date.now(), firedPriceUsd: px, fireCount: (a.fireCount || 0) + 1 }, { merge: true }).catch(() => {})
      await notify.send(db, admin, uid, {
        category: 'alerts', title: `🔔 ${fired}`,
        body: `Now $${px < 1 ? px.toPrecision(4) : px.toLocaleString()}`,
        link: '/?goto=alerts', tag: 'alert-' + doc.id,
      })
      if (bot) {
        try {
          const uSnap = await db.doc(`users/${uid}`).get()
          const chatId = uSnap.exists && (uSnap.data().botSettings || {}).telegramChatId
          if (chatId) await bot.sendMessage(chatId, `🔔 *Price alert* — ${fired}\nNow $${px < 1 ? px.toPrecision(4) : px.toLocaleString()}`, { parse_mode: 'Markdown' }).catch(() => {})
        } catch (_) {}
      }
    }
    return null
  })

// ── Copy Trading Monitor (runs every 2 minutes) ────────────────────────────
// Detects fresh DEX buys by followed wallets (Moralis EVM / Helius SOL),
// safety-checks them, alerts followers, and auto-copies for Elite (or paper)
// users through the same guardrails as gem auto-buy.
exports.processCopyTrading = gemScanFn.pubsub
  .schedule('every 2 minutes')
  .onRun(async () => {
    const cfg = await payments.billingConfig(db)
    // Native USD prices once per run for the maxBuyUsd clamp.
    let nativePx = {}
    try {
      const axios = require('axios')
      const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum,solana&vs_currencies=usd', { timeout: 10000 })
      nativePx = { bsc: data.binancecoin?.usd || 0, eth: data.ethereum?.usd || 0, base: data.ethereum?.usd || 0, sol: data.solana?.usd || 0 }
    } catch (_) {}
    const res = await copytrader.runCopyMonitor({
      db, admin, trader, encryption,
      masterSecret: MASTER_SECRET(), cfg, nativePx,
      keys: { moralisKey: SECRET_MORALIS.value() || null, heliusKey: SECRET_HELIUS.value() || null },
      notify: (uid, msg) => notify.send(db, admin, uid, msg),
    })
    if (res.buys) console.log(`copy monitor: ${res.buys} fresh buys across ${res.wallets} wallets`)
    return null
  })

// Feed + leaderboard for the Copy Trading screen (copyWallets is server-only).
const copyFn = functions.region('europe-west1').runWith({ timeoutSeconds: 60 })
exports.getCopyFeed = copyFn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  return { items: await copytrader.feed(db, context.auth.uid) }
})
exports.getCopyLeaderboard = copyFn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const snap = await db.doc(`users/${uid}`).get()
  const d = snap.exists ? snap.data() : {}
  const plan = ['free', 'pro', 'elite'].includes(d.plan) ? d.plan : 'free'
  // Leaderboard is the Elite flagship view; others get a locked marker.
  if (plan !== 'elite') return { locked: true, wallets: [] }
  return { locked: false, wallets: await copytrader.leaderboard(db, uid) }
})

// ── Pointer Watch-Tasks (runs every 5 minutes) ─────────────────────────────
// Standing "watch X and ping me" orders created by the Pointer agent
// (create_watch_task). When a task's STRUCTURED price condition fires, run a
// metered Pointer analysis, save it as a chat session, and push a deep link.
// Free text from the owner rides along only as user-role content — conditions
// themselves are structured fields (prompt-injection boundary).
exports.processPointerTasks = functions.region('europe-west1')
  .runWith({ secrets: [...ALL_SECRETS, SECRET_DEEPSEEK, SECRET_OPENAI], timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const snap = await db.collectionGroup('pointerTasks').where('status', '==', 'armed').limit(200).get()
    if (snap.empty) return null

    // Batch prices (same sources as price alerts).
    const axios = require('axios')
    const cgIds = new Set(), byChain = {}
    for (const doc of snap.docs) {
      const t = doc.data()
      if (t.cg) cgIds.add(t.cg)
      else if (t.chain && t.address) (byChain[t.chain] = byChain[t.chain] || new Set()).add(t.address.toLowerCase())
    }
    let cgPx = {}
    if (cgIds.size) {
      try {
        const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent([...cgIds].join(','))}&vs_currencies=usd`, { timeout: 10000 })
        cgPx = data || {}
      } catch (_) {}
    }
    const chainPx = {}
    for (const [chain, set] of Object.entries(byChain)) chainPx[chain] = await positions.batchPrices(chain, [...set])

    const cfg = await payments.billingConfig(db)
    const prov = cfg.raw.aiProvider === 'openai' ? 'openai' : 'deepseek'
    const apiKey = prov === 'openai' ? SECRET_OPENAI.value() : SECRET_DEEPSEEK.value()

    for (const doc of snap.docs) {
      const t = doc.data()
      const px = t.cg ? (cgPx[t.cg] && cgPx[t.cg].usd) : (chainPx[t.chain] || {})[String(t.address || '').toLowerCase()]
      if (!px) continue
      let fired = null
      if (t.cond === 'above' && px >= t.value) fired = `broke above $${t.value}`
      else if (t.cond === 'below' && px <= t.value) fired = `dropped below $${t.value}`
      else if (t.cond === 'move' && t.basePrice > 0) {
        const movePct = ((px - t.basePrice) / t.basePrice) * 100
        if (Math.abs(movePct) >= t.value) fired = `moved ${movePct >= 0 ? '+' : ''}${movePct.toFixed(1)}% (from $${t.basePrice})`
      }
      if (!fired) continue

      const uid = doc.ref.parent.parent.id
      // Disarm FIRST so a crash mid-analysis can't re-fire the task every tick.
      await doc.ref.set({ status: 'fired', firedAt: Date.now(), firedPriceUsd: px }, { merge: true }).catch(() => {})

      // Meter the run like any Pointer request; out of quota → pause + notify.
      const uSnap = await db.doc(`users/${uid}`).get()
      const uDoc = uSnap.exists ? uSnap.data() : {}
      const plan = ['free', 'pro', 'elite'].includes(uDoc.plan) ? uDoc.plan : 'free'
      let spent
      try {
        spent = await metering.consume(db, uid, { kind: 'pointer', plan, cfg, count: 1, flagKey: 'pointer' })
      } catch (e) {
        await doc.ref.set({ status: 'quota-paused' }, { merge: true }).catch(() => {})
        await notify.send(db, admin, uid, { category: 'tasks', title: `⏸ Watch-task paused — ${t.sym} ${fired}`, body: 'The condition fired but you\'re out of Pointer requests. Add credits to run the analysis.', link: '/?goto=chat', tag: 'task-' + doc.id })
        continue
      }

      // Structured, server-built prompt; the owner's note rides along quoted as
      // their own words (user-role), never as system instructions.
      const prompt = `[Automated watch-task fired] ${t.sym} (${t.name || t.sym}) just ${fired} — it now trades at $${px}.` +
        (t.note ? ` When setting this task the owner said: "${t.note.replace(/"/g, "'")}".` : '') +
        ` Give a brief, timely analysis: what likely drove the move (use your tools — market movers, token info, safety if on-chain), where key levels sit now, and a clear recommendation (hold / take profit / cut / wait). Keep it tight.`

      try {
        if (!apiKey) throw new Error('No AI provider key configured')
        const { text } = await agentLib.runAgent({
          prompt, history: [], provider: prov, apiKey, surface: 'pointer',
          ctx: { uid, db, admin, trader, gemscanner, encryption, masterSecret: MASTER_SECRET(), heliusKey: SECRET_HELIUS.value() || null, moralisKey: SECRET_MORALIS.value() || null },
        })
        // Save as a chat session so the push deep-links into a real conversation.
        const chatRef = db.collection(`users/${uid}/pointerChats`).doc()
        await chatRef.set({
          title: `⚡ ${t.sym} ${t.cond === 'move' ? '±' + t.value + '%' : (t.cond === 'above' ? '>' : '<') + '$' + t.value} fired`,
          messages: [
            { role: 'user', text: `Watch-task: ${t.sym} ${fired} (now $${px})`, proposal: null, token: null },
            { role: 'ai', text: text || 'Analysis unavailable.', proposal: null, token: t.sym || null },
          ],
          updatedAt: Date.now(),
        })
        await doc.ref.set({ chatId: chatRef.id }, { merge: true }).catch(() => {})
        await metering.track(db, uid, { pointerReqs: 1, taskRuns: 1 })
        await notify.send(db, admin, uid, {
          category: 'tasks', title: `⚡ ${t.sym} ${fired}`,
          body: String(text || '').slice(0, 140) || 'Pointer analyzed the move — open to read.',
          link: '/?goto=chat&session=' + chatRef.id, tag: 'task-' + doc.id,
        })
      } catch (e) {
        // Analysis failed — refund the metered unit and still notify the raw event.
        await metering.refund(db, uid, { kind: 'pointer', ...spent })
        await notify.send(db, admin, uid, { category: 'tasks', title: `⚡ ${t.sym} ${fired}`, body: `Now $${px}. (Pointer analysis failed: ${String(e.message).slice(0, 80)})`, link: '/?goto=chat', tag: 'task-' + doc.id })
      }
    }
    return null
  })

// ── Daily Digest (runs hourly; sends to users whose chosen hour matches) ───
// Opt-in via users/{uid}.digest = { enabled, hourUtc }. One metered Pointer
// run composes the digest from STRUCTURED data gathered here; it lands as a
// push + Telegram message and a saved chat session. Failures skip the day
// silently — a broken digest never error-spams the user.
exports.processDailyDigest = functions.region('europe-west1')
  .runWith({ secrets: [...ALL_SECRETS, SECRET_DEEPSEEK, SECRET_OPENAI], timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every 1 hours')
  .onRun(async () => {
    const hour = new Date().getUTCHours()
    const snap = await db.collection('users')
      .where('digest.enabled', '==', true)
      .where('digest.hourUtc', '==', hour)
      .limit(100).get()
    if (snap.empty) return null

    const cfg = await payments.billingConfig(db)
    const prov = cfg.raw.aiProvider === 'openai' ? 'openai' : 'deepseek'
    const apiKey = prov === 'openai' ? SECRET_OPENAI.value() : SECRET_DEEPSEEK.value()
    if (!apiKey) return null
    const axios = require('axios')

    for (const userDoc of snap.docs) {
      const uid = userDoc.id
      const d = userDoc.data()
      try {
        // Once per day, even across scheduler retries/restarts.
        if (d.digest.lastSentAt && Date.now() - d.digest.lastSentAt < 20 * 3600000) continue
        const plan = ['free', 'pro', 'elite'].includes(d.plan) ? d.plan : 'free'

        // ── Gather structured facts (never free text from external sources) ──
        const facts = []
        // Open positions with live prices.
        const posSnap = await db.collection(`users/${uid}/positions`).where('status', '==', 'open').limit(50).get().catch(() => null)
        const paperMode = d.paperMode === true
        const open = posSnap ? posSnap.docs.map((x) => x.data()).filter((p) => !!p.paper === paperMode) : []
        if (open.length) {
          const byChain = {}
          for (const p of open) (byChain[p.chain] = byChain[p.chain] || new Set()).add(String(p.tokenAddress).toLowerCase())
          const px = {}
          for (const [chain, set] of Object.entries(byChain)) px[chain] = await positions.batchPrices(chain, [...set])
          const rows = open.map((p) => {
            const cur = (px[p.chain] || {})[String(p.tokenAddress).toLowerCase()] || p.lastPriceUsd || 0
            const pnl = cur && p.avgEntryUsd ? ((cur / p.avgEntryUsd - 1) * 100) : null
            return { sym: p.tokenSymbol, pnlPct: pnl != null ? +pnl.toFixed(1) : null, exitArmed: !!p.exitArmed }
          }).sort((a, b) => Math.abs(b.pnlPct || 0) - Math.abs(a.pnlPct || 0))
          facts.push(`Open positions (${paperMode ? 'PAPER' : 'live'}): ` + rows.slice(0, 5).map((r) => `${r.sym} ${r.pnlPct != null ? (r.pnlPct >= 0 ? '+' : '') + r.pnlPct + '%' : 'n/a'}${r.exitArmed ? ' (exits armed)' : ''}`).join(', '))
        } else facts.push('No open positions.')
        // Signals from the last 24h.
        const sigSnap = await db.collection(`users/${uid}/signals`).where('generatedAt', '>', Date.now() - 86400000).limit(10).get().catch(() => null)
        if (sigSnap && sigSnap.size) {
          const best = sigSnap.docs.map((x) => x.data()).sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0]
          facts.push(`${sigSnap.size} signal(s) in the last 24h; strongest: ${String(best.bias || '').toUpperCase()} ${best.symbol} @ ${best.confidence}%`)
        }
        // Top watchlist movers (CoinGecko coins only — cheap single call).
        const wSnap = await db.collection(`users/${uid}/watchlist`).limit(30).get().catch(() => null)
        const cgIds = wSnap ? wSnap.docs.map((x) => x.data().cg).filter(Boolean).slice(0, 25) : []
        if (cgIds.length) {
          try {
            const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(cgIds.join(','))}&vs_currencies=usd&include_24hr_change=true`, { timeout: 10000 })
            const movers = Object.entries(data || {}).map(([id, v]) => ({ id, ch: v.usd_24h_change || 0 })).sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch)).slice(0, 3)
            if (movers.length) facts.push('Watchlist movers 24h: ' + movers.map((m) => `${m.id} ${m.ch >= 0 ? '+' : ''}${m.ch.toFixed(1)}%`).join(', '))
          } catch (_) {}
        }

        // One metered, non-deep Pointer run. Out of quota → skip silently.
        let spent
        try { spent = await metering.consume(db, uid, { kind: 'pointer', plan, cfg, count: 1, flagKey: 'pointer' }) }
        catch (_) { continue }

        try {
          const prompt = `[Automated daily digest] Compose the owner's morning crypto digest from these facts about their account:\n- ${facts.join('\n- ')}\nAdd one line of overall market context (you may use ONE tool call for market movers if helpful). Format: short, warm, mobile-friendly markdown — 4-6 lines max, lead with their portfolio. End with one actionable suggestion.`
          const { text } = await agentLib.runAgent({
            prompt, history: [], provider: prov, apiKey, surface: 'pointer',
            ctx: { uid, db, admin, trader, gemscanner, encryption, masterSecret: MASTER_SECRET(), heliusKey: SECRET_HELIUS.value() || null, moralisKey: SECRET_MORALIS.value() || null },
          })
          const chatRef = db.collection(`users/${uid}/pointerChats`).doc()
          const dayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          await chatRef.set({
            title: `🌅 Daily digest — ${dayStr}`,
            messages: [{ role: 'ai', text: text || 'Digest unavailable today.', proposal: null, token: null }],
            updatedAt: Date.now(),
          })
          await db.doc(`users/${uid}`).set({ digest: { ...d.digest, lastSentAt: Date.now() } }, { merge: true })
          await metering.track(db, uid, { pointerReqs: 1, digests: 1 })
          await notify.send(db, admin, uid, {
            category: 'system', title: `🌅 Your daily digest`,
            body: String(text || '').replace(/[*_#`]/g, '').slice(0, 140),
            link: '/?goto=chat&session=' + chatRef.id, tag: 'digest',
          })
          const chatId = (d.botSettings || {}).telegramChatId
          let tgToken = null
          try { tgToken = TG_TOKEN() } catch (_) {}
          if (chatId && tgToken) await tg.createBot(tgToken).sendMessage(chatId, `🌅 *Daily digest*\n\n${text}`, { parse_mode: 'Markdown' }).catch(() => {})
        } catch (e) {
          await metering.refund(db, uid, { kind: 'pointer', ...spent })
          console.warn(`digest failed for ${uid}: ${e.message}`) // silent for the user by design
        }
      } catch (e) { console.warn(`digest loop error for ${uid}: ${e.message}`) }
    }
    return null
  })

// ── Signal Outcome Tracker (runs every 30 minutes) ────────────────────────
// Resolves every published signal against its SL/TP levels using exchange
// candles and rolls outcomes into signalStats/{day} — the public track record.
exports.processSignalOutcomes = functions.region('europe-west1')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 30 minutes')
  .onRun(async () => {
    const res = await signalTracker.resolveSignals(db, admin)
    if (res.resolved) console.log(`signal outcomes: resolved ${res.resolved} of ${res.checked} recent signals`)
    return null
  })

// Public (authed) track-record aggregates for the Signals screen + paywall.
exports.getSignalStats = functions.region('europe-west1').runWith({ timeoutSeconds: 60 }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  return signalTracker.readStats(db)
})

// ── Gem Hindsight Tracker (runs hourly) ────────────────────────────────────
// Re-prices surfaced gems at their +24h / +7d marks so the scanner can show
// honest median/best performance of the gems it found.
exports.processGemOutcomes = functions.region('europe-west1')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 60 minutes')
  .onRun(async () => {
    const res = await gemTracker.resolveGemOutcomes(db)
    if (res.resolved) console.log(`gem outcomes: resolved ${res.resolved} of ${res.checked}`)
    return null
  })

// Hindsight stats for the Gem Scanner screen (median/best 24h & 7d).
exports.getGemStats = functions.region('europe-west1').runWith({ timeoutSeconds: 60 }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  return gemTracker.readStats(db)
})

// ── Snipe Queue Processor (runs every 1 minute) ───────────────────────────
exports.processSnipeQueue = fn.pubsub
  .schedule('every 1 minutes')
  .onRun(async () => {
    const pending = await db.collectionGroup('snipeTargets')
      .where('status', '==', 'pending').limit(20).get()

    if (pending.empty) return null

    await Promise.allSettled(pending.docs.map(async (snipeDoc) => {
      const snipe = snipeDoc.data()
      const uid   = snipeDoc.ref.parent.parent.id

      const userSnap = await db.doc(`users/${uid}`).get()
      if (!userSnap.exists) return

      const settings = userSnap.data().botSettings || {}
      if (!settings.botEnabled) return

      const wallets = settings.wallets || {}
      if (!wallets[snipe.chain]?.encryptedKey) return

      try {
        const info = await trader.checkToken(snipe.tokenAddress, snipe.chain)
        if (!info.found) return

        const minLiq = settings.minLiquidity || 5000
        if (info.liquidity < minLiq) return

        if (snipe.maxBuyPrice && parseFloat(info.price) > snipe.maxBuyPrice) return

        // Mark executing to prevent duplicate runs
        await snipeDoc.ref.update({ status: 'executing' })

        const pk     = encryption.decrypt(wallets[snipe.chain].encryptedKey, uid, MASTER_SECRET())
        const slip   = Math.min(snipe.slippage || settings.defaultSlippage || 5, 50)
        const gasX   = settings.defaultGasMultiplier || 1.2
        const result = snipe.chain === 'sol'
          ? await trader.buyTokenSOL(pk, snipe.tokenAddress, parseFloat(snipe.buyAmount), slip, settings.solRpc)
          : await trader.buyTokenEVM(snipe.chain, pk, snipe.tokenAddress, parseFloat(snipe.buyAmount), slip, settings[snipe.chain + 'Rpc'], gasX)

        await snipeDoc.ref.update({
          status: 'sniped', txHash: result.txHash,
          executedAt: admin.firestore.FieldValue.serverTimestamp()
        })

        await db.collection(`users/${uid}/trades`).add({
          chain: snipe.chain, tokenAddress: snipe.tokenAddress,
          tokenName: info.name, tokenSymbol: info.symbol,
          type: 'buy', amountIn: snipe.buyAmount,
          txHash: result.txHash, status: result.status, source: 'sniper',
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        })

        // Telegram notification
        const chatId = settings.telegramChatId
        let token
        try { token = TG_TOKEN() } catch (_) { token = null }
        if (chatId && token) {
          const bot = tg.createBot(token)
          const explorer = snipe.chain === 'bsc'  ? 'https://bscscan.com/tx/'    :
                           snipe.chain === 'eth'  ? 'https://etherscan.io/tx/'   :
                           snipe.chain === 'base' ? 'https://basescan.org/tx/'   :
                           snipe.chain === 'ton'  ? 'https://tonscan.org/tx/'    :
                           'https://solscan.io/tx/'
          await bot.sendMessage(chatId,
            `🎯 *Snipe Fired!*\n\n` +
            `Token: ${info.name} (${info.symbol})\n` +
            `Chain: ${snipe.chain.toUpperCase()}\n` +
            `Amount: ${snipe.buyAmount}\n` +
            `Price: $${parseFloat(info.price).toFixed(8)}\n` +
            `[View TX](${explorer}${result.txHash})`,
            { parse_mode: 'Markdown', disable_web_page_preview: true }
          ).catch(() => {})
        }

      } catch (err) {
        console.error(`Snipe ${snipeDoc.id} failed:`, err.message)
        await snipeDoc.ref.update({ status: 'failed', error: err.message })
      }
    }))

    return null
  })

// ── Save CEX API Key (encrypted server-side) ──────────────────────────────
exports.saveCexApiKey = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid = context.auth.uid
  const { exchange, apiKey, secret, passphrase } = data
  const validExchanges = new Set(['binance', 'mexc', 'bybit', 'kucoin'])

  if (!validExchanges.has(exchange))
    throw new functions.https.HttpsError('invalid-argument', 'Exchange must be binance, mexc, bybit, or kucoin')
  if (typeof apiKey !== 'string' || apiKey.trim().length < 10)
    throw new functions.https.HttpsError('invalid-argument', 'API key is too short')
  if (typeof secret !== 'string' || secret.trim().length < 10)
    throw new functions.https.HttpsError('invalid-argument', 'Secret is too short')

  const ms = MASTER_SECRET()
  const encryptedApiKey = encryption.encrypt(apiKey.trim(), uid, ms)
  const encryptedSecret = encryption.encrypt(secret.trim(), uid, ms)
  const keyEntry = { encryptedApiKey, encryptedSecret, maskedKey: '***' + apiKey.trim().slice(-6) }

  if (exchange === 'kucoin' && passphrase) {
    keyEntry.encryptedPassphrase = encryption.encrypt(passphrase.trim(), uid, ms)
  }

  await db.doc(`users/${uid}`).set(
    { agentSettings: { cexKeys: { [exchange]: keyEntry } } },
    { merge: true }
  )
  return { success: true, maskedKey: keyEntry.maskedKey }
})

// ── Remove CEX API Key ────────────────────────────────────────────────────
exports.removeCexApiKey = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid = context.auth.uid
  const { exchange } = data
  if (!['binance', 'mexc', 'bybit', 'kucoin'].includes(exchange))
    throw new functions.https.HttpsError('invalid-argument', 'Invalid exchange')

  await db.doc(`users/${uid}`).set(
    { agentSettings: { cexKeys: { [exchange]: admin.firestore.FieldValue.delete() } } },
    { merge: true }
  )
  return { success: true }
})

// ── Get CEX Spot Balances ─────────────────────────────────────────────────
exports.getCexBalances = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid      = context.auth.uid
  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) return { balances: {} }

  const ms      = MASTER_SECRET()
  const keys    = (userSnap.data().agentSettings || {}).cexKeys || {}
  const balances = {}

  await Promise.allSettled(
    Object.entries(keys).map(async ([exchange, keyEntry]) => {
      try {
        const apiKey     = encryption.decrypt(keyEntry.encryptedApiKey, uid, ms)
        const secret     = encryption.decrypt(keyEntry.encryptedSecret, uid, ms)
        const passphrase = keyEntry.encryptedPassphrase
          ? encryption.decrypt(keyEntry.encryptedPassphrase, uid, ms) : ''
        const creds = { apiKey, secret, passphrase }
        balances[exchange] = await cexTrader.getSpotBalance(exchange, creds, 'USDT')

        // Also fetch futures balance for exchanges that support it
        if (['binance', 'bybit', 'mexc'].includes(exchange)) {
          try {
            balances[exchange + '_futures'] = await cexTrader.getFuturesBalance(exchange, creds, 'USDT')
          } catch (_) {}
        }
      } catch (err) {
        balances[exchange] = { error: err.message }
      }
    })
  )
  return { balances }
})

// ── Run Agent Scan (callable — manual trigger) ────────────────────────────
exports.runAgentScan = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 300, memory: '512MB', secrets: ALL_SECRETS })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

    const uid      = context.auth.uid
    const userSnap = await db.doc(`users/${uid}`).get()
    if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found')

    const agentSettings = (userSnap.data().agentSettings || {})
    const exchanges     = agentSettings.exchanges  || ['binance', 'mexc', 'bybit', 'kucoin']
    // Manual scan can request market types; otherwise scan BOTH spot & futures so
    // the Signals screen's Spot/Futures filter always has both kinds to show.
    const reqTypes      = Array.isArray(data?.marketTypes) ? data.marketTypes.filter((m) => m === 'spot' || m === 'futures') : []
    const marketTypes   = reqTypes.length ? reqTypes : (agentSettings.marketTypes && agentSettings.marketTypes.length ? agentSettings.marketTypes : ['spot', 'futures'])
    const timeframe     = agentSettings.timeframe  || '4H'
    const minConfidence = agentSettings.minConfidence || 70

    // Fetch recent signals to deduplicate
    const recentSnap = await db.collection(`users/${uid}/signals`)
      .where('generatedAt', '>', Date.now() - 4 * 60 * 60 * 1000)
      .limit(50).get()
    const recentSignals = recentSnap.docs.map(d => d.data())

    const allAnalyses = []

    // Spot scan
    if (marketTypes.includes('spot')) {
      await Promise.allSettled(
        exchanges.map(async (ex) => {
          try {
            const results = await marketAnalyzer.scanExchange(ex, timeframe, 35, minConfidence)
            allAnalyses.push(...results)
          } catch (err) { console.error(`Spot scan ${ex}:`, err.message) }
        })
      )
    }

    // Futures scan (Binance USDM + Bybit Linear + MEXC Contract) — lower minScore floor for futures
    if (marketTypes.includes('futures')) {
      const futuresMinScore = Math.max(65, minConfidence - 5)
      await Promise.allSettled(
        ['binance', 'bybit', 'mexc'].map(async (ex) => {
          try {
            const results = await scanFuturesExchange(ex, timeframe, 30, futuresMinScore)
            console.log(`runAgentScan futures ${ex}: ${results.length} signals`)
            allAnalyses.push(...results)
          } catch (err) { console.error(`Futures scan ${ex}:`, err.message) }
        })
      )
    }

    console.log(`runAgentScan total analyses: ${allAnalyses.length} (spot+futures)`)

    // Deduplicate — keep highest score per symbol+bias+marketType
    const symbolMap = {}
    for (const a of allAnalyses) {
      const key = `${a.symbol}_${a.bias}_${a.marketType || 'spot'}`
      if (!symbolMap[key] || a.score > symbolMap[key].score) symbolMap[key] = a
    }

    console.log(`runAgentScan unique analyses after dedup: ${Object.keys(symbolMap).length}`)

    const newSignals = []
    for (const analysis of Object.values(symbolMap)) {
      if (signalGen.isDuplicateSignal(analysis, recentSignals)) continue
      const signal = signalGen.generateSignal(analysis, exchanges)
      if (!signal) continue
      const ref = await db.collection(`users/${uid}/signals`).add(signal)
      newSignals.push({ ...signal, id: ref.id })
    }

    await db.doc(`users/${uid}`).set(
      { agentSettings: { lastScanAt: Date.now(), lastScanSignals: newSignals.length } },
      { merge: true }
    )

    return { signals: newSignals, scannedAt: Date.now() }
  })

// ── Approve Trade (callable — execute a pending signal) ───────────────────
exports.approveTrade = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid      = context.auth.uid
  const { signalId, riskPercent } = data

  if (!signalId) throw new functions.https.HttpsError('invalid-argument', 'signalId required')

  const signalRef  = db.doc(`users/${uid}/signals/${signalId}`)
  const signalSnap = await signalRef.get()
  if (!signalSnap.exists) throw new functions.https.HttpsError('not-found', 'Signal not found')

  const signal = signalSnap.data()
  if (signal.status !== 'pending') throw new functions.https.HttpsError('failed-precondition', `Signal is already ${signal.status}`)
  if (signal.expiresAt < Date.now()) {
    await signalRef.update({ status: 'expired' })
    throw new functions.https.HttpsError('failed-precondition', 'Signal has expired')
  }

  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found')

  const ms   = MASTER_SECRET()
  const keys = (userSnap.data().agentSettings || {}).cexKeys || {}

  // Use caller-supplied exchange if provided, otherwise fall back to signal origin
  const validExchanges = new Set(['binance', 'mexc', 'bybit', 'kucoin'])
  const requestedEx = data.targetExchange && validExchanges.has(data.targetExchange)
    ? data.targetExchange
    : signal.exchange
  const ex = requestedEx

  if (!keys[ex]?.encryptedApiKey)
    throw new functions.https.HttpsError('failed-precondition', `No ${ex.toUpperCase()} API key configured. Add it in Agent → CEX Setup.`)

  const apiKey     = encryption.decrypt(keys[ex].encryptedApiKey, uid, ms)
  const secret     = encryption.decrypt(keys[ex].encryptedSecret, uid, ms)
  const passphrase = keys[ex].encryptedPassphrase
    ? encryption.decrypt(keys[ex].encryptedPassphrase, uid, ms) : ''

  const riskPct    = Math.max(0.5, Math.min(parseFloat(riskPercent) || 2, 10))
  const marketType = signal.marketType || 'spot'
  const leverage   = signal.leverage   || 5
  const side       = signal.bias === 'short' ? 'sell' : 'buy'

  // Futures restricted to exchanges with futures support
  if (marketType === 'futures' && !['binance', 'bybit', 'mexc'].includes(ex)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Futures orders are supported on Binance, Bybit, and MEXC. Please select one of these exchanges.`
    )
  }

  // Fetch USDT balance from the appropriate account (spot or futures)
  let usdtBalance = 100
  try {
    const bal = marketType === 'futures'
      ? await cexTrader.getFuturesBalance(ex, { apiKey, secret, passphrase }, 'USDT')
      : await cexTrader.getSpotBalance(ex, { apiKey, secret, passphrase }, 'USDT')
    usdtBalance = bal.free
  } catch (_) {}

  const tradeUSDT = usdtBalance * (riskPct / 100)

  await signalRef.update({ status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp() })

  try {
    const result = await cexTrader.placeOrderSafe(
      ex, { apiKey, secret, passphrase }, signal.symbol,
      tradeUSDT, signal.currentPrice, marketType, leverage, side
    )

    await signalRef.update({
      status: 'executed', executedAt: admin.firestore.FieldValue.serverTimestamp(),
      orderId: result.orderId, tradeUSDT, executedOnExchange: ex,
    })

    await db.collection(`users/${uid}/cexTrades`).add({
      signalId, exchange: ex, symbol: signal.symbol, bias: signal.bias,
      marketType, leverage: marketType === 'futures' ? leverage : null,
      orderId: result.orderId, orderStatus: result.status,
      tradeUSDT, entryPrice: signal.entry,
      stopLoss: signal.stopLoss, tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3,
      riskReward: signal.riskReward, confidence: signal.confidence,
      source: 'web-approval', status: 'open', pnl: null,
      openedAt: admin.firestore.FieldValue.serverTimestamp(), closedAt: null,
    })

    return { success: true, orderId: result.orderId, tradeUSDT }
  } catch (err) {
    await signalRef.update({ status: 'pending' })
    throw new functions.https.HttpsError('internal', `Order failed: ${err.message}`)
  }
})

// ── Skip Signal ───────────────────────────────────────────────────────────
exports.skipSignal = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid      = context.auth.uid
  const { signalId } = data
  if (!signalId) throw new functions.https.HttpsError('invalid-argument', 'signalId required')

  await db.doc(`users/${uid}/signals/${signalId}`).update({ status: 'skipped' })
  return { success: true }
})

// ── Save Agent Settings ───────────────────────────────────────────────────
exports.saveAgentSettings = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const uid = context.auth.uid
  const allowed = ['enabled', 'exchanges', 'timeframe', 'minConfidence', 'riskPercent', 'maxConcurrentTrades', 'autoExecute', 'telegramSignals', 'scanInterval', 'marketTypes']
  const settings = {}
  for (const k of allowed) {
    if (data[k] !== undefined) settings[k] = data[k]
  }
  await db.doc(`users/${uid}`).set({ agentSettings: settings }, { merge: true })
  return { success: true }
})

// ── Agent Scheduler (runs every 15 minutes) ───────────────────────────────
exports.processAgentScans = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '1GB', secrets: ALL_SECRETS })
  .pubsub.schedule('every 15 minutes')
  .onRun(async () => {
    const snap = await db.collection('users')
      .where('agentSettings.enabled', '==', true)
      .limit(10).get()

    if (snap.empty) return null

    let tgToken
    try { tgToken = TG_TOKEN() } catch (_) { tgToken = null }

    await Promise.allSettled(snap.docs.map(async (userDoc) => {
      const uid           = userDoc.id
      const userData      = userDoc.data()
      const agentSettings = userData.agentSettings || {}
      const chatId        = (userData.botSettings || {}).telegramChatId

      const exchanges     = agentSettings.exchanges  || ['binance', 'mexc', 'bybit', 'kucoin']
      const marketTypes   = agentSettings.marketTypes || ['spot']
      const timeframe     = agentSettings.timeframe  || '4H'
      const minConfidence = agentSettings.minConfidence || 70
      const autoExecute   = agentSettings.autoExecute || false
      const ms            = MASTER_SECRET()

      // Fetch recent signals to deduplicate
      let recentSignals = []
      try {
        const recentSnap = await db.collection(`users/${uid}/signals`)
          .where('generatedAt', '>', Date.now() - 4 * 60 * 60 * 1000)
          .limit(50).get()
        recentSignals = recentSnap.docs.map(d => d.data())
      } catch (_) {}

      // Spot scan
      const allAnalyses = []
      if (marketTypes.includes('spot')) {
        for (const ex of exchanges) {
          try {
            const results = await marketAnalyzer.scanExchange(ex, timeframe, 30, minConfidence)
            allAnalyses.push(...results)
          } catch (err) { console.error(`Agent spot scan ${ex} for ${uid}:`, err.message) }
        }
      }

      // Futures scan (Binance USDM + Bybit Linear + MEXC Contract)
      if (marketTypes.includes('futures')) {
        const futuresMinScore = Math.max(65, minConfidence - 5)
        for (const ex of ['binance', 'bybit', 'mexc']) {
          try {
            const results = await scanFuturesExchange(ex, timeframe, 25, futuresMinScore)
            console.log(`processAgentScans futures ${ex} for ${uid}: ${results.length} signals`)
            allAnalyses.push(...results)
          } catch (err) { console.error(`Agent futures scan ${ex} for ${uid}:`, err.message) }
        }
      }

      // Deduplicate — keep best score per symbol+bias+marketType
      const symbolMap = {}
      for (const a of allAnalyses) {
        const key = `${a.symbol}_${a.bias}_${a.marketType || 'spot'}`
        if (!symbolMap[key] || a.score > symbolMap[key].score) symbolMap[key] = a
      }

      const newSignals = []
      for (const analysis of Object.values(symbolMap).slice(0, 8)) {
        if (signalGen.isDuplicateSignal(analysis, recentSignals)) continue
        const signal = signalGen.generateSignal(analysis, exchanges)
        if (!signal) continue

        const ref = await db.collection(`users/${uid}/signals`).add(signal)
        newSignals.push({ id: ref.id, ...signal })
        recentSignals.push(signal) // prevent duplicates within same run
      }

      await db.doc(`users/${uid}`).set(
        { agentSettings: { lastScanAt: Date.now(), lastScanSignals: newSignals.length } },
        { merge: true }
      )

      // One summary push per scan (not one per signal — that would spam).
      if (newSignals.length > 0) {
        const first = newSignals[0]
        await notify.send(db, admin, uid, {
          category: 'signals',
          title: `📡 ${newSignals.length} new signal${newSignals.length > 1 ? 's' : ''}`,
          body: `${first.bias.toUpperCase()} ${first.symbol} · ${first.confidence}%${newSignals.length > 1 ? ` + ${newSignals.length - 1} more` : ''}`,
          link: '/?goto=signals', tag: 'signals-scan',
        })
      }

      // Send Telegram signals
      if (chatId && tgToken && agentSettings.telegramSignals !== false && newSignals.length > 0) {
        const bot = tg.createBot(tgToken)
        for (const signal of newSignals.slice(0, 5)) {
          try {
            const { text, keyboard } = signalGen.formatTelegramSignalWithButtons(signal, signal.id)
            const sentMsg = await bot.sendMessage(chatId, text, {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            })
            const msgId = sentMsg?.result?.message_id
            if (msgId) await db.doc(`users/${uid}/signals/${signal.id}`).update({ telegramMessageId: msgId })

            // Auto-execute if enabled and API key is set
            if (autoExecute) {
              const keys       = agentSettings.cexKeys || {}
              const ex         = signal.exchange
              const mktType    = signal.marketType || 'spot'
              const leverage   = signal.leverage   || 5
              const side       = signal.bias === 'short' ? 'sell' : 'buy'
              const futuresExchanges = new Set(['binance', 'bybit', 'mexc'])

              // Futures signals only supported on compatible exchanges
              if (mktType === 'futures' && !futuresExchanges.has(ex)) {
                console.log(`Auto-execute skipped: ${signal.symbol} futures not supported on ${ex}`)
              } else if (keys[ex]?.encryptedApiKey) {
                try {
                  const apiKey     = encryption.decrypt(keys[ex].encryptedApiKey, uid, ms)
                  const secret     = encryption.decrypt(keys[ex].encryptedSecret, uid, ms)
                  const passphrase = keys[ex].encryptedPassphrase
                    ? encryption.decrypt(keys[ex].encryptedPassphrase, uid, ms) : ''
                  const creds = { apiKey, secret, passphrase }

                  let usdtBalance = 100
                  try {
                    const bal = mktType === 'futures'
                      ? await cexTrader.getFuturesBalance(ex, creds, 'USDT')
                      : await cexTrader.getSpotBalance(ex, creds, 'USDT')
                    usdtBalance = bal.free
                  } catch (_) {}

                  const riskPct  = agentSettings.riskPercent || 2
                  const tradeAmt = usdtBalance * (riskPct / 100)

                  const result = await cexTrader.placeOrderSafe(
                    ex, creds, signal.symbol, tradeAmt, signal.currentPrice, mktType, leverage, side
                  )

                  await db.doc(`users/${uid}/signals/${signal.id}`).update({
                    status: 'executed', approvedAt: admin.firestore.FieldValue.serverTimestamp(),
                    executedAt: admin.firestore.FieldValue.serverTimestamp(), orderId: result.orderId, tradeAmt,
                  })
                  await db.collection(`users/${uid}/cexTrades`).add({
                    signalId: signal.id, exchange: ex, symbol: signal.symbol, bias: signal.bias,
                    marketType: mktType, leverage: mktType === 'futures' ? leverage : null,
                    orderId: result.orderId, tradeUSDT: tradeAmt, entryPrice: signal.entry,
                    stopLoss: signal.stopLoss, tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3,
                    riskReward: signal.riskReward, confidence: signal.confidence,
                    source: 'auto-agent', status: 'open', pnl: null,
                    openedAt: admin.firestore.FieldValue.serverTimestamp(), closedAt: null,
                  })
                  await bot.sendMessage(chatId,
                    `🤖 *Auto-Executed!* ${signal.symbol} ${signal.bias.toUpperCase()}` +
                    (mktType === 'futures' ? ` ⚡${leverage}x` : '') +
                    `\nOrder ID: \`${result.orderId}\``,
                    { parse_mode: 'Markdown' }
                  ).catch(() => {})
                } catch (execErr) {
                  console.error(`Auto-execute ${signal.symbol}:`, execErr.message)
                  await bot.sendMessage(chatId, `⚠️ Auto-execute failed for ${signal.symbol}: ${execErr.message}`).catch(() => {})
                }
              }
            }

            await new Promise(r => setTimeout(r, 500)) // rate limit between TG messages
          } catch (tgErr) {
            console.error(`TG signal send error:`, tgErr.message)
          }
        }
      }
    }))

    return null
  })


// ══════════════════════════════════════════════════════════════════════════
// Discord AI Operations Agent (DeepSeek or ChatGPT — switchable per user)
// ══════════════════════════════════════════════════════════════════════════

// ── Generate a code to link a Discord account to this user ─────────────────
exports.generateDiscordCode = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid    = context.auth.uid
  const code   = crypto.randomBytes(4).toString('hex').toUpperCase()
  const expiry = Date.now() + 10 * 60 * 1000
  await db.doc(`users/${uid}`).set(
    { botSettings: { discordLinkCode: code, discordLinkExpiry: expiry } },
    { merge: true }
  )
  return { code }
})

// Resolve a Discord user id to a Firebase uid (null if unlinked)
async function discordUidFor(discordUserId) {
  if (!discordUserId) return null
  const snap = await db.collection('users')
    .where('botSettings.discordUserId', '==', String(discordUserId)).limit(1).get()
  return snap.empty ? null : snap.docs[0].id
}

// ── Discord interactions endpoint (HTTP webhook) ───────────────────────────
// Verifies the signature, ACKs within 3s, and hands real work to the Pub/Sub
// worker below (Cloud Functions can't reliably run work after responding).
exports.discordInteractions = discordFn.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return }

  const sig = req.get('x-signature-ed25519')
  const ts  = req.get('x-signature-timestamp')
  const ok  = discordLib.verifyRequest(req.rawBody, sig, ts, SECRET_DISCORD_PUBKEY.value() || '')
  if (!ok) { res.status(401).send('invalid request signature'); return }

  const body = req.body || {}
  const { T } = discordLib

  // PING handshake
  if (body.type === T.PING) { res.json({ type: T.PONG }); return }

  const discordUserId = body.member?.user?.id || body.user?.id || null
  const appId = SECRET_DISCORD_APPID.value()

  // Slash commands
  if (body.type === T.APP_COMMAND) {
    const name = body.data?.name
    const opt = (n) => (body.data?.options || []).find(o => o.name === n)?.value

    if (name === 'link') {
      const code = String(opt('code') || '').trim().toUpperCase()
      const snap = await db.collection('users').where('botSettings.discordLinkCode', '==', code).limit(1).get()
      let msg
      if (snap.empty) msg = '❌ Invalid code. Generate a fresh one in the app.'
      else {
        const doc = snap.docs[0]
        const exp = doc.data().botSettings?.discordLinkExpiry || 0
        if (Date.now() > exp) msg = '❌ Code expired. Generate a new one.'
        else {
          await doc.ref.set({ botSettings: { discordUserId: String(discordUserId), discordVerified: true, discordLinkCode: null, discordLinkExpiry: null } }, { merge: true })
          msg = '✅ Linked! You can now talk to your FXcrypt agent with `/ask`.'
        }
      }
      res.json({ type: T.CHANNEL_MESSAGE, data: { content: msg, flags: 64 } }) // ephemeral
      return
    }

    if (name === 'ask') {
      const prompt = String(opt('prompt') || '').trim()
      await publishDiscordJob({ kind: 'ask', prompt, discordUserId, token: body.token, appId })
      res.json({ type: T.DEFERRED_CHANNEL_MESSAGE })
      return
    }

    res.json({ type: T.CHANNEL_MESSAGE, data: { content: 'Unknown command.', flags: 64 } })
    return
  }

  // Button clicks (trade approval)
  if (body.type === T.MESSAGE_COMPONENT) {
    const cid = body.data?.custom_id || ''
    const [tag, proposalId] = cid.split(':')
    if (tag === 'tappr' || tag === 'trej') {
      await publishDiscordJob({ kind: tag === 'tappr' ? 'approve' : 'reject', proposalId, discordUserId, token: body.token, appId })
      res.json({ type: T.DEFERRED_UPDATE_MESSAGE })
      return
    }
    res.json({ type: T.DEFERRED_UPDATE_MESSAGE })
    return
  }

  res.json({ type: T.PONG })
})

async function publishDiscordJob(payload) {
  const { PubSub } = require('@google-cloud/pubsub')
  const pubsub = new PubSub()
  await pubsub.topic(DISCORD_TOPIC).publishMessage({ json: payload })
}

function tradeButtons(proposalId) {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: '✅ Approve', custom_id: `tappr:${proposalId}` },
    { type: 2, style: 4, label: '❌ Reject',  custom_id: `trej:${proposalId}` },
  ] }]
}

// ── Pub/Sub worker: runs the agent / executes approved trades ──────────────
exports.processDiscordAgent = discordFn
  .runWith({ secrets: DISCORD_SECRETS, timeoutSeconds: 300, memory: '512MB' })
  .pubsub.topic(DISCORD_TOPIC)
  .onPublish(async (message) => {
    const job = message.json || {}
    const { kind, discordUserId, token, appId } = job
    const edit = (payload) => discordLib.editOriginal(appId, token, payload).catch(e => console.error('Discord edit failed:', e.message))

    const uid = await discordUidFor(discordUserId)
    if (!uid) { await edit({ content: '🔗 Your Discord isn\'t linked yet. In the app generate a code, then run `/link <code>` here.' }); return }

    const ctx = {
      uid, db, admin, trader, gemscanner, encryption,
      masterSecret: MASTER_SECRET(), heliusKey: SECRET_HELIUS.value() || null,
      moralisKey: SECRET_MORALIS.value() || null,
    }

    try {
      if (kind === 'ask') {
        const stateRef = db.doc(`users/${uid}/agentState/discord`)
        const [stateSnap, userSnap] = await Promise.all([stateRef.get(), db.doc(`users/${uid}`).get()])
        const history = (stateSnap.exists && stateSnap.data().history) || []

        // Per-user AI model choice (set from the app); default DeepSeek.
        const provider = (userSnap.data()?.botSettings?.aiProvider) === 'openai' ? 'openai' : 'deepseek'
        const apiKey = provider === 'openai' ? SECRET_OPENAI.value() : SECRET_DEEPSEEK.value()
        if (!apiKey) { await edit({ content: `⚠️ No API key configured for ${provider === 'openai' ? 'ChatGPT' : 'DeepSeek'}. Set its key in Cloud secrets or switch models in the app.` }); return }

        const { text, proposal, history: newHistory } = await agentLib.runAgent({
          prompt: job.prompt, history, ctx, provider, apiKey,
        })
        await stateRef.set({ history: newHistory, updatedAt: Date.now() }, { merge: true })

        if (proposal) {
          const ref = await db.collection(`users/${uid}/discordProposals`).add({ ...proposal, status: 'pending', createdAt: Date.now() })
          const native = agentLib.NATIVE[proposal.chain] || proposal.chain.toUpperCase()
          const size = proposal.action === 'buy' ? `${proposal.amount} ${native}` : `${proposal.percent}%`
          const card =
            `${discordLib.clamp(text, 1400)}\n\n` +
            `**🔔 Trade proposal — approval required**\n` +
            `> ${proposal.action.toUpperCase()} **${proposal.tokenSymbol || proposal.tokenAddress}** on ${proposal.chain.toUpperCase()} · ${size}\n` +
            `> \`${proposal.tokenAddress}\``
          await edit({ content: card, components: tradeButtons(ref.id) })
        } else {
          await edit({ content: discordLib.clamp(text) })
        }
        return
      }

      if (kind === 'approve' || kind === 'reject') {
        const pRef = db.doc(`users/${uid}/discordProposals/${job.proposalId}`)
        const pSnap = await pRef.get()
        if (!pSnap.exists) { await edit({ content: '⚠️ Proposal not found or expired.', components: [] }); return }
        const p = pSnap.data()
        if (p.status !== 'pending') { await edit({ content: `This proposal was already **${p.status}**.`, components: [] }); return }

        if (kind === 'reject') {
          await pRef.update({ status: 'rejected' })
          await edit({ content: `❌ **Rejected** — ${p.action.toUpperCase()} ${p.tokenSymbol || p.tokenAddress} on ${p.chain.toUpperCase()}. No trade made.`, components: [] })
          return
        }

        await edit({ content: `⏳ Executing ${p.action.toUpperCase()} ${p.tokenSymbol || p.tokenAddress} on ${p.chain.toUpperCase()}…`, components: [] })
        try {
          const result = await agentLib.executeProposedTrade(ctx, p)
          await pRef.update({ status: 'executed', txHash: result.txHash || null })
          await edit({ content: `✅ **Executed** — ${p.action.toUpperCase()} ${p.tokenSymbol || p.tokenAddress} on ${p.chain.toUpperCase()}\nStatus: ${result.status}` + (result.txHash ? `\nTx: \`${result.txHash}\`` : ''), components: [] })
        } catch (e) {
          await pRef.update({ status: 'failed', error: e.message })
          await edit({ content: `⚠️ **Trade failed** — ${e.message}`, components: [] })
        }
        return
      }
    } catch (e) {
      console.error('processDiscordAgent error:', e)
      await edit({ content: '⚠️ Agent error: ' + (e.message || 'failed') })
    }
  })



// ── Pointer chat (web AI agent — DeepSeek/ChatGPT, same tools as Discord) ───
exports.chatPointer = functions
  .region('europe-west1')
  .runWith({ secrets: [...ALL_SECRETS, SECRET_DEEPSEEK, SECRET_OPENAI], timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
    const uid = context.auth.uid
    const prompt = String(data?.prompt || '').trim()
    if (!prompt) throw new functions.https.HttpsError('invalid-argument', 'prompt is required')

    const history = Array.isArray(data?.history)
      ? data.history.slice(-12).filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').map((h) => ({ role: h.role, content: h.content }))
      : []

    // Deep-research toggle → run the admin provider's top-tier model with more
    // reasoning headroom for harder questions.
    const deep = data?.deep === true

    // Load billing config + the user's plan for metering and model selection.
    const cfg = await payments.billingConfig(db)
    const userSnap = await db.doc(`users/${uid}`).get()
    const userDoc = userSnap.exists ? userSnap.data() : {}
    const plan = ['free', 'pro', 'elite'].includes(userDoc.plan) ? userDoc.plan : 'free'

    // Deep research requires its own feature flag (in addition to `pointer`)
    // AND a paid plan (roadmap 4.3 — the flag stays as the admin kill-switch).
    if (deep && !metering.flagEnabled(userDoc, 'deepResearch')) {
      throw new functions.https.HttpsError('permission-denied', 'Deep research is disabled on your account.')
    }
    if (deep && plan === 'free') {
      throw new functions.https.HttpsError('permission-denied', 'Deep research uses our most capable model and is a Pro feature — upgrade to unlock it.')
    }

    // Meter the request: consume 1 unit of the monthly Pointer allowance (then
    // credits). Blocks when the feature is disabled or the quota is exhausted.
    let spent
    try {
      spent = await metering.consume(db, uid, { kind: 'pointer', plan, cfg, count: 1, flagKey: 'pointer' })
    } catch (e) {
      if (e.kind === 'feature-disabled') throw new functions.https.HttpsError('permission-denied', 'Pointer is disabled on your account. Contact support.')
      if (e.kind === 'quota-exhausted') {
        const i = e.info || {}
        const pack = cfg.creditPack || { usd: 10, credits: 50 }
        const err = new functions.https.HttpsError('resource-exhausted',
          `You've used all ${i.quota} Pointer requests for this period. Buy ${pack.credits} more credits for $${pack.usd}, upgrade your plan, or wait until your allowance resets.`,
          { code: 'quota_exhausted', quota: i.quota, used: i.used, credits: i.credits, resetsAt: i.resetsAt, pack })
        throw err
      }
      throw new functions.https.HttpsError('internal', 'Usage check failed. Try again.')
    }

    // Provider/model is chosen centrally by the admin (config/billing.aiProvider).
    // Users no longer switch models in-app; the client request can't override it.
    // The admin may optionally pin the deep-research model via config/billing.aiDeepModel.
    let prov = cfg.raw.aiProvider === 'openai' ? 'openai' : 'deepseek'
    let deepModel = cfg.raw.aiDeepModel ? String(cfg.raw.aiDeepModel) : null
    const apiKey = prov === 'openai' ? SECRET_OPENAI.value() : SECRET_DEEPSEEK.value()
    if (!apiKey) {
      await metering.refund(db, uid, { kind: 'pointer', ...spent })
      throw new functions.https.HttpsError('failed-precondition', `No API key configured for ${prov === 'openai' ? 'ChatGPT' : 'DeepSeek'}`)
    }

    const ctx = {
      uid, db, admin, trader, gemscanner, encryption,
      masterSecret: MASTER_SECRET(), heliusKey: SECRET_HELIUS.value() || null, moralisKey: SECRET_MORALIS.value() || null,
    }
    try {
      const { text, proposal, history: newHistory, model, sources } = await agentLib.runAgent({ prompt, history, ctx, provider: prov, apiKey, surface: 'pointer', deep, deepModel })
      await metering.track(db, uid, { pointerReqs: 1, ...(deep ? { deepReqs: 1 } : {}) })
      const usage = { used: spent.used, remaining: spent.remaining, credits: spent.credits, quota: spent.quota, resetsAt: spent.resetsAt }
      return { text, proposal: proposal || null, history: newHistory, provider: prov, deep, model, usage, sources: sources || [] }
    } catch (e) {
      // Infra failure — refund the metered unit so a failed call isn't charged.
      await metering.refund(db, uid, { kind: 'pointer', ...spent })
      await metering.track(db, uid, { pointerErrors: 1 })
      throw new functions.https.HttpsError('internal', e.message || 'Pointer failed')
    }
  })


// ═══════════════════════════════════════════════════════════════════════════
//  PREMIUM PAYMENTS (Stripe + on-chain crypto) and ADMIN CONTROL PANEL
// ═══════════════════════════════════════════════════════════════════════════
const billingFn   = functions.region('europe-west1').runWith({ secrets: BILLING_SECRETS, timeoutSeconds: 60 })
const cryptoPayFn = functions.region('europe-west1').runWith({ secrets: CRYPTO_PAY_SECRETS, timeoutSeconds: 60 })
const plainFn     = functions.region('europe-west1').runWith({ timeoutSeconds: 60 })
const adminFn     = functions.region('europe-west1').runWith({ timeoutSeconds: 60, memory: '256MB' })

// ── Stripe Checkout (subscription OR one-time, caller chooses) ──
exports.createStripeCheckout = billingFn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const email = context.auth.token.email || undefined
  const plan = data?.plan === 'elite' ? 'elite' : 'pro'
  const annual = data?.billing === 'annual'
  const mode = (data?.billing === 'subscription' || annual) ? 'subscription' : 'payment'
  const key = SECRET_STRIPE.value()
  if (!key || key === 'REPLACE_ME') throw new functions.https.HttpsError('failed-precondition', 'Card payments are not configured yet — please use crypto, or contact support.')
  const stripe = require('stripe')(key)
  const cfg = await payments.billingConfig(db)
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1)
  let line_items
  if (annual) {
    // Annual = 12 months for the price of 10 (inline recurring price — no
    // Stripe dashboard setup needed). Renews yearly; webhook grants like any
    // subscription (clearExpiry).
    const usd = Math.round(cfg.prices[plan] * 10)
    line_items = [{ price_data: { currency: 'usd', product_data: { name: `FXcrypt ${planName} — Annual (2 months free)` }, recurring: { interval: 'year' }, unit_amount: usd * 100 }, quantity: 1 }]
  } else if (mode === 'subscription') {
    const priceId = cfg.stripePriceIds[plan === 'elite' ? 'eliteMonthly' : 'proMonthly']
    if (!priceId) throw new functions.https.HttpsError('failed-precondition', 'Subscription pricing not configured (set config/billing.stripePriceIds)')
    line_items = [{ price: priceId, quantity: 1 }]
  } else {
    const usd = cfg.prices[plan]
    line_items = [{ price_data: { currency: 'usd', product_data: { name: `FXcrypt ${planName} — 30 days` }, unit_amount: Math.round(usd * 100) }, quantity: 1 }]
  }
  const base = cfg.frontendUrl.replace(/\/$/, '')
  const session = await stripe.checkout.sessions.create({
    mode, line_items,
    customer_email: email,
    client_reference_id: uid,
    metadata: { uid, plan, billing: annual ? 'annual' : mode },
    success_url: `${base}/?upgrade=success`,
    cancel_url: `${base}/?upgrade=cancel`,
    allow_promotion_codes: true,
    ...(mode === 'subscription' ? { subscription_data: { metadata: { uid, plan } } } : {}),
  })
  return { url: session.url, sessionId: session.id }
})

// ── Pointer usage snapshot (for the in-app usage pill / paywall) ──
exports.getPointerUsage = plainFn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const cfg = await payments.billingConfig(db)
  const snap = await db.doc(`users/${uid}`).get()
  const d = snap.exists ? snap.data() : {}
  const plan = ['free', 'pro', 'elite'].includes(d.plan) ? d.plan : 'free'
  const u = metering.readUsage(d, plan, cfg, 'pointer')
  const flags = d.featureFlags || {}
  return {
    plan, quota: u.quota, used: u.used, remaining: u.remaining, credits: u.credits, resetsAt: u.resetsAt,
    pack: cfg.creditPack,
    flags: { pointer: flags.pointer !== false, deepResearch: flags.deepResearch !== false },
  }
})

// ── Public plan pricing (admin-set) ─────────────────────────────────────────
// The paywall's price cards must always match what the admin configured in
// config/billing.planPricesUsd (which is what crypto invoices actually charge).
// Prices aren't sensitive, so no auth — the paywall can render before sign-in.
exports.getPlans = functions.region('europe-west1').runWith({ timeoutSeconds: 10 }).https.onCall(async () => {
  const cfg = await payments.billingConfig(db)
  return { prices: { free: 0, pro: cfg.prices.pro, elite: cfg.prices.elite }, creditPack: cfg.creditPack, tradingFee: cfg.tradingFee }
})

// ── Paywall conversion funnel (roadmap 4.3) ────────────────────────────────
// Global daily counters in funnel/{YYYY-MM-DD}: paywallView / checkoutStart
// (client-reported via this callable) and checkoutComplete (webhook-stamped —
// completions are never client-reported). Surfaced in adminStats.
const FUNNEL_EVENTS = new Set(['paywallView', 'checkoutStart'])
async function bumpFunnel(field) {
  try {
    const day = new Date().toISOString().slice(0, 10)
    await db.doc(`funnel/${day}`).set({ [field]: admin.firestore.FieldValue.increment(1) }, { merge: true })
  } catch (_) { /* analytics only */ }
}
exports.trackFunnel = functions.region('europe-west1').runWith({ timeoutSeconds: 10 }).https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const ev = String(data?.event || '')
  if (FUNNEL_EVENTS.has(ev)) await bumpFunnel(ev)
  return { ok: true }
})

// ── Referral program ────────────────────────────────────────────────────────
// Codes are deterministic (FX + first 6 of uid, uppercased) and registered in
// the server-only `referralCodes/{code}` collection on first read; collisions
// extend the code with more uid characters. Rewards are paid by
// payments.processReferralReward from every successful-payment path.
async function ensureReferralCode(uid) {
  for (let len = 6; len <= 20; len += 2) {
    const code = ('FX' + uid.slice(0, len).toUpperCase()).replace(/[^A-Z0-9]/g, '')
    const ref = db.doc(`referralCodes/${code}`)
    const snap = await ref.get()
    if (!snap.exists) { await ref.set({ uid, clicks: 0, createdAt: Date.now() }); return code }
    if (snap.data().uid === uid) return code
    // extremely rare prefix collision → try a longer code
  }
  throw new Error('Could not allocate a referral code')
}

exports.getReferralInfo = plainFn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const cfg = await payments.billingConfig(db)
  const code = await ensureReferralCode(uid)
  const [regSnap, userSnap] = await Promise.all([db.doc(`referralCodes/${code}`).get(), db.doc(`users/${uid}`).get()])
  const stats = (userSnap.exists && userSnap.data().referralStats) || {}
  return {
    code,
    link: `${cfg.frontendUrl.replace(/\/$/, '')}/?ref=${code}`,
    rewardCredits: cfg.referral.rewardCredits,
    enabled: cfg.referral.enabled !== false,
    stats: {
      clicks: (regSnap.exists && regSnap.data().clicks) || 0,
      signups: stats.signups || 0,
      paid: stats.paid || 0,
      earnedCredits: stats.earnedCredits || 0,
    },
  }
})

// Public click counter for referral links (?ref=CODE → sendBeacon here).
// Best-effort by design: no auth, cheap increment, invalid codes are no-ops.
exports.refClick = functions.region('europe-west1').runWith({ timeoutSeconds: 10 }).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Methods', 'POST, GET'); return res.status(204).send('') }
  const code = String(req.query.code || (req.body && req.body.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 22)
  if (code.length >= 6) {
    const ref = db.doc(`referralCodes/${code}`)
    try { const s = await ref.get(); if (s.exists) await ref.set({ clicks: admin.firestore.FieldValue.increment(1) }, { merge: true }) } catch (_) {}
  }
  res.status(204).send('')
})

// Signup attribution: when a new user doc carries a referral code, count the
// signup for the referrer (rewards wait for the first payment).
exports.onUserCreated = functions.region('europe-west1')
  .runWith({ timeoutSeconds: 30 })
  .firestore.document('users/{uid}')
  .onCreate(async (snap, context) => {
    try {
      const d = snap.data() || {}
      const code = String(d.referredBy || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 22)
      if (!code) return null
      const reg = await db.doc(`referralCodes/${code}`).get()
      const refUid = reg.exists ? reg.data().uid : null
      if (!refUid || refUid === context.params.uid) return null
      await db.doc(`users/${refUid}`).set({ referralStats: { signups: admin.firestore.FieldValue.increment(1) } }, { merge: true })
    } catch (e) { console.warn('signup attribution failed:', e.message) }
    return null
  })

// ── Stripe Checkout for a Pointer credit pack ($10 = 50 credits, one-time) ──
exports.createCreditCheckout = billingFn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const email = context.auth.token.email || undefined
  const key = SECRET_STRIPE.value()
  if (!key || key === 'REPLACE_ME') throw new functions.https.HttpsError('failed-precondition', 'Card payments are not configured yet — contact support to top up.')
  const stripe = require('stripe')(key)
  const cfg = await payments.billingConfig(db)
  const pack = cfg.creditPack || { usd: 10, credits: 50 }
  const usd = Math.max(1, parseInt(pack.usd) || 10)
  const credits = Math.max(1, parseInt(pack.credits) || 50)
  // Return the buyer to the app they came from (mobile PWA vs webapp), not a
  // fixed domain. Only exact-host matches on our own origins are accepted so
  // this can't become an open redirect; anything else falls back to frontendUrl.
  let base = cfg.frontendUrl.replace(/\/$/, '')
  try {
    const ret = new URL(String(data?.returnUrl || ''))
    const ALLOWED_RETURN_HOSTS = new Set([
      'fxcrypt-app.web.app', 'fxcrypt-webapp.web.app', 'fxcrypt-app.firebaseapp.com', 'fxcrypt-webapp.firebaseapp.com',
      'localhost', '127.0.0.1', new URL(cfg.frontendUrl).hostname,
    ])
    if (ALLOWED_RETURN_HOSTS.has(ret.hostname)) base = ret.origin
  } catch (_) { /* no/invalid returnUrl → keep frontendUrl */ }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price_data: { currency: 'usd', product_data: { name: `FXcrypt Pointer — ${credits} request credits` }, unit_amount: usd * 100 }, quantity: 1 }],
    customer_email: email,
    client_reference_id: uid,
    metadata: { uid, kind: 'credits', credits: String(credits) },
    success_url: `${base}/?credits=success`,
    cancel_url: `${base}/?credits=cancel`,
  })
  return { url: session.url, sessionId: session.id }
})

// ── Stripe webhook (public; signature-verified) → grants/revokes plans ──
exports.stripeWebhook = billingFn.https.onRequest(async (req, res) => {
  const key = SECRET_STRIPE.value(), wh = SECRET_STRIPE_WH.value()
  if (!key || !wh || key === 'REPLACE_ME' || wh === 'REPLACE_ME') return res.status(500).send('Stripe not configured')
  const stripe = require('stripe')(key)
  let event
  try { event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], wh) }
  catch (e) { console.error('stripe sig fail:', e.message); return res.status(400).send(`Webhook Error: ${e.message}`) }
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object
      const uid = (s.metadata && s.metadata.uid) || s.client_reference_id
      if (uid && s.metadata && s.metadata.kind === 'credits') {
        // Pointer credit top-up — add non-expiring credits to the user's balance.
        const credits = parseInt(s.metadata.credits) || 0
        if (credits > 0) await db.doc(`users/${uid}`).set({ pointerCredits: admin.firestore.FieldValue.increment(credits) }, { merge: true })
        await db.doc(`users/${uid}/payments/stripe_${s.id}`).set({ provider: 'stripe', plan: 'credits', credits, mode: s.mode, amount: s.amount_total, amountUsd: (s.amount_total || 0) / 100, currency: s.currency, status: 'paid', at: Date.now(), paidAt: Date.now(), createdAt: Date.now() }, { merge: true })
      } else if (uid) {
        const plan = (s.metadata && s.metadata.plan) || 'pro'
        if (s.mode === 'subscription') await payments.grantPlan(db, uid, plan, { clearExpiry: true, subscription: { provider: 'stripe', status: 'active', type: 'subscription', stripeCustomerId: s.customer || null, stripeSubId: s.subscription || null } })
        else await payments.grantPlan(db, uid, plan, { durationDays: 30, subscription: { provider: 'stripe', status: 'active', type: 'onetime', stripeCustomerId: s.customer || null } })
        await db.doc(`users/${uid}/payments/stripe_${s.id}`).set({ provider: 'stripe', plan, mode: s.mode, amount: s.amount_total, currency: s.currency, status: 'paid', at: Date.now(), createdAt: Date.now() }, { merge: true })
      }
      // First successful payment of any kind triggers the referral reward
      // (idempotent — the referee's `referralRewarded` latch survives retries).
      if (uid) await payments.processReferralReward(db, uid, await payments.billingConfig(db))
      await bumpFunnel('checkoutComplete')
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object
      const uid = sub.metadata && sub.metadata.uid
      if (uid) await payments.grantPlan(db, uid, 'free', { subscription: { provider: 'stripe', status: 'canceled' } })
    }
    res.json({ received: true })
  } catch (e) { console.error('stripeWebhook handler:', e); res.status(500).send('handler error') }
})

// ── Crypto: create a pay-to-address invoice ──
exports.createCryptoInvoice = plainFn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const plan = data?.plan === 'elite' ? 'elite' : 'pro'
  const chain = String(data?.chain || 'eth')
  const asset = String(data?.asset || 'usdt').toLowerCase()
  if (!['eth', 'bsc', 'base', 'sol'].includes(chain)) throw new functions.https.HttpsError('invalid-argument', 'Unsupported chain')
  const cfg = await payments.billingConfig(db)
  const address = cfg.receiving[chain]
  if (!address) throw new functions.https.HttpsError('failed-precondition', `Crypto receiving address for ${chain.toUpperCase()} not configured`)
  let calc
  try { calc = await payments.computeCryptoAmount(plan, chain, asset, cfg.prices) }
  catch (e) { throw new functions.https.HttpsError('invalid-argument', e.message) }
  const invoiceId = 'inv_' + crypto2.randomBytes(8).toString('hex')
  const createdAt = Date.now()
  const invoice = { invoiceId, provider: 'crypto', plan, chain, asset, address, amountUsd: calc.amountUsd, amountToken: calc.amountToken, tokenContract: calc.tokenContract || null, symbol: calc.symbol, decimals: calc.decimals, status: 'pending', createdAt, expiresAt: createdAt + 30 * 60000 }
  await db.doc(`users/${uid}/payments/${invoiceId}`).set(invoice)
  return invoice
})

// ── Crypto: verify an invoice on-chain and grant the plan ──
exports.verifyCryptoPayment = cryptoPayFn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const invoiceId = String(data?.invoiceId || '')
  if (!invoiceId) throw new functions.https.HttpsError('invalid-argument', 'invoiceId required')
  const ref = db.doc(`users/${uid}/payments/${invoiceId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Invoice not found')
  const inv = snap.data()
  if (inv.status === 'paid') return { status: 'paid', plan: inv.plan }
  const ctx = { moralisKey: SECRET_MORALIS.value() || null, heliusKey: SECRET_HELIUS.value() || null }
  let result
  try { result = await payments.verifyPayment(ctx, inv) }
  catch (e) { throw new functions.https.HttpsError('internal', e.message || 'Verification failed') }
  if (result.paid) {
    await payments.grantPlan(db, uid, inv.plan, { durationDays: 30, subscription: { provider: 'crypto', status: 'active', type: 'onetime' } })
    await ref.set({ status: 'paid', txHash: result.txHash || null, paidAt: Date.now() }, { merge: true })
    await payments.processReferralReward(db, uid, await payments.billingConfig(db))
    await bumpFunnel('checkoutComplete')
    return { status: 'paid', plan: inv.plan, txHash: result.txHash || null }
  }
  return { status: 'pending' }
})

// ── ADMIN: all gated by the config/billing admin allowlist ──
async function requireAdmin(context) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const cfg = await payments.billingConfig(db)
  if (!payments.isAdminEmail(context, cfg)) throw new functions.https.HttpsError('permission-denied', 'Admin access required')
  return cfg
}

exports.adminStats = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  const col = db.collection('users')
  const total = (await col.count().get()).data().count
  const counts = { free: 0, pro: 0, elite: 0 }
  for (const p of ['pro', 'elite']) counts[p] = (await col.where('plan', '==', p).count().get()).data().count
  counts.free = Math.max(0, total - counts.pro - counts.elite)
  // Month-to-date Pointer usage aggregate (bounded read; fine at this scale).
  let pointerReqsMTD = 0, activeUsers = 0, creditsOutstanding = 0
  try {
    const period = metering.currentPeriod()
    const cutoff = Date.now() - 30 * 86400000
    const all = await col.limit(3000).get()
    all.forEach((doc) => {
      const x = doc.data()
      if (x.pointerUsage && x.pointerUsage.period === period) pointerReqsMTD += (x.pointerUsage.used || 0)
      if ((x.lastActiveAt || 0) >= cutoff) activeUsers++
      creditsOutstanding += (x.pointerCredits || 0)
    })
  } catch (e) { /* aggregate is best-effort */ }
  // 30-day paywall conversion funnel (global daily docs, webhook-stamped completes).
  let funnel30d = { paywallView: 0, checkoutStart: 0, checkoutComplete: 0 }
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const fs = await db.collection('funnel').where(admin.firestore.FieldPath.documentId(), '>=', since).get()
    fs.forEach((doc) => {
      const x = doc.data()
      funnel30d.paywallView += x.paywallView || 0
      funnel30d.checkoutStart += x.checkoutStart || 0
      funnel30d.checkoutComplete += x.checkoutComplete || 0
    })
  } catch (e) { /* best-effort */ }
  return { totalUsers: total, byPlan: counts, premium: counts.pro + counts.elite, pointerReqsMTD, activeUsers, creditsOutstanding, funnel30d, period: metering.currentPeriod(), generatedAt: Date.now() }
})

exports.adminListUsers = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  const cfg = await payments.billingConfig(db)
  const res = await admin.auth().listUsers(200, data?.pageToken || undefined)
  const docs = await Promise.all(res.users.map((u) => db.doc(`users/${u.uid}`).get().catch(() => null)))
  const users = res.users.map((u, i) => {
    const d = (docs[i] && docs[i].exists) ? docs[i].data() : {}
    const plan = ['free', 'pro', 'elite'].includes(d.plan) ? d.plan : 'free'
    const pu = metering.readUsage(d, plan, cfg, 'pointer')
    const flags = d.featureFlags || {}
    return {
      uid: u.uid, email: u.email || '', displayName: u.displayName || '',
      disabled: u.disabled, banned: !!d.banned,
      createdAt: u.metadata.creationTime, lastSignIn: u.metadata.lastSignInTime,
      plan: d.plan || 'free', planExpiry: d.planExpiry || null,
      hasWallets: !!(d.wallets && Object.keys(d.wallets).length),
      telegram: !!(d.botSettings && d.botSettings.telegramChatId),
      discord: !!(d.botSettings && d.botSettings.discordUserId),
      pointerUsed: pu.used, pointerQuota: pu.quota, pointerCredits: pu.credits,
      lastActiveAt: d.lastActiveAt || null,
      pointerOff: flags.pointer === false,
    }
  })
  return { users, nextPageToken: res.pageToken || null }
})

exports.adminGetUser = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  const uid = String(data?.uid || '')
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required')
  let authUser = null
  try { const u = await admin.auth().getUser(uid); authUser = { uid: u.uid, email: u.email, disabled: u.disabled, createdAt: u.metadata.creationTime, lastSignIn: u.metadata.lastSignInTime } } catch (e) {}
  const snap = await db.doc(`users/${uid}`).get()
  const d = snap.exists ? snap.data() : {}
  // Redact every secret/encrypted blob — admins see addresses & status, never keys.
  const safe = { ...d }
  delete safe.walletAuth
  if (safe.wallets) safe.wallets = Object.fromEntries(Object.entries(safe.wallets).map(([k, w]) => [k, { address: w.address }]))
  if (safe.botSettings) {
    const bs = { ...safe.botSettings }
    if (bs.wallets) bs.wallets = Object.fromEntries(Object.entries(bs.wallets).map(([k, w]) => [k, { address: w.address }]))
    for (const f of ['cexKeys', 'apiKeys', 'exchangeKeys']) delete bs[f]
    safe.botSettings = bs
  }
  // recent payments
  let pays = []
  try { const ps = await db.collection(`users/${uid}/payments`).orderBy('createdAt', 'desc').limit(10).get(); pays = ps.docs.map((x) => x.data()) } catch (e) {}
  // Usage + controls (metering) for the admin panel.
  const cfg = await payments.billingConfig(db)
  const plan = ['free', 'pro', 'elite'].includes(d.plan) ? d.plan : 'free'
  const usage = { pointer: metering.readUsage(d, plan, cfg, 'pointer'), gemScan: metering.readUsage(d, plan, cfg, 'gemScan') }
  const featureFlags = d.featureFlags || {}
  const userLimits = d.userLimits || {}
  let daily = []
  try {
    const ds = await db.collection(`users/${uid}/usageDaily`).orderBy(admin.firestore.FieldPath.documentId(), 'desc').limit(30).get()
    daily = ds.docs.map((x) => ({ day: x.id, ...x.data() }))
  } catch (e) {}
  return { auth: authUser, doc: safe, payments: pays, plan, usage, featureFlags, userLimits, daily }
})

// Admin: grant/deduct Pointer request credits on a user's account.
exports.adminAddPointerCredits = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  const uid = String(data?.uid || '')
  const amount = parseInt(data?.amount)
  if (!uid || !Number.isFinite(amount) || amount === 0) throw new functions.https.HttpsError('invalid-argument', 'uid and non-zero amount required')
  await db.doc(`users/${uid}`).set({ pointerCredits: admin.firestore.FieldValue.increment(amount), adminNote: { action: 'addCredits', amount, by: context.auth.token.email, at: Date.now() } }, { merge: true })
  const snap = await db.doc(`users/${uid}`).get()
  return { ok: true, credits: (snap.exists ? snap.data().pointerCredits : 0) || 0 }
})

// Admin: set per-user feature flags and limit overrides. Only whitelisted keys.
exports.adminSetUserLimits = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  const uid = String(data?.uid || '')
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required')
  const patch = {}
  if (data.featureFlags && typeof data.featureFlags === 'object') {
    const ff = {}
    for (const k of ['pointer', 'deepResearch', 'scanner', 'signals', 'autoExecute']) if (data.featureFlags[k] !== undefined) ff[k] = !!data.featureFlags[k]
    if (Object.keys(ff).length) patch.featureFlags = ff
  }
  if (data.userLimits && typeof data.userLimits === 'object') {
    const ul = {}
    const intOrNull = (v) => { if (v === null || v === '' || v === undefined) return null; const n = parseInt(v); return Number.isFinite(n) ? Math.max(0, n) : null }
    const numOrNull = (v) => { if (v === null || v === '' || v === undefined) return null; const n = parseFloat(v); return Number.isFinite(n) ? Math.max(0, n) : null }
    for (const k of ['pointerQuota', 'gemScanQuota', 'dailyTradeCap', 'priceAlertQuota', 'pointerTaskQuota']) if (data.userLimits[k] !== undefined) ul[k] = intOrNull(data.userLimits[k])
    if (data.userLimits.maxBuyUsd !== undefined) ul.maxBuyUsd = numOrNull(data.userLimits.maxBuyUsd)
    if (Object.keys(ul).length) patch.userLimits = ul
  }
  if (!Object.keys(patch).length) return { ok: true, note: 'nothing to update' }
  patch.adminNote = { action: 'setLimits', by: context.auth.token.email, at: Date.now() }
  await db.doc(`users/${uid}`).set(patch, { merge: true })
  return { ok: true }
})

exports.adminSetPlan = adminFn.https.onCall(async (data, context) => {
  const cfg = await requireAdmin(context)
  const uid = String(data?.uid || '')
  const plan = ['free', 'pro', 'elite'].includes(data?.plan) ? data.plan : null
  if (!uid || !plan) throw new functions.https.HttpsError('invalid-argument', 'uid and valid plan required')
  const days = parseInt(data?.days) || 0
  await payments.grantPlan(db, uid, plan, days ? { durationDays: days } : { clearExpiry: true })
  await db.doc(`users/${uid}`).set({ adminNote: { action: 'setPlan', plan, days: days || null, by: context.auth.token.email, at: Date.now() } }, { merge: true })
  return { ok: true, plan, days: days || null }
})

exports.adminBanUser = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  const uid = String(data?.uid || '')
  const banned = !!data?.banned
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required')
  try { await admin.auth().updateUser(uid, { disabled: banned }) } catch (e) {}
  await db.doc(`users/${uid}`).set({ banned, adminNote: { action: banned ? 'ban' : 'unban', by: context.auth.token.email, at: Date.now() } }, { merge: true })
  return { ok: true, banned }
})

// Revenue & active subscriptions across all users.
exports.adminRevenue = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  // Bare collection-group read needs no custom index (fine at small scale).
  const snap = await db.collectionGroup('payments').get()
  let totalUsd = 0, last30Usd = 0, paidCount = 0
  const byProvider = { stripe: 0, crypto: 0 }
  const recent = []
  const cutoff = Date.now() - 30 * 86400000
  snap.forEach((doc) => {
    const p = doc.data()
    if (p.status !== 'paid') return
    const usd = p.amountUsd != null ? p.amountUsd : (p.amount != null ? p.amount / 100 : 0)
    const at = p.paidAt || p.at || p.createdAt || 0
    totalUsd += usd; paidCount++
    if (at >= cutoff) last30Usd += usd
    byProvider[p.provider] = (byProvider[p.provider] || 0) + usd
    recent.push({ provider: p.provider, plan: p.plan || '', usd, at, uid: doc.ref.parent.parent ? doc.ref.parent.parent.id : null })
  })
  recent.sort((a, b) => b.at - a.at)
  let activeSubs = 0
  try {
    const us = await db.collection('users').where('subscription.status', '==', 'active').get()
    us.forEach((d) => { if ((d.data().subscription || {}).type === 'subscription') activeSubs++ })
  } catch (e) {}
  return {
    totalUsd: +totalUsd.toFixed(2), last30Usd: +last30Usd.toFixed(2), paidCount, activeSubs,
    byProvider: { stripe: +byProvider.stripe.toFixed(2), crypto: +byProvider.crypto.toFixed(2) },
    recent: recent.slice(0, 30), generatedAt: Date.now(),
  }
})

// Billing config — admin reads/edits receiving addresses, plan prices, Stripe
// price IDs and the frontend URL (Stripe API keys stay in Secret Manager).
exports.adminGetConfig = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  const snap = await db.doc('config/billing').get()
  return { config: snap.exists ? snap.data() : {} }
})
exports.adminSetConfig = adminFn.https.onCall(async (data, context) => {
  await requireAdmin(context)
  const c = data?.config || {}
  const clean = {
    receivingAddresses: {
      eth:  String(c.receivingAddresses?.eth  || '').trim() || null,
      bsc:  String(c.receivingAddresses?.bsc  || '').trim() || null,
      base: String(c.receivingAddresses?.base || '').trim() || null,
      sol:  String(c.receivingAddresses?.sol  || '').trim() || null,
    },
    planPricesUsd: {
      pro:   Math.max(1, parseInt(c.planPricesUsd?.pro)   || 29),
      elite: Math.max(1, parseInt(c.planPricesUsd?.elite) || 99),
    },
    stripePriceIds: {
      proMonthly:   String(c.stripePriceIds?.proMonthly   || '').trim() || null,
      eliteMonthly: String(c.stripePriceIds?.eliteMonthly || '').trim() || null,
    },
    frontendUrl: String(c.frontendUrl || 'https://fxcrypt-app.web.app').trim(),
    // AI model for the in-app Pointer — admin-controlled (users can't switch).
    aiProvider: c.aiProvider === 'openai' ? 'openai' : 'deepseek',
    adminEmails: Array.isArray(c.adminEmails) ? c.adminEmails.map((e) => String(e).toLowerCase().trim()).filter(Boolean) : [],
    updatedBy: context.auth.token.email, updatedAt: Date.now(),
  }
  // Usage metering + controls (optional blocks; only written when provided).
  const qInt = (v, d) => { const n = parseInt(v); return Number.isFinite(n) && n >= 0 ? n : d }
  if (c.pointerQuota) clean.pointerQuota = { free: qInt(c.pointerQuota.free, 10), pro: qInt(c.pointerQuota.pro, 50), elite: qInt(c.pointerQuota.elite, 200) }
  if (c.gemScanQuota) clean.gemScanQuota = { free: qInt(c.gemScanQuota.free, 5), pro: qInt(c.gemScanQuota.pro, 50), elite: qInt(c.gemScanQuota.elite, 200) }
  if (c.creditPack) clean.creditPack = { usd: Math.max(1, qInt(c.creditPack.usd, 10)), credits: Math.max(1, qInt(c.creditPack.credits, 50)) }
  if (c.autoTrade) clean.autoTrade = {
    globalEnabled: c.autoTrade.globalEnabled !== false,
    defaultMaxBuyUsd: Math.max(0, parseFloat(c.autoTrade.defaultMaxBuyUsd) || 100),
    defaultDailyTradeCap: qInt(c.autoTrade.defaultDailyTradeCap, 10),
  }
  if (c.referral) clean.referral = {
    enabled: c.referral.enabled !== false,
    rewardCredits: qInt(c.referral.rewardCredits, 25),
  }
  // Trading fees: % per plan (0–5, clamped) + the wallet that receives them per
  // chain. Fees only apply where both the % > 0 and a valid wallet are set.
  const feePct = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(0, Math.min(n, 5)) : d }
  const evmAddr = (v) => { const s = String(v || '').trim(); return /^0x[0-9a-fA-F]{40}$/.test(s) ? s : '' }
  const solAddr = (v) => { const s = String(v || '').trim(); return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) ? s : '' }
  if (c.tradingFee) clean.tradingFee = { free: feePct(c.tradingFee.free, 1.0), pro: feePct(c.tradingFee.pro, 0.5), elite: feePct(c.tradingFee.elite, 0.2) }
  if (c.feeWallets) clean.feeWallets = { bsc: evmAddr(c.feeWallets.bsc), eth: evmAddr(c.feeWallets.eth), base: evmAddr(c.feeWallets.base), sol: solAddr(c.feeWallets.sol) }
  await db.doc('config/billing').set(clean, { merge: true })
  return { ok: true, config: clean }
})

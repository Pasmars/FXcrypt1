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


// Pre-bound function builder — europe-west1 avoids Binance geo-block (HTTP 451) on GCP us-central1
const fn = functions.region('europe-west1').runWith({ secrets: ALL_SECRETS })

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
        `https://deep-index.moralis.io/api/v2.2/erc20/${addr}/stats?chain=${chainHex}`,
        { headers: { 'X-API-Key': moralisKey } }
      )
      if (res.ok) {
        const json = await res.json()
        const count = json.holders_count ?? json.owners_count
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

  if (!wallets[chain]?.encryptedKey)
    throw new functions.https.HttpsError('failed-precondition', `No ${chain.toUpperCase()} wallet configured`)

  const pk   = encryption.decrypt(wallets[chain].encryptedKey, uid, MASTER_SECRET())
  const slip = slippage ? validateSlippage(slippage) : (settings.defaultSlippage || 5)
  const gasX = settings.defaultGasMultiplier || 1.2

  const heliusKey = SECRET_HELIUS.value() || null

  let result
  try {
    if (action === 'buy') {
      const amt = validateAmount(amount)
      result = chain === 'sol'
        ? await trader.buyTokenSOL(pk, tokenAddress, amt, slip, settings.solRpc, heliusKey)
        : await trader.buyTokenEVM(chain, pk, tokenAddress, amt, slip, settings[chain + 'Rpc'], gasX)
    } else {
      const pct = validatePercent(percent)
      result = chain === 'sol'
        ? await trader.sellTokenSOL(pk, tokenAddress, pct, slip, settings.solRpc, heliusKey)
        : await trader.sellTokenEVM(chain, pk, tokenAddress, pct, slip, settings[chain + 'Rpc'], gasX)
    }

    await db.collection(`users/${uid}/trades`).add({
      chain, tokenAddress, type: action,
      amountIn: amount || null, percentSold: percent || null,
      txHash: result.txHash, status: result.status, source: 'manual',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    })

    return result
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
exports.scanGems = fn.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const chains       = Array.isArray(data?.chains) ? data.chains.filter(c => VALID_CHAINS.has(c)) : ['bsc', 'sol']
  const minLiquidity = Math.max(1000, parseInt(data?.minLiquidity) || 5000)
  const maxAgeHours  = Math.max(1, Math.min(parseInt(data?.maxAgeHours) || 24, 168))
  const minScore     = Math.max(0, Math.min(parseInt(data?.minScore) || 40, 100))

  const gems = await gemscanner.discoverGems(chains, { minLiquidity, maxAgeHours, minScore })
  return { gems, scannedAt: Date.now() }
})

// ── Gem Scanner Scheduler (runs every 5 minutes) ──────────────────────────
exports.processGemScanner = fn.pubsub
  .schedule('every 5 minutes')
  .onRun(async () => {
    const snap = await db.collection('users')
      .where('botSettings.gemAutoEnabled', '==', true)
      .limit(10).get()

    if (snap.empty) return null

    let tgToken
    try { tgToken = TG_TOKEN() } catch (_) { tgToken = null }

    await Promise.allSettled(snap.docs.map(async (userDoc) => {
      const uid      = userDoc.id
      const settings = userDoc.data().botSettings || {}
      const wallets  = settings.wallets || {}
      const chatId   = settings.telegramChatId

      if (!chatId || !tgToken) return

      const chains = (settings.gemChains || ['bsc', 'sol']).filter(c => VALID_CHAINS.has(c))
      if (!chains.length) return

      const filters = {
        minLiquidity: settings.gemMinLiquidity || 5000,
        maxAgeHours:  settings.gemMaxAge       || 24,
        minScore:     settings.gemMinScore     || 60,
      }

      try {
        const gems = await gemscanner.discoverGems(chains, filters)
        if (!gems.length) return

        const bot = tg.createBot(tgToken)

        const sentCount = await gemscanner.sendGemAlerts(
          gems, settings, bot, chatId, db, uid
        )

        // Auto-buy if enabled
        if (settings.gemAutoBuy && sentCount > 0) {
          for (const gem of gems.slice(0, 3)) {
            if (gem.gemScore < (settings.gemMinScore || 60)) continue
            if (!wallets[gem.chain]?.encryptedKey) continue

            const alertSnap = await db.collection(`users/${uid}/gemAlerts`)
              .where('tokenAddress', '==', gem.tokenAddress)
              .where('chain', '==', gem.chain)
              .where('autoBought', '==', true)
              .limit(1).get()

            if (!alertSnap.empty) continue

            const buyAmount = gem.chain === 'bsc'
              ? (settings.gemBuyAmountBsc || 0.005)
              : (settings.gemBuyAmountSol || 0.05)

            try {
              const pk   = encryption.decrypt(wallets[gem.chain].encryptedKey, uid, MASTER_SECRET())
              const slip = Math.min(settings.defaultSlippage || 10, 50)
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
                `Amount: ${buyAmount} ${gem.chain === 'bsc' ? 'BNB' : 'SOL'}\n` +
                `Status: ${result.status}\n` +
                `[View TX](${txUrl})`,
                { parse_mode: 'Markdown', disable_web_page_preview: true }
              ).catch(() => {})

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
    const marketTypes   = agentSettings.marketTypes || ['spot']
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





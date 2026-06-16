// FXcrypt Operations Agent — open-source LLM brain (DeepSeek by default).
// Uses the OpenAI-compatible Chat Completions API, so it works unchanged with
// DeepSeek, OpenRouter, Together, Groq, or a local Ollama — just change
// LLM_BASE_URL / LLM_MODEL (env) and the API key secret.
//
// Runs a manual tool-use loop where the model can READ app state (balances,
// prices, gems, settings, trades, token safety) and PROPOSE trades. It has no
// execute tool: trades run only when the human approves the proposal in Discord
// (see executeProposedTrade, invoked by the approve-button handler).
const OpenAI = require('openai')
const axios = require('axios')
const arbitrage      = require('./arbitrage')
const marketAnalyzer = require('./market-analyzer')
const signalGen      = require('./signal-generator')
const cexTrader      = require('./cex-trader')

// Both DeepSeek and OpenAI (ChatGPT) speak the OpenAI Chat Completions API, so
// switching is just base URL + model + key. Per-provider env overrides let you
// point either slot at OpenRouter/Together/Groq/Ollama without code changes.
const PROVIDERS = {
  deepseek: { baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' },
  openai:   { baseURL: process.env.OPENAI_BASE_URL   || 'https://api.openai.com/v1',   model: process.env.OPENAI_MODEL   || 'gpt-4o-mini' },
}
const MAX_LOOPS = 6

const SYSTEM = `You are the FXcrypt Operations Agent — the brain that monitors and helps operate the FXcrypt crypto trading app for its owner, who talks to you in Discord.

The app trades memecoins/tokens across BSC, ETH, SOL, Base and TON via DEXs, runs a "gem scanner" that hunts new tokens, and supports CEX/arbitrage. You can read live app state with your tools and answer questions, summarize activity, flag risks, and recommend actions.

You have read/analysis access to most of the app: live balances, bot config, recent trades and gem alerts, the gem scanner, token price/safety lookups, cross-DEX arbitrage scanning, the CEX/futures signal engine (technical analysis across Binance/MEXC/Bybit/KuCoin), recent signals, CEX exchange balances, and token holder counts (tracker).

OFF-LIMITS: you have NO access to the user's Wallet page (portfolio management, send/receive, private keys) or the PnL Calculator. If asked to do either, politely decline and say it's not available to you.

TRADING IS GATED. You CANNOT execute trades. To act on a trade, call propose_trade — this sends an Approve/Reject card to the owner in Discord and they decide. Never claim a trade was executed; only that it was proposed. Always run a safety check (check_token) and state the risk before proposing a buy.

Style: concise, Discord-friendly markdown. Lead with the answer. Use compact numbers ($12.3K). Be direct about risk — these are high-risk speculative tokens. When unsure, say so and use a tool rather than guessing.`

// ── Tool schemas (OpenAI function-calling format) ──────────────────────────
const fnTool = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters: { type: 'object', ...parameters } } })
const TOOLS = [
  fnTool('get_balances', "Native wallet balances (BNB/ETH/SOL/MATIC/TON) across the owner's configured chains.", { properties: {} }),
  fnTool('get_bot_settings', "The owner's bot configuration: enabled features, gem-scanner filters, default slippage/gas, configured wallet addresses (never private keys).", { properties: {} }),
  fnTool('get_recent_trades', 'Most recent trades the bot/owner made.', { properties: { limit: { type: 'integer', description: 'How many (max 20)' } } }),
  fnTool('get_recent_gem_alerts', 'Most recent gems the scanner flagged.', { properties: { limit: { type: 'integer', description: 'How many (max 20)' } } }),
  fnTool('scan_gems', 'Run a live gem scan now. Slow (~30s). Returns top scoring tokens with score, liquidity, volume, age.', { properties: { chains: { type: 'array', items: { type: 'string', enum: ['bsc', 'eth', 'sol', 'base'] }, description: 'Chains to scan (default bsc,sol)' }, minScore: { type: 'integer' } } }),
  fnTool('lookup_token', 'Look up a token by contract address or name via DexScreener: price, liquidity, volume, market cap, 24h change.', { properties: { query: { type: 'string', description: 'Contract address or token name/symbol' } }, required: ['query'] }),
  fnTool('get_crypto_price', 'Spot USD price for major coins by CoinGecko id (e.g. bitcoin, ethereum, solana, binancecoin).', { properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] }),
  fnTool('check_token', 'Safety/honeypot check for a token contract on a chain (tax, honeypot risk).', { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'sol', 'base'] }, address: { type: 'string' } }, required: ['chain', 'address'] }),
  fnTool('get_token_holders', 'Holder count for a token contract (tracker / bubble-map data).', { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'sol'] }, address: { type: 'string' } }, required: ['chain', 'address'] }),
  fnTool('scan_arbitrage', 'Scan cross-DEX arbitrage opportunities (price spreads for the same token across DEXs).', { properties: { chains: { type: 'array', items: { type: 'string', enum: ['bsc', 'sol'] }, description: 'default bsc,sol' }, minSpread: { type: 'number', description: 'min % spread, default 0.3' }, minLiqUsd: { type: 'integer', description: 'min liquidity USD, default 20000' } } }),
  fnTool('scan_signals', 'Generate CEX/futures trade signals via technical analysis on an exchange. Slow (~20-40s).', { properties: { exchange: { type: 'string', enum: ['binance', 'mexc', 'bybit', 'kucoin'], description: 'default binance' }, timeframe: { type: 'string', description: 'e.g. 1H, 4H, 1D (default 4H)' }, marketType: { type: 'string', enum: ['spot', 'futures'], description: 'default spot' }, minScore: { type: 'integer' } } }),
  fnTool('get_recent_signals', 'Most recent trade signals the AI signal agent generated.', { properties: { limit: { type: 'integer', description: 'How many (max 20)' } } }),
  fnTool('get_cex_balances', "USDT spot (and futures) balances on the owner's connected CEX exchange API keys.", { properties: {} }),
  fnTool('propose_trade', 'Propose a trade for human approval. Does NOT execute — sends an Approve/Reject card to Discord. For buys, amount is the native-token amount (e.g. 0.01 BNB). For sells, percent is 1-100 (% of holdings).', { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'sol', 'base'] }, action: { type: 'string', enum: ['buy', 'sell'] }, tokenAddress: { type: 'string' }, tokenSymbol: { type: 'string' }, amount: { type: 'string', description: 'Native amount for buys' }, percent: { type: 'integer', description: '1-100 for sells' }, rationale: { type: 'string', description: 'Why, including the safety read' } }, required: ['chain', 'action', 'tokenAddress', 'rationale'] }),
]

const NATIVE = { bsc: 'BNB', eth: 'ETH', base: 'ETH', sol: 'SOL', ton: 'TON' }

// ── Tool executors (read-only) ─────────────────────────────────────────────
async function runTool(name, input, ctx) {
  const { uid, db, trader, gemscanner } = ctx
  const userSnap = await db.doc(`users/${uid}`).get()
  const udata    = userSnap.exists ? userSnap.data() : {}
  const settings = udata.botSettings || {}
  const agentSettings = udata.agentSettings || {}
  const wallets  = settings.wallets || {}

  switch (name) {
    case 'get_balances': {
      const out = {}
      const jobs = []
      for (const [chain, w] of Object.entries(wallets)) {
        if (!w?.address) continue
        if (chain === 'sol') jobs.push(trader.getSOLBalance(w.address, settings.solRpc).then(b => { out.sol = b }).catch(e => { out.sol = { error: e.message } }))
        else if (chain === 'ton') jobs.push(trader.getTONBalance(w.address).then(b => { out.ton = b }).catch(e => { out.ton = { error: e.message } }))
        else jobs.push(trader.getEVMBalance(w.address, chain, settings[chain + 'Rpc']).then(b => { out[chain] = b }).catch(e => { out[chain] = { error: e.message } }))
      }
      await Promise.all(jobs)
      return out
    }
    case 'get_bot_settings': {
      // Strip secrets: expose addresses only, never encryptedKey.
      const safeWallets = {}
      for (const [c, w] of Object.entries(wallets)) safeWallets[c] = { address: w?.address || null, configured: !!w?.encryptedKey }
      return {
        wallets: safeWallets,
        defaultSlippage: settings.defaultSlippage ?? null,
        defaultGasMultiplier: settings.defaultGasMultiplier ?? null,
        gemAutoEnabled: !!settings.gemAutoEnabled, gemAutoBuy: !!settings.gemAutoBuy,
        gemChains: settings.gemChains || null, gemNarrative: settings.gemNarrative || null, gemSort: settings.gemSort || null,
        gemMinScore: settings.gemMinScore ?? null, gemMinLiquidity: settings.gemMinLiquidity ?? null,
        arbEnabled: !!settings.arbEnabled, telegramVerified: !!settings.telegramVerified,
      }
    }
    case 'get_recent_trades': {
      const n = Math.min(parseInt(input.limit) || 5, 20)
      const snap = await db.collection(`users/${uid}/trades`).orderBy('timestamp', 'desc').limit(n).get().catch(() => null)
      if (!snap) return []
      return snap.docs.map(d => { const x = d.data(); return { chain: x.chain, type: x.type, token: x.tokenAddress, status: x.status, amountIn: x.amountIn, percentSold: x.percentSold, txHash: x.txHash, source: x.source } })
    }
    case 'get_recent_gem_alerts': {
      const n = Math.min(parseInt(input.limit) || 5, 20)
      const snap = await db.collection(`users/${uid}/gemAlerts`).orderBy('alertedAt', 'desc').limit(n).get().catch(() => null)
      if (!snap) return []
      return snap.docs.map(d => { const x = d.data(); return { symbol: x.tokenSymbol, chain: x.chain, score: x.score, priceUsd: x.priceUsd, liquidity: x.liquidity, marketCap: x.marketCap, address: x.tokenAddress } })
    }
    case 'scan_gems': {
      const chains = (Array.isArray(input.chains) && input.chains.length) ? input.chains : ['bsc', 'sol']
      const gems = await gemscanner.discoverGems(chains, { minScore: parseInt(input.minScore) || 40, narrative: 'default', sort: 'default', limit: 8, dextoolsKey: process.env.DEXTOOLS_API_KEY || null })
      return gems.map(g => ({ symbol: g.tokenSymbol, chain: g.chain, score: g.gemScore, priceUsd: g.priceUsd, liquidity: g.liquidity, volume24h: g.volume24h, marketCap: g.marketCap, ageHours: g.ageHours, address: g.tokenAddress, safety: g.safety?.riskLevel }))
    }
    case 'lookup_token': {
      const q = String(input.query || '').trim()
      const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(q), { timeout: 10000 })
      const pairs = (data?.pairs || []).slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)).slice(0, 3)
      return pairs.map(p => ({ symbol: p.baseToken?.symbol, name: p.baseToken?.name, chain: p.chainId, address: p.baseToken?.address, priceUsd: p.priceUsd, liquidity: p.liquidity?.usd, volume24h: p.volume?.h24, marketCap: p.marketCap || p.fdv, change24h: p.priceChange?.h24, dex: p.dexId }))
    }
    case 'get_crypto_price': {
      const ids = (input.ids || []).map(String).filter(Boolean).slice(0, 25).join(',')
      const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`, { timeout: 10000 })
      return data
    }
    case 'check_token': {
      return await trader.checkToken(input.address, input.chain)
    }
    case 'get_token_holders': {
      const chain = input.chain, addr = String(input.address || '').trim()
      if (chain === 'sol') {
        if (!ctx.heliusKey) return { holders: null, note: 'Helius key not configured' }
        try {
          const { data } = await axios.post(`https://mainnet.helius-rpc.com/?api-key=${ctx.heliusKey}`, { jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: addr } }, { timeout: 10000 })
          const h = data?.result?.token_info?.holder_count
          return { holders: h != null ? parseInt(h, 10) : null }
        } catch { return { holders: null } }
      }
      if (ctx.moralisKey) {
        const chainHex = chain === 'bsc' ? '0x38' : '0x1'
        try {
          const { data } = await axios.get(`https://deep-index.moralis.io/api/v2.2/erc20/${addr}/stats?chain=${chainHex}`, { headers: { 'X-API-Key': ctx.moralisKey }, timeout: 10000 })
          const c = data.holders_count ?? data.owners_count
          if (c != null) return { holders: parseInt(c, 10) }
        } catch {}
      }
      if (chain === 'eth') {
        try { const { data } = await axios.get(`https://api.ethplorer.io/getTokenInfo/${addr}?apiKey=freekey`, { timeout: 10000 }); if (data.holdersCount != null) return { holders: parseInt(data.holdersCount, 10) } } catch {}
      }
      return { holders: null }
    }
    case 'scan_arbitrage': {
      const chains = (Array.isArray(input.chains) && input.chains.length) ? input.chains : ['bsc', 'sol']
      const opps = await arbitrage.scanArbitrageOpportunities(chains, parseFloat(input.minSpread) || 0.3, parseInt(input.minLiqUsd) || 20000)
      return (opps || []).slice(0, 8)
    }
    case 'scan_signals': {
      const ex = input.exchange || 'binance'
      const tf = input.timeframe || '4H'
      const mt = input.marketType === 'futures' ? 'futures' : 'spot'
      const minScore = parseInt(input.minScore) || (mt === 'futures' ? 65 : 68)
      const analyses = mt === 'futures'
        ? await marketAnalyzer.scanFuturesExchange(ex, tf, 25, minScore)
        : await marketAnalyzer.scanExchange(ex, tf, 30, minScore)
      const signals = (analyses || []).slice(0, 6).map((a) => signalGen.generateSignal(a, [ex])).filter(Boolean)
      return signals.map((s) => ({ symbol: s.symbol, bias: s.bias, marketType: s.marketType || mt, confidence: s.confidence, entry: s.entry, stopLoss: s.stopLoss, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, riskReward: s.riskReward, exchange: s.exchange, leverage: s.leverage }))
    }
    case 'get_recent_signals': {
      const n = Math.min(parseInt(input.limit) || 5, 20)
      const snap = await db.collection(`users/${uid}/signals`).orderBy('generatedAt', 'desc').limit(n).get().catch(() => null)
      if (!snap) return []
      return snap.docs.map((d) => { const x = d.data(); return { symbol: x.symbol, bias: x.bias, marketType: x.marketType, confidence: x.confidence, entry: x.entry, status: x.status, exchange: x.exchange } })
    }
    case 'get_cex_balances': {
      const keys = agentSettings.cexKeys || {}
      const out = {}
      await Promise.allSettled(Object.entries(keys).map(async ([ex, k]) => {
        try {
          const apiKey     = ctx.encryption.decrypt(k.encryptedApiKey, uid, ctx.masterSecret)
          const secret     = ctx.encryption.decrypt(k.encryptedSecret, uid, ctx.masterSecret)
          const passphrase = k.encryptedPassphrase ? ctx.encryption.decrypt(k.encryptedPassphrase, uid, ctx.masterSecret) : ''
          const creds = { apiKey, secret, passphrase }
          out[ex] = await cexTrader.getSpotBalance(ex, creds, 'USDT')
          if (['binance', 'bybit', 'mexc'].includes(ex)) { try { out[ex + '_futures'] = await cexTrader.getFuturesBalance(ex, creds, 'USDT') } catch {} }
        } catch (e) { out[ex] = { error: e.message } }
      }))
      return out
    }
    default:
      return { error: 'unknown tool' }
  }
}

// ── Main agent loop ────────────────────────────────────────────────────────
// history: prior [{role,content(text)}] turns. Returns { text, proposal|null, history }.
async function runAgent({ prompt, history = [], ctx, provider = 'deepseek', apiKey }) {
  const cfg = PROVIDERS[provider] || PROVIDERS.deepseek
  const client = new OpenAI({ apiKey, baseURL: cfg.baseURL })
  const messages = [
    { role: 'system', content: SYSTEM },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: prompt },
  ]
  let proposal = null

  for (let i = 0; i < MAX_LOOPS; i++) {
    const resp = await client.chat.completions.create({
      model: cfg.model,
      max_tokens: 4096,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    })
    const msg = resp.choices?.[0]?.message
    if (!msg) break

    const calls = msg.tool_calls || []
    if (calls.length === 0) {
      const text = (msg.content || '').trim()
      const newHistory = [...history, { role: 'user', content: prompt }, { role: 'assistant', content: text || '(no response)' }]
      return { text: text || 'Done.', proposal, history: newHistory.slice(-12) }
    }

    messages.push(msg) // assistant turn carrying tool_calls
    for (const tc of calls) {
      let args = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
      const fname = tc.function?.name
      if (fname === 'propose_trade') {
        proposal = { ...args }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Proposal sent to the owner for approval. Do not propose it again; summarize what you proposed and why.' })
        continue
      }
      try {
        const result = await runTool(fname, args, ctx)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) })
      } catch (e) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: ' + (e.message || 'tool failed') })
      }
    }
  }

  return { text: 'Reached step limit. Try a more specific request.', proposal, history }
}

// ── Execute an approved trade (called by the approve-button handler ONLY) ───
async function executeProposedTrade(ctx, p) {
  const { uid, db, admin, trader, encryption, masterSecret, heliusKey } = ctx
  const userSnap = await db.doc(`users/${uid}`).get()
  if (!userSnap.exists) throw new Error('User not found')
  const settings = userSnap.data().botSettings || {}
  const wallets  = settings.wallets || {}
  if (!wallets[p.chain]?.encryptedKey) throw new Error(`No ${p.chain.toUpperCase()} wallet configured`)

  const pk   = encryption.decrypt(wallets[p.chain].encryptedKey, uid, masterSecret)
  const slip = settings.defaultSlippage || 5
  const gasX = settings.defaultGasMultiplier || 1.2

  let result
  try {
    if (p.action === 'buy') {
      const amt = parseFloat(p.amount)
      if (!(amt > 0)) throw new Error('Invalid buy amount')
      result = p.chain === 'sol'
        ? await trader.buyTokenSOL(pk, p.tokenAddress, amt, slip, settings.solRpc, heliusKey)
        : await trader.buyTokenEVM(p.chain, pk, p.tokenAddress, amt, slip, settings[p.chain + 'Rpc'], gasX)
    } else {
      const pct = parseInt(p.percent)
      if (!(pct >= 1 && pct <= 100)) throw new Error('Invalid sell percent')
      result = p.chain === 'sol'
        ? await trader.sellTokenSOL(pk, p.tokenAddress, pct, slip, settings.solRpc, heliusKey)
        : await trader.sellTokenEVM(p.chain, pk, p.tokenAddress, pct, slip, settings[p.chain + 'Rpc'], gasX)
    }
    await db.collection(`users/${uid}/trades`).add({
      chain: p.chain, tokenAddress: p.tokenAddress, type: p.action,
      amountIn: p.amount || null, percentSold: p.percent || null,
      txHash: result.txHash, status: result.status, source: 'discord-agent',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })
    return result
  } catch (err) {
    await db.collection(`users/${uid}/trades`).add({
      chain: p.chain, tokenAddress: p.tokenAddress, type: p.action,
      txHash: null, status: 'failed', error: err.message, source: 'discord-agent',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {})
    throw err
  }
}

module.exports = { runAgent, executeProposedTrade, NATIVE, PROVIDERS }

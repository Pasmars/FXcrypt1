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
const holdergraph    = require('./holdergraph')

// Union-find over transfer edges → count of connected wallet clusters among the
// top holders (the bubble-map "linked wallets" signal). Edges are lowercased.
function clusterSummary(addresses, edges) {
  const parent = new Map(addresses.map((a) => [a, a]))
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const union = (a, b) => { if (!parent.has(a) || !parent.has(b)) return; const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  for (const e of edges) union((e.from || '').toLowerCase(), (e.to || '').toLowerCase())
  const sizes = new Map()
  for (const a of addresses) { const r = find(a); sizes.set(r, (sizes.get(r) || 0) + 1) }
  const multi = [...sizes.values()].filter((s) => s > 1)
  return { linkedClusters: multi.length, largestCluster: multi.length ? Math.max(...multi) : 1 }
}

// Both DeepSeek and OpenAI (ChatGPT) speak the OpenAI Chat Completions API, so
// switching is just base URL + model + key. Per-provider env overrides let you
// point either slot at OpenRouter/Together/Groq/Ollama without code changes.
// `model` is the everyday model; `deepModel` is the provider's top-tier model
// used when the user turns on "deep research". Both are env-overridable so you
// can point a slot at OpenRouter/Together/Groq/Ollama without code changes, and
// the admin can also pin the deep model via config/billing.aiDeepModel.
// Defaults verified 2026-07: `deepseek-chat`/`deepseek-reasoner` are deprecated
// 2026-07-24 (they alias deepseek-v4-flash), so v4 ids are used directly.
// `gpt-5-pro` lives only on OpenAI's Responses API — NOT chat completions, which
// this agent speaks — so the OpenAI deep slot uses gpt-5.5 (flagship, supports
// /v1/chat/completions).
const PROVIDERS = {
  deepseek: { baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',  deepModel: process.env.DEEPSEEK_DEEP_MODEL || 'deepseek-v4-pro' },
  openai:   { baseURL: process.env.OPENAI_BASE_URL   || 'https://api.openai.com/v1',   model: process.env.OPENAI_MODEL   || 'gpt-4o-mini', deepModel: process.env.OPENAI_DEEP_MODEL   || 'gpt-5.5' },
}
const MAX_LOOPS = 6
const DEEP_MAX_LOOPS = 10

// Prepended to the system prompt when deep research is requested.
const DEEP_DIRECTIVE = `

[DEEP RESEARCH MODE — the user has explicitly requested a deeper, more rigorous analysis]
Do not answer superficially. Before concluding: gather the relevant live data with your tools (prices, safety/contract checks, holders/bubble-map concentration, market movers, and web news/policy where useful) and cross-check it. Reason step by step, weigh multiple scenarios and the key risks, and then deliver a thorough, well-structured answer that ends with a clear, concrete conclusion or recommendation. Prefer accuracy and completeness over brevity.`

const SYSTEM = `You are the FXcrypt Operations Agent — the brain that monitors and helps operate the FXcrypt crypto trading app for its owner, who talks to you in Discord.

The app trades memecoins/tokens across BSC, ETH, SOL, Base and TON via DEXs, runs a "gem scanner" that hunts new tokens, and supports CEX/arbitrage. You can read live app state with your tools and answer questions, summarize activity, flag risks, and recommend actions.

You have read/analysis access to most of the app: live balances, bot config, recent trades and gem alerts, the gem scanner, token price/safety lookups, cross-DEX arbitrage scanning, the CEX/futures signal engine (technical analysis across Binance/MEXC/Bybit/KuCoin), recent signals, CEX exchange balances, token holder counts, and the **Token Tracker** — you can view the owner's tracked-token watchlist (with live prices), pull full info for any token, add/remove tokens from the watchlist, search tokens across all chains by name or contract address, and run **bubble-map holder analysis** (top holders, top-10 concentration, linked-wallet clusters) to flag whale/insider/bundling risk.

OFF-LIMITS: you have NO access to the user's Wallet page (portfolio management, send/receive, private keys) or the PnL Calculator. If asked to do either, politely decline and say it's not available to you.

TRADING IS GATED. You CANNOT execute trades. To act on a trade, call propose_trade — this sends an Approve/Reject card to the owner in Discord and they decide. Never claim a trade was executed; only that it was proposed. Always run a safety check (check_token) and state the risk before proposing a buy. Before proposing, you MUST have the token's exact contract address from a tool (lookup_token / check_token / a gem scan) — NEVER type, guess, or recall a contract address from memory, and do not set slippage yourself.

Finding tokens: when the owner names a token (e.g. "track PEPE", "info on WIF"), search for it yourself with lookup_token (cross-chain by name/symbol) or just pass the name as track_token's \`query\` — DO NOT ask the owner for a contract address. Only ask for the contract if the search returns nothing or is genuinely ambiguous between similarly-named tokens.

Style: concise, Discord-friendly markdown. Lead with the answer. Use compact numbers ($12.3K). Be direct about risk — these are high-risk speculative tokens. When unsure, say so and use a tool rather than guessing.`

// ── Tool schemas (OpenAI function-calling format) ──────────────────────────
const fnTool = (name, description, parameters) => ({ type: 'function', function: { name, description, parameters: { type: 'object', ...parameters } } })
const TOOLS = [
  fnTool('get_balances', "Native wallet balances (BNB/ETH/SOL/MATIC/TON) across the owner's configured chains.", { properties: {} }),
  fnTool('get_bot_settings', "The owner's bot configuration: enabled features, gem-scanner filters, default slippage/gas, configured wallet addresses (never private keys).", { properties: {} }),
  fnTool('get_recent_trades', 'Most recent trades the bot/owner made.', { properties: { limit: { type: 'integer', description: 'How many (max 20)' } } }),
  fnTool('get_recent_gem_alerts', 'Most recent gems the scanner flagged.', { properties: { limit: { type: 'integer', description: 'How many (max 20)' } } }),
  fnTool('scan_gems', 'Run a live gem scan now. Slow (~30s). Returns top scoring tokens with score, liquidity, volume, age.', { properties: { chains: { type: 'array', items: { type: 'string', enum: ['bsc', 'eth', 'sol', 'base'] }, description: 'Chains to scan (default bsc,sol)' }, minScore: { type: 'integer' } } }),
  fnTool('lookup_token', 'Universal market search — find ANY coin or token by name, ticker/symbol, OR contract address. Searches BOTH CoinGecko (every listed coin: BTC, ETH, majors, CEX coins — with market-cap rank) AND DexScreener (on-chain DEX tokens across BSC/ETH/SOL/Base/etc.). Returns each match with source, chain (for on-chain), price, market cap, volume, liquidity, rank and 24h change. This is the primary way to look anything up.', { properties: { query: { type: 'string', description: 'Coin/token name, ticker, or contract address' } }, required: ['query'] }),
  fnTool('get_market', 'Browse the live market like the app\'s Markets tab: top coins by market cap, top gainers, top losers, or highest volume (CoinGecko). Optionally filter by a name/ticker query. Returns rank, price, market cap, 24h volume and 24h change.', { properties: { sort: { type: 'string', enum: ['market_cap', 'gainers', 'losers', 'volume'], description: 'default market_cap' }, query: { type: 'string', description: 'Optional name/ticker filter' }, limit: { type: 'integer', description: 'How many (max 50, default 20)' } } }),
  fnTool('get_crypto_price', 'Quick spot USD price + 24h change for coins by CoinGecko id (e.g. bitcoin, ethereum, solana, binancecoin). Use lookup_token if you only know the name/ticker.', { properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] }),
  fnTool('web_search', 'Search the live web & news for crypto research — project/coin background, market trends & narratives, regulation and GOVERNMENT POLICY, hacks, exchange listings, partnerships, macro events, and anything current. Returns recent articles (title, source, date, link, snippet). Use this for current events, opinions, policy and "what is happening with X" — anything beyond on-chain/market-data tools.', { properties: { query: { type: 'string', description: 'What to research, e.g. "US crypto regulation 2026" or "Solana ecosystem news"' }, recency: { type: 'string', enum: ['day', 'week', 'month', 'any'], description: 'How fresh, default week' } }, required: ['query'] }),
  fnTool('check_token', 'Safety/honeypot check for a token contract on a chain (tax, honeypot risk).', { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'sol', 'base'] }, address: { type: 'string' } }, required: ['chain', 'address'] }),
  fnTool('get_token_holders', 'Holder count for a token contract (tracker / bubble-map data).', { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'sol'] }, address: { type: 'string' } }, required: ['chain', 'address'] }),
  fnTool('scan_arbitrage', 'Scan cross-DEX arbitrage opportunities (price spreads for the same token across DEXs).', { properties: { chains: { type: 'array', items: { type: 'string', enum: ['bsc', 'sol'] }, description: 'default bsc,sol' }, minSpread: { type: 'number', description: 'min % spread, default 0.3' }, minLiqUsd: { type: 'integer', description: 'min liquidity USD, default 20000' } } }),
  fnTool('scan_signals', 'Generate CEX/futures trade signals via technical analysis on an exchange. Slow (~20-40s).', { properties: { exchange: { type: 'string', enum: ['binance', 'mexc', 'bybit', 'kucoin'], description: 'default binance' }, timeframe: { type: 'string', description: 'e.g. 1H, 4H, 1D (default 4H)' }, marketType: { type: 'string', enum: ['spot', 'futures'], description: 'default spot' }, minScore: { type: 'integer' } } }),
  fnTool('get_recent_signals', 'Most recent trade signals the AI signal agent generated.', { properties: { limit: { type: 'integer', description: 'How many (max 20)' } } }),
  fnTool('get_cex_balances', "USDT spot (and futures) balances on the owner's connected CEX exchange API keys.", { properties: {} }),
  fnTool('get_token_info', 'Full Token-Tracker view for one token by contract address: price, market cap, 24h volume, liquidity, 24h change, holders.', { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'sol'] }, address: { type: 'string' } }, required: ['chain', 'address'] }),
  fnTool('get_tracked_tokens', "The owner's FULL watchlist — both their Markets-tab starred coins/tokens AND their Token Tracker list, merged and deduped — each with live price, 24h change, market cap, volume, liquidity. Use this whenever they mention 'my watchlist', 'my tracked tokens', 'coins I'm watching', etc.", { properties: {} }),
  fnTool('track_token', "Add a token to the owner's Token Tracker watchlist. Accepts a name/symbol (resolved automatically to the best-liquidity match) OR a contract address. Do NOT ask the user for a contract address — pass the name as `query`.", { properties: { query: { type: 'string', description: 'Token name, symbol, or contract address' }, chain: { type: 'string', enum: ['bsc', 'eth', 'sol', 'base'], description: 'Optional — narrows the search if known' }, address: { type: 'string', description: 'Optional — only if you already have the exact contract' }, name: { type: 'string' }, symbol: { type: 'string' } } }),
  fnTool('untrack_token', "Remove a token from the owner's Token Tracker watchlist.", { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'sol'] }, address: { type: 'string' } }, required: ['chain', 'address'] }),
  fnTool('get_bubble_map', 'Bubble-map holder analysis for a token: top holders with %, top-10 concentration, contract holders, and connected-wallet clusters (whale/insider/bundling risk). EVM via Moralis, SOL via Helius.', { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'base', 'sol'] }, address: { type: 'string' } }, required: ['chain', 'address'] }),
  fnTool('propose_trade', 'Propose a trade for the owner to approve. Does NOT execute — it shows an Approve/Reject card to the owner and the trade runs only if they approve, from their own wallet. You MUST pass the exact on-chain contract address obtained from lookup_token / check_token / a gem scan — NEVER invent, guess, or recall an address from memory. Pass the real tokenSymbol too. Do NOT set slippage — the app uses the owner\'s configured slippage automatically. For buys, amount is the native-token amount (e.g. 0.01 BNB). For sells, percent is 1-100 (% of holdings).', { properties: { chain: { type: 'string', enum: ['bsc', 'eth', 'sol', 'base'] }, action: { type: 'string', enum: ['buy', 'sell'] }, tokenAddress: { type: 'string', description: 'Exact contract address from a tool lookup — never guessed' }, tokenSymbol: { type: 'string' }, amount: { type: 'string', description: 'Native amount for buys' }, percent: { type: 'integer', description: '1-100 for sells' }, rationale: { type: 'string', description: 'Why, including the safety read' } }, required: ['chain', 'action', 'tokenAddress', 'rationale'] }),
]

// ── In-app Pointer surface ──────────────────────────────────────────────────
// The Pointer is the same agent brain exposed inside the FXcrypt app, with FULL
// access — including the owner's wallet balances and config (never private keys,
// which are never exposed by any tool). Only the framing differs from Discord.
// Pointer-only tools: standing watch-tasks ("ping me if BTC breaks $150k").
// Conditions are STRUCTURED fields — the monitor never re-feeds free text as
// instructions, which is the prompt-injection boundary for automated runs.
const TASK_TOOLS = [
  fnTool('create_watch_task', "Create a standing watch-task: the app monitors the condition 24/7 and when it fires, you (Pointer) automatically analyze the situation and notify the owner. Use whenever the owner asks to be pinged/alerted/notified when a price condition happens. cond 'above'/'below' = absolute USD price; 'move' = ±% change from now.", { properties: { query: { type: 'string', description: 'Token name or symbol (e.g. "BTC", "PEPE") — resolved automatically' }, cond: { type: 'string', enum: ['above', 'below', 'move'] }, value: { type: 'number', description: 'USD price for above/below; percent for move' }, note: { type: 'string', description: "Short summary of what the owner wants analyzed when it fires (their words)" } }, required: ['query', 'cond', 'value'] }),
  fnTool('list_watch_tasks', "The owner's standing watch-tasks with status (armed/paused/fired).", { properties: {} }),
  fnTool('cancel_watch_task', 'Delete a watch-task by id (from list_watch_tasks).', { properties: { taskId: { type: 'string' } }, required: ['taskId'] }),
]
const TOOLS_POINTER = [...TOOLS, ...TASK_TOOLS]

const SYSTEM_POINTER = `You are Pointer — the in-app AI assistant inside the FXcrypt mobile & web app. You help the owner explore the market, manage their wallet, and run the app's tools.

The app trades memecoins/tokens across BSC, ETH, SOL and Base via DEXs, runs a "gem scanner" for new tokens, tracks tokens, analyzes holders (bubble maps), and generates CEX/futures signals. You can read live app/market/wallet state with your tools and answer questions, summarize activity, flag risks, and recommend actions.

You CAN: read the owner's wallet balances (BNB/ETH/SOL/MATIC/TON) and bot/wallet configuration (addresses and settings — never private keys) and their connected CEX exchange balances; **search the entire market — ANY coin or token by name, ticker, or contract address — via lookup_token (CoinGecko-listed coins with market-cap rank + on-chain DEX tokens across all chains)**; browse the live market (top coins, gainers, losers, volume) via get_market; **research the live web & news with web_search (crypto trends, narratives, project background, regulation & government policy, hacks, listings, macro)**; get live prices and market data; run the gem scanner; scan cross-DEX arbitrage; generate and read CEX/futures signals (technical analysis on Binance/MEXC/Bybit/KuCoin); check token safety/honeypot risk and holder counts; view & manage the owner's **Token Tracker** watchlist (add/remove/search tokens); pull full info for any token; and run **bubble-map holder analysis** (top holders, top-10 concentration, linked-wallet clusters) to flag whale/insider/bundling risk.

PRIVATE KEYS: you never see or expose private keys, seed phrases or the means to move funds without approval. You can report balances and addresses, but never reveal secrets.

TRADING IS GATED: you CANNOT execute trades directly. To act on a trade idea, call propose_trade — this surfaces an Approve/Reject card RIGHT HERE IN THE APP and the owner decides; execution happens only if they approve, from their own wallet. The card appears in this chat — NEVER tell the owner to open Discord, a Telegram bot, or any other place to approve, sign, or execute; they do everything here in the app. Never claim a trade executed; only that you proposed it.

TRADE ACCURACY (critical): before you call propose_trade you MUST have the token's exact contract address from a tool — call lookup_token (or check_token / a gem scan) and use the address it returns. NEVER type, guess, or recall a contract address from memory; a wrong address means the owner could buy the wrong or a scam token. Always run check_token and state the risk before proposing a buy. Do not set slippage yourself — the app applies the owner's configured slippage.

Finding tokens: when the owner names a token ("info on WIF", "track PEPE"), search it yourself with lookup_token or pass the name as track_token's \`query\` — do NOT ask for a contract address unless the search returns nothing or is genuinely ambiguous.

STANDING WATCH-TASKS: when the owner asks to be pinged/alerted/notified when something happens ("watch BTC and ping me if it breaks $150k", "tell me if PEPE dumps 20%"), call create_watch_task — the app monitors it 24/7 and you'll automatically analyze and notify them when it fires. Confirm what you armed. Manage tasks with list_watch_tasks / cancel_watch_task.

Research: you DO have live internet access through web_search — NEVER tell the user you can't browse or lack real-time data. For anything current (prices aside) — news, trends, narratives, regulation/government policy, project updates — call web_search first, then summarize and cite the source names and dates. Be clear about what's confirmed news vs. opinion/rumor. The app AUTOMATICALLY shows clickable source links (shortened) below your reply for everything you found via web_search, so reference sources by name/date in your text but do NOT paste raw URLs — they're added for you.

Style: concise, mobile-friendly markdown. Lead with the answer. Use compact numbers ($12.3K). Be direct about risk — these are high-risk speculative tokens. When unsure, say so and use a tool rather than guessing.`

const NATIVE = { bsc: 'BNB', eth: 'ETH', base: 'ETH', sol: 'SOL', ton: 'TON' }
const TRACKER_CID = { bsc: 'bsc', eth: 'ethereum', sol: 'solana' } // DexScreener chain ids for the tracker
const DS_CID = { bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base', poly: 'polygon', arb: 'arbitrum' } // DexScreener chain ids

// Verify/resolve a proposed trade's token ON-CHAIN before it becomes a proposal
// card, so a hallucinated or mistyped contract address never reaches the owner.
// Trusts the model's address only if it actually exists on the given chain;
// otherwise falls back to resolving by symbol (best-liquidity, exact-symbol
// preferred). Returns the canonical address + real symbol + live price/liquidity,
// or { ok:false, reason } so the agent is told to look the token up instead.
async function verifyProposalToken(args) {
  const chain = args.chain
  const cid = DS_CID[chain]
  if (!cid) return { ok: false, reason: `Unsupported chain "${chain}".` }
  const okFrom = (p) => ({
    ok: true, chain,
    tokenAddress: p.baseToken.address,
    tokenSymbol: p.baseToken.symbol || args.tokenSymbol || '???',
    priceUsd: parseFloat(p.priceUsd) || null,
    liquidityUsd: p.liquidity?.usd || null,
  })
  const rawAddr = String(args.tokenAddress || '').trim()
  const looksAddr = /^0x[0-9a-fA-F]{40}$/.test(rawAddr) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawAddr)

  // 1) Trust the model's address ONLY if DexScreener confirms it on this chain.
  if (looksAddr) {
    try {
      const { data } = await axios.get('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(rawAddr), { timeout: 10000 })
      const cand = (data?.pairs || []).filter((p) => p.baseToken?.address && p.chainId === cid && p.baseToken.address.toLowerCase() === rawAddr.toLowerCase())
      if (cand.length) { cand.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)); return okFrom(cand[0]) }
    } catch { /* fall through to symbol resolution */ }
  }

  // 2) Resolve by symbol/name (address missing, malformed, or not found on-chain).
  const q = String(args.tokenSymbol || rawAddr || '').trim()
  if (q) {
    try {
      const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(q), { timeout: 10000 })
      const cand = (data?.pairs || []).filter((p) => p.baseToken?.address && p.chainId === cid)
      if (cand.length) {
        cand.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
        const exact = cand.find((p) => (p.baseToken?.symbol || '').toLowerCase() === q.toLowerCase())
        return okFrom(exact || cand[0])
      }
    } catch { /* no match */ }
  }
  return { ok: false, reason: `No ${String(chain).toUpperCase()} token found matching ${args.tokenSymbol ? `"${args.tokenSymbol}"` : 'that address'}.` }
}

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
      const fail = (chain, e) => { console.error(`[get_balances] ${chain} error:`, e?.message || e); return { error: e?.message || String(e) } }
      for (const [chain, w] of Object.entries(wallets)) {
        if (!w?.address) continue
        if (chain === 'sol') jobs.push(trader.getSOLBalance(w.address, settings.solRpc).then(b => { out.sol = b }).catch(e => { out.sol = fail('sol', e) }))
        else if (chain === 'ton') jobs.push(trader.getTONBalance(w.address).then(b => { out.ton = b }).catch(e => { out.ton = fail('ton', e) }))
        else jobs.push(trader.getEVMBalance(w.address, chain, settings[chain + 'Rpc']).then(b => { out[chain] = b }).catch(e => { out[chain] = fail(chain, e) }))
      }
      await Promise.all(jobs)
      console.log('[get_balances] result:', JSON.stringify(out))
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
      // Universal search: CoinGecko (every listed coin by name/ticker, with
      // market-cap rank) + DexScreener (on-chain DEX tokens by name/symbol/
      // contract address). Returns both so the model can pick the right match.
      const q = String(input.query || '').trim()
      const isAddr = /^0x[0-9a-fA-F]{40}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)
      const out = []
      // 1) CoinGecko — listed coins (majors/CEX). Skip for raw contract addresses.
      if (q && !isAddr) {
        try {
          const { data: s } = await axios.get('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(q), { timeout: 10000 })
          const ids = (s?.coins || []).slice(0, 8).map((c) => c.id).filter(Boolean)
          if (ids.length) {
            const { data: mk } = await axios.get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&price_change_percentage=24h`, { timeout: 10000 })
            for (const c of (mk || [])) out.push({ source: 'coingecko', cgId: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name, rank: c.market_cap_rank, priceUsd: c.current_price, marketCap: c.market_cap, volume24h: c.total_volume, change24h: c.price_change_percentage_24h })
          }
        } catch { /* continue to DexScreener */ }
      }
      // 2) DexScreener — on-chain DEX tokens (name/symbol/contract). Best pair per token.
      try {
        const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(q), { timeout: 10000 })
        const best = {}
        for (const p of (data?.pairs || [])) {
          const a = p.baseToken?.address
          if (!a) continue
          const k = `${p.chainId}:${a.toLowerCase()}`
          if (!best[k] || (p.liquidity?.usd || 0) > (best[k].liquidity?.usd || 0)) best[k] = p
        }
        Object.values(best)
          .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
          .slice(0, 8)
          .forEach((p) => out.push({ source: 'dexscreener', symbol: p.baseToken?.symbol, name: p.baseToken?.name, chain: p.chainId, address: p.baseToken?.address, priceUsd: p.priceUsd, liquidity: p.liquidity?.usd, volume24h: p.volume?.h24, marketCap: p.marketCap || p.fdv, change24h: p.priceChange?.h24, dex: p.dexId }))
      } catch { /* return whatever CoinGecko gave */ }
      return out.length ? out : { note: `No coins or tokens found for "${q}".` }
    }
    case 'get_market': {
      // Live market overview (CoinGecko) — mirrors the app's Markets tab.
      const limit = Math.min(Math.max(parseInt(input.limit) || 20, 1), 50)
      const sort = ['market_cap', 'gainers', 'losers', 'volume'].includes(input.sort) ? input.sort : 'market_cap'
      const order = sort === 'volume' ? 'volume_desc' : 'market_cap_desc'
      // For gainers/losers, pull a wider page then re-sort by 24h change.
      const perPage = (sort === 'gainers' || sort === 'losers') ? 100 : limit
      const { data } = await axios.get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=${order}&per_page=${perPage}&page=1&price_change_percentage=24h`, { timeout: 10000 })
      let rows = (data || []).map((c) => ({ rank: c.market_cap_rank, symbol: (c.symbol || '').toUpperCase(), name: c.name, cgId: c.id, priceUsd: c.current_price, marketCap: c.market_cap, volume24h: c.total_volume, change24h: c.price_change_percentage_24h }))
      if (input.query) { const t = String(input.query).toLowerCase(); rows = rows.filter((r) => (r.symbol + ' ' + r.name).toLowerCase().includes(t)) }
      if (sort === 'gainers') rows.sort((a, b) => (b.change24h || 0) - (a.change24h || 0))
      else if (sort === 'losers') rows.sort((a, b) => (a.change24h || 0) - (b.change24h || 0))
      return rows.slice(0, limit)
    }
    case 'get_crypto_price': {
      const ids = (input.ids || []).map(String).filter(Boolean).slice(0, 25).join(',')
      const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`, { timeout: 10000 })
      return data
    }
    case 'web_search': {
      // Keyless live web/news research. Primary: Google News RSS (broad, query-
      // based). Fallback: major crypto-news RSS feeds — so research still works
      // even if News is unavailable from the server's region.
      const q = String(input.query || '').trim()
      if (!q) return { error: 'query is required' }
      const when = input.recency === 'any' ? '' : ' when:' + ({ day: '1d', week: '7d', month: '30d' }[input.recency] || '7d')
      const decode = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
      const grab = (block, re) => { const r = re.exec(block); return r ? r[1] : '' }
      const parseRss = (xml, fallbackSource) => {
        const out = []
        const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g
        let m
        while ((m = itemRe.exec(xml)) && out.length < 12) {
          const b = m[1]
          const title = decode(grab(b, /<title>([\s\S]*?)<\/title>/))
          if (!title) continue
          out.push({
            title, source: decode(grab(b, /<source[^>]*>([\s\S]*?)<\/source>/)) || fallbackSource || '',
            published: decode(grab(b, /<pubDate>([\s\S]*?)<\/pubDate>/)),
            link: decode(grab(b, /<link>([\s\S]*?)<\/link>/)),
            snippet: decode(grab(b, /<description>([\s\S]*?)<\/description>/)).slice(0, 220),
          })
        }
        return out
      }
      // Browser-like headers + CONSENT cookie skip the EU/cloud cookie-consent
      // interstitial that otherwise replaces Google's feed when called server-side.
      const HDRS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36', Cookie: 'CONSENT=YES+cb', Accept: 'application/rss+xml,text/xml;q=0.9,*/*;q=0.8' }
      let out = []
      try {
        const { data } = await axios.get(`https://news.google.com/rss/search?q=${encodeURIComponent(q + when)}&hl=en-US&gl=US&ceid=US:en`, { timeout: 12000, headers: HDRS })
        out = parseRss(data).slice(0, 10)
      } catch (e) { /* fall through to crypto feeds */ }
      if (!out.length) {
        const FEEDS = [['Cointelegraph', 'https://cointelegraph.com/rss'], ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml'], ['Decrypt', 'https://decrypt.co/feed']]
        const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
        const all = []
        await Promise.all(FEEDS.map(async ([name, url]) => {
          try { const { data } = await axios.get(url, { timeout: 12000, headers: HDRS }); all.push(...parseRss(data, name)) } catch (e) {}
        }))
        const matched = words.length ? all.filter((a) => { const t = (a.title + ' ' + a.snippet).toLowerCase(); return words.some((w) => t.includes(w)) }) : all
        out = (matched.length ? matched : all).slice(0, 10)
      }
      console.log('[web_search]', JSON.stringify(q), '→', out.length, 'results')
      return out.length ? { query: q, results: out } : { query: q, results: [], note: `No web results found for "${q}" right now.` }
    }
    case 'check_token': {
      return await trader.checkToken(input.address, input.chain)
    }
    case 'get_token_holders': {
      const chain = input.chain, addr = String(input.address || '').trim()
      const apiErr = (e) => e.response?.status === 401 ? 'invalid/unauthorized key' : (e.response?.status || e.message)
      if (chain === 'sol') {
        if (!ctx.heliusKey) return { holders: null, error: 'Helius key not configured (set HELIUS_API_KEY)' }
        try {
          const { data } = await axios.post(`https://mainnet.helius-rpc.com/?api-key=${ctx.heliusKey}`, { jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: addr } }, { timeout: 10000 })
          const h = data?.result?.token_info?.holder_count
          return { holders: h != null ? parseInt(h, 10) : null, note: h == null ? 'Helius returned no holder_count for this mint' : undefined }
        } catch (e) { return { holders: null, error: 'Helius error: ' + apiErr(e) } }
      }
      if (ctx.moralisKey) {
        const chainHex = chain === 'bsc' ? '0x38' : chain === 'base' ? '0x2105' : '0x1'
        try {
          const { data } = await axios.get(`https://deep-index.moralis.io/api/v2.2/erc20/${addr}/holders?chain=${chainHex}`, { headers: { 'X-API-Key': ctx.moralisKey }, timeout: 10000 })
          const c = data.totalHolders ?? data.holders_count ?? data.owners_count
          if (c != null) return { holders: parseInt(c, 10) }
        } catch (e) {
          if (chain !== 'eth') return { holders: null, error: 'Moralis error: ' + apiErr(e) }
        }
      } else if (chain === 'bsc' || chain === 'base') {
        return { holders: null, error: 'Moralis key not configured (set MORALIS_API_KEY)' }
      }
      if (chain === 'eth') {
        try { const { data } = await axios.get(`https://api.ethplorer.io/getTokenInfo/${addr}?apiKey=freekey`, { timeout: 10000 }); if (data.holdersCount != null) return { holders: parseInt(data.holdersCount, 10) } } catch {}
      }
      return { holders: null, note: 'No holder data available from providers' }
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
    case 'get_token_info': {
      const chain = input.chain, addr = String(input.address || '').trim()
      const cid = TRACKER_CID[chain] || chain
      let pair = null
      try {
        const { data } = await axios.get(`https://api.dexscreener.com/token-pairs/v1/${cid}/${addr}`, { timeout: 10000 })
        if (Array.isArray(data) && data.length) { data.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)); pair = data[0] }
      } catch {}
      if (!pair) return { error: `Token not found on ${chain.toUpperCase()} for ${addr}` }
      let holders = null
      try { holders = (await runTool('get_token_holders', { chain, address: addr }, ctx)).holders } catch {}
      return { name: pair.baseToken?.name, symbol: pair.baseToken?.symbol, chain, address: addr, priceUsd: pair.priceUsd, marketCap: pair.marketCap || pair.fdv, volume24h: pair.volume?.h24, liquidity: pair.liquidity?.usd, change24h: pair.priceChange?.h24, holders, dexUrl: pair.url }
    }
    case 'get_tracked_tokens': {
      // The owner's watchlist spans TWO collections and Pointer must see BOTH:
      //   users/{uid}/watchlist     — Markets-tab stars (CoinGecko coins AND on-chain tokens)
      //   users/{uid}/trackedTokens — the standalone Token Tracker (on-chain only)
      // Union them (deduped by token identity) so the full watchlist is returned,
      // not just the Token Tracker subset.
      const [wSnap, tSnap] = await Promise.all([
        db.collection(`users/${uid}/watchlist`).get().catch(() => null),
        db.collection(`users/${uid}/trackedTokens`).get().catch(() => null),
      ])
      const keyOf = (o) => o.cg ? 'cg:' + o.cg
        : o.address ? 'tk:' + (o.chain || '') + ':' + String(o.address).toLowerCase()
        : 'sym:' + String(o.symbol || '').toUpperCase()
      const byKey = new Map()
      // Markets-tab watchlist first (primary), then Token Tracker (merged, deduped).
      if (wSnap) for (const d of wSnap.docs) {
        const x = d.data()
        const o = { cg: x.cg || null, chain: x.chain || null, address: x.address || null, symbol: x.sym || '', name: x.name || x.sym || '', source: 'watchlist' }
        const k = x.key || keyOf(o); if (!byKey.has(k)) byKey.set(k, o)
      }
      if (tSnap) for (const d of tSnap.docs) {
        const x = d.data()
        const o = { cg: null, chain: x.chain || null, address: x.contractAddress || x.address || null, symbol: x.symbol || '', name: x.name || x.symbol || '', source: 'tracker' }
        const k = keyOf(o); if (!byKey.has(k)) byKey.set(k, o)
      }
      const items = [...byKey.values()]
      if (!items.length) return []

      // Enrich on-chain tokens with live DexScreener data (best pair per token).
      const priceMap = {}
      const byChain = {}
      for (const t of items) { if (t.address && t.chain) (byChain[t.chain] = byChain[t.chain] || []).push(t) }
      for (const [ch, group] of Object.entries(byChain)) {
        const cid = DS_CID[ch] || ch
        for (let i = 0; i < group.length; i += 30) {
          try {
            const addrs = group.slice(i, i + 30).map((t) => t.address).join(',')
            const { data } = await axios.get(`https://api.dexscreener.com/tokens/v1/${cid}/${addrs}`, { timeout: 10000 })
            if (Array.isArray(data)) for (const p of data) { const a = p.baseToken?.address?.toLowerCase(); if (a && (!priceMap[a] || (p.liquidity?.usd || 0) > (priceMap[a].liquidity?.usd || 0))) priceMap[a] = p }
          } catch {}
        }
      }
      // Enrich CoinGecko coins (watchlist stars with a cg id) with live price.
      const cgMap = {}
      const cgIds = items.filter((t) => t.cg).map((t) => t.cg)
      if (cgIds.length) {
        try {
          const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(cgIds.join(','))}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`, { timeout: 10000 })
          Object.assign(cgMap, data || {})
        } catch {}
      }
      return items.map((t) => {
        if (t.address && t.chain) {
          const p = priceMap[String(t.address).toLowerCase()]
          return { name: t.name || t.symbol, symbol: t.symbol, chain: t.chain, address: t.address, source: t.source, priceUsd: p?.priceUsd || null, change24h: p?.priceChange?.h24 ?? null, marketCap: p?.marketCap || p?.fdv || null, volume24h: p?.volume?.h24 || null, liquidity: p?.liquidity?.usd || null }
        }
        const c = cgMap[t.cg] || {}
        return { name: t.name || t.symbol, symbol: t.symbol, cgId: t.cg || undefined, chain: t.chain || 'coingecko', address: t.address || null, source: t.source, priceUsd: c.usd ?? null, change24h: c.usd_24h_change ?? null, marketCap: c.usd_market_cap ?? null, volume24h: c.usd_24h_vol ?? null, liquidity: null }
      })
    }
    case 'track_token': {
      const REV = { bsc: 'bsc', ethereum: 'eth', solana: 'sol', base: 'base' }
      let chain = input.chain, name = input.name || '', symbol = input.symbol || ''
      let addr = String(input.address || input.query || '').trim()
      const looksLikeAddress = /^0x[0-9a-fA-F]{40}$/.test(addr) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)

      // Resolve by name/symbol (or address with unknown chain) via DexScreener search.
      if (!looksLikeAddress || !chain) {
        const q = String(input.query || input.address || input.name || input.symbol || '').trim()
        if (!q) return { error: 'Provide a token name, symbol, or contract address to track.' }
        let pairs = []
        try { const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(q), { timeout: 10000 }); pairs = data?.pairs || [] } catch {}
        const wanted = chain ? (TRACKER_CID[chain] || chain) : null
        const cand = pairs.filter((p) => p.baseToken?.address && (!wanted || p.chainId === wanted))
        if (!cand.length) return { error: `Couldn't find a token matching "${q}"${chain ? ' on ' + chain.toUpperCase() : ''}. Double-check the name or give the contract address.` }
        cand.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
        // If the query is a short symbol, prefer an exact symbol match when one exists.
        const exact = cand.find((p) => (p.baseToken?.symbol || '').toLowerCase() === q.toLowerCase())
        const best = exact || cand[0]
        chain = REV[best.chainId] || best.chainId
        addr = best.baseToken.address
        name = name || best.baseToken.name || ''
        symbol = symbol || best.baseToken.symbol || ''
      }

      const existing = await db.collection(`users/${uid}/trackedTokens`).where('chain', '==', chain).get().catch(() => null)
      if (existing && existing.docs.some((d) => (d.data().contractAddress || '').toLowerCase() === addr.toLowerCase())) return { ok: true, note: `${symbol || name || addr} is already in the watchlist`, chain, address: addr }
      if (!name || !symbol) { try { const info = await runTool('get_token_info', { chain, address: addr }, ctx); name = name || info.name || ''; symbol = symbol || info.symbol || '' } catch {} }
      await db.collection(`users/${uid}/trackedTokens`).add({ contractAddress: addr, chain, name, symbol, addedAt: new Date().toISOString() })
      return { ok: true, added: { chain, address: addr, name, symbol } }
    }
    case 'untrack_token': {
      const chain = input.chain, addr = String(input.address || '').trim()
      // Remove from BOTH the Token Tracker and the Markets-tab watchlist so the
      // token doesn't linger in one collection after the owner asks to drop it.
      const snap = await db.collection(`users/${uid}/trackedTokens`).where('chain', '==', chain).get().catch(() => null)
      const matches = snap ? snap.docs.filter((d) => (d.data().contractAddress || '').toLowerCase() === addr.toLowerCase()) : []
      await Promise.all(matches.map((d) => d.ref.delete().catch(() => {})))
      // The watchlist doc id is the token key with non-alphanumerics → '_'.
      let watchRemoved = 0
      if (addr) {
        const watchKey = ('tk:' + (chain || '') + ':' + addr.toLowerCase()).replace(/[^a-zA-Z0-9_-]/g, '_')
        const ref = db.doc(`users/${uid}/watchlist/${watchKey}`)
        try { const ds = await ref.get(); if (ds.exists) { await ref.delete(); watchRemoved = 1 } } catch { /* ignore */ }
      }
      const removed = matches.length + watchRemoved
      if (!removed) return { ok: false, note: 'Not in watchlist' }
      return { ok: true, removed }
    }
    case 'create_watch_task': {
      const cond = ['above', 'below', 'move'].includes(input.cond) ? input.cond : null
      const value = parseFloat(input.value)
      if (!cond || !Number.isFinite(value) || value <= 0) return { ok: false, error: 'cond (above/below/move) and a positive value are required' }
      const q = String(input.query || '').trim()
      if (!q) return { ok: false, error: 'query (token name/symbol) required' }

      // Plan cap on ACTIVE tasks (armed or quota-paused).
      const uSnap = await db.doc(`users/${uid}`).get()
      const uDoc = uSnap.exists ? uSnap.data() : {}
      const plan = ['free', 'pro', 'elite'].includes(uDoc.plan) ? uDoc.plan : 'free'
      const ovr = parseInt((uDoc.userLimits || {}).pointerTaskQuota)
      const quota = Number.isFinite(ovr) ? ovr : ({ free: 2, pro: 10, elite: 30 })[plan]
      const activeSnap = await db.collection(`users/${uid}/pointerTasks`).where('status', 'in', ['armed', 'quota-paused']).get().catch(() => null)
      if (activeSnap && activeSnap.size >= quota) return { ok: false, error: `The owner's plan allows ${quota} active watch-tasks and they already have ${activeSnap.size}. Suggest cancelling one (list_watch_tasks) or upgrading.` }

      // Resolve the token: CoinGecko first (majors like BTC), DexScreener fallback
      // (on-chain tokens). Store the canonical id so the monitor prices it.
      let target = null
      try {
        const { data } = await axios.get('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(q), { timeout: 10000 })
        const c = (data?.coins || [])[0]
        if (c && (c.symbol || '').toLowerCase() === q.toLowerCase().replace(/^\$/, '')) target = { cg: c.id, sym: c.symbol.toUpperCase(), name: c.name }
        else if (c && !target) target = null // ambiguous CG match — try DexScreener before settling
      } catch { /* fall through */ }
      if (!target) {
        try {
          const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(q), { timeout: 10000 })
          const cand = (data?.pairs || []).filter((p) => p.baseToken?.address && DS_CID[p.chainId === 'ethereum' ? 'eth' : p.chainId === 'solana' ? 'sol' : p.chainId])
          if (cand.length) {
            cand.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
            const p = cand[0]
            const chain = p.chainId === 'ethereum' ? 'eth' : p.chainId === 'solana' ? 'sol' : p.chainId
            target = { chain, address: p.baseToken.address, sym: p.baseToken.symbol || q.toUpperCase(), name: p.baseToken.name || q }
          }
        } catch { /* no match */ }
      }
      if (!target) return { ok: false, error: `Couldn't resolve "${q}" to a token — ask the owner to clarify.` }

      // Base price (required for 'move', useful context for all kinds).
      let basePrice = null
      try {
        if (target.cg) {
          const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(target.cg)}&vs_currencies=usd`, { timeout: 10000 })
          basePrice = data?.[target.cg]?.usd || null
        } else {
          const { data } = await axios.get('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(target.address), { timeout: 10000 })
          const pair = (data?.pairs || []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]
          basePrice = pair ? parseFloat(pair.priceUsd) || null : null
        }
      } catch { /* base price is best-effort except for move */ }
      if (cond === 'move' && !basePrice) return { ok: false, error: 'No live price available — % move tasks need one.' }

      const task = {
        kind: 'price', cond, value,
        cg: target.cg || null, chain: target.chain || null, address: target.address || null,
        sym: target.sym, name: target.name, basePrice,
        note: String(input.note || '').slice(0, 200),
        status: 'armed', createdAt: Date.now(),
      }
      const ref = await db.collection(`users/${uid}/pointerTasks`).add(task)
      const condDesc = cond === 'above' ? `rises above $${value}` : cond === 'below' ? `falls below $${value}` : `moves ±${value}% from $${basePrice}`
      return { ok: true, taskId: ref.id, armed: `${target.sym} ${condDesc}`, currentPrice: basePrice, monitoredEvery: '5 minutes' }
    }
    case 'list_watch_tasks': {
      const snap = await db.collection(`users/${uid}/pointerTasks`).orderBy('createdAt', 'desc').limit(30).get().catch(() => null)
      if (!snap) return []
      return snap.docs.map((d) => { const t = d.data(); return { taskId: d.id, sym: t.sym, cond: t.cond, value: t.value, status: t.status, basePrice: t.basePrice, firedAt: t.firedAt || null } })
    }
    case 'cancel_watch_task': {
      const id = String(input.taskId || '').trim()
      if (!id) return { ok: false, error: 'taskId required' }
      const ref = db.doc(`users/${uid}/pointerTasks/${id}`)
      const s = await ref.get()
      if (!s.exists) return { ok: false, error: 'No such task' }
      await ref.delete()
      return { ok: true, cancelled: s.data().sym }
    }
    case 'get_bubble_map': {
      const chain = input.chain, addr = String(input.address || '').trim()
      let graph
      try {
        if (chain === 'sol') {
          if (!ctx.heliusKey) return { error: 'Helius key not configured' }
          graph = await holdergraph.solHolderGraph(addr, 60, ctx.heliusKey)
        } else {
          if (!ctx.moralisKey) return { error: 'Moralis key not configured (needed for EVM bubble maps)' }
          graph = await holdergraph.evmHolderGraph(chain, addr.toLowerCase(), 60, ctx.moralisKey)
        }
      } catch (e) { return { error: e.message || 'holder graph failed' } }

      const holders = graph.holders || []
      if (!holders.length) return { error: 'No holder data available for this token' }
      const top10pct = holders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0)
      const cluster = clusterSummary(holders.map((h) => (h.address || '').toLowerCase()), graph.edges || [])
      return {
        token: { name: graph.token?.name || null, symbol: graph.token?.symbol || null, chain },
        holdersAnalyzed: holders.length,
        top10Concentration: +top10pct.toFixed(2),
        contractHolders: holders.filter((h) => h.isContract).length,
        ...cluster,
        topHolders: holders.slice(0, 10).map((h) => ({ address: h.address, pct: h.pct != null ? +h.pct.toFixed(2) : null, isContract: h.isContract || undefined, label: h.label || undefined })),
      }
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
async function runAgent({ prompt, history = [], ctx, provider = 'deepseek', apiKey, surface = 'discord', deep = false, deepModel = null, mcp = null }) {
  const isPointer = surface === 'pointer'
  const cfg = PROVIDERS[provider] || PROVIDERS.deepseek
  // Deep research → the provider's top-tier model (admin override wins), more
  // agent loops and a larger answer budget so it can reason and cross-check.
  let activeModel = deep ? (deepModel || cfg.deepModel || cfg.model) : cfg.model
  const maxLoops = deep ? DEEP_MAX_LOOPS : MAX_LOOPS
  const maxTokens = deep ? 8000 : 4096
  const client = new OpenAI({ apiKey, baseURL: cfg.baseURL })
  // MCP tools (e.g. Glassnode on-chain analytics) are bridged in for Pointer
  // only, when an admin has enabled the connection. They're proxied to the
  // external MCP server by mcp.call() and namespaced (gn_*), so a failure or
  // absence of MCP never affects the built-in tools.
  const mcpTools = (isPointer && mcp && Array.isArray(mcp.tools)) ? mcp.tools : []
  const mcpNames = new Set(mcpTools.map((t) => t.function && t.function.name))
  const tools = isPointer ? [...TOOLS_POINTER, ...mcpTools] : TOOLS
  const mcpDirective = mcpTools.length ? `\n\nGLASSNODE ON-CHAIN ANALYTICS: you also have Glassnode tools (named gn_*) for institutional on-chain metrics — SOPR, MVRV, realized cap, exchange in/outflows, active/new addresses, supply distribution, HODL waves, miner data and more. Use them for deep on-chain questions on major assets (BTC, ETH, etc.), and attribute the data to Glassnode.` : ''
  const toolCtx = { ...ctx, surface }
  const messages = [
    { role: 'system', content: (isPointer ? SYSTEM_POINTER : SYSTEM) + (deep ? DEEP_DIRECTIVE : '') + mcpDirective },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: prompt },
  ]
  let proposal = null
  // Real reference links the agent actually consulted (web_search articles) —
  // surfaced to the client as clickable, shortened source chips. Deduped by URL.
  const sources = []
  const addSources = (results) => {
    for (const r of results || []) {
      if (!r || !r.link || sources.some((s) => s.url === r.link)) continue
      let host = ''
      try { host = new URL(r.link).hostname.replace(/^www\./, '') } catch (_) {}
      sources.push({ label: r.source || host || 'source', title: r.title || '', url: r.link })
      if (sources.length >= 6) break
    }
  }

  for (let i = 0; i < maxLoops; i++) {
    let resp
    try {
      // OpenAI's reasoning-class models (o*/gpt-5*) reject `max_tokens` and
      // require `max_completion_tokens`; DeepSeek (and most OpenAI-compatible
      // proxies) only understand `max_tokens`. Pick per provider so the deep
      // model doesn't 400 on every call and silently lose deep mode.
      const tokenParam = provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }
      resp = await client.chat.completions.create({
        model: activeModel,
        ...tokenParam,
        messages,
        tools,
        tool_choice: 'auto',
      })
    } catch (e) {
      // If the top-tier deep model rejects the request (unavailable, or doesn't
      // support tool-calls on this account), fall back to the standard model
      // once rather than failing the whole turn.
      if (deep && activeModel !== cfg.model) {
        console.warn(`deep model "${activeModel}" failed (${e.message}); falling back to "${cfg.model}"`)
        activeModel = cfg.model
        i--
        continue
      }
      throw e
    }
    const msg = resp.choices?.[0]?.message
    if (!msg) break

    const calls = msg.tool_calls || []
    if (calls.length === 0) {
      const text = (msg.content || '').trim()
      const newHistory = [...history, { role: 'user', content: prompt }, { role: 'assistant', content: text || '(no response)' }]
      return { text: text || 'Done.', proposal, history: newHistory.slice(-12), model: activeModel, sources }
    }

    messages.push(msg) // assistant turn carrying tool_calls
    for (const tc of calls) {
      let args = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') } catch {}
      const fname = tc.function?.name
      if (fname === 'propose_trade') {
        // Verify the token on-chain so a hallucinated/mistyped address or wrong
        // slippage never reaches the owner's approval card.
        const verified = await verifyProposalToken(args)
        if (!verified.ok) {
          proposal = null
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `Could not verify the token on-chain: ${verified.reason} Call lookup_token to get the correct contract address, then call propose_trade again with that exact address. Never guess a contract address.` })
          continue
        }
        // Slippage is the owner's configured value — never the model's guess — so
        // the card matches what execution will actually use.
        let slippage = 10
        try { const us = await toolCtx.db.doc(`users/${toolCtx.uid}`).get(); const s = us.exists ? (us.data().botSettings || {}) : {}; slippage = s.defaultSlippage != null ? s.defaultSlippage : 10 } catch { /* keep default */ }
        proposal = {
          ...args,
          chain: verified.chain,
          tokenAddress: verified.tokenAddress,
          tokenSymbol: verified.tokenSymbol,
          slippage,
          priceUsd: verified.priceUsd,
          liquidityUsd: verified.liquidityUsd,
        }
        const place = isPointer ? 'right here in the app' : 'in Discord'
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `Verified on-chain: ${verified.tokenSymbol} at ${verified.tokenAddress} (${verified.chain}), slippage ${slippage}%. An Approve/Reject card is now shown to the owner ${place}. Do not propose again. Briefly summarize what you proposed and why (use the verified symbol), and tell the owner to approve or reject the card ${isPointer ? 'here in the app' : 'in Discord'} — do not mention any other place.` })
        continue
      }
      // Bridged MCP (Glassnode) tool call → proxy to the external server.
      if (mcpNames.has(fname)) {
        try {
          const text = await mcp.call(fname, args)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: String(text || '(no data)').slice(0, 8000) })
        } catch (e) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Glassnode error: ' + (e.message || 'call failed') })
        }
        continue
      }
      try {
        const result = await runTool(fname, args, toolCtx)
        if (fname === 'web_search' && result && Array.isArray(result.results)) addSources(result.results)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) })
      } catch (e) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: ' + (e.message || 'tool failed') })
      }
    }
  }

  return { text: 'Reached step limit. Try a more specific request.', proposal, history, model: activeModel, sources }
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

const axios      = require('axios')
const safety     = require('./safety')
const cexTrader  = require('./cex-trader')
const signalGen  = require('./signal-generator')
const marketAnalyzer = require('./market-analyzer')


const VALID_CHAINS  = new Set(['bsc', 'eth', 'sol', 'base', 'ton'])
const TG_API_TIMEOUT = 10000

// Minimal Telegram client using direct REST calls — no third-party bot library
function createBot(token) {
  const base = `https://api.telegram.org/bot${token}`
  return {
    sendMessage: (chatId, text, opts = {}) =>
      axios.post(`${base}/sendMessage`, { chat_id: chatId, text, ...opts }, { timeout: TG_API_TIMEOUT })
        .then(r => r.data),
    editMessageText: (chatId, messageId, text, opts = {}) =>
      axios.post(`${base}/editMessageText`, { chat_id: chatId, message_id: messageId, text, ...opts }, { timeout: TG_API_TIMEOUT })
        .then(r => r.data).catch(() => {}),
    answerCallbackQuery: (callbackQueryId, text = '') =>
      axios.post(`${base}/answerCallbackQuery`, { callback_query_id: callbackQueryId, text }, { timeout: TG_API_TIMEOUT })
        .then(r => r.data).catch(() => {}),
    deleteMessage: (chatId, messageId) =>
      axios.post(`${base}/deleteMessage`, { chat_id: chatId, message_id: messageId }, { timeout: TG_API_TIMEOUT })
        .then(r => r.data).catch(() => {}),
  }
}

function explorerUrl(chain, txHash) {
  const base = chain === 'bsc'  ? 'https://bscscan.com/tx/' :
               chain === 'eth'  ? 'https://etherscan.io/tx/' :
               chain === 'base' ? 'https://basescan.org/tx/' :
               chain === 'ton'  ? 'https://tonscan.org/tx/' :
               'https://solscan.io/tx/'
  return base + txHash
}

function nativeTicker(chain) {
  return chain === 'bsc' ? 'BNB' : chain === 'base' ? 'ETH' : chain === 'ton' ? 'TON' : chain === 'sol' ? 'SOL' : 'ETH'
}

// Safe numeric parsers — return null if input is not a valid finite number
function safeParseFloat(str) {
  const n = parseFloat(str)
  return isFinite(n) && n > 0 ? n : null
}

function safeParsePercent(str) {
  const n = parseInt(str, 10)
  return isFinite(n) && n >= 1 && n <= 100 ? n : null
}

// ── Inline keyboard builders ───────────────────────────────────────────────
const BACK_BTN = { text: '⬅️ Menu', callback_data: 'menu_main' }

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⚡ Status',   callback_data: 'action_status'  },
        { text: '💰 Balances', callback_data: 'action_balance' },
      ],
      [
        { text: '🎯 Sniper',   callback_data: 'menu_sniper'    },
        { text: '🔄 Trade',    callback_data: 'menu_trade'     },
      ],
      [
        { text: '💎 Gems',     callback_data: 'menu_gems'      },
        { text: '🔑 Wallets',  callback_data: 'menu_wallets'   },
      ],
      [
        { text: '🤖 Agent',    callback_data: 'menu_agent'     },
      ],
      [
        { text: '⚙️ Settings', callback_data: 'menu_settings'  },
      ],
    ],
  }
}

function sniperMenuKeyboard(pendingCount) {
  return {
    inline_keyboard: [
      [
        { text: `📋 Queue (${pendingCount})`, callback_data: 'action_snipes' },
        { text: '➕ Add Snipe',               callback_data: 'sniper_add'    },
      ],
      [{ text: '📜 History', callback_data: 'action_history' }],
      [BACK_BTN],
    ],
  }
}

function tradeMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🟡 BSC',  callback_data: 'trade_chain_bsc'  },
        { text: '💠 ETH',  callback_data: 'trade_chain_eth'  },
      ],
      [
        { text: '🟣 SOL',  callback_data: 'trade_chain_sol'  },
        { text: '🔵 BASE', callback_data: 'trade_chain_base' },
      ],
      [{ text: '📜 History', callback_data: 'action_history' }],
      [BACK_BTN],
    ],
  }
}

function snipeChainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🟡 BSC',  callback_data: 'snipe_chain_bsc'  },
        { text: '💠 ETH',  callback_data: 'snipe_chain_eth'  },
      ],
      [
        { text: '🟣 SOL',  callback_data: 'snipe_chain_sol'  },
        { text: '🔵 BASE', callback_data: 'snipe_chain_base' },
      ],
      [{ text: '❌ Cancel', callback_data: 'menu_sniper' }],
    ],
  }
}

function walletMenuKeyboard(wallets) {
  const has = c => !!wallets?.[c]?.address
  const tick = c => has(c) ? ' ✅' : ''
  return {
    inline_keyboard: [
      [
        { text: '➕ New BSC wallet',  callback_data: 'wallet_create_bsc'  },
        { text: '➕ New ETH wallet',  callback_data: 'wallet_create_eth'  },
      ],
      [
        { text: '➕ New SOL wallet',  callback_data: 'wallet_create_sol'  },
        { text: '➕ New BASE wallet', callback_data: 'wallet_create_base' },
      ],
      [{ text: '📥 Import Wallet', callback_data: 'wallet_import_menu' }],
      // ── Select wallet (chain detail screens) ─────────────────────────────
      [
        { text: `🟡 BSC${tick('bsc')}`,  callback_data: 'wallet_chain_bsc'  },
        { text: `💠 ETH${tick('eth')}`,  callback_data: 'wallet_chain_eth'  },
        { text: `🟣 SOL${tick('sol')}`,  callback_data: 'wallet_chain_sol'  },
      ],
      [
        { text: `🔵 BASE${tick('base')}`, callback_data: 'wallet_chain_base' },
        { text: `🔷 TON${tick('ton')}`,  callback_data: 'wallet_chain_ton'  },
      ],
      [BACK_BTN],
    ],
  }
}

/** Per-chain wallet detail keyboard. */
function walletChainKeyboard(chain, wallet) {
  const rows = []
  if (chain === 'ton') {
    if (wallet?.address) {
      rows.push([{ text: '💼 View Tokens',    callback_data: `wallet_tokens_${chain}` }])
      rows.push([{ text: '🗑 Remove Address', callback_data: 'wallet_remove_ton'      }])
      rows.push([{ text: '🌐 Manage Key in App', url: 'https://pnl-calculator.web.app/wallet.html' }])
    } else {
      rows.push([{ text: '➕ Add TON Address', callback_data: 'wallet_set_ton' }])
      rows.push([{ text: '🌐 Create Key in App', url: 'https://pnl-calculator.web.app/wallet.html' }])
    }
  } else if (wallet?.address) {
    rows.push([{ text: '💼 View Tokens', callback_data: `wallet_tokens_${chain}` }])
    rows.push([
      { text: '🔑 View Private Key',  callback_data: `wallet_viewkey_${chain}`  },
      { text: '🌱 View Seed Phrase',  callback_data: `wallet_viewseed_${chain}` },
    ])
    rows.push([
      { text: '🆕 Create New',   callback_data: `wallet_create_${chain}` },
      { text: '📥 Import New',   callback_data: `wallet_import_${chain}` },
    ])
    rows.push([{ text: '🗑 Remove Wallet', callback_data: `wallet_remove_${chain}` }])
  } else {
    rows.push([
      { text: '🆕 Create Wallet', callback_data: `wallet_create_${chain}` },
      { text: '📥 Import Wallet', callback_data: `wallet_import_${chain}` },
    ])
  }
  rows.push([{ text: '⬅️ Back to Wallets', callback_data: 'menu_wallets' }])
  return { inline_keyboard: rows }
}

/** Per-token buy/sell row keyboard. Capped at first 10 tokens. TON = display-only. */
function walletTokenListKeyboard(chain, tokens) {
  const canTrade = chain !== 'ton'
  const rows = []
  if (canTrade) {
    tokens.slice(0, 10).forEach((t, i) => {
      const sym = (t.symbol || '?').slice(0, 9)
      rows.push([
        { text: `🟢 Buy ${sym}`,  callback_data: `wtbuy_${chain}_${i}`  },
        { text: `🔴 Sell ${sym}`, callback_data: `wtsell_${chain}_${i}` },
      ])
    })
  }
  rows.push([
    { text: '🔄 Refresh', callback_data: `wallet_tokens_${chain}` },
    { text: '⬅️ Back',    callback_data: `wallet_chain_${chain}`   },
  ])
  return { inline_keyboard: rows }
}

/** Quick % picker shown when user taps Sell on a token. */
function walletSellPickerKeyboard(chain, idx, tokenSymbol) {
  const sym = (tokenSymbol || '?').slice(0, 9)
  return {
    inline_keyboard: [
      [
        { text: '25%',  callback_data: `wsp_${chain}_${idx}_25`  },
        { text: '50%',  callback_data: `wsp_${chain}_${idx}_50`  },
        { text: '75%',  callback_data: `wsp_${chain}_${idx}_75`  },
        { text: '100%', callback_data: `wsp_${chain}_${idx}_100` },
      ],
      [{ text: `✏️ Custom %`, callback_data: `wsc_${chain}_${idx}` }],
      [{ text: `⬅️ Back to ${sym} Holdings`, callback_data: `wallet_tokens_${chain}` }],
    ],
  }
}

/** Summary keyboard shown after a gem scan. byChain = { bsc: [...gems], sol: [...gems] } */
function gemScanSummaryKeyboard(byChain, settings) {
  const alertsOn  = !!settings?.gemAutoEnabled
  const autoBuyOn = !!settings?.gemAutoBuy
  const ICONS     = { bsc: '🟡', sol: '🟣', base: '🔵', ton: '🔷', eth: '💠' }
  const rows      = []
  const chainBtns = Object.entries(byChain)
    .filter(([, gems]) => gems.length)
    .map(([c, gems]) => ({
      text:          `${ICONS[c] || '🔗'} ${c.toUpperCase()} (${gems.length})`,
      callback_data: `gems_chain_${c}`,
    }))
  for (let i = 0; i < chainBtns.length; i += 2) rows.push(chainBtns.slice(i, i + 2))
  rows.push([
    { text: alertsOn  ? '🔔 Alerts ON'    : '🔕 Alerts OFF',
      callback_data: alertsOn  ? 'action_gemoff'         : 'action_gemon'         },
    { text: autoBuyOn ? '🤖 Auto-Buy ON' : '🤖 Auto-Buy OFF',
      callback_data: autoBuyOn ? 'action_gemautobuy_off' : 'action_gemautobuy_on' },
  ])
  rows.push([BACK_BTN])
  return { inline_keyboard: rows }
}

function gemMenuKeyboard(settings) {
  const alertsOn  = !!settings?.gemAutoEnabled
  const autoBuyOn = !!settings?.gemAutoBuy
  return {
    inline_keyboard: [
      [{ text: '🔍 Scan Gems Now', callback_data: 'action_gemscan' }],
      [
        { text: alertsOn  ? '🔔 Alerts ON'     : '🔕 Alerts OFF',    callback_data: alertsOn  ? 'action_gemoff'         : 'action_gemon'        },
        { text: autoBuyOn ? '🤖 Auto-Buy ON'   : '🤖 Auto-Buy OFF',  callback_data: autoBuyOn ? 'action_gemautobuy_off' : 'action_gemautobuy_on' },
      ],
      [BACK_BTN],
    ],
  }
}

function agentMenuKeyboard(agentSettings) {
  const enabled = !!agentSettings?.enabled
  return {
    inline_keyboard: [
      [{ text: '🔍 Scan Markets Now', callback_data: 'action_agentscan' }],
      [
        { text: enabled ? '🟢 Agent ON' : '🔴 Agent OFF', callback_data: enabled ? 'action_agentoff' : 'action_agenton' },
      ],
      [BACK_BTN],
    ],
  }
}


// ── New keyboard builders ──────────────────────────────────────────────────

function settingsMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🤖 Bot Config',   callback_data: 'settings_bot'   }],
      [{ text: '💎 Gem Config',   callback_data: 'settings_gems'  }],
      [{ text: '📈 Agent Config', callback_data: 'settings_agent' }],
      [{ text: '🔑 CEX API Keys', callback_data: 'settings_cex'   }],
      [{ text: '👤 Profile',      callback_data: 'action_profile' }],
      [BACK_BTN],
    ],
  }
}

function botSettingsKeyboard(settings) {
  return {
    inline_keyboard: [
      [{ text: `Slippage: ${settings.defaultSlippage ?? 5}%`,
         callback_data: 'sedit_defaultSlippage' }],
      [{ text: `Gas Multiplier: ${settings.defaultGasMultiplier ?? 1.2}x`,
         callback_data: 'sedit_defaultGasMultiplier' }],
      [{ text: `Min Liquidity: $${settings.minLiquidity ?? 5000}`,
         callback_data: 'sedit_minLiquidity' }],
      [{ text: '⬅️ Back', callback_data: 'menu_settings' }],
    ],
  }
}

// Format stored hours into a human-readable label
function fmtGemAge(h) {
  h = parseFloat(h)
  if (!isFinite(h) || h <= 0) return '?'
  if (h < 1)         return `${Math.round(h * 60)}m`
  if (h < 24)        return h % 1 === 0 ? `${h}h` : `${h}h`
  if (h % 168 === 0) return `${h / 168}w`
  if (h % 24  === 0) return `${h / 24}d`
  return `${h}h`
}

// Picker keyboard for gem max age
function gemMaxAgePickerKeyboard(currentHours) {
  const OPTS = [
    { label: '30 mins',  val: 0.5 },
    { label: '1 hour',   val: 1   },
    { label: '6 hours',  val: 6   },
    { label: '12 hours', val: 12  },
    { label: '1 day',    val: 24  },
    { label: '3 days',   val: 72  },
    { label: '1 week',   val: 168 },
    { label: '2 weeks',  val: 336 },
    { label: '1 month',  val: 720 },
  ]
  const rows = []
  const btns = OPTS.map(o => ({
    text:          parseFloat(currentHours) === o.val ? `✅ ${o.label}` : o.label,
    callback_data: `sedit_age_${o.val}`,
  }))
  for (let i = 0; i < btns.length; i += 3) rows.push(btns.slice(i, i + 3))
  rows.push([{ text: '⬅️ Back to Gem Config', callback_data: 'settings_gems' }])
  return { inline_keyboard: rows }
}

function gemSettingsKeyboard(settings) {
  return {
    inline_keyboard: [
      [{ text: `Min Liquidity: $${settings.gemMinLiquidity ?? 5000}`,
         callback_data: 'sedit_gemMinLiquidity' }],
      [{ text: `⏳ Max Age: ${fmtGemAge(settings.gemMaxAge ?? 24)}`,
         callback_data: 'sedit_gemMaxAge' }],
      [{ text: `Min Score: ${settings.gemMinScore ?? 40}/100`,
         callback_data: 'sedit_gemMinScore' }],
      [{ text: `BSC Buy: ${settings.gemBuyAmountBsc ?? 0.005} BNB`,
         callback_data: 'sedit_gemBuyAmountBsc' }],
      [{ text: `SOL Buy: ${settings.gemBuyAmountSol ?? 0.05} SOL`,
         callback_data: 'sedit_gemBuyAmountSol' }],
      [{ text: '⬅️ Back', callback_data: 'menu_settings' }],
    ],
  }
}

function agentSettingsKeyboard(agentSettings) {
  return {
    inline_keyboard: [
      [{ text: `Timeframe: ${agentSettings.timeframe ?? '4H'}`,
         callback_data: 'sedit_timeframe' }],
      [{ text: `Min Confidence: ${agentSettings.minConfidence ?? 70}%`,
         callback_data: 'sedit_minConfidence' }],
      [{ text: `Risk Per Trade: ${agentSettings.riskPercent ?? 2}%`,
         callback_data: 'sedit_riskPercent' }],
      [{ text: `Auto-Execute: ${agentSettings.autoExecute ? '✅ ON' : '❌ OFF'}`,
         callback_data: 'sedit_autoExecute' }],
      [{ text: '⬅️ Back', callback_data: 'menu_settings' }],
    ],
  }
}

function cexKeysMenuKeyboard(cexKeys) {
  const exchanges = ['binance', 'mexc', 'bybit', 'kucoin']
  const rows = exchanges.map(ex => {
    const hasKey = !!cexKeys?.[ex]?.encryptedApiKey
    const btns = [
      { text: hasKey
          ? `✅ ${ex.toUpperCase()} (${cexKeys[ex].maskedKey})`
          : `➕ Add ${ex.toUpperCase()}`,
        callback_data: `cex_add_${ex}` }
    ]
    if (hasKey) btns.push({ text: '🗑 Remove', callback_data: `cex_remove_${ex}` })
    return btns
  })
  rows.push([{ text: '⬅️ Back', callback_data: 'menu_settings' }])
  return { inline_keyboard: rows }
}

// ── UX helpers ────────────────────────────────────────────────────────────

/**
 * Animate-delete a message using progress-bar frames, then remove it.
 * Used when the user sends text input that the bot has just captured.
 */
async function animateDelete(bot, chatId, msgId) {
  if (!msgId) return
  const frames = ['▱▱▱▱▱', '▰▱▱▱▱', '▰▰▱▱▱', '▰▰▰▱▱', '▰▰▰▰▱', '▰▰▰▰▰']
  for (const frame of frames) {
    try {
      // Use raw editMessageText to animate in-place without deleting
      await bot.editMessageText(chatId, msgId, frame, { reply_markup: { inline_keyboard: [] } })
    } catch (_) { break }
    await new Promise(r => setTimeout(r, 120))
  }
  await bot.deleteMessage(chatId, msgId)
}

/**
 * Delete the previous message then send a fresh one.
 * Replaces editMessageText everywhere so each response lands as a new bubble.
 */
async function sendNew(bot, chatId, oldMsgId, text, opts = {}) {
  if (oldMsgId) await bot.deleteMessage(chatId, oldMsgId)
  const res = await bot.sendMessage(chatId, text, opts)
  return res
}

/**
 * Fetch all SPL / ERC-20 / Jetton token holdings for a given wallet.
 * Returns an array sorted by USD value descending.
 * Throws on unrecoverable errors (missing API key, network failure).
 */
async function fetchWalletTokens(chain, address, heliusKey, moralisKey) {
  // ── Solana — Helius DAS getAssetsByOwner ─────────────────────────────────
  if (chain === 'sol') {
    if (!heliusKey) throw new Error('Helius API key not configured on the server.')
    const { data } = await axios.post(
      `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
      { jsonrpc: '2.0', id: 1, method: 'getAssetsByOwner',
        params: { ownerAddress: address, page: 1, limit: 100,
          displayOptions: { showFungible: true, showNativeBalance: false } } },
      { timeout: 15000 }
    )
    if (data.error) throw new Error(data.error.message || 'Helius RPC error')
    const items = data.result?.items || []
    return items
      .filter(a => a.interface === 'FungibleToken' && (a.token_info?.balance || 0) > 0)
      .map(a => {
        const ti  = a.token_info || {}
        const bal = (ti.balance || 0) / Math.pow(10, ti.decimals || 0)
        const price = ti.price_info?.price_per_token ?? null
        return {
          symbol:    ti.symbol || a.content?.metadata?.symbol || a.id.slice(0, 8),
          name:      a.content?.metadata?.name || ti.symbol || a.id.slice(0, 8),
          address:   a.id,
          balance:   bal,
          priceUsd:  price,
          usdValue:  price != null ? bal * price : (ti.price_info?.total_price ?? null),
          change24h: null,
        }
      })
      .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
  }

  // ── TON — tonapi.io Jetton balances ──────────────────────────────────────
  if (chain === 'ton') {
    const { data } = await axios.get(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/jettons?currencies=usd`,
      { timeout: 12000 }
    )
    return (data?.balances || [])
      .map(b => {
        const bal = parseFloat(b.balance) / Math.pow(10, b.jetton?.decimals ?? 9)
        if (bal <= 0) return null
        const priceUsd  = b.price?.prices?.USD ?? null
        const changeStr = b.price?.diff_24h?.USD
        const change24h = changeStr ? parseFloat(changeStr) : null
        return {
          symbol:    b.jetton?.symbol || '?',
          name:      b.jetton?.name   || b.jetton?.symbol || '?',
          address:   b.jetton?.address || '',
          balance:   bal,
          priceUsd,
          usdValue:  priceUsd != null ? bal * priceUsd : null,
          change24h,
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
  }

  // ── EVM: BSC / ETH / BASE — Moralis + DexScreener enrichment ─────────────
  if (!moralisKey) throw new Error('Moralis API key not configured on the server.')
  const chainHex = chain === 'bsc' ? '0x38' : chain === 'base' ? '0x2105' : '0x1'
  const { data: moralisData } = await axios.get(
    `https://deep-index.moralis.io/api/v2.2/${address}/erc20?chain=${chainHex}`,
    { headers: { 'X-API-Key': moralisKey }, timeout: 15000 }
  )
  const raw = (moralisData || []).filter(t => parseFloat(t.balance) > 0)
  if (!raw.length) return []

  // Enrich with DexScreener prices in batches of 30
  const dsChain = chain === 'bsc' ? 'bsc' : chain === 'base' ? 'base' : 'ethereum'
  const pairMap = {}
  for (let i = 0; i < raw.length; i += 30) {
    const chunk = raw.slice(i, i + 30).map(t => t.token_address).join(',')
    try {
      const { data: pairs } = await axios.get(
        `https://api.dexscreener.com/tokens/v1/${dsChain}/${chunk}`,
        { timeout: 8000 }
      )
      if (Array.isArray(pairs)) {
        for (const p of pairs) {
          const a = p.baseToken?.address?.toLowerCase()
          if (a && (!pairMap[a] || (p.liquidity?.usd || 0) > (pairMap[a].liquidity?.usd || 0)))
            pairMap[a] = p
        }
      }
    } catch (_) {}
    if (i + 30 < raw.length) await new Promise(r => setTimeout(r, 200))
  }

  return raw
    .map(t => {
      const bal      = parseFloat(t.balance) / Math.pow(10, parseInt(t.decimals || 18))
      const pair     = pairMap[t.token_address.toLowerCase()]
      const priceUsd = t.usd_price != null ? t.usd_price
        : (pair?.priceUsd ? parseFloat(pair.priceUsd) : null)
      const change24h = t.usd_price_24hr_percent_change ?? (pair?.priceChange?.h24 ?? null)
      return {
        symbol:    t.symbol || pair?.baseToken?.symbol || '?',
        name:      t.name   || pair?.baseToken?.name   || '?',
        address:   t.token_address,
        balance:   bal,
        priceUsd,
        usdValue:  priceUsd != null ? bal * priceUsd : null,
        change24h,
      }
    })
    .sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
}

async function handleUpdate(bot, update, admin, db, trader, encryption, masterSecret, gemscanner, heliusKey, moralisKey) {
  if (!update.message && !update.callback_query) return

  // ── Handle callback queries from inline buttons (gem alerts) ───────────
  if (update.callback_query) {
    const cbq    = update.callback_query
    const chatId = cbq.message?.chat?.id
    const cbData = cbq.data || ''

    if (!chatId) return

    // Resolve user
    const cbSnap = await db.collection('users')
      .where('botSettings.telegramChatId', '==', String(chatId))
      .limit(1).get()

    if (cbSnap.empty) {
      await bot.answerCallbackQuery(cbq.id, 'Account not linked.')
      return
    }

    const cbUser     = cbSnap.docs[0]
    const cbUid      = cbUser.id
    const cbSettings = cbUser.data().botSettings || {}
    const cbWallets  = cbSettings.wallets || {}

    // gem_buy_<chain>_<tokenAddress>_<amount>
    if (cbData.startsWith('gem_buy_')) {
      const cbParts    = cbData.split('_')
      const cbChain    = cbParts[2]
      const cbToken    = cbParts[3]
      const cbAmount   = parseFloat(cbParts[4])

      if (!cbChain || !cbToken || !cbAmount) {
        await bot.answerCallbackQuery(cbq.id, 'Invalid buy data.')
        return
      }

      if (!cbWallets[cbChain]?.encryptedKey) {
        await bot.answerCallbackQuery(cbq.id, `No ${cbChain.toUpperCase()} wallet set.`)
        return
      }

      await bot.answerCallbackQuery(cbq.id, '⏳ Executing buy...')
      await bot.sendMessage(chatId, `⏳ Buying ${cbAmount} ${nativeTicker(cbChain)} worth...`, { parse_mode: 'Markdown' })

      try {
        const pk   = encryption.decrypt(cbWallets[cbChain].encryptedKey, cbUid, masterSecret)
        const slip = Math.min(cbSettings.defaultSlippage || 10, 50)
        const gasX = cbSettings.defaultGasMultiplier || 1.2

        let result
        if (cbChain === 'sol') {
          result = await trader.buyTokenSOL(pk, cbToken, cbAmount, slip, cbSettings.solRpc)
        } else {
          result = await trader.buyTokenEVM(cbChain, pk, cbToken, cbAmount, slip, cbSettings[cbChain + 'Rpc'], gasX)
        }

        await db.collection(`users/${cbUid}/trades`).add({
          chain: cbChain, tokenAddress: cbToken, type: 'buy',
          amountIn: String(cbAmount), txHash: result.txHash,
          status: result.status, source: 'telegram-gem',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        })

        await bot.sendMessage(chatId,
          `✅ *Gem Buy Executed!*\n\n` +
          `Chain: ${cbChain.toUpperCase()}\n` +
          `Amount: ${cbAmount} ${nativeTicker(cbChain)}\n` +
          `[View TX](${explorerUrl(cbChain, result.txHash)})`,
          { parse_mode: 'Markdown', disable_web_page_preview: true }
        )
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Buy failed: ${err.message}`)
      }
      return
    }

    // agent_approve_<signalId>  /  agent_skip_<signalId>
    if (cbData.startsWith('agent_approve_') || cbData.startsWith('agent_skip_')) {
      const isApprove = cbData.startsWith('agent_approve_')
      const signalId  = cbData.replace('agent_approve_', '').replace('agent_skip_', '')

      const signalRef  = db.doc(`users/${cbUid}/signals/${signalId}`)
      const signalSnap = await signalRef.get()

      if (!signalSnap.exists) { await bot.answerCallbackQuery(cbq.id, 'Signal not found.'); return }

      const signal = signalSnap.data()
      if (signal.status !== 'pending') { await bot.answerCallbackQuery(cbq.id, `Signal already ${signal.status}.`); return }
      if (signal.expiresAt < Date.now()) {
        await signalRef.update({ status: 'expired' })
        await bot.answerCallbackQuery(cbq.id, 'Signal has expired.')
        return
      }

      if (!isApprove) {
        await signalRef.update({ status: 'skipped' })
        await bot.answerCallbackQuery(cbq.id, 'Signal skipped.')
        await bot.sendMessage(chatId, `❌ Skipped signal: *${signal.symbol}* ${signal.bias?.toUpperCase()}`, { parse_mode: 'Markdown' }).catch(() => {})
        return
      }

      // Approve — check how many exchanges have keys to decide direct execute vs picker
      const agentSettings  = cbUser.data().agentSettings || {}
      const keys           = agentSettings.cexKeys || {}
      const configuredExes = Object.keys(keys).filter(k => keys[k]?.encryptedApiKey)

      if (!configuredExes.length) {
        await bot.answerCallbackQuery(cbq.id, 'No CEX keys set.')
        await bot.sendMessage(chatId, '❌ No CEX API keys configured. Add them in *Agent → CEX Setup* on the app.', { parse_mode: 'Markdown' })
        return
      }

      // If only one key is configured, execute directly without a picker
      if (configuredExes.length === 1) {
        await bot.answerCallbackQuery(cbq.id, '⏳ Placing order…')
        await executeTgTrade(bot, db, admin, encryption, masterSecret, cexTrader, signalGen, chatId, cbUid, signalId, signal, agentSettings, keys, configuredExes[0])
        return
      }

      // Multiple keys — send exchange picker buttons
      await bot.answerCallbackQuery(cbq.id, 'Choose exchange')
      const pickerButtons = configuredExes.map(ex => ({
        text: ex.toUpperCase(),
        callback_data: `agent_trade_${signalId}_${ex}`,
      }))
      await bot.sendMessage(chatId,
        `🔀 *Select exchange to trade ${signal.symbol}*\n_Signal from: ${signal.exchange?.toUpperCase()}_`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [pickerButtons] } }
      ).catch(() => {})
      return
    }


    // agent_trade_<signalId>_<exchange>  — execute on chosen exchange
    if (cbData.startsWith('agent_trade_')) {
      const parts    = cbData.split('_')
      // format: agent_trade_<signalId>_<exchange>
      // signalId may contain underscores from Firestore doc IDs — exchange is always the last segment
      const ex       = parts[parts.length - 1]
      const signalId = parts.slice(2, -1).join('_')

      const signalRef  = db.doc(`users/${cbUid}/signals/${signalId}`)
      const signalSnap = await signalRef.get()
      if (!signalSnap.exists) { await bot.answerCallbackQuery(cbq.id, 'Signal not found.'); return }

      const signal = signalSnap.data()
      if (signal.status !== 'pending') { await bot.answerCallbackQuery(cbq.id, `Signal already ${signal.status}.`); return }
      if (signal.expiresAt < Date.now()) {
        await signalRef.update({ status: 'expired' })
        await bot.answerCallbackQuery(cbq.id, 'Signal expired.')
        return
      }

      const agentSettings = cbUser.data().agentSettings || {}
      const keys          = agentSettings.cexKeys || {}

      if (!keys[ex]?.encryptedApiKey) {
        await bot.answerCallbackQuery(cbq.id, `No ${ex.toUpperCase()} key set.`)
        await bot.sendMessage(chatId, `❌ No *${ex.toUpperCase()}* API key configured.`, { parse_mode: 'Markdown' })
        return
      }

      await bot.answerCallbackQuery(cbq.id, `⏳ Trading on ${ex.toUpperCase()}…`)
      await executeTgTrade(bot, db, admin, encryption, masterSecret, cexTrader, signalGen, chatId, cbUid, signalId, signal, agentSettings, keys, ex)
      return
    }

    // gem_price_<chain>_<tokenAddress>
    if (cbData.startsWith('gem_price_')) {
      const cbParts = cbData.split('_')
      const cbChain = cbParts[2]
      const cbToken = cbParts[3]

      await bot.answerCallbackQuery(cbq.id, 'Fetching price...')
      try {
        const info = await trader.checkToken(cbToken, cbChain)
        if (!info.found) {
          await bot.sendMessage(chatId, `❌ Token not found.`)
        } else {
          await bot.sendMessage(chatId,
            `💰 *Token Info*\n\nName: \`${info.name}\` (${info.symbol})\n` +
            `Price: $${parseFloat(info.price).toFixed(8)}\n` +
            `Liquidity: $${(info.liquidity || 0).toLocaleString('en-US')}\n` +
            `Volume 24h: $${(info.volume24h || 0).toLocaleString('en-US')}`,
            { parse_mode: 'Markdown' }
          )
        }
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Price check failed: ${err.message}`)
      }
      return
    }

    // ── Menu navigation ──────────────────────────────────────────────────
    const msgId = cbq.message?.message_id

    if (cbData === 'menu_main') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        '🤖 *FXcrypt Bot*\n\nSelect an option:',
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
      )
      return
    }

    if (cbData === 'menu_wallets') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        '🔑 *Wallet Management*\n\nSelect a chain to manage that wallet, or use the ➕ buttons to create a new one.',
        { parse_mode: 'Markdown', reply_markup: walletMenuKeyboard(cbWallets) }
      )
      return
    }

    // ── Wallet: per-chain detail screen ──────────────────────────────────────
    if (cbData.startsWith('wallet_chain_')) {
      const chain  = cbData.replace('wallet_chain_', '')
      if (!VALID_CHAINS.has(chain)) { await bot.answerCallbackQuery(cbq.id, 'Invalid chain.'); return }
      await bot.answerCallbackQuery(cbq.id)
      const ICONS   = { bsc:'🟡', eth:'💠', sol:'🟣', base:'🔵', ton:'🔷' }
      const icon    = ICONS[chain] || '🔑'
      const wallet  = cbWallets[chain]
      const addrLine = wallet?.address
        ? `\nAddress:\n\`${wallet.address}\``
        : '\n_No wallet configured yet._'
      await sendNew(bot, chatId, msgId,
        `${icon} *${chain.toUpperCase()} Wallet*${addrLine}`,
        { parse_mode: 'Markdown', reply_markup: walletChainKeyboard(chain, wallet) }
      )
      return
    }

    // ── Wallet: view private key ──────────────────────────────────────────────
    if (cbData.startsWith('wallet_viewkey_')) {
      const chain  = cbData.replace('wallet_viewkey_', '')
      const wallet = cbWallets[chain]
      if (!wallet?.encryptedKey) { await bot.answerCallbackQuery(cbq.id, 'No key stored.'); return }
      await bot.answerCallbackQuery(cbq.id)
      try {
        const pk = encryption.decrypt(wallet.encryptedKey, cbUid, masterSecret)
        await bot.sendMessage(chatId,
          `🔑 *${chain.toUpperCase()} Private Key*\n\n\`${pk}\`\n\n` +
          `⚠️ *Delete this message immediately. Never share your key.*`,
          { parse_mode: 'Markdown' }
        )
      } catch (_) {
        await bot.sendMessage(chatId, '❌ Failed to decrypt key. Check your account setup.')
      }
      return
    }

    // ── Wallet: view seed phrase ──────────────────────────────────────────────
    if (cbData.startsWith('wallet_viewseed_')) {
      const chain  = cbData.replace('wallet_viewseed_', '')
      const wallet = cbWallets[chain]
      await bot.answerCallbackQuery(cbq.id)
      if (!wallet?.encryptedMnemonic) {
        await bot.sendMessage(chatId,
          `🌱 *${chain.toUpperCase()} Seed Phrase*\n\n` +
          `_Not available._\n\nSeed phrases are only stored when a wallet was created or imported using a 12/24-word phrase. ` +
          `If you imported via private key, no seed phrase is stored.`
          , { parse_mode: 'Markdown' }
        )
        return
      }
      try {
        const phrase = encryption.decrypt(wallet.encryptedMnemonic, cbUid, masterSecret)
        await bot.sendMessage(chatId,
          `🌱 *${chain.toUpperCase()} Seed Phrase*\n\n\`${phrase}\`\n\n` +
          `⚠️ *Delete this message immediately. Never share your seed phrase.*`,
          { parse_mode: 'Markdown' }
        )
      } catch (_) {
        await bot.sendMessage(chatId, '❌ Failed to decrypt seed phrase.')
      }
      return
    }

    // ── Wallet: token holdings list ──────────────────────────────────────────
    if (cbData.startsWith('wallet_tokens_')) {
      const chain  = cbData.replace('wallet_tokens_', '')
      if (!VALID_CHAINS.has(chain)) { await bot.answerCallbackQuery(cbq.id, 'Invalid chain.'); return }
      const wallet = cbWallets[chain]
      if (!wallet?.address) { await bot.answerCallbackQuery(cbq.id, 'No wallet configured for this chain.'); return }
      await bot.answerCallbackQuery(cbq.id, 'Loading holdings…')

      const CACHE_TTL = 5 * 60 * 1000
      const cache     = cbSettings.walletTokenCache?.[chain]
      const ICONS     = { bsc:'🟡', eth:'💠', sol:'🟣', base:'🔵', ton:'🔷' }
      const TICKERS   = { bsc:'BNB', eth:'ETH', sol:'SOL', base:'ETH', ton:'TON' }
      const icon      = ICONS[chain] || '💰'
      const ticker    = TICKERS[chain] || chain.toUpperCase()

      let tokens, nativeBalance, fetchedAt, blockedCount = 0, fromCache = false
      if (cache?.tokens && cache.fetchedAt && (Date.now() - cache.fetchedAt) < CACHE_TTL) {
        // Serve from cache — safety was already applied when the cache was built
        tokens = cache.tokens; nativeBalance = cache.nativeBalance
        fetchedAt = cache.fetchedAt; blockedCount = cache.blockedCount || 0; fromCache = true
      } else {
        // Live fetch + safety scan — show loading bubble while working
        const loadMsg = await bot.sendMessage(chatId,
          `⏳ *Loading ${chain.toUpperCase()} holdings…*\n_Fetching balances and scanning contracts for safety._`,
          { parse_mode: 'Markdown' }
        )
        try {
          // ── Step 1: fetch tokens + native balance in parallel ──────────────
          const nativeFetch = chain === 'sol'
            ? trader.getSOLBalance(wallet.address, cbSettings.solRpc)
            : chain === 'ton'
            ? trader.getTONBalance(wallet.address)
            : trader.getEVMBalance(wallet.address, chain, cbSettings[chain + 'Rpc'])
          const [tokRes, natRes] = await Promise.allSettled([
            fetchWalletTokens(chain, wallet.address, heliusKey, moralisKey),
            nativeFetch,
          ])
          if (tokRes.status === 'rejected') throw new Error(tokRes.reason?.message || 'Failed to fetch token list')
          const rawTokens  = tokRes.value
          nativeBalance    = natRes.status === 'fulfilled' ? natRes.value.native : null

          // ── Step 2: build trusted-address set from bot trade history ───────
          // Tokens the user bought through this bot are already vetted; skip re-check.
          let trustedAddrs = new Set()
          try {
            const tradesSnap = await db.collection(`users/${cbUid}/trades`)
              .where('chain', '==', chain).where('type', '==', 'buy').get()
            tradesSnap.forEach(d => {
              const a = (d.data().tokenAddress || '').toLowerCase()
              if (a) trustedAddrs.add(a)
            })
          } catch (_) { /* non-fatal — treat all tokens as untrusted */ }

          // ── Step 3: safety-filter tokens not known to the bot ─────────────
          if (chain === 'ton' || !rawTokens.length) {
            // TON Jettons: no on-chain safety API available — show as-is
            tokens = rawTokens; blockedCount = 0
          } else {
            const trusted   = rawTokens.filter(t => trustedAddrs.has((t.address || '').toLowerCase()))
            const untrusted = rawTokens.filter(t => !trustedAddrs.has((t.address || '').toLowerCase()))

            let safePassed = untrusted
            if (untrusted.length) {
              // Wrap into the shape filterSafeTokens expects
              const candidates = untrusted.map(t => ({ address: t.address, _tok: t }))
              const passed     = await safety.filterSafeTokens(candidates, chain)
              const passedSet  = new Set(passed.map(c => c.address.toLowerCase()))
              safePassed   = untrusted.filter(t => passedSet.has(t.address.toLowerCase()))
              blockedCount = untrusted.length - safePassed.length
            }
            // Re-sort: trusted first (they have known provenance), then safe unknown tokens
            tokens = [...trusted, ...safePassed].sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0))
          }

          fetchedAt = Date.now()
          await cbUser.ref.set(
            { botSettings: { walletTokenCache: { [chain]: { tokens, nativeBalance, fetchedAt, blockedCount, safetyScanned: true } } } },
            { merge: true }
          )
        } catch (err) {
          await bot.deleteMessage(chatId, loadMsg?.result?.message_id).catch(() => {})
          await sendNew(bot, chatId, msgId,
            `❌ *Could not load ${chain.toUpperCase()} holdings*\n\n${err.message}`,
            { parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[
                { text: '🔄 Retry', callback_data: `wallet_tokens_${chain}` },
                { text: '⬅️ Back', callback_data: `wallet_chain_${chain}` },
              ]] } }
          )
          return
        }
        await bot.deleteMessage(chatId, loadMsg?.result?.message_id).catch(() => {})
      }

      // Build display message
      const displayTokens = tokens.slice(0, 10)
      const nativeLine = nativeBalance != null
        ? `🪙 *Native:* ${nativeBalance} ${ticker}\n\n`
        : ''
      const canTrade = chain !== 'ton'

      let tokenBody = '', totalUsd = 0
      if (displayTokens.length) {
        displayTokens.forEach((t, i) => {
          const balFmt = t.balance >= 1e6 ? `${(t.balance / 1e6).toFixed(2)}M`
            : t.balance >= 1e3            ? `${(t.balance / 1e3).toFixed(2)}K`
            : t.balance.toLocaleString('en-US', { maximumFractionDigits: 6 })
          const usdFmt   = t.usdValue != null ? `~$${t.usdValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : 'N/A'
          const chFmt    = t.change24h != null ? ` | ${t.change24h >= 0 ? '📈' : '📉'} ${t.change24h.toFixed(1)}%` : ''
          if (t.usdValue) totalUsd += t.usdValue
          tokenBody += `*${i + 1}.* ${t.name} (\`${t.symbol}\`)\n   ${balFmt} · ${usdFmt}${chFmt}\n`
        })
      } else {
        tokenBody = '_No tokens found in this wallet._\n'
      }

      const totalLine   = totalUsd > 0 ? `\n💰 *Token Total:* ~$${totalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : ''
      const moreNote    = tokens.length > 10 ? `\n_Showing top 10 of ${tokens.length} by value_` : ''
      const ageMin      = fromCache ? Math.round((Date.now() - fetchedAt) / 60000) : 0
      const cacheNote   = fromCache && ageMin > 0 ? `\n_Updated ${ageMin}m ago_` : '\n_Just updated_'
      const tonNote     = chain === 'ton' ? '\n_ℹ️ Jetton trading not yet supported from bot._' : ''
      const blockedNote = blockedCount > 0
        ? `\n🛡 _${blockedCount} token${blockedCount > 1 ? 's' : ''} hidden — malicious contracts detected._`
        : (cache?.safetyScanned || !fromCache) && chain !== 'ton' ? '\n🛡 _All visible tokens passed safety checks._' : ''

      const msgText =
        `${icon} *${chain.toUpperCase()} Holdings*\n` +
        `──────────────────────\n\n` +
        nativeLine + tokenBody + totalLine + moreNote + cacheNote + blockedNote + tonNote

      await sendNew(bot, chatId, msgId, msgText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: walletTokenListKeyboard(chain, displayTokens),
      })
      return
    }

    // ── Wallet: buy a specific held token ────────────────────────────────────
    if (cbData.startsWith('wtbuy_')) {
      const parts = cbData.split('_')  // ['wtbuy','bsc','0']
      const chain = parts[1], idx = parseInt(parts[2], 10)
      const cache = cbSettings.walletTokenCache?.[chain]
      if (!cache?.tokens || isNaN(idx) || !cache.tokens[idx]) {
        await bot.answerCallbackQuery(cbq.id, '⏰ Holdings expired. Tap 🔄 Refresh first.'); return
      }
      if (chain === 'ton') { await bot.answerCallbackQuery(cbq.id, 'TON Jetton trading not supported yet.'); return }
      const token       = cache.tokens[idx]
      const chainTicker = { bsc:'BNB', eth:'ETH', sol:'SOL', base:'ETH' }[chain] || chain.toUpperCase()
      await bot.answerCallbackQuery(cbq.id)
      const promptRes = await bot.sendMessage(chatId,
        `🟢 *Buy ${token.name} (${token.symbol})*\n\n` +
        `Enter amount in *${chainTicker}* (e.g. \`0.05\`)\nor in USD (e.g. \`10 USD\`):`,
        { parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `wallet_tokens_${chain}` }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingWalletBuy: { chain, tokenIdx: idx,
            promptMsgId: promptRes?.result?.message_id ?? null, expiresAt: Date.now() + 5 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Wallet: sell picker — show quick % keyboard ───────────────────────────
    if (cbData.startsWith('wtsell_')) {
      const parts = cbData.split('_')  // ['wtsell','bsc','0']
      const chain = parts[1], idx = parseInt(parts[2], 10)
      const cache = cbSettings.walletTokenCache?.[chain]
      if (!cache?.tokens || isNaN(idx) || !cache.tokens[idx]) {
        await bot.answerCallbackQuery(cbq.id, '⏰ Holdings expired. Tap 🔄 Refresh first.'); return
      }
      const token  = cache.tokens[idx]
      const balFmt = token.balance >= 1e3
        ? `${(token.balance / 1e3).toFixed(2)}K`
        : token.balance.toLocaleString('en-US', { maximumFractionDigits: 6 })
      const usdFmt = token.usdValue != null ? ` (~$${token.usdValue.toFixed(2)})` : ''
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        `🔴 *Sell ${token.name} (${token.symbol})*\n\n` +
        `Holdings: *${balFmt}*${usdFmt}\n\nSelect % to sell:`,
        { parse_mode: 'Markdown', reply_markup: walletSellPickerKeyboard(chain, idx, token.symbol) }
      )
      return
    }

    // ── Wallet: sell at preset % ──────────────────────────────────────────────
    if (cbData.startsWith('wsp_')) {
      const parts = cbData.split('_')  // ['wsp','bsc','0','25']
      const chain = parts[1], idx = parseInt(parts[2], 10), pct = parseInt(parts[3], 10)
      if (!VALID_CHAINS.has(chain) || isNaN(idx) || isNaN(pct) || pct < 1 || pct > 100) {
        await bot.answerCallbackQuery(cbq.id, 'Invalid request.'); return
      }
      const cache = cbSettings.walletTokenCache?.[chain]
      if (!cache?.tokens?.[idx]) { await bot.answerCallbackQuery(cbq.id, '⏰ Holdings expired. Refresh first.'); return }
      const token = cache.tokens[idx]
      if (!cbWallets[chain]?.encryptedKey) { await bot.answerCallbackQuery(cbq.id, `No ${chain.toUpperCase()} wallet key found.`); return }

      const chainTicker = { bsc:'BNB', eth:'ETH', sol:'SOL', base:'ETH' }[chain] || chain.toUpperCase()
      await bot.answerCallbackQuery(cbq.id, `⏳ Selling ${pct}%…`)
      await sendNew(bot, chatId, msgId,
        `⏳ Selling *${pct}%* of *${token.symbol}* on ${chain.toUpperCase()}…`,
        { parse_mode: 'Markdown' }
      )
      try {
        const pk     = encryption.decrypt(cbWallets[chain].encryptedKey, cbUid, masterSecret)
        const slip   = Math.min(cbSettings.defaultSlippage || 5, 50)
        const gasX   = cbSettings.defaultGasMultiplier || 1.2
        const result = chain === 'sol'
          ? await trader.sellTokenSOL(pk, token.address, pct, slip, cbSettings.solRpc, heliusKey)
          : await trader.sellTokenEVM(chain, pk, token.address, pct, slip, cbSettings[chain + 'Rpc'], gasX)
        await db.collection(`users/${cbUid}/trades`).add({
          chain, tokenAddress: token.address, type: 'sell', source: 'wallet-holdings',
          tokenName: token.name, tokenSymbol: token.symbol,
          percentSold: pct, txHash: result.txHash, status: result.status,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        })
        // Invalidate cache so next refresh shows updated balances
        await cbUser.ref.set(
          { botSettings: { walletTokenCache: { [chain]: admin.firestore.FieldValue.delete() } } },
          { merge: true }
        )
        await bot.sendMessage(chatId,
          `✅ *Sell Executed!*\n\n` +
          `Token: *${token.name} (${token.symbol})*\n` +
          `Chain: ${chain.toUpperCase()} | Sold: ${pct}%\n` +
          `Status: \`${result.status}\`\n` +
          `[View TX](${explorerUrl(chain, result.txHash)})`,
          { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: mainMenuKeyboard() }
        )
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Sell failed: ${err.message}`, { reply_markup: mainMenuKeyboard() })
      }
      return
    }

    // ── Wallet: custom sell % — prompt ────────────────────────────────────────
    if (cbData.startsWith('wsc_')) {
      const parts = cbData.split('_')  // ['wsc','bsc','0']
      const chain = parts[1], idx = parseInt(parts[2], 10)
      const cache = cbSettings.walletTokenCache?.[chain]
      if (!cache?.tokens?.[idx]) { await bot.answerCallbackQuery(cbq.id, '⏰ Holdings expired. Refresh first.'); return }
      const token = cache.tokens[idx]
      await bot.answerCallbackQuery(cbq.id)
      const promptRes = await bot.sendMessage(chatId,
        `✏️ *Custom Sell % — ${token.symbol}*\n\nEnter a percentage (1–100):`,
        { parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `wallet_tokens_${chain}` }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingWalletSell: { chain, tokenIdx: idx,
            promptMsgId: promptRes?.result?.message_id ?? null, expiresAt: Date.now() + 5 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    if (cbData === 'menu_gems') {
      await bot.answerCallbackQuery(cbq.id)
      const alertsOn  = cbSettings.gemAutoEnabled ? '🟢 ON' : '🔴 OFF'
      const autoBuyOn = cbSettings.gemAutoBuy     ? '🟢 ON' : '🔴 OFF'
      await sendNew(bot, chatId, msgId,
        `💎 *Gem Scanner*\n\nAuto-alerts: ${alertsOn}\nAuto-buy: ${autoBuyOn}`,
        { parse_mode: 'Markdown', reply_markup: gemMenuKeyboard(cbSettings) }
      )
      return
    }

    if (cbData === 'menu_agent') {
      await bot.answerCallbackQuery(cbq.id)
      const agData = cbUser.data().agentSettings || {}
      const agOn   = agData.enabled ? '🟢 Running' : '🔴 Stopped'
      const lastScan = agData.lastScanAt ? new Date(agData.lastScanAt).toLocaleString() : 'Never'
      await sendNew(bot, chatId, msgId,
        `🤖 *Trading Agent*\n\nStatus: ${agOn}\nLast scan: ${lastScan}`,
        { parse_mode: 'Markdown', reply_markup: agentMenuKeyboard(agData) }
      )
      return
    }


    // ── Action: Status ────────────────────────────────────────────────────
    if (cbData === 'action_status') {
      await bot.answerCallbackQuery(cbq.id, 'Fetching status…')
      const snipSnap = await db.collection(`users/${cbUid}/snipeTargets`)
        .where('status', '==', 'pending').get()
      const on = cbSettings.botEnabled ? '🟢 Running' : '🔴 Stopped'
      const walletLine = chain => {
        const w = cbWallets[chain]
        return w?.address ? `✅ \`${w.address.slice(0, 8)}...\`` : '❌ Not set'
      }
      const toggleBtn = cbSettings.botEnabled
        ? { text: '🔴 Disable Bot', callback_data: 'action_botoff' }
        : { text: '🟢 Enable Bot',  callback_data: 'action_boton'  }
      await sendNew(bot, chatId, msgId,
        `📊 *Bot Status*\n\n` +
        `Status: ${on}\nActive Snipes: ${snipSnap.size}\n\n` +
        `BSC: ${walletLine('bsc')}\nETH: ${walletLine('eth')}\nSOL: ${walletLine('sol')}\n` +
        `BASE: ${walletLine('base')}\nTON: ${walletLine('ton')}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[toggleBtn], [BACK_BTN]] } }
      )
      return
    }

    // ── Action: Balances ─────────────────────────────────────────────────
    if (cbData === 'action_balance') {
      await bot.answerCallbackQuery(cbq.id, 'Fetching balances…')
      const allChains = [
        { key: 'bsc',  ticker: 'BNB', fetch: cbWallets.bsc?.address  ? () => trader.getEVMBalance(cbWallets.bsc.address,  'bsc',  cbSettings.bscRpc)  : null },
        { key: 'eth',  ticker: 'ETH', fetch: cbWallets.eth?.address  ? () => trader.getEVMBalance(cbWallets.eth.address,  'eth',  cbSettings.ethRpc)  : null },
        { key: 'sol',  ticker: 'SOL', fetch: cbWallets.sol?.address  ? () => trader.getSOLBalance(cbWallets.sol.address,  cbSettings.solRpc)           : null },
        { key: 'base', ticker: 'ETH', fetch: cbWallets.base?.address ? () => trader.getEVMBalance(cbWallets.base.address, 'base', cbSettings.baseRpc) : null },
        { key: 'ton',  ticker: 'TON', fetch: cbWallets.ton?.address  ? () => trader.getTONBalance(cbWallets.ton.address)                              : null },
      ]
      const configured = allChains.filter(c => c.fetch)
      let out = '💰 *Wallet Balances*\n\n'
      if (!configured.length) {
        out += '_No wallets configured. Go to Wallets to create one._'
      } else {
        const results = await Promise.allSettled(configured.map(c => c.fetch()))
        configured.forEach((c, i) => {
          const r = results[i]
          out += r.status === 'fulfilled'
            ? `*${c.key.toUpperCase()}:* ${r.value.native} ${c.ticker}\n`
            : `*${c.key.toUpperCase()}:* ⚠️ unavailable\n`
        })
      }
      await sendNew(bot, chatId, msgId, out,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'action_balance' }, BACK_BTN]] } }
      )
      return
    }

    // ── Action: Snipe queue ───────────────────────────────────────────────
    if (cbData === 'action_snipes') {
      await bot.answerCallbackQuery(cbq.id)
      const snaps = await db.collection(`users/${cbUid}/snipeTargets`)
        .where('status', '==', 'pending')
        .orderBy('addedAt', 'desc').limit(10).get()
      let out = '🎯 *Active Snipe Queue*\n\n'
      if (snaps.empty) {
        out += '_No active snipe targets._\n\nUse `/snipe <chain> <address> <amount>` to add one.'
      } else {
        snaps.docs.forEach((d, i) => {
          const s = d.data()
          out += `${i + 1}. \`${d.id.slice(0, 8)}\` | ${s.chain.toUpperCase()} | ${s.buyAmount}\n`
          out += `   \`${s.tokenAddress.slice(0, 14)}...\`\n`
        })
      }
      await sendNew(bot, chatId, msgId, out,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'action_snipes' }, BACK_BTN]] } }
      )
      return
    }

    // ── Action: History ───────────────────────────────────────────────────
    if (cbData === 'action_history') {
      await bot.answerCallbackQuery(cbq.id)
      const trades = await db.collection(`users/${cbUid}/trades`)
        .orderBy('timestamp', 'desc').limit(5).get()
      let out = '📜 *Recent Trades*\n\n'
      if (trades.empty) {
        out += '_No trades yet._'
      } else {
        trades.docs.forEach(d => {
          const t    = d.data()
          const icon = t.type === 'buy' ? '🟢' : '🔴'
          const date = t.timestamp?.toDate?.()?.toLocaleDateString('en-GB') || 'N/A'
          out += `${icon} ${t.type.toUpperCase()} | ${t.chain.toUpperCase()} | ${date}\n`
          if (t.txHash) out += `\`${t.txHash.slice(0, 14)}...\`\n`
          out += '\n'
        })
      }
      await sendNew(bot, chatId, msgId, out,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[BACK_BTN]] } }
      )
      return
    }

    // ── Action: Bot enable / disable ──────────────────────────────────────
    if (cbData === 'action_boton' || cbData === 'action_botoff') {
      const enable = cbData === 'action_boton'
      await cbUser.ref.set({ botSettings: { botEnabled: enable } }, { merge: true })
      await bot.answerCallbackQuery(cbq.id, enable ? '🟢 Bot enabled' : '🔴 Bot disabled')
      const snipSnap = await db.collection(`users/${cbUid}/snipeTargets`).where('status', '==', 'pending').get()
      const walletLine = chain => {
        const w = cbWallets[chain]
        return w?.address ? `✅ \`${w.address.slice(0, 8)}...\`` : '❌ Not set'
      }
      const toggleBtn = enable
        ? { text: '🔴 Disable Bot', callback_data: 'action_botoff' }
        : { text: '🟢 Enable Bot',  callback_data: 'action_boton'  }
      await sendNew(bot, chatId, msgId,
        `📊 *Bot Status*\n\n` +
        `Status: ${enable ? '🟢 Running' : '🔴 Stopped'}\nActive Snipes: ${snipSnap.size}\n\n` +
        `BSC: ${walletLine('bsc')}\nETH: ${walletLine('eth')}\nSOL: ${walletLine('sol')}\n` +
        `BASE: ${walletLine('base')}\nTON: ${walletLine('ton')}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[toggleBtn], [BACK_BTN]] } }
      )
      return
    }

    // ── Action: Agent enable / disable ────────────────────────────────────
    if (cbData === 'action_agenton' || cbData === 'action_agentoff') {
      const enable = cbData === 'action_agenton'
      await cbUser.ref.set({ agentSettings: { enabled: enable } }, { merge: true })
      await bot.answerCallbackQuery(cbq.id, enable ? '🤖 Agent enabled' : '🤖 Agent disabled')
      const agData = { ...(cbUser.data().agentSettings || {}), enabled: enable }
      const agOn   = enable ? '🟢 Running' : '🔴 Stopped'
      await sendNew(bot, chatId, msgId,
        `🤖 *Trading Agent*\n\nStatus: ${agOn}`,
        { parse_mode: 'Markdown', reply_markup: agentMenuKeyboard(agData) }
      )
      return
    }


    // ── Action: Gem alerts on / off ───────────────────────────────────────
    if (cbData === 'action_gemon' || cbData === 'action_gemoff') {
      const enable = cbData === 'action_gemon'
      await cbUser.ref.set({ botSettings: { gemAutoEnabled: enable } }, { merge: true })
      await bot.answerCallbackQuery(cbq.id, enable ? '🔔 Gem alerts ON' : '🔕 Gem alerts OFF')
      const updated = { ...cbSettings, gemAutoEnabled: enable }
      await sendNew(bot, chatId, msgId,
        `💎 *Gem Scanner*\n\nAuto-alerts: ${enable ? '🟢 ON' : '🔴 OFF'}\nAuto-buy: ${cbSettings.gemAutoBuy ? '🟢 ON' : '🔴 OFF'}`,
        { parse_mode: 'Markdown', reply_markup: gemMenuKeyboard(updated) }
      )
      return
    }

    // ── Action: Gem auto-buy on / off ─────────────────────────────────────
    if (cbData === 'action_gemautobuy_on' || cbData === 'action_gemautobuy_off') {
      const enable = cbData === 'action_gemautobuy_on'
      await cbUser.ref.set({ botSettings: { gemAutoBuy: enable } }, { merge: true })
      await bot.answerCallbackQuery(cbq.id, enable ? '🤖 Auto-buy ON' : '🤖 Auto-buy OFF')
      const updated = { ...cbSettings, gemAutoBuy: enable }
      await sendNew(bot, chatId, msgId,
        `💎 *Gem Scanner*\n\nAuto-alerts: ${cbSettings.gemAutoEnabled ? '🟢 ON' : '🔴 OFF'}\nAuto-buy: ${enable ? '🟢 ON' : '🔴 OFF'}`,
        { parse_mode: 'Markdown', reply_markup: gemMenuKeyboard(updated) }
      )
      return
    }

    // ── Action: Gem scan ──────────────────────────────────────────────────
    if (cbData === 'action_gemscan') {
      await bot.answerCallbackQuery(cbq.id, '💎 Scanning…')
      const gcChains   = (cbSettings.gemChains || ['bsc', 'sol']).filter(c => ['bsc', 'sol', 'base', 'eth'].includes(c))
      const scanChains = gcChains.length ? gcChains : ['bsc', 'sol']
      const chainLabel = scanChains.map(c => c.toUpperCase()).join(', ')
      await sendNew(bot, chatId, msgId,
        `💎 Scanning for gems on *${chainLabel}*…\n\nThis may take a moment.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
      )
      try {
        const gems = await gemscanner.discoverGems(scanChains, {
          minLiquidity: cbSettings.gemMinLiquidity || 5000,
          maxAgeHours:  cbSettings.gemMaxAge       || 24,
          minScore:     cbSettings.gemMinScore     || 40,
        })
        if (!gems.length) {
          await bot.sendMessage(chatId,
            '📭 *No gems found right now.*\n\nTry adjusting your gem settings or scanning again later.',
            { parse_mode: 'Markdown', reply_markup: gemMenuKeyboard(cbSettings) }
          )
          return
        }

        // Group gems by chain and cache in Firestore for chain filter callbacks
        const byChain = {}
        gems.forEach((g, i) => {
          const c = g.chain || 'bsc'
          if (!byChain[c]) byChain[c] = []
          byChain[c].push(i)
        })
        await cbUser.ref.set(
          { botSettings: { lastGemScan: { gems, byChain, scannedAt: Date.now() } } },
          { merge: true }
        )

        // Build summary message
        const ICONS = { bsc:'🟡', sol:'🟣', base:'🔵', eth:'💠', ton:'🔷' }
        const chainLines = Object.entries(byChain)
          .map(([c, idxs]) => `  ${ICONS[c] || '🔗'} *${c.toUpperCase()}:* ${idxs.length} gem${idxs.length > 1 ? 's' : ''}`)
          .join('\n')

        await bot.sendMessage(chatId,
          `💎 *Gem Scan Results*\n\n` +
          `Found *${gems.length} gem${gems.length > 1 ? 's' : ''}* across ${Object.keys(byChain).length} chain${Object.keys(byChain).length > 1 ? 's' : ''}:\n\n` +
          chainLines +
          `\n\nTap a chain to view signals 👇`,
          { parse_mode: 'Markdown', reply_markup: gemScanSummaryKeyboard(byChain, cbSettings) }
        )
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Scan failed: ${err.message}`)
      }
      return
    }

    // ── Action: Gem chain filter — show gems for a specific chain ─────────
    if (cbData.startsWith('gems_chain_')) {
      const chain  = cbData.replace('gems_chain_', '')
      await bot.answerCallbackQuery(cbq.id, `Loading ${chain.toUpperCase()} gems…`)
      const scan = cbSettings.lastGemScan
      if (!scan?.gems?.length || (Date.now() - scan.scannedAt) > 30 * 60 * 1000) {
        await sendNew(bot, chatId, msgId,
          '⏰ *Scan expired.* Tap 🔍 Scan Gems Now to run a fresh scan.',
          { parse_mode: 'Markdown', reply_markup: gemMenuKeyboard(cbSettings) }
        )
        return
      }
      const chainIdxs = (scan.byChain?.[chain] || []).slice(0, 6)
      if (!chainIdxs.length) {
        await sendNew(bot, chatId, msgId,
          `📭 No ${chain.toUpperCase()} gems in this scan.`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Results', callback_data: 'action_gemscan' }]] } }
        )
        return
      }

      // Send individual gem cards with full rich detail
      for (const idx of chainIdxs) {
        const g = scan.gems[idx]
        const { text: cardText, chainTicker, buyAmount } = gemscanner.formatGemCard(g, cbSettings)
        await bot.sendMessage(chatId, cardText, {
          parse_mode:              'Markdown',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[
              { text: `🟢 Buy ${buyAmount} ${chainTicker}`, callback_data: `gem_buy_${idx}` },
              { text: '✏️ Customize Amount',                callback_data: `gem_custom_${idx}` },
            ]],
          },
        })
        await new Promise(r => setTimeout(r, 400))
      }

      // Footer with navigation
      await bot.sendMessage(chatId,
        `_Showing ${chainIdxs.length} of ${scan.byChain?.[chain]?.length || 0} ${chain.toUpperCase()} gems._`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '⬅️ Back to Results', callback_data: 'action_gemscan' }, BACK_BTN],
            ],
          },
        }
      )
      return
    }

    // ── Action: Gem customize — prompt for a per-gem buy amount ───────────
    if (cbData.startsWith('gem_custom_')) {
      const idx  = parseInt(cbData.replace('gem_custom_', ''), 10)
      const scan = cbSettings.lastGemScan
      if (!scan?.gems || isNaN(idx) || !scan.gems[idx]) {
        await bot.answerCallbackQuery(cbq.id, '⏰ Scan expired. Re-scan first.')
        return
      }
      const g           = scan.gems[idx]
      const chainTicker = g.chain === 'sol' ? 'SOL' : (g.chain === 'eth' || g.chain === 'base') ? 'ETH' : 'BNB'
      await bot.answerCallbackQuery(cbq.id)
      const customPromptRes = await bot.sendMessage(chatId,
        `✏️ *Custom Buy — ${g.tokenName || g.tokenSymbol}*\n\n` +
        `Enter amount in ${chainTicker} (e.g. \`0.1\`) or in USD (e.g. \`5 USD\`):`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_gems' }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingGemBuy: {
          gemIdx:    idx,
          promptMsgId: customPromptRes?.result?.message_id ?? null,
          expiresAt: Date.now() + 5 * 60 * 1000,
        } } },
        { merge: true }
      )
      return
    }

    // ── Action: Gem buy — execute buy for a cached gem ────────────────────
    if (cbData.startsWith('gem_buy_')) {
      const idx  = parseInt(cbData.replace('gem_buy_', ''), 10)
      const scan = cbSettings.lastGemScan
      if (!scan?.gems || isNaN(idx) || !scan.gems[idx]) {
        await bot.answerCallbackQuery(cbq.id, '⏰ Scan expired. Re-scan to buy.')
        return
      }
      const g     = scan.gems[idx]
      const chain = g.chain || 'bsc'
      const addr  = g.tokenAddress || ''
      if (!addr) { await bot.answerCallbackQuery(cbq.id, 'Token address missing.'); return }
      if (!cbWallets[chain]?.encryptedKey) {
        await bot.answerCallbackQuery(cbq.id, `No ${chain.toUpperCase()} wallet configured.`)
        return
      }
      const amount      = chain === 'sol'
        ? (cbSettings.gemBuyAmountSol ?? 0.05)
        : (cbSettings.gemBuyAmountBsc ?? 0.005)
      const chainTicker = chain === 'sol' ? 'SOL' : (chain === 'eth' || chain === 'base') ? 'ETH' : 'BNB'
      const tokenLabel  = g.tokenName || g.tokenSymbol || addr.slice(0, 10)
      await bot.answerCallbackQuery(cbq.id, `⏳ Buying ${g.tokenSymbol || 'token'}…`)
      await bot.sendMessage(chatId,
        `⏳ Buying *${tokenLabel}* on ${chain.toUpperCase()}…\n` +
        `Amount: ${amount} ${chainTicker}`,
        { parse_mode: 'Markdown' }
      )
      try {
        const pk     = encryption.decrypt(cbWallets[chain].encryptedKey, cbUid, masterSecret)
        const slip   = Math.min(cbSettings.defaultSlippage || 5, 50)
        const gasX   = cbSettings.defaultGasMultiplier || 1.2
        const result = chain === 'sol'
          ? await trader.buyTokenSOL(pk, addr, amount, slip, cbSettings.solRpc)
          : await trader.buyTokenEVM(chain, pk, addr, amount, slip, cbSettings[chain + 'Rpc'], gasX)
        await db.collection(`users/${cbUid}/trades`).add({
          chain, tokenAddress: addr, type: 'buy', source: 'gem-scan',
          tokenName: g.tokenName, tokenSymbol: g.tokenSymbol,
          amountIn: String(amount), txHash: result.txHash, status: result.status,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        })
        await bot.sendMessage(chatId,
          `✅ *Gem Buy Executed!*\n\n` +
          `Token: *${tokenLabel}*\n` +
          `Chain: ${chain.toUpperCase()} | Amount: ${amount} ${chainTicker}\n` +
          `Status: \`${result.status}\`\n` +
          `[View TX](${explorerUrl(chain, result.txHash)})`,
          { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: mainMenuKeyboard() }
        )
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Buy failed: ${err.message}`, { reply_markup: mainMenuKeyboard() })
      }
      return
    }

    // ── Action: Agent scan ────────────────────────────────────────────────
    if (cbData === 'action_agentscan') {
      await bot.answerCallbackQuery(cbq.id, '🔍 Scanning…')
      await bot.sendMessage(chatId, '🔍 Running market scan…')
      try {
        const agentSet    = cbUser.data().agentSettings || {}
        const exchanges   = agentSet.exchanges   || ['binance', 'mexc', 'bybit', 'kucoin']
        const timeframe   = agentSet.timeframe   || '4H'
        const minConf     = agentSet.minConfidence || 70
        const marketTypes = agentSet.marketTypes || ['spot']

        const allAnalyses = []
        if (marketTypes.includes('spot')) {
          for (const ex of exchanges.slice(0, 2)) {
            try { allAnalyses.push(...await marketAnalyzer.scanExchange(ex, timeframe, 20, minConf)) } catch (_) {}
          }
        }
        if (marketTypes.includes('futures')) {
          for (const ex of ['binance', 'bybit', 'mexc'].filter(e => exchanges.includes(e)).slice(0, 2)) {
            try { allAnalyses.push(...await marketAnalyzer.scanFuturesExchange(ex, timeframe, 15, Math.max(65, minConf - 5))) } catch (_) {}
          }
        }

        const symbolMap = {}
        for (const a of allAnalyses) {
          const key = `${a.symbol}_${a.bias}_${a.marketType || 'spot'}`
          if (!symbolMap[key] || a.score > symbolMap[key].score) symbolMap[key] = a
        }
        const newSignals = []
        for (const analysis of Object.values(symbolMap).slice(0, 5)) {
          const signal = signalGen.generateSignal(analysis, exchanges)
          if (!signal) continue
          const ref = await db.collection(`users/${cbUid}/signals`).add(signal)
          newSignals.push({ id: ref.id, ...signal })
        }
        if (!newSignals.length) {
          await bot.sendMessage(chatId, '📭 No high-confidence signals found right now.')
        } else {
          for (const sig of newSignals.slice(0, 3)) {
            const { text, keyboard } = signalGen.formatTelegramSignalWithButtons(sig, sig.id)
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {})
            await new Promise(r => setTimeout(r, 500))
          }
        }
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Scan failed: ${err.message}`)
      }
      return
    }


    // ── Action: Wallet list ───────────────────────────────────────────────
    if (cbData === 'action_wallet_list') {
      await bot.answerCallbackQuery(cbq.id)
      const lines = ['bsc', 'eth', 'sol', 'base', 'ton'].map(chain => {
        const w = cbWallets[chain]
        return w?.address
          ? `*${chain.toUpperCase()}:* ✅ \`${w.address}\``
          : `*${chain.toUpperCase()}:* ❌ Not set`
      })
      await sendNew(bot, chatId, msgId,
        `🔑 *Configured Wallets*\n\n${lines.join('\n')}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'menu_wallets' }]] } }
      )
      return
    }

    // ── Action: Set TON address (address-only, no private key) ──────────
    if (cbData === 'wallet_set_ton') {
      await bot.answerCallbackQuery(cbq.id)
      const tonPromptRes = await sendNew(bot, chatId, msgId,
        '📍 *Add TON Address*\n\nSend your TON wallet address as the next message.\n\n' +
        'It should look like: `EQD...` or `UQ...` (48 characters)\n\n' +
        '⏱ This prompt expires in 5 minutes.',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_wallets' }]] },
        }
      )
      await cbUser.ref.set(
        { botSettings: { pendingTonAddress: { promptMsgId: tonPromptRes?.result?.message_id ?? null, expiresAt: Date.now() + 5 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Menu: Sniper ──────────────────────────────────────────────────────
    if (cbData === 'menu_sniper') {
      await bot.answerCallbackQuery(cbq.id)
      const snipSnap = await db.collection(`users/${cbUid}/snipeTargets`)
        .where('status', '==', 'pending').get()
      await sendNew(bot, chatId, msgId,
        `🎯 *Sniper*\n\nActive snipes: *${snipSnap.size}*\n\n` +
        `Add a snipe target and the bot will execute the buy automatically when your conditions are met.\n\n` +
        `Supported chains: BSC · ETH · SOL · BASE`,
        { parse_mode: 'Markdown', reply_markup: sniperMenuKeyboard(snipSnap.size) }
      )
      return
    }

    // ── Menu: Trade ───────────────────────────────────────────────────────
    if (cbData === 'menu_trade') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        '🔄 *Manual Trade*\n\nSelect a chain to execute a trade:\n\n' +
        '• BSC, ETH, SOL, BASE — full buy/sell supported\n' +
        '• TON — balance tracking only (not tradeable via bot)',
        { parse_mode: 'Markdown', reply_markup: tradeMenuKeyboard() }
      )
      return
    }

    // ── Action: Sniper add — chain selector ───────────────────────────────
    if (cbData === 'sniper_add') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        '🎯 *Add Snipe Target*\n\nSelect the chain:',
        { parse_mode: 'Markdown', reply_markup: snipeChainKeyboard() }
      )
      return
    }

    // ── Action: Snipe chain selected → prompt for address ─────────────────
    if (cbData.startsWith('snipe_chain_')) {
      const chain = cbData.replace('snipe_chain_', '')
      if (!['bsc', 'eth', 'sol', 'base'].includes(chain)) { await bot.answerCallbackQuery(cbq.id, 'Invalid chain.'); return }
      if (!cbWallets[chain]?.encryptedKey) {
        await bot.answerCallbackQuery(cbq.id, `No ${chain.toUpperCase()} wallet set.`)
        await sendNew(bot, chatId, msgId,
          `❌ *No ${chain.toUpperCase()} wallet configured.*\n\nSet up a wallet in 🔑 Wallets first.`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔑 Wallets', callback_data: 'menu_wallets' }, BACK_BTN]] } }
        )
        return
      }
      await bot.answerCallbackQuery(cbq.id)
      const snipeAddrPrompt = await sendNew(bot, chatId, msgId,
        `🎯 *Snipe on ${chain.toUpperCase()}*\n\nSend the *token contract address* as the next message.\n\n⏱ Expires in 5 minutes.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_sniper' }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingSnipe: { step: 'address', chain, promptMsgId: snipeAddrPrompt?.result?.message_id ?? null, expiresAt: Date.now() + 5 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Action: Trade chain selected → prompt for address ─────────────────
    if (cbData.startsWith('trade_chain_')) {
      const chain = cbData.replace('trade_chain_', '')
      if (!['bsc', 'eth', 'sol', 'base'].includes(chain)) { await bot.answerCallbackQuery(cbq.id, 'Invalid chain.'); return }
      if (!cbWallets[chain]?.encryptedKey) {
        await bot.answerCallbackQuery(cbq.id, `No ${chain.toUpperCase()} wallet set.`)
        await sendNew(bot, chatId, msgId,
          `❌ *No ${chain.toUpperCase()} wallet configured.*\n\nSet up a wallet in 🔑 Wallets first.`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔑 Wallets', callback_data: 'menu_wallets' }, BACK_BTN]] } }
        )
        return
      }
      await bot.answerCallbackQuery(cbq.id)
      const tradeAddrPrompt = await sendNew(bot, chatId, msgId,
        `🔄 *Trade on ${chain.toUpperCase()}*\n\nSend the *token contract address* as the next message.\n\n⏱ Expires in 5 minutes.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_trade' }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingTrade: { step: 'address', chain, promptMsgId: tradeAddrPrompt?.result?.message_id ?? null, expiresAt: Date.now() + 5 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Action: Trade — buy button ────────────────────────────────────────
    if (cbData === 'trade_do_buy') {
      const pt = cbSettings.pendingTrade
      if (!pt?.chain || !pt?.tokenAddress) { await bot.answerCallbackQuery(cbq.id, 'Session expired. Start again.'); return }
      await bot.answerCallbackQuery(cbq.id)
      const buyPromptRes = await bot.sendMessage(chatId,
        `💰 *Buy on ${pt.chain.toUpperCase()}*\n\nSend the amount of *${nativeTicker(pt.chain)}* to spend.\n\nExample: \`0.1\`\n\n⏱ Expires in 3 minutes.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_trade' }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingTrade: { ...pt, step: 'buy_amount', promptMsgId: buyPromptRes?.result?.message_id ?? null, expiresAt: Date.now() + 3 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Action: Trade — sell button ───────────────────────────────────────
    if (cbData === 'trade_do_sell') {
      const pt = cbSettings.pendingTrade
      if (!pt?.chain || !pt?.tokenAddress) { await bot.answerCallbackQuery(cbq.id, 'Session expired. Start again.'); return }
      await bot.answerCallbackQuery(cbq.id)
      const sellPromptRes = await bot.sendMessage(chatId,
        `💸 *Sell on ${pt.chain.toUpperCase()}*\n\nSend the *percentage* of your holdings to sell (1–100).\n\nExample: \`100\` to sell all\n\n⏱ Expires in 3 minutes.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_trade' }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingTrade: { ...pt, step: 'sell_percent', promptMsgId: sellPromptRes?.result?.message_id ?? null, expiresAt: Date.now() + 3 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Action: Wallet import — chain selection ───────────────────────────
    if (cbData === 'wallet_import_menu') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        '📥 *Import Wallet*\n\nSelect the chain for the wallet you want to import:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🟡 BSC',  callback_data: 'wallet_import_bsc'  },
                { text: '🔷 ETH',  callback_data: 'wallet_import_eth'  },
                { text: '🟣 SOL',  callback_data: 'wallet_import_sol'  },
              ],
              [
                { text: '🔵 BASE',        callback_data: 'wallet_import_base' },
                { text: '🔷 TON (addr)',  callback_data: 'wallet_set_ton'     },
              ],
              [{ text: '⬅️ Back', callback_data: 'menu_wallets' }],
            ],
          },
        }
      )
      return
    }

    // ── Action: Wallet import — await key/phrase ──────────────────────────
    if (['wallet_import_bsc', 'wallet_import_eth', 'wallet_import_sol', 'wallet_import_base'].includes(cbData)) {
      const chain = cbData.replace('wallet_import_', '')
      await bot.answerCallbackQuery(cbq.id)
      const importPromptRes = await sendNew(bot, chatId, msgId,
        `📥 *Import ${chain.toUpperCase()} Wallet*\n\n` +
        `Send your *private key* or *12/24-word seed phrase* as the next message.\n\n` +
        `⏱ This prompt expires in 5 minutes.\n` +
        `⚠️ Delete the message immediately after sending.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_wallets' }]] },
        }
      )
      await cbUser.ref.set(
        { botSettings: { pendingImport: { chain, promptMsgId: importPromptRes?.result?.message_id ?? null, expiresAt: Date.now() + 5 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Action: Wallet create ─────────────────────────────────────────────
    if (cbData.startsWith('wallet_create_')) {
      const chain = cbData.replace('wallet_create_', '')
      if (!VALID_CHAINS.has(chain)) { await bot.answerCallbackQuery(cbq.id, 'Invalid chain.'); return }

      // TON key generation requires the browser (TonWeb). Guide user to add their address instead.
      if (chain === 'ton') {
        await bot.answerCallbackQuery(cbq.id)
        await sendNew(bot, chatId, msgId,
          '🔷 *TON Wallet Setup*\n\n' +
          'TON key generation requires the FXcrypt app (browser).\n\n' +
          '*Steps:*\n' +
          '1. Open the Wallet page in the FXcrypt app\n' +
          '2. Create your TON wallet there\n' +
          '3. Copy your TON address\n' +
          '4. Tap *"➕ Add TON Address"* below to connect it here',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Add TON Address', callback_data: 'wallet_set_ton' }],
                [{ text: '🌐 Open Wallet App', url: 'https://pnl-calculator.web.app/wallet.html' }],
                [{ text: '⬅️ Back', callback_data: 'menu_wallets' }],
              ],
            },
          }
        )
        return
      }

      await bot.answerCallbackQuery(cbq.id, `Creating ${chain.toUpperCase()} wallet…`)

      let address, privateKey, mnemonic
      try {
        if (chain === 'sol') {
          const { Keypair } = require('@solana/web3.js')
          const bs58 = require('bs58')
          const kp   = Keypair.generate()
          address    = kp.publicKey.toBase58()
          privateKey = bs58.encode(kp.secretKey)
        } else {
          const { ethers } = require('ethers')
          const wallet = ethers.Wallet.createRandom()
          address    = wallet.address
          privateKey = wallet.privateKey
          mnemonic   = wallet.mnemonic?.phrase || null
        }
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Failed to create wallet: ${err.message}`)
        return
      }

      const encryptedKey      = encryption.encrypt(privateKey, cbUid, masterSecret)
      const encryptedMnemonic = mnemonic ? encryption.encrypt(mnemonic, cbUid, masterSecret) : null
      await cbUser.ref.set(
        { botSettings: { wallets: { [chain]: { address, encryptedKey, ...(encryptedMnemonic ? { encryptedMnemonic } : {}) } } } },
        { merge: true }
      )

      const mnemonicLine = mnemonic
        ? `\n🌱 *Seed Phrase (save — shown once):*\n\`${mnemonic}\`\n` : ''

      // Send as a NEW message so the sensitive info is clearly visible and deletable
      await bot.sendMessage(chatId,
        `✅ *New ${chain.toUpperCase()} Wallet Created!*\n\n` +
        `Address:\n\`${address}\`\n\n` +
        `🔑 *Private Key — save now, shown once:*\n\`${privateKey}\`\n` +
        mnemonicLine +
        `\n⚠️ *Delete this message after saving. Never share your keys.*`,
        { parse_mode: 'Markdown' }
      )
      // Show the chain detail screen for the newly created wallet
      const newWallets = { ...cbWallets, [chain]: { address } }
      await sendNew(bot, chatId, msgId,
        `🔑 *${chain.toUpperCase()} Wallet*\n\nAddress:\n\`${address}\``,
        { parse_mode: 'Markdown', reply_markup: walletChainKeyboard(chain, { address }) }
      )
      return
    }

    // ── Action: Wallet remove ─────────────────────────────────────────────
    if (cbData.startsWith('wallet_remove_')) {
      const chain = cbData.replace('wallet_remove_', '')
      if (!VALID_CHAINS.has(chain)) { await bot.answerCallbackQuery(cbq.id, 'Invalid chain.'); return }
      if (!cbWallets[chain]?.address) { await bot.answerCallbackQuery(cbq.id, `No ${chain.toUpperCase()} wallet set.`); return }

      await cbUser.ref.set(
        { botSettings: { wallets: { [chain]: admin.firestore.FieldValue.delete() } } },
        { merge: true }
      )
      await bot.answerCallbackQuery(cbq.id, `✅ ${chain.toUpperCase()} wallet removed`)
      const ICONS = { bsc:'🟡', eth:'💠', sol:'🟣', base:'🔵', ton:'🔷' }
      await sendNew(bot, chatId, msgId,
        `${ICONS[chain] || '🔑'} *${chain.toUpperCase()} Wallet*\n\n_No wallet configured yet._`,
        { parse_mode: 'Markdown', reply_markup: walletChainKeyboard(chain, null) }
      )
      return
    }

    // ── Menu: Settings ────────────────────────────────────────────────────
    if (cbData === 'menu_settings') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        '⚙️ *Settings*\n\nChoose a category:',
        { parse_mode: 'Markdown', reply_markup: settingsMenuKeyboard() }
      )
      return
    }

    // ── Settings sub-menu: Bot Config ─────────────────────────────────────
    if (cbData === 'settings_bot') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        `🤖 *Bot Config*\n\nTap a setting to edit it:`,
        { parse_mode: 'Markdown', reply_markup: botSettingsKeyboard(cbSettings) }
      )
      return
    }

    // ── Settings sub-menu: Gem Config ─────────────────────────────────────
    if (cbData === 'settings_gems') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        `💎 *Gem Scanner Config*\n\nTap a setting to edit it:`,
        { parse_mode: 'Markdown', reply_markup: gemSettingsKeyboard(cbSettings) }
      )
      return
    }

    // ── Settings sub-menu: Agent Config ──────────────────────────────────
    if (cbData === 'settings_agent') {
      await bot.answerCallbackQuery(cbq.id)
      const agData = cbUser.data().agentSettings || {}
      await sendNew(bot, chatId, msgId,
        `📈 *Agent Config*\n\nTap a setting to edit it:`,
        { parse_mode: 'Markdown', reply_markup: agentSettingsKeyboard(agData) }
      )
      return
    }

    // ── Settings sub-menu: CEX API Keys ──────────────────────────────────
    if (cbData === 'settings_cex') {
      await bot.answerCallbackQuery(cbq.id)
      const cexKeys = (cbUser.data().agentSettings || {}).cexKeys || {}
      await sendNew(bot, chatId, msgId,
        '🔑 *CEX API Keys*\n\nManage exchange API keys for the trading agent:',
        { parse_mode: 'Markdown', reply_markup: cexKeysMenuKeyboard(cexKeys) }
      )
      return
    }

    // ── Settings sub-menu: Profile ────────────────────────────────────────
    if (cbData === 'action_profile') {
      await bot.answerCallbackQuery(cbq.id)
      const rootSnap = await db.doc(`users/${cbUid}`).get()
      const d        = rootSnap.data() || {}
      const joined   = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-GB') : '—'
      await sendNew(bot, chatId, msgId,
        `👤 *Your Profile*\n\n` +
        `Name: ${d.firstName || '—'} ${d.lastName || '—'}\n` +
        `Email: \`${d.email || '—'}\`\n` +
        `Phone: ${d.phone || '—'}\n` +
        `Member since: ${joined}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'menu_settings' }]] } }
      )
      return
    }

    // ── Settings: sedit — boolean toggle (autoExecute) ───────────────────
    if (cbData === 'sedit_autoExecute') {
      const agData   = cbUser.data().agentSettings || {}
      const newValue = !agData.autoExecute
      await cbUser.ref.set({ agentSettings: { autoExecute: newValue } }, { merge: true })
      await bot.answerCallbackQuery(cbq.id, `Auto-Execute ${newValue ? 'ON' : 'OFF'}`)
      const updated = { ...agData, autoExecute: newValue }
      await sendNew(bot, chatId, msgId,
        `📈 *Agent Config*\n\nTap a setting to edit it:`,
        { parse_mode: 'Markdown', reply_markup: agentSettingsKeyboard(updated) }
      )
      return
    }

    // ── Settings: sedit — timeframe picker ───────────────────────────────
    if (cbData === 'sedit_timeframe') {
      await bot.answerCallbackQuery(cbq.id)
      await sendNew(bot, chatId, msgId,
        '⏱ *Select Timeframe:*',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [
              { text: '5m',  callback_data: 'sedit_tf_5m'  },
              { text: '15m', callback_data: 'sedit_tf_15m' },
              { text: '1H',  callback_data: 'sedit_tf_1H'  },
            ],
            [
              { text: '4H',  callback_data: 'sedit_tf_4H'  },
              { text: '1D',  callback_data: 'sedit_tf_1D'  },
            ],
            [{ text: '⬅️ Back', callback_data: 'settings_agent' }],
          ]},
        }
      )
      return
    }

    // ── Settings: sedit — timeframe value applied ─────────────────────────
    if (cbData.startsWith('sedit_tf_')) {
      const tf = cbData.replace('sedit_tf_', '')
      await cbUser.ref.set({ agentSettings: { timeframe: tf } }, { merge: true })
      await bot.answerCallbackQuery(cbq.id, `Timeframe set to ${tf}`)
      const agData = { ...(cbUser.data().agentSettings || {}), timeframe: tf }
      await sendNew(bot, chatId, msgId,
        `📈 *Agent Config*\n\nTap a setting to edit it:`,
        { parse_mode: 'Markdown', reply_markup: agentSettingsKeyboard(agData) }
      )
      return
    }

    // ── Settings: sedit — gem max age picker (opens time-unit selector) ───
    if (cbData === 'sedit_gemMaxAge') {
      await bot.answerCallbackQuery(cbq.id)
      const currentAge = cbSettings.gemMaxAge ?? 24
      await sendNew(bot, chatId, msgId,
        `⏳ *Gem Max Age*\n\n` +
        `Sets the maximum age of token pairs included in gem scans.\n\n` +
        `Currently: *${fmtGemAge(currentAge)}*\n\n` +
        `Select a timeframe:`,
        { parse_mode: 'Markdown', reply_markup: gemMaxAgePickerKeyboard(currentAge) }
      )
      return
    }

    // ── Settings: sedit — gem max age value applied ───────────────────────
    if (cbData.startsWith('sedit_age_')) {
      const hours = parseFloat(cbData.replace('sedit_age_', ''))
      if (!isFinite(hours) || hours <= 0) { await bot.answerCallbackQuery(cbq.id, 'Invalid value.'); return }
      await cbUser.ref.set({ botSettings: { gemMaxAge: hours } }, { merge: true })
      await bot.answerCallbackQuery(cbq.id, `✅ Max age set to ${fmtGemAge(hours)}`)
      const updatedSettings = { ...cbSettings, gemMaxAge: hours }
      await sendNew(bot, chatId, msgId,
        `💎 *Gem Config*\n\nTap a setting to edit it:`,
        { parse_mode: 'Markdown', reply_markup: gemSettingsKeyboard(updatedSettings) }
      )
      return
    }

    // ── Settings: sedit — numeric/free-text fields ───────────────────────
    if (cbData.startsWith('sedit_')) {
      const key = cbData.replace('sedit_', '')
      // Skip keys handled by their own picker handlers above
      if (key === 'autoExecute' || key.startsWith('tf_') || key === 'gemMaxAge' || key.startsWith('age_')) {
        await bot.answerCallbackQuery(cbq.id)
        return
      }

      const botSettingKeys   = new Set(['defaultSlippage','defaultGasMultiplier','minLiquidity',
                                        'gemMinLiquidity','gemMinScore',
                                        'gemBuyAmountBsc','gemBuyAmountSol'])
      const agentSettingKeys = new Set(['minConfidence','riskPercent'])
      const labels = {
        defaultSlippage:      'Default Slippage (%)',
        defaultGasMultiplier: 'Gas Multiplier (1.0–3.0)',
        minLiquidity:         'Min Liquidity ($)',
        gemMinLiquidity:      'Gem Min Liquidity ($)',
        gemMinScore:          'Gem Min Score (0–100)',
        gemBuyAmountBsc:      'Gem BSC Buy Amount (BNB)',
        gemBuyAmountSol:      'Gem SOL Buy Amount (SOL)',
        minConfidence:        'Min Confidence (%)',
        riskPercent:          'Risk Per Trade (%)',
      }
      const label          = labels[key] || key
      const isBotSetting   = botSettingKeys.has(key)
      const isAgentSetting = agentSettingKeys.has(key)
      const cancelTarget   = isAgentSetting ? 'settings_agent'
        : key.startsWith('gem') ? 'settings_gems'
        : 'settings_bot'

      await bot.answerCallbackQuery(cbq.id)
      const seditPromptRes = await bot.sendMessage(chatId,
        `✏️ *Edit: ${label}*\n\nSend the new value as the next message.\n\n⏱ Expires in 3 minutes.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: cancelTarget }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingSettingEdit: { key, label, isBotSetting, isAgentSetting,
            promptMsgId: seditPromptRes?.result?.message_id ?? null,
            expiresAt: Date.now() + 3 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Action: CEX key add (start multi-step flow) ───────────────────────
    if (cbData.startsWith('cex_add_')) {
      const exchange = cbData.replace('cex_add_', '')
      if (!['binance','mexc','bybit','kucoin'].includes(exchange)) { await bot.answerCallbackQuery(cbq.id, 'Invalid exchange.'); return }
      await bot.answerCallbackQuery(cbq.id)
      const cexPromptRes = await bot.sendMessage(chatId,
        `🔑 *Add ${exchange.toUpperCase()} API Key*\n\nStep 1 of ${exchange === 'kucoin' ? 3 : 2}: Send your *API Key*.\n\n⏱ Expires in 10 minutes.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'settings_cex' }]] } }
      )
      await cbUser.ref.set(
        { botSettings: { pendingCexImport: { exchange, step: 'apikey',
            promptMsgId: cexPromptRes?.result?.message_id ?? null,
            expiresAt: Date.now() + 10 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    // ── Action: CEX key remove ────────────────────────────────────────────
    if (cbData.startsWith('cex_remove_')) {
      const exchange = cbData.replace('cex_remove_', '')
      if (!['binance','mexc','bybit','kucoin'].includes(exchange)) { await bot.answerCallbackQuery(cbq.id, 'Invalid.'); return }
      await cbUser.ref.set(
        { agentSettings: { cexKeys: { [exchange]: admin.firestore.FieldValue.delete() } } },
        { merge: true }
      )
      await bot.answerCallbackQuery(cbq.id, `✅ ${exchange.toUpperCase()} key removed`)
      const updatedKeys = { ...((cbUser.data().agentSettings || {}).cexKeys || {}) }
      delete updatedKeys[exchange]
      await sendNew(bot, chatId, msgId,
        '🔑 *CEX API Keys*\n\nManage exchange API keys for the trading agent:',
        { parse_mode: 'Markdown', reply_markup: cexKeysMenuKeyboard(updatedKeys) }
      )
      return
    }

    await bot.answerCallbackQuery(cbq.id)
    return
  }

  const msg    = update.message || update.callback_query?.message
  const chatId = msg.chat.id
  const text   = (update.message?.text || '').trim()

  // ── Resolve Firebase user linked to this chat ──────────────────────────
  const snapshot = await db.collection('users')
    .where('botSettings.telegramChatId', '==', String(chatId))
    .limit(1).get()

  if (snapshot.empty) {
    // Strip @BotName from /link command so it works in group chats too
    const linkTokens  = text.trim().split(/\s+/)
    const linkCmd     = (linkTokens[0] || '').toLowerCase().replace(/@\S+$/, '')
    if (linkCmd === '/link') {
      const code  = (linkTokens[1] || '').toUpperCase().trim()

      if (!code) {
        await bot.sendMessage(chatId, '❌ Usage: `/link YOUR_CODE`', { parse_mode: 'Markdown' })
        return
      }

      const codeSnap = await db.collection('users')
        .where('botSettings.telegramLinkCode', '==', code).limit(1).get()

      if (codeSnap.empty) {
        await bot.sendMessage(chatId, '❌ Invalid link code. Generate a new one in the FXcrypt app under Bot → Settings.')
        return
      }

      const userData = codeSnap.docs[0].data()
      const expiry   = userData.botSettings?.telegramLinkExpiry || 0

      if (Date.now() > expiry) {
        // Clean up expired code
        await codeSnap.docs[0].ref.set(
          { botSettings: { telegramLinkCode: null, telegramLinkExpiry: null } },
          { merge: true }
        )
        await bot.sendMessage(chatId, '⏰ Link code has expired. Generate a new one in the FXcrypt app.')
        return
      }

      await codeSnap.docs[0].ref.set(
        { botSettings: { telegramChatId: String(chatId), telegramVerified: true, telegramLinkCode: null, telegramLinkExpiry: null } },
        { merge: true }
      )
      await bot.sendMessage(chatId, '✅ Account linked! Send /help to see all commands.')
      return
    }

    await bot.sendMessage(chatId,
      '🔗 *Account not linked.*\n\nOpen the FXcrypt app → Bot → Settings → Link Telegram, then send:\n`/link YOUR_CODE`',
      { parse_mode: 'Markdown' }
    )
    return
  }

  const userDoc  = snapshot.docs[0]
  const uid      = userDoc.id
  const settings = (userDoc.data().botSettings || {})
  const wallets  = settings.wallets || {}

  const parts   = text.split(/\s+/)
  // Strip optional @BotName suffix Telegram appends in group chats (e.g. /help@MyBot)
  const command = (parts[0] || '').toLowerCase().replace(/@\S+$/, '')

  async function reply(msg, opts = {}) {
    return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...opts })
  }

  // ── Pending Trade: multi-step trade flow (chain → address → buy/sell → amount) ──
  const pendingTrade = settings.pendingTrade
  if (!text.startsWith('/') && pendingTrade?.step && pendingTrade.expiresAt > Date.now()) {
    const pt = pendingTrade

    if (pt.step === 'address') {
      await userDoc.ref.set({ botSettings: { pendingTrade: admin.firestore.FieldValue.delete() } }, { merge: true })
      await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
      await animateDelete(bot, chatId, pt.promptMsgId)
      const addr = text.trim()
      let addrValid = true
      if (['bsc', 'eth', 'base'].includes(pt.chain) && !/^0x[0-9a-fA-F]{40}$/.test(addr)) addrValid = false
      if (pt.chain === 'sol' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) addrValid = false
      if (!addrValid) {
        await bot.sendMessage(chatId, `❌ Invalid ${pt.chain.toUpperCase()} address format. Tap 🔄 Trade to try again.`, { reply_markup: mainMenuKeyboard() })
        return
      }
      let infoLine = '_Token info unavailable — you can still trade._'
      try {
        const info = await trader.checkToken(addr, pt.chain)
        if (info.found) infoLine = `💰 *${info.name}* (${info.symbol})\nPrice: $${parseFloat(info.price).toFixed(8)}\nLiquidity: $${(info.liquidity || 0).toLocaleString('en-US')}`
      } catch (_) {}
      await userDoc.ref.set(
        { botSettings: { pendingTrade: { step: 'action', chain: pt.chain, tokenAddress: addr, expiresAt: Date.now() + 5 * 60 * 1000 } } },
        { merge: true }
      )
      await bot.sendMessage(chatId,
        `🔄 *${pt.chain.toUpperCase()} Trade*\n\n${infoLine}\n\nWhat would you like to do?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `🟢 Buy ${nativeTicker(pt.chain)}`, callback_data: 'trade_do_buy' }, { text: '🔴 Sell %', callback_data: 'trade_do_sell' }],
              [{ text: '❌ Cancel', callback_data: 'menu_trade' }],
            ],
          },
        }
      )
      return
    }

    if (pt.step === 'action') {
      await bot.sendMessage(chatId, '⬆️ Please choose *Buy* or *Sell* using the buttons above.', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_trade' }]] },
      })
      return
    }

    if (pt.step === 'buy_amount') {
      await userDoc.ref.set({ botSettings: { pendingTrade: admin.firestore.FieldValue.delete() } }, { merge: true })
      await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
      await animateDelete(bot, chatId, pt.promptMsgId)
      const amount = safeParseFloat(text.trim())
      if (!amount) {
        await bot.sendMessage(chatId, '❌ Invalid amount. Enter a positive number like `0.1`.', { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
        return
      }
      await bot.sendMessage(chatId, `⏳ Buying on ${pt.chain.toUpperCase()}…`)
      try {
        const pk     = encryption.decrypt(wallets[pt.chain].encryptedKey, uid, masterSecret)
        const slip   = Math.min(settings.defaultSlippage || 5, 50)
        const gasX   = settings.defaultGasMultiplier || 1.2
        const result = pt.chain === 'sol'
          ? await trader.buyTokenSOL(pk, pt.tokenAddress, amount, slip, settings.solRpc)
          : await trader.buyTokenEVM(pt.chain, pk, pt.tokenAddress, amount, slip, settings[pt.chain + 'Rpc'], gasX)
        await db.collection(`users/${uid}/trades`).add({
          chain: pt.chain, tokenAddress: pt.tokenAddress, type: 'buy',
          amountIn: String(amount), txHash: result.txHash, status: result.status, source: 'telegram-menu',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        })
        await bot.sendMessage(chatId,
          `✅ *Buy Executed!*\n\nChain: ${pt.chain.toUpperCase()}\nAmount: ${amount} ${nativeTicker(pt.chain)}\nStatus: \`${result.status}\`\n[View TX](${explorerUrl(pt.chain, result.txHash)})`,
          { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: mainMenuKeyboard() }
        )
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Buy failed: ${err.message}`, { reply_markup: mainMenuKeyboard() })
      }
      return
    }

    if (pt.step === 'sell_percent') {
      await userDoc.ref.set({ botSettings: { pendingTrade: admin.firestore.FieldValue.delete() } }, { merge: true })
      await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
      await animateDelete(bot, chatId, pt.promptMsgId)
      const pct = safeParsePercent(text.trim())
      if (!pct) {
        await bot.sendMessage(chatId, '❌ Invalid percentage. Enter a number between 1 and 100.', { reply_markup: mainMenuKeyboard() })
        return
      }
      await bot.sendMessage(chatId, `⏳ Selling ${pct}% on ${pt.chain.toUpperCase()}…`)
      try {
        const pk     = encryption.decrypt(wallets[pt.chain].encryptedKey, uid, masterSecret)
        const slip   = Math.min(settings.defaultSlippage || 5, 50)
        const gasX   = settings.defaultGasMultiplier || 1.2
        const result = pt.chain === 'sol'
          ? await trader.sellTokenSOL(pk, pt.tokenAddress, pct, slip, settings.solRpc)
          : await trader.sellTokenEVM(pt.chain, pk, pt.tokenAddress, pct, slip, settings[pt.chain + 'Rpc'], gasX)
        await db.collection(`users/${uid}/trades`).add({
          chain: pt.chain, tokenAddress: pt.tokenAddress, type: 'sell',
          percentSold: pct, txHash: result.txHash, status: result.status, source: 'telegram-menu',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        })
        await bot.sendMessage(chatId,
          `✅ *Sell Executed!*\n\nChain: ${pt.chain.toUpperCase()}\nSold: ${pct}%\nStatus: \`${result.status}\`\n[View TX](${explorerUrl(pt.chain, result.txHash)})`,
          { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: mainMenuKeyboard() }
        )
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Sell failed: ${err.message}`, { reply_markup: mainMenuKeyboard() })
      }
      return
    }
  }

  // ── Pending Snipe: multi-step snipe flow (chain → address → amount) ──────
  const pendingSnipe = settings.pendingSnipe
  if (!text.startsWith('/') && pendingSnipe?.step && pendingSnipe.expiresAt > Date.now()) {
    const ps = pendingSnipe

    if (ps.step === 'address') {
      await userDoc.ref.set({ botSettings: { pendingSnipe: admin.firestore.FieldValue.delete() } }, { merge: true })
      await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
      await animateDelete(bot, chatId, ps.promptMsgId)
      const addr = text.trim()
      let addrValid = true
      if (['bsc', 'eth', 'base'].includes(ps.chain) && !/^0x[0-9a-fA-F]{40}$/.test(addr)) addrValid = false
      if (ps.chain === 'sol' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) addrValid = false
      if (!addrValid) {
        await bot.sendMessage(chatId, `❌ Invalid ${ps.chain.toUpperCase()} address format. Tap 🎯 Sniper → Add Snipe to try again.`, { reply_markup: mainMenuKeyboard() })
        return
      }
      const snipeAmtPromptRes = await bot.sendMessage(chatId,
        `🎯 *Snipe on ${ps.chain.toUpperCase()}*\n\nToken: \`${addr.slice(0, 16)}…\`\n\n` +
        `Now send the *amount of ${nativeTicker(ps.chain)}* to buy.\n` +
        `Optionally add a max price: \`0.1 0.00001\`\n\n⏱ Expires in 5 minutes.`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'menu_sniper' }]] } }
      )
      await userDoc.ref.set(
        { botSettings: { pendingSnipe: { step: 'amount', chain: ps.chain, tokenAddress: addr, promptMsgId: snipeAmtPromptRes?.result?.message_id ?? null, expiresAt: Date.now() + 5 * 60 * 1000 } } },
        { merge: true }
      )
      return
    }

    if (ps.step === 'amount') {
      await userDoc.ref.set({ botSettings: { pendingSnipe: admin.firestore.FieldValue.delete() } }, { merge: true })
      await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
      await animateDelete(bot, chatId, ps.promptMsgId)
      const inputParts = text.trim().split(/\s+/)
      const amount     = safeParseFloat(inputParts[0])
      const maxPrice   = inputParts[1] ? safeParseFloat(inputParts[1]) : null
      if (!amount) {
        await bot.sendMessage(chatId, '❌ Invalid amount. Enter a positive number like `0.1`.', { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
        return
      }
      const ref = await db.collection(`users/${uid}/snipeTargets`).add({
        chain: ps.chain, tokenAddress: ps.tokenAddress, buyAmount: String(amount),
        maxBuyPrice: maxPrice,
        slippage: Math.min(settings.defaultSlippage || 5, 50),
        status: 'pending', txHash: null, source: 'telegram-menu',
        addedAt: admin.firestore.FieldValue.serverTimestamp(), executedAt: null,
      })
      await bot.sendMessage(chatId,
        `✅ *Snipe Added!*\n\n` +
        `ID: \`${ref.id.slice(0, 8)}\`\nChain: ${ps.chain.toUpperCase()}\n` +
        `Token: \`${ps.tokenAddress.slice(0, 12)}…\`\nAmount: ${amount} ${nativeTicker(ps.chain)}\n` +
        `${maxPrice ? `Max Price: $${maxPrice}` : 'Max Price: Any'}\n\n` +
        `_Enable the bot with /boton if not already active._`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
      )
      return
    }
  }

  // ── Pending TON address: capture next free-text message as TON address ──
  const pendingTon = settings.pendingTonAddress
  if (!text.startsWith('/') && pendingTon?.expiresAt > Date.now()) {
    await userDoc.ref.set(
      { botSettings: { pendingTonAddress: admin.firestore.FieldValue.delete() } },
      { merge: true }
    )
    await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
    await animateDelete(bot, chatId, pendingTon.promptMsgId)
    const addr = text.trim()
    const validTon = /^[A-Za-z0-9_+/=\-]{48}$/.test(addr) || /^0:[0-9a-fA-F]{64}$/.test(addr)
    if (!validTon) {
      await bot.sendMessage(chatId,
        '❌ Invalid TON address. Expected `EQ...` or `UQ...` (48 chars) or raw format `0:hex64`.\n\nTap 🔑 Wallets → ➕ Add TON Address to try again.',
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
      )
      return
    }
    await userDoc.ref.set(
      { botSettings: { wallets: { ton: { address: addr } } } },
      { merge: true }
    )
    await bot.sendMessage(chatId,
      `✅ *TON Address Connected!*\n\n\`${addr}\`\n\nYour TON balance will now appear in the dashboard.`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    )
    return
  }

  // ── Pending wallet import: capture the next free-text message as key/phrase
  const pendingImport = settings.pendingImport
  if (!text.startsWith('/') && pendingImport?.chain && pendingImport.expiresAt > Date.now()) {
    const chain = pendingImport.chain
    const input = text.trim()

    // Clear the pending state and wipe the user's message immediately for security
    await userDoc.ref.set(
      { botSettings: { pendingImport: admin.firestore.FieldValue.delete() } },
      { merge: true }
    )
    await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
    await animateDelete(bot, chatId, pendingImport.promptMsgId)

    try {
      let address, privateKey, importedMnemonic
      const wordCount  = input.split(/\s+/).length
      const isMnemonic = wordCount >= 12

      if (chain === 'sol') {
        const { Keypair } = require('@solana/web3.js')
        const bs58        = require('bs58')
        if (isMnemonic) {
          const { pbkdf2 } = require('@noble/hashes/pbkdf2')
          const { sha512 } = require('@noble/hashes/sha512')
          const { hmac }   = require('@noble/hashes/hmac')
          const enc  = new TextEncoder()
          const seed = pbkdf2(sha512, enc.encode(input), enc.encode('mnemonic'), { c: 2048, dkLen: 64 })
          const PATH = [0x8000002c, 0x800001f5, 0x80000000, 0x80000000]
          let node = hmac(sha512, Buffer.from('ed25519 seed'), seed)
          for (const idx of PATH) {
            const d = new Uint8Array(37)
            d[0] = 0x00; d.set(node.slice(0, 32), 1)
            new DataView(d.buffer).setUint32(33, idx)
            node = hmac(sha512, node.slice(32), d)
          }
          const kp = Keypair.fromSeed(node.slice(0, 32))
          address          = kp.publicKey.toBase58()
          privateKey       = bs58.encode(kp.secretKey)
          importedMnemonic = input
        } else {
          const raw = bs58.decode(input)
          const kp  = Keypair.fromSecretKey(raw)
          address    = kp.publicKey.toBase58()
          privateKey = input
        }
      } else {
        const { ethers } = require('ethers')
        if (isMnemonic) {
          const wallet     = ethers.Wallet.fromPhrase(input)
          address          = wallet.address
          privateKey       = wallet.privateKey
          importedMnemonic = input
        } else {
          const wallet = new ethers.Wallet(input)
          address    = wallet.address
          privateKey = input
        }
      }

      const encryptedKey      = encryption.encrypt(privateKey, uid, masterSecret)
      const encryptedMnemonic = importedMnemonic ? encryption.encrypt(importedMnemonic, uid, masterSecret) : null
      await userDoc.ref.set(
        { botSettings: { wallets: { [chain]: { address, encryptedKey, ...(encryptedMnemonic ? { encryptedMnemonic } : {}) } } } },
        { merge: true }
      )
      await bot.sendMessage(chatId,
        `✅ *${chain.toUpperCase()} Wallet Imported!*\n\n` +
        `Address: \`${address}\`\n\n` +
        `⚠️ Delete this message now. Never share your keys.`,
        { parse_mode: 'Markdown', reply_markup: walletChainKeyboard(chain, { address }) }
      )
    } catch (err) {
      await bot.sendMessage(chatId,
        `❌ Import failed: ${err.message}\n\nTap 🔑 Wallets → 📥 Import Wallet to try again.`,
        { reply_markup: mainMenuKeyboard() }
      )
    }
    return
  }

  // ── Pending Wallet Buy (buy a held token, custom amount) ─────────────────
  const pendingWalletBuy = settings.pendingWalletBuy
  if (!text.startsWith('/') && pendingWalletBuy?.chain && pendingWalletBuy?.tokenIdx != null && pendingWalletBuy.expiresAt > Date.now()) {
    await userDoc.ref.set({ botSettings: { pendingWalletBuy: admin.firestore.FieldValue.delete() } }, { merge: true })
    await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
    await animateDelete(bot, chatId, pendingWalletBuy.promptMsgId)

    const { chain, tokenIdx } = pendingWalletBuy
    const cache = settings.walletTokenCache?.[chain]
    if (!cache?.tokens?.[tokenIdx]) {
      await bot.sendMessage(chatId, '⏰ Token list expired. Please refresh holdings.', { reply_markup: mainMenuKeyboard() })
      return
    }
    const token       = cache.tokens[tokenIdx]
    const chainTicker = { bsc:'BNB', eth:'ETH', sol:'SOL', base:'ETH' }[chain] || chain.toUpperCase()
    if (!wallets[chain]?.encryptedKey) {
      await bot.sendMessage(chatId, `❌ No ${chain.toUpperCase()} wallet key found.`, { reply_markup: mainMenuKeyboard() })
      return
    }

    // Parse: plain number = native, "5 USD" / "5usd" = USD→native convert
    let amount
    const rawInput = text.trim()
    const isUsd = /usd/i.test(rawInput)
    if (isUsd) {
      const usdVal = parseFloat(rawInput)
      if (!isFinite(usdVal) || usdVal <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid USD amount.', { reply_markup: mainMenuKeyboard() })
        return
      }
      try {
        const cgId = chain === 'sol' ? 'solana' : chain === 'bsc' ? 'binancecoin' : 'ethereum'
        const { data: cgData } = await axios.get(
          `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
          { timeout: 8000 }
        )
        const nativePrice = cgData?.[cgId]?.usd
        if (!nativePrice) throw new Error('no price')
        amount = parseFloat((usdVal / nativePrice).toFixed(6))
      } catch {
        await bot.sendMessage(chatId,
          `❌ Could not convert USD → ${chainTicker}. Try entering amount in ${chainTicker} directly.`,
          { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
        return
      }
    } else {
      amount = parseFloat(rawInput)
      if (!isFinite(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid amount. Enter a positive number.', { reply_markup: mainMenuKeyboard() })
        return
      }
    }

    await bot.sendMessage(chatId,
      `⏳ Buying *${token.name} (${token.symbol})* on ${chain.toUpperCase()}…\nAmount: ${amount} ${chainTicker}`,
      { parse_mode: 'Markdown' }
    )
    try {
      const pk     = encryption.decrypt(wallets[chain].encryptedKey, uid, masterSecret)
      const slip   = Math.min(settings.defaultSlippage || 5, 50)
      const gasX   = settings.defaultGasMultiplier || 1.2
      const result = chain === 'sol'
        ? await trader.buyTokenSOL(pk, token.address, amount, slip, settings.solRpc, heliusKey)
        : await trader.buyTokenEVM(chain, pk, token.address, amount, slip, settings[chain + 'Rpc'], gasX)
      await db.collection(`users/${uid}/trades`).add({
        chain, tokenAddress: token.address, type: 'buy', source: 'wallet-holdings',
        tokenName: token.name, tokenSymbol: token.symbol,
        amountIn: String(amount), txHash: result.txHash, status: result.status,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
      await userDoc.ref.set(
        { botSettings: { walletTokenCache: { [chain]: admin.firestore.FieldValue.delete() } } },
        { merge: true }
      )
      await bot.sendMessage(chatId,
        `✅ *Buy Executed!*\n\n` +
        `Token: *${token.name} (${token.symbol})*\n` +
        `Chain: ${chain.toUpperCase()} | Amount: ${amount} ${chainTicker}\n` +
        `Status: \`${result.status}\`\n` +
        `[View TX](${explorerUrl(chain, result.txHash)})`,
        { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: mainMenuKeyboard() }
      )
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Buy failed: ${err.message}`, { reply_markup: mainMenuKeyboard() })
    }
    return
  }

  // ── Pending Wallet Sell (custom %) ────────────────────────────────────────
  const pendingWalletSell = settings.pendingWalletSell
  if (!text.startsWith('/') && pendingWalletSell?.chain && pendingWalletSell?.tokenIdx != null && pendingWalletSell.expiresAt > Date.now()) {
    await userDoc.ref.set({ botSettings: { pendingWalletSell: admin.firestore.FieldValue.delete() } }, { merge: true })
    await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
    await animateDelete(bot, chatId, pendingWalletSell.promptMsgId)

    const { chain, tokenIdx } = pendingWalletSell
    const cache = settings.walletTokenCache?.[chain]
    if (!cache?.tokens?.[tokenIdx]) {
      await bot.sendMessage(chatId, '⏰ Token list expired. Please refresh holdings.', { reply_markup: mainMenuKeyboard() })
      return
    }
    const token = cache.tokens[tokenIdx]
    if (!wallets[chain]?.encryptedKey) {
      await bot.sendMessage(chatId, `❌ No ${chain.toUpperCase()} wallet key found.`, { reply_markup: mainMenuKeyboard() })
      return
    }

    const pct = parseInt(text.trim(), 10)
    if (!isFinite(pct) || pct < 1 || pct > 100) {
      await bot.sendMessage(chatId, '❌ Invalid percentage. Enter a number from 1 to 100.', { reply_markup: mainMenuKeyboard() })
      return
    }

    const chainTicker = { bsc:'BNB', eth:'ETH', sol:'SOL', base:'ETH' }[chain] || chain.toUpperCase()
    await bot.sendMessage(chatId,
      `⏳ Selling *${pct}%* of *${token.symbol}* on ${chain.toUpperCase()}…`,
      { parse_mode: 'Markdown' }
    )
    try {
      const pk     = encryption.decrypt(wallets[chain].encryptedKey, uid, masterSecret)
      const slip   = Math.min(settings.defaultSlippage || 5, 50)
      const gasX   = settings.defaultGasMultiplier || 1.2
      const result = chain === 'sol'
        ? await trader.sellTokenSOL(pk, token.address, pct, slip, settings.solRpc, heliusKey)
        : await trader.sellTokenEVM(chain, pk, token.address, pct, slip, settings[chain + 'Rpc'], gasX)
      await db.collection(`users/${uid}/trades`).add({
        chain, tokenAddress: token.address, type: 'sell', source: 'wallet-holdings',
        tokenName: token.name, tokenSymbol: token.symbol,
        percentSold: pct, txHash: result.txHash, status: result.status,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
      await userDoc.ref.set(
        { botSettings: { walletTokenCache: { [chain]: admin.firestore.FieldValue.delete() } } },
        { merge: true }
      )
      await bot.sendMessage(chatId,
        `✅ *Sell Executed!*\n\n` +
        `Token: *${token.name} (${token.symbol})*\n` +
        `Chain: ${chain.toUpperCase()} | Sold: ${pct}%\n` +
        `Status: \`${result.status}\`\n` +
        `[View TX](${explorerUrl(chain, result.txHash)})`,
        { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: mainMenuKeyboard() }
      )
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Sell failed: ${err.message}`, { reply_markup: mainMenuKeyboard() })
    }
    return
  }

  // ── Pending Gem Buy (custom amount for a specific gem) ───────────────────
  const pendingGemBuy = settings.pendingGemBuy
  if (!text.startsWith('/') && pendingGemBuy?.gemIdx != null && pendingGemBuy.expiresAt > Date.now()) {
    await userDoc.ref.set({ botSettings: { pendingGemBuy: admin.firestore.FieldValue.delete() } }, { merge: true })
    await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
    await animateDelete(bot, chatId, pendingGemBuy.promptMsgId)

    const scan = settings.lastGemScan
    const idx  = pendingGemBuy.gemIdx
    if (!scan?.gems || isNaN(idx) || !scan.gems[idx]) {
      await bot.sendMessage(chatId, '⏰ Scan expired. Please run a new scan.', { reply_markup: mainMenuKeyboard() })
      return
    }
    const g           = scan.gems[idx]
    const chain       = g.chain || 'bsc'
    const chainTicker = chain === 'sol' ? 'SOL' : (chain === 'eth' || chain === 'base') ? 'ETH' : 'BNB'
    const tokenLabel  = g.tokenName || g.tokenSymbol || g.tokenAddress?.slice(0, 10) || 'token'

    if (!wallets[chain]?.encryptedKey) {
      await bot.sendMessage(chatId, `❌ No ${chain.toUpperCase()} wallet configured.`, { reply_markup: mainMenuKeyboard() })
      return
    }

    // Parse amount — supports "5 USD" / "5usd" (case-insensitive) or plain number
    let amount
    const rawInput = text.trim()
    const isUsd    = /usd/i.test(rawInput)
    if (isUsd) {
      const usdVal = parseFloat(rawInput)
      if (!isFinite(usdVal) || usdVal <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid USD amount. Try again from 💎 Gems → chain filter.', { reply_markup: mainMenuKeyboard() })
        return
      }
      try {
        const cgId       = chain === 'sol' ? 'solana' : chain === 'bsc' ? 'binancecoin' : 'ethereum'
        const { data: cgData } = await axios.get(
          `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
          { timeout: 8000 }
        )
        const nativePrice = cgData?.[cgId]?.usd
        if (!nativePrice) throw new Error('no price')
        amount = parseFloat((usdVal / nativePrice).toFixed(6))
      } catch {
        await bot.sendMessage(chatId,
          `❌ Could not fetch ${chainTicker} price. Enter amount in ${chainTicker} instead (e.g. \`0.05\`).`,
          { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
        )
        return
      }
    } else {
      amount = parseFloat(rawInput)
      if (!isFinite(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid amount. Enter a positive number.', { reply_markup: mainMenuKeyboard() })
        return
      }
    }

    await bot.sendMessage(chatId,
      `⏳ Buying *${tokenLabel}* on ${chain.toUpperCase()}…\nAmount: ${amount} ${chainTicker}`,
      { parse_mode: 'Markdown' }
    )
    try {
      const pk     = encryption.decrypt(wallets[chain].encryptedKey, uid, masterSecret)
      const slip   = Math.min(settings.defaultSlippage || 5, 50)
      const gasX   = settings.defaultGasMultiplier || 1.2
      const result = chain === 'sol'
        ? await trader.buyTokenSOL(pk, g.tokenAddress, amount, slip, settings.solRpc)
        : await trader.buyTokenEVM(chain, pk, g.tokenAddress, amount, slip, settings[chain + 'Rpc'], gasX)
      await db.collection(`users/${uid}/trades`).add({
        chain, tokenAddress: g.tokenAddress, type: 'buy', source: 'gem-custom',
        tokenName: g.tokenName, tokenSymbol: g.tokenSymbol,
        amountIn: String(amount), txHash: result.txHash, status: result.status,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
      await bot.sendMessage(chatId,
        `✅ *Gem Buy Executed!*\n\n` +
        `Token: *${tokenLabel}*\n` +
        `Chain: ${chain.toUpperCase()} | Amount: ${amount} ${chainTicker}\n` +
        `Status: \`${result.status}\`\n` +
        `[View TX](${explorerUrl(chain, result.txHash)})`,
        { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: mainMenuKeyboard() }
      )
    } catch (err) {
      await bot.sendMessage(chatId, `❌ Buy failed: ${err.message}`, { reply_markup: mainMenuKeyboard() })
    }
    return
  }

  // ── Pending Setting Edit ──────────────────────────────────────────────────
  const pendingSettingEdit = settings.pendingSettingEdit
  if (!text.startsWith('/') && pendingSettingEdit?.key && pendingSettingEdit.expiresAt > Date.now()) {
    await userDoc.ref.set({ botSettings: { pendingSettingEdit: admin.firestore.FieldValue.delete() } }, { merge: true })
    await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
    await animateDelete(bot, chatId, pendingSettingEdit.promptMsgId)
    const { key, label, isBotSetting, isAgentSetting } = pendingSettingEdit
    const val = text.trim()
    const validators = {
      defaultSlippage:      v => { const n = parseFloat(v); return (isFinite(n) && n >= 0.1 && n <= 50) ? n : null },
      defaultGasMultiplier: v => { const n = parseFloat(v); return (isFinite(n) && n >= 1.0 && n <= 3.0) ? n : null },
      minLiquidity:         v => { const n = parseInt(v);   return (isFinite(n) && n >= 100) ? n : null },
      gemMinLiquidity:      v => { const n = parseInt(v);   return (isFinite(n) && n >= 100) ? n : null },
      gemMinScore:          v => { const n = parseInt(v);   return (isFinite(n) && n >= 0 && n <= 100) ? n : null },
      gemBuyAmountBsc:      v => { const n = parseFloat(v); return (isFinite(n) && n > 0) ? n : null },
      gemBuyAmountSol:      v => { const n = parseFloat(v); return (isFinite(n) && n > 0) ? n : null },
      minConfidence:        v => { const n = parseInt(v);   return (isFinite(n) && n >= 0 && n <= 100) ? n : null },
      riskPercent:          v => { const n = parseFloat(v); return (isFinite(n) && n >= 0.5 && n <= 10) ? n : null },
    }
    const validate = validators[key]
    const parsed   = validate ? validate(val) : val
    if (parsed === null || parsed === undefined) {
      await bot.sendMessage(chatId, `❌ Invalid value for *${label}*. Please try again.`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
      return
    }
    if (isBotSetting) {
      await userDoc.ref.set({ botSettings: { [key]: parsed } }, { merge: true })
    } else if (isAgentSetting) {
      await userDoc.ref.set({ agentSettings: { [key]: parsed } }, { merge: true })
    }
    await bot.sendMessage(chatId, `✅ *${label}* updated to \`${parsed}\``, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
    return
  }

  // ── Pending CEX Import (multi-step key import) ────────────────────────────
  const pendingCexImport = settings.pendingCexImport
  if (!text.startsWith('/') && pendingCexImport?.exchange && pendingCexImport.expiresAt > Date.now()) {
    const { exchange, step, apiKey: storedKey, secret: storedSecret } = pendingCexImport
    const input = text.trim()

    // Always delete the user's message and animate-delete the previous prompt
    await bot.deleteMessage(chatId, update.message?.message_id).catch(() => {})
    await animateDelete(bot, chatId, pendingCexImport.promptMsgId)

    if (step === 'apikey') {
      if (input.length < 10) {
        await bot.sendMessage(chatId, '❌ API key too short (min 10 chars). Try again.', { reply_markup: mainMenuKeyboard() })
        return
      }
      const secretPromptRes = await bot.sendMessage(chatId,
        `🔐 *Step 2${exchange === 'kucoin' ? '/3' : '/2'}*: Send your *${exchange.toUpperCase()} API Secret*:`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'settings_cex' }]] } }
      )
      await userDoc.ref.set({
        botSettings: { pendingCexImport: { exchange, step: 'secret', apiKey: input, promptMsgId: secretPromptRes?.result?.message_id ?? null, expiresAt: Date.now() + 10 * 60 * 1000 } }
      }, { merge: true })
      return
    }

    if (step === 'secret') {
      if (input.length < 10) {
        await bot.sendMessage(chatId, '❌ Secret too short. Try again.', { reply_markup: mainMenuKeyboard() })
        return
      }
      if (exchange === 'kucoin') {
        const ppPromptRes = await bot.sendMessage(chatId,
          `🔑 *Step 3/3*: Send your *KuCoin Trading Passphrase*:`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'settings_cex' }]] } }
        )
        await userDoc.ref.set({
          botSettings: { pendingCexImport: { exchange, step: 'passphrase', apiKey: storedKey, secret: input, promptMsgId: ppPromptRes?.result?.message_id ?? null, expiresAt: Date.now() + 10 * 60 * 1000 } }
        }, { merge: true })
        return
      }
      await userDoc.ref.set({ botSettings: { pendingCexImport: admin.firestore.FieldValue.delete() } }, { merge: true })
      const encryptedApiKey = encryption.encrypt(storedKey, uid, masterSecret)
      const encryptedSecret = encryption.encrypt(input, uid, masterSecret)
      await userDoc.ref.set({
        agentSettings: { cexKeys: { [exchange]: { encryptedApiKey, encryptedSecret, maskedKey: '***' + storedKey.slice(-6) } } }
      }, { merge: true })
      await bot.sendMessage(chatId, `✅ *${exchange.toUpperCase()} API Key saved!*`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
      return
    }

    if (step === 'passphrase') {
      await userDoc.ref.set({ botSettings: { pendingCexImport: admin.firestore.FieldValue.delete() } }, { merge: true })
      const encryptedApiKey     = encryption.encrypt(storedKey, uid, masterSecret)
      const encryptedSecret     = encryption.encrypt(storedSecret, uid, masterSecret)
      const encryptedPassphrase = encryption.encrypt(input, uid, masterSecret)
      await userDoc.ref.set({
        agentSettings: { cexKeys: { kucoin: { encryptedApiKey, encryptedSecret, encryptedPassphrase, maskedKey: '***' + storedKey.slice(-6) } } }
      }, { merge: true })
      await bot.sendMessage(chatId, `✅ *KuCoin API Key saved!*`, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
      return
    }
  }

  try {
    switch (command) {

      case '/start':
      case '/help':
        await reply(
          '🤖 *FXcrypt Bot*\n\n' +
          'Use the menu below or these commands:\n\n' +
          '*💱 Trading*\n' +
          '`/buy <chain> <addr> <amount>` — buy a token\n' +
          '`/sell <chain> <addr> <percent>` — sell holdings\n' +
          '`/snipe <chain> <addr> <amount>` — add snipe target\n' +
          '`/price <chain> <addr>` — token price & info\n\n' +
          '*💎 Gem Scanner*\n' +
          '`/gems [chain]` — scan for gem tokens\n' +
          '`/gemon` / `/gemoff` — gem alerts on/off\n' +
          '`/gemautobuy on|off` — auto-buy gems\n\n' +
          '*🤖 AI Agent*\n' +
          '`/agent on|off|scan|status` — AI trading agent\n\n' +
          '*🔧 Management*\n' +
          '`/wallet` — wallet management\n' +
          '`/balance` — wallet balances\n' +
          '`/history` — recent trade history\n' +
          '`/settings` — configure bot settings\n' +
          '`/profile` — view your profile\n' +
          '`/status` — bot status\n\n' +
          '_Chains: bsc, eth, sol, base  |  TON: balance only_',
          { reply_markup: mainMenuKeyboard() }
        )
        break

      case '/status': {
        const on       = settings.botEnabled ? '🟢 Running' : '🔴 Stopped'
        const snipSnap = await db.collection(`users/${uid}/snipeTargets`)
          .where('status', '==', 'pending').get()

        const walletLine = (chain) => {
          const w = wallets[chain]
          return w?.address ? `✅ \`${w.address.slice(0, 8)}...\`` : '❌ Not set'
        }

        await reply(
          `📊 *Bot Status*\n\n` +
          `Status: ${on}\n` +
          `Active Snipes: ${snipSnap.size}\n\n` +
          `BSC: ${walletLine('bsc')}\n` +
          `ETH: ${walletLine('eth')}\n` +
          `SOL: ${walletLine('sol')}\n` +
          `BASE: ${walletLine('base')}\n` +
          `TON: ${walletLine('ton')}\n`
        )
        break
      }

      case '/boton':
        await userDoc.ref.set({ botSettings: { botEnabled: true } }, { merge: true })
        await reply('🟢 Sniper bot *enabled*.')
        break

      case '/botoff':
        await userDoc.ref.set({ botSettings: { botEnabled: false } }, { merge: true })
        await reply('🔴 Sniper bot *disabled*.')
        break

      case '/balance': {
        const allBalChains = [
          { key: 'bsc',  ticker: 'BNB', fetch: wallets.bsc?.address  ? () => trader.getEVMBalance(wallets.bsc.address,  'bsc',  settings.bscRpc)  : null },
          { key: 'eth',  ticker: 'ETH', fetch: wallets.eth?.address  ? () => trader.getEVMBalance(wallets.eth.address,  'eth',  settings.ethRpc)  : null },
          { key: 'sol',  ticker: 'SOL', fetch: wallets.sol?.address  ? () => trader.getSOLBalance(wallets.sol.address,  settings.solRpc)           : null },
          { key: 'base', ticker: 'ETH', fetch: wallets.base?.address ? () => trader.getEVMBalance(wallets.base.address, 'base', settings.baseRpc) : null },
          { key: 'ton',  ticker: 'TON', fetch: wallets.ton?.address  ? () => trader.getTONBalance(wallets.ton.address)                            : null },
        ]

        const configured = allBalChains.filter(c => c.fetch)
        if (!configured.length) { await reply('💰 *Wallet Balances*\n\n_No wallets configured._'); break }

        const results = await Promise.allSettled(configured.map(c => c.fetch()))

        let out = '💰 *Wallet Balances*\n\n'
        configured.forEach((c, i) => {
          const r = results[i]
          out += r.status === 'fulfilled'
            ? `*${c.key.toUpperCase()}:* ${r.value.native} ${c.ticker}\n`
            : `*${c.key.toUpperCase()}:* ⚠️ unavailable\n`
        })
        await reply(out)
        break
      }

      case '/buy': {
        if (parts.length < 4) { await reply('⚠️ Usage: `/buy <chain> <address> <amount>`'); break }
        const [, chain, addr, amtStr] = parts

        if (!VALID_CHAINS.has(chain)) { await reply('⚠️ Chain must be: bsc, eth, sol, or base'); break }
        if (chain === 'ton') { await reply('⚠️ TON trading is not yet supported. Use BSC, ETH, SOL, or BASE.'); break }
        if (!wallets[chain]?.encryptedKey) { await reply(`⚠️ No ${chain.toUpperCase()} wallet set. Configure it in the app.`); break }

        const amount = safeParseFloat(amtStr)
        if (!amount) { await reply('⚠️ Amount must be a positive number.'); break }

        await reply(`⏳ Buying on ${chain.toUpperCase()}...`)
        const pk     = encryption.decrypt(wallets[chain].encryptedKey, uid, masterSecret)
        const slip   = Math.min(settings.defaultSlippage || 5, 50)
        const gasX   = settings.defaultGasMultiplier || 1.2
        const result = chain === 'sol'
          ? await trader.buyTokenSOL(pk, addr, amount, slip, settings.solRpc)
          : await trader.buyTokenEVM(chain, pk, addr, amount, slip, settings[chain + 'Rpc'], gasX)

        await db.collection(`users/${uid}/trades`).add({
          chain, tokenAddress: addr, type: 'buy', amountIn: String(amount),
          txHash: result.txHash, status: result.status, source: 'telegram',
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        })

        await reply(
          `✅ *Buy Executed!*\n\nChain: ${chain.toUpperCase()}\nAmount: ${amount} ${nativeTicker(chain)}\n` +
          `Status: \`${result.status}\`\n[View TX](${explorerUrl(chain, result.txHash)})`,
          { disable_web_page_preview: true }
        )
        break
      }

      case '/sell': {
        if (parts.length < 4) { await reply('⚠️ Usage: `/sell <chain> <address> <percent>`'); break }
        const [, chain, addr, pctStr] = parts

        if (!VALID_CHAINS.has(chain)) { await reply('⚠️ Chain must be: bsc, eth, sol, or base'); break }
        if (chain === 'ton') { await reply('⚠️ TON trading is not yet supported. Use BSC, ETH, SOL, or BASE.'); break }
        if (!wallets[chain]?.encryptedKey) { await reply(`⚠️ No ${chain.toUpperCase()} wallet set.`); break }

        const pct = safeParsePercent(pctStr)
        if (!pct) { await reply('⚠️ Percent must be a whole number between 1 and 100.'); break }

        await reply(`⏳ Selling ${pct}% on ${chain.toUpperCase()}...`)
        const pk     = encryption.decrypt(wallets[chain].encryptedKey, uid, masterSecret)
        const slip   = Math.min(settings.defaultSlippage || 5, 50)
        const gasX   = settings.defaultGasMultiplier || 1.2
        const result = chain === 'sol'
          ? await trader.sellTokenSOL(pk, addr, pct, slip, settings.solRpc)
          : await trader.sellTokenEVM(chain, pk, addr, pct, slip, settings[chain + 'Rpc'], gasX)

        await db.collection(`users/${uid}/trades`).add({
          chain, tokenAddress: addr, type: 'sell', percentSold: pct,
          txHash: result.txHash, status: result.status, source: 'telegram',
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        })

        await reply(
          `✅ *Sell Executed!*\n\nChain: ${chain.toUpperCase()}\nSold: ${pct}%\n` +
          `Status: \`${result.status}\`\n[View TX](${explorerUrl(chain, result.txHash)})`,
          { disable_web_page_preview: true }
        )
        break
      }

      case '/snipe': {
        if (parts.length < 4) { await reply('⚠️ Usage: `/snipe <chain> <address> <amount> [maxPrice]`'); break }
        const [, chain, addr, amtStr, maxPriceStr] = parts

        if (!VALID_CHAINS.has(chain)) { await reply('⚠️ Chain must be: bsc, eth, sol, or base'); break }
        if (chain === 'ton') { await reply('⚠️ TON sniping is not yet supported. Use BSC, ETH, SOL, or BASE.'); break }
        if (!wallets[chain]?.encryptedKey) { await reply(`⚠️ No ${chain.toUpperCase()} wallet set.`); break }

        const amount   = safeParseFloat(amtStr)
        if (!amount) { await reply('⚠️ Amount must be a positive number.'); break }

        const maxPrice = maxPriceStr ? safeParseFloat(maxPriceStr) : null

        const ref = await db.collection(`users/${uid}/snipeTargets`).add({
          chain, tokenAddress: addr, buyAmount: String(amount),
          maxBuyPrice: maxPrice,
          slippage: Math.min(settings.defaultSlippage || 5, 50),
          status: 'pending', txHash: null, source: 'telegram',
          addedAt: admin.firestore.FieldValue.serverTimestamp(), executedAt: null
        })

        await reply(
          `🎯 *Snipe Added!*\n\n` +
          `ID: \`${ref.id.slice(0, 8)}\`\n` +
          `Chain: ${chain.toUpperCase()}\nToken: \`${addr.slice(0, 12)}...\`\n` +
          `Amount: ${amount}\n${maxPrice ? `Max Price: $${maxPrice}` : 'Max Price: Any'}\n\n` +
          `_Enable the bot with /boton if not already active._`
        )
        break
      }

      case '/snipes': {
        const snaps = await db.collection(`users/${uid}/snipeTargets`)
          .where('status', '==', 'pending')
          .orderBy('addedAt', 'desc').limit(10).get()

        if (snaps.empty) { await reply('📭 No active snipe targets.'); break }

        let out = '🎯 *Active Snipes*\n\n'
        snaps.docs.forEach((d, i) => {
          const s = d.data()
          out += `${i + 1}. \`${d.id.slice(0, 8)}\` | ${s.chain.toUpperCase()} | ${s.buyAmount}\n`
          out += `   \`${s.tokenAddress.slice(0, 14)}...\`\n`
        })
        await reply(out)
        break
      }

      case '/cancelsnipe': {
        if (parts.length < 2) { await reply('⚠️ Usage: `/cancelsnipe <id>`'); break }
        const shortId = parts[1].slice(0, 20) // bound input length
        const all     = await db.collection(`users/${uid}/snipeTargets`).get()
        const match   = all.docs.find(d => d.id.startsWith(shortId))
        if (!match) { await reply('❌ Snipe target not found.'); break }
        await match.ref.update({ status: 'cancelled' })
        await reply(`✅ Snipe \`${shortId}\` cancelled.`)
        break
      }

      case '/history': {
        const trades = await db.collection(`users/${uid}/trades`)
          .orderBy('timestamp', 'desc').limit(5).get()

        if (trades.empty) { await reply('📭 No trades yet.'); break }

        let out = '📜 *Recent Trades*\n\n'
        trades.docs.forEach(d => {
          const t    = d.data()
          const icon = t.type === 'buy' ? '🟢' : '🔴'
          const date = t.timestamp?.toDate?.()?.toLocaleDateString('en-GB') || 'N/A'
          out += `${icon} ${t.type.toUpperCase()} | ${t.chain.toUpperCase()} | ${date}\n`
          if (t.txHash) out += `\`${t.txHash.slice(0, 14)}...\`\n`
          out += '\n'
        })
        await reply(out)
        break
      }

      case '/price': {
        if (parts.length < 3) { await reply('⚠️ Usage: `/price <chain> <address>`'); break }
        const [, chain, addr] = parts
        if (!VALID_CHAINS.has(chain)) { await reply('⚠️ Chain must be: bsc, eth, sol, base, or ton'); break }
        const info = await trader.checkToken(addr, chain)
        if (!info.found) { await reply(`❌ ${info.reason}`); break }
        await reply(
          `💰 *Token Info*\n\n` +
          `Name: \`${info.name}\` (${info.symbol})\n` +
          `Price: $${parseFloat(info.price).toFixed(8)}\n` +
          `Liquidity: $${(info.liquidity || 0).toLocaleString('en-US')}\n` +
          `Volume 24h: $${(info.volume24h || 0).toLocaleString('en-US')}\n`
        )
        break
      }

      case '/gems': {
        const gemChains = parts[1]
          ? (VALID_CHAINS.has(parts[1]) ? [parts[1]] : ['bsc', 'sol'])
          : ['bsc', 'sol']

        await reply('💎 Scanning for gems...')

        const gems = await gemscanner.discoverGems(gemChains, {
          minLiquidity: settings.gemMinLiquidity || 5000,
          maxAgeHours:  settings.gemMaxAge       || 24,
          minScore:     settings.gemMinScore     || 40,
        })

        if (!gems.length) {
          await reply('📭 No gems found matching your filters right now. Try again later.')
          break
        }

        // Send top 5 as alerts
        const sentCount = await gemscanner.sendGemAlerts(
          gems.slice(0, 5), settings, bot, chatId, db, uid
        )

        await reply(`✅ Found ${gems.length} gems, sent ${sentCount} new alert(s).`)
        break
      }

      case '/gemon':
        await userDoc.ref.set({ botSettings: { gemAutoEnabled: true } }, { merge: true })
        await reply('💎 Gem Scanner alerts *enabled*. You\'ll receive alerts every 5 minutes.')
        break

      case '/gemoff':
        await userDoc.ref.set({ botSettings: { gemAutoEnabled: false } }, { merge: true })
        await reply('💎 Gem Scanner alerts *disabled*.')
        break

      case '/gemautobuy': {
        const mode = (parts[1] || '').toLowerCase()
        if (mode === 'on') {
          await userDoc.ref.set({ botSettings: { gemAutoBuy: true } }, { merge: true })
          await reply('🤖 Gem auto-buy *enabled*. High-score gems will be bought automatically.')
        } else if (mode === 'off') {
          await userDoc.ref.set({ botSettings: { gemAutoBuy: false } }, { merge: true })
          await reply('🤖 Gem auto-buy *disabled*.')
        } else {
          await reply('⚠️ Usage: `/gemautobuy on` or `/gemautobuy off`')
        }
        break
      }

      case '/agenton':
        await userDoc.ref.set({ agentSettings: { enabled: true } }, { merge: true })
        await reply('🤖 Trading Agent *enabled*. Scanning markets every 15 minutes.')
        break

      case '/agentoff':
        await userDoc.ref.set({ agentSettings: { enabled: false } }, { merge: true })
        await reply('🤖 Trading Agent *disabled*.')
        break

      case '/agent': {
        const agentSub = (parts[1] || '').toLowerCase()
        if (agentSub === 'on') {
          await userDoc.ref.set({ agentSettings: { enabled: true } }, { merge: true })
          await reply('🤖 Trading Agent *enabled*.')
        } else if (agentSub === 'off') {
          await userDoc.ref.set({ agentSettings: { enabled: false } }, { merge: true })
          await reply('🤖 Trading Agent *disabled*.')
        } else if (agentSub === 'status') {
          const ag = userDoc.data().agentSettings || {}
          const on = ag.enabled ? '🟢 Running' : '🔴 Stopped'
          const lastScan = ag.lastScanAt ? new Date(ag.lastScanAt).toLocaleString() : 'Never'
          const keys = ag.cexKeys || {}
          const keyList = ['binance', 'mexc', 'bybit', 'kucoin']
            .map(e => `${e.toUpperCase()}: ${keys[e] ? `✅ ${keys[e].maskedKey}` : '❌ Not set'}`)
            .join('\n')
          await reply(
            `🤖 *Trading Agent Status*\n\n` +
            `Status: ${on}\n` +
            `Last scan: ${lastScan}\n` +
            `Signals today: ${ag.lastScanSignals ?? 0}\n` +
            `Auto-execute: ${ag.autoExecute ? '✅' : '❌'}\n\n` +
            `*CEX API Keys:*\n${keyList}`
          )
        } else if (agentSub === 'scan') {
          await reply('🔍 Running market scan...')
          try {
            const agentSet   = userDoc.data().agentSettings || {}
            const exchanges  = agentSet.exchanges  || ['binance', 'mexc', 'bybit', 'kucoin']
            const timeframe  = agentSet.timeframe  || '4H'
            const minConf    = agentSet.minConfidence || 70
            const marketTypes = agentSet.marketTypes || ['spot']

            const allAnalyses = []
            // Spot scan — limit to 2 exchanges for Telegram-triggered scans
            if (marketTypes.includes('spot')) {
              for (const ex of exchanges.slice(0, 2)) {
                try {
                  const r = await marketAnalyzer.scanExchange(ex, timeframe, 20, minConf)
                  allAnalyses.push(...r)
                } catch (_) {}
              }
            }
            // Futures scan — limit to 2 futures-capable exchanges
            if (marketTypes.includes('futures')) {
              const futuresMinScore = Math.max(65, minConf - 5)
              const futuresExchanges = ['binance', 'bybit', 'mexc'].filter(e => exchanges.includes(e)).slice(0, 2)
              for (const ex of futuresExchanges) {
                try {
                  const r = await marketAnalyzer.scanFuturesExchange(ex, timeframe, 15, futuresMinScore)
                  allAnalyses.push(...r)
                } catch (_) {}
              }
            }

            const symbolMap = {}
            for (const a of allAnalyses) {
              const key = `${a.symbol}_${a.bias}_${a.marketType || 'spot'}`
              if (!symbolMap[key] || a.score > symbolMap[key].score) symbolMap[key] = a
            }

            const newSignals = []
            for (const analysis of Object.values(symbolMap).slice(0, 5)) {
              const signal = signalGen.generateSignal(analysis, exchanges)
              if (!signal) continue
              const ref = await db.collection(`users/${uid}/signals`).add(signal)
              newSignals.push({ id: ref.id, ...signal })
            }

            if (!newSignals.length) { await reply('📭 No high-confidence signals found right now. Markets may be ranging.'); break }

            for (const sig of newSignals.slice(0, 3)) {
              const { text, keyboard } = signalGen.formatTelegramSignalWithButtons(sig, sig.id)
              await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {})
              await new Promise(r => setTimeout(r, 500))
            }
          } catch (err) {
            await reply(`❌ Scan failed: ${err.message}`)
          }
        } else {
          await reply(
            `🤖 *Trading Agent Commands*\n\n` +
            `/agent on — enable agent\n` +
            `/agent off — disable agent\n` +
            `/agent status — agent overview\n` +
            `/agent scan — run manual scan now\n` +
            `/signals — view recent signals\n` +
            `/agenton — quick enable\n` +
            `/agentoff — quick disable`
          )
        }
        break
      }

      case '/wallet': {
        const walletSub = (parts[1] || '').toLowerCase()

        if (!walletSub || walletSub === 'help') {
          await reply(
            `🔑 *Wallet Commands*\n\n` +
            `/wallet list — show all configured wallets\n` +
            `/wallet create <chain> — generate a brand-new wallet\n` +
            `/wallet import <chain> <privateKey> — import from private key\n` +
            `/wallet import <chain> word1 word2 … word12 — import from seed phrase\n` +
            `/wallet set ton <address> — link a TON address for balance display\n` +
            `/wallet remove <chain> — disconnect & delete a wallet\n\n` +
            `_Chains: bsc  eth  sol  base_\n` +
            `_TON: address-only (key management via FXcrypt app → Wallet)_\n\n` +
            `⚠️ Use a *dedicated trading wallet* — never your main wallet.`
          )
          break
        }

        if (walletSub === 'list') {
          const lines = ['bsc', 'eth', 'sol', 'base', 'ton'].map(chain => {
            const w = wallets[chain]
            return w?.address
              ? `*${chain.toUpperCase()}:* ✅ \`${w.address}\``
              : `*${chain.toUpperCase()}:* ❌ Not set`
          })
          await reply(`🔑 *Configured Wallets*\n\n${lines.join('\n')}`)
          break
        }

        if (walletSub === 'set') {
          const chain = (parts[2] || '').toLowerCase()
          if (chain !== 'ton') { await reply('⚠️ `/wallet set` is only supported for TON. Use `/wallet create` for other chains.'); break }
          const addr = parts.slice(3).join('').trim()
          if (!addr) {
            await reply('⚠️ Usage: `/wallet set ton <address>`\n\nExample: `/wallet set ton EQD...`')
            break
          }
          const validTon = /^[A-Za-z0-9_+/=\-]{48}$/.test(addr) || /^0:[0-9a-fA-F]{64}$/.test(addr)
          if (!validTon) { await reply('❌ Invalid TON address format. Expected `EQ...`/`UQ...` (48 chars) or `0:hex64`.'); break }
          await userDoc.ref.set(
            { botSettings: { wallets: { ton: { address: addr } } } },
            { merge: true }
          )
          await reply(`✅ *TON Address Linked!*\n\n\`${addr}\`\n\nTON balance will now show in the dashboard.`)
          break
        }

        if (walletSub === 'create') {
          const chain = (parts[2] || '').toLowerCase()
          if (chain === 'ton') {
            await reply(
              'ℹ️ *TON Wallet Setup*\n\n' +
              'Create your TON wallet in the FXcrypt app → Wallet page, then link your address here:\n\n' +
              '`/wallet set ton <your_TON_address>`',
              { reply_markup: { inline_keyboard: [[{ text: '➕ Add TON Address', callback_data: 'wallet_set_ton' }]] } }
            )
            break
          }
          if (!VALID_CHAINS.has(chain)) { await reply('⚠️ Chain must be: bsc, eth, sol, or base'); break }

          let address, privateKey, mnemonic

          if (chain === 'sol') {
            const { Keypair } = require('@solana/web3.js')
            const bs58 = require('bs58')
            const kp   = Keypair.generate()
            address    = kp.publicKey.toBase58()
            privateKey = bs58.encode(kp.secretKey)
            // Solana has no standard mnemonic from raw Keypair; private key is the backup
          } else {
            const { ethers } = require('ethers')
            const wallet = ethers.Wallet.createRandom()
            address    = wallet.address
            privateKey = wallet.privateKey
            mnemonic   = wallet.mnemonic?.phrase || null
          }

          const encryptedKey = encryption.encrypt(privateKey, uid, masterSecret)
          await userDoc.ref.set(
            { botSettings: { wallets: { [chain]: { address, encryptedKey } } } },
            { merge: true }
          )

          const mnemonicLine = mnemonic
            ? `\n🔐 *Seed Phrase (12 words — also save this):*\n\`${mnemonic}\`\n`
            : ''

          await reply(
            `✅ *New ${chain.toUpperCase()} Wallet Created & Saved!*\n\n` +
            `Address:\n\`${address}\`\n\n` +
            `🔑 *Private Key — shown once, save now:*\n\`${privateKey}\`\n` +
            mnemonicLine +
            `\n⚠️ *Delete this message after saving. Never share your keys.*`
          )
          break
        }

        if (walletSub === 'import') {
          const chain     = (parts[2] || '').toLowerCase()
          // Collect everything after the chain as the key/phrase
          const remainder = parts.slice(3).join(' ').trim()

          if (chain === 'ton') {
            await reply(
              'ℹ️ *TON Import*\n\n' +
              'To link your TON address:\n\n' +
              '`/wallet set ton <your_TON_address>`\n\n' +
              'For full key management, use the FXcrypt app → Wallet page.',
              { reply_markup: { inline_keyboard: [[{ text: '➕ Add TON Address', callback_data: 'wallet_set_ton' }]] } }
            )
            break
          }
          if (!VALID_CHAINS.has(chain)) { await reply('⚠️ Chain must be: bsc, eth, sol, or base'); break }
          if (!remainder) {
            await reply(
              '⚠️ Usage:\n' +
              '`/wallet import <chain> <privateKey>`\n' +
              '`/wallet import <chain> word1 word2 … word12`'
            )
            break
          }

          // Auto-detect: 12+ space-separated tokens → seed phrase, otherwise private key
          const wordCount  = remainder.split(/\s+/).length
          const isMnemonic = wordCount >= 12

          let address, privateKey
          try {
            if (isMnemonic) {
              if (chain === 'sol') {
                const { pbkdf2 }  = require('@noble/hashes/pbkdf2')
                const { sha512 }  = require('@noble/hashes/sha512')
                const { hmac }    = require('@noble/hashes/hmac')
                const { Keypair } = require('@solana/web3.js')
                const bs58        = require('bs58')

                // BIP39: mnemonic → 64-byte seed (PBKDF2-HMAC-SHA512, 2048 rounds)
                const enc  = new TextEncoder()
                const seed = pbkdf2(sha512, enc.encode(remainder), enc.encode('mnemonic'), { c: 2048, dkLen: 64 })

                // SLIP-0010 ed25519 HD derivation: m/44'/501'/0'/0'
                const PATH = [0x8000002c, 0x800001f5, 0x80000000, 0x80000000]
                let node = hmac(sha512, Buffer.from('ed25519 seed'), seed)
                for (const idx of PATH) {
                  const data = new Uint8Array(37)
                  data[0] = 0x00
                  data.set(node.slice(0, 32), 1)
                  new DataView(data.buffer).setUint32(33, idx)
                  node = hmac(sha512, node.slice(32), data)
                }

                const kp   = Keypair.fromSeed(node.slice(0, 32))
                address    = kp.publicKey.toBase58()
                privateKey = bs58.encode(kp.secretKey)

              } else {
                // EVM: ethers v6 handles BIP39 → m/44'/60'/0'/0/0 derivation natively
                const { ethers } = require('ethers')
                const wallet = ethers.Wallet.fromPhrase(remainder)
                address    = wallet.address
                privateKey = wallet.privateKey
              }
            } else {
              // Single-token import → raw private key
              if (chain === 'sol') {
                const { Keypair } = require('@solana/web3.js')
                const bs58 = require('bs58')
                const kp   = Keypair.fromSecretKey(bs58.decode(remainder))
                address    = kp.publicKey.toBase58()
                privateKey = remainder
              } else {
                const { ethers } = require('ethers')
                const wallet = new ethers.Wallet(remainder)
                address    = wallet.address
                privateKey = remainder
              }
            }
          } catch (_) {
            await reply('❌ Invalid key or seed phrase. Double-check the input and try again.')
            break
          }

          const encryptedKey = encryption.encrypt(privateKey, uid, masterSecret)
          await userDoc.ref.set(
            { botSettings: { wallets: { [chain]: { address, encryptedKey } } } },
            { merge: true }
          )

          const method = isMnemonic ? 'Seed Phrase' : 'Private Key'
          await reply(
            `✅ *${chain.toUpperCase()} Wallet Imported!* _(via ${method})_\n\n` +
            `Address: \`${address}\`\n\n` +
            `⚠️ Please delete the message containing your key/phrase for security.`
          )
          break
        }

        if (walletSub === 'remove') {
          const chain = (parts[2] || '').toLowerCase()
          if (!VALID_CHAINS.has(chain)) { await reply('⚠️ Chain must be: bsc, eth, sol, base, or ton'); break }
          if (!wallets[chain]?.address) { await reply(`⚠️ No ${chain.toUpperCase()} wallet is set.`); break }

          await userDoc.ref.set(
            { botSettings: { wallets: { [chain]: admin.firestore.FieldValue.delete() } } },
            { merge: true }
          )
          await reply(`✅ ${chain.toUpperCase()} wallet removed.`)
          break
        }

        await reply('❓ Unknown subcommand. Send `/wallet` for help.')
        break
      }

      case '/profile': {
        const rootSnap = await db.doc(`users/${uid}`).get()
        const d        = rootSnap.data() || {}
        const joined   = d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-GB') : '—'
        await reply(
          `👤 *Your Profile*\n\n` +
          `Name: ${d.firstName || '—'} ${d.lastName || '—'}\n` +
          `Email: \`${d.email || '—'}\`\n` +
          `Phone: ${d.phone || '—'}\n` +
          `Member since: ${joined}`
        )
        break
      }

      case '/settings':
        await reply('⚙️ *Settings*\n\nChoose a category:', { reply_markup: settingsMenuKeyboard() })
        break

      default:
        if (text.startsWith('/')) await reply('❓ Unknown command. Send /help for a list.')
    }
  } catch (err) {
    console.error('Telegram command error:', err)
    // Use plain text here — a Markdown parse error is the most common failure mode
    // and calling reply() (which uses Markdown) would just fail again silently
    try {
      await bot.sendMessage(chatId, '❌ Something went wrong: ' + err.message)
    } catch (_) {}
  }
}

// ── Shared CEX trade executor (used by both direct and picker paths) ──────────
async function executeTgTrade(bot, db, admin, encryption, masterSecret, cexTrader, signalGen, chatId, uid, signalId, signal, agentSettings, keys, ex) {
  await bot.sendMessage(chatId, `⏳ Executing *${signal.symbol}* ${signal.bias?.toUpperCase()} on *${ex.toUpperCase()}*…`, { parse_mode: 'Markdown' }).catch(() => {})
  try {
    const apiKey     = encryption.decrypt(keys[ex].encryptedApiKey, uid, masterSecret)
    const secret     = encryption.decrypt(keys[ex].encryptedSecret, uid, masterSecret)
    const passphrase = keys[ex].encryptedPassphrase
      ? encryption.decrypt(keys[ex].encryptedPassphrase, uid, masterSecret) : ''

    const riskPct = agentSettings.riskPercent || 2
    let usdtBal   = 100
    try { const b = await cexTrader.getSpotBalance(ex, { apiKey, secret, passphrase }, 'USDT'); usdtBal = b.free } catch (_) {}

    const tradeAmt = usdtBal * (riskPct / 100)

    // placeOrderSafe validates symbol listing, min notional, and uses each
    // exchange's "buy by quote" endpoint so step-size precision never causes 400s
    const result = await cexTrader.placeOrderSafe(ex, { apiKey, secret, passphrase }, signal.symbol, tradeAmt, signal.currentPrice)

    await db.doc(`users/${uid}/signals/${signalId}`).update({
      status: 'executed', approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      executedAt: admin.firestore.FieldValue.serverTimestamp(), orderId: result.orderId,
      tradeUSDT: tradeAmt, executedOnExchange: ex,
    })
    await db.collection(`users/${uid}/cexTrades`).add({
      signalId, exchange: ex, symbol: signal.symbol, bias: signal.bias,
      orderId: result.orderId, tradeUSDT: tradeAmt, entryPrice: signal.entry,
      stopLoss: signal.stopLoss, tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3,
      riskReward: signal.riskReward, confidence: signal.confidence,
      source: 'telegram-approval', status: 'open', pnl: null,
      openedAt: admin.firestore.FieldValue.serverTimestamp(), closedAt: null,
    })

    await bot.sendMessage(chatId,
      `✅ *Trade Executed!*\n\n` +
      `Pair: *${signal.symbol}* ${signal.bias?.toUpperCase()}\n` +
      `Exchange: *${ex.toUpperCase()}*\n` +
      `USDT Value: ~$${tradeAmt.toFixed(2)}\n` +
      `Order ID: \`${result.orderId}\`\n\n` +
      `🛑 SL: $${signalGen.fmtPrice(signal.stopLoss)}\n` +
      `🎯 TP1: $${signalGen.fmtPrice(signal.tp1)}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {})
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Trade failed on ${ex.toUpperCase()}: ${err.message}`)
  }
}

module.exports = { createBot, handleUpdate }

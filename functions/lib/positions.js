// positions.js — position bookkeeping + automated exits (TP / SL / trailing / max-hold).
//
// Model (docs at users/{uid}/positions/{chain_tokenLc}):
//   status        'open' | 'closed'
//   qty           estimated token quantity held (from native spent ÷ entry price)
//   avgEntryUsd   average entry price (USD, volume-weighted)
//   spentNative   total native spent on buys (BNB/ETH/SOL)
//   realizedUsd   realized PnL booked on sells
//   exit          { tp, sl, trail, maxHoldHours, peakUsd, status, fails, nextTryAt }
//   exitArmed     flat bool mirror of "exit has active rules" — the collection-group
//                 query key for the monitor (map subfields can't be CG-indexed simply)
//
// Positions are written ONLY here (via the onTradeCreated trigger and the exit
// monitor). Clients read them and may edit exit/exitArmed — enforced by rules.
const axios = require('axios')

const DS_CID = { bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base', rhood: 'robinhood' }
const CG_NATIVE = { bsc: 'binancecoin', eth: 'ethereum', base: 'ethereum', sol: 'solana', rhood: 'ethereum' }
const NATIVE_SYM = { bsc: 'BNB', eth: 'ETH', base: 'ETH', sol: 'SOL', rhood: 'ETH' }
const EXPLORER = {
  bsc: (h) => `https://bscscan.com/tx/${h}`,
  eth: (h) => `https://etherscan.io/tx/${h}`,
  base: (h) => `https://basescan.org/tx/${h}`,
  sol: (h) => `https://solscan.io/tx/${h}`,
  rhood: (h) => `https://robinhoodchain.blockscout.com/tx/${h}`,
}

// Paper positions live in the SAME collection but under a `paper_` id prefix
// and a `paper: true` flag — same bookkeeping code path, impossible to collide
// with the real position for the same token.
const posId = (chain, addr, paper) => `${paper ? 'paper_' : ''}${chain}_${String(addr).toLowerCase()}`

// Best (highest-liquidity) DexScreener pair for one token → { priceUsd, symbol, name }.
async function tokenPrice(chain, address) {
  const cid = DS_CID[chain]
  if (!cid) return null
  try {
    const { data } = await axios.get(`https://api.dexscreener.com/tokens/v1/${cid}/${address}`, { timeout: 10000 })
    const pairs = (Array.isArray(data) ? data : []).filter((p) => p.baseToken?.address?.toLowerCase() === String(address).toLowerCase())
    if (!pairs.length) return null
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
    const p = pairs[0]
    return { priceUsd: parseFloat(p.priceUsd) || 0, symbol: p.baseToken.symbol || '', name: p.baseToken.name || '' }
  } catch (_) { return null }
}

// Batch prices for many tokens on one chain (30 per request) → { addrLc: priceUsd }.
async function batchPrices(chain, addresses) {
  const cid = DS_CID[chain]
  const out = {}
  if (!cid || !addresses.length) return out
  const best = {} // addrLc -> { liq, px }
  for (let i = 0; i < addresses.length; i += 30) {
    try {
      const { data } = await axios.get(`https://api.dexscreener.com/tokens/v1/${cid}/${addresses.slice(i, i + 30).join(',')}`, { timeout: 10000 })
      if (Array.isArray(data)) for (const p of data) {
        const a = p.baseToken?.address?.toLowerCase()
        if (!a) continue
        const liq = p.liquidity?.usd || 0
        if (!best[a] || liq > best[a].liq) best[a] = { liq, px: parseFloat(p.priceUsd) || 0 }
      }
    } catch (_) { /* tokens without pairs just get no price this tick */ }
  }
  for (const [a, v] of Object.entries(best)) out[a] = v.px
  return out
}

// USD price of a chain's native coin (for buy-quantity estimation).
async function nativeUsd(chain) {
  const id = CG_NATIVE[chain]
  if (!id) return 0
  try {
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, { timeout: 10000 })
    return data?.[id]?.usd || 0
  } catch (_) { return 0 }
}

// Normalize a client/gem-settings exit config into a rules map (or null if empty).
function normalizeExit(e) {
  if (!e || typeof e !== 'object') return null
  const f = (v, lo, hi) => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? Math.max(lo, Math.min(x, hi)) : null }
  const rules = {
    tp: f(e.tp, 1, 100000), sl: f(e.sl, 1, 99), trail: f(e.trail, 1, 99),
    maxHoldHours: f(e.maxHoldHours, 0.1, 24 * 365),
  }
  if (rules.tp == null && rules.sl == null && rules.trail == null && rules.maxHoldHours == null) return null
  return rules
}

// ── Bookkeeping: fold one trade doc into its position (called by the trigger) ──
async function applyTrade(db, uid, trade) {
  const t = trade || {}
  const chain = t.chain
  const addr = String(t.tokenAddress || '').trim()
  if (!DS_CID[chain] || !addr) return null            // arbitrage/CEX/unknown docs are not position events
  if (t.status === 'failed') return null
  if (t.type !== 'buy' && t.type !== 'sell') return null

  const paper = t.paper === true
  const ref = db.doc(`users/${uid}/positions/${posId(chain, addr, paper)}`)
  const tradeAt = t.timestamp?.toMillis?.() || Date.now()

  if (t.type === 'buy') {
    const amountIn = parseFloat(t.amountIn)
    if (!Number.isFinite(amountIn) || amountIn <= 0) return null
    // Entry snapshot: trade docs may carry entryPriceUsd (exit monitor / future
    // writers); otherwise price it now — the trigger runs seconds after the swap.
    let px = parseFloat(t.entryPriceUsd) || 0
    let sym = t.tokenSymbol || '', name = t.tokenName || ''
    if (!px) {
      const info = await tokenPrice(chain, addr)
      if (info) { px = info.priceUsd; sym = sym || info.symbol; name = name || info.name }
    }
    const natUsd = await nativeUsd(chain)
    const qtyBought = px > 0 && natUsd > 0 ? (amountIn * natUsd) / px : 0
    const exitRules = normalizeExit(t.exit)

    return db.runTransaction(async (txn) => {
      const snap = await txn.get(ref)
      const p = snap.exists && snap.data().status === 'open' ? snap.data() : null
      const qty = (p?.qty || 0) + qtyBought
      const avg = qty > 0 ? (((p?.qty || 0) * (p?.avgEntryUsd || 0)) + qtyBought * px) / qty : px
      const next = {
        chain, tokenAddress: addr, paper,
        tokenSymbol: sym || p?.tokenSymbol || '', tokenName: name || p?.tokenName || '',
        status: 'open',
        qty, avgEntryUsd: avg,
        spentNative: (p?.spentNative || 0) + amountIn,
        entries: (p?.entries || 0) + 1,
        realizedUsd: p?.realizedUsd || 0,
        openedAt: p?.openedAt || tradeAt,
        lastTradeAt: tradeAt,
        source: p?.source || t.source || 'manual',
        lastPriceUsd: px || p?.lastPriceUsd || 0,
      }
      // Arm exits from the trade (gem auto-buy defaults) without clobbering
      // rules the user already customized on an existing open position.
      if (exitRules && !(p && p.exitArmed)) {
        next.exit = { ...exitRules, peakUsd: px || 0, status: 'armed', fails: 0, nextTryAt: 0 }
        next.exitArmed = true
      } else if (p) {
        next.exit = p.exit || null
        next.exitArmed = !!p.exitArmed
      } else {
        next.exit = null
        next.exitArmed = false
      }
      txn.set(ref, next)
      return next
    })
  }

  // sell — reduce the position and book realized PnL
  const pct = Math.min(100, Math.max(0, parseFloat(t.percentSold) || 0))
  if (pct <= 0) return null
  let exitPx = parseFloat(t.exitPriceUsd) || 0
  if (!exitPx) { const info = await tokenPrice(chain, addr); exitPx = info?.priceUsd || 0 }

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists || snap.data().status !== 'open') return null   // sell of an untracked bag — nothing to book
    const p = snap.data()
    const soldQty = p.qty * (pct / 100)
    const realized = exitPx > 0 ? soldQty * (exitPx - (p.avgEntryUsd || 0)) : 0
    const remaining = p.qty - soldQty
    const closed = pct >= 99.5 || remaining <= p.qty * 0.001
    const patch = {
      qty: closed ? 0 : remaining,
      realizedUsd: (p.realizedUsd || 0) + realized,
      lastTradeAt: tradeAt,
      lastPriceUsd: exitPx || p.lastPriceUsd || 0,
      status: closed ? 'closed' : 'open',
    }
    if (closed) { patch.closedAt = tradeAt; patch.exitArmed = false; if (p.exit) patch.exit = { ...p.exit, status: p.exit.status === 'armed' ? 'done' : p.exit.status } }
    txn.set(ref, patch, { merge: true })
    return patch
  })
}

// Count today's automated trades (auto-buys + automated exits) for the daily cap.
async function autoTradesToday(db, uid) {
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
  const som = startOfDay.getTime()
  try {
    const snap = await db.collection(`users/${uid}/trades`).orderBy('timestamp', 'desc').limit(80).get()
    return snap.docs.filter((d) => {
      const x = d.data()
      if (x.paper === true) return false // simulated trades never consume the real cap
      const ts = x.timestamp?.toMillis?.() || 0
      const auto = x.source === 'gem-auto' || String(x.source || '').startsWith('exit-')
      return auto && ts >= som
    }).length
  } catch (_) { return 0 }
}

// Which rule (if any) fires at this price. Priority: SL → trailing → TP → time.
function evalExit(p, priceUsd, now) {
  const e = p.exit || {}
  const entry = p.avgEntryUsd || 0
  if (!entry || !priceUsd) {
    // No price this tick — only the clock can still fire.
    if (e.maxHoldHours && now - (p.openedAt || now) >= e.maxHoldHours * 3600000) return 'exit-time'
    return null
  }
  if (e.sl && priceUsd <= entry * (1 - e.sl / 100)) return 'exit-sl'
  const peak = Math.max(e.peakUsd || 0, priceUsd)
  if (e.trail && peak > entry && priceUsd <= peak * (1 - e.trail / 100)) return 'exit-trail'
  if (e.tp && priceUsd >= entry * (1 + e.tp / 100)) return 'exit-tp'
  if (e.maxHoldHours && now - (p.openedAt || now) >= e.maxHoldHours * 3600000) return 'exit-time'
  return null
}

// ── The exit monitor (invoked by the processExitMonitor scheduler) ──────────
// deps: { db, admin, trader, encryption, masterSecret, tgToken, cfg, notify? }
async function runExitMonitor(deps) {
  const { db, admin, trader, encryption, masterSecret, tgToken, cfg } = deps
  const push = deps.notify || (async () => {}) // FCM push (category 'trades'), best-effort
  const now = Date.now()

  const snap = await db.collectionGroup('positions')
    .where('exitArmed', '==', true).limit(300).get()
  if (snap.empty) return { checked: 0, sold: 0 }

  // Admin kill-switch stops ALL automated exits.
  if (cfg.autoTrade.globalEnabled === false) return { checked: snap.size, sold: 0, killed: true }

  // Batch price fetch per chain.
  const byChain = {}
  for (const doc of snap.docs) { const p = doc.data(); (byChain[p.chain] = byChain[p.chain] || new Set()).add(String(p.tokenAddress).toLowerCase()) }
  const prices = {}
  for (const [chain, set] of Object.entries(byChain)) prices[chain] = await batchPrices(chain, [...set])

  // Per-user context cache (settings/flags/limits + daily-cap count).
  const userCtx = {}
  const getCtx = async (uid) => {
    if (userCtx[uid]) return userCtx[uid]
    const us = await db.doc(`users/${uid}`).get()
    const d = us.exists ? us.data() : {}
    const limits = d.userLimits || {}
    const dailyCap = (limits.dailyTradeCap != null ? limits.dailyTradeCap : cfg.autoTrade.defaultDailyTradeCap) || 0
    userCtx[uid] = {
      settings: d.botSettings || {},
      plan: ['free', 'pro', 'elite'].includes(d.plan) ? d.plan : 'free',
      autoOk: (d.featureFlags || {}).autoExecute !== false,
      dailyCap,
      autoToday: dailyCap > 0 ? await autoTradesToday(db, uid) : 0,
    }
    return userCtx[uid]
  }

  let sold = 0
  const bot = tgToken ? require('./telegram').createBot(tgToken) : null

  for (const doc of snap.docs) {
    const p = doc.data()
    const uid = doc.ref.parent.parent.id
    const addrLc = String(p.tokenAddress).toLowerCase()
    const priceUsd = (prices[p.chain] || {})[addrLc] || 0
    const e = p.exit || {}

    // Persist a new trailing peak even when nothing fires (must survive restarts).
    if (priceUsd > (e.peakUsd || 0)) {
      try { await doc.ref.set({ exit: { ...e, peakUsd: priceUsd } }, { merge: true }) } catch (_) {}
      e.peakUsd = priceUsd
    }

    if (e.nextTryAt && now < e.nextTryAt) continue    // backing off a failed attempt
    const reason = evalExit(p, priceUsd, now)
    if (!reason) continue

    // ── PAPER position: simulate the sell at the observed price. No wallet, no
    // key decryption, and none of the real-trade gates (kill-switch/flag/cap)
    // apply — it's a simulation, and free users get the full loop here.
    if (p.paper === true) {
      sold++
      await db.collection(`users/${uid}/trades`).add({
        chain: p.chain, tokenAddress: p.tokenAddress, tokenSymbol: p.tokenSymbol || null,
        type: 'sell', percentSold: 100, amountIn: null, paper: true,
        txHash: null, status: 'paper', source: reason,
        exitPriceUsd: priceUsd || null, entryPriceUsd: p.avgEntryUsd || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
      await doc.ref.set({ exit: { ...e, status: 'done', firedAt: now, firedReason: reason, firedPriceUsd: priceUsd }, exitArmed: false }, { merge: true })
      const pCtx = await getCtx(uid)
      const pLabel = { 'exit-tp': '🎯 Take-profit hit', 'exit-sl': '🛑 Stop-loss hit', 'exit-trail': '📉 Trailing stop hit', 'exit-time': '⏰ Max hold reached' }[reason]
      const pPnl = p.avgEntryUsd && priceUsd ? ((priceUsd / p.avgEntryUsd - 1) * 100).toFixed(1) : null
      if (bot && pCtx.settings.telegramChatId) {
        await bot.sendMessage(pCtx.settings.telegramChatId,
          `📝 PAPER · ${pLabel} — *${p.tokenSymbol || p.tokenAddress}* sold (simulated)${pPnl != null ? `\nPnL: ${pPnl >= 0 ? '+' : ''}${pPnl}%` : ''}`,
          { parse_mode: 'Markdown' }).catch(() => {})
      }
      await push(uid, { category: 'trades', title: `📝 PAPER · ${pLabel} — ${p.tokenSymbol || 'position'} sold`, body: pPnl != null ? `Simulated PnL: ${pPnl >= 0 ? '+' : ''}${pPnl}%` : 'Simulated exit', link: '/?goto=portfolio', tag: 'exit-' + doc.id })
      continue
    }

    const ctx = await getCtx(uid)
    // REAL automated exits are a paid feature (Free keeps them in paper mode).
    // Disarm with a clear status + one notification — never loop silently.
    if (ctx.plan === 'free') {
      await doc.ref.set({ exit: { ...e, status: 'plan-locked', lastError: 'Automated exits need Pro' }, exitArmed: false }, { merge: true }).catch(() => {})
      await push(uid, { category: 'trades', title: `🔒 Exit rule for ${p.tokenSymbol || 'a position'} needs Pro`, body: `Your ${reason.replace('exit-', '')} condition fired, but automated selling is a Pro feature. Sell manually in Portfolio or upgrade.`, link: '/?goto=portfolio', tag: 'planlock-' + doc.id })
      continue
    }
    if (!ctx.autoOk) continue
    if (ctx.dailyCap > 0 && ctx.autoToday >= ctx.dailyCap) continue
    // Unified EVM wallet: any saved EVM key signs on every EVM chain, so an
    // exit on a chain without its own wallet entry uses the shared EVM account
    // (matches how the position was opened by the auto-buy fallback).
    const EVM_EXIT_CHAINS = ['eth', 'bsc', 'base', 'rhood']
    const walletMap = ctx.settings.wallets || {}
    let wallet = walletMap[p.chain]
    if (!wallet?.encryptedKey && EVM_EXIT_CHAINS.includes(p.chain)) {
      const alt = EVM_EXIT_CHAINS.find((c) => walletMap[c]?.encryptedKey)
      if (alt) wallet = walletMap[alt]
    }
    const fail = async (msg) => {
      const fails = (e.fails || 0) + 1
      const dead = fails >= 3
      await doc.ref.set({ exit: { ...e, fails, nextTryAt: dead ? 0 : now + fails * 5 * 60000, status: dead ? 'failed' : 'armed', lastError: String(msg).slice(0, 300) }, ...(dead ? { exitArmed: false } : {}) }, { merge: true }).catch(() => {})
      if (dead) {
        if (bot && ctx.settings.telegramChatId) {
          await bot.sendMessage(ctx.settings.telegramChatId, `⚠️ *Exit failed for ${p.tokenSymbol || p.tokenAddress}*\nTried 3 times and gave up: ${msg}\nManage the position manually in the app.`, { parse_mode: 'Markdown' }).catch(() => {})
        }
        await push(uid, { category: 'trades', title: `⚠️ Exit failed — ${p.tokenSymbol || 'position'}`, body: `Gave up after 3 attempts: ${msg}. Manage it manually in Portfolio.`, link: '/?goto=portfolio', tag: 'exitfail-' + doc.id })
      }
    }
    if (!wallet?.encryptedKey) { await fail('No bot wallet configured for this chain'); continue }

    try {
      const pk = encryption.decrypt(wallet.encryptedKey, uid, masterSecret)
      const slip = Math.min(ctx.settings.gemBuySlippage || ctx.settings.defaultSlippage || 10, 50)
      const gasX = ctx.settings.defaultGasMultiplier || 1.2
      const result = p.chain === 'sol'
        ? await trader.sellTokenSOL(pk, p.tokenAddress, 100, slip, ctx.settings.solRpc, deps.heliusKey || null)
        : await trader.sellTokenEVM(p.chain, pk, p.tokenAddress, 100, slip, ctx.settings[p.chain + 'Rpc'], gasX)
      if (result.status === 'failed') { await fail('Swap transaction reverted'); continue }

      ctx.autoToday++
      sold++
      // The trade doc drives the position bookkeeping via the onTradeCreated
      // trigger (realized PnL, close). exitPriceUsd pins the exact trigger price.
      await db.collection(`users/${uid}/trades`).add({
        chain: p.chain, tokenAddress: p.tokenAddress, tokenSymbol: p.tokenSymbol || null,
        type: 'sell', percentSold: 100, amountIn: null,
        txHash: result.txHash, status: result.status, source: reason,
        exitPriceUsd: priceUsd || null, entryPriceUsd: p.avgEntryUsd || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
      await doc.ref.set({ exit: { ...e, status: 'done', firedAt: now, firedReason: reason, firedPriceUsd: priceUsd }, exitArmed: false }, { merge: true })

      const label = { 'exit-tp': '🎯 Take-profit hit', 'exit-sl': '🛑 Stop-loss hit', 'exit-trail': '📉 Trailing stop hit', 'exit-time': '⏰ Max hold reached' }[reason]
      const pnlPct = p.avgEntryUsd && priceUsd ? ((priceUsd / p.avgEntryUsd - 1) * 100).toFixed(1) : null
      if (bot && ctx.settings.telegramChatId) {
        const est = priceUsd && p.qty ? (p.qty * (priceUsd - p.avgEntryUsd)).toFixed(2) : null
        await bot.sendMessage(ctx.settings.telegramChatId,
          `${label} — *${p.tokenSymbol || p.tokenAddress}* sold\n\n` +
          (pnlPct != null ? `PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct}%${est != null ? ` (≈$${est})` : ''}\n` : '') +
          `Entry: $${(p.avgEntryUsd || 0).toPrecision(4)} → Exit: $${(priceUsd || 0).toPrecision(4)}\n` +
          `[View TX](${EXPLORER[p.chain] ? EXPLORER[p.chain](result.txHash) : result.txHash})`,
          { parse_mode: 'Markdown', disable_web_page_preview: true }).catch(() => {})
      }
      await push(uid, { category: 'trades', title: `${label} — ${p.tokenSymbol || 'position'} sold`, body: pnlPct != null ? `PnL ${pnlPct >= 0 ? '+' : ''}${pnlPct}% · entry $${(p.avgEntryUsd || 0).toPrecision(4)} → exit $${(priceUsd || 0).toPrecision(4)}` : 'Automated exit executed', link: '/?goto=portfolio', tag: 'exit-' + doc.id })
    } catch (err) {
      await fail(err.message || 'Sell failed')
    }
  }
  return { checked: snap.size, sold }
}

module.exports = { applyTrade, runExitMonitor, normalizeExit, evalExit, autoTradesToday, tokenPrice, batchPrices, posId, NATIVE_SYM }

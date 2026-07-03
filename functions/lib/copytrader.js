// copytrader.js — smart-money copy trading.
//
// Users follow wallets (users/{uid}/followedWallets). Every monitor tick we
// fetch each unique wallet's fresh DEX buys (Moralis for EVM, Helius for SOL),
// safety-check the token, record the buy in the server-only
// copyWallets/{chain_addr}/buys ledger (this also powers the leaderboard), and
// fan out to followers: an alert push always; an AUTO-COPY buy only through the
// exact same invariants as gem auto-buy (admin kill-switch, per-user
// autoExecute flag, daily cap, maxBuyUsd clamp, exit defaults armed) — plus
// Elite plan (or paper mode, which needs no wallet and moves no funds).
const axios = require('axios')
const { filterSafeTokens } = require('./safety')
const positions = require('./positions')

const EVM_CHAINS = { bsc: '0x38', eth: '0x1', base: '0x2105' }
const walletKey = (chain, addr) => `${chain}_${String(addr).toLowerCase()}`
const short = (a) => String(a).slice(0, 6) + '…' + String(a).slice(-4)

// ── Fresh buys for one wallet since `sinceMs` → [{ tx, tokenAddress, at }] ──
async function fetchRecentBuys(chain, address, sinceMs, keys) {
  try {
    if (chain === 'sol') {
      if (!keys.heliusKey) return []
      const { data } = await axios.get(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${keys.heliusKey}&type=SWAP&limit=15`, { timeout: 12000 })
      const out = []
      for (const tx of Array.isArray(data) ? data : []) {
        const at = (tx.timestamp || 0) * 1000
        if (at < sinceMs) continue
        // Token(s) the wallet RECEIVED in the swap = what it bought.
        const got = (tx.tokenTransfers || []).find((t) => t.toUserAccount === address && t.mint && t.mint !== 'So11111111111111111111111111111111111111112')
        if (got) out.push({ tx: tx.signature, tokenAddress: got.mint, at })
      }
      return out
    }
    if (!EVM_CHAINS[chain] || !keys.moralisKey) return []
    const { data } = await axios.get(
      `https://deep-index.moralis.io/api/v2.2/${address}/erc20/transfers?chain=${EVM_CHAINS[chain]}&limit=15&order=DESC`,
      { headers: { 'X-API-Key': keys.moralisKey }, timeout: 12000 })
    const out = []
    for (const tr of data?.result || []) {
      const at = new Date(tr.block_timestamp).getTime()
      if (at < sinceMs) continue
      // Incoming ERC20 transfer ≈ a buy/receive of that token.
      if (String(tr.to_address).toLowerCase() === String(address).toLowerCase() && tr.address) {
        out.push({ tx: tr.transaction_hash, tokenAddress: tr.address, at })
      }
    }
    return out
  } catch (e) { return [] }
}

// One-token safety verdict via the gem scanner's multi-layer filter.
async function safetyVerdict(chain, tokenAddress) {
  try {
    const res = await filterSafeTokens([{ address: tokenAddress, pair: {}, meta: {} }], chain)
    if (!res.length) return { safe: false, summary: 'Failed GoPlus/honeypot checks' }
    const s = res[0].safetyData || {}
    const bits = []
    if (s.gpChecked) bits.push('GoPlus ✓')
    if (s.hpChecked) bits.push('Honeypot ✓')
    if (s.rcChecked) bits.push('RugCheck ✓')
    return { safe: true, summary: bits.join(' · ') || 'Passed safety checks' }
  } catch (e) { return { safe: false, summary: 'Safety check unavailable' } }
}

// ── Monitor tick ────────────────────────────────────────────────────────────
// deps: { db, admin, trader, encryption, masterSecret, cfg, keys, notify }
async function runCopyMonitor(deps) {
  const { db, admin, trader, encryption, masterSecret, cfg, keys, notify } = deps
  const now = Date.now()

  const followsSnap = await db.collectionGroup('followedWallets').where('active', '==', true).limit(300).get()
  if (followsSnap.empty) return { wallets: 0, buys: 0 }

  // Group followers by unique wallet.
  const wallets = new Map() // key → { chain, address, followers: [{ uid, follow }] }
  for (const doc of followsSnap.docs) {
    const f = doc.data()
    if (!f.chain || !f.address) continue
    const key = walletKey(f.chain, f.address)
    if (!wallets.has(key)) wallets.set(key, { chain: f.chain, address: f.address, followers: [] })
    wallets.get(key).followers.push({ uid: doc.ref.parent.parent.id, follow: f, ref: doc.ref })
  }

  // Per-user context cache (plan/settings/flags/caps), built lazily.
  const userCtx = {}
  const getCtx = async (uid) => {
    if (userCtx[uid]) return userCtx[uid]
    const us = await db.doc(`users/${uid}`).get()
    const d = us.exists ? us.data() : {}
    const limits = d.userLimits || {}
    userCtx[uid] = {
      d, plan: ['free', 'pro', 'elite'].includes(d.plan) ? d.plan : 'free',
      settings: d.botSettings || {},
      paper: d.paperMode === true,
      autoOk: (d.featureFlags || {}).autoExecute !== false,
      dailyCap: (limits.dailyTradeCap != null ? limits.dailyTradeCap : cfg.autoTrade.defaultDailyTradeCap) || 0,
      maxBuyUsd: (limits.maxBuyUsd != null ? limits.maxBuyUsd : cfg.autoTrade.defaultMaxBuyUsd) || 0,
      autoToday: null, // filled on first auto-copy attempt
    }
    return userCtx[uid]
  }

  let totalBuys = 0
  for (const [key, w] of wallets) {
    const stateRef = db.doc(`copyWallets/${key}`)
    const stateSnap = await stateRef.get()
    const state = stateSnap.exists ? stateSnap.data() : { seen: {} }
    const since = Math.max(state.lastCheckedAt || 0, now - 30 * 60000)

    const buys = (await fetchRecentBuys(w.chain, w.address, since, keys))
      .filter((b) => !(state.seen || {})[b.tx]).slice(0, 3)
    // Persist the checkpoint even when nothing new — keeps the window tight.
    const seen = { ...(state.seen || {}) }
    for (const b of buys) seen[b.tx] = b.at
    const seenKeys = Object.keys(seen).sort((a, b) => seen[b] - seen[a]).slice(0, 60)
    await stateRef.set({ chain: w.chain, address: w.address, lastCheckedAt: now, seen: Object.fromEntries(seenKeys.map((k) => [k, seen[k]])) }, { merge: false }).catch(() => {})
    if (!buys.length) continue

    for (const buy of buys) {
      const info = await positions.tokenPrice(w.chain, buy.tokenAddress)
      if (!info || !info.priceUsd) continue // dust/no market — not a copyable buy
      const verdict = await safetyVerdict(w.chain, buy.tokenAddress)
      totalBuys++
      await stateRef.collection('buys').doc(buy.tx.slice(0, 60)).set({
        tokenAddress: buy.tokenAddress, sym: info.symbol || '', name: info.name || '',
        priceAtDetection: info.priceUsd, at: buy.at, safe: verdict.safe, safetySummary: verdict.summary,
      }).catch(() => {})

      for (const { uid, follow } of w.followers) {
        const label = follow.label || short(w.address)
        // Alert always (their own followed wallet moved).
        await notify(uid, {
          category: 'copy',
          title: `👁 ${label} bought ${info.symbol || 'a token'}`,
          body: `${verdict.safe ? '✅ ' + verdict.summary : '⚠️ ' + verdict.summary} · $${info.priceUsd}`,
          link: '/?goto=copytrade', tag: 'copy-' + buy.tx.slice(0, 20),
        })

        // AUTO-COPY — same invariants as gem auto-buy, plus Elite (or paper).
        if (!follow.copyEnabled) continue
        if (!verdict.safe) continue
        const ctx = await getCtx(uid)
        if (!ctx.paper && ctx.plan !== 'elite') continue           // flagship gate
        if (cfg.autoTrade.globalEnabled === false) continue        // admin kill-switch
        if (!ctx.autoOk) continue                                  // per-user flag
        if (ctx.dailyCap > 0) {
          if (ctx.autoToday == null) ctx.autoToday = await positions.autoTradesToday(db, uid)
          if (ctx.autoToday >= ctx.dailyCap) continue
        }
        const s = ctx.settings
        let amt = w.chain === 'bsc' ? (s.gemBuyAmountBsc || 0.005)
          : (w.chain === 'eth' || w.chain === 'base') ? (s.gemBuyAmountEth || 0.01)
          : (s.gemBuyAmountSol || 0.05)
        const natPx = deps.nativePx[w.chain] || 0
        if (ctx.maxBuyUsd > 0 && natPx > 0 && amt * natPx > ctx.maxBuyUsd) amt = +(ctx.maxBuyUsd / natPx).toFixed(6)
        const exitDefaults = positions.normalizeExit({ tp: s.gemExitTp, sl: s.gemExitSl, trail: s.gemExitTrail, maxHoldHours: s.gemExitMaxHold })
        const source = 'copy:' + short(w.address)

        try {
          if (ctx.paper) {
            await db.collection(`users/${uid}/trades`).add({
              chain: w.chain, tokenAddress: buy.tokenAddress, tokenSymbol: info.symbol || null, tokenName: info.name || null,
              type: 'buy', amountIn: String(amt), paper: true, txHash: null, status: 'paper',
              source, entryPriceUsd: info.priceUsd, exit: exitDefaults,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
            })
            await notify(uid, { category: 'copy', title: `📝 PAPER · Copied ${label}: bought ${info.symbol}`, body: `Simulated ${amt} native @ $${info.priceUsd} · exits armed`, link: '/?goto=portfolio', tag: 'copybuy-' + buy.tx.slice(0, 20) })
          } else {
            if (w.chain === 'sol') continue // SOL auto-buy unsupported server-side (same as gem bot) — alert only
            const wal = (s.wallets || {})[w.chain]
            if (!wal?.encryptedKey) continue
            const pk = encryption.decrypt(wal.encryptedKey, uid, masterSecret)
            const slip = Math.min(s.gemBuySlippage || s.defaultSlippage || 10, 50)
            const result = await trader.buyTokenEVM(w.chain, pk, buy.tokenAddress, amt, slip, s[w.chain + 'Rpc'], s.defaultGasMultiplier || 1.2)
            if (result.status === 'failed') continue
            await db.collection(`users/${uid}/trades`).add({
              chain: w.chain, tokenAddress: buy.tokenAddress, tokenSymbol: info.symbol || null, tokenName: info.name || null,
              type: 'buy', amountIn: String(amt), txHash: result.txHash, status: result.status,
              source, entryPriceUsd: info.priceUsd, exit: exitDefaults,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
            })
            ctx.autoToday = (ctx.autoToday == null ? 0 : ctx.autoToday) + 1
            await notify(uid, { category: 'copy', title: `🤖 Copied ${label}: bought ${info.symbol}`, body: `${amt} native @ $${info.priceUsd} · exits armed`, link: '/?goto=portfolio', tag: 'copybuy-' + buy.tx.slice(0, 20) })
          }
        } catch (e) {
          await notify(uid, { category: 'copy', title: `⚠️ Copy-buy failed — ${info.symbol}`, body: String(e.message).slice(0, 120), link: '/?goto=copytrade', tag: 'copyfail-' + buy.tx.slice(0, 20) })
        }
      }
    }
  }
  return { wallets: wallets.size, buys: totalBuys }
}

// ── Leaderboard: rank a user's followed wallets by how their detected buys
// performed (avg % from detection price to now, win rate). Honest scope: stats
// start from when the wallet was first followed/monitored.
async function leaderboard(db, uid) {
  const fSnap = await db.collection(`users/${uid}/followedWallets`).limit(30).get()
  const out = []
  for (const doc of fSnap.docs) {
    const f = doc.data()
    if (!f.chain || !f.address) continue
    const key = walletKey(f.chain, f.address)
    const buysSnap = await db.collection(`copyWallets/${key}/buys`).orderBy('at', 'desc').limit(20).get().catch(() => null)
    const buys = buysSnap ? buysSnap.docs.map((d) => d.data()) : []
    let entry = { id: doc.id, label: f.label || short(f.address), chain: f.chain, address: f.address, active: f.active !== false, copyEnabled: !!f.copyEnabled, buys: buys.length, avgReturnPct: null, winRate: null }
    if (buys.length) {
      const px = await positions.batchPrices(f.chain, [...new Set(buys.map((b) => b.tokenAddress.toLowerCase()))])
      const rets = buys.map((b) => { const cur = px[b.tokenAddress.toLowerCase()]; return cur && b.priceAtDetection ? (cur / b.priceAtDetection - 1) * 100 : null }).filter((r) => r != null)
      if (rets.length) {
        entry.avgReturnPct = +(rets.reduce((s, r) => s + r, 0) / rets.length).toFixed(1)
        entry.winRate = +(100 * rets.filter((r) => r > 0).length / rets.length).toFixed(0)
      }
    }
    out.push(entry)
  }
  out.sort((a, b) => (b.avgReturnPct ?? -1e9) - (a.avgReturnPct ?? -1e9))
  return out
}

// Recent detected buys across the user's followed wallets (the screen's feed).
async function feed(db, uid) {
  const fSnap = await db.collection(`users/${uid}/followedWallets`).limit(30).get()
  const items = []
  for (const doc of fSnap.docs) {
    const f = doc.data()
    if (!f.chain || !f.address) continue
    const key = walletKey(f.chain, f.address)
    const buysSnap = await db.collection(`copyWallets/${key}/buys`).orderBy('at', 'desc').limit(6).get().catch(() => null)
    if (buysSnap) for (const b of buysSnap.docs) items.push({ wallet: f.label || short(f.address), chain: f.chain, ...b.data() })
  }
  items.sort((a, b) => b.at - a.at)
  return items.slice(0, 30)
}

module.exports = { runCopyMonitor, leaderboard, feed, fetchRecentBuys, safetyVerdict, walletKey }

import { requireAuth } from './authObserver.js'
import { signOut }           from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js'
import {
  doc, getDoc, setDoc, updateDoc, collection,
  addDoc, onSnapshot, deleteField,
  query, orderBy, limit, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'
import {
  getFunctions, httpsCallable
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js'
import { app, auth, db } from './firebase.js'

// ── Firebase callable functions ────────────────────────────────────────────
const fns                = getFunctions(app, 'europe-west1')
const fnExecuteTrade     = httpsCallable(fns, 'executeTrade')
const fnSaveWallet       = httpsCallable(fns, 'saveWallet')
const fnRemoveWallet     = httpsCallable(fns, 'removeWallet')
const fnGetBalances      = httpsCallable(fns, 'getBalances')
const fnGenTgCode        = httpsCallable(fns, 'generateTelegramCode')
const fnGetBotInfo       = httpsCallable(fns, 'getBotInfo')
const fnScanGems         = httpsCallable(fns, 'scanGems',         { timeout: 90000 })

// ── Crypto helpers (for decrypting Wallet-page keys) ──────────────────────
function _b64dec(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function _decryptWalletKey(enc, password) {
  const te  = new TextEncoder()
  const km  = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    // Honor the blob's own iteration count (`it`, 600k for wallets created in
    // the mobile/webapp engine); blobs without it are legacy 100k.
    { name: 'PBKDF2', salt: _b64dec(enc.s), iterations: enc.it || 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  )
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _b64dec(enc.i) }, key, _b64dec(enc.d))
  return new TextDecoder().decode(pt)
}

// ── State ──────────────────────────────────────────────────────────────────
let currentUser      = null
let snipeChain       = 'bsc'
let tradeChain       = 'bsc'
let unsubSnipes      = null
let unsubTrades      = null
let unsubGemCalls    = null
let gemResults       = []   // cached gem scan results
let activeChainFilter = 'all'
let gemCalls         = []   // performance tracking records
let gemBoughtCount   = 0
let bnbPriceUsd      = 0    // live price for dollar equiv
let ethPriceUsd      = 0
let solPriceUsd      = 0
let tonPriceUsd      = 0
let maticPriceUsd    = 0
let snipeAmountMode  = 'native'  // 'native' | 'usd'
let buyAmountMode    = 'native'  // 'native' | 'usd'
let gemBuyMode       = 'native'  // 'native' | 'usd'
let gemMaxAgeUnit    = 'hours'   // 'hours' | 'days' | 'weeks' | 'months' | 'years'
let _lastTradeToken  = null      // { symbol, name } — set by checkToken()
let _tradeTxBackdrop = null
let _tradeTxTimer    = null

// Performance window definitions
const PERF_WINDOWS = [
  { key: 'perf1h',  label: '1h',  ms: 60 * 60 * 1000 },
  { key: 'perf4h',  label: '4h',  ms: 4 * 60 * 60 * 1000 },
  { key: 'perf24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: 'perf1w',  label: '1w',  ms: 7 * 24 * 60 * 60 * 1000 },
]

// ── Helpers ────────────────────────────────────────────────────────────────
function showStatus(elId, msg, ok = true) {
  const el = document.getElementById(elId)
  if (!el) return
  el.textContent = msg
  el.style.color = ok ? '#00c853' : '#f44336'
  setTimeout(() => { el.textContent = '' }, 4000)
}

// ── Transaction popup ──────────────────────────────────────────────────────
let _txPopupBackdrop = null
let _txAutoCloseTimer = null

const TX_STEPS = ['Preparing', 'Broadcasting', 'Confirming', 'Complete']

function _buildTxPopup(gem, buyAmount, chainTicker) {
  const backdrop = document.createElement('div')
  backdrop.className = 'tx-popup-backdrop'

  const stepsHtml = TX_STEPS.map((label, i) => {
    const dot = `<div class="tx-step-dot" id="txDot${i}"></div>`
    const lbl = `<div class="tx-step-label">${label}</div>`
    const line = i < TX_STEPS.length - 1
      ? `<div class="tx-step-line" id="txLine${i}"></div>`
      : ''
    return `<div class="tx-step">${dot}${lbl}</div>${line}`
  }).join('')

  backdrop.innerHTML = `
    <div class="tx-popup" id="txPopupCard">
      <button class="tx-popup-close" id="txPopupCloseBtn" title="Close">&times;</button>

      <div class="tx-popup-icon processing" id="txPopupIcon">
        <div class="tx-spinner" id="txSpinner"></div>
      </div>

      <h3 class="tx-popup-title" id="txPopupTitle">Processing Transaction</h3>
      <p class="tx-popup-sub" id="txPopupSub">Please wait while your trade is being submitted…</p>

      <div class="tx-popup-token">
        <span class="tx-popup-token-name">${gem.tokenSymbol || gem.tokenName}</span>
        <span class="tx-popup-token-meta">${buyAmount} ${chainTicker} · ${gem.chain.toUpperCase()}</span>
      </div>

      <div class="tx-popup-steps">${stepsHtml}</div>

      <div id="txPopupResult"></div>
    </div>`

  document.body.appendChild(backdrop)
  _txPopupBackdrop = backdrop

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeTxPopup()
  })
  backdrop.querySelector('#txPopupCloseBtn').addEventListener('click', closeTxPopup)

  // Animate first step active immediately
  _txSetStep(0)
  return backdrop
}

function _txSetStep(activeIdx) {
  TX_STEPS.forEach((_, i) => {
    const dot = document.getElementById(`txDot${i}`)
    if (!dot) return
    dot.className = 'tx-step-dot ' + (i < activeIdx ? 'done' : i === activeIdx ? 'active' : '')
    if (i < TX_STEPS.length - 1) {
      const line = document.getElementById(`txLine${i}`)
      if (line) line.className = 'tx-step-line ' + (i < activeIdx ? 'done' : '')
    }
  })
}

function showTxPopup(gem, buyAmount, chainTicker) {
  closeTxPopup()
  _buildTxPopup(gem, buyAmount, chainTicker)
  // Simulate step progression while waiting
  setTimeout(() => _txSetStep(1), 400)
  setTimeout(() => _txSetStep(2), 1800)
}

function resolveTxPopup(success, data = {}) {
  if (!_txPopupBackdrop) return
  const { txHash, explorerBase, errorMsg } = data

  // Complete step progression
  _txSetStep(success ? TX_STEPS.length : 2)
  TX_STEPS.forEach((_, i) => {
    const dot = document.getElementById(`txDot${i}`)
    if (!dot) return
    if (!success && i === TX_STEPS.length - 1) {
      dot.className = 'tx-step-dot failed'
    } else if (success) {
      dot.className = 'tx-step-dot done'
    }
  })

  const icon = document.getElementById('txPopupIcon')
  const title = document.getElementById('txPopupTitle')
  const sub = document.getElementById('txPopupSub')
  const result = document.getElementById('txPopupResult')

  if (success) {
    icon.className = 'tx-popup-icon success'
    icon.innerHTML = '✅'
    title.textContent = 'Transaction Confirmed!'
    title.style.color = '#0ECB81'
    sub.textContent = 'Your buy was submitted successfully.'

    const short = txHash ? txHash.slice(0, 8) + '…' + txHash.slice(-6) : '—'
    result.innerHTML = txHash ? `
      <div class="tx-popup-hash">
        <span class="tx-popup-hash-label">TX Hash</span>
        <a class="tx-popup-hash-link" href="${explorerBase}${txHash}" target="_blank" rel="noopener">${short} ↗</a>
      </div>` : ''

    // Auto-close bar (6 s)
    result.innerHTML += `
      <div class="tx-popup-autoclose">
        <div class="tx-popup-autoclose-bar" id="txAutoBar" style="width:100%"></div>
      </div>`

    if (_txAutoCloseTimer) clearTimeout(_txAutoCloseTimer)
    const bar = document.getElementById('txAutoBar')
    if (bar) {
      requestAnimationFrame(() => {
        bar.style.transition = 'width 6s linear'
        bar.style.width = '0%'
      })
    }
    _txAutoCloseTimer = setTimeout(closeTxPopup, 6000)

  } else {
    icon.className = 'tx-popup-icon error'
    icon.innerHTML = '❌'
    title.textContent = 'Transaction Failed'
    title.style.color = '#F6465D'
    sub.textContent = 'Something went wrong. Check details below.'
    result.innerHTML = `<div class="tx-popup-error">${errorMsg || 'Unknown error'}</div>`
  }

  // Always show dismiss button
  result.innerHTML += `<button class="tx-popup-dismiss" id="txDismissBtn">Dismiss</button>`
  document.getElementById('txDismissBtn')?.addEventListener('click', closeTxPopup)
}

function closeTxPopup() {
  if (_txAutoCloseTimer) { clearTimeout(_txAutoCloseTimer); _txAutoCloseTimer = null }
  if (_txPopupBackdrop) { _txPopupBackdrop.remove(); _txPopupBackdrop = null }
}

// ── Manual Trade tx-popup ──────────────────────────────────────────────────
function showTradeTxPopup(action, displayAmount, chainTicker) {
  closeTradeTxPopup()
  const backdrop = document.createElement('div')
  backdrop.className = 'tx-popup-backdrop'

  const stepsHtml = TX_STEPS.map((label, i) => {
    const dot  = `<div class="tx-step-dot" id="trdDot${i}"></div>`
    const lbl  = `<div class="tx-step-label">${label}</div>`
    const line = i < TX_STEPS.length - 1 ? `<div class="tx-step-line" id="trdLine${i}"></div>` : ''
    return `<div class="tx-step">${dot}${lbl}</div>${line}`
  }).join('')

  const isB       = action === 'buy'
  const actionLbl = isB ? '▲ BUY' : '▼ SELL'
  const accentCol = isB ? '#0ECB81' : '#F6465D'
  const tokenName = _lastTradeToken?.symbol || _lastTradeToken?.name || 'Token'
  const metaLine  = isB
    ? `${displayAmount} ${chainTicker} · ${tradeChain.toUpperCase()}`
    : `${displayAmount}% of holdings · ${tradeChain.toUpperCase()}`

  backdrop.innerHTML = `
    <div class="tx-popup" id="trdTxCard">
      <button class="tx-popup-close" id="trdTxCloseBtn" title="Close">&times;</button>
      <div class="tx-popup-icon processing" id="trdTxIcon">
        <div class="tx-spinner" id="trdTxSpinner"></div>
      </div>
      <h3 class="tx-popup-title" id="trdTxTitle">Processing Trade</h3>
      <p class="tx-popup-sub" id="trdTxSub">Sending ${action} transaction…</p>
      <div class="tx-popup-token">
        <span class="tx-popup-token-name">${tokenName}</span>
        <span class="tx-popup-token-meta" style="color:${accentCol}">${actionLbl}</span>
        <span class="tx-popup-token-meta">${metaLine}</span>
      </div>
      <div class="tx-popup-steps">${stepsHtml}</div>
      <div id="trdTxResult"></div>
    </div>`

  document.body.appendChild(backdrop)
  _tradeTxBackdrop = backdrop

  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeTradeTxPopup() })
  backdrop.querySelector('#trdTxCloseBtn').addEventListener('click', closeTradeTxPopup)

  // Animate steps while waiting
  _trdTxSetStep(0)
  setTimeout(() => _trdTxSetStep(1), 400)
  setTimeout(() => _trdTxSetStep(2), 1800)
}

function _trdTxSetStep(activeIdx) {
  TX_STEPS.forEach((_, i) => {
    const dot = document.getElementById(`trdDot${i}`)
    if (!dot) return
    dot.className = 'tx-step-dot ' + (i < activeIdx ? 'done' : i === activeIdx ? 'active' : '')
    if (i < TX_STEPS.length - 1) {
      const line = document.getElementById(`trdLine${i}`)
      if (line) line.className = 'tx-step-line ' + (i < activeIdx ? 'done' : '')
    }
  })
}

function resolveTradeTxPopup(success, data = {}) {
  if (!_tradeTxBackdrop) return
  const { txHash, explorerBase, errorMsg, action } = data

  _trdTxSetStep(success ? TX_STEPS.length : 2)
  TX_STEPS.forEach((_, i) => {
    const dot = document.getElementById(`trdDot${i}`)
    if (!dot) return
    if (!success && i === TX_STEPS.length - 1) dot.className = 'tx-step-dot failed'
    else if (success) dot.className = 'tx-step-dot done'
  })

  const icon   = document.getElementById('trdTxIcon')
  const title  = document.getElementById('trdTxTitle')
  const sub    = document.getElementById('trdTxSub')
  const result = document.getElementById('trdTxResult')
  const isB    = action === 'buy'

  if (success) {
    icon.className  = 'tx-popup-icon success'
    icon.innerHTML  = '✅'
    title.textContent = isB ? 'Buy Confirmed!' : 'Sell Confirmed!'
    title.style.color = isB ? '#0ECB81' : '#F6465D'
    sub.textContent = 'Your transaction was submitted successfully.'

    const short = txHash ? txHash.slice(0, 8) + '…' + txHash.slice(-6) : '—'
    result.innerHTML = txHash ? `
      <div class="tx-popup-hash">
        <span class="tx-popup-hash-label">TX Hash</span>
        <a class="tx-popup-hash-link" href="${explorerBase}${txHash}" target="_blank" rel="noopener">${short} ↗</a>
      </div>` : ''

    result.innerHTML += `
      <div class="tx-popup-autoclose">
        <div class="tx-popup-autoclose-bar" id="trdTxAutoBar" style="width:100%"></div>
      </div>`

    if (_tradeTxTimer) clearTimeout(_tradeTxTimer)
    const bar = document.getElementById('trdTxAutoBar')
    if (bar) {
      requestAnimationFrame(() => {
        bar.style.transition = 'width 6s linear'
        bar.style.width = '0%'
      })
    }
    _tradeTxTimer = setTimeout(closeTradeTxPopup, 6000)
  } else {
    icon.className  = 'tx-popup-icon error'
    icon.innerHTML  = '❌'
    title.textContent = 'Trade Failed'
    title.style.color = '#F6465D'
    sub.textContent = 'Something went wrong. See details below.'
    result.innerHTML = `<div class="tx-popup-error">${errorMsg || 'Unknown error'}</div>`
  }

  result.innerHTML += `<button class="tx-popup-dismiss" id="trdTxDismissBtn">Dismiss</button>`
  document.getElementById('trdTxDismissBtn')?.addEventListener('click', closeTradeTxPopup)
}

function closeTradeTxPopup() {
  if (_tradeTxTimer) { clearTimeout(_tradeTxTimer); _tradeTxTimer = null }
  if (_tradeTxBackdrop) { _tradeTxBackdrop.remove(); _tradeTxBackdrop = null }
}

function copyText(text, statusElId) {
  const finish = (ok) => showStatus(statusElId, ok ? '✅ Copied!' : '❌ Copy failed — select manually.', ok)
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => finish(true)).catch(() => {
      // Clipboard API denied — fall back to execCommand
      execCopy(text, statusElId)
    })
  } else {
    execCopy(text, statusElId)
  }
}

function execCopy(text, statusElId) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try {
    document.execCommand('copy')
    showStatus(statusElId, '✅ Copied!', true)
  } catch (_) {
    showStatus(statusElId, '❌ Copy failed — select manually.', false)
  }
  document.body.removeChild(ta)
}

function chainLabel(chain) {
  return { bsc: 'BNB', eth: 'ETH', sol: 'SOL', base: 'ETH', ton: 'TON', matic: 'MATIC' }[chain] || chain
}

function explorerUrl(chain, txHash) {
  const base = chain === 'bsc'   ? 'https://bscscan.com/tx/'
             : chain === 'eth'   ? 'https://etherscan.io/tx/'
             : chain === 'base'  ? 'https://basescan.org/tx/'
             : chain === 'ton'   ? 'https://tonscan.org/tx/'
             : chain === 'matic' ? 'https://polygonscan.com/tx/'
             : 'https://solscan.io/tx/'
  return base + txHash
}

function shortAddr(addr = '') {
  return addr.length > 16 ? addr.slice(0, 8) + '…' + addr.slice(-6) : addr
}

// ── Tab switching ──────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tracker-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tracker-tab-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.tracker-panel').forEach(p => p.classList.remove('active'))
      btn.classList.add('active')
      const id = 'panel' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)
      document.getElementById(id)?.classList.add('active')
    })
  })
}

// ── Chain pill selection helper ────────────────────────────────────────────
function initChainPills(pillsId, onSelect) {
  const container = document.getElementById(pillsId)
  if (!container) return
  container.querySelectorAll('.chain-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.chain-pill').forEach(p => p.classList.remove('active'))
      pill.classList.add('active')
      onSelect(pill.dataset.chain)
    })
  })
}

// ── Side menu / logout ─────────────────────────────────────────────────────
function initMenu() {
  const menuBtn      = document.getElementById('menuBtn')
  const sideMenu     = document.getElementById('sideMenu')
  const closeMenuBtn = document.getElementById('closeMenuBtn')
  const overlay      = document.getElementById('menuOverlay')

  const open  = e => { e.stopPropagation(); sideMenu.classList.add('open'); overlay?.classList.add('visible') }
  const close = () => { sideMenu.classList.remove('open'); overlay?.classList.remove('visible') }

  menuBtn.addEventListener('click', open)
  menuBtn.addEventListener('touchstart', open)
  closeMenuBtn.addEventListener('click', close)
  closeMenuBtn.addEventListener('touchstart', close)
  overlay?.addEventListener('click', close)

  document.getElementById('sideLogoutBtn')?.addEventListener('click', () =>
    signOut(auth).then(() => { window.location.href = 'login.html' })
  )
}

// ── Load bot settings from Firestore ──────────────────────────────────────
async function loadSettings() {
  if (!currentUser) return {}
  const snap = await getDoc(doc(db, 'users', currentUser.uid))
  if (!snap.exists()) return {}
  return snap.data().botSettings || {}
}

// ── Update bot status badge ────────────────────────────────────────────────
function setStatusBadge(enabled) {
  const dot   = document.getElementById('botStatusDot')
  const label = document.getElementById('botStatusLabel')
  if (enabled) {
    dot.className   = 'bot-status-dot bot-status-on'
    label.textContent = 'Running'
  } else {
    dot.className   = 'bot-status-dot bot-status-off'
    label.textContent = 'Stopped'
  }
  document.getElementById('toggleSubtitle').textContent =
    enabled ? 'Bot is actively watching snipe targets' : 'Auto-execute snipe targets'
}

// ── Bot toggle ─────────────────────────────────────────────────────────────
function initBotToggle() {
  const toggle = document.getElementById('botToggle')
  toggle.addEventListener('change', async () => {
    if (!currentUser) return
    const enabled = toggle.checked
    await updateDoc(doc(db, 'users', currentUser.uid),
      { 'botSettings.botEnabled': enabled })
    setStatusBadge(enabled)
  })
}

// ── Refresh balances ───────────────────────────────────────────────────────
function formatBalance(entry) {
  if (!entry) return '—'
  if (entry.error) return 'error'
  return entry.native ?? '—'
}

async function refreshBalances(_retry = true) {
  document.getElementById('balBSC').textContent   = '…'
  document.getElementById('balETH').textContent   = '…'
  document.getElementById('balSOL').textContent   = '…'
  document.getElementById('balBASE').textContent  = '…'
  document.getElementById('balTON').textContent   = '…'
  document.getElementById('balMATIC').textContent = '…'

  try {
    if (auth.currentUser) await auth.currentUser.getIdToken()
    const { data } = await fnGetBalances()
    const b = data.balances || {}
    document.getElementById('balBSC').textContent   = formatBalance(b.bsc)
    document.getElementById('balETH').textContent   = formatBalance(b.eth)
    document.getElementById('balSOL').textContent   = formatBalance(b.sol)
    document.getElementById('balBASE').textContent  = formatBalance(b.base)
    document.getElementById('balTON').textContent   = formatBalance(b.ton)
    document.getElementById('balMATIC').textContent = formatBalance(b.matic)
  } catch (err) {
    if (_retry) {
      setTimeout(() => refreshBalances(false), 3000)
      return
    }
    document.getElementById('balBSC').textContent   = 'error'
    document.getElementById('balETH').textContent   = 'error'
    document.getElementById('balSOL').textContent   = 'error'
    document.getElementById('balBASE').textContent  = 'error'
    document.getElementById('balTON').textContent   = 'error'
    document.getElementById('balMATIC').textContent = 'error'
    console.error('Balance fetch failed:', err)
  }
}

// ── Snipe queue real-time listener ────────────────────────────────────────
function listenSnipes() {
  if (!currentUser) return
  if (unsubSnipes) unsubSnipes()
  const q = query(
    collection(db, 'users', currentUser.uid, 'snipeTargets'),
    where('status', 'in', ['pending', 'executing', 'sniped', 'failed']),
    orderBy('addedAt', 'desc'),
    limit(50)
  )
  unsubSnipes = onSnapshot(q, snap => {
    const pending = snap.docs.filter(d => d.data().status === 'pending').length
    document.getElementById('statPendingSnipes').textContent = pending

    const list = document.getElementById('snipeQueueList')
    if (snap.empty) {
      list.innerHTML = '<div class="empty-state">No active snipe targets.</div>'
      return
    }
    list.innerHTML = snap.docs.map(d => {
      const s      = d.data()
      const status = s.status
      const icon   = status === 'sniped' ? '✅' : status === 'failed' ? '❌' : status === 'executing' ? '⏳' : '🎯'
      const txLink = s.txHash
        ? `<a href="${explorerUrl(s.chain, s.txHash)}" target="_blank" class="bot-tx-link">View TX</a>`
        : ''
      return `
        <div class="bot-snipe-card ${status}">
          <div class="bot-snipe-row">
            <span class="bot-snipe-icon">${icon}</span>
            <span class="bot-snipe-chain chain-pill-sm ${s.chain}">${s.chain.toUpperCase()}</span>
            <span class="bot-snipe-amount">${s.buyAmount} ${chainLabel(s.chain)}</span>
            <span class="bot-snipe-status-label">${status}</span>
          </div>
          <div class="bot-snipe-addr">${shortAddr(s.tokenAddress)}</div>
          ${s.maxBuyPrice ? `<div class="bot-snipe-maxprice">Max: $${s.maxBuyPrice}</div>` : ''}
          <div class="bot-snipe-actions">
            ${txLink}
            ${status === 'pending'
              ? `<button class="bot-cancel-snipe-btn" data-id="${d.id}">Cancel</button>`
              : ''}
          </div>
        </div>`
    }).join('')

    list.querySelectorAll('.bot-cancel-snipe-btn').forEach(btn => {
      btn.addEventListener('click', () => cancelSnipe(btn.dataset.id))
    })
  })
}

async function addSnipeTarget() {
  if (!currentUser) return
  const addr     = document.getElementById('snipeAddress').value.trim()
  const rawAmt   = document.getElementById('snipeAmount').value.trim()
  const maxPrice = document.getElementById('snipeMaxPrice').value.trim()
  const slip     = parseFloat(document.getElementById('snipeSlippage').value) || 5

  if (!addr || !rawAmt) { showStatus('snipeStatus', 'Fill in address and amount.', false); return }

  if (snipeChain === 'ton') {
    showStatus('snipeStatus', '⚠️ TON sniping is not supported — TON is balance tracking only. Use BSC, ETH, SOL, BASE, or MATIC.', false)
    return
  }

  let amount = rawAmt
  if (snipeAmountMode === 'usd') {
    const price = nativePriceUsd(snipeChain)
    if (!price) { showStatus('snipeStatus', 'Cannot convert — live price unavailable. Try native mode.', false); return }
    amount = (parseFloat(rawAmt) / price).toFixed(8)
  }

  try {
    document.getElementById('addSnipeBtn').disabled = true
    await addDoc(collection(db, 'users', currentUser.uid, 'snipeTargets'), {
      chain: snipeChain,
      tokenAddress: addr,
      buyAmount: amount,
      maxBuyPrice: maxPrice ? parseFloat(maxPrice) : null,
      slippage: slip,
      status: 'pending',
      txHash: null,
      source: 'webapp',
      addedAt: serverTimestamp(),
      executedAt: null
    })
    showStatus('snipeStatus', '🎯 Snipe target added!')
    document.getElementById('snipeAddress').value = ''
    document.getElementById('snipeAmount').value  = ''
    document.getElementById('snipeMaxPrice').value = ''
  } catch (err) {
    showStatus('snipeStatus', err.message, false)
  } finally {
    document.getElementById('addSnipeBtn').disabled = false
  }
}

async function cancelSnipe(docId) {
  if (!currentUser) return
  await updateDoc(doc(db, 'users', currentUser.uid, 'snipeTargets', docId), { status: 'cancelled' })
}

// ── Token info check ───────────────────────────────────────────────────────
async function checkToken() {
  const addr = document.getElementById('tradeAddress').value.trim()
  if (!addr) return
  const box = document.getElementById('tradeTokenInfo')
  box.innerHTML = '<div class="bot-loading">Fetching token info…</div>'

  const chainMap = { bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base', ton: 'ton', matic: 'polygon' }
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`)
    const data = await r.json()
    const pairs = (data.pairs || []).filter(p => p.chainId === chainMap[tradeChain])

    if (!pairs.length) {
      box.innerHTML = '<div class="bot-token-not-found">No pairs found on this chain for this address.</div>'
      return
    }
    const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]
    _lastTradeToken = { symbol: best.baseToken.symbol, name: best.baseToken.name }
    box.innerHTML = `
      <div class="bot-token-info-card">
        <div class="bot-token-name">${best.baseToken.name} <span class="bot-token-symbol">${best.baseToken.symbol}</span></div>
        <div class="bot-token-stats">
          <span>Price: <b>$${parseFloat(best.priceUsd || 0).toFixed(8)}</b></span>
          <span>Liq: <b>$${(best.liquidity?.usd || 0).toLocaleString()}</b></span>
          <span>Vol 24h: <b>$${(best.volume?.h24 || 0).toLocaleString()}</b></span>
        </div>
      </div>`
  } catch (err) {
    box.innerHTML = `<div class="bot-token-not-found">Error: ${err.message}</div>`
  }
}

// ── Execute trade ──────────────────────────────────────────────────────────
async function executeTrade(action) {
  const addr = document.getElementById('tradeAddress').value.trim()
  if (!addr) { showStatus('tradeStatus', 'Enter a token address first.', false); return }

  if (tradeChain === 'ton') {
    showStatus('tradeStatus', '⚠️ TON trading is not supported — TON is balance tracking only. Use BSC, ETH, SOL, BASE, or MATIC.', false)
    return
  }

  const rawAmt  = document.getElementById('buyAmount').value
  const percent = document.getElementById('sellPercent').value
  const slippage = parseFloat(
    action === 'buy'
      ? document.getElementById('buySlippage').value
      : document.getElementById('sellSlippage').value
  ) || 5

  if (action === 'buy' && !rawAmt) { showStatus('tradeStatus', 'Enter buy amount.', false); return }
  if (action === 'sell') {
    const pct = parseInt(percent)
    if (!percent || isNaN(pct) || pct < 1 || pct > 100) {
      showStatus('tradeStatus', 'Enter a sell percent between 1 and 100.', false); return
    }
  }

  let amount = rawAmt
  if (action === 'buy' && buyAmountMode === 'usd') {
    const price = nativePriceUsd(tradeChain)
    if (!price) { showStatus('tradeStatus', 'Cannot convert — live price unavailable. Try native mode.', false); return }
    amount = (parseFloat(rawAmt) / price).toFixed(8)
  }

  const btn          = document.getElementById(action === 'buy' ? 'buyBtn' : 'sellBtn')
  const chainTicker  = chainLabel(tradeChain)
  const displayAmt   = action === 'buy' ? (amount || rawAmt) : percent

  // Lock button & show processing popup
  btn.disabled = true
  showTradeTxPopup(action, displayAmt, chainTicker)

  try {
    const result = await fnExecuteTrade({
      chain: tradeChain, tokenAddress: addr, action,
      amount: action === 'buy' ? amount : null,
      percent: action === 'sell' ? parseInt(percent) : null,
      slippage
    })
    const tx       = result.data
    const explorer = explorerUrl(tradeChain, tx.txHash)
    const base     = explorer ? explorer.replace(tx.txHash, '') : ''
    resolveTradeTxPopup(true, { txHash: tx.txHash, explorerBase: base, action })
    setTimeout(() => listenHistory(), 1000)
  } catch (err) {
    resolveTradeTxPopup(false, { errorMsg: err.message, action })
  } finally {
    btn.disabled = false
  }
}

// ── Trade history listener ─────────────────────────────────────────────────
function listenHistory() {
  if (!currentUser) return
  if (unsubTrades) unsubTrades()
  const q = query(
    collection(db, 'users', currentUser.uid, 'trades'),
    orderBy('timestamp', 'desc'),
    limit(30)
  )
  unsubTrades = onSnapshot(q, snap => {
    document.getElementById('statTotalTrades').textContent  = snap.size
    document.getElementById('statSuccessTrades').textContent =
      snap.docs.filter(d => d.data().status === 'confirmed').length

    const list = document.getElementById('historyList')
    if (snap.empty) {
      list.innerHTML = '<div class="empty-state">No trades yet.</div>'
      return
    }
    list.innerHTML = snap.docs.map(d => {
      const t    = d.data()
      const icon = t.type === 'buy' ? '🟢' : '🔴'
      const ts   = t.timestamp?.toDate?.()?.toLocaleString() || '—'
      const tx   = t.txHash
        ? `<a href="${explorerUrl(t.chain, t.txHash)}" target="_blank" class="bot-tx-link">TX ↗</a>`
        : (t.error ? `<span class="bot-err-label">${t.error.slice(0, 50)}</span>` : '')
      return `
        <div class="bot-history-row">
          <span>${icon} ${t.type?.toUpperCase()}</span>
          <span class="chain-pill-sm ${t.chain}">${t.chain?.toUpperCase()}</span>
          <span class="bot-history-amount">${t.amountIn ? t.amountIn + ' ' + chainLabel(t.chain) : t.percentSold + '%'}</span>
          <span class="bot-history-date">${ts}</span>
          ${tx}
        </div>`
    }).join('')
  })
}

// ── Wallet management ──────────────────────────────────────────────────────
async function saveWallet(chain) {
  const address = document.getElementById(`${chain}Address`)?.value.trim()
  const keyEl   = document.getElementById(`${chain}Key`)
  const key     = keyEl?.value.trim() || null

  if (!address) {
    showStatus('configStatus', `Enter the ${chain.toUpperCase()} wallet address.`, false)
    return
  }

  // TON is address-only — private key is managed in the Wallet page
  if (chain !== 'ton' && !key) {
    showStatus('configStatus', `Enter both address and private key for ${chain.toUpperCase()}.`, false)
    return
  }

  try {
    const payload = chain === 'ton' ? { chain, address } : { chain, address, privateKey: key }
    await fnSaveWallet(payload)
    if (keyEl) keyEl.value = ''
    document.getElementById(`${chain}WalletStatus`).textContent = `✅ ${shortAddr(address)}`
    document.getElementById(`${chain}WalletStatus`).style.color = '#00c853'
    showStatus('configStatus', `${chain.toUpperCase()} ${chain === 'ton' ? 'address' : 'wallet'} saved!`)
    refreshBalances()
  } catch (err) {
    showStatus('configStatus', `❌ ${err.message}`, false)
  }
}

async function removeWallet(chain) {
  if (!confirm(`Remove ${chain.toUpperCase()} wallet? This cannot be undone.`)) return
  try {
    await fnRemoveWallet({ chain })
    document.getElementById(`${chain}Address`).value = ''
    document.getElementById(`${chain}WalletStatus`).textContent = '—'
    showStatus('configStatus', `${chain.toUpperCase()} wallet removed.`)
  } catch (err) {
    showStatus('configStatus', `❌ ${err.message}`, false)
  }
}

// ── Link wallet from Wallet page ───────────────────────────────────────────
let _linkChain = null

function setupLinkWalletModal() {
  document.getElementById('linkWalletClose').onclick  = closeLinkModal
  document.getElementById('linkWalletConfirm').onclick = confirmLinkWallet

  document.querySelectorAll('.link-wallet-page-btn').forEach(btn => {
    btn.addEventListener('click', () => openLinkModal(btn.dataset.chain))
  })
}

function openLinkModal(chain) {
  _linkChain = chain
  const label = { bsc: 'BSC', eth: 'ETH', sol: 'SOL', base: 'BASE', matic: 'MATIC' }[chain] || chain.toUpperCase()
  document.getElementById('linkWalletTitle').textContent = `Link ${label} Wallet Page Key`
  document.getElementById('linkWalletDesc').textContent  =
    `Enter the password you used on the Wallet page to authorize the ${label} key for bot trading.`
  document.getElementById('linkWalletPwd').value         = ''
  document.getElementById('linkWalletError').style.display = 'none'
  document.getElementById('linkWalletModal').style.display = 'flex'
  setTimeout(() => document.getElementById('linkWalletPwd').focus(), 80)
}

function closeLinkModal() {
  document.getElementById('linkWalletModal').style.display = 'none'
  document.getElementById('linkWalletPwd').value = ''
  document.getElementById('linkWalletError').style.display = 'none'
  _linkChain = null
}

async function confirmLinkWallet() {
  const chain    = _linkChain
  const password = document.getElementById('linkWalletPwd').value
  const errEl    = document.getElementById('linkWalletError')
  const btn      = document.getElementById('linkWalletConfirm')

  if (!password) { errEl.textContent = 'Enter your wallet password.'; errEl.style.display = ''; return }
  if (!currentUser) { errEl.textContent = 'Not signed in.'; errEl.style.display = ''; return }

  btn.disabled = true; btn.textContent = 'Decrypting…'
  errEl.style.display = 'none'

  try {
    // Load the cold-wallet entry from Firestore
    const snap    = await getDoc(doc(db, 'users', currentUser.uid))
    const walletData = snap.exists() ? snap.data().wallets?.[chain] : null

    if (!walletData?.encPrivateKey) {
      errEl.textContent = `No ${chain.toUpperCase()} wallet found on the Wallet page. Create one there first.`
      errEl.style.display = ''
      return
    }

    // Decrypt locally — private key never leaves the device unencrypted
    const privateKey = await _decryptWalletKey(walletData.encPrivateKey, password)
    const address    = walletData.address

    // Authorize for bot trading via Cloud Function (server encrypts with AES-256-GCM)
    await fnSaveWallet({ chain, address, privateKey })

    document.getElementById(`${chain}Address`).value = address
    document.getElementById(`${chain}WalletStatus`).textContent = `✅ ${shortAddr(address)}`
    document.getElementById(`${chain}WalletStatus`).style.color = '#00c853'
    closeLinkModal()
    showStatus('configStatus', `✅ ${chain.toUpperCase()} key linked from Wallet page!`)
    refreshBalances()
  } catch (e) {
    const msg = e.message?.includes('operation-failed') || e.name === 'OperationError'
      ? 'Wrong password — decryption failed.'
      : e.message || 'Unknown error'
    errEl.textContent = msg
    errEl.style.display = ''
  } finally {
    btn.disabled = false; btn.textContent = 'Authorize for Trading'
  }
}

// ── Bot config save ────────────────────────────────────────────────────────
async function saveBotConfig() {
  if (!currentUser) return
  const updates = {
    'botSettings.defaultSlippage':      parseFloat(document.getElementById('cfgSlippage').value)      || 5,
    'botSettings.defaultGasMultiplier': parseFloat(document.getElementById('cfgGasMultiplier').value) || 1.2,
    'botSettings.minLiquidity':         parseFloat(document.getElementById('cfgMinLiquidity').value)  || 5000,
  }

  // Only set RPC fields if provided, otherwise delete them
  const bscRpc = document.getElementById('cfgBscRpc').value.trim()
  const ethRpc = document.getElementById('cfgEthRpc').value.trim()
  const solRpc = document.getElementById('cfgSolRpc').value.trim()
  updates['botSettings.bscRpc'] = bscRpc || deleteField()
  updates['botSettings.ethRpc'] = ethRpc || deleteField()
  updates['botSettings.solRpc'] = solRpc || deleteField()

  await updateDoc(doc(db, 'users', currentUser.uid), updates)
  showStatus('configStatus', '✅ Configuration saved!')
}

// ── Telegram link code ─────────────────────────────────────────────────────
async function generateLinkCode() {
  try {
    const { data } = await fnGenTgCode()
    const command  = `/link ${data.code}`
    document.getElementById('linkCodeText').textContent  = command
    document.getElementById('linkCodeDisplay').style.display = 'block'
    showStatus('telegramStatus', 'Code generated — send the command to your bot within 10 minutes.')
  } catch (err) {
    showStatus('telegramStatus', `❌ ${err.message}`, false)
  }
}

// ── Populate settings from Firestore ──────────────────────────────────────
async function populateSettings(settings) {
  const w = settings.wallets || {}
  const setWalletStatus = (chain) => {
    const el = document.getElementById(`${chain}WalletStatus`)
    if (!el) return
    if (w[chain]?.address) {
      el.textContent = `✅ ${shortAddr(w[chain].address)}`
      el.style.color = '#00c853'
      document.getElementById(`${chain}Address`).value = w[chain].address
    } else {
      el.textContent = '— Not set'
      el.style.color = '#848E9C'
    }
  }
  setWalletStatus('bsc')
  setWalletStatus('eth')
  setWalletStatus('sol')
  setWalletStatus('base')
  setWalletStatus('ton')
  setWalletStatus('matic')

  if (settings.defaultSlippage)      document.getElementById('cfgSlippage').value      = settings.defaultSlippage
  if (settings.defaultGasMultiplier) document.getElementById('cfgGasMultiplier').value = settings.defaultGasMultiplier
  if (settings.minLiquidity)         document.getElementById('cfgMinLiquidity').value  = settings.minLiquidity
  if (settings.bscRpc)               document.getElementById('cfgBscRpc').value        = settings.bscRpc
  if (settings.ethRpc)               document.getElementById('cfgEthRpc').value        = settings.ethRpc
  if (settings.solRpc)               document.getElementById('cfgSolRpc').value        = settings.solRpc

  // Gem Scanner settings
  if (settings.gemMinLiquidity != null) document.getElementById('gemMinLiquidity').value = settings.gemMinLiquidity
  if (settings.gemMaxAge != null)       document.getElementById('gemMaxAge').value       = settings.gemMaxAge
  if (settings.gemMinScore != null)     document.getElementById('gemMinScore').value     = settings.gemMinScore
  if (settings.gemBuyAmountBsc != null) document.getElementById('gemBuyAmountBsc').value = settings.gemBuyAmountBsc
  if (settings.gemBuyAmountEth != null) document.getElementById('gemBuyAmountEth').value = settings.gemBuyAmountEth
  if (settings.gemBuyAmountSol != null) document.getElementById('gemBuyAmountSol').value = settings.gemBuyAmountSol

  if (settings.gemMaxAgeUnit) {
    gemMaxAgeUnit = settings.gemMaxAgeUnit
    const unitSel = document.getElementById('gemMaxAgeUnit')
    if (unitSel) unitSel.value = gemMaxAgeUnit
  }
  if (settings.gemBuyMode) {
    gemBuyMode = settings.gemBuyMode
    document.getElementById('gemModePillNative')?.classList.toggle('active', gemBuyMode === 'native')
    document.getElementById('gemModePillUsd')?.classList.toggle('active',    gemBuyMode === 'usd')
    updateGemLabels()
  }

  const gemAutoToggle = document.getElementById('gemAutoToggle')
  if (gemAutoToggle) {
    gemAutoToggle.checked = !!settings.gemAutoEnabled
    document.getElementById('gemToggleSubtitle').textContent =
      settings.gemAutoEnabled ? 'Scanning every 5 min — alerts via Telegram' : 'Auto-scan BSC & SOL for new gems'
    document.getElementById('gemAutoBuyCard').style.display = settings.gemAutoEnabled ? 'flex' : 'none'
  }

  const gemBuyToggle = document.getElementById('gemAutoBuyToggle')
  if (gemBuyToggle) {
    gemBuyToggle.checked = !!settings.gemAutoBuy
    document.getElementById('gemAutoBuySubtitle').textContent =
      settings.gemAutoBuy ? 'Auto-buying high-score gems' : 'Automatically buy high-score gems'
  }

  // Chain checkboxes
  // Base & TON were added after initial release — if the saved array pre-dates them
  // (i.e. it contains neither 'base' nor 'ton'), treat both as enabled by default.
  if (settings.gemChains && Array.isArray(settings.gemChains)) {
    const hasNewChainData = settings.gemChains.includes('base') || settings.gemChains.includes('ton')
    document.getElementById('gemChainBsc').checked   = settings.gemChains.includes('bsc')
    document.getElementById('gemChainSol').checked   = settings.gemChains.includes('sol')
    document.getElementById('gemChainBase').checked  = hasNewChainData ? settings.gemChains.includes('base')  : true
    document.getElementById('gemChainTon').checked   = hasNewChainData ? settings.gemChains.includes('ton')   : true
    // eth was added later — default ON (like base/ton); matic stays opt-in
    const hasEthEraConfig = settings.gemChains.includes('eth') || settings.gemChains.includes('matic')
    document.getElementById('gemChainEth').checked   = hasEthEraConfig ? settings.gemChains.includes('eth') : true
    document.getElementById('gemChainMatic').checked = settings.gemChains.includes('matic')
  }

  // Telegram linked status banner
  const tgEl = document.getElementById('telegramLinkedStatus')
  if (settings.telegramVerified && settings.telegramChatId) {
    tgEl.innerHTML = '<div class="bot-tg-linked">&#x2705; Telegram linked &mdash; Chat ID: ' + settings.telegramChatId + '</div>'
  } else {
    tgEl.innerHTML = '<div class="bot-tg-unlinked">&#x26A0;&#xFE0F; Not linked &mdash; generate a code below to connect your account.</div>'
  }

  // Webhook URL — correct region
  const webhookUrl = 'https://europe-west1-pnl-calculator.cloudfunctions.net/telegramWebhook'
  document.getElementById('webhookUrl').textContent = webhookUrl

  // Fetch live bot username from Telegram API via Cloud Function
  const usernameEl = document.getElementById('tgBotUsername')
  const linkEl     = document.getElementById('tgBotLink')
  fnGetBotInfo()
    .then(({ data }) => {
      if (data?.username) {
        usernameEl.textContent = '@' + data.username
        linkEl.href            = 'https://t.me/' + data.username
        linkEl.style.display   = 'inline-block'
      } else {
        usernameEl.textContent = data?.firstName || 'FXcrypt Bot'
      }
    })
    .catch(() => {
      usernameEl.textContent = 'FXcrypt Bot'
    })
}





// ── Gem Scanner: fetch BNB/SOL USD prices for dollar equivalents ──────────
async function fetchNativePrices() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum,solana,the-open-network,matic-network&vs_currencies=usd')
    const data = await r.json()
    bnbPriceUsd   = data.binancecoin?.usd         || 0
    ethPriceUsd   = data.ethereum?.usd            || 0
    solPriceUsd   = data.solana?.usd              || 0
    tonPriceUsd   = data['the-open-network']?.usd || 0
    maticPriceUsd = data['matic-network']?.usd    || 0
    updateGemDollarEquiv()
    updateSnipeDollarEquiv()
    updateBuyDollarEquiv()
  } catch {
    // Fallback — try DexScreener for BNB and SOL
    try {
      const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
      const d = await r.json()
      const bnbPair = (d.pairs || []).find(p => p.chainId === 'bsc' && p.quoteToken?.symbol === 'USDT')
      if (bnbPair) bnbPriceUsd = parseFloat(bnbPair.priceUsd || 0)
    } catch {}
    try {
      const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112')
      const d = await r.json()
      const solPair = (d.pairs || []).find(p => p.chainId === 'solana' && p.quoteToken?.symbol === 'USDC')
      if (solPair) solPriceUsd = parseFloat(solPair.priceUsd || 0)
    } catch {}
    updateGemDollarEquiv()
    updateSnipeDollarEquiv()
    updateBuyDollarEquiv()
  }
}

function nativePriceUsd(chain) {
  if (chain === 'bsc')                     return bnbPriceUsd
  if (chain === 'eth' || chain === 'base') return ethPriceUsd
  if (chain === 'sol')                     return solPriceUsd
  if (chain === 'ton')                     return tonPriceUsd
  if (chain === 'matic')                   return maticPriceUsd
  return 0
}

function updateSnipeDollarEquiv() {
  const input = document.getElementById('snipeAmount')
  const equiv = document.getElementById('snipeDollarEquiv')
  if (!input || !equiv) return
  const amt   = parseFloat(input.value) || 0
  const price = nativePriceUsd(snipeChain)
  if (snipeAmountMode === 'native') {
    equiv.textContent = price > 0 ? `≈ $${(amt * price).toFixed(2)}` : '≈ $—'
  } else {
    equiv.textContent = price > 0 && amt > 0
      ? `≈ ${(amt / price).toFixed(6)} ${chainLabel(snipeChain)}`
      : `≈ — ${chainLabel(snipeChain)}`
  }
}

function updateBuyDollarEquiv() {
  const input = document.getElementById('buyAmount')
  const equiv = document.getElementById('buyDollarEquiv')
  if (!input || !equiv) return
  const amt   = parseFloat(input.value) || 0
  const price = nativePriceUsd(tradeChain)
  if (buyAmountMode === 'native') {
    equiv.textContent = price > 0 ? `≈ $${(amt * price).toFixed(2)}` : '≈ $—'
  } else {
    equiv.textContent = price > 0 && amt > 0
      ? `≈ ${(amt / price).toFixed(6)} ${chainLabel(tradeChain)}`
      : `≈ — ${chainLabel(tradeChain)}`
  }
}

function initAmountInputs() {
  // ── Snipe mode pills ──
  const snipeNativeBtn = document.getElementById('snipeModePillNative')
  const snipeUsdBtn    = document.getElementById('snipeModePillUsd')

  snipeNativeBtn?.addEventListener('click', () => {
    snipeAmountMode = 'native'
    snipeNativeBtn.classList.add('active')
    snipeUsdBtn.classList.remove('active')
    const lbl = document.getElementById('snipeAmountLabel')
    const inp = document.getElementById('snipeAmount')
    if (lbl) lbl.textContent = `Buy Amount (${chainLabel(snipeChain)})`
    if (inp) inp.placeholder = 'e.g. 0.1'
    updateSnipeDollarEquiv()
  })

  snipeUsdBtn?.addEventListener('click', () => {
    snipeAmountMode = 'usd'
    snipeUsdBtn.classList.add('active')
    snipeNativeBtn.classList.remove('active')
    const lbl = document.getElementById('snipeAmountLabel')
    const inp = document.getElementById('snipeAmount')
    if (lbl) lbl.textContent = 'Buy Amount (USD $)'
    if (inp) inp.placeholder = 'e.g. 100'
    updateSnipeDollarEquiv()
  })

  document.getElementById('snipeAmount')?.addEventListener('input', updateSnipeDollarEquiv)

  // ── Trade buy mode pills ──
  const buyNativeBtn = document.getElementById('buyModePillNative')
  const buyUsdBtn    = document.getElementById('buyModePillUsd')

  buyNativeBtn?.addEventListener('click', () => {
    buyAmountMode = 'native'
    buyNativeBtn.classList.add('active')
    buyUsdBtn.classList.remove('active')
    const lbl = document.getElementById('buyAmountLabel')
    const inp = document.getElementById('buyAmount')
    if (lbl) lbl.textContent = `Amount (${chainLabel(tradeChain)})`
    if (inp) inp.placeholder = 'e.g. 0.1'
    updateBuyDollarEquiv()
  })

  buyUsdBtn?.addEventListener('click', () => {
    buyAmountMode = 'usd'
    buyUsdBtn.classList.add('active')
    buyNativeBtn.classList.remove('active')
    const lbl = document.getElementById('buyAmountLabel')
    const inp = document.getElementById('buyAmount')
    if (lbl) lbl.textContent = 'Amount (USD $)'
    if (inp) inp.placeholder = 'e.g. 100'
    updateBuyDollarEquiv()
  })

  document.getElementById('buyAmount')?.addEventListener('input', updateBuyDollarEquiv)
}

// ── Gem: max age unit conversion ─────────────────────────────────────────
function gemMaxAgeInHours() {
  const val = parseInt(document.getElementById('gemMaxAge').value) || 1
  switch (gemMaxAgeUnit) {
    case 'hours':  return val
    case 'days':   return val * 24
    case 'weeks':  return val * 24 * 7
    case 'months': return val * 24 * 30
    case 'years':  return val * 24 * 365
    default:       return val
  }
}

// ── Gem: buy amount labels ────────────────────────────────────────────────
function updateGemLabels() {
  const bscLbl = document.getElementById('gemBuyAmountBscLabel')
  const ethLbl = document.getElementById('gemBuyAmountEthLabel')
  const solLbl = document.getElementById('gemBuyAmountSolLabel')
  if (bscLbl) bscLbl.textContent = gemBuyMode === 'usd' ? 'Buy Amount BSC (USD $)' : 'Buy Amount (BNB)'
  if (ethLbl) ethLbl.textContent = gemBuyMode === 'usd' ? 'Buy Amount ETH (USD $)' : 'Buy Amount (ETH)'
  if (solLbl) solLbl.textContent = gemBuyMode === 'usd' ? 'Buy Amount SOL (USD $)' : 'Buy Amount (SOL)'
}

// ── Gem: buy mode toggle ──────────────────────────────────────────────────
function initGemBuyMode() {
  const pillNative = document.getElementById('gemModePillNative')
  const pillUsd    = document.getElementById('gemModePillUsd')
  if (!pillNative || !pillUsd) return
  const setMode = (mode) => {
    gemBuyMode = mode
    pillNative.classList.toggle('active', mode === 'native')
    pillUsd.classList.toggle('active',    mode === 'usd')
    updateGemLabels()
    updateGemDollarEquiv()
  }
  pillNative.addEventListener('click', () => setMode('native'))
  pillUsd.addEventListener('click',    () => setMode('usd'))
}

function updateGemDollarEquiv() {
  const bscInput = document.getElementById('gemBuyAmountBsc')
  const ethInput = document.getElementById('gemBuyAmountEth')
  const solInput = document.getElementById('gemBuyAmountSol')
  const bscEl    = document.getElementById('gemBscDollar')
  const ethEl    = document.getElementById('gemEthDollar')
  const solEl    = document.getElementById('gemSolDollar')

  if (bscInput && bscEl) {
    const amt = parseFloat(bscInput.value) || 0
    if (gemBuyMode === 'native') {
      bscEl.textContent = bnbPriceUsd > 0 ? `≈ $${(amt * bnbPriceUsd).toFixed(2)}` : '≈ $—'
    } else {
      bscEl.textContent = bnbPriceUsd > 0 ? `≈ ${(amt / bnbPriceUsd).toFixed(4)} BNB` : '≈ — BNB'
    }
  }
  if (ethInput && ethEl) {
    const amt = parseFloat(ethInput.value) || 0
    if (gemBuyMode === 'native') {
      ethEl.textContent = ethPriceUsd > 0 ? `≈ $${(amt * ethPriceUsd).toFixed(2)}` : '≈ $—'
    } else {
      ethEl.textContent = ethPriceUsd > 0 ? `≈ ${(amt / ethPriceUsd).toFixed(5)} ETH` : '≈ — ETH'
    }
  }
  if (solInput && solEl) {
    const amt = parseFloat(solInput.value) || 0
    if (gemBuyMode === 'native') {
      solEl.textContent = solPriceUsd > 0 ? `≈ $${(amt * solPriceUsd).toFixed(2)}` : '≈ $—'
    } else {
      solEl.textContent = solPriceUsd > 0 ? `≈ ${(amt / solPriceUsd).toFixed(4)} SOL` : '≈ — SOL'
    }
  }
}

// ── Gem Scanner: toggles ──────────────────────────────────────────────────
function initGemToggles() {
  const autoToggle   = document.getElementById('gemAutoToggle')
  const buyToggle    = document.getElementById('gemAutoBuyToggle')
  const buyCard      = document.getElementById('gemAutoBuyCard')

  autoToggle.addEventListener('change', async () => {
    if (!currentUser) return
    const enabled = autoToggle.checked
    await updateDoc(doc(db, 'users', currentUser.uid), { 'botSettings.gemAutoEnabled': enabled })
    document.getElementById('gemToggleSubtitle').textContent =
      enabled ? 'Scanning every 5 min — alerts via Telegram' : 'Auto-scan BSC & SOL for new gems'
    buyCard.style.display = enabled ? 'flex' : 'none'
  })

  buyToggle.addEventListener('change', async () => {
    if (!currentUser) return
    const enabled = buyToggle.checked
    await updateDoc(doc(db, 'users', currentUser.uid), { 'botSettings.gemAutoBuy': enabled })
    document.getElementById('gemAutoBuySubtitle').textContent =
      enabled ? 'Auto-buying high-score gems' : 'Automatically buy high-score gems'
  })
}

// ── Gem Scanner: save config ──────────────────────────────────────────────
async function saveGemConfig() {
  if (!currentUser) return
  const updates = {
    'botSettings.gemMinLiquidity': parseInt(document.getElementById('gemMinLiquidity').value) || 5000,
    'botSettings.gemMaxAge':       parseInt(document.getElementById('gemMaxAge').value)       || 24,
    'botSettings.gemMaxAgeUnit':   gemMaxAgeUnit,
    'botSettings.gemMinScore':     parseInt(document.getElementById('gemMinScore').value)     || 40,
    'botSettings.gemBuyAmountBsc': parseFloat(document.getElementById('gemBuyAmountBsc').value) || 0.005,
    'botSettings.gemBuyAmountEth': parseFloat(document.getElementById('gemBuyAmountEth').value) || 0.01,
    'botSettings.gemBuyAmountSol': parseFloat(document.getElementById('gemBuyAmountSol').value) || 0.05,
    'botSettings.gemBuyMode':      gemBuyMode,
  }

  const chains = []
  if (document.getElementById('gemChainBsc').checked)   chains.push('bsc')
  if (document.getElementById('gemChainEth').checked)   chains.push('eth')
  if (document.getElementById('gemChainSol').checked)   chains.push('sol')
  if (document.getElementById('gemChainBase').checked)  chains.push('base')
  if (document.getElementById('gemChainTon').checked)   chains.push('ton')
  if (document.getElementById('gemChainMatic').checked) chains.push('matic')
  updates['botSettings.gemChains'] = chains

  await updateDoc(doc(db, 'users', currentUser.uid), updates)
  showStatus('gemScanStatus', '✅ Gem config saved!')
}

// ── Gem Scanner: scanning overlay ─────────────────────────────────────────
const GEM_CHAIN_MAP = { bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base', ton: 'ton', matic: 'polygon' }

function showGemScanning(chains, stepLabel) {
  const list = document.getElementById('gemCardList')
  list.innerHTML = `
    <div class="arb-scanning-overlay gem-scanning-overlay">
      <div class="arb-scan-spinner-wrap">
        <div class="arb-scan-ring gem-ring"></div>
        <div class="arb-scan-ring arb-scan-ring-2 gem-ring-2"></div>
        <span class="arb-scan-icon">💎</span>
      </div>
      <div class="arb-scan-label" id="gemScanStep">${stepLabel || 'Initializing scan…'}</div>
      <div class="arb-scan-dex-list" id="gemScanLog"></div>
    </div>`
}

function updateGemScanStep(text) {
  const el = document.getElementById('gemScanStep')
  if (el) el.textContent = text

  const log = document.getElementById('gemScanLog')
  if (log) {
    const row = document.createElement('div')
    row.className = 'arb-scan-dex-item gem-scan-item'
    row.innerHTML = `<span class="arb-scan-dex-dot"></span><span class="arb-scan-dex-name">${text}</span>`
    log.appendChild(row)
    while (log.children.length > 8) log.removeChild(log.firstChild)
  }
}

function setGemBtnScanning(scanning) {
  const btn    = document.getElementById('scanGemsBtn')
  const iconEl = btn.querySelector('.gem-btn-icon')
  const textEl = btn.querySelector('.gem-btn-text')
  btn.disabled = scanning
  btn.classList.toggle('gem-btn-scanning', scanning)
  if (iconEl) iconEl.textContent = scanning ? '' : '💎'
  if (textEl) textEl.textContent = scanning ? 'Scanning…' : 'Scan Gems'
}

// ── Gem Scanner: client-side scoring algorithm ────────────────────────────
function scoreGemToken(pair) {
  let score = 0
  const liq = pair.liquidity?.usd || 0
  if (liq >= 5000 && liq <= 50000) score += 20
  else if (liq > 50000 && liq <= 200000) score += 15
  else if (liq > 200000 && liq <= 500000) score += 10
  else if (liq > 500000) score += 5
  else if (liq >= 2000) score += 8

  const vol24 = pair.volume?.h24 || 0
  if (liq > 0) {
    const vl = vol24 / liq
    if (vl >= 3) score += 20
    else if (vl >= 1.5) score += 16
    else if (vl >= 0.5) score += 12
    else if (vl >= 0.1) score += 6
  }

  const ageH = pair.pairCreatedAt
    ? (Date.now() - pair.pairCreatedAt) / (1e3 * 3600)
    : 9999
  if (ageH <= 1) score += 15
  else if (ageH <= 6) score += 13
  else if (ageH <= 24) score += 10
  else if (ageH <= 72) score += 6
  else if (ageH <= 168) score += 3

  const m5  = pair.priceChange?.m5  || 0
  const h1  = pair.priceChange?.h1  || 0
  const h24 = pair.priceChange?.h24 || 0
  if (m5 > 5) score += 5; else if (m5 > 0) score += 3
  if (h1 > 20) score += 8; else if (h1 > 5) score += 5; else if (h1 > 0) score += 2
  if (h24 > 50) score += 7; else if (h24 > 10) score += 5; else if (h24 > 0) score += 2

  const buys = pair.txns?.h24?.buys || 0
  const sells = pair.txns?.h24?.sells || 0
  const total = buys + sells
  if (total > 0) {
    const buyRatio = buys / total
    if (buyRatio >= 0.65) score += 15
    else if (buyRatio >= 0.55) score += 10
    else if (buyRatio >= 0.45) score += 5
  }

  if (pair.info?.websites?.length) score += 3
  if (pair.info?.socials?.length) score += 3
  if (pair.info?.imageUrl) score += 2
  if (pair.info?.header) score += 2

  return Math.min(100, Math.max(0, score))
}

// ── Gem Scanner: honeypot check (EVM — BSC chainID=56, ETH chainID=1) ─────
async function checkGemHoneypot(tokenAddress, chainID = 56) {
  try {
    const r = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=${chainID}`)
    const data = await r.json()
    const hp = data.honeypotResult || {}
    const sim = data.simulationResult || {}
    return {
      isHoneypot: hp.isHoneypot === true,
      buyTax:  sim.buyTax != null ? parseFloat(sim.buyTax) : null,
      sellTax: sim.sellTax != null ? parseFloat(sim.sellTax) : null,
      riskLevel: hp.isHoneypot ? 'DANGER'
        : (sim.sellTax > 10 ? 'HIGH' : (sim.sellTax > 5 ? 'MEDIUM' : 'LOW')),
    }
  } catch {
    return { isHoneypot: null, buyTax: null, sellTax: null, riskLevel: 'UNKNOWN' }
  }
}

// ── Gem Scanner: DEX label map ────────────────────────────────────────────
const GEM_DEX_LABELS = {
  pancakeswap: 'PancakeSwap', pancakeswap_v3: 'PancakeSwap V3',
  raydium: 'Raydium', raydium_clmm: 'Raydium CLMM',
  orca: 'Orca', meteora: 'Meteora', pumpfun: 'Pump.fun',
  uniswap_v2: 'Uniswap V2', uniswap_v3: 'Uniswap V3',
  aerodrome: 'Aerodrome', baseswap: 'BaseSwap', baseswap_v3: 'BaseSwap V3',
  sushiswap: 'SushiSwap', swapbased: 'SwapBased', alienbase: 'AlienBase',
  dedust: 'DeDust', stonfi: 'STON.fi', megaton: 'Megaton Finance',
}

// ── Gem Scanner: main scan (CLIENT-SIDE — no Cloud Function) ──────────────
async function scanGems() {
  const chains = []
  if (document.getElementById('gemChainBsc').checked)   chains.push('bsc')
  if (document.getElementById('gemChainEth').checked)   chains.push('eth')
  if (document.getElementById('gemChainSol').checked)   chains.push('sol')
  if (document.getElementById('gemChainBase').checked)  chains.push('base')
  if (document.getElementById('gemChainTon').checked)   chains.push('ton')
  if (document.getElementById('gemChainMatic').checked) chains.push('matic')

  if (!chains.length) {
    showStatus('gemScanStatus', 'Select at least one chain.', false)
    return
  }

  setGemBtnScanning(true)
  showGemScanning(chains, 'Discovering trending tokens…')

  const minLiquidity = parseInt(document.getElementById('gemMinLiquidity').value) || 5000
  const maxAgeHours  = gemMaxAgeInHours()
  const minScore     = parseInt(document.getElementById('gemMinScore').value) || 40

  try {
    // Step 1: Discover tokens from DexScreener profiles & boosts
    const tokenMap = new Map()

    updateGemScanStep('Fetching DexScreener latest profiles…')
    try {
      const r = await fetch('https://api.dexscreener.com/token-profiles/latest/v1')
      const data = await r.json()
      if (Array.isArray(data)) {
        for (const t of data) {
          for (const chain of chains) {
            if (t.chainId === GEM_CHAIN_MAP[chain] && t.tokenAddress) {
              tokenMap.set(t.tokenAddress.toLowerCase(), {
                address: t.tokenAddress, chain, icon: t.icon || '',
                links: t.links || [], description: t.description || '',
                boosted: false,
              })
            }
          }
        }
      }
    } catch { /* continue */ }

    updateGemScanStep('Fetching boosted tokens…')
    try {
      const r = await fetch('https://api.dexscreener.com/token-boosts/latest/v1')
      const data = await r.json()
      if (Array.isArray(data)) {
        for (const t of data) {
          for (const chain of chains) {
            if (t.chainId === GEM_CHAIN_MAP[chain] && t.tokenAddress) {
              const key = t.tokenAddress.toLowerCase()
              if (tokenMap.has(key)) {
                tokenMap.get(key).boosted = true
              } else {
                tokenMap.set(key, {
                  address: t.tokenAddress, chain, icon: '',
                  links: t.links || [], description: t.description || '',
                  boosted: true,
                })
              }
            }
          }
        }
      }
    } catch { /* continue */ }

    // Step 1c: Top boosted tokens (often has BSC tokens the latest feeds miss)
    updateGemScanStep('Fetching top boosted tokens…')
    try {
      const r = await fetch('https://api.dexscreener.com/token-boosts/top/v1')
      const data = await r.json()
      if (Array.isArray(data)) {
        for (const t of data) {
          for (const chain of chains) {
            if (t.chainId === GEM_CHAIN_MAP[chain] && t.tokenAddress) {
              const key = t.tokenAddress.toLowerCase()
              if (tokenMap.has(key)) {
                tokenMap.get(key).boosted = true
                if (t.description && !tokenMap.get(key).description) tokenMap.get(key).description = t.description
              } else {
                tokenMap.set(key, {
                  address: t.tokenAddress, chain, icon: '',
                  links: t.links || [], description: t.description || '',
                  boosted: true,
                })
              }
            }
          }
        }
      }
    } catch { /* continue */ }

    const allTokens = Array.from(tokenMap.values())
    const chainCounts = chains.map(c => {
      const label = c === 'bsc' ? 'BSC' : c === 'eth' ? 'ETH' : c === 'sol' ? 'SOL' : c === 'base' ? 'Base' : c === 'matic' ? 'Polygon' : 'TON'
      return `${label}: ${allTokens.filter(t => t.chain === c).length}`
    }).join(', ')
    updateGemScanStep(`Found ${allTokens.length} tokens (${chainCounts}). Fetching pair data…`)

    if (!allTokens.length) {
      document.getElementById('gemCardList').innerHTML =
        '<div class="empty-state">No trending tokens found on selected chains right now.</div>'
      showStatus('gemScanStatus', 'No trending tokens found.', false)
      setGemBtnScanning(false)
      return
    }

    // Step 2: Batch-fetch pair data
    const BATCH_SZ = 30
    const allPairs = []
    const addresses = allTokens.map(t => t.address)

    for (let i = 0; i < addresses.length; i += BATCH_SZ) {
      const batch = addresses.slice(i, i + BATCH_SZ)
      updateGemScanStep(`Fetching pairs ${i + 1}–${Math.min(i + BATCH_SZ, addresses.length)} of ${addresses.length}…`)
      try {
        const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + batch.join(','))
        const data = await r.json()
        if (data.pairs) allPairs.push(...data.pairs)
      } catch { /* skip */ }
      if (i + BATCH_SZ < addresses.length) await new Promise(r => setTimeout(r, 350))
    }

    updateGemScanStep(`Got ${allPairs.length} pairs. Scoring & filtering…`)

    // Step 3: Best pair per token, filter
    const bestPairs = new Map()
    for (const pair of allPairs) {
      let pairChain = null
      if      (pair.chainId === 'bsc'      && chains.includes('bsc'))   pairChain = 'bsc'
      else if (pair.chainId === 'ethereum' && chains.includes('eth'))   pairChain = 'eth'
      else if (pair.chainId === 'solana'   && chains.includes('sol'))   pairChain = 'sol'
      else if (pair.chainId === 'base'     && chains.includes('base'))  pairChain = 'base'
      else if (pair.chainId === 'ton'      && chains.includes('ton'))   pairChain = 'ton'
      else if (pair.chainId === 'polygon'  && chains.includes('matic')) pairChain = 'matic'
      if (!pairChain) continue

      const addr = (pair.baseToken?.address || '').toLowerCase()
      const liq = pair.liquidity?.usd || 0
      if (liq < minLiquidity) continue
      if ((pair.volume?.h24 || 0) < 1000) continue

      if (pair.pairCreatedAt) {
        const ageH = (Date.now() - pair.pairCreatedAt) / (1e3 * 3600)
        if (ageH > maxAgeHours) continue
      }

      const existing = bestPairs.get(addr)
      if (!existing || liq > (existing.pair.liquidity?.usd || 0)) {
        bestPairs.set(addr, { pair, chain: pairChain })
      }
    }

    // Step 4: Score, honeypot check, build gems
    const gems = []
    const entries = Array.from(bestPairs.entries())
    let hpCount = 0

    for (const [addr, { pair, chain }] of entries) {
      const gemScore = scoreGemToken(pair)
      if (gemScore < minScore) continue

      let safety = { riskLevel: 'N/A' }
      if (chain === 'bsc' || chain === 'eth') {
        hpCount++
        updateGemScanStep(`Honeypot check ${hpCount}… (${pair.baseToken?.symbol || '…'})`)
        safety = await checkGemHoneypot(pair.baseToken?.address || addr, chain === 'eth' ? 1 : 56)
        if (safety.isHoneypot === true) continue
        if (safety.sellTax != null && safety.sellTax > 15) continue
      } else if (chain === 'base') {
        safety = { riskLevel: 'UNVERIFIED' }
      } else if (chain === 'ton') {
        safety = { riskLevel: 'UNVERIFIED' }
      }

      const meta = tokenMap.get(addr) || {}
      const ageHours = pair.pairCreatedAt
        ? (Date.now() - pair.pairCreatedAt) / (1e3 * 3600)
        : null

      gems.push({
        chain,
        tokenAddress: pair.baseToken?.address || addr,
        tokenName:    pair.baseToken?.name || 'Unknown',
        tokenSymbol:  pair.baseToken?.symbol || '???',
        pairAddress:  pair.pairAddress,
        dexId:        pair.dexId,
        dexName:      GEM_DEX_LABELS[pair.dexId] || pair.dexId,
        priceUsd:     parseFloat(pair.priceUsd || 0),
        liquidity:    pair.liquidity?.usd || 0,
        volume24h:    pair.volume?.h24 || 0,
        marketCap:    pair.marketCap || pair.fdv || 0,
        fdv:          pair.fdv || 0,
        priceChange5m:  pair.priceChange?.m5 || 0,
        priceChange1h:  pair.priceChange?.h1 || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        buys24h:  pair.txns?.h24?.buys  || 0,
        sells24h: pair.txns?.h24?.sells || 0,
        buys1h:   pair.txns?.h1?.buys   || 0,
        sells1h:  pair.txns?.h1?.sells  || 0,
        ageHours: ageHours ? parseFloat(ageHours.toFixed(1)) : null,
        gemScore,
        safety,
        boosted:     !!meta.boosted,
        hasWebsite:  !!(meta.links?.length || pair.info?.websites?.length),
        hasSocials:  !!(pair.info?.socials?.length),
        icon:        meta.icon || pair.info?.imageUrl || null,
        description: meta.description || '',
        dexUrl:      pair.url || '',
        quoteSymbol: pair.quoteToken?.symbol || '',
      })
    }

    gems.sort((a, b) => b.gemScore - a.gemScore)
    const topGems = gems.slice(0, 50)

    gemResults = topGems
    activeChainFilter = 'all'
    updateGemFilterPills()
    renderGemCards(topGems)

    document.getElementById('gemStatFound').textContent = topGems.length
    const ts = new Date().toLocaleTimeString()
    document.getElementById('gemLastScan').textContent = `Last scan: ${ts}`

    showStatus('gemScanStatus',
      topGems.length
        ? `Found ${topGems.length} gem${topGems.length === 1 ? '' : 's'}!`
        : 'No gems found — try lowering the min score or extending the max age.'
    )

    // Record calls & send notifications for new gems
    if (topGems.length) await recordGemCalls(topGems)
  } catch (err) {
    document.getElementById('gemCardList').innerHTML =
      `<div class="empty-state" style="color:#f44336">Scan error: ${err.message}</div>`
    showStatus('gemScanStatus', `Error: ${err.message}`, false)
  } finally {
    setGemBtnScanning(false)
  }
}

// ── Gem Scanner: chain filter ─────────────────────────────────────────────
function updateGemFilterPills() {
  document.querySelectorAll('#gemChainFilter .gem-filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.chain === activeChainFilter)
  })
}

function applyGemFilter(chain) {
  activeChainFilter = chain
  updateGemFilterPills()
  const filtered = chain === 'all' ? gemResults : gemResults.filter(g => g.chain === chain)
  renderGemCards(filtered)
}

// ── Gem Scanner: render cards ─────────────────────────────────────────────
function fmtCompact(num) {
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B'
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M'
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(1) + 'K'
  return '$' + num.toLocaleString()
}

function renderGemCards(gems) {
  const list = document.getElementById('gemCardList')

  if (!gems.length) {
    list.innerHTML = '<div class="empty-state">No gems found above your thresholds.</div>'
    return
  }

  list.innerHTML = gems.map((gem, idx) => {
    const scoreClass = gem.gemScore >= 70 ? 'gem-score-high'
                     : gem.gemScore >= 40 ? 'gem-score-mid'
                     : 'gem-score-low'

    const chainKey    = gem.chain
    const chainTicker = gem.chain === 'bsc' ? 'BNB' : gem.chain === 'eth' ? 'ETH' : gem.chain === 'sol' ? 'SOL' : gem.chain === 'base' ? 'ETH' : gem.chain === 'matic' ? 'MATIC' : 'TON'
    const _canBuy     = gem.chain === 'bsc' || gem.chain === 'eth' || gem.chain === 'sol' || gem.chain === 'base' || gem.chain === 'matic'
    const _inputAmt   = gem.chain === 'sol'
      ? (parseFloat(document.getElementById('gemBuyAmountSol').value) || (gemBuyMode === 'usd' ? 5 : 0.05))
      : gem.chain === 'eth'
      ? (parseFloat(document.getElementById('gemBuyAmountEth').value) || (gemBuyMode === 'usd' ? 5 : 0.01))
      : (parseFloat(document.getElementById('gemBuyAmountBsc').value) || (gemBuyMode === 'usd' ? 5 : 0.005))
    const _nativePrice = gem.chain === 'bsc' ? bnbPriceUsd : (gem.chain === 'base' || gem.chain === 'eth') ? ethPriceUsd : gem.chain === 'matic' ? maticPriceUsd : solPriceUsd
    const buyAmount   = gemBuyMode === 'usd' && _nativePrice > 0
      ? _inputAmt / _nativePrice
      : _inputAmt
    const buyDollar   = gemBuyMode === 'usd'
      ? ` (≈$${_inputAmt.toFixed(2)})`
      : (_nativePrice > 0 ? ` (≈$${(buyAmount * _nativePrice).toFixed(2)})` : '')

    const priceStr = gem.priceUsd < 0.00001
      ? '$' + gem.priceUsd.toExponential(3)
      : '$' + gem.priceUsd.toFixed(8)

    const ageStr = gem.ageHours != null
      ? (gem.ageHours < 1 ? `${Math.round(gem.ageHours * 60)}m` : `${gem.ageHours.toFixed(1)}h`)
      : '?'

    const mcapStr = gem.marketCap > 0 ? fmtCompact(gem.marketCap) : '—'

    // Safety row for EVM honeypot-checked chains (BSC, ETH)
    let safetyHtml = ''
    if ((gem.chain === 'bsc' || gem.chain === 'eth') && gem.safety && gem.safety.riskLevel !== 'N/A') {
      const riskClass = gem.safety.riskLevel === 'LOW' ? 'gem-risk-low'
                      : gem.safety.riskLevel === 'MEDIUM' ? 'gem-risk-med'
                      : gem.safety.riskLevel === 'HIGH' ? 'gem-risk-high'
                      : gem.safety.riskLevel === 'DANGER' ? 'gem-risk-danger'
                      : 'gem-risk-unknown'
      safetyHtml = `
        <div class="gem-safety-row">
          <span class="gem-risk-badge ${riskClass}">${gem.safety.riskLevel}</span>
          ${gem.safety.sellTax != null ? `<span class="gem-tax">Sell Tax: ${gem.safety.sellTax}%</span>` : ''}
          ${gem.safety.buyTax != null ? `<span class="gem-tax">Buy Tax: ${gem.safety.buyTax}%</span>` : ''}
        </div>`
    }

    // Momentum arrows
    const momentum = (val) => {
      if (val > 0) return `<span class="gem-up">+${val.toFixed(1)}%</span>`
      if (val < 0) return `<span class="gem-down">${val.toFixed(1)}%</span>`
      return `<span>0%</span>`
    }

    // Buy/sell ratio bar
    const totalTxns = gem.buys24h + gem.sells24h
    const buyPct = totalTxns > 0 ? Math.round((gem.buys24h / totalTxns) * 100) : 50

    // Explorer URL
    const explorerBase = gem.chain === 'bsc'   ? 'https://bscscan.com/token/'
      : gem.chain === 'eth'   ? 'https://etherscan.io/token/'
      : gem.chain === 'sol'   ? 'https://solscan.io/token/'
      : gem.chain === 'base'  ? 'https://basescan.org/token/'
      : gem.chain === 'matic' ? 'https://polygonscan.com/token/'
      : 'https://tonscan.org/address/'
    const shortCA = gem.tokenAddress.length > 16
      ? gem.tokenAddress.slice(0, 8) + '…' + gem.tokenAddress.slice(-6)
      : gem.tokenAddress

    // Description snippet
    const descSnippet = gem.description
      ? `<div class="gem-detail-desc">${gem.description.slice(0, 200)}${gem.description.length > 200 ? '…' : ''}</div>`
      : ''

    // DexScreener link
    const dexScreenerChain = GEM_CHAIN_MAP[gem.chain] || gem.chain
    const dexLink = gem.dexUrl || `https://dexscreener.com/${dexScreenerChain}/${gem.tokenAddress}`

    return `
      <div class="gem-card" data-idx="${idx}">
        <div class="gem-card-header gem-card-clickable">
          <div class="gem-card-title">
            <span class="chain-pill-sm ${chainKey}">${chainTicker}</span>
            <span class="gem-token-name">${gem.tokenName}</span>
            <span class="gem-token-symbol">${gem.tokenSymbol}</span>
            ${gem.boosted ? '<span class="gem-boost-tag">🚀 Boosted</span>' : ''}
          </div>
          <div class="gem-card-right">
            <span class="gem-score-badge ${scoreClass}">${gem.gemScore}</span>
            <span class="gem-expand-icon">▼</span>
          </div>
        </div>

        <div class="gem-card-body">
          <div class="gem-stat-grid">
            <div class="gem-stat">
              <span class="gem-stat-label">Price</span>
              <span class="gem-stat-value">${priceStr}</span>
            </div>
            <div class="gem-stat">
              <span class="gem-stat-label">Market Cap</span>
              <span class="gem-stat-value">${mcapStr}</span>
            </div>
            <div class="gem-stat">
              <span class="gem-stat-label">Liquidity</span>
              <span class="gem-stat-value">$${gem.liquidity.toLocaleString()}</span>
            </div>
            <div class="gem-stat">
              <span class="gem-stat-label">Vol 24h</span>
              <span class="gem-stat-value">$${gem.volume24h.toLocaleString()}</span>
            </div>
          </div>

          <div class="gem-momentum-row">
            <span>5m: ${momentum(gem.priceChange5m)}</span>
            <span>1h: ${momentum(gem.priceChange1h)}</span>
            <span>24h: ${momentum(gem.priceChange24h)}</span>
            <span style="margin-left:auto;font-size:0.78rem;color:#848E9C">${ageStr} old</span>
          </div>
        </div>

        <!-- Expandable detail section (hidden by default) -->
        <div class="gem-detail-panel" id="gemDetail${idx}">
          <div class="gem-detail-section">
            <div class="gem-detail-grid">
              <div class="gem-stat">
                <span class="gem-stat-label">FDV</span>
                <span class="gem-stat-value">${gem.fdv > 0 ? fmtCompact(gem.fdv) : '—'}</span>
              </div>
              <div class="gem-stat">
                <span class="gem-stat-label">DEX</span>
                <span class="gem-stat-value">${gem.dexName}</span>
              </div>
              <div class="gem-stat">
                <span class="gem-stat-label">Pair</span>
                <span class="gem-stat-value">${gem.quoteSymbol ? gem.tokenSymbol + '/' + gem.quoteSymbol : '—'}</span>
              </div>
              <div class="gem-stat">
                <span class="gem-stat-label">Score</span>
                <span class="gem-stat-value gem-${gem.gemScore >= 70 ? 'up' : gem.gemScore >= 40 ? 'up' : 'down'}">${gem.gemScore}/100</span>
              </div>
            </div>
          </div>

          <div class="gem-detail-section">
            <div class="gem-detail-label">Transactions (24h)</div>
            <div class="gem-txn-bar-wrap">
              <div class="gem-txn-bar">
                <div class="gem-txn-bar-buy" style="width:${buyPct}%"></div>
              </div>
              <div class="gem-txn-bar-labels">
                <span class="gem-buys">🟢 ${gem.buys24h} buys (${buyPct}%)</span>
                <span class="gem-sells">🔴 ${gem.sells24h} sells (${100 - buyPct}%)</span>
              </div>
            </div>
          </div>

          ${safetyHtml}

          ${descSnippet}

          <div class="gem-detail-section">
            <div class="gem-detail-label">Contract Address</div>
            <div class="gem-detail-ca">
              <a href="${explorerBase}${gem.tokenAddress}" target="_blank" class="gem-ca-link">${shortCA}</a>
              <button class="gem-copy-btn" data-copy="${gem.tokenAddress}" title="Copy CA">📋</button>
            </div>
          </div>

          <div class="gem-detail-links">
            <a href="${dexLink}" target="_blank" class="gem-link-btn">📊 DexScreener</a>
            <a href="${explorerBase}${gem.tokenAddress}" target="_blank" class="gem-link-btn">
              ${gem.chain === 'bsc' ? '🔍 BscScan' : gem.chain === 'eth' ? '🔍 Etherscan' : gem.chain === 'base' ? '🔍 BaseScan' : gem.chain === 'ton' ? '🔍 TONScan' : gem.chain === 'matic' ? '🔍 PolygonScan' : '🔍 Solscan'}
            </a>
          </div>
        </div>

        <div class="gem-card-actions">
          ${_canBuy
            ? `<button class="gem-buy-btn" data-idx="${idx}">Buy ${buyAmount} ${chainTicker}${buyDollar}</button>`
            : `<a href="${dexLink}" target="_blank" class="gem-buy-btn gem-trade-link">Trade on DexScreener ↗</a>`
          }
          <a href="${dexLink}" target="_blank" class="gem-explorer-link" title="DexScreener">📊</a>
          <a href="${explorerBase}${gem.tokenAddress}"
             target="_blank" class="gem-explorer-link" title="Explorer">↗</a>
        </div>
      </div>`
  }).join('')

  // Buy button handlers
  list.querySelectorAll('.gem-buy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      buyGem(parseInt(btn.dataset.idx))
    })
  })

  // Card expand/collapse handlers
  list.querySelectorAll('.gem-card-clickable').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.closest('.gem-card')
      const idx = card.dataset.idx
      const panel = document.getElementById('gemDetail' + idx)
      const icon = header.querySelector('.gem-expand-icon')
      const isOpen = card.classList.toggle('gem-card-expanded')
      if (panel) panel.style.display = isOpen ? 'block' : 'none'
      if (icon) icon.textContent = isOpen ? '▲' : '▼'
    })
  })

  // Copy CA button handlers
  list.querySelectorAll('.gem-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        btn.textContent = '✅'
        setTimeout(() => { btn.textContent = '📋' }, 1500)
      })
    })
  })

  // Prevent link clicks from triggering card expand
  list.querySelectorAll('.gem-explorer-link, .gem-link-btn, .gem-ca-link').forEach(link => {
    link.addEventListener('click', (e) => e.stopPropagation())
  })
}

// ── Gem Scanner: buy a gem ────────────────────────────────────────────────
async function buyGem(idx) {
  const gem = gemResults[idx]
  if (!gem) return

  if (gem.chain !== 'bsc' && gem.chain !== 'eth' && gem.chain !== 'sol' && gem.chain !== 'base' && gem.chain !== 'matic') return
  const chainTicker  = gem.chain === 'bsc' ? 'BNB' : gem.chain === 'eth' ? 'ETH' : gem.chain === 'base' ? 'ETH' : gem.chain === 'matic' ? 'MATIC' : 'SOL'
  const _rawAmt      = gem.chain === 'sol'
    ? (parseFloat(document.getElementById('gemBuyAmountSol').value) || (gemBuyMode === 'usd' ? 5 : 0.05))
    : gem.chain === 'eth'
    ? (parseFloat(document.getElementById('gemBuyAmountEth').value) || (gemBuyMode === 'usd' ? 5 : 0.01))
    : (parseFloat(document.getElementById('gemBuyAmountBsc').value) || (gemBuyMode === 'usd' ? 5 : 0.005))
  const _nativePrice = gem.chain === 'bsc' ? bnbPriceUsd : (gem.chain === 'base' || gem.chain === 'eth') ? ethPriceUsd : gem.chain === 'matic' ? maticPriceUsd : solPriceUsd
  const buyAmount    = gemBuyMode === 'usd' && _nativePrice > 0
    ? _rawAmt / _nativePrice
    : _rawAmt

  const list = document.getElementById('gemCardList')
  const card = list.querySelectorAll('.gem-card')[idx]
  const btn  = card?.querySelector('.gem-buy-btn')
  if (btn) btn.disabled = true

  showTxPopup(gem, buyAmount, chainTicker)

  const explorerBase = gem.chain === 'bsc'   ? 'https://bscscan.com/tx/'
                     : gem.chain === 'eth'   ? 'https://etherscan.io/tx/'
                     : gem.chain === 'base'  ? 'https://basescan.org/tx/'
                     : gem.chain === 'matic' ? 'https://polygonscan.com/tx/'
                     : 'https://solscan.io/tx/'

  try {
    let tx

    const result = await fnExecuteTrade({
      chain: gem.chain,
      tokenAddress: gem.tokenAddress,
      action: 'buy',
      amount: String(buyAmount),
      percent: null,
      slippage: 10,
    })
    tx = result.data

    gemBoughtCount++
    document.getElementById('gemStatBought').textContent = gemBoughtCount

    resolveTxPopup(true, { txHash: tx.txHash, explorerBase })

    if (tx.txHash && card) {
      card.querySelector('.gem-card-actions').innerHTML =
        `<span class="gem-bought-label">✅ Bought</span>` +
        `<a href="${explorerBase}${tx.txHash}" target="_blank" class="bot-tx-link">View TX ↗</a>`
    }

    setTimeout(() => listenHistory(), 1000)
  } catch (err) {
    resolveTxPopup(false, { errorMsg: err.message })
    if (btn) btn.disabled = false
  }
}

// ── Gem Calls: notifications ──────────────────────────────────────────────
function updateNotifBtnState() {
  const btn = document.getElementById('gemNotifBtn')
  if (!btn) return
  const permission = ('Notification' in window) ? Notification.permission : 'unsupported'
  if (permission === 'granted') {
    btn.textContent = '🔔 Notifications ON'
    btn.classList.add('gem-notif-on')
    btn.classList.remove('gem-notif-blocked')
  } else if (permission === 'denied') {
    btn.textContent = '🔕 Notifications Blocked'
    btn.classList.add('gem-notif-blocked')
    btn.classList.remove('gem-notif-on')
  } else if (permission === 'unsupported') {
    btn.textContent = '🔕 Notifications Not Supported'
    btn.disabled = true
  } else {
    btn.textContent = '🔔 Enable Gem Notifications'
    btn.classList.remove('gem-notif-on', 'gem-notif-blocked')
  }
}

async function requestGemNotifications() {
  if (!('Notification' in window)) return
  await Notification.requestPermission()
  updateNotifBtnState()
}

function sendGemNotification(gem) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const priceStr = gem.priceUsd < 0.00001
    ? '$' + gem.priceUsd.toExponential(3)
    : '$' + gem.priceUsd.toFixed(8)
  new Notification(`💎 Gem Found: ${gem.tokenName} (${gem.tokenSymbol})`, {
    body: `Score: ${gem.gemScore}/100 · Price: ${priceStr} · ${gem.chain.toUpperCase()}`,
    icon: gem.icon || '/logo.svg',
    tag: `gem-${gem.tokenAddress}`,
  })
}

// ── Gem Calls: record to Firestore ────────────────────────────────────────
async function recordGemCalls(gems) {
  if (!currentUser || !gems.length) return
  const col = collection(db, 'users', currentUser.uid, 'gemCalls')
  const recentCutoff = Date.now() - 4 * 60 * 60 * 1000
  let newCount = 0

  for (const gem of gems) {
    // Skip if same token was called in the last 4 hours
    const exists = gemCalls.some(c =>
      c.tokenAddress.toLowerCase() === gem.tokenAddress.toLowerCase() &&
      c.calledAtMs > recentCutoff
    )
    if (exists) continue

    try {
      await addDoc(col, {
        tokenAddress:    gem.tokenAddress,
        tokenName:       gem.tokenName,
        tokenSymbol:     gem.tokenSymbol,
        chain:           gem.chain,
        priceAtCall:     gem.priceUsd,
        liquidityAtCall: gem.liquidity,
        marketCapAtCall: gem.marketCap,
        gemScore:        gem.gemScore,
        calledAt:        serverTimestamp(),
        calledAtMs:      Date.now(),
        perf1h:  null,
        perf4h:  null,
        perf24h: null,
        perf1w:  null,
      })
      newCount++
      sendGemNotification(gem)
    } catch (e) {
      console.error('recordGemCall:', e)
    }
  }

  if (newCount > 0) {
    const alertEl = document.getElementById('gemStatAlerts')
    if (alertEl) alertEl.textContent = parseInt(alertEl.textContent || '0') + newCount
  }
}

// ── Gem Calls: fetch current price ────────────────────────────────────────
async function fetchCurrentPrice(tokenAddress, chain) {
  const chainId = GEM_CHAIN_MAP[chain] || 'solana'
  try {
    const r = await fetch(`https://api.dexscreener.com/token-pairs/v1/${chainId}/${tokenAddress}`)
    if (!r.ok) return null
    const pairs = await r.json()
    if (!Array.isArray(pairs) || !pairs.length) return null
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))
    const price = parseFloat(pairs[0].priceUsd || 0)
    return price > 0 ? price : null
  } catch { return null }
}

// ── Gem Calls: update performance snapshots ────────────────────────────────
async function updateGemPerformanceSnapshots(calls) {
  if (!currentUser || !calls.length) return
  const now = Date.now()

  // Collect which calls need which windows updated
  const pending = []
  for (const call of calls) {
    if (!call.calledAtMs) continue
    for (const win of PERF_WINDOWS) {
      if (call[win.key] !== null) continue
      if (now >= call.calledAtMs + win.ms) pending.push({ call, win })
    }
  }
  if (!pending.length) return

  // Fetch prices; cache per token to avoid duplicate calls
  const priceCache = {}
  for (const { call, win } of pending) {
    const cacheKey = call.tokenAddress.toLowerCase()
    if (!(cacheKey in priceCache)) {
      priceCache[cacheKey] = await fetchCurrentPrice(call.tokenAddress, call.chain)
      // Small delay to avoid hammering DexScreener
      await new Promise(r => setTimeout(r, 200))
    }
    const currentPrice = priceCache[cacheKey]
    if (currentPrice == null) continue

    const changePercent = call.priceAtCall > 0
      ? parseFloat((((currentPrice - call.priceAtCall) / call.priceAtCall) * 100).toFixed(2))
      : 0

    try {
      await updateDoc(doc(db, 'users', currentUser.uid, 'gemCalls', call.id), {
        [win.key]: { price: currentPrice, changePercent, snapshotAt: now }
      })
    } catch (e) {
      console.error('updateGemSnapshot:', e)
    }
  }
}

// ── Gem Calls: success rate computation ───────────────────────────────────
function computeSuccessRates(calls) {
  const result = {}
  for (const win of PERF_WINDOWS) {
    const key = win.key.replace('perf', '')
    const withData = calls.filter(c => c[win.key] !== null)
    if (!withData.length) { result[key] = { rate: null, successful: 0, total: 0 }; continue }
    const successful = withData.filter(c => c[win.key].changePercent > 0).length
    result[key] = {
      rate: Math.round((successful / withData.length) * 100),
      successful,
      total: withData.length,
    }
  }
  return result
}

// ── Gem Calls: time ago formatter ─────────────────────────────────────────
function formatTimeAgo(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60)  return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Gem Calls: render panel ────────────────────────────────────────────────
function renderGemCallsPanel(calls) {
  // Update success rate cards
  const rates = computeSuccessRates(calls)
  for (const [key, data] of Object.entries(rates)) {
    const rateEl  = document.getElementById(`gemSuccessRate${key}`)
    const countEl = document.getElementById(`gemSuccessCount${key}`)
    if (rateEl) {
      rateEl.textContent = data.rate != null ? data.rate + '%' : '—'
      rateEl.className = 'gem-success-rate' + (
        data.rate == null ? '' :
        data.rate >= 60   ? ' gem-success-high' :
        data.rate >= 40   ? ' gem-success-mid'  : ' gem-success-low'
      )
    }
    if (countEl) countEl.textContent = data.total > 0 ? `${data.successful}/${data.total}` : ''
  }

  const list = document.getElementById('gemCallsList')
  if (!list) return

  if (!calls.length) {
    list.innerHTML = '<div class="empty-state">No gem calls recorded yet. Run a scan to start tracking.</div>'
    return
  }

  list.innerHTML = calls.slice(0, 30).map(call => {
    const chainKey  = call.chain === 'bsc' ? 'bsc' : 'sol'
    const ticker    = chainKey === 'bsc' ? 'BNB' : 'SOL'
    const agoMs     = call.calledAtMs ? Date.now() - call.calledAtMs : null
    const agoStr    = agoMs != null ? formatTimeAgo(agoMs) : '—'
    const scoreClass = call.gemScore >= 70 ? 'gem-score-high' : call.gemScore >= 40 ? 'gem-score-mid' : 'gem-score-low'
    const priceStr  = call.priceAtCall < 0.00001
      ? '$' + call.priceAtCall.toExponential(3)
      : '$' + call.priceAtCall.toFixed(8)

    const perfCells = PERF_WINDOWS.map(win => {
      const snap = call[win.key]
      if (!snap) {
        const isDue = call.calledAtMs && Date.now() >= call.calledAtMs + win.ms
        return `<div class="gem-perf-cell">
          <span class="gem-perf-label">${win.label}</span>
          <span class="gem-perf-val gem-perf-pending">${isDue ? '…' : 'pending'}</span>
        </div>`
      }
      const isUp  = snap.changePercent > 0
      const isFlat = snap.changePercent === 0
      const cls   = isUp ? 'gem-up' : (isFlat ? '' : 'gem-down')
      return `<div class="gem-perf-cell">
        <span class="gem-perf-label">${win.label}</span>
        <span class="gem-perf-val ${cls}">${isUp ? '+' : ''}${snap.changePercent.toFixed(1)}%</span>
      </div>`
    }).join('')

    return `
      <div class="gem-call-card">
        <div class="gem-call-header">
          <span class="chain-pill-sm ${chainKey}">${ticker}</span>
          <span class="gem-call-name">${call.tokenName}</span>
          <span class="gem-token-symbol">${call.tokenSymbol}</span>
          <span class="gem-score-badge ${scoreClass}" style="min-width:28px;height:28px;font-size:11px">${call.gemScore}</span>
          <span class="gem-call-time">${agoStr}</span>
        </div>
        <div class="gem-call-entry">Entry: <strong>${priceStr}</strong></div>
        <div class="gem-perf-row">${perfCells}</div>
      </div>`
  }).join('')
}

// ── Gem Calls: Firestore listener ─────────────────────────────────────────
function listenGemCalls() {
  if (!currentUser) return
  if (unsubGemCalls) unsubGemCalls()
  const q = query(
    collection(db, 'users', currentUser.uid, 'gemCalls'),
    orderBy('calledAtMs', 'desc'),
    limit(100)
  )
  unsubGemCalls = onSnapshot(q, async snap => {
    gemCalls = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    renderGemCallsPanel(gemCalls)
    // Update pending snapshots in the background
    updateGemPerformanceSnapshots(gemCalls).then(() => {}).catch(() => {})
  })
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs()
  initMenu()

  initChainPills('snipeChainPills', c => {
    snipeChain = c
    const lbl = document.getElementById('snipeAmountLabel')
    if (lbl) lbl.textContent = snipeAmountMode === 'usd' ? 'Buy Amount (USD $)' : `Buy Amount (${chainLabel(c)})`
    updateSnipeDollarEquiv()
  })
  initChainPills('tradeChainPills', c => {
    tradeChain = c
    const lbl = document.getElementById('buyAmountLabel')
    if (lbl) lbl.textContent = buyAmountMode === 'usd' ? 'Amount (USD $)' : `Amount (${chainLabel(c)})`
    updateBuyDollarEquiv()
  })

  initAmountInputs()
  document.getElementById('addSnipeBtn').addEventListener('click', addSnipeTarget)
  document.getElementById('checkTokenBtn').addEventListener('click', checkToken)
  document.getElementById('buyBtn').addEventListener('click',  () => executeTrade('buy'))
  document.getElementById('sellBtn').addEventListener('click', () => executeTrade('sell'))
  document.getElementById('refreshBalBtn').addEventListener('click', refreshBalances)
  document.getElementById('saveBotConfigBtn').addEventListener('click', saveBotConfig)
  document.getElementById('generateLinkCodeBtn').addEventListener('click', generateLinkCode)

  document.getElementById('copyWebhookBtn').addEventListener('click', () => {
    copyText(document.getElementById('webhookUrl').textContent, 'telegramStatus')
  })

  document.getElementById('copyLinkCodeBtn').addEventListener('click', () => {
    copyText(document.getElementById('linkCodeText').textContent, 'telegramStatus')
  })
  // Gem Scanner events
  document.getElementById('scanGemsBtn').addEventListener('click', scanGems)
  document.getElementById('gemChainFilter').addEventListener('click', (e) => {
    const pill = e.target.closest('.gem-filter-pill')
    if (pill) applyGemFilter(pill.dataset.chain)
  })
  document.getElementById('saveGemConfigBtn').addEventListener('click', saveGemConfig)
  document.getElementById('gemBuyAmountBsc').addEventListener('input', updateGemDollarEquiv)
  document.getElementById('gemBuyAmountEth').addEventListener('input', updateGemDollarEquiv)
  document.getElementById('gemBuyAmountSol').addEventListener('input', updateGemDollarEquiv)
  document.getElementById('gemMaxAgeUnit').addEventListener('change', (e) => { gemMaxAgeUnit = e.target.value })
  document.getElementById('gemNotifBtn').addEventListener('click', requestGemNotifications)
  updateNotifBtnState()
  initGemToggles()
  initGemBuyMode()

  document.querySelectorAll('.save-wallet-btn').forEach(btn => {
    btn.addEventListener('click', () => saveWallet(btn.dataset.chain))
  })
  document.querySelectorAll('.bot-remove-wallet-btn').forEach(btn => {
    btn.addEventListener('click', () => removeWallet(btn.dataset.chain))
  })
  setupLinkWalletModal()

  initBotToggle()

  requireAuth(async user => {
    currentUser = user

    // Profile initials
    let initials = user.email[0].toUpperCase()
    try {
      const snap = await getDoc(doc(db, 'users', user.uid))
      if (snap.exists()) {
        const d = snap.data()
        if (d.firstName || d.lastName) {
          initials = ((d.firstName?.[0] || '') + (d.lastName?.[0] || '')).toUpperCase()
        }
      }
    } catch (_) {}
    document.getElementById('profileInitials').textContent = initials

    // Load settings
    const settings = await loadSettings()
    const enabled  = settings.botEnabled || false
    document.getElementById('botToggle').checked = enabled
    setStatusBadge(enabled)
    await populateSettings(settings)

    // Start listeners
    listenSnipes()
    listenHistory()
    listenGemCalls()
    refreshBalances()
    fetchNativePrices()  // Load BNB/SOL prices for dollar equivalents
  })
})

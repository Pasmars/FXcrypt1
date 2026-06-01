import { requireAuth }        from './authObserver.js'
import { signOut }             from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js'
import {
  doc, getDoc, collection, query, orderBy, limit, getDocs, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js'
import { app, auth, db } from './firebase.js'

// ── Cloud Functions ───────────────────────────────────────────────────────────
const fns             = getFunctions(app, 'europe-west1')
const fnSaveAgentSettings = httpsCallable(fns, 'saveAgentSettings')
const fnSaveCexApiKey     = httpsCallable(fns, 'saveCexApiKey')
const fnRemoveCexApiKey   = httpsCallable(fns, 'removeCexApiKey')
const fnGetCexBalances    = httpsCallable(fns, 'getCexBalances')
const fnRunAgentScan      = httpsCallable(fns, 'runAgentScan',  { timeout: 300000 })
const fnApproveTrade      = httpsCallable(fns, 'approveTrade')
const fnSkipSignal        = httpsCallable(fns, 'skipSignal')

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser         = null
let agentSettings       = {}
let configuredExchanges = []   // exchanges that have API keys set (populated on load)
let signalMktFilter     = 'all' // 'all' | 'spot' | 'futures'
let _signalsCache       = {}   // signalId → signal object, for popup display
let _agentTxBackdrop    = null
let _agentTxTimer       = null

const AGENT_TX_STEPS = ['Preparing', 'Placing Order', 'Confirming', 'Complete']

function _buildAgentTxPopup(signal, exchange) {
  const backdrop = document.createElement('div')
  backdrop.className = 'tx-popup-backdrop'

  const stepsHtml = AGENT_TX_STEPS.map((label, i) => {
    const dot  = `<div class="tx-step-dot" id="agTxDot${i}"></div>`
    const lbl  = `<div class="tx-step-label">${label}</div>`
    const line = i < AGENT_TX_STEPS.length - 1 ? `<div class="tx-step-line" id="agTxLine${i}"></div>` : ''
    return `<div class="tx-step">${dot}${lbl}</div>${line}`
  }).join('')

  const symbol   = signal?.symbol  || '—'
  const bias     = signal?.bias === 'long' ? '▲ LONG' : signal?.bias === 'short' ? '▼ SHORT' : '—'
  const exLabel  = (exchange || '').toUpperCase()
  const mktType  = signal?.marketType === 'futures' ? 'FUTURES' : 'SPOT'

  backdrop.innerHTML = `
    <div class="tx-popup" id="agTxPopupCard">
      <button class="tx-popup-close" id="agTxCloseBtn" title="Close">&times;</button>
      <div class="tx-popup-icon processing" id="agTxIcon">
        <div class="tx-spinner" id="agTxSpinner"></div>
      </div>
      <h3 class="tx-popup-title" id="agTxTitle">Executing Trade</h3>
      <p class="tx-popup-sub" id="agTxSub">Placing order on ${exLabel}…</p>
      <div class="tx-popup-token">
        <span class="tx-popup-token-name">${symbol}</span>
        <span class="tx-popup-token-meta">${bias} · ${mktType} · ${exLabel}</span>
      </div>
      <div class="tx-popup-steps">${stepsHtml}</div>
      <div id="agTxResult"></div>
    </div>`

  document.body.appendChild(backdrop)
  _agentTxBackdrop = backdrop

  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeAgentTxPopup() })
  backdrop.querySelector('#agTxCloseBtn').addEventListener('click', closeAgentTxPopup)

  _agTxSetStep(0)
  return backdrop
}

function _agTxSetStep(activeIdx) {
  AGENT_TX_STEPS.forEach((_, i) => {
    const dot = document.getElementById(`agTxDot${i}`)
    if (!dot) return
    dot.className = 'tx-step-dot ' + (i < activeIdx ? 'done' : i === activeIdx ? 'active' : '')
    if (i < AGENT_TX_STEPS.length - 1) {
      const line = document.getElementById(`agTxLine${i}`)
      if (line) line.className = 'tx-step-line ' + (i < activeIdx ? 'done' : '')
    }
  })
}

function showAgentTxPopup(signal, exchange) {
  closeAgentTxPopup()
  _buildAgentTxPopup(signal, exchange)
  setTimeout(() => _agTxSetStep(1), 350)
  setTimeout(() => _agTxSetStep(2), 1600)
}

function resolveAgentTxPopup(success, data = {}) {
  if (!_agentTxBackdrop) return
  const { orderId, tradeUSDT, errorMsg, exchange } = data

  _agTxSetStep(success ? AGENT_TX_STEPS.length : 2)
  AGENT_TX_STEPS.forEach((_, i) => {
    const dot = document.getElementById(`agTxDot${i}`)
    if (!dot) return
    if (!success && i === AGENT_TX_STEPS.length - 1) dot.className = 'tx-step-dot failed'
    else if (success) dot.className = 'tx-step-dot done'
  })

  const icon   = document.getElementById('agTxIcon')
  const title  = document.getElementById('agTxTitle')
  const sub    = document.getElementById('agTxSub')
  const result = document.getElementById('agTxResult')

  if (success) {
    icon.className  = 'tx-popup-icon success'
    icon.innerHTML  = '✅'
    title.textContent = 'Order Placed!'
    title.style.color = '#0ECB81'
    sub.textContent = `Your trade was submitted to ${(exchange || '').toUpperCase()} successfully.`

    const orderLine = orderId    ? `<div style="font-size:12px;color:#848E9C;margin-bottom:4px">Order ID: <span style="color:#EAECEF">${orderId}</span></div>` : ''
    const amtLine   = tradeUSDT  ? `<div style="font-size:12px;color:#848E9C;margin-bottom:12px">Size: <span style="color:#0ECB81">~$${parseFloat(tradeUSDT).toFixed(2)} USDT</span></div>` : ''

    result.innerHTML = `
      <div class="tx-popup-hash" style="flex-direction:column;gap:4px;align-items:flex-start">
        ${orderLine}${amtLine}
      </div>
      <div class="tx-popup-autoclose">
        <div class="tx-popup-autoclose-bar" id="agTxAutoBar" style="width:100%"></div>
      </div>`

    if (_agentTxTimer) clearTimeout(_agentTxTimer)
    const bar = document.getElementById('agTxAutoBar')
    if (bar) {
      requestAnimationFrame(() => {
        bar.style.transition = 'width 6s linear'
        bar.style.width = '0%'
      })
    }
    _agentTxTimer = setTimeout(closeAgentTxPopup, 6000)
  } else {
    icon.className  = 'tx-popup-icon error'
    icon.innerHTML  = '❌'
    title.textContent = 'Order Failed'
    title.style.color = '#F6465D'
    sub.textContent = 'Something went wrong. See details below.'
    result.innerHTML = `<div class="tx-popup-error">${errorMsg || 'Unknown error'}</div>`
  }

  result.innerHTML += `<button class="tx-popup-dismiss" id="agTxDismissBtn">Dismiss</button>`
  document.getElementById('agTxDismissBtn')?.addEventListener('click', closeAgentTxPopup)
}

function closeAgentTxPopup() {
  if (_agentTxTimer) { clearTimeout(_agentTxTimer); _agentTxTimer = null }
  if (_agentTxBackdrop) { _agentTxBackdrop.remove(); _agentTxBackdrop = null }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
requireAuth(async (user) => {
  currentUser = user
  initUI()
  await loadUserData()
})

// ── UI wiring ─────────────────────────────────────────────────────────────────
function initUI() {
  // Tab switching
  document.querySelectorAll('.tracker-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tracker-tab-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.tracker-panel').forEach(p => p.style.display = 'none')
      btn.classList.add('active')
      const panel = document.getElementById('panel' + cap(btn.dataset.tab))
      if (panel) panel.style.display = 'block'
      if (btn.dataset.tab === 'signals') loadSignals()
      if (btn.dataset.tab === 'history') loadCexTrades()
      if (btn.dataset.tab === 'cex')     loadCexBalances()
    })
  })

  // Side menu
  const menuBtn     = document.getElementById('menuBtn')
  const sideMenu    = document.getElementById('sideMenu')
  const overlay     = document.getElementById('menuOverlay')
  const closeBtn    = document.getElementById('closeMenuBtn')
  const openMenu    = () => { sideMenu?.classList.add('open'); overlay?.classList.add('visible') }
  const closeMenu   = () => { sideMenu?.classList.remove('open'); overlay?.classList.remove('visible') }
  menuBtn?.addEventListener('click', openMenu)
  closeBtn?.addEventListener('click', closeMenu)
  overlay?.addEventListener('click', closeMenu)

  // Logout
  document.getElementById('sideLogoutBtn')?.addEventListener('click', () => signOut(auth).then(() => { window.location.href = 'login.html' }))

  // Agent toggle
  document.getElementById('agentToggle')?.addEventListener('change', async (e) => {
    try {
      await fnSaveAgentSettings({ enabled: e.target.checked })
      agentSettings.enabled = e.target.checked
      updateAgentStatus(e.target.checked)
    } catch (err) { showInline('scanStatus', '❌ ' + err.message, true) }
  })

  // Scan now
  document.getElementById('scanNowBtn')?.addEventListener('click', scanNow)

  // Risk slider label
  const slider = document.getElementById('riskSlider')
  slider?.addEventListener('input', () => { el('riskLabel', slider.value + '%') })

  // Save settings
  document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings)

  // Signals controls
  document.getElementById('signalFilter')?.addEventListener('change', loadSignals)
  document.getElementById('refreshSignalsBtn')?.addEventListener('click', loadSignals)

  // Market type filter pills
  document.querySelectorAll('.mkt-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mkt-filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      signalMktFilter = btn.dataset.mkt
      loadSignals()
    })
  })

  // CEX refresh balances
  document.getElementById('refreshBalancesBtn')?.addEventListener('click', loadCexBalances)

  // Exchange picker modal — cancel and backdrop
  document.getElementById('exPickerCancel')?.addEventListener('click', closeExPickerModal)
  document.getElementById('exPickerModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('exPickerModal')) closeExPickerModal()
  })
}

// ── Load user data ────────────────────────────────────────────────────────────
async function loadUserData() {
  const snap = await getDoc(doc(db, 'users', currentUser.uid))
  if (!snap.exists()) return

  const data = snap.data()
  agentSettings = data.agentSettings || {}

  // Profile initials
  const initEl = document.getElementById('profileInitials')
  if (initEl && currentUser.email) initEl.textContent = currentUser.email[0].toUpperCase()

  // Toggle
  const toggle = document.getElementById('agentToggle')
  if (toggle) toggle.checked = !!agentSettings.enabled
  updateAgentStatus(!!agentSettings.enabled)

  // Stats
  loadStats()

  // Settings panel
  applySettings(agentSettings)

  // CEX key status + build configured exchange list
  const keys = agentSettings.cexKeys || {}
  configuredExchanges = Object.keys(keys).filter(k => keys[k]?.encryptedApiKey || keys[k]?.maskedKey)
  for (const ex of ['binance', 'mexc', 'bybit', 'kucoin']) updateKeyStatus(ex, keys[ex] || null)
}

// ── Agent status ──────────────────────────────────────────────────────────────
function updateAgentStatus(enabled) {
  const dot   = document.getElementById('agentDot')
  const label = document.getElementById('agentStatusLabel')
  const sub   = document.getElementById('toggleSub')
  dot?.classList.toggle('active', enabled)
  if (label) label.textContent = enabled ? 'Running' : 'Stopped'
  if (sub) {
    const ls = agentSettings.lastScanAt
    sub.textContent = enabled
      ? (ls ? 'Last scan: ' + relTime(ls) : 'Next scan in ~15 min')
      : 'Agent is disabled'
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  const todayCutoff = Date.now() - 86400000
  try {
    const todaySnap = await getDocs(query(collection(db, 'users', currentUser.uid, 'signals'), where('generatedAt', '>', todayCutoff)))
    el('statSignalsToday', todaySnap.size)
  } catch (_) {}
  try {
    const openSnap = await getDocs(query(collection(db, 'users', currentUser.uid, 'cexTrades'), where('status', '==', 'open')))
    el('statActiveTrades', openSnap.size)
  } catch (_) {}
  try {
    const allSnap = await getDocs(query(collection(db, 'users', currentUser.uid, 'signals'), limit(200)))
    el('statTotalSignals', allSnap.size)
  } catch (_) {}
  el('statLastScan', agentSettings.lastScanAt ? relTime(agentSettings.lastScanAt) : 'Never')
}

// ── Settings ──────────────────────────────────────────────────────────────────
function applySettings(ag) {
  const tfSel   = document.getElementById('tfSelect')
  const confSel = document.getElementById('confSelect')
  const slider  = document.getElementById('riskSlider')
  const tgTog   = document.getElementById('tgSignalsToggle')
  const autoTog = document.getElementById('autoExecToggle')
  if (tfSel   && ag.timeframe)     tfSel.value = ag.timeframe
  if (confSel && ag.minConfidence) confSel.value = String(ag.minConfidence)
  if (slider  && ag.riskPercent)   { slider.value = ag.riskPercent; el('riskLabel', ag.riskPercent + '%') }
  if (tgTog)  tgTog.checked  = ag.telegramSignals !== false
  if (autoTog) autoTog.checked = !!ag.autoExecute
  const exchanges = ag.exchanges || ['binance', 'mexc', 'bybit', 'kucoin']
  ;[['binance','exBinance'],['mexc','exMexc'],['bybit','exBybit'],['kucoin','exKucoin']].forEach(([k,id]) => {
    const cb = document.getElementById(id)
    if (cb) cb.checked = exchanges.includes(k)
  })
  const mts = ag.marketTypes || ['spot']
  const mtSpotEl    = document.getElementById('mtSpot')
  const mtFuturesEl = document.getElementById('mtFutures')
  if (mtSpotEl)    mtSpotEl.checked    = mts.includes('spot')
  if (mtFuturesEl) mtFuturesEl.checked = mts.includes('futures')
}

async function saveSettings() {
  const exchanges = []
  if (document.getElementById('exBinance')?.checked) exchanges.push('binance')
  if (document.getElementById('exMexc')?.checked)    exchanges.push('mexc')
  if (document.getElementById('exBybit')?.checked)   exchanges.push('bybit')
  if (document.getElementById('exKucoin')?.checked)  exchanges.push('kucoin')
  if (!exchanges.length) { showInline('settingsMsg', '❌ Select at least one exchange.', true); return }

  const marketTypes = []
  if (document.getElementById('mtSpot')?.checked)    marketTypes.push('spot')
  if (document.getElementById('mtFutures')?.checked) marketTypes.push('futures')
  if (!marketTypes.length) marketTypes.push('spot')

  const payload = {
    exchanges,
    marketTypes,
    timeframe:       document.getElementById('tfSelect')?.value || '4H',
    minConfidence:   parseInt(document.getElementById('confSelect')?.value || '70'),
    riskPercent:     parseFloat(document.getElementById('riskSlider')?.value || '2'),
    telegramSignals: document.getElementById('tgSignalsToggle')?.checked !== false,
    autoExecute:     !!document.getElementById('autoExecToggle')?.checked,
  }

  showInline('settingsMsg', '⏳ Saving…')
  try {
    await fnSaveAgentSettings(payload)
    agentSettings = { ...agentSettings, ...payload }
    showInline('settingsMsg', '✅ Settings saved.')
  } catch (err) {
    showInline('settingsMsg', '❌ ' + err.message, true)
  }
}

// ── Manual scan ───────────────────────────────────────────────────────────────
async function scanNow() {
  const btn = document.getElementById('scanNowBtn')
  btn.disabled = true
  btn.textContent = '🔍 Scanning markets…'
  showInline('scanStatus', 'Analyzing top symbols across exchanges (this may take up to 60s)…')
  try {
    const res   = await fnRunAgentScan({})
    const count = res.data?.signals?.length || 0
    showInline('scanStatus', `✅ Scan complete — ${count} signal${count !== 1 ? 's' : ''} found.`)
    btn.textContent = '✅ Done'
    await loadStats()
    if (count > 0) setTimeout(() => document.querySelector('[data-tab="signals"]')?.click(), 900)
  } catch (err) {
    showInline('scanStatus', '❌ Scan failed: ' + err.message, true)
    btn.textContent = '🔍 Scan Markets Now'
  } finally {
    btn.disabled = false
    setTimeout(() => {
      btn.textContent = '🔍 Scan Markets Now'
      showInline('scanStatus', '')
    }, 10000)
  }
}

// ── Signals ───────────────────────────────────────────────────────────────────
async function loadSignals() {
  const container = document.getElementById('signalsList')
  if (!container) return
  container.innerHTML = '<div style="text-align:center;padding:20px;color:#848E9C">Loading…</div>'

  const statusFilter = document.getElementById('signalFilter')?.value || 'active'
  const mktFilter    = signalMktFilter // 'all' | 'spot' | 'futures'

  try {
    const snap = await getDocs(query(
      collection(db, 'users', currentUser.uid, 'signals'),
      orderBy('generatedAt', 'desc'), limit(60)
    ))
    let signals = snap.docs.map(d => ({ ...d.data(), id: d.id }))

    // Resolve live expiry state
    signals = signals.map(s => ({
      ...s, status: (s.status === 'pending' && s.expiresAt < Date.now()) ? 'expired' : s.status,
    }))

    // Status filter
    if (statusFilter === 'active') {
      signals = signals.filter(s => s.status !== 'expired')
    } else if (statusFilter !== 'all') {
      signals = signals.filter(s => s.status === statusFilter)
    }

    // Market type filter
    if (mktFilter !== 'all') {
      signals = signals.filter(s => (s.marketType || 'spot') === mktFilter)
    }

    if (!signals.length) {
      const mktLabel    = mktFilter    === 'all' ? '' : mktFilter + ' '
      const statusLabel = statusFilter === 'all' ? '' : statusFilter === 'active' ? 'active ' : statusFilter + ' '
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><div>No ${mktLabel}${statusLabel}signals yet.<br/>Run a scan or enable the agent.</div></div>`
      return
    }

    // Cache signal data for popup display
    _signalsCache = {}
    signals.forEach(s => { _signalsCache[s.id] = s })

    container.innerHTML = signals.map(renderSignalCard).join('')

    container.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => showExchangePicker(btn.dataset.approve, btn))
    })
    container.querySelectorAll('[data-skip]').forEach(btn => {
      btn.addEventListener('click', () => skipSignal(btn.dataset.skip, btn))
    })
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`
  }
}

function renderSignalCard(s) {
  const pending  = s.status === 'pending'
  const biasC    = s.bias === 'long' ? 'long' : 'short'
  const biasLbl  = s.bias === 'long' ? '▲ LONG' : '▼ SHORT'
  const alphaTag = s.isAlpha ? `<span class="signal-badge alpha">🔥 ALPHA</span>` : ''
  const mktBadge = s.marketType === 'futures'
    ? `<span class="signal-badge futures">FUTURES</span>`
    : `<span class="signal-badge spot">SPOT</span>`
  const levChip  = s.marketType === 'futures' && s.leverage
    ? `<span class="signal-leverage">${s.leverage}x</span>`
    : ''
  const exchanges = (s.exchanges || [s.exchange]).map(e => e.toUpperCase()).join(' / ')
  const expStr   = s.expiresAt > Date.now() ? 'Expires ' + relTime(s.expiresAt) : 'Expired'
  const rsiTag   = s.indicators?.rsi != null ? `<span class="signal-tag">RSI ${s.indicators.rsi}</span>` : ''
  const bosTag   = s.structure?.bos          ? `<span class="signal-tag">BOS ✓</span>` : ''
  const fvgTag   = s.structure?.hasFVG       ? `<span class="signal-tag">FVG</span>` : ''
  const obTag    = s.structure?.hasOB        ? `<span class="signal-tag">OB</span>` : ''
  const volTag   = s.indicators?.volumeSpike ? `<span class="signal-tag">Vol Spike</span>` : ''
  const adxTag   = s.indicators?.adx != null && s.marketType === 'futures'
    ? `<span class="signal-tag">ADX ${s.indicators.adx}</span>` : ''
  const tvTag    = s.tvRecommend?.label && s.marketType === 'futures' ? (() => {
    const lbl   = s.tvRecommend.label
    const color = lbl.includes('Buy')  ? '#0ECB81' : lbl.includes('Sell') ? '#F6465D' : '#848E9C'
    const bg    = lbl.includes('Buy')  ? 'rgba(14,203,129,.12)' : lbl.includes('Sell') ? 'rgba(246,70,93,.12)' : 'rgba(132,142,156,.12)'
    return `<span class="signal-tag" style="color:${color};background:${bg}">TV: ${lbl}</span>`
  })() : ''

  const entryLine = s.entryHigh
    ? `$${fmtP(s.entry)} – $${fmtP(s.entryHigh)}`
    : `$${fmtP(s.entry)}`

  let actionsHtml
  if (pending) {
    actionsHtml = `
      <div class="signal-actions">
        <button class="btn-approve" data-approve="${s.id}">✅ Approve Trade</button>
        <button class="btn-skip"    data-skip="${s.id}">❌ Skip</button>
      </div>`
  } else {
    const lblMap = { executed: '✅ Executed', skipped: '❌ Skipped', expired: '⏰ Expired' }
    actionsHtml = `<div class="signal-status-badge ${s.status}">${lblMap[s.status] || s.status}</div>`
  }

  return `
  <div class="signal-card ${biasC}${s.status === 'expired' ? ' expired' : ''}">
    <div class="signal-header">
      <div>
        <span class="signal-symbol">${s.symbol}</span>
        <span class="signal-badge ${biasC}" style="margin-left:6px">${biasLbl}</span>
        ${mktBadge}${levChip}
        ${alphaTag}
      </div>
      <span style="font-size:11px;color:#848E9C">${s.confidence}% confidence</span>
    </div>
    <div class="signal-meta"><span>${exchanges}</span><span>${s.timeframe}</span><span>${expStr}</span></div>
    <div class="signal-prices">
      <div class="signal-price-row">
        <div class="signal-price-label">Entry Zone</div>
        <div class="signal-price-value">${entryLine}</div>
      </div>
      <div class="signal-price-row">
        <div class="signal-price-label">Stop Loss</div>
        <div class="signal-price-value red">$${fmtP(s.stopLoss)}</div>
        <div class="signal-price-pct">${pct(s.entry, s.stopLoss)}</div>
      </div>
      <div class="signal-price-row">
        <div class="signal-price-label">TP1</div>
        <div class="signal-price-value green">$${fmtP(s.tp1)}</div>
        <div class="signal-price-pct">${pct(s.entry, s.tp1)}</div>
      </div>
      <div class="signal-price-row">
        <div class="signal-price-label">TP2 / TP3</div>
        <div class="signal-price-value green" style="font-size:11px">$${fmtP(s.tp2)} / $${fmtP(s.tp3)}</div>
        <div class="signal-price-pct">${pct(s.entry, s.tp2)} / ${pct(s.entry, s.tp3)}</div>
      </div>
    </div>
    <div class="signal-conf">
      <div class="conf-bar"><div class="conf-fill" style="width:${s.confidence}%"></div></div>
      <span class="conf-label">R:R 1:${s.riskReward}</span>
    </div>
    <div class="signal-setup">${s.setup || '—'}</div>
    <div class="signal-tags">${rsiTag}${bosTag}${fvgTag}${obTag}${volTag}${adxTag}${tvTag}</div>
    ${actionsHtml}
  </div>`
}

// ── Exchange picker ───────────────────────────────────────────────────────────
const EX_META = {
  binance: { label: 'Binance', color: '#F0B90B' },
  mexc:    { label: 'MEXC',    color: '#2354E6' },
  bybit:   { label: 'Bybit',   color: '#EF8C1A' },
  kucoin:  { label: 'KuCoin',  color: '#00A478' },
}

// cached balances so picker shows live USDT available
let cachedBalances = {}
let _pickerSignalId = null
let _pickerTriggerEl = null

function showExchangePicker(signalId, approveBtn) {
  if (!configuredExchanges.length) {
    alert('No CEX API keys configured.\nGo to the CEX Setup tab to add your exchange keys first.')
    return
  }

  // Single exchange — skip the picker
  if (configuredExchanges.length === 1) {
    executeTrade(signalId, configuredExchanges[0], approveBtn)
    return
  }

  _pickerSignalId  = signalId
  _pickerTriggerEl = approveBtn

  const modal = document.getElementById('exPickerModal')
  const grid  = document.getElementById('exPickerGrid')
  if (!modal || !grid) return

  const ALL = ['binance', 'mexc', 'bybit', 'kucoin']
  grid.innerHTML = ALL.map(ex => {
    const meta   = EX_META[ex]
    const hasKey = configuredExchanges.includes(ex)
    const bal    = cachedBalances[ex]
    const balTxt = hasKey
      ? (bal && !bal.error ? `$${parseFloat(bal.free || 0).toFixed(2)} USDT` : '—')
      : 'No key'
    const balColor = (!hasKey || bal?.error) ? '#F6465D' : '#848E9C'
    return `
      <button class="ex-modal-btn" data-ex="${ex}" data-signal="${signalId}" ${hasKey ? '' : 'disabled'}>
        <span class="ex-modal-btn-name" style="color:${meta.color}">${meta.label}</span>
        <span class="ex-modal-btn-bal" style="color:${balColor}">${balTxt}</span>
      </button>`
  }).join('')

  modal.classList.add('open')

  // signalId is stored in each button's data-signal — no shared variable needed
  grid.querySelectorAll('[data-ex]:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const sid = btn.dataset.signal
      const tel = _pickerTriggerEl
      closeExPickerModal()
      executeTrade(sid, btn.dataset.ex, tel)
    })
  })

  // Refresh live balances
  fnGetCexBalances({}).then(res => {
    cachedBalances = res.data?.balances || {}
    grid.querySelectorAll('[data-ex]').forEach(btn => {
      const ex  = btn.dataset.ex
      const bal = cachedBalances[ex]
      const balSpan = btn.querySelector('.ex-modal-btn-bal')
      if (!balSpan) return
      if (bal && !bal.error) {
        balSpan.textContent = `$${parseFloat(bal.free || 0).toFixed(2)} USDT`
        balSpan.style.color = '#848E9C'
        balSpan.title = ''
      } else if (bal?.error) {
        balSpan.textContent = '⚠ Error'
        balSpan.style.color = '#F6465D'
        balSpan.title = bal.error
      }
    })
  }).catch(() => {})
}

function closeExPickerModal() {
  document.getElementById('exPickerModal')?.classList.remove('open')
  _pickerSignalId  = null
  _pickerTriggerEl = null
}

async function executeTrade(signalId, targetExchange, triggerEl) {
  if (!signalId) {
    const errBanner = document.createElement('div')
    errBanner.style.cssText = 'background:rgba(246,70,93,.1);border-radius:8px;padding:10px 14px;font-size:13px;color:#F6465D;margin-bottom:10px'
    errBanner.textContent = '❌ Error: signal ID missing — please refresh the page and try again.'
    document.getElementById('signalsList')?.prepend(errBanner)
    setTimeout(() => errBanner.remove(), 8000)
    return
  }

  // Lock approve button
  if (triggerEl) { triggerEl.disabled = true; triggerEl.textContent = '⏳ Placing order…' }

  // Show processing popup
  const signal = _signalsCache[signalId] || null
  showAgentTxPopup(signal, targetExchange)

  const riskPct = parseFloat(document.getElementById('riskSlider')?.value || '2')
  try {
    const res = await fnApproveTrade({ signalId, riskPercent: riskPct, targetExchange })
    const d   = res.data
    resolveAgentTxPopup(true, { orderId: d.orderId, tradeUSDT: d.tradeUSDT, exchange: targetExchange })
    await loadSignals()
    await loadStats()
  } catch (err) {
    if (triggerEl) { triggerEl.disabled = false; triggerEl.textContent = '✅ Approve Trade' }
    resolveAgentTxPopup(false, { errorMsg: `${(targetExchange || '').toUpperCase()}: ${err.message}`, exchange: targetExchange })
  }
}

async function skipSignal(signalId, btn) {
  btn.disabled = true
  try {
    await fnSkipSignal({ signalId })
    await loadSignals()
  } catch (_) { btn.disabled = false }
}

// ── CEX Keys ──────────────────────────────────────────────────────────────────
window.saveKey = async function (exchange) {
  const apiKey     = document.getElementById(exchange + 'ApiKey')?.value.trim()
  const secret     = document.getElementById(exchange + 'ApiSecret')?.value.trim()
  const ppEl       = document.getElementById(exchange + 'ApiPassphrase')
  const passphrase = ppEl ? ppEl.value.trim() : undefined

  if (!apiKey || !secret) { showInline('cexMsg', '❌ API key and secret are required.', true); return }

  showInline('cexMsg', '⏳ Encrypting and saving…')
  try {
    const res = await fnSaveCexApiKey({ exchange, apiKey, secret, passphrase })
    showInline('cexMsg', `✅ ${exchange.toUpperCase()} key saved (${res.data.maskedKey})`)
    updateKeyStatus(exchange, { maskedKey: res.data.maskedKey })
    // Clear sensitive fields
    ;[exchange + 'ApiKey', exchange + 'ApiSecret', exchange + 'ApiPassphrase'].forEach(id => {
      const inp = document.getElementById(id)
      if (inp) inp.value = ''
    })
  } catch (err) { showInline('cexMsg', '❌ ' + err.message, true) }
}

window.removeKey = async function (exchange) {
  if (!confirm(`Remove ${exchange.toUpperCase()} API key?`)) return
  showInline('cexMsg', '⏳ Removing…')
  try {
    await fnRemoveCexApiKey({ exchange })
    showInline('cexMsg', `✅ ${exchange.toUpperCase()} key removed.`)
    updateKeyStatus(exchange, null)
  } catch (err) { showInline('cexMsg', '❌ ' + err.message, true) }
}

function updateKeyStatus(exchange, keyEntry) {
  const statusEl  = document.getElementById(exchange + 'KeyStatus')
  const removeBtn = document.getElementById(exchange + 'RemoveBtn')
  const balEl     = document.getElementById(exchange + 'Balance')

  if (keyEntry) {
    if (statusEl)  { statusEl.textContent = keyEntry.maskedKey || 'Set'; statusEl.className = 'cex-key-status set' }
    if (removeBtn) removeBtn.style.display = 'block'
    if (balEl)     balEl.style.display = 'block'
    if (!configuredExchanges.includes(exchange)) configuredExchanges.push(exchange)
  } else {
    if (statusEl)  { statusEl.textContent = 'Not set'; statusEl.className = 'cex-key-status unset' }
    if (removeBtn) removeBtn.style.display = 'none'
    if (balEl)     balEl.style.display = 'none'
    configuredExchanges = configuredExchanges.filter(e => e !== exchange)
  }
}

async function loadCexBalances() {
  const btn = document.getElementById('refreshBalancesBtn')
  if (btn) btn.disabled = true
  showInline('cexMsg', '⏳ Fetching balances…')
  try {
    const res = await fnGetCexBalances({})
    const bals = res.data.balances || {}
    for (const [ex, bal] of Object.entries(bals)) {
      const valEl = document.getElementById(ex + 'BalanceVal')
      if (!valEl) continue
      if (bal.error) {
        valEl.textContent = '⚠️ Error'
        valEl.title = bal.error
        valEl.style.color = '#F6465D'
        valEl.style.cursor = 'help'
      } else {
        valEl.textContent = `$${parseFloat(bal.free || 0).toFixed(2)} USDT`
        valEl.title = ''
        valEl.style.color = ''
        valEl.style.cursor = ''
      }
    }
    showInline('cexMsg', '✅ Balances updated.')
  } catch (err) { showInline('cexMsg', '❌ ' + err.message, true) }
  finally { if (btn) btn.disabled = false }
}

// ── CEX Trade History ─────────────────────────────────────────────────────────
async function loadCexTrades() {
  const container = document.getElementById('cexTradeList')
  if (!container) return
  container.innerHTML = '<div style="text-align:center;padding:20px;color:#848E9C">Loading…</div>'
  try {
    const snap = await getDocs(query(
      collection(db, 'users', currentUser.uid, 'cexTrades'),
      orderBy('openedAt', 'desc'), limit(25)
    ))
    if (snap.empty) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📜</div><div>No CEX trades yet</div></div>'
      return
    }
    container.innerHTML = snap.docs.map(d => {
      const t    = d.data()
      const biC  = t.bias === 'long' ? '#0ECB81' : '#F6465D'
      const biLb = t.bias === 'long' ? '▲' : '▼'
      const pnl  = t.pnl != null ? parseFloat(t.pnl) : null
      const pnlStr = pnl != null ? (pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`) : '—'
      const pnlC = pnl != null ? (pnl >= 0 ? '#0ECB81' : '#F6465D') : '#848E9C'
      const date = t.openedAt?.toDate?.()?.toLocaleDateString('en-GB') || '—'
      const stBadge = t.status === 'open'
        ? '<span style="color:#FFA000;font-size:11px">⏳ Open</span>'
        : '<span style="color:#848E9C;font-size:11px">Closed</span>'
      return `
      <div class="cex-trade-row">
        <div class="cex-trade-header">
          <div>
            <span class="cex-trade-symbol">${t.symbol}</span>
            <span style="color:${biC};font-size:13px;margin-left:6px">${biLb} ${(t.bias || '').toUpperCase()}</span>
            <span style="color:#848E9C;font-size:11px;margin-left:6px">${(t.exchange || '').toUpperCase()}</span>
          </div>
          <span style="color:${pnlC};font-weight:600">${pnlStr}</span>
        </div>
        <div class="cex-trade-meta">${date} · Qty: ${t.qty || '—'} · $${parseFloat(t.tradeUSDT || 0).toFixed(2)} · ${stBadge}</div>
        <div class="cex-trade-meta" style="margin-top:3px">SL: $${fmtP(t.stopLoss)} · TP1: $${fmtP(t.tp1)} · Conf: ${t.confidence}%</div>
      </div>`
    }).join('')
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`
  }
}

// ── Utility helpers ───────────────────────────────────────────────────────────
function el(id, val) { const n = document.getElementById(id); if (n) n.textContent = String(val) }

function showInline(id, msg, isError = false) {
  const node = document.getElementById(id)
  if (!node) return
  node.textContent = msg
  node.style.color = isError ? '#F6465D' : msg.startsWith('✅') ? '#0ECB81' : '#848E9C'
  if (msg) setTimeout(() => { if (node.textContent === msg) node.textContent = '' }, 6000)
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : '' }

function fmtP(p) {
  if (p == null || isNaN(p)) return '?'
  if (p >= 10000) return p.toFixed(0)
  if (p >= 1000)  return p.toFixed(2)
  if (p >= 1)     return p.toFixed(4)
  if (p >= 0.01)  return p.toFixed(6)
  return p.toFixed(8)
}

function pct(entry, target) {
  if (!entry || !target) return ''
  const v = (target - entry) / entry * 100
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
}

function relTime(ts) {
  const d = Date.now() - ts
  if (d < 0) { const p = -d; return p < 3600000 ? 'in ' + Math.round(p / 60000) + 'm' : 'in ' + Math.round(p / 3600000) + 'h' }
  if (d < 60000)    return 'just now'
  if (d < 3600000)  return Math.round(d / 60000) + 'm ago'
  if (d < 86400000) return Math.round(d / 3600000) + 'h ago'
  return Math.round(d / 86400000) + 'd ago'
}

'use strict'

// ── Entry / SL / TP Calculation ───────────────────────────────────────────────

function calcEntryZone(analysis) {
  const { currentPrice, structure, indicators, bias } = analysis
  let entry = currentPrice, entryHigh = null, entryLow = null

  if (bias === 'long') {
    // Prefer OB or FVG as entry if within 3% below current price (retrace)
    if (structure.nearBullOB && structure.bullOB) {
      const obMid = (structure.bullOB.low + structure.bullOB.high) / 2
      if (obMid < currentPrice && obMid > currentPrice * 0.97) entry = obMid
    }
    if (structure.relevantFVG?.type === 'bull') {
      const fvgMid = (structure.relevantFVG.low + structure.relevantFVG.high) / 2
      if (fvgMid < currentPrice && fvgMid > currentPrice * 0.97) entry = Math.max(entry, fvgMid)
    }
    entryHigh = currentPrice * 1.005
  } else {
    if (structure.nearBearOB && structure.bearOB) {
      const obMid = (structure.bearOB.low + structure.bearOB.high) / 2
      if (obMid > currentPrice && obMid < currentPrice * 1.03) entry = obMid
    }
    if (structure.relevantFVG?.type === 'bear') {
      const fvgMid = (structure.relevantFVG.low + structure.relevantFVG.high) / 2
      if (fvgMid > currentPrice && fvgMid < currentPrice * 1.03) entry = Math.min(entry, fvgMid)
    }
    entryLow = currentPrice * 0.995
  }

  return { entry, entryHigh, entryLow }
}

function calcStopLoss(analysis, entry) {
  const { atr, bias, structure } = analysis
  const atrMult = 1.5
  const atrStop = atr ? atr * atrMult : entry * 0.025

  if (bias === 'long') {
    let sl = entry - atrStop
    const lastSL = structure.swingLows?.[structure.swingLows.length - 1]?.price
    if (lastSL && lastSL < entry && lastSL > entry * 0.88) sl = Math.max(sl, lastSL * 0.995)
    if (structure.bullOB?.low && structure.bullOB.low < entry && structure.bullOB.low > entry * 0.9) {
      sl = Math.max(sl, structure.bullOB.low * 0.997)
    }
    return sl
  } else {
    let sl = entry + atrStop
    const lastSH = structure.swingHighs?.[structure.swingHighs.length - 1]?.price
    if (lastSH && lastSH > entry && lastSH < entry * 1.12) sl = Math.min(sl, lastSH * 1.005)
    if (structure.bearOB?.high && structure.bearOB.high > entry && structure.bearOB.high < entry * 1.1) {
      sl = Math.min(sl, structure.bearOB.high * 1.003)
    }
    return sl
  }
}

function calcTakeProfits(entry, sl, bias) {
  const risk = Math.abs(entry - sl)
  return bias === 'long'
    ? { tp1: entry + risk * 1.5, tp2: entry + risk * 3, tp3: entry + risk * 5 }
    : { tp1: entry - risk * 1.5, tp2: entry - risk * 3, tp3: entry - risk * 5 }
}

// ── Signal Object Builder ─────────────────────────────────────────────────────

function generateSignal(analysis, allExchanges) {
  const minScore = analysis?.marketType === 'futures' ? 65 : 68
  if (!analysis || analysis.score < minScore || analysis.bias === 'neutral') return null

  const { entry, entryHigh, entryLow } = calcEntryZone(analysis)
  const sl = calcStopLoss(analysis, entry)
  const { tp1, tp2, tp3 } = calcTakeProfits(entry, sl, analysis.bias)
  // Bad/missing price data can yield NaN levels — those break the signal card
  // and the callable's JSON encoding. Drop such setups entirely.
  if (![entry, sl, tp1, tp2, tp3].every((x) => typeof x === 'number' && isFinite(x))) return null
  const risk = Math.abs(entry - sl)
  const rr = risk > 0 ? parseFloat(((Math.abs(tp3 - entry)) / risk).toFixed(1)) : 0

  const setupParts = []
  if (analysis.structure.bos) setupParts.push('BOS')
  if (analysis.structure.nearBullOB || analysis.structure.nearBearOB) setupParts.push('Order Block')
  if (analysis.structure.relevantFVG) setupParts.push('FVG fill')
  if (analysis.structure.choch) setupParts.push('CHoCH')
  setupParts.push(...analysis.reasons.slice(0, 3 - setupParts.length))
  const setup = setupParts.join(' + ')

  const marketType = analysis.marketType || 'spot'
  const leverage   = marketType === 'futures'
    ? (analysis.score >= 85 ? 5 : analysis.score >= 75 ? 3 : 2)
    : null

  return {
    symbol:      analysis.symbol,
    exchange:    analysis.exchange,
    exchanges:   allExchanges || [analysis.exchange],
    isAlpha:     analysis.isAlpha,
    bias:        analysis.bias,
    timeframe:   analysis.timeframe,
    marketType,
    leverage,
    currentPrice: parseFloat(analysis.currentPrice),
    entry:       parseFloat(entry.toFixed(8)),
    entryHigh:   entryHigh ? parseFloat(entryHigh.toFixed(8)) : null,
    entryLow:    entryLow  ? parseFloat(entryLow.toFixed(8))  : null,
    stopLoss:    parseFloat(sl.toFixed(8)),
    tp1:         parseFloat(tp1.toFixed(8)),
    tp2:         parseFloat(tp2.toFixed(8)),
    tp3:         parseFloat(tp3.toFixed(8)),
    riskReward:  rr,
    confidence:  analysis.score,
    setup,
    indicators: {
      rsi:         analysis.indicators.rsi !== null ? Math.round(analysis.indicators.rsi) : null,
      macdBullish: analysis.indicators.macd ? analysis.indicators.macd.histogram > 0 : null,
      volumeSpike: !!(analysis.indicators.volumeRatio && analysis.indicators.volumeRatio > 1.5),
      ema50:       analysis.indicators.ema50 ? parseFloat(analysis.indicators.ema50.toFixed(8)) : null,
      adx:         analysis.indicators.adx  != null ? Math.round(analysis.indicators.adx) : null,
    },
    tvRecommend: analysis.tvRecommend || null,
    structure: {
      bias:   analysis.structure.bias,
      bos:    analysis.structure.bos,
      hasFVG: !!analysis.structure.relevantFVG,
      hasOB:  analysis.structure.nearBullOB || analysis.structure.nearBearOB,
    },
    volume24h:   analysis.volume24h,
    status:      'pending',
    generatedAt: Date.now(),
    expiresAt:   Date.now() + 4 * 60 * 60 * 1000,
    approvedAt:  null,
    executedAt:  null,
    orderId:     null,
    pnl:         null,
  }
}

// ── Formatting Helpers ────────────────────────────────────────────────────────

function fmtPrice(p) {
  if (!p || isNaN(p)) return '?'
  if (p >= 10000) return p.toFixed(0)
  if (p >= 1000)  return p.toFixed(2)
  if (p >= 1)     return p.toFixed(4)
  if (p >= 0.01)  return p.toFixed(6)
  return p.toFixed(8)
}

function fmtPct(entry, target) {
  const pct = ((target - entry) / entry) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
}

// Escape dynamic text for Telegram HTML parse mode. Legacy `Markdown` broke
// delivery whenever a dynamic field (setup text, structure bias, symbol…)
// contained an unbalanced * _ ` [ — HTML + escaping is robust to that.
function htmlEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Position size (USDT) for a signal trade. Traders pick one of two modes in the
// signal-scanner auto-bot settings:
//   riskMode 'percent' (default) → a % of available USDT balance (clamped 0.5–10)
//   riskMode 'fixed'             → a fixed USDT amount per trade (capped at balance)
// pctOverride lets a manual approve pass a per-trade % (ignored in fixed mode).
function sizeTradeUsd(agentSettings, usdtBalance, pctOverride) {
  const s = agentSettings || {}
  const bal = Number(usdtBalance) || 0
  if (s.riskMode === 'fixed') {
    const usd = Math.max(0, parseFloat(s.riskUsd) || 0)
    return Math.max(0, Math.min(usd, bal))
  }
  const pct = Math.max(0.5, Math.min(parseFloat(pctOverride != null ? pctOverride : s.riskPercent) || 2, 10))
  return bal * (pct / 100)
}

function formatTelegramSignal(signal) {
  const biasEmoji  = signal.bias === 'long' ? '🟢' : '🔴'
  const biasLabel  = signal.bias === 'long' ? 'LONG' : 'SHORT'
  const alphaTag   = signal.isAlpha ? ' 🔥 <b>[ALPHA]</b>' : ''
  const exchanges  = (signal.exchanges || [signal.exchange]).map(e => String(e).toUpperCase()).join(' / ')
  const mktTag     = signal.marketType === 'futures' ? ' 📊 <b>[FUTURES]</b>' : ' 🏪 <b>[SPOT]</b>'
  const leverageLn = signal.marketType === 'futures' && signal.leverage
    ? `⚡ Suggested Leverage: <b>${signal.leverage}x</b>\n`
    : ''

  const entryLine = signal.entryHigh
    ? `$${fmtPrice(signal.entry)} — $${fmtPrice(signal.entryHigh)}`
    : signal.entryLow
      ? `$${fmtPrice(signal.entryLow)} — $${fmtPrice(signal.entry)}`
      : `$${fmtPrice(signal.entry)}`

  const rsiLine = signal.indicators.rsi !== null ? `📊 RSI: <b>${signal.indicators.rsi}</b>\n` : ''
  const volLine = signal.indicators.volumeSpike ? `🔊 Volume: Spike detected\n` : ''
  const bosLine = signal.structure.bos ? `✅ BOS confirmed\n` : ''
  const fvgLine = signal.structure.hasFVG ? `📍 FVG imbalance nearby\n` : ''
  const obLine  = signal.structure.hasOB  ? `🧱 Order Block confluence\n` : ''

  let tvLine = ''
  if (signal.marketType === 'futures' && signal.tvRecommend?.label) {
    const tv    = signal.tvRecommend
    const emoji = tv.label.includes('Buy') ? '🟢' : tv.label.includes('Sell') ? '🔴' : '⚪'
    const adxStr = tv.adx != null ? ` · ADX <b>${Math.round(tv.adx)}</b>` : ''
    tvLine = `${emoji} TradingView: <b>${htmlEsc(tv.label)}</b>${adxStr}\n`
  }

  return (
    `${biasEmoji} <b>${biasLabel} SIGNAL — ${htmlEsc(signal.symbol)}</b>${alphaTag}${mktTag}\n\n` +
    `📡 Exchange: <b>${htmlEsc(exchanges)}</b>\n` +
    leverageLn +
    `⏱ Timeframe: <b>${htmlEsc(signal.timeframe)}</b>\n` +
    `💰 Current Price: $${fmtPrice(signal.currentPrice)}\n\n` +
    `📍 <b>Entry Zone:</b> ${entryLine}\n` +
    `🎯 TP1: $${fmtPrice(signal.tp1)} <b>(${fmtPct(signal.entry, signal.tp1)})</b>\n` +
    `🎯 TP2: $${fmtPrice(signal.tp2)} <b>(${fmtPct(signal.entry, signal.tp2)})</b>\n` +
    `🎯 TP3: $${fmtPrice(signal.tp3)} <b>(${fmtPct(signal.entry, signal.tp3)})</b>\n` +
    `🛑 Stop Loss: $${fmtPrice(signal.stopLoss)} <b>(${fmtPct(signal.entry, signal.stopLoss)})</b>\n` +
    `⚖ Risk/Reward: <b>1:${htmlEsc(signal.riskReward)}</b>\n\n` +
    `📈 Market Structure: <b>${htmlEsc(signal.structure.bias)}</b>\n` +
    `🔧 Setup: ${htmlEsc(signal.setup)}\n` +
    rsiLine + volLine + bosLine + fvgLine + obLine + tvLine +
    `\n🎯 <b>Confidence: ${signal.confidence}%</b>\n` +
    `⏰ <i>Expires in 4 hours</i>`
  )
}

function formatTelegramSignalWithButtons(signal, signalId) {
  const text = formatTelegramSignal(signal)
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve Trade', callback_data: `agent_approve_${signalId}` },
      { text: '❌ Skip',          callback_data: `agent_skip_${signalId}` },
    ]],
  }
  return { text, keyboard }
}

// ── Deduplication & cooldown policy ───────────────────────────────────────────
// Prevents the repeated-symbol noise: at most ONE active signal per symbol +
// timeframe, a rest period after a signal resolves (short after a win, longer
// after a stop), and a whipsaw guard that skips the symbol when it just printed
// the opposite bias.
const TP_COOLDOWN_MS  = 6  * 60 * 60 * 1000  // rest a symbol+TF this long after a TP win (4–8h band)
const SL_COOLDOWN_MS  = 18 * 60 * 60 * 1000  // longer rest after a stop-loss (12–24h band)
const OPP_BIAS_MS     = 3  * 60 * 60 * 1000  // skip if the same symbol just printed the opposite side
const ACTIVE_MAX_MS   = 4  * 60 * 60 * 1000  // an unresolved signal counts as "active" until ~its expiry

// Returns true if `newSignal` should be SUPPRESSED given the recent signal
// history for the same symbol. `newSignal` may be a raw analysis (it only needs
// symbol / bias / timeframe / marketType). `windowMs` is the legacy same-bias
// fallback window, kept for backward-compatible callers.
function isDuplicateSignal(newSignal, recentSignals, windowMs = 4 * 60 * 60 * 1000) {
  const now  = Date.now()
  const sym  = newSignal.symbol
  const tf   = newSignal.timeframe
  const mt   = newSignal.marketType || 'spot'
  const bias = newSignal.bias
  for (const s of (recentSignals || [])) {
    if (s.symbol !== sym) continue
    if ((s.marketType || 'spot') !== mt) continue
    const age = now - (s.generatedAt || 0)
    if (age < 0) continue

    // 1) Opposite-bias whipsaw guard (any timeframe): the market is undecided —
    //    skip the new one rather than run a contradictory pair.
    if (bias && s.bias && s.bias !== bias && age < OPP_BIAS_MS) return true

    // Remaining rules are scoped to the same timeframe.
    if ((s.timeframe || tf) !== tf) continue

    // 2) One active signal per symbol+timeframe at a time.
    if (!s.outcome && age < ACTIVE_MAX_MS) return true

    // 3) Cooldown measured from when the prior signal RESOLVED.
    if (s.outcome) {
      const sinceResolve = now - (s.outcomeAt || s.generatedAt || 0)
      if (String(s.outcome).startsWith('tp') && sinceResolve < TP_COOLDOWN_MS) return true // rest after a win
      if (s.outcome === 'sl' && sinceResolve < SL_COOLDOWN_MS) return true                   // longer rest after a stop
      // 'expired' → no cooldown; a fresh setup may re-arm immediately.
    } else if (s.bias === bias && age < windowMs) {
      // 4) Legacy same-bias/window fallback (belt-and-braces).
      return true
    }
  }
  return false
}

module.exports = { generateSignal, formatTelegramSignal, formatTelegramSignalWithButtons, isDuplicateSignal, fmtPrice, sizeTradeUsd }

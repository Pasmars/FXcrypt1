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

function formatTelegramSignal(signal) {
  const biasEmoji  = signal.bias === 'long' ? '🟢' : '🔴'
  const biasLabel  = signal.bias === 'long' ? 'LONG' : 'SHORT'
  const alphaTag   = signal.isAlpha ? ' 🔥 *\\[ALPHA\\]*' : ''
  const exchanges  = (signal.exchanges || [signal.exchange]).map(e => e.toUpperCase()).join(' / ')
  const mktTag     = signal.marketType === 'futures' ? ' 📊 *\\[FUTURES\\]*' : ' 🏪 *\\[SPOT\\]*'
  const leverageLn = signal.marketType === 'futures' && signal.leverage
    ? `⚡ Suggested Leverage: *${signal.leverage}x*\n`
    : ''

  const entryLine = signal.entryHigh
    ? `$${fmtPrice(signal.entry)} — $${fmtPrice(signal.entryHigh)}`
    : signal.entryLow
      ? `$${fmtPrice(signal.entryLow)} — $${fmtPrice(signal.entry)}`
      : `$${fmtPrice(signal.entry)}`

  const rsiLine = signal.indicators.rsi !== null ? `📊 RSI: *${signal.indicators.rsi}*\n` : ''
  const volLine = signal.indicators.volumeSpike ? `🔊 Volume: Spike detected\n` : ''
  const bosLine = signal.structure.bos ? `✅ BOS confirmed\n` : ''
  const fvgLine = signal.structure.hasFVG ? `📍 FVG imbalance nearby\n` : ''
  const obLine  = signal.structure.hasOB  ? `🧱 Order Block confluence\n` : ''

  let tvLine = ''
  if (signal.marketType === 'futures' && signal.tvRecommend?.label) {
    const tv    = signal.tvRecommend
    const emoji = tv.label.includes('Buy') ? '🟢' : tv.label.includes('Sell') ? '🔴' : '⚪'
    const adxStr = tv.adx != null ? ` · ADX *${Math.round(tv.adx)}*` : ''
    tvLine = `${emoji} TradingView: *${tv.label}*${adxStr}\n`
  }

  return (
    `${biasEmoji} *${biasLabel} SIGNAL — ${signal.symbol}*${alphaTag}${mktTag}\n\n` +
    `📡 Exchange: *${exchanges}*\n` +
    leverageLn +
    `⏱ Timeframe: *${signal.timeframe}*\n` +
    `💰 Current Price: $${fmtPrice(signal.currentPrice)}\n\n` +
    `📍 *Entry Zone:* ${entryLine}\n` +
    `🎯 TP1: $${fmtPrice(signal.tp1)} *(${fmtPct(signal.entry, signal.tp1)})*\n` +
    `🎯 TP2: $${fmtPrice(signal.tp2)} *(${fmtPct(signal.entry, signal.tp2)})*\n` +
    `🎯 TP3: $${fmtPrice(signal.tp3)} *(${fmtPct(signal.entry, signal.tp3)})*\n` +
    `🛑 Stop Loss: $${fmtPrice(signal.stopLoss)} *(${fmtPct(signal.entry, signal.stopLoss)})*\n` +
    `⚖ Risk/Reward: *1:${signal.riskReward}*\n\n` +
    `📈 Market Structure: *${signal.structure.bias}*\n` +
    `🔧 Setup: ${signal.setup}\n` +
    rsiLine + volLine + bosLine + fvgLine + obLine + tvLine +
    `\n🎯 *Confidence: ${signal.confidence}%*\n` +
    `⏰ _Expires in 4 hours_`
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

// ── Deduplication ─────────────────────────────────────────────────────────────

function isDuplicateSignal(newSignal, recentSignals, windowMs = 4 * 60 * 60 * 1000) {
  const cutoff = Date.now() - windowMs
  return recentSignals.some(s =>
    s.symbol                           === newSignal.symbol &&
    s.bias                             === newSignal.bias &&
    (s.marketType || 'spot')           === (newSignal.marketType || 'spot') &&
    s.generatedAt > cutoff
  )
}

module.exports = { generateSignal, formatTelegramSignal, formatTelegramSignalWithButtons, isDuplicateSignal, fmtPrice }

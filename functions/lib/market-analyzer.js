'use strict'
const axios = require('axios')

const API_TIMEOUT = 8000

// ── Technical Indicators ─────────────────────────────────────────────────────

function calcEMA(prices, period) {
  if (prices.length < period) return null
  const k = 2 / (period + 1)
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k)
  return ema
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

function calcMACD(closes) {
  if (closes.length < 34) return null
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10
  let ema12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12
  let ema26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26
  const macdLine = []
  for (let i = 12; i < closes.length; i++) {
    ema12 = closes[i] * k12 + ema12 * (1 - k12)
    if (i >= 25) { ema26 = closes[i] * k26 + ema26 * (1 - k26); macdLine.push(ema12 - ema26) }
  }
  if (macdLine.length < 9) return null
  let signal = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9
  for (let i = 9; i < macdLine.length; i++) signal = macdLine[i] * k9 + signal * (1 - k9)
  const macd = macdLine[macdLine.length - 1]
  const prevMacd = macdLine.length > 1 ? macdLine[macdLine.length - 2] : macd
  return { macd, signal, histogram: macd - signal, prevHistogram: prevMacd - signal }
}

function calcBB(closes, period = 20, mult = 2) {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  const sma = slice.reduce((a, b) => a + b, 0) / period
  const std = Math.sqrt(slice.reduce((s, c) => s + Math.pow(c - sma, 2), 0) / period)
  return { upper: sma + mult * std, middle: sma, lower: sma - mult * std, std }
}

function calcATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null
  const trs = []
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period
}

function calcVolSMA(volumes, period = 20) {
  if (volumes.length < period) return null
  return volumes.slice(-period).reduce((a, b) => a + b, 0) / period
}

// ── Market Structure ─────────────────────────────────────────────────────────

function detectSwings(highs, lows, lookback = 3) {
  const swingHighs = [], swingLows = []
  for (let i = lookback; i < highs.length - lookback; i++) {
    let isH = true, isL = true
    for (let j = 1; j <= lookback; j++) {
      if (highs[i - j] >= highs[i] || highs[i + j] >= highs[i]) isH = false
      if (lows[i - j] <= lows[i] || lows[i + j] <= lows[i]) isL = false
    }
    if (isH) swingHighs.push({ index: i, price: highs[i] })
    if (isL) swingLows.push({ index: i, price: lows[i] })
  }
  return { swingHighs, swingLows }
}

function detectFVGs(opens, highs, lows, closes) {
  const fvgs = []
  for (let i = 2; i < closes.length; i++) {
    if (highs[i - 2] < lows[i] && closes[i] > opens[i]) {
      fvgs.push({ type: 'bull', low: highs[i - 2], high: lows[i], index: i })
    }
    if (lows[i - 2] > highs[i] && closes[i] < opens[i]) {
      fvgs.push({ type: 'bear', low: highs[i], high: lows[i - 2], index: i })
    }
  }
  return fvgs.slice(-30)
}

function detectOrderBlocks(opens, highs, lows, closes) {
  const n = closes.length
  let bullOB = null, bearOB = null
  for (let i = n - 4; i >= Math.max(0, n - 60); i--) {
    if (!bullOB && closes[i] < opens[i]) {
      const maxAfter = Math.max(...closes.slice(i + 1, Math.min(i + 10, n)))
      if (maxAfter > opens[i] * 1.015) {
        bullOB = { type: 'bull', low: lows[i], high: opens[i], index: i }
      }
    }
    if (!bearOB && closes[i] > opens[i]) {
      const minAfter = Math.min(...closes.slice(i + 1, Math.min(i + 10, n)))
      if (minAfter < opens[i] * 0.985) {
        bearOB = { type: 'bear', low: closes[i], high: highs[i], index: i }
      }
    }
    if (bullOB && bearOB) break
  }
  return { bullOB, bearOB }
}

function analyzeMarketStructure(opens, highs, lows, closes) {
  const { swingHighs, swingLows } = detectSwings(highs, lows)
  const fvgs = detectFVGs(opens, highs, lows, closes)
  const { bullOB, bearOB } = detectOrderBlocks(opens, highs, lows, closes)
  const currentPrice = closes[closes.length - 1]

  let bias = 'neutral', bos = false, choch = false
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const sh = swingHighs.slice(-3), sl = swingLows.slice(-3)
    const lastH = sh[sh.length - 1], prevH = sh[sh.length - 2]
    const lastL = sl[sl.length - 1], prevL = sl[sl.length - 2]
    const hhhl = lastH.price > prevH.price && lastL.price > prevL.price
    const lhll = lastH.price < prevH.price && lastL.price < prevL.price
    bias = hhhl ? 'bullish' : lhll ? 'bearish' : 'neutral'
    if (bias === 'bullish') { bos = currentPrice > lastH.price; choch = currentPrice < lastL.price }
    else if (bias === 'bearish') { bos = currentPrice < lastL.price; choch = currentPrice > lastH.price }
  }

  const relevantFVG = fvgs.slice().reverse().find(f => {
    const mid = (f.low + f.high) / 2
    return Math.abs(currentPrice - mid) / currentPrice < 0.06
  }) || null

  const nearBullOB = !!(bullOB && currentPrice >= bullOB.low * 0.98 && currentPrice <= bullOB.high * 1.03)
  const nearBearOB = !!(bearOB && currentPrice >= bearOB.low * 0.97 && currentPrice <= bearOB.high * 1.02)

  return { bias, bos, choch, swingHighs: swingHighs.slice(-5), swingLows: swingLows.slice(-5), fvgs: fvgs.slice(-10), relevantFVG, bullOB, bearOB, nearBullOB, nearBearOB }
}

// ── Scoring Engine ────────────────────────────────────────────────────────────

function scoreAnalysis(indicators, structure) {
  let score = 0, biasLong = 0, biasShort = 0
  const reasons = []

  // RSI (0-20)
  const rsi = indicators.rsi
  if (rsi !== null) {
    if (rsi >= 45 && rsi <= 65) { score += 20; reasons.push('RSI in momentum zone') }
    else if (rsi >= 35 && rsi < 45) { score += 14; biasLong += 5; reasons.push('RSI oversold recovery') }
    else if (rsi > 65 && rsi <= 75) { score += 12; biasLong += 3 }
    else if (rsi < 35) { score += 16; biasLong += 12; reasons.push('RSI oversold bounce') }
    else if (rsi > 75) { score += 6; biasShort += 12; reasons.push('RSI overbought') }
    if (rsi > 50) biasLong += 6; else biasShort += 6
  }

  // EMA Alignment (0-25)
  const { ema9, ema21, ema50, ema200, currentPrice } = indicators
  if (ema9 && ema21 && ema50 && currentPrice) {
    const bullAlign = currentPrice > ema9 && ema9 > ema21 && ema21 > ema50
    const bearAlign = currentPrice < ema9 && ema9 < ema21 && ema21 < ema50
    if (bullAlign) { score += 25; biasLong += 18; reasons.push('Perfect bullish EMA stack') }
    else if (bearAlign) { score += 25; biasShort += 18; reasons.push('Perfect bearish EMA stack') }
    else {
      if (currentPrice > ema50) { score += 8; biasLong += 8 }
      else { score += 8; biasShort += 8 }
      if (currentPrice > ema21) { score += 5; biasLong += 4 }
      else { biasShort += 4 }
      if (currentPrice > ema9) { score += 5; biasLong += 3 }
      else { biasShort += 3 }
    }
    if (ema200 && currentPrice > ema200) { biasLong += 5; reasons.push('Above EMA200') }
    else if (ema200) { biasShort += 5; reasons.push('Below EMA200') }
  }

  // MACD (0-15)
  const macd = indicators.macd
  if (macd) {
    const { histogram, prevHistogram } = macd
    if (histogram > 0 && histogram > prevHistogram) { score += 15; biasLong += 10; reasons.push('MACD bullish momentum expanding') }
    else if (histogram > 0) { score += 10; biasLong += 5; reasons.push('MACD bullish') }
    else if (histogram < 0 && histogram < prevHistogram) { score += 15; biasShort += 10; reasons.push('MACD bearish momentum expanding') }
    else if (histogram < 0) { score += 10; biasShort += 5 }
    if (macd.macd > macd.signal) biasLong += 4; else biasShort += 4
  }

  // Market Structure (0-25)
  if (structure.bias === 'bullish') { score += 10; biasLong += 15; reasons.push('Higher highs / Higher lows') }
  else if (structure.bias === 'bearish') { score += 10; biasShort += 15; reasons.push('Lower highs / Lower lows') }
  if (structure.bos) {
    score += 10
    if (structure.bias === 'bullish') biasLong += 10; else biasShort += 10
    reasons.push('Break of Structure confirmed')
  }
  if (structure.relevantFVG) {
    score += 5
    if (structure.relevantFVG.type === 'bull') biasLong += 5; else biasShort += 5
    reasons.push('Price near Fair Value Gap')
  }
  if (structure.nearBullOB) { score += 5; biasLong += 8; reasons.push('Bullish Order Block confluence') }
  if (structure.nearBearOB) { score += 5; biasShort += 8; reasons.push('Bearish Order Block confluence') }

  // Volume spike bonus (0-5)
  if (indicators.volumeRatio && indicators.volumeRatio > 1.5) {
    score += 5
    if (currentPrice > (indicators.prevClose || currentPrice)) biasLong += 5; else biasShort += 5
    reasons.push(`Volume spike (${indicators.volumeRatio.toFixed(1)}x avg)`)
  }

  const bias = biasLong > biasShort ? 'long' : biasShort > biasLong ? 'short' : 'neutral'
  return { score: Math.min(Math.round(score), 100), bias, reasons: reasons.slice(0, 5) }
}

// ── Exchange Data Fetching ────────────────────────────────────────────────────

function intervalForExchange(tf, exchange) {

  const map = {
    binance: { '15M': '15m', '1H': '1h', '4H': '4h', '1D': '1d' },
    mexc:    { '15M': '15m', '1H': '60m', '4H': '4h', '1D': '1d' },
    bybit:   { '15M': '15', '1H': '60', '4H': '240', '1D': 'D' },
    kucoin:  { '15M': '15min', '1H': '1hour', '4H': '4hour', '1D': '1day' },
  }
  return (map[exchange] || map.binance)[tf] || '4h'
}

async function fetchBinanceKlines(symbol, tf, limit = 200) {
  const r = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`, { timeout: API_TIMEOUT })
  return r.data.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
}

async function fetchMexcKlines(symbol, tf, limit = 200) {
  const r = await axios.get(`https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`, { timeout: API_TIMEOUT })
  return r.data.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
}

async function fetchBybitKlines(symbol, tf, limit = 200) {
  const r = await axios.get(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${tf}&limit=${limit}`, { timeout: API_TIMEOUT })
  const list = r.data?.result?.list || []
  return list.reverse().map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
}

async function fetchKucoinKlines(symbol, tf, limit = 200) {
  const kSym = symbol.endsWith('USDT') ? symbol.replace('USDT', '-USDT') : symbol
  const endAt = Math.floor(Date.now() / 1000)
  const secPerCandle = tf === '1hour' ? 3600 : tf === '4hour' ? 14400 : tf === '1day' ? 86400 : 900
  const startAt = endAt - limit * secPerCandle
  const r = await axios.get(`https://api.kucoin.com/api/v1/market/candles?type=${tf}&symbol=${kSym}&startAt=${startAt}&endAt=${endAt}`, { timeout: API_TIMEOUT })
  const data = r.data?.data || []
  return data.reverse().map(k => ({ time: +k[0] * 1000, open: +k[1], close: +k[2], high: +k[3], low: +k[4], volume: +k[5] }))
}

async function fetchKlines(symbol, exchange, tf) {
  try {
    const interval = intervalForExchange(tf, exchange)
    switch (exchange) {
      case 'binance': return await fetchBinanceKlines(symbol, interval)
      case 'mexc':    return await fetchMexcKlines(symbol, interval)
      case 'bybit':   return await fetchBybitKlines(symbol, interval)
      case 'kucoin':  return await fetchKucoinKlines(symbol, interval)
      default: return null
    }
  } catch (_) { return null }
}

// ── Futures Kline Fetching ────────────────────────────────────────────────────

const BINANCE_FUTURES_BASES = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com',
]

const MEXC_FUTURES_BASE = 'https://contract.mexc.com'

// Convert BTCUSDT → BTC_USDT for MEXC contract API
function mexcFuturesSymbol(symbol) {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) + '_USDT' : symbol
}

function futuresIntervalForExchange(tf, exchange) {
  const map = {
    binance: { '15M': '15m',   '1H': '1h',    '4H': '4h',    '1D': '1d' },
    bybit:   { '15M': '15',    '1H': '60',    '4H': '240',   '1D': 'D'  },
    mexc:    { '15M': 'Min15', '1H': 'Hour1', '4H': 'Hour4', '1D': 'Day1' },
  }
  return (map[exchange] || map.binance)[tf] || '4h'
}

async function fetchBinanceFuturesKlines(symbol, tf, limit = 200) {
  let lastErr
  for (const base of BINANCE_FUTURES_BASES) {
    try {
      const r = await axios.get(`${base}/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`, { timeout: API_TIMEOUT })
      return r.data.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

async function fetchBybitLinearKlines(symbol, tf, limit = 200) {
  const r = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${tf}&limit=${limit}`, { timeout: API_TIMEOUT })
  const list = r.data?.result?.list || []
  return list.reverse().map(k => ({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
}

async function fetchMexcFuturesKlines(symbol, interval, limit = 200) {
  const fxSym = mexcFuturesSymbol(symbol)
  const secMap = { Min15: 900, Hour1: 3600, Hour4: 14400, Day1: 86400 }
  const secPerCandle = secMap[interval] || 14400
  const end   = Math.floor(Date.now() / 1000)
  const start = end - (limit + 5) * secPerCandle
  const r = await axios.get(
    `${MEXC_FUTURES_BASE}/api/v1/contract/kline/${fxSym}?interval=${interval}&start=${start}&end=${end}`,
    { timeout: API_TIMEOUT }
  )
  const d = r.data?.data
  if (!d?.time?.length) return []
  return d.time.map((t, i) => ({
    time:   t * 1000,
    open:   parseFloat(d.open[i]),
    high:   parseFloat(d.high[i]),
    low:    parseFloat(d.low[i]),
    close:  parseFloat(d.close[i]),
    volume: parseFloat(d.vol[i]),
  }))
}

async function fetchFuturesKlines(symbol, exchange, tf) {
  try {
    const interval = futuresIntervalForExchange(tf, exchange)
    switch (exchange) {
      case 'binance': return await fetchBinanceFuturesKlines(symbol, interval)
      case 'bybit':   return await fetchBybitLinearKlines(symbol, interval)
      case 'mexc':    return await fetchMexcFuturesKlines(symbol, interval)
      default: return null
    }
  } catch (_) { return null }
}

// ── Top Symbol Discovery ──────────────────────────────────────────────────────

async function fetchTopSymbols(exchange, limit = 50) {
  try {
    switch (exchange) {
      case 'binance': {
        const r = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: API_TIMEOUT })
        return r.data
          .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('DOWN') && !t.symbol.includes('UP') && +t.quoteVolume > 100000)
          .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
          .slice(0, limit)
          .map(t => ({ symbol: t.symbol, volume: +t.quoteVolume, change: +t.priceChangePercent }))
      }
      case 'mexc': {
        const r = await axios.get('https://api.mexc.com/api/v3/ticker/24hr', { timeout: API_TIMEOUT })
        return r.data
          .filter(t => t.symbol.endsWith('USDT') && +t.quoteVolume > 50000)
          .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
          .slice(0, limit)
          .map(t => ({ symbol: t.symbol, volume: +t.quoteVolume, change: +t.priceChangePercent }))
      }
      case 'bybit': {
        const r = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot', { timeout: API_TIMEOUT })
        const list = r.data?.result?.list || []
        return list
          .filter(t => t.symbol.endsWith('USDT') && +t.turnover24h > 50000)
          .sort((a, b) => +b.turnover24h - +a.turnover24h)
          .slice(0, limit)
          .map(t => ({ symbol: t.symbol, volume: +t.turnover24h, change: +t.price24hPcnt * 100 }))
      }
      case 'kucoin': {
        const r = await axios.get('https://api.kucoin.com/api/v1/market/allTickers', { timeout: API_TIMEOUT })
        const list = r.data?.data?.ticker || []
        return list
          .filter(t => t.symbol.endsWith('-USDT') && +t.volValue > 50000)
          .sort((a, b) => +b.volValue - +a.volValue)
          .slice(0, limit)
          .map(t => ({ symbol: t.symbol.replace('-USDT', 'USDT'), kucoinSymbol: t.symbol, volume: +t.volValue, change: +t.changeRate * 100 }))
      }
      default: return []
    }
  } catch (err) {
    console.error(`fetchTopSymbols ${exchange}:`, err.message)
    return []
  }
}

// ── Futures Symbol Discovery ──────────────────────────────────────────────────

async function fetchFuturesTopSymbols(exchange, limit = 50) {
  try {
    switch (exchange) {
      case 'binance': {
        let data = null
        for (const base of BINANCE_FUTURES_BASES) {
          try {
            const r = await axios.get(`${base}/fapi/v1/ticker/24hr`, { timeout: API_TIMEOUT })
            data = r.data; break
          } catch (_) {}
        }
        if (!data) return []
        return data
          .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
          .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
          .slice(0, limit)
          .map(t => ({ symbol: t.symbol, volume: +t.quoteVolume, change: +t.priceChangePercent }))
      }
      case 'bybit': {
        const r = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear', { timeout: API_TIMEOUT })
        const list = r.data?.result?.list || []
        return list
          .filter(t => t.symbol.endsWith('USDT'))
          .sort((a, b) => +b.turnover24h - +a.turnover24h)
          .slice(0, limit)
          .map(t => ({ symbol: t.symbol, volume: +t.turnover24h, change: +(t.price24hPcnt || 0) * 100 }))
      }
      case 'mexc': {
        const r = await axios.get(`${MEXC_FUTURES_BASE}/api/v1/contract/ticker`, { timeout: API_TIMEOUT })
        const list = r.data?.data || []
        return list
          .filter(t => t.symbol.endsWith('_USDT') && parseFloat(t.amount24 || 0) > 500000)
          .sort((a, b) => parseFloat(b.amount24 || 0) - parseFloat(a.amount24 || 0))
          .slice(0, limit)
          .map(t => ({
            symbol: t.symbol.replace('_USDT', 'USDT'), // normalize to BTCUSDT
            volume: parseFloat(t.amount24 || 0),
            change: parseFloat(t.riseFallRate || 0) * 100,
          }))
      }
      default: return []
    }
  } catch (err) {
    console.error(`fetchFuturesTopSymbols ${exchange}:`, err.message)
    return []
  }
}

// ── TradingView Analysis (Futures Confirmation Layer) ────────────────────────

const TV_TF_MAP       = { '15M': '15', '1H': '60', '4H': '240', '1D': '1D' }
const TV_EXCHANGE_MAP = { binance: 'BINANCE', bybit: 'BYBIT' }
// MEXC futures are not on TradingView — analysis falls back to candle-only for MEXC

async function fetchTradingViewAnalysis(symbol, exchange, timeframe) {
  const tf    = TV_TF_MAP[timeframe] || '240'
  const tvEx  = TV_EXCHANGE_MAP[exchange]
  if (!tvEx) return null   // exchange not mapped on TradingView
  const tvSym = `${tvEx}:${symbol}.P`
  const sfx    = `|${tf}`

  const columns = [
    `Recommend.All${sfx}`, `Recommend.MA${sfx}`, `Recommend.Other${sfx}`,
    `RSI${sfx}`, `RSI[1]${sfx}`,
    `MACD.macd${sfx}`, `MACD.signal${sfx}`,
    `Mom${sfx}`, `ADX${sfx}`, `ATR${sfx}`,
    `EMA20${sfx}`, `EMA50${sfx}`, `EMA200${sfx}`,
    `close${sfx}`, `volume${sfx}`,
  ]

  try {
    const r = await axios.post(
      'https://scanner.tradingview.com/crypto/scan',
      { symbols: { tickers: [tvSym], query: { types: [] } }, columns },
      {
        timeout: API_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer':      'https://www.tradingview.com',
          'Origin':       'https://www.tradingview.com',
        },
      }
    )
    const row = r.data?.data?.[0]?.d
    if (!row || row.length < 3 || row[0] == null) return null
    return {
      recommendAll: row[0],   // -1 (strong sell) … +1 (strong buy)
      recommendMA:  row[1],
      recommendOsc: row[2],
      rsi:          row[3],
      rsiPrev:      row[4],
      macdLine:     row[5],
      macdSignal:   row[6],
      momentum:     row[7],
      adx:          row[8],
      atr:          row[9],
      ema20:        row[10],
      ema50:        row[11],
      ema200:       row[12],
      price:        row[13],
      volume:       row[14],
    }
  } catch (_) { return null }
}

function tvRecommendLabel(val) {
  if (val == null)  return null
  if (val >=  0.5)  return 'Strong Buy'
  if (val >=  0.1)  return 'Buy'
  if (val <= -0.5)  return 'Strong Sell'
  if (val <= -0.1)  return 'Sell'
  return 'Neutral'
}

function mergeTradingViewData(analysis, tv) {
  const rec    = tv.recommendAll
  const tvBias = rec >= 0.1 ? 'long' : rec <= -0.1 ? 'short' : 'neutral'

  if (tvBias !== 'neutral' && analysis.bias !== 'neutral' && tvBias !== analysis.bias) {
    // TV contradicts our candle analysis — heavy penalty for futures
    analysis.score   = Math.max(0, analysis.score - 30)
    analysis.reasons = ['⚠ TV/price-action divergence', ...analysis.reasons.slice(0, 4)]
  } else if (tvBias === analysis.bias && tvBias !== 'neutral') {
    // TV confirms — boost proportional to signal strength
    const boost = Math.min(Math.round(Math.abs(rec) * 20), 20)
    analysis.score = Math.min(100, analysis.score + boost)
    analysis.reasons.push(`TradingView: ${tvRecommendLabel(rec)}`)
  }

  // MA + oscillator double-confirmation bonus
  const oscBias = tv.recommendOsc >= 0.1 ? 'long' : tv.recommendOsc <= -0.1 ? 'short' : 'neutral'
  const maBias  = tv.recommendMA  >= 0.1 ? 'long' : tv.recommendMA  <= -0.1 ? 'short' : 'neutral'
  if (oscBias === analysis.bias && maBias === analysis.bias && analysis.bias !== 'neutral') {
    analysis.score = Math.min(100, analysis.score + 5)
  }

  // ADX trend-strength filter — futures signals in ranging markets are high-risk
  if (tv.adx != null) {
    if (tv.adx < 15) {
      analysis.score = Math.max(0, analysis.score - 10)
      analysis.reasons.push(`Very choppy ADX ${Math.round(tv.adx)}`)
    } else if (tv.adx < 20) {
      analysis.score = Math.max(0, analysis.score - 5)
      analysis.reasons.push(`Weak trend ADX ${Math.round(tv.adx)}`)
    } else if (tv.adx >= 40) {
      analysis.score = Math.min(100, analysis.score + 5)
      analysis.reasons.push(`Strong trend ADX ${Math.round(tv.adx)}`)
    }
  }

  // EMA200 from TV is computed on full chart history — more reliable than our 200-bar slice
  if (tv.ema200 != null && tv.price != null) {
    const aboveEma200 = tv.price > tv.ema200
    if (aboveEma200 && analysis.bias === 'long')  { analysis.score = Math.min(100, analysis.score + 4) }
    if (!aboveEma200 && analysis.bias === 'short') { analysis.score = Math.min(100, analysis.score + 4) }
    if (aboveEma200 && analysis.bias === 'short')  { analysis.score = Math.max(0, analysis.score - 5) }
    if (!aboveEma200 && analysis.bias === 'long')  { analysis.score = Math.max(0, analysis.score - 5) }
  }

  // Override RSI with TV value (TV computes on full exchange history)
  if (tv.rsi != null) analysis.indicators.rsi = tv.rsi

  // Attach enriched data for downstream use in signal-generator
  analysis.indicators.adx      = tv.adx      != null ? tv.adx      : null
  analysis.indicators.momentum = tv.momentum != null ? tv.momentum : null
  analysis.tvRecommend = {
    value:       rec,
    label:       tvRecommendLabel(rec),
    ma:          tv.recommendMA,
    oscillators: tv.recommendOsc,
    adx:         tv.adx,
  }
}

// ── Fundamental Score (CoinGecko) ─────────────────────────────────────────────

const COINGECKO_IDS = {
  btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', sol: 'solana', xrp: 'ripple',
  ada: 'cardano', avax: 'avalanche-2', dot: 'polkadot', matic: 'matic-network',
  link: 'chainlink', uni: 'uniswap', ltc: 'litecoin', bch: 'bitcoin-cash',
  atom: 'cosmos', near: 'near', apt: 'aptos', sui: 'sui', op: 'optimism',
  arb: 'arbitrum', doge: 'dogecoin', shib: 'shiba-inu', pepe: 'pepe',
  ton: 'the-open-network', trx: 'tron', xlm: 'stellar', fil: 'filecoin',
  algo: 'algorand', vet: 'vechain', icp: 'internet-computer', hbar: 'hedera-hashgraph',
  inj: 'injective-protocol', sei: 'sei-network', tia: 'celestia', jup: 'jupiter-exchange-solana',
  wif: 'dogwifcoin', bonk: 'bonk', pyth: 'pyth-network', strk: 'starknet',
  ena: 'ethena', w: 'wormhole', jto: 'jito-governance-token', alt: 'altlayer',
  io: 'io-net', zk: 'zksync', render: 'render-token', fet: 'fetch-ai',
  ocean: 'ocean-protocol', agix: 'singularitynet', grt: 'the-graph',
  mkr: 'maker', aave: 'aave', crv: 'curve-dao-token', snx: 'havven',
  ldo: 'lido-dao', rpl: 'rocket-pool', eigen: 'eigenlayer', mew: 'cat-in-a-dogs-world',
}

async function getFundamentalScore(symbol) {
  const base = symbol.replace(/USDT$/i, '').toLowerCase()
  const cgId = COINGECKO_IDS[base]
  if (!cgId) return 5
  try {
    const r = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${cgId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
      { timeout: API_TIMEOUT }
    )
    const md = r.data?.market_data
    if (!md) return 5
    let fundScore = 0
    const rank = r.data.market_cap_rank || 999
    if (rank <= 20) fundScore += 10
    else if (rank <= 50) fundScore += 8
    else if (rank <= 100) fundScore += 6
    else if (rank <= 200) fundScore += 4
    else fundScore += 2
    const vol = md.total_volume?.usd || 0
    if (vol > 1e9) fundScore += 5
    else if (vol > 100e6) fundScore += 3
    else if (vol > 10e6) fundScore += 1
    return Math.min(fundScore, 15)
  } catch (_) { return 5 }
}

// ── Shared Analysis Core ──────────────────────────────────────────────────────

function runAnalysisOnCandles(symbol, exchange, timeframe, candles, volume24h, marketType = 'spot') {
  const opens   = candles.map(c => c.open)
  const highs   = candles.map(c => c.high)
  const lows    = candles.map(c => c.low)
  const closes  = candles.map(c => c.close)
  const volumes = candles.map(c => c.volume)

  const currentPrice = closes[closes.length - 1]
  const prevClose    = closes[closes.length - 2] || currentPrice

  const rsi      = calcRSI(closes)
  const macd     = calcMACD(closes)
  const bb       = calcBB(closes)
  const atr      = calcATR(highs, lows, closes)
  const ema9     = calcEMA(closes, 9)
  const ema21    = calcEMA(closes, 21)
  const ema50    = calcEMA(closes, 50)
  const ema200   = closes.length >= 200 ? calcEMA(closes, 200) : null
  const volSMA   = calcVolSMA(volumes)
  const volRatio = volSMA && volSMA > 0 ? volumes[volumes.length - 1] / volSMA : null

  const structure  = analyzeMarketStructure(opens, highs, lows, closes)
  const indicators = { rsi, macd, bb, atr, ema9, ema21, ema50, ema200, currentPrice, prevClose, volumeRatio: volRatio }
  const scored     = scoreAnalysis(indicators, structure)

  return {
    symbol, exchange, timeframe, marketType,
    isAlpha: marketType === 'spot' && volume24h > 0 && volume24h < 5e6,
    currentPrice, atr,
    indicators: { rsi, macd, bb, ema9, ema21, ema50, ema200, volumeRatio: volRatio, atr },
    structure, score: scored.score, bias: scored.bias, reasons: scored.reasons,
    volume24h, analyzedAt: Date.now(),
  }
}

// ── Full Symbol Analysis ──────────────────────────────────────────────────────

async function analyzeSymbol(symbol, exchange, timeframe = '4H', volume24h = 0) {
  const candles = await fetchKlines(symbol, exchange, timeframe)
  if (!candles || candles.length < 50) return null

  const result  = runAnalysisOnCandles(symbol, exchange, timeframe, candles, volume24h, 'spot')
  const isAlpha = volume24h > 0 && volume24h < 5e6
  result.isAlpha = isAlpha

  let fundScore = 5
  if (!isAlpha && Math.random() < 0.25) fundScore = await getFundamentalScore(symbol)
  result.score = Math.min(result.score + Math.min(fundScore, 10), 100)

  return result
}

async function analyzeSymbolFutures(symbol, exchange, timeframe = '4H', volume24h = 0) {
  const [candlesResult, tvResult] = await Promise.allSettled([
    fetchFuturesKlines(symbol, exchange, timeframe),
    fetchTradingViewAnalysis(symbol, exchange, timeframe),
  ])

  const candles = candlesResult.status === 'fulfilled' ? candlesResult.value : null
  if (!candles || candles.length < 50) return null

  const analysis = runAnalysisOnCandles(symbol, exchange, timeframe, candles, volume24h, 'futures')

  const tv = tvResult.status === 'fulfilled' ? tvResult.value : null
  if (tv) mergeTradingViewData(analysis, tv)

  return analysis
}

// ── Spot Exchange Scanner ─────────────────────────────────────────────────────

async function scanExchange(exchange, timeframe = '4H', limit = 45, minScore = 68) {
  const symbols = await fetchTopSymbols(exchange, limit)
  if (!symbols.length) return []

  const results = []
  const BATCH   = 5

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      batch.map(s => analyzeSymbol(s.symbol, exchange, timeframe, s.volume))
    )
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value && r.value.score >= minScore && r.value.bias !== 'neutral') {
        results.push(r.value)
      }
    }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 180))
  }

  return results.sort((a, b) => b.score - a.score)
}

// ── Futures Exchange Scanner ──────────────────────────────────────────────────

async function scanFuturesExchange(exchange, timeframe = '4H', limit = 40, minScore = 65) {
  const symbols = await fetchFuturesTopSymbols(exchange, limit)
  console.log(`[futures] ${exchange} top symbols fetched: ${symbols.length}`)
  if (!symbols.length) return []

  const results = []
  const BATCH   = 5

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    const settled = await Promise.allSettled(
      batch.map(s => analyzeSymbolFutures(s.symbol, exchange, timeframe, s.volume))
    )
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        const v = r.value
        console.log(`[futures] ${exchange} ${v.symbol} score=${v.score} bias=${v.bias} tv=${v.tvRecommend?.label || 'n/a'}`)
        if (v.score >= minScore && v.bias !== 'neutral') results.push(v)
      } else if (r.status === 'rejected') {
        console.error(`[futures] ${exchange} analysis failed:`, r.reason?.message)
      }
    }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 200))
  }

  console.log(`[futures] ${exchange} qualified signals: ${results.length}`)
  return results.sort((a, b) => b.score - a.score)
}

module.exports = {
  analyzeSymbol, analyzeSymbolFutures, scanExchange, scanFuturesExchange, fetchTopSymbols,
  calcEMA, calcRSI, calcMACD, calcBB, calcATR,
}

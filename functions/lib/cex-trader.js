'use strict'
const axios  = require('axios')
const crypto = require('crypto')

const API_TIMEOUT = 10000

function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex')
}

function hmacB64(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('base64')
}

// ── Binance base-URL retry ────────────────────────────────────────────────────
// Binance blocks some GCP regions with HTTP 451 (geo-restriction). Trying the
// backup hostnames (api1–api4) can route around the block. If ALL fail with 451
// we throw a descriptive error instead of a raw status code.
const BINANCE_BASES = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
]

function parseBinanceError(e) {
  if (e?.response?.data?.msg) return new Error(`Binance: ${e.response.data.msg}`)
  if (e?.response?.data?.message) return new Error(`Binance: ${e.response.data.message}`)
  return e
}

async function binanceGet(path, qs, apiKey = null) {
  const headers = apiKey ? { 'X-MBX-APIKEY': apiKey } : {}
  let hit451 = false
  for (const base of BINANCE_BASES) {
    try {
      return await axios.get(`${base}${path}?${qs}`, { headers, timeout: API_TIMEOUT })
    } catch (e) {
      if (e?.response?.status === 451) { hit451 = true; continue }
      throw parseBinanceError(e)
    }
  }
  if (hit451) throw new Error('Binance API is geo-restricted from this server (HTTP 451). Use MEXC, Bybit, or KuCoin instead, or redeploy Firebase Functions to europe-west1.')
}

async function binancePost(path, qs, apiKey) {
  let hit451 = false
  for (const base of BINANCE_BASES) {
    try {
      return await axios.post(`${base}${path}?${qs}`, null, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: API_TIMEOUT })
    } catch (e) {
      if (e?.response?.status === 451) { hit451 = true; continue }
      throw parseBinanceError(e)
    }
  }
  if (hit451) throw new Error('Binance API is geo-restricted from this server (HTTP 451). Use MEXC, Bybit, or KuCoin instead, or redeploy Firebase Functions to europe-west1.')
}

async function binanceDelete(path, qs, apiKey) {
  let hit451 = false
  for (const base of BINANCE_BASES) {
    try {
      return await axios.delete(`${base}${path}?${qs}`, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: API_TIMEOUT })
    } catch (e) {
      if (e?.response?.status === 451) { hit451 = true; continue }
      throw parseBinanceError(e)
    }
  }
  if (hit451) throw new Error('Binance API is geo-restricted from this server (HTTP 451). Use MEXC, Bybit, or KuCoin instead, or redeploy Firebase Functions to europe-west1.')
}

// ── Symbol Info ───────────────────────────────────────────────────────────────
// Fetches lot-size constraints from each exchange's public API (no auth).
// Returns { exists, stepSize, minQty, minNotional } or null if symbol not found.

async function getSymbolInfo(exchange, symbol) {
  try {
    switch (exchange) {
      case 'binance': {
        const r   = await binanceGet('/api/v3/exchangeInfo', `symbol=${symbol}`)
        const sym = r.data?.symbols?.[0]
        if (!sym) return null
        const lot      = sym.filters.find(f => f.filterType === 'LOT_SIZE') || {}
        const notional = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL') || {}
        const price    = sym.filters.find(f => f.filterType === 'PRICE_FILTER') || {}
        return {
          exists: true,
          stepSize:    parseFloat(lot.stepSize    || '0.001'),
          minQty:      parseFloat(lot.minQty      || '0'),
          minNotional: parseFloat(notional.minNotional || notional.minOrderValue || '5'),
          tickSize:    parseFloat(price.tickSize  || '0'),
        }
      }
      case 'mexc': {
        const r   = await axios.get(`https://api.mexc.com/api/v3/exchangeInfo?symbol=${symbol}`, { timeout: 8000 })
        const sym = r.data?.symbols?.[0]
        if (!sym) return null
        const lot      = sym.filters.find(f => f.filterType === 'LOT_SIZE') || {}
        const notional = sym.filters.find(f => f.filterType === 'MIN_NOTIONAL') || {}
        return {
          exists: true,
          stepSize:    parseFloat(lot.stepSize    || '0.01'),
          minQty:      parseFloat(lot.minQty      || '0'),
          minNotional: parseFloat(notional.minNotional || '1'),
        }
      }
      case 'bybit': {
        const r   = await axios.get(`https://api.bybit.com/v5/market/instruments-info?category=spot&symbol=${symbol}`, { timeout: 8000 })
        const sym = r.data?.result?.list?.[0]
        if (!sym) return null
        const lot = sym.lotSizeFilter || {}
        return {
          exists: true,
          stepSize:    parseFloat(lot.basePrecision || '0.001'),
          minQty:      parseFloat(lot.minOrderQty   || '0'),
          minNotional: parseFloat(lot.minOrderAmt   || '1'),
        }
      }
      case 'kucoin': {
        const kSym = symbol.endsWith('USDT') ? symbol.replace('USDT', '-USDT') : symbol
        const r    = await axios.get(`https://api.kucoin.com/api/v2/symbols/${kSym}`, { timeout: 8000 })
        const sym  = r.data?.data
        if (!sym) return null
        return {
          exists: true,
          stepSize:    parseFloat(sym.baseIncrement || '0.001'),
          minQty:      parseFloat(sym.baseMinSize   || '0'),
          minNotional: parseFloat(sym.quoteMinSize  || '0.1'),
        }
      }
      default: return { exists: true, stepSize: 0.001, minQty: 0, minNotional: 1 }
    }
  } catch (e) {
    const status = e?.response?.status
    if (status === 400 || status === 404) return null  // symbol does not exist on this exchange
    // Network / timeout — assume symbol exists, use safe defaults
    return { exists: true, stepSize: 0.001, minQty: 0, minNotional: 1 }
  }
}

function roundToStep(value, step) {
  if (!step || step <= 0) return value
  const precision = Math.max(0, -Math.floor(Math.log10(step)))
  return parseFloat((Math.floor(value / step) * step).toFixed(precision))
}

// ── Binance ───────────────────────────────────────────────────────────────────

async function placeBinanceOrder(apiKey, secret, symbol, side, type, quantity, price = null) {
  const ts     = Date.now()
  const params = { symbol, side: side.toUpperCase(), type: type.toUpperCase(), quantity: String(quantity), timestamp: ts, recvWindow: 5000 }
  if (type.toUpperCase() === 'LIMIT' && price) { params.price = String(price); params.timeInForce = 'GTC' }
  const qs  = new URLSearchParams(params).toString()
  const sig = hmacHex(secret, qs)
  const r   = await binancePost('/api/v3/order', `${qs}&signature=${sig}`, apiKey)
  return { orderId: String(r.data.orderId), status: r.data.status, exchange: 'binance', raw: r.data }
}

// Market buy spending an exact USDT amount — no base-token step size needed
async function placeBinanceMarketBuy(apiKey, secret, symbol, usdtAmount) {
  const ts     = Date.now()
  const params = { symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: usdtAmount.toFixed(2), timestamp: ts, recvWindow: 5000 }
  const qs     = new URLSearchParams(params).toString()
  const sig    = hmacHex(secret, qs)
  const r      = await binancePost('/api/v3/order', `${qs}&signature=${sig}`, apiKey)
  return { orderId: String(r.data.orderId), status: r.data.status, exchange: 'binance', raw: r.data }
}

async function cancelBinanceOrder(apiKey, secret, symbol, orderId) {
  const ts  = Date.now()
  const qs  = `symbol=${symbol}&orderId=${orderId}&timestamp=${ts}&recvWindow=5000`
  const sig = hmacHex(secret, qs)
  const r   = await binanceDelete('/api/v3/order', `${qs}&signature=${sig}`, apiKey)
  return { orderId: String(r.data.orderId), status: r.data.status }
}

async function getBinanceSpotBalance(apiKey, secret, asset = 'USDT') {
  const ts  = Date.now()
  const qs  = `timestamp=${ts}&recvWindow=5000`
  const sig = hmacHex(secret, qs)
  const r   = await binanceGet('/api/v3/account', `${qs}&signature=${sig}`, apiKey)
  const bal = (r.data.balances || []).find(b => b.asset === asset.toUpperCase())
  return { free: parseFloat(bal?.free || 0), locked: parseFloat(bal?.locked || 0) }
}

// ── MEXC ──────────────────────────────────────────────────────────────────────

async function placeMexcOrder(apiKey, secret, symbol, side, type, quantity, price = null) {
  const ts     = Date.now()
  const params = { symbol, side: side.toUpperCase(), type: type.toUpperCase(), quantity: String(quantity), timestamp: ts, recvWindow: 5000 }
  if (type.toUpperCase() === 'LIMIT' && price) { params.price = String(price); params.timeInForce = 'GTC' }
  const qs  = new URLSearchParams(params).toString()
  const sig = hmacHex(secret, qs)
  const r   = await axios.post(`https://api.mexc.com/api/v3/order?${qs}&signature=${sig}`, null, {
    headers: { 'X-MEXC-APIKEY': apiKey }, timeout: API_TIMEOUT,
  })
  return { orderId: String(r.data.orderId), status: r.data.status, exchange: 'mexc', raw: r.data }
}

// Market buy spending an exact USDT amount — no base-token step size needed
async function placeMexcMarketBuy(apiKey, secret, symbol, usdtAmount) {
  const ts     = Date.now()
  const params = { symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: usdtAmount.toFixed(2), timestamp: ts, recvWindow: 5000 }
  const qs     = new URLSearchParams(params).toString()
  const sig    = hmacHex(secret, qs)
  const r      = await axios.post(`https://api.mexc.com/api/v3/order?${qs}&signature=${sig}`, null, {
    headers: { 'X-MEXC-APIKEY': apiKey }, timeout: API_TIMEOUT,
  })
  return { orderId: String(r.data.orderId), status: r.data.status, exchange: 'mexc', raw: r.data }
}

async function getMexcSpotBalance(apiKey, secret, asset = 'USDT') {
  const ts  = Date.now()
  const qs  = `timestamp=${ts}&recvWindow=5000`
  const sig = hmacHex(secret, qs)
  const r   = await axios.get(`https://api.mexc.com/api/v3/account?${qs}&signature=${sig}`, {
    headers: { 'X-MEXC-APIKEY': apiKey }, timeout: API_TIMEOUT,
  })
  const bal = (r.data.balances || []).find(b => b.asset === asset.toUpperCase())
  return { free: parseFloat(bal?.free || 0), locked: parseFloat(bal?.locked || 0) }
}

// ── Bybit ─────────────────────────────────────────────────────────────────────

async function placeBybitOrder(apiKey, secret, symbol, side, type, qty, price = null) {
  const ts         = Date.now().toString()
  const recvWindow = '5000'
  const params     = { category: 'spot', symbol, side: side === 'buy' ? 'Buy' : 'Sell', orderType: type === 'MARKET' ? 'Market' : 'Limit', qty: String(qty), marketUnit: 'baseCoin' }
  if (type !== 'MARKET' && price) { params.price = String(price); params.timeInForce = 'GTC' }
  const body    = JSON.stringify(params)
  const signStr = ts + apiKey + recvWindow + body
  const sig     = hmacHex(secret, signStr)
  const r       = await axios.post('https://api.bybit.com/v5/order/create', body, {
    headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': recvWindow },
    timeout: API_TIMEOUT,
  })
  const res = r.data?.result || {}
  return { orderId: res.orderId || 'unknown', status: res.orderStatus || 'submitted', exchange: 'bybit', raw: r.data }
}

// Market buy spending an exact USDT amount via marketUnit=quoteCoin
async function placeBybitMarketBuy(apiKey, secret, symbol, usdtAmount) {
  const ts         = Date.now().toString()
  const recvWindow = '5000'
  const params     = { category: 'spot', symbol, side: 'Buy', orderType: 'Market', qty: usdtAmount.toFixed(2), marketUnit: 'quoteCoin' }
  const body       = JSON.stringify(params)
  const signStr    = ts + apiKey + recvWindow + body
  const sig        = hmacHex(secret, signStr)
  const r          = await axios.post('https://api.bybit.com/v5/order/create', body, {
    headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': recvWindow },
    timeout: API_TIMEOUT,
  })
  if (r.data?.retCode !== 0) throw new Error(r.data?.retMsg || 'Bybit order failed')
  const res = r.data?.result || {}
  return { orderId: res.orderId || 'unknown', status: res.orderStatus || 'submitted', exchange: 'bybit', raw: r.data }
}

async function getBybitSpotBalance(apiKey, secret, coin = 'USDT') {
  const ts         = Date.now().toString()
  const recvWindow = '5000'
  const qs         = `accountType=SPOT&coin=${coin}`
  const signStr    = ts + apiKey + recvWindow + qs
  const sig        = hmacHex(secret, signStr)
  const r          = await axios.get(`https://api.bybit.com/v5/account/wallet-balance?${qs}`, {
    headers: { 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': recvWindow },
    timeout: API_TIMEOUT,
  })
  const list  = r.data?.result?.list || []
  const coins = list[0]?.coin || []
  const entry = coins.find(c => c.coin === coin.toUpperCase())
  return { free: parseFloat(entry?.availableToWithdraw || 0), locked: parseFloat(entry?.locked || 0) }
}

// ── KuCoin ────────────────────────────────────────────────────────────────────

async function placeKucoinOrder(apiKey, secret, passphrase, symbol, side, type, size, price = null) {
  const ts          = Date.now().toString()
  const kSym        = symbol.endsWith('USDT') ? symbol.replace('USDT', '-USDT') : symbol
  const isMarketBuy = type.toLowerCase() === 'market' && side.toLowerCase() === 'buy'
  // KuCoin market BUY requires `funds` (USDT to spend), not `size` (base token qty)
  const body        = {
    clientOid: crypto.randomBytes(8).toString('hex'),
    side:      side.toLowerCase(),
    symbol:    kSym,
    type:      type.toLowerCase(),
    ...(isMarketBuy ? { funds: String(size) } : { size: String(size) }),
  }
  if (type.toLowerCase() === 'limit' && price) { body.price = String(price); body.timeInForce = 'GTC' }
  const bodyStr  = JSON.stringify(body)
  const endpoint = '/api/v1/orders'
  const signStr  = ts + 'POST' + endpoint + bodyStr
  const sig      = hmacB64(secret, signStr)
  const ppSign   = hmacB64(secret, passphrase)
  const r        = await axios.post(`https://api.kucoin.com${endpoint}`, bodyStr, {
    headers: { 'Content-Type': 'application/json', 'KC-API-KEY': apiKey, 'KC-API-SIGN': sig, 'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': ppSign, 'KC-API-KEY-VERSION': '2' },
    timeout: API_TIMEOUT,
  })
  if (r.data?.code && r.data.code !== '200000') throw new Error(r.data.msg || 'KuCoin order failed')
  return { orderId: r.data?.data?.orderId || 'unknown', status: 'submitted', exchange: 'kucoin', raw: r.data }
}

async function getKucoinSpotBalance(apiKey, secret, passphrase, currency = 'USDT') {
  const ts       = Date.now().toString()
  const endpoint = `/api/v1/accounts?currency=${currency}&type=trade`
  const signStr  = ts + 'GET' + endpoint
  const sig      = hmacB64(secret, signStr)
  const ppSign   = hmacB64(secret, passphrase)
  const r        = await axios.get(`https://api.kucoin.com${endpoint}`, {
    headers: { 'KC-API-KEY': apiKey, 'KC-API-SIGN': sig, 'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': ppSign, 'KC-API-KEY-VERSION': '2' },
    timeout: API_TIMEOUT,
  })
  const accs = r.data?.data || []
  const acc  = accs.find(a => a.currency === currency.toUpperCase())
  return { free: parseFloat(acc?.available || 0), locked: parseFloat(acc?.holds || 0) }
}

// ── Binance USDM Futures ──────────────────────────────────────────────────────

const BINANCE_FUTURES_BASES = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com',
]

async function binanceFuturesGet(path, qs, apiKey) {
  let hit451 = false
  for (const base of BINANCE_FUTURES_BASES) {
    try {
      return await axios.get(`${base}${path}?${qs}`, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: API_TIMEOUT })
    } catch (e) {
      if (e?.response?.status === 451) { hit451 = true; continue }
      throw parseBinanceError(e)
    }
  }
  if (hit451) throw new Error('Binance Futures API geo-restricted (HTTP 451). Redeploy to europe-west1.')
}

async function binanceFuturesPost(path, qs, apiKey) {
  let hit451 = false
  for (const base of BINANCE_FUTURES_BASES) {
    try {
      return await axios.post(`${base}${path}?${qs}`, null, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: API_TIMEOUT })
    } catch (e) {
      if (e?.response?.status === 451) { hit451 = true; continue }
      throw parseBinanceError(e)
    }
  }
  if (hit451) throw new Error('Binance Futures API geo-restricted (HTTP 451). Redeploy to europe-west1.')
}

async function getBinanceFuturesBalance(apiKey, secret, asset = 'USDT') {
  const ts  = Date.now()
  const qs  = `timestamp=${ts}&recvWindow=5000`
  const sig = hmacHex(secret, qs)
  const r   = await binanceFuturesGet('/fapi/v2/balance', `${qs}&signature=${sig}`, apiKey)
  const bal = (r.data || []).find(b => b.asset === asset.toUpperCase())
  return { free: parseFloat(bal?.availableBalance || 0), locked: 0 }
}

async function setBinanceFuturesLeverage(apiKey, secret, symbol, leverage) {
  const ts     = Date.now()
  const params = { symbol, leverage: String(leverage), timestamp: ts, recvWindow: 5000 }
  const qs     = new URLSearchParams(params).toString()
  const sig    = hmacHex(secret, qs)
  try {
    await binanceFuturesPost('/fapi/v1/leverage', `${qs}&signature=${sig}`, apiKey)
  } catch (_) {}
}

async function placeBinanceFuturesMarketOrder(apiKey, secret, symbol, side, usdtAmount, leverage = 5) {
  await setBinanceFuturesLeverage(apiKey, secret, symbol, leverage)

  // Fetch step size from futures exchange info
  const infoR  = await binanceFuturesGet('/fapi/v1/exchangeInfo', '', apiKey).catch(() => null)
  const symInfo = infoR?.data?.symbols?.find(s => s.symbol === symbol)
  const lot     = symInfo?.filters?.find(f => f.filterType === 'LOT_SIZE') || {}
  const stepSize = parseFloat(lot.stepSize || '0.001')

  // Fetch current price
  const ts2   = Date.now()
  const priceR = await binanceFuturesGet('/fapi/v1/ticker/price', `symbol=${symbol}`, apiKey)
  const price  = parseFloat(priceR.data?.price || 0)
  if (!price) throw new Error('Could not fetch price for Binance futures order')

  const qty = roundToStep((usdtAmount * leverage) / price, stepSize)
  if (qty <= 0) throw new Error('Calculated quantity too small for Binance futures order')

  const ts      = Date.now()
  const params  = { symbol, side: side.toUpperCase(), type: 'MARKET', quantity: String(qty), timestamp: ts, recvWindow: 5000 }
  const qs      = new URLSearchParams(params).toString()
  const sig     = hmacHex(secret, qs)
  const r       = await binanceFuturesPost('/fapi/v1/order', `${qs}&signature=${sig}`, apiKey)
  return { orderId: String(r.data.orderId), status: r.data.status, exchange: 'binance', marketType: 'futures', raw: r.data }
}

// ── Bybit Linear (Perpetuals) ─────────────────────────────────────────────────

async function getBybitFuturesBalance(apiKey, secret, coin = 'USDT') {
  const ts         = Date.now().toString()
  const recvWindow = '5000'
  const qs         = `accountType=UNIFIED&coin=${coin}`
  const signStr    = ts + apiKey + recvWindow + qs
  const sig        = hmacHex(secret, signStr)
  const r          = await axios.get(`https://api.bybit.com/v5/account/wallet-balance?${qs}`, {
    headers: { 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': recvWindow },
    timeout: API_TIMEOUT,
  })
  const list  = r.data?.result?.list || []
  const coins = list[0]?.coin || []
  const entry = coins.find(c => c.coin === coin.toUpperCase())
  return { free: parseFloat(entry?.availableToWithdraw || entry?.walletBalance || 0), locked: 0 }
}

async function setBybitLinearLeverage(apiKey, secret, symbol, leverage) {
  const ts         = Date.now().toString()
  const recvWindow = '5000'
  const body       = JSON.stringify({ category: 'linear', symbol, buyLeverage: String(leverage), sellLeverage: String(leverage) })
  const signStr    = ts + apiKey + recvWindow + body
  const sig        = hmacHex(secret, signStr)
  try {
    await axios.post('https://api.bybit.com/v5/position/set-leverage', body, {
      headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': recvWindow },
      timeout: API_TIMEOUT,
    })
  } catch (_) {}
}

async function placeBybitLinearMarketOrder(apiKey, secret, symbol, side, usdtAmount, leverage = 5) {
  await setBybitLinearLeverage(apiKey, secret, symbol, leverage)

  // Fetch current price to compute qty
  const priceR = await axios.get(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, { timeout: API_TIMEOUT })
  const price  = parseFloat(priceR.data?.result?.list?.[0]?.lastPrice || 0)
  if (!price) throw new Error('Could not fetch price for Bybit linear order')

  // Fetch step size from linear instruments info
  const infoR  = await axios.get(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${symbol}`, { timeout: API_TIMEOUT })
  const sym    = infoR.data?.result?.list?.[0]
  const step   = parseFloat(sym?.lotSizeFilter?.qtyStep || '0.001')
  const qty    = roundToStep((usdtAmount * leverage) / price, step)
  if (qty <= 0) throw new Error('Calculated quantity too small for Bybit linear order')

  const ts         = Date.now().toString()
  const recvWindow = '5000'
  const params     = { category: 'linear', symbol, side: side === 'sell' ? 'Sell' : 'Buy', orderType: 'Market', qty: String(qty) }
  const body       = JSON.stringify(params)
  const signStr    = ts + apiKey + recvWindow + body
  const sig        = hmacHex(secret, signStr)
  const r          = await axios.post('https://api.bybit.com/v5/order/create', body, {
    headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': recvWindow },
    timeout: API_TIMEOUT,
  })
  if (r.data?.retCode !== 0) throw new Error(r.data?.retMsg || 'Bybit linear order failed')
  const res = r.data?.result || {}
  return { orderId: res.orderId || 'unknown', status: res.orderStatus || 'submitted', exchange: 'bybit', marketType: 'futures', raw: r.data }
}

// ── MEXC Futures (Contract API) ───────────────────────────────────────────────
// Base: https://contract.mexc.com
// Symbol format: BTC_USDT (underscore separator)
// Auth: HMAC-SHA256(secret, apiKey + timestamp + queryString/body)

const MEXC_FUTURES_BASE = 'https://contract.mexc.com'

function mexcFuturesSymbol(symbol) {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) + '_USDT' : symbol
}

function mexcFuturesSign(apiKey, secret, timestamp, paramStr) {
  return hmacHex(secret, apiKey + timestamp + paramStr)
}

async function getMexcFuturesBalance(apiKey, secret, currency = 'USDT') {
  const ts  = String(Date.now())
  const sig = mexcFuturesSign(apiKey, secret, ts, '')
  const r   = await axios.get(`${MEXC_FUTURES_BASE}/api/v1/private/account/asset/${currency}`, {
    headers: { ApiKey: apiKey, 'Request-Time': ts, Signature: sig, 'Content-Type': 'application/json' },
    timeout: API_TIMEOUT,
  })
  if (r.data?.code !== 0) throw new Error(r.data?.message || 'MEXC futures balance error')
  const d = r.data?.data || {}
  return { free: parseFloat(d.availableBalance || 0), locked: 0 }
}

async function setMexcFuturesLeverage(apiKey, secret, fxSymbol, leverage, side) {
  const ts   = String(Date.now())
  // positionType: 1 = long, 2 = short; openType: 1 = isolated, 2 = cross
  const body = JSON.stringify({ symbol: fxSymbol, leverage, openType: 1, positionType: side === 'sell' ? 2 : 1 })
  const sig  = mexcFuturesSign(apiKey, secret, ts, body)
  try {
    await axios.post(`${MEXC_FUTURES_BASE}/api/v1/private/position/change_leverage`, body, {
      headers: { ApiKey: apiKey, 'Request-Time': ts, Signature: sig, 'Content-Type': 'application/json' },
      timeout: API_TIMEOUT,
    })
  } catch (_) {}
}

async function placeMexcFuturesMarketOrder(apiKey, secret, symbol, side, usdtAmount, leverage = 5) {
  const fxSym = mexcFuturesSymbol(symbol)

  // Fetch price
  const tickerR = await axios.get(`${MEXC_FUTURES_BASE}/api/v1/contract/ticker?symbol=${fxSym}`, { timeout: API_TIMEOUT })
  const price   = parseFloat(tickerR.data?.data?.lastPrice || 0)
  if (!price) throw new Error('Could not fetch price for MEXC futures order')

  // Fetch contract size (volUnit = base tokens per lot, e.g. 0.0001 BTC)
  const infoR  = await axios.get(`${MEXC_FUTURES_BASE}/api/v1/contract/detail?symbol=${fxSym}`, { timeout: API_TIMEOUT })
  const detail = (infoR.data?.data || []).find(d => d.symbol === fxSym) || {}
  const volUnit = parseFloat(detail.volUnit || detail.contractSize || 0.0001)

  // qty (lots) = (USDT × leverage) / price / volUnit — must be a positive integer
  const qty = Math.floor((usdtAmount * leverage) / price / volUnit)
  if (qty < 1) throw new Error('Position too small for MEXC futures — increase risk % or add funds')

  await setMexcFuturesLeverage(apiKey, secret, fxSym, leverage, side)

  // side: 1 = open long, 3 = open short; type: 5 = market order; openType: 1 = isolated
  const orderSide = side === 'sell' ? 3 : 1
  const ts   = String(Date.now())
  const body = JSON.stringify({ symbol: fxSym, price: 0, vol: qty, leverage, side: orderSide, type: 5, openType: 1 })
  const sig  = mexcFuturesSign(apiKey, secret, ts, body)
  const r    = await axios.post(`${MEXC_FUTURES_BASE}/api/v1/private/order/submit`, body, {
    headers: { ApiKey: apiKey, 'Request-Time': ts, Signature: sig, 'Content-Type': 'application/json' },
    timeout: API_TIMEOUT,
  })
  if (r.data?.code !== 0) throw new Error(r.data?.message || 'MEXC futures order failed')
  return { orderId: String(r.data?.data || 'unknown'), status: 'submitted', exchange: 'mexc', marketType: 'futures', raw: r.data }
}

// ── Futures Balance (unified) ─────────────────────────────────────────────────

async function getFuturesBalance(exchange, credentials, asset = 'USDT') {
  const { apiKey, secret } = credentials
  switch (exchange) {
    case 'binance': return getBinanceFuturesBalance(apiKey, secret, asset)
    case 'bybit':   return getBybitFuturesBalance(apiKey, secret, asset)
    case 'mexc':    return getMexcFuturesBalance(apiKey, secret, asset)
    default: throw new Error(`Futures balance not supported for ${exchange}`)
  }
}

// ── Safe Market Buy ───────────────────────────────────────────────────────────
// Validates symbol existence and minimum notional, then places a market buy
// using each exchange's "spend USDT" API — no step-size precision issues.
// Use this for all agent-initiated market buys instead of placeOrder().

async function placeOrderSafe(exchange, credentials, symbol, usdtAmount, _currentPrice, marketType = 'spot', leverage = 5, side = 'buy') {
  const { apiKey, secret, passphrase } = credentials

  // ── Futures path ──────────────────────────────────────────────────────────
  if (marketType === 'futures') {
    if (!['binance', 'bybit', 'mexc'].includes(exchange)) {
      throw new Error(`Futures trading is supported on Binance, Bybit, and MEXC. Please select one of these exchanges.`)
    }
    if (usdtAmount < 5) {
      throw new Error(`Futures order value $${usdtAmount.toFixed(2)} USDT is below the minimum of $5.`)
    }
    switch (exchange) {
      case 'binance': return placeBinanceFuturesMarketOrder(apiKey, secret, symbol, side, usdtAmount, leverage)
      case 'bybit':   return placeBybitLinearMarketOrder(apiKey, secret, symbol, side, usdtAmount, leverage)
      case 'mexc':    return placeMexcFuturesMarketOrder(apiKey, secret, symbol, side, usdtAmount, leverage)
    }
  }

  // ── Spot path ─────────────────────────────────────────────────────────────
  // Spot has no short side — silently market-buying a 'sell' entry would place
  // a bet in the WRONG direction. Refuse with a clear message instead.
  if (String(side).toLowerCase() === 'sell') {
    throw new Error(`${symbol} is a SHORT setup — spot orders can only buy. Execute shorts as futures on Binance, Bybit or MEXC.`)
  }
  const info = await getSymbolInfo(exchange, symbol)
  if (info === null) {
    throw new Error(`${symbol} is not listed on ${exchange.toUpperCase()}. Choose another exchange for this trade.`)
  }

  const minNotional = info.minNotional || 1
  if (usdtAmount < minNotional) {
    throw new Error(`Order value $${usdtAmount.toFixed(2)} is below ${exchange.toUpperCase()} minimum of $${minNotional}. Increase risk % or add funds.`)
  }

  switch (exchange) {
    case 'binance': return placeBinanceMarketBuy(apiKey, secret, symbol, usdtAmount)
    case 'mexc':    return placeMexcMarketBuy(apiKey, secret, symbol, usdtAmount)
    case 'bybit':   return placeBybitMarketBuy(apiKey, secret, symbol, usdtAmount)
    case 'kucoin':  return placeKucoinOrder(apiKey, secret, passphrase || '', symbol, 'buy', 'market', usdtAmount.toFixed(2))
    default: throw new Error(`Unsupported exchange: ${exchange}`)
  }
}

// ── Unified Interface (limit / sell orders) ───────────────────────────────────

async function placeOrder(exchange, credentials, symbol, side, type, quantity, price = null) {
  const { apiKey, secret, passphrase } = credentials
  switch (exchange) {
    case 'binance': return placeBinanceOrder(apiKey, secret, symbol, side, type, quantity, price)
    case 'mexc':    return placeMexcOrder(apiKey, secret, symbol, side, type, quantity, price)
    case 'bybit':   return placeBybitOrder(apiKey, secret, symbol, side, type, quantity, price)
    case 'kucoin':  return placeKucoinOrder(apiKey, secret, passphrase || '', symbol, side, type, quantity, price)
    default: throw new Error(`Unsupported exchange: ${exchange}`)
  }
}

async function getSpotBalance(exchange, credentials, asset = 'USDT') {
  const { apiKey, secret, passphrase } = credentials
  switch (exchange) {
    case 'binance': return getBinanceSpotBalance(apiKey, secret, asset)
    case 'mexc':    return getMexcSpotBalance(apiKey, secret, asset)
    case 'bybit':   return getBybitSpotBalance(apiKey, secret, asset)
    case 'kucoin':  return getKucoinSpotBalance(apiKey, secret, passphrase || '', asset)
    default: throw new Error(`Unsupported exchange: ${exchange}`)
  }
}

// Legacy quantity helper kept for non-market-buy scenarios
function calcOrderQuantity(_exchange, _symbol, usdtAmount, currentPrice, stepSize = 0.001) {
  return roundToStep(usdtAmount / currentPrice, stepSize)
}

// ── Bracket exits (Binance) — place TP1 + hard stop after the entry ────────────
// "Full close at TP1" locks the win the moment TP1 prints and caps the loss at
// the stop, which is what maximizes realized win rate. Best-effort: any failure
// here is reported but never unwinds the entry. Binance only for now.
let _futTickCache = { at: 0, map: {} }
async function binanceFuturesFilters(symbol) {
  try {
    if (Date.now() - _futTickCache.at > 3600000) {
      const r = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', { timeout: API_TIMEOUT })
      const map = {}
      for (const s of (r.data?.symbols || [])) {
        const pf = (s.filters || []).find(f => f.filterType === 'PRICE_FILTER')
        const lf = (s.filters || []).find(f => f.filterType === 'LOT_SIZE')
        map[s.symbol] = { tick: parseFloat(pf?.tickSize || '0'), step: parseFloat(lf?.stepSize || '0.001') }
      }
      _futTickCache = { at: Date.now(), map }
    }
    return _futTickCache.map[symbol] || { tick: 0, step: 0.001 }
  } catch { return { tick: 0, step: 0.001 } }
}
async function binanceFuturesTick(symbol) { return (await binanceFuturesFilters(symbol)).tick }
// Round a price to the tick grid (nearest); falls back to magnitude-based dp.
function roundPriceToTick(price, tick) {
  const p = +price
  if (!isFinite(p) || p <= 0) return p
  if (tick > 0) return parseFloat((Math.round(p / tick) * tick).toFixed(12))
  const dp = p >= 1000 ? 2 : p >= 100 ? 3 : p >= 1 ? 4 : p >= 0.01 ? 6 : 8
  return parseFloat(p.toFixed(dp))
}

// Dispatcher: attach a TP1 + stop bracket for a just-opened position. Throws
// 'bracket-unsupported-exchange' for venues without bracket support so the
// caller can fall back to notifying the owner. Futures: Binance, Bybit, MEXC.
// Spot: Binance only (an OCO is the only spot-side bracket primitive we use).
async function attachBracketExit(exchange, credentials, opts) {
  if (exchange === 'binance') return attachBinanceBracket(credentials.apiKey, credentials.secret, opts)
  if (opts.marketType === 'futures' && exchange === 'bybit') return attachBybitBracket(credentials.apiKey, credentials.secret, opts)
  if (opts.marketType === 'futures' && exchange === 'mexc') return attachMexcBracket(credentials.apiKey, credentials.secret, opts)
  const e = new Error('bracket-unsupported-exchange'); e.unsupported = true; throw e
}

// entrySide is the side of the ENTRY ('buy' long / 'sell' short); the bracket
// closes the opposite side. qty (base) is required for spot OCO and for the
// futures 'trail' mode (to size the half-position TP1).
//
// mode 'full'  (default): TP1 closes the WHOLE position (closePosition), hard
//                         stop at SL — banks everything at TP1.
// mode 'trail' (futures): TP1 closes HALF the position (reduceOnly qty), hard
//                         stop at SL on the rest; the CEX exit monitor then
//                         moves the stop to breakeven once TP1 fills and
//                         trails the runner. Falls back to 'full' when the
//                         half-qty can't be sized. Spot stays 'full' (an OCO
//                         can't split quantities).
async function attachBinanceBracket(apiKey, secret, { symbol, marketType, entrySide, tp1, sl, qty, mode }) {
  const closeSide = String(entrySide).toLowerCase() === 'buy' ? 'SELL' : 'BUY'
  if (!(tp1 > 0) || !(sl > 0)) throw new Error('bracket needs tp1 and sl')

  if (marketType === 'futures') {
    const { tick, step } = await binanceFuturesFilters(symbol)
    const tpStop = roundPriceToTick(tp1, tick)
    const slStop = roundPriceToTick(sl, tick)
    const post = async (params) => {
      const ts  = Date.now()
      const qs  = new URLSearchParams({ ...params, symbol, side: closeSide, workingType: 'MARK_PRICE', timestamp: ts, recvWindow: 5000 }).toString()
      const sig = hmacHex(secret, qs)
      const r   = await binanceFuturesPost('/fapi/v1/order', `${qs}&signature=${sig}`, apiKey)
      return String(r.data.orderId)
    }
    const halfQty = mode === 'trail' ? roundToStep((parseFloat(qty) || 0) / 2, step) : 0
    if (mode === 'trail' && halfQty > 0) {
      // Partial TP1 (half, reduce-only) + full-position hard stop.
      const tpId = await post({ type: 'TAKE_PROFIT_MARKET', stopPrice: String(tpStop), quantity: String(halfQty), reduceOnly: 'true' })
      const slId = await post({ type: 'STOP_MARKET', stopPrice: String(slStop), closePosition: 'true' })
      return { tpOrderId: tpId, slOrderId: slId, tp: tpStop, sl: slStop, mode: 'trail', tpQty: halfQty }
    }
    // Full mode: closePosition orders auto-cancel each other when the position closes.
    const tpId = await post({ type: 'TAKE_PROFIT_MARKET', stopPrice: String(tpStop), closePosition: 'true' })
    const slId = await post({ type: 'STOP_MARKET',        stopPrice: String(slStop), closePosition: 'true' })
    return { tpOrderId: tpId, slOrderId: slId, tp: tpStop, sl: slStop, mode: 'full' }
  }

  // Spot OCO: one sell that is a TP limit OR an SL stop-limit (one cancels other).
  const info = await getSymbolInfo('binance', symbol).catch(() => null)
  const tick = info?.tickSize || 0
  const step = info?.stepSize || 0.000001
  const sellQty = roundToStep(qty, step)
  if (!(sellQty > 0)) throw new Error('bracket: no sellable quantity')
  const tpPrice   = roundPriceToTick(tp1, tick)
  const slTrigger = roundPriceToTick(sl, tick)
  const slLimit   = roundPriceToTick(sl * 0.997, tick) // limit slightly below trigger so it fills
  const ts  = Date.now()
  const qs  = new URLSearchParams({
    symbol, side: 'SELL', quantity: String(sellQty),
    price: String(tpPrice), stopPrice: String(slTrigger), stopLimitPrice: String(slLimit),
    stopLimitTimeInForce: 'GTC', timestamp: ts, recvWindow: 5000,
  }).toString()
  const sig = hmacHex(secret, qs)
  const r   = await binancePost('/api/v3/order/oco', `${qs}&signature=${sig}`, apiKey)
  return { orderListId: String(r.data.orderListId), tp: tpPrice, sl: slTrigger, mode: 'full' }
}

// ── Bybit linear bracket (conditional reduce-only market orders) ──────────────
// Bybit has no OCO for conditionals, but reduce-only orders are auto-cancelled
// by the exchange once the position is flat, so a TP + SL pair behaves like a
// bracket. triggerDirection: 1 = fires when price RISES to trigger, 2 = falls.

async function bybitSignedPost(apiKey, secret, path, params) {
  const ts = Date.now().toString(), rw = '5000'
  const body = JSON.stringify(params)
  const sig = hmacHex(secret, ts + apiKey + rw + body)
  const r = await axios.post(`https://api.bybit.com${path}`, body, {
    headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': rw },
    timeout: API_TIMEOUT,
  })
  if (r.data?.retCode !== 0) throw new Error(r.data?.retMsg || 'bybit error')
  return r.data.result
}

async function bybitSignedGet(apiKey, secret, path, qs) {
  const ts = Date.now().toString(), rw = '5000'
  const sig = hmacHex(secret, ts + apiKey + rw + qs)
  const r = await axios.get(`https://api.bybit.com${path}?${qs}`, {
    headers: { 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': rw },
    timeout: API_TIMEOUT,
  })
  if (r.data?.retCode !== 0) throw new Error(r.data?.retMsg || 'bybit error')
  return r.data.result
}

async function bybitLinearPosition(apiKey, secret, symbol) {
  const res = await bybitSignedGet(apiKey, secret, '/v5/position/list', `category=linear&symbol=${symbol}`)
  const pos = (res?.list || []).find((p) => p.symbol === symbol)
  return Math.abs(parseFloat(pos?.size || 0))
}

async function bybitLinearFilters(symbol) {
  const r = await axios.get(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${symbol}`, { timeout: API_TIMEOUT })
  const s = r.data?.result?.list?.[0]
  return { step: parseFloat(s?.lotSizeFilter?.qtyStep || '0.001'), tick: parseFloat(s?.priceFilter?.tickSize || '0') }
}

// Conditional reduce-only market close (TP leg, SL leg, or a trail stop).
async function placeBybitConditionalClose(apiKey, secret, { symbol, closeSide, qty, triggerPrice, triggerDirection }) {
  const res = await bybitSignedPost(apiKey, secret, '/v5/order/create', {
    category: 'linear', symbol, side: closeSide, orderType: 'Market',
    qty: String(qty), triggerPrice: String(triggerPrice), triggerDirection,
    triggerBy: 'MarkPrice', reduceOnly: true, timeInForce: 'IOC',
  })
  return String(res?.orderId || 'unknown')
}

// entrySide 'buy' (long) / 'sell' (short). Sizes come from the live position
// (Bybit order responses don't return the fill qty).
async function attachBybitBracket(apiKey, secret, { symbol, entrySide, tp1, sl, mode }) {
  const long = String(entrySide).toLowerCase() === 'buy'
  const closeSide = long ? 'Sell' : 'Buy'
  if (!(tp1 > 0) || !(sl > 0)) throw new Error('bracket needs tp1 and sl')
  const size = await bybitLinearPosition(apiKey, secret, symbol)
  if (!(size > 0)) throw new Error('bracket: no open Bybit position found')
  const { step, tick } = await bybitLinearFilters(symbol)
  const tp = roundPriceToTick(tp1, tick), slp = roundPriceToTick(sl, tick)
  const half = roundToStep(size / 2, step)
  const trail = mode === 'trail' && half > 0
  // Long: TP fires when price rises to tp (1), SL when it falls to sl (2). Short mirrors.
  const tpId = await placeBybitConditionalClose(apiKey, secret, { symbol, closeSide, qty: trail ? half : size, triggerPrice: tp, triggerDirection: long ? 1 : 2 })
  const slId = await placeBybitConditionalClose(apiKey, secret, { symbol, closeSide, qty: size, triggerPrice: slp, triggerDirection: long ? 2 : 1 })
  return trail
    ? { tpOrderId: tpId, slOrderId: slId, tp, sl: slp, mode: 'trail', tpQty: half }
    : { tpOrderId: tpId, slOrderId: slId, tp, sl: slp, mode: 'full' }
}

// Order status ('Untriggered'|'Triggered'|'Filled'|'Cancelled'|…) — realtime
// first, history for orders that have already left the open set.
async function getBybitOrderStatus(apiKey, secret, symbol, orderId) {
  for (const path of ['/v5/order/realtime', '/v5/order/history']) {
    try {
      const res = await bybitSignedGet(apiKey, secret, path, `category=linear&symbol=${symbol}&orderId=${orderId}`)
      const o = (res?.list || []).find((x) => x.orderId === String(orderId)) || (res?.list || [])[0]
      if (o && o.orderStatus) return o.orderStatus
    } catch (_) { /* try next source */ }
  }
  return null
}

async function cancelBybitOrder(apiKey, secret, symbol, orderId) {
  return bybitSignedPost(apiKey, secret, '/v5/order/cancel', { category: 'linear', symbol, orderId: String(orderId) })
}

// Trail stop for the runner: conditional market close of `qty` at stopPrice.
async function placeBybitStopClose(apiKey, secret, symbol, closeSide, stopPrice, qty) {
  const { step, tick } = await bybitLinearFilters(symbol)
  const px = roundPriceToTick(stopPrice, tick)
  const q = roundToStep(qty, step)
  if (!(q > 0)) throw new Error('bybit stop: no quantity')
  // Closing a long ('Sell') fires when price FALLS to the stop (2); short mirrors.
  const orderId = await placeBybitConditionalClose(apiKey, secret, {
    symbol, closeSide, qty: q, triggerPrice: px, triggerDirection: closeSide === 'Sell' ? 2 : 1,
  })
  return { orderId, stopPrice: px }
}

// ── MEXC contract bracket (plan/trigger orders) ───────────────────────────────
// Best-effort: MEXC's contract API availability varies by account. Plan orders
// are valid for 7 days (executeCycle 2) — the trail loop re-arms the stop on
// every ratchet, and the exit monitor's estimate path still closes the trade
// record if the venue rejects order management.
// side: 2 = close short, 4 = close long. triggerType: 1 = price ≥ trigger, 2 = ≤.

async function mexcContractPositionVol(apiKey, secret, symbol) {
  const fxSym = mexcFuturesSymbol(symbol)
  const ts = String(Date.now())
  const qs = `symbol=${fxSym}`
  const sig = mexcFuturesSign(apiKey, secret, ts, qs)
  const r = await axios.get(`${MEXC_FUTURES_BASE}/api/v1/private/position/open_positions?${qs}`, {
    headers: { ApiKey: apiKey, 'Request-Time': ts, Signature: sig, 'Content-Type': 'application/json' },
    timeout: API_TIMEOUT,
  })
  if (r.data?.code !== 0) throw new Error(r.data?.message || 'mexc position error')
  return (r.data?.data || []).reduce((s, p) => s + Math.abs(parseFloat(p.holdVol || 0)), 0)
}

async function mexcPlanOrderPlace(apiKey, secret, params) {
  const ts = String(Date.now())
  const body = JSON.stringify(params)
  const sig = mexcFuturesSign(apiKey, secret, ts, body)
  const r = await axios.post(`${MEXC_FUTURES_BASE}/api/v1/private/planorder/place`, body, {
    headers: { ApiKey: apiKey, 'Request-Time': ts, Signature: sig, 'Content-Type': 'application/json' },
    timeout: API_TIMEOUT,
  })
  if (r.data?.code !== 0) throw new Error(r.data?.message || 'mexc plan order failed')
  return String(r.data?.data || 'unknown')
}

async function attachMexcBracket(apiKey, secret, { symbol, entrySide, tp1, sl, mode }) {
  const long = String(entrySide).toLowerCase() === 'buy'
  const closeSide = long ? 4 : 2
  if (!(tp1 > 0) || !(sl > 0)) throw new Error('bracket needs tp1 and sl')
  const fxSym = mexcFuturesSymbol(symbol)
  const vol = await mexcContractPositionVol(apiKey, secret, symbol)
  if (!(vol > 0)) throw new Error('bracket: no open MEXC position found')
  const half = Math.floor(vol / 2)
  const trail = mode === 'trail' && half > 0
  const base = { symbol: fxSym, side: closeSide, openType: 1, orderType: 5, executeCycle: 2, trend: 1 }
  // Long: TP fires at price ≥ tp1 (1), SL at ≤ sl (2). Short mirrors.
  const tpId = await mexcPlanOrderPlace(apiKey, secret, { ...base, vol: trail ? half : vol, triggerPrice: tp1, triggerType: long ? 1 : 2 })
  const slId = await mexcPlanOrderPlace(apiKey, secret, { ...base, vol, triggerPrice: sl, triggerType: long ? 2 : 1 })
  return trail
    ? { tpOrderId: tpId, slOrderId: slId, tp: tp1, sl, mode: 'trail', tpQty: half }
    : { tpOrderId: tpId, slOrderId: slId, tp: tp1, sl, mode: 'full' }
}

// Plan-order state: 1 untriggered · 2 cancelled · 3 executed · 4 invalid · 5 failed.
async function getMexcPlanOrderState(apiKey, secret, symbol, orderId) {
  const fxSym = mexcFuturesSymbol(symbol)
  const ts = String(Date.now())
  const qs = `page_num=1&page_size=50&symbol=${fxSym}`
  const sig = mexcFuturesSign(apiKey, secret, ts, qs)
  const r = await axios.get(`${MEXC_FUTURES_BASE}/api/v1/private/planorder/list/orders?${qs}`, {
    headers: { ApiKey: apiKey, 'Request-Time': ts, Signature: sig, 'Content-Type': 'application/json' },
    timeout: API_TIMEOUT,
  })
  if (r.data?.code !== 0) throw new Error(r.data?.message || 'mexc plan order query failed')
  const o = (r.data?.data || []).find((x) => String(x.id || x.orderId) === String(orderId))
  return o ? +o.state : null
}

async function cancelMexcPlanOrder(apiKey, secret, symbol, orderId) {
  const fxSym = mexcFuturesSymbol(symbol)
  const ts = String(Date.now())
  const body = JSON.stringify([{ symbol: fxSym, orderId: String(orderId) }])
  const sig = mexcFuturesSign(apiKey, secret, ts, body)
  const r = await axios.post(`${MEXC_FUTURES_BASE}/api/v1/private/planorder/cancel`, body, {
    headers: { ApiKey: apiKey, 'Request-Time': ts, Signature: sig, 'Content-Type': 'application/json' },
    timeout: API_TIMEOUT,
  })
  if (r.data?.code !== 0) throw new Error(r.data?.message || 'mexc plan order cancel failed')
  return r.data
}

// Trail stop for the runner (plan order closing `vol` lots at stopPrice).
async function placeMexcStopClose(apiKey, secret, symbol, closeSide, stopPrice, vol) {
  const fxSym = mexcFuturesSymbol(symbol)
  const v = Math.floor(vol)
  if (!(v > 0)) throw new Error('mexc stop: no volume')
  const side = closeSide === 'sell' ? 4 : 2 // closing long sells (4 close-long); closing short buys (2 close-short)
  const orderId = await mexcPlanOrderPlace(apiKey, secret, {
    symbol: fxSym, side, openType: 1, orderType: 5, executeCycle: 2, trend: 1,
    vol: v, triggerPrice: stopPrice, triggerType: side === 4 ? 2 : 1, // stop fires against the position
  })
  return { orderId, stopPrice }
}

// ── Trail-runner order management (used by the CEX exit monitor) ─────────────
async function getBinanceFuturesOrder(apiKey, secret, symbol, orderId) {
  const qs = `symbol=${symbol}&orderId=${orderId}&timestamp=${Date.now()}&recvWindow=5000`
  const r  = await binanceFuturesGet('/fapi/v1/order', `${qs}&signature=${hmacHex(secret, qs)}`, apiKey)
  return r.data
}

async function cancelBinanceFuturesOrder(apiKey, secret, symbol, orderId) {
  const ts = Date.now()
  const qs = `symbol=${symbol}&orderId=${orderId}&timestamp=${ts}&recvWindow=5000`
  const sig = hmacHex(secret, qs)
  let hit451 = false
  for (const base of BINANCE_FUTURES_BASES) {
    try {
      return (await axios.delete(`${base}/fapi/v1/order?${qs}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: API_TIMEOUT })).data
    } catch (e) {
      if (e?.response?.status === 451) { hit451 = true; continue }
      throw parseBinanceError(e)
    }
  }
  if (hit451) throw new Error('Binance Futures API geo-restricted (HTTP 451).')
}

// Close-the-position stop at `stopPrice` (STOP_MARKET, closePosition) — the
// ratcheting trail stop for the runner.
async function placeBinanceFuturesStopClose(apiKey, secret, symbol, closeSide, stopPrice) {
  const { tick } = await binanceFuturesFilters(symbol)
  const px  = roundPriceToTick(stopPrice, tick)
  const ts  = Date.now()
  const qs  = new URLSearchParams({
    symbol, side: closeSide, type: 'STOP_MARKET', stopPrice: String(px),
    closePosition: 'true', workingType: 'MARK_PRICE', timestamp: ts, recvWindow: 5000,
  }).toString()
  const sig = hmacHex(secret, qs)
  const r   = await binanceFuturesPost('/fapi/v1/order', `${qs}&signature=${sig}`, apiKey)
  return { orderId: String(r.data.orderId), stopPrice: px }
}

module.exports = {
  placeOrderSafe,
  placeOrder,
  getSpotBalance,
  getFuturesBalance,
  getSymbolInfo,
  roundToStep,
  calcOrderQuantity,
  placeBinanceOrder, placeMexcOrder, placeBybitOrder, placeKucoinOrder,
  placeBinanceFuturesMarketOrder, placeBybitLinearMarketOrder, placeMexcFuturesMarketOrder,
  getMexcFuturesBalance,
  attachBinanceBracket, attachBybitBracket, attachMexcBracket, attachBracketExit,
  getBinanceFuturesOrder, cancelBinanceFuturesOrder, placeBinanceFuturesStopClose,
  getBybitOrderStatus, cancelBybitOrder, placeBybitStopClose, bybitLinearPosition,
  getMexcPlanOrderState, cancelMexcPlanOrder, placeMexcStopClose, mexcContractPositionVol,
}

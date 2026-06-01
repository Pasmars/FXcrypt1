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
        return {
          exists: true,
          stepSize:    parseFloat(lot.stepSize    || '0.001'),
          minQty:      parseFloat(lot.minQty      || '0'),
          minNotional: parseFloat(notional.minNotional || notional.minOrderValue || '5'),
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
}

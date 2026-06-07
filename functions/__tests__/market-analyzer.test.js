'use strict'
const { calcEMA, calcRSI, calcMACD, calcBB, calcATR } = require('../lib/market-analyzer')

// ── calcEMA ────────────────────────────────────────────────────────────────────

describe('calcEMA', () => {
  test('returns null when prices.length < period', () => {
    expect(calcEMA([1, 2], 3)).toBeNull()
  })

  test('returns SMA when prices.length === period (no EMA smoothing iteration)', () => {
    // Only the seed average is computed; the loop body never executes.
    expect(calcEMA([1, 2, 3], 3)).toBeCloseTo(2, 8)
  })

  test('applies EMA smoothing for period=3, 4 prices', () => {
    // seed = (1+2+3)/3 = 2, k = 2/4 = 0.5
    // i=3: ema = 4*0.5 + 2*0.5 = 3
    expect(calcEMA([1, 2, 3, 4], 3)).toBeCloseTo(3, 8)
  })

  test('EMA of a constant series equals that constant', () => {
    expect(calcEMA(new Array(20).fill(42), 10)).toBeCloseTo(42, 8)
  })

  test('rising series EMA ends above a flat series EMA (recent values weighted more)', () => {
    const rising = Array.from({ length: 20 }, (_, i) => i + 1) // 1..20
    const flat   = new Array(20).fill(5)
    expect(calcEMA(rising, 5)).toBeGreaterThan(calcEMA(flat, 5))
  })

  test('EMA period=1 returns the last price', () => {
    // k = 2/(1+1) = 1 — each step the EMA becomes the latest price
    expect(calcEMA([10, 20, 30], 1)).toBeCloseTo(30, 8)
  })
})

// ── calcRSI ────────────────────────────────────────────────────────────────────

describe('calcRSI', () => {
  test('returns null when closes.length < period + 1', () => {
    // Default period=14; need at least 15 values
    expect(calcRSI(new Array(14).fill(1))).toBeNull()
  })

  test('returns 100 for a monotonically increasing series (no losses)', () => {
    const closes = Array.from({ length: 15 }, (_, i) => i + 1) // 1..15
    expect(calcRSI(closes, 14)).toBe(100)
  })

  test('returns 0 for a monotonically decreasing series (no gains)', () => {
    const closes = Array.from({ length: 15 }, (_, i) => 15 - i) // 15..1
    expect(calcRSI(closes, 14)).toBeCloseTo(0, 8)
  })

  test('returns ~50 for perfectly alternating gains and losses', () => {
    // [0,1,0,1,...] → 7 gains of 1, 7 losses of 1 → avgGain = avgLoss → RSI = 50
    const closes = Array.from({ length: 15 }, (_, i) => i % 2)
    expect(calcRSI(closes, 14)).toBeCloseTo(50, 6)
  })

  test('result is always in [0, 100]', () => {
    const noisy = [10, 12, 8, 15, 7, 20, 5, 18, 3, 25, 2, 22, 4, 19, 6]
    const rsi = calcRSI(noisy, 14)
    expect(rsi).toBeGreaterThanOrEqual(0)
    expect(rsi).toBeLessThanOrEqual(100)
  })

  test('longer series with more prices still produces a valid RSI', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const rsi = calcRSI(closes, 14)
    expect(rsi).not.toBeNull()
    expect(rsi).toBeGreaterThanOrEqual(0)
    expect(rsi).toBeLessThanOrEqual(100)
  })
})

// ── calcMACD ───────────────────────────────────────────────────────────────────

describe('calcMACD', () => {
  test('returns null with fewer than 34 values', () => {
    expect(calcMACD(new Array(33).fill(1))).toBeNull()
  })

  test('returns an object with macd, signal, histogram, prevHistogram', () => {
    const result = calcMACD(new Array(50).fill(100))
    expect(result).toMatchObject({
      macd:          expect.any(Number),
      signal:        expect.any(Number),
      histogram:     expect.any(Number),
      prevHistogram: expect.any(Number),
    })
  })

  test('all values are ~0 for a perfectly flat series', () => {
    const result = calcMACD(new Array(50).fill(100))
    expect(result.macd).toBeCloseTo(0, 8)
    expect(result.signal).toBeCloseTo(0, 8)
    expect(result.histogram).toBeCloseTo(0, 8)
  })

  test('histogram always equals macd - signal', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const result = calcMACD(prices)
    expect(result.histogram).toBeCloseTo(result.macd - result.signal, 8)
  })

  test('rising series produces a positive MACD histogram', () => {
    // steadily rising prices → fast EMA > slow EMA → positive histogram
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i * 2)
    const result = calcMACD(rising)
    expect(result.histogram).toBeGreaterThan(0)
  })

  test('falling series produces a negative MACD histogram', () => {
    const falling = Array.from({ length: 60 }, (_, i) => 200 - i * 2)
    const result = calcMACD(falling)
    expect(result.histogram).toBeLessThan(0)
  })
})

// ── calcBB ─────────────────────────────────────────────────────────────────────

describe('calcBB', () => {
  test('returns null when closes.length < period', () => {
    expect(calcBB(new Array(19).fill(1), 20)).toBeNull()
  })

  test('returns an object with upper, middle, lower, std', () => {
    expect(calcBB(new Array(20).fill(100))).toMatchObject({
      upper:  expect.any(Number),
      middle: expect.any(Number),
      lower:  expect.any(Number),
      std:    expect.any(Number),
    })
  })

  test('flat series: std=0 and bands collapse to the mean', () => {
    const result = calcBB(new Array(20).fill(50), 20, 2)
    expect(result.std).toBeCloseTo(0, 8)
    expect(result.upper).toBeCloseTo(50, 8)
    expect(result.middle).toBeCloseTo(50, 8)
    expect(result.lower).toBeCloseTo(50, 8)
  })

  test('upper > middle > lower for a non-flat series', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 95 + i) // 95..114
    const result = calcBB(prices, 20, 2)
    expect(result.upper).toBeGreaterThan(result.middle)
    expect(result.middle).toBeGreaterThan(result.lower)
  })

  test('middle equals the SMA of the last `period` values', () => {
    const prices   = Array.from({ length: 25 }, (_, i) => i + 1) // 1..25
    const last20   = prices.slice(-20) // 6..25
    const expected = last20.reduce((a, b) => a + b, 0) / 20 // 15.5
    expect(calcBB(prices, 20, 2).middle).toBeCloseTo(expected, 8)
  })

  test('band width scales linearly with the multiplier', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 95 + i)
    const bb1    = calcBB(prices, 20, 1)
    const bb2    = calcBB(prices, 20, 2)
    const width1 = bb1.upper - bb1.lower
    const width2 = bb2.upper - bb2.lower
    expect(width2).toBeCloseTo(width1 * 2, 6)
  })
})

// ── calcATR ────────────────────────────────────────────────────────────────────

describe('calcATR', () => {
  test('returns null when arrays have fewer than period+1 values', () => {
    const arr = new Array(14).fill(10)
    expect(calcATR(arr, arr, arr, 14)).toBeNull()
  })

  test('returns 0 for perfectly flat candles (no range, no gap)', () => {
    const arr = new Array(15).fill(10)
    expect(calcATR(arr, arr, arr, 14)).toBeCloseTo(0, 8)
  })

  test('returns the candle range for constant equal-range candles', () => {
    // TR = max(H-L, |H-Cprev|, |L-Cprev|) = max(2, 1, 1) = 2 for every candle
    const highs  = new Array(15).fill(11)
    const lows   = new Array(15).fill(9)
    const closes = new Array(15).fill(10)
    expect(calcATR(highs, lows, closes, 14)).toBeCloseTo(2, 8)
  })

  test('ATR is always non-negative', () => {
    const highs  = [12, 11, 14, 10, 13, 15, 9, 12, 11, 14, 10, 13, 15, 9, 12]
    const lows   = [8,   9,  7, 11,  8,  7, 12, 9, 10,  7, 11,  8,  7, 12, 9]
    const closes = new Array(15).fill(10)
    expect(calcATR(highs, lows, closes, 14)).toBeGreaterThanOrEqual(0)
  })

  test('larger candle range produces a larger ATR', () => {
    const mkArrays = (range) => ({
      highs:  new Array(15).fill(10 + range),
      lows:   new Array(15).fill(10 - range),
      closes: new Array(15).fill(10),
    })
    const narrow = mkArrays(1)
    const wide   = mkArrays(5)
    const atrNarrow = calcATR(narrow.highs, narrow.lows, narrow.closes, 14)
    const atrWide   = calcATR(wide.highs,   wide.lows,   wide.closes,   14)
    expect(atrWide).toBeGreaterThan(atrNarrow)
  })
})

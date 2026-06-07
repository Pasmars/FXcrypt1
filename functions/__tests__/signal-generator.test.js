'use strict'
const { generateSignal, isDuplicateSignal, fmtPrice } = require('../lib/signal-generator')

// ── Test fixture helpers ───────────────────────────────────────────────────────

function makeAnalysis(overrides = {}) {
  return {
    symbol:      'BTCUSDT',
    exchange:    'binance',
    timeframe:   '4H',
    marketType:  'spot',
    score:       75,
    bias:        'long',
    isAlpha:     false,
    currentPrice: 50000,
    atr:         500,
    structure: {
      bias:       'bullish',
      bos:        false,
      choch:      false,
      nearBullOB: false,
      nearBearOB: false,
      bullOB:     null,
      bearOB:     null,
      relevantFVG: null,
      swingHighs: [],
      swingLows:  [],
      fvgs:       [],
    },
    indicators: {
      rsi:         55,
      macd:        { histogram: 0.5, prevHistogram: 0.3, macd: 1, signal: 0.5 },
      bb:          null,
      ema9:        49500,
      ema21:       49000,
      ema50:       48000,
      ema200:      null,
      volumeRatio: null,
      atr:         500,
      adx:         null,
      momentum:    null,
    },
    reasons:     ['RSI in momentum zone'],
    volume24h:   1_000_000,
    analyzedAt:  Date.now(),
    tvRecommend: null,
    ...overrides,
  }
}

function makeSignal(overrides = {}) {
  return {
    symbol:      'BTCUSDT',
    bias:        'long',
    marketType:  'spot',
    generatedAt: Date.now(),
    ...overrides,
  }
}

// ── fmtPrice ───────────────────────────────────────────────────────────────────

describe('fmtPrice', () => {
  test('returns "?" for null', () => expect(fmtPrice(null)).toBe('?'))
  test('returns "?" for NaN',  () => expect(fmtPrice(NaN)).toBe('?'))
  test('returns "?" for 0 (falsy)', () => expect(fmtPrice(0)).toBe('?'))

  test('prices >= 10 000 — no decimals', () => {
    expect(fmtPrice(50000)).toBe('50000')
    expect(fmtPrice(10000)).toBe('10000')
  })

  test('prices >= 1 000 — 2 decimals', () => {
    expect(fmtPrice(1500.5)).toBe('1500.50')
    expect(fmtPrice(1000)).toBe('1000.00')
  })

  test('prices >= 1 — 4 decimals', () => {
    expect(fmtPrice(2.5)).toBe('2.5000')
    expect(fmtPrice(1)).toBe('1.0000')
  })

  test('prices >= 0.01 — 6 decimals', () => {
    expect(fmtPrice(0.05)).toBe('0.050000')
  })

  test('prices < 0.01 — 8 decimals', () => {
    expect(fmtPrice(0.000001)).toBe('0.00000100')
  })
})

// ── isDuplicateSignal ──────────────────────────────────────────────────────────

describe('isDuplicateSignal', () => {
  const WINDOW = 4 * 60 * 60 * 1000

  test('detects a duplicate: same symbol, bias, marketType within the window', () => {
    expect(isDuplicateSignal(makeSignal(), [makeSignal()], WINDOW)).toBe(true)
  })

  test('not a duplicate when symbol differs', () => {
    const existing = makeSignal({ symbol: 'ETHUSDT' })
    expect(isDuplicateSignal(makeSignal({ symbol: 'BTCUSDT' }), [existing], WINDOW)).toBe(false)
  })

  test('not a duplicate when bias differs', () => {
    const existing = makeSignal({ bias: 'short' })
    expect(isDuplicateSignal(makeSignal({ bias: 'long' }), [existing], WINDOW)).toBe(false)
  })

  test('not a duplicate when marketType differs', () => {
    const existing = makeSignal({ marketType: 'futures' })
    expect(isDuplicateSignal(makeSignal({ marketType: 'spot' }), [existing], WINDOW)).toBe(false)
  })

  test('not a duplicate when the existing signal is older than the window', () => {
    const expired = makeSignal({ generatedAt: Date.now() - WINDOW - 1000 })
    expect(isDuplicateSignal(makeSignal(), [expired], WINDOW)).toBe(false)
  })

  test('returns false for an empty recent-signals list', () => {
    expect(isDuplicateSignal(makeSignal(), [], WINDOW)).toBe(false)
  })

  test('defaults missing marketType to "spot" on both sides', () => {
    const a = makeSignal()
    const b = makeSignal()
    delete a.marketType
    delete b.marketType
    expect(isDuplicateSignal(a, [b], WINDOW)).toBe(true)
  })

  test('finds the duplicate among multiple recent signals', () => {
    const others = [
      makeSignal({ symbol: 'ETHUSDT' }),
      makeSignal({ bias: 'short' }),
      makeSignal(), // this one matches
    ]
    expect(isDuplicateSignal(makeSignal(), others, WINDOW)).toBe(true)
  })
})

// ── generateSignal ─────────────────────────────────────────────────────────────

describe('generateSignal', () => {
  test('returns null for null input', () => {
    expect(generateSignal(null)).toBeNull()
  })

  test('returns null when score is below spot threshold (68)', () => {
    expect(generateSignal(makeAnalysis({ score: 67 }))).toBeNull()
  })

  test('returns null when bias is neutral', () => {
    expect(generateSignal(makeAnalysis({ bias: 'neutral' }))).toBeNull()
  })

  test('returns null for a futures analysis below futures threshold (65)', () => {
    expect(generateSignal(makeAnalysis({ score: 64, marketType: 'futures' }))).toBeNull()
  })

  test('returns a signal for a valid long analysis at score=68', () => {
    const signal = generateSignal(makeAnalysis({ score: 68 }))
    expect(signal).not.toBeNull()
    expect(signal.symbol).toBe('BTCUSDT')
    expect(signal.bias).toBe('long')
  })

  // ── Stop-loss direction ──────────────────────────────────────────────────────

  test('stopLoss is below entry for long trades', () => {
    const signal = generateSignal(makeAnalysis({ bias: 'long' }))
    expect(signal.stopLoss).toBeLessThan(signal.entry)
  })

  test('stopLoss is above entry for short trades', () => {
    const signal = generateSignal(makeAnalysis({ bias: 'short' }))
    expect(signal.stopLoss).toBeGreaterThan(signal.entry)
  })

  // ── Take-profit ordering ─────────────────────────────────────────────────────

  test('TP levels ascend above entry for long trades', () => {
    const s = generateSignal(makeAnalysis({ bias: 'long' }))
    expect(s.tp1).toBeGreaterThan(s.entry)
    expect(s.tp2).toBeGreaterThan(s.tp1)
    expect(s.tp3).toBeGreaterThan(s.tp2)
  })

  test('TP levels descend below entry for short trades', () => {
    const s = generateSignal(makeAnalysis({ bias: 'short' }))
    expect(s.tp1).toBeLessThan(s.entry)
    expect(s.tp2).toBeLessThan(s.tp1)
    expect(s.tp3).toBeLessThan(s.tp2)
  })

  // ── TP ratio matches calcTakeProfits constants ────────────────────────────────

  test('TP3 is exactly 5× risk from entry (long)', () => {
    const s    = generateSignal(makeAnalysis({ bias: 'long' }))
    const risk = s.entry - s.stopLoss
    expect((s.tp3 - s.entry) / risk).toBeCloseTo(5, 1)
  })

  test('TP1 is exactly 1.5× risk from entry (short)', () => {
    const s    = generateSignal(makeAnalysis({ bias: 'short' }))
    const risk = s.stopLoss - s.entry
    expect((s.entry - s.tp1) / risk).toBeCloseTo(1.5, 1)
  })

  // ── Risk-reward ──────────────────────────────────────────────────────────────

  test('riskReward is positive', () => {
    expect(generateSignal(makeAnalysis()).riskReward).toBeGreaterThan(0)
  })

  // ── Leverage ─────────────────────────────────────────────────────────────────

  test('spot signal has null leverage', () => {
    expect(generateSignal(makeAnalysis({ marketType: 'spot' })).leverage).toBeNull()
  })

  test('futures signal at score >= 85 gets leverage 5', () => {
    expect(generateSignal(makeAnalysis({ marketType: 'futures', score: 85 })).leverage).toBe(5)
  })

  test('futures signal at score 75–84 gets leverage 3', () => {
    expect(generateSignal(makeAnalysis({ marketType: 'futures', score: 78 })).leverage).toBe(3)
  })

  test('futures signal at score 65–74 gets leverage 2', () => {
    expect(generateSignal(makeAnalysis({ marketType: 'futures', score: 70 })).leverage).toBe(2)
  })

  // ── Status / timestamps ──────────────────────────────────────────────────────

  test('signal status is "pending" on creation', () => {
    expect(generateSignal(makeAnalysis()).status).toBe('pending')
  })

  test('expiresAt is 4 hours after generatedAt', () => {
    const s = generateSignal(makeAnalysis())
    expect(s.expiresAt - s.generatedAt).toBeCloseTo(4 * 60 * 60 * 1000, -3)
  })

  test('nullable fields are null on a freshly generated signal', () => {
    const s = generateSignal(makeAnalysis())
    expect(s.approvedAt).toBeNull()
    expect(s.executedAt).toBeNull()
    expect(s.orderId).toBeNull()
    expect(s.pnl).toBeNull()
  })

  // ── Required field presence ──────────────────────────────────────────────────

  test('signal contains all expected top-level keys', () => {
    const s = generateSignal(makeAnalysis())
    const required = [
      'symbol', 'exchange', 'exchanges', 'bias', 'timeframe', 'marketType',
      'currentPrice', 'entry', 'stopLoss', 'tp1', 'tp2', 'tp3',
      'riskReward', 'confidence', 'setup', 'indicators', 'structure',
      'status', 'generatedAt', 'expiresAt',
    ]
    for (const key of required) expect(s).toHaveProperty(key)
  })
})

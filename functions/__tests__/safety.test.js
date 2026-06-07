'use strict'
jest.mock('axios')

const axios = require('axios')
const { filterSafeTokens, checkHoneypotIs, checkRugCheck } = require('../lib/safety')

// Suppress console noise from the module under test
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

beforeEach(() => {
  jest.clearAllMocks()
  axios.get = jest.fn()
})

// ── Helpers ────────────────────────────────────────────────────────────────────

/** GoPlus EVM token data that passes every check */
function cleanGoPlusEVM() {
  return {
    is_honeypot:              '0',
    is_open_source:           '1',
    is_mintable:              '0',
    is_proxy:                 '0',
    owner_percent:            '5',
    buy_tax:                  '0',
    sell_tax:                 '0',
    is_blacklisted:           '0',
    is_whitelisted:           '0',
    holder_count:             '500',
    hidden_owner:             '0',
    can_take_back_ownership:  '0',
  }
}

/** Honeypot.is response for a clean token */
function cleanHoneypotIs() {
  return {
    honeypotResult:   { isHoneypot: false },
    simulationResult: { buyTax: 0, sellTax: 0 },
    contractCode:     { openSource: true },
  }
}

/** Mock axios.get routing by URL substring */
function mockAxiosGet(goPlusData, honeypotData) {
  axios.get.mockImplementation((url) => {
    if (url.includes('gopluslabs')) {
      return Promise.resolve({ data: { result: goPlusData } })
    }
    if (url.includes('honeypot.is')) {
      return Promise.resolve({ data: honeypotData })
    }
    return Promise.resolve({ data: {} })
  })
}

// ── checkHoneypotIs ────────────────────────────────────────────────────────────

describe('checkHoneypotIs', () => {
  test('returns parsed result for a clean token', async () => {
    axios.get.mockResolvedValue({ data: cleanHoneypotIs() })
    const result = await checkHoneypotIs('0xabc', 56)
    expect(result.isHoneypot).toBe(false)
    expect(result.buyTax).toBe(0)
    expect(result.sellTax).toBe(0)
    expect(result.isOpenSource).toBe(true)
  })

  test('flags an actual honeypot', async () => {
    axios.get.mockResolvedValue({
      data: {
        honeypotResult:   { isHoneypot: true },
        simulationResult: { buyTax: 0, sellTax: 99 },
      },
    })
    const result = await checkHoneypotIs('0xscam', 56)
    expect(result.isHoneypot).toBe(true)
    expect(result.sellTax).toBe(99)
  })

  test('returns null when the API call fails', async () => {
    axios.get.mockRejectedValue(new Error('network error'))
    expect(await checkHoneypotIs('0xabc', 56)).toBeNull()
  })

  test('handles missing fields gracefully', async () => {
    axios.get.mockResolvedValue({ data: {} })
    const result = await checkHoneypotIs('0xabc', 56)
    expect(result.isHoneypot).toBe(false)
    expect(result.buyTax).toBeNull()
    expect(result.sellTax).toBeNull()
  })
})

// ── checkRugCheck ──────────────────────────────────────────────────────────────

describe('checkRugCheck', () => {
  test('returns the API data verbatim', async () => {
    const mockData = { score: 50, risks: [{ level: 'warn', name: 'Low liquidity' }] }
    axios.get.mockResolvedValue({ data: mockData })
    expect(await checkRugCheck('mintAbc123')).toEqual(mockData)
  })

  test('returns null when the API call fails', async () => {
    axios.get.mockRejectedValue(new Error('timeout'))
    expect(await checkRugCheck('mintAbc123')).toBeNull()
  })
})

// ── filterSafeTokens ──────────────────────────────────────────────────────────

describe('filterSafeTokens', () => {
  test('returns empty array for empty candidates input', async () => {
    expect(await filterSafeTokens([], 'bsc')).toEqual([])
    expect(axios.get).not.toHaveBeenCalled()
  })

  // ── Pass cases ─────────────────────────────────────────────────────────────

  test('passes a clean BSC token and marks it LOW risk', async () => {
    const address = '0xcleantoken'
    mockAxiosGet({ [address]: cleanGoPlusEVM() }, cleanHoneypotIs())

    const result = await filterSafeTokens([{ address }], 'bsc')
    expect(result).toHaveLength(1)
    expect(result[0].safetyData.riskLevel).toBe('LOW')
    expect(result[0].safetyData.gpChecked).toBe(true)
    expect(result[0].safetyData.hpChecked).toBe(true)
  })

  test('marks token UNVERIFIED when all APIs are unreachable', async () => {
    axios.get.mockRejectedValue(new Error('network down'))
    const result = await filterSafeTokens([{ address: '0xunverified' }], 'bsc')
    expect(result).toHaveLength(1)
    expect(result[0].safetyData.riskLevel).toBe('UNVERIFIED')
    expect(result[0].safetyData.gpChecked).toBe(false)
    expect(result[0].safetyData.hpChecked).toBe(false)
  })

  test('attaches correct tax data from GoPlus to safetyData', async () => {
    const address = '0xtaxtoken'
    mockAxiosGet(
      { [address]: { ...cleanGoPlusEVM(), buy_tax: '3', sell_tax: '4' } },
      cleanHoneypotIs(),
    )
    const result = await filterSafeTokens([{ address }], 'bsc')
    expect(result[0].safetyData.buyTax).toBeCloseTo(3)
    expect(result[0].safetyData.sellTax).toBeCloseTo(4)
  })

  // ── Hard-fail cases ────────────────────────────────────────────────────────

  test('rejects a GoPlus-detected honeypot (hard fail)', async () => {
    const address = '0xhoneypot'
    mockAxiosGet(
      { [address]: { ...cleanGoPlusEVM(), is_honeypot: '1' } },
      cleanHoneypotIs(),
    )
    expect(await filterSafeTokens([{ address }], 'bsc')).toHaveLength(0)
  })

  test('rejects a token with buy tax > 15% (GoPlus hard fail)', async () => {
    const address = '0xtaxscam'
    mockAxiosGet(
      { [address]: { ...cleanGoPlusEVM(), buy_tax: '20' } },
      cleanHoneypotIs(),
    )
    expect(await filterSafeTokens([{ address }], 'bsc')).toHaveLength(0)
  })

  test('rejects a token with sell tax > 15% (GoPlus hard fail)', async () => {
    const address = '0xselltax'
    mockAxiosGet(
      { [address]: { ...cleanGoPlusEVM(), sell_tax: '16' } },
      cleanHoneypotIs(),
    )
    expect(await filterSafeTokens([{ address }], 'bsc')).toHaveLength(0)
  })

  test('rejects a token with hidden owner (GoPlus hard fail)', async () => {
    const address = '0xhiddenowner'
    mockAxiosGet(
      { [address]: { ...cleanGoPlusEVM(), hidden_owner: '1' } },
      cleanHoneypotIs(),
    )
    expect(await filterSafeTokens([{ address }], 'bsc')).toHaveLength(0)
  })

  test('rejects when can_take_back_ownership is set (GoPlus hard fail)', async () => {
    const address = '0xownerreclaim'
    mockAxiosGet(
      { [address]: { ...cleanGoPlusEVM(), can_take_back_ownership: '1' } },
      cleanHoneypotIs(),
    )
    expect(await filterSafeTokens([{ address }], 'bsc')).toHaveLength(0)
  })

  test('rejects a Honeypot.is-detected honeypot (hard fail)', async () => {
    const address = '0xhp_honeypot'
    mockAxiosGet(
      { [address]: cleanGoPlusEVM() },
      { honeypotResult: { isHoneypot: true }, simulationResult: { buyTax: 0, sellTax: 0 } },
    )
    expect(await filterSafeTokens([{ address }], 'bsc')).toHaveLength(0)
  })

  test('rejects a token with Honeypot.is sell tax > 15% (hard fail)', async () => {
    const address = '0xhp_selltax'
    mockAxiosGet(
      { [address]: cleanGoPlusEVM() },
      { honeypotResult: { isHoneypot: false }, simulationResult: { buyTax: 0, sellTax: 50 } },
    )
    expect(await filterSafeTokens([{ address }], 'bsc')).toHaveLength(0)
  })

  // ── Soft risk score threshold ──────────────────────────────────────────────

  test('rejects a token whose combined soft risk score reaches RISK_THRESHOLD (70)', async () => {
    // unverified contract (+30) + mintable (+20) + proxy (+15) + blacklisted (+20) = 85
    const address = '0xrisky'
    mockAxiosGet(
      {
        [address]: {
          ...cleanGoPlusEVM(),
          is_open_source: '0', // +30
          is_mintable:    '1', // +20
          is_proxy:       '1', // +15
          is_blacklisted: '1', // +20
        },
      },
      cleanHoneypotIs(),
    )
    expect(await filterSafeTokens([{ address }], 'bsc')).toHaveLength(0)
  })

  test('passes a token whose combined soft risk score is below RISK_THRESHOLD', async () => {
    // unverified contract (+30) + mintable (+20) = 50 — above MEDIUM threshold (45) but below 70
    const address = '0xmildlyrisky'
    mockAxiosGet(
      { [address]: { ...cleanGoPlusEVM(), is_open_source: '0', is_mintable: '1' } },
      cleanHoneypotIs(),
    )
    const result = await filterSafeTokens([{ address }], 'bsc')
    expect(result).toHaveLength(1)
    expect(result[0].safetyData.riskLevel).toBe('MEDIUM')
  })

  // ── Solana chain ──────────────────────────────────────────────────────────

  test('processes Solana tokens via GoPlus SOL + RugCheck', async () => {
    const address = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    axios.get.mockImplementation((url) => {
      if (url.includes('gopluslabs')) {
        return Promise.resolve({
          data: {
            result: {
              [address]: {
                closable:         '0',
                freezable:        '0',
                mintable:         '0',
                metadata_mutable: '0',
                transfer_fee_data: { transfer_fee_basis_points: '0' },
              },
            },
          },
        })
      }
      if (url.includes('rugcheck')) {
        return Promise.resolve({ data: { score: 50, risks: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    const result = await filterSafeTokens([{ address }], 'sol')
    expect(result).toHaveLength(1)
    expect(result[0].safetyData.rcChecked).toBe(true)
    expect(result[0].safetyData.hpChecked).toBe(false) // Honeypot.is not used for Solana
  })

  test('rejects Solana token with closable mint (rug pull risk)', async () => {
    const address = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    axios.get.mockImplementation((url) => {
      if (url.includes('gopluslabs')) {
        return Promise.resolve({
          data: { result: { [address]: { closable: '1' } } },
        })
      }
      if (url.includes('rugcheck')) {
        return Promise.resolve({ data: { score: 0, risks: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    expect(await filterSafeTokens([{ address }], 'sol')).toHaveLength(0)
  })

  test('rejects Solana token with RugCheck danger risk', async () => {
    const address = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    axios.get.mockImplementation((url) => {
      if (url.includes('gopluslabs')) {
        return Promise.resolve({
          data: {
            result: {
              [address]: {
                closable: '0', freezable: '0', mintable: '0',
                metadata_mutable: '0',
                transfer_fee_data: { transfer_fee_basis_points: '0' },
              },
            },
          },
        })
      }
      if (url.includes('rugcheck')) {
        return Promise.resolve({
          data: { score: 50, risks: [{ level: 'danger', name: 'Mint authority active' }] },
        })
      }
      return Promise.resolve({ data: {} })
    })

    expect(await filterSafeTokens([{ address }], 'sol')).toHaveLength(0)
  })
})

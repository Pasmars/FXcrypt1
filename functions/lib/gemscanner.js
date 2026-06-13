const axios          = require('axios')
const { filterSafeTokens } = require('./safety')

const HTTP_TIMEOUT = 12000

// ── DexScreener endpoints ─────────────────────────────────────────────────
const DEXSCREENER_LATEST      = 'https://api.dexscreener.com/token-profiles/latest/v1'
const DEXSCREENER_BOOSTED     = 'https://api.dexscreener.com/token-boosts/latest/v1'
const DEXSCREENER_TOP_BOOSTED = 'https://api.dexscreener.com/token-boosts/top/v1'
const DEXSCREENER_PAIRS       = 'https://api.dexscreener.com/latest/dex/tokens/'

const DEXSCREENER_SEARCH = 'https://api.dexscreener.com/latest/dex/search?q='

// Chain ID mappings for DexScreener
const CHAIN_MAP = {
  bsc:  'bsc',
  eth:  'ethereum',
  sol:  'solana',
  base: 'base',
  ton:  'ton',
}

// ── Narratives (meme/theme keyword buckets) ────────────────────────────────
const NARRATIVES = {
  dog:    ['dog','doge','shib','inu','puppy','wif','dogwif','floki','husky','corgi','akita','shiba','pup','woof','kabosu','samoyed','bonk','snoopy'],
  cat:    ['cat','kitty','meow','neko','feline','popcat','mew','garfield','kitten','catto','tom','purr'],
  frog:   ['frog','pepe','toad','ribbit','kek','kermit','croak','wojak','froge'],
  duck:   ['duck','quack','mallard','daffy','duckie','ducky'],
  bear:   ['bear','grizzly','teddy','bruno','pooh','bera','beruh','paddington'],
  monkey: ['monkey','ape','kong','chimp','gorilla','banana','bonobo','mandrill','gmoon'],
  fish:   ['fish','shark','whale','tuna','salmon','koi','dolphin','orca','fishy','nemo'],
  ai:     ['ai','gpt','agent','neural','robot','llm','brain','intelligence','deepseek','grok','tao','fetch','autonomous','sentient','agentic'],
}
const NARRATIVE_SEARCH = {
  dog:['doge','shib','inu','dog','wif','floki','bonk'], cat:['cat','popcat','kitty','meow','mew'],
  frog:['pepe','frog','toad','kek'], duck:['duck','quack','donald'], bear:['bear','pooh','teddy','bera'],
  monkey:['ape','monkey','kong','banana'], fish:['fish','shark','whale'], ai:['ai','agent','gpt','grok'],
}
const _narRe = {}
function narrativeMatch(pair, key) {
  const kws = NARRATIVES[key]
  if (!kws) return true
  if (!_narRe[key]) _narRe[key] = new RegExp('\\b(' + kws.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i')
  return _narRe[key].test((pair.baseToken?.name || '') + ' ' + (pair.baseToken?.symbol || ''))
}
async function searchNarrativePairs(narrative, chainId) {
  const terms = NARRATIVE_SEARCH[narrative] || [narrative]
  const out = []
  for (const term of terms) {
    try {
      const { data } = await axios.get(DEXSCREENER_SEARCH + encodeURIComponent(term), { timeout: HTTP_TIMEOUT })
      if (Array.isArray(data?.pairs)) out.push(...data.pairs.filter(p => p.chainId === chainId))
    } catch { /* continue */ }
    await new Promise(r => setTimeout(r, 150))
  }
  return out
}

// ── Token scoring algorithm (0-100) ───────────────────────────────────────
function scoreToken(pair) {
  let score = 0

  // 1. Liquidity sweet spot (0-20 pts)
  //    $5k-$50k = full points, < $5k or > $500k = diminishing
  const liq = pair.liquidity?.usd || 0
  if (liq >= 5000 && liq <= 50000)       score += 20
  else if (liq > 50000 && liq <= 200000) score += 15
  else if (liq > 200000 && liq <= 500000) score += 10
  else if (liq > 500000)                 score += 5
  else if (liq >= 2000)                  score += 8

  // 2. Volume-to-liquidity ratio (0-20 pts)
  //    Healthy ratio is 0.5-3x. Above 3x = very active
  const vol24 = pair.volume?.h24 || 0
  if (liq > 0) {
    const vlRatio = vol24 / liq
    if (vlRatio >= 3)        score += 20
    else if (vlRatio >= 1.5) score += 16
    else if (vlRatio >= 0.5) score += 12
    else if (vlRatio >= 0.1) score += 6
  }

  // 3. Pair age — newer = more gem potential (0-15 pts)
  const ageHours = pair.pairCreatedAt
    ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60)
    : 9999
  if (ageHours <= 1)       score += 15
  else if (ageHours <= 6)  score += 13
  else if (ageHours <= 24) score += 10
  else if (ageHours <= 72) score += 6
  else if (ageHours <= 168) score += 3

  // 4. Price momentum (0-20 pts)
  const m5  = pair.priceChange?.m5  || 0
  const h1  = pair.priceChange?.h1  || 0
  const h24 = pair.priceChange?.h24 || 0

  // Short-term positive momentum
  if (m5 > 5)       score += 5
  else if (m5 > 0)  score += 3

  if (h1 > 20)      score += 8
  else if (h1 > 5)  score += 5
  else if (h1 > 0)  score += 2

  if (h24 > 50)     score += 7
  else if (h24 > 10) score += 5
  else if (h24 > 0) score += 2

  // 5. Buy vs sell pressure (0-15 pts)
  const buys24  = pair.txns?.h24?.buys  || 0
  const sells24 = pair.txns?.h24?.sells || 0
  const totalTx = buys24 + sells24

  if (totalTx > 0) {
    const buyRatio = buys24 / totalTx
    if (buyRatio >= 0.65)      score += 15
    else if (buyRatio >= 0.55) score += 10
    else if (buyRatio >= 0.45) score += 5
  }

  // 6. Social / info presence (0-10 pts)
  if (pair.info?.websites?.length)   score += 3
  if (pair.info?.socials?.length)    score += 3
  if (pair.info?.imageUrl)           score += 2
  if (pair.info?.header)             score += 2

  return Math.min(100, Math.max(0, score))
}

// ── Fetch newly trending tokens from DexScreener ──────────────────────────
async function fetchLatestTokens(chainId) {
  const tokens = new Map() // address -> token data

  // Fetch from latest profiles endpoint
  try {
    const { data } = await axios.get(DEXSCREENER_LATEST, { timeout: HTTP_TIMEOUT })
    if (Array.isArray(data)) {
      for (const profile of data) {
        if (profile.chainId === chainId && profile.tokenAddress) {
          tokens.set(profile.tokenAddress.toLowerCase(), {
            address:     profile.tokenAddress,
            description: profile.description || '',
            links:       profile.links || [],
            icon:        profile.icon || '',
          })
        }
      }
    }
  } catch { /* endpoint may be unavailable — continue */ }

  // Fetch from boosted tokens endpoint
  try {
    const { data } = await axios.get(DEXSCREENER_BOOSTED, { timeout: HTTP_TIMEOUT })
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.chainId === chainId && item.tokenAddress) {
          const key = item.tokenAddress.toLowerCase()
          if (!tokens.has(key)) {
            tokens.set(key, {
              address:     item.tokenAddress,
              description: item.description || '',
              links:       item.links || [],
              icon:        item.icon || '',
              boosted:     true,
              totalAmount: item.totalAmount || 0,
            })
          } else {
            tokens.get(key).boosted = true
            tokens.get(key).totalAmount = item.totalAmount || 0
          }
        }
      }
    }
  } catch { /* continue */ }

  // Fetch from top boosted endpoint (often has BSC tokens the other feeds miss)
  try {
    const { data } = await axios.get(DEXSCREENER_TOP_BOOSTED, { timeout: HTTP_TIMEOUT })
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.chainId === chainId && item.tokenAddress) {
          const key = item.tokenAddress.toLowerCase()
          if (!tokens.has(key)) {
            tokens.set(key, {
              address:     item.tokenAddress,
              description: item.description || '',
              links:       item.links || [],
              icon:        item.icon || '',
              boosted:     true,
              totalAmount: item.totalAmount || 0,
            })
          } else {
            tokens.get(key).boosted = true
            if (item.description && !tokens.get(key).description) {
              tokens.get(key).description = item.description
            }
          }
        }
      }
    }
  } catch { /* continue */ }

  return Array.from(tokens.values())
}

// ── Fetch pair data for a batch of token addresses ────────────────────────
async function fetchPairData(addresses, chainId) {
  // DexScreener allows multi-token queries (comma separated, max ~30)
  const results = []
  const BATCH_SIZE = 30

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE)
    try {
      const { data } = await axios.get(
        DEXSCREENER_PAIRS + batch.join(','),
        { timeout: HTTP_TIMEOUT }
      )
      if (data.pairs) {
        results.push(...data.pairs.filter(p => p.chainId === chainId))
      }
    } catch { /* skip failed batch */ }

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < addresses.length) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return results
}

// ── GeckoTerminal (free, paginated — new + established/old pools) ──────────
const GT_NET = { eth: 'eth', bsc: 'bsc', sol: 'solana', base: 'base', matic: 'polygon_pos', ton: 'ton' }
function normalizeGtPool(pool, included, dsChainId, net) {
  const a = pool.attributes || {}
  const btId = pool.relationships?.base_token?.data?.id
  const tok = btId ? included.find(x => x.id === btId) : null
  const addr = btId ? btId.substring(btId.indexOf('_') + 1) : ''
  const img = tok?.attributes?.image_url
  const pc = a.price_change_percentage || {}
  const tx = a.transactions || {}
  return {
    chainId: dsChainId,
    baseToken: { address: addr, name: tok?.attributes?.name || (a.name || '').split(' / ')[0] || 'Unknown', symbol: tok?.attributes?.symbol || '' },
    quoteToken: { symbol: (a.name || '').split(' / ')[1] || '' },
    priceUsd: a.base_token_price_usd || 0,
    priceNative: 0,
    liquidity: { usd: parseFloat(a.reserve_in_usd || 0) },
    volume: { h24: parseFloat(a.volume_usd?.h24 || 0) },
    marketCap: parseFloat(a.market_cap_usd || a.fdv_usd || 0),
    fdv: parseFloat(a.fdv_usd || 0),
    priceChange: { m5: +(pc.m5 || 0), h1: +(pc.h1 || 0), h6: +(pc.h6 || 0), h24: +(pc.h24 || 0) },
    txns: { h24: { buys: tx.h24?.buys || 0, sells: tx.h24?.sells || 0 }, h1: { buys: tx.h1?.buys || 0, sells: tx.h1?.sells || 0 } },
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    info: { imageUrl: img && !String(img).includes('missing') ? img : null },
    pairAddress: a.address,
    dexId: pool.relationships?.dex?.data?.id || 'geckoterminal',
    url: `https://www.geckoterminal.com/${net}/pools/${a.address}`,
  }
}
async function fetchGeckoTerminalPairs(chain) {
  const net = GT_NET[chain]
  if (!net) return []
  const dsId = CHAIN_MAP[chain]
  const out = []
  const lists = [['new_pools', 2], ['pools', 2], ['trending_pools', 1]]
  for (const [path, pages] of lists) {
    for (let p = 1; p <= pages; p++) {
      try {
        const { data } = await axios.get(
          `https://api.geckoterminal.com/api/v2/networks/${net}/${path}?include=base_token&page=${p}`,
          { timeout: HTTP_TIMEOUT, headers: { accept: 'application/json' } }
        )
        const inc = data.included || []
        for (const pool of (data.data || [])) out.push(normalizeGtPool(pool, inc, dsId, net))
      } catch { break }
      await new Promise(r => setTimeout(r, 260))
    }
  }
  return out
}

// ── DexTools (optional — requires DEXTOOLS_API_KEY; paid/trial plan) ────────
const DEXTOOLS_CHAIN = { eth: 'ether', bsc: 'bsc', sol: 'solana', base: 'base', matic: 'polygon' }
function normalizeDexToolsRow(row, dsChainId) {
  const mt = row.mainToken || row.token || {}
  const m = row.metrics || {}
  return {
    chainId: dsChainId,
    baseToken: { address: mt.address || row.address || '', name: mt.name || '', symbol: mt.symbol || '' },
    quoteToken: { symbol: (row.sideToken?.symbol) || '' },
    priceUsd: row.price || m.price || 0,
    liquidity: { usd: parseFloat(m.liquidity || row.liquidity || 0) },
    volume: { h24: parseFloat(m.volume24h || row.volume || 0) },
    marketCap: parseFloat(m.mcap || m.fdv || 0),
    fdv: parseFloat(m.fdv || 0),
    priceChange: { m5: 0, h1: 0, h6: 0, h24: parseFloat(row.variation24h || m.priceChange24h || 0) },
    txns: { h24: { buys: 0, sells: 0 } },
    pairCreatedAt: row.creationTime ? Date.parse(row.creationTime) : null,
    info: { imageUrl: mt.logo || null },
    pairAddress: row.address || '',
    dexId: row.exchange?.name || 'dextools',
    url: '',
  }
}
async function fetchDexToolsPairs(chain, key) {
  const dtChain = DEXTOOLS_CHAIN[chain]
  if (!dtChain || !key) return []
  const dsId = CHAIN_MAP[chain]
  const out = []
  for (const ep of ['hotpools', 'gainers']) {
    try {
      const { data } = await axios.get(
        `https://public-api.dextools.io/trial/v2/ranking/${dtChain}/${ep}`,
        { timeout: HTTP_TIMEOUT, headers: { 'X-API-KEY': key, accept: 'application/json' } }
      )
      const rows = data?.data || data?.results || []
      for (const row of (Array.isArray(rows) ? rows : [])) out.push(normalizeDexToolsRow(row, dsId))
    } catch { /* key missing/invalid/rate-limited — skip */ }
    await new Promise(r => setTimeout(r, 200))
  }
  return out
}

// ── Main gem discovery function ───────────────────────────────────────────
async function discoverGems(chains, filters = {}) {
  const {
    minLiquidity = 5000,
    maxAgeHours  = 24,
    minScore     = 40,
    minVolume    = 1000,
    maxVolume    = 0,
    narrative    = 'all',
    minMarketCap = 0,
    maxMarketCap = 0,
    sort         = 'score',
    dextoolsKey  = null,
    limit: maxResults = 50,
  } = filters

  const useNarrative = narrative && narrative !== 'all'
  const allGems = []

  for (const chain of chains) {
    const chainId = CHAIN_MAP[chain]
    if (!chainId) continue

    // Step 1: Discover trending/new token addresses
    const latestTokens = await fetchLatestTokens(chainId)

    // Step 2: Get pair data for those tokens (+ narrative search + GeckoTerminal + DexTools)
    const addresses = latestTokens.map(t => t.address)
    let pairs       = addresses.length ? await fetchPairData(addresses, chainId) : []
    if (useNarrative) pairs = pairs.concat(await searchNarrativePairs(narrative, chainId))
    pairs = pairs.concat(await fetchGeckoTerminalPairs(chain))
    if (dextoolsKey) pairs = pairs.concat(await fetchDexToolsPairs(chain, dextoolsKey))
    if (!pairs.length) continue

    // Step 3: Group pairs by token, keep best pair per token
    const bestPairByToken = new Map()
    for (const pair of pairs) {
      const addr = (pair.baseToken?.address || '').toLowerCase()
      const liq  = pair.liquidity?.usd || 0

      if (liq < minLiquidity) continue

      // Narrative match (by token name / symbol)
      if (useNarrative && !narrativeMatch(pair, narrative)) continue

      // Market cap range
      const mcap = pair.marketCap || pair.fdv || 0
      if (minMarketCap && mcap < minMarketCap) continue
      if (maxMarketCap && mcap > maxMarketCap) continue

      // Age — enforce the window only when the creation time is known
      if (pair.pairCreatedAt) {
        const ageH = (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60)
        if (ageH > maxAgeHours) continue
      }

      // 24h volume range (supports low-volume gem hunting)
      const vol = pair.volume?.h24 || 0
      if (minVolume && vol < minVolume) continue
      if (maxVolume && vol > maxVolume) continue

      const existing = bestPairByToken.get(addr)
      if (!existing || liq > (existing.liquidity?.usd || 0)) {
        bestPairByToken.set(addr, pair)
      }
    }

    // Step 4: Build candidate list for the safety filter.
    // Pre-score and keep only the highest-scoring 40 so the (expensive) safety
    // checks aren't overwhelmed now that GeckoTerminal/DexTools widen the pool.
    const tokenMetaMap = new Map(latestTokens.map(t => [t.address.toLowerCase(), t]))

    const candidates = Array.from(bestPairByToken.entries())
      .map(([addr, pair]) => ({ address: pair.baseToken?.address || addr, pair, meta: tokenMetaMap.get(addr) || {} }))
      .sort((a, b) => scoreToken(b.pair) - scoreToken(a.pair))
      .slice(0, 40)

    // Step 5: Multi-layer safety filter — runs BEFORE scoring.
    // GoPlus Security + Honeypot.is (BSC) / RugCheck.xyz (SOL)
    // Any token that fails is dropped here and never reaches the scoring engine.
    const safeCandidates = await filterSafeTokens(candidates, chain)

    // Step 6: Score the surviving tokens
    for (const { address, pair, meta, safetyData } of safeCandidates) {
      const gemScore = scoreToken(pair)
      if (gemScore < minScore) continue

      const ageHours = pair.pairCreatedAt
        ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60)
        : null

      // Normalise safetyData into the shape the rest of the code expects
      const safety = safetyData
        ? {
            riskLevel:    safetyData.riskLevel,
            riskScore:    safetyData.riskScore,
            flags:        safetyData.flags,
            buyTax:       safetyData.buyTax,
            sellTax:      safetyData.sellTax,
            isOpenSource: safetyData.isOpenSource,
            isMintable:   safetyData.isMintable,
            holderCount:  safetyData.holderCount,
            ownerPercent: safetyData.ownerPercent,
            rugScore:     safetyData.rugScore,
            transferFee:  safetyData.transferFee,
            gpChecked:    safetyData.gpChecked,
            hpChecked:    safetyData.hpChecked,
            rcChecked:    safetyData.rcChecked,
          }
        : { riskLevel: 'UNVERIFIED', riskScore: 0, flags: [], gpChecked: false, hpChecked: false, rcChecked: false }

      allGems.push({
        chain,
        tokenAddress:   pair.baseToken?.address || address,
        tokenName:      pair.baseToken?.name || 'Unknown',
        tokenSymbol:    pair.baseToken?.symbol || '???',
        pairAddress:    pair.pairAddress,
        dexId:          pair.dexId,
        dexName:        dexLabel(pair.dexId),
        priceUsd:       parseFloat(pair.priceUsd || 0),
        priceNative:    parseFloat(pair.priceNative || 0),
        liquidity:      pair.liquidity?.usd || 0,
        volume24h:      pair.volume?.h24 || 0,
        marketCap:      pair.marketCap || pair.fdv || 0,
        fdv:            pair.fdv || 0,
        priceChange5m:  pair.priceChange?.m5 || 0,
        priceChange1h:  pair.priceChange?.h1 || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        buys24h:        pair.txns?.h24?.buys || 0,
        sells24h:       pair.txns?.h24?.sells || 0,
        buys1h:         pair.txns?.h1?.buys || 0,
        sells1h:        pair.txns?.h1?.sells || 0,
        ageHours:       ageHours ? parseFloat(ageHours.toFixed(1)) : null,
        gemScore,
        safety,
        boosted:        !!meta.boosted,
        hasWebsite:     !!(meta.links?.length || pair.info?.websites?.length),
        hasSocials:     !!(pair.info?.socials?.length),
        icon:           meta.icon || pair.info?.imageUrl || null,
        description:    meta.description || '',
        quoteSymbol:    pair.quoteToken?.symbol || '',
        dexUrl:         pair.url || '',
        timestamp:      Date.now(),
      })
    }
  }

  // Sort by requested trend
  if (sort === 'trending')      allGems.sort((a, b) => b.volume24h - a.volume24h)
  else if (sort === 'new')      allGems.sort((a, b) => (a.ageHours ?? 1e9) - (b.ageHours ?? 1e9))
  else if (sort === 'gainers')  allGems.sort((a, b) => b.priceChange24h - a.priceChange24h)
  else                          allGems.sort((a, b) => b.gemScore - a.gemScore)
  return allGems.slice(0, maxResults)
}

// ── DEX label helper ──────────────────────────────────────────────────────
function dexLabel(dexId) {
  const map = {
    pancakeswap: 'PancakeSwap V2', pancakeswap_v3: 'PancakeSwap V3',
    biswap: 'Biswap', apeswap: 'ApeSwap', babyswap: 'BabySwap',
    uniswap_v2: 'Uniswap V2', uniswap_v3: 'Uniswap V3',
    raydium: 'Raydium', raydium_clmm: 'Raydium CLMM',
    orca: 'Orca', meteora: 'Meteora', lifinity: 'Lifinity',
    pumpfun: 'Pump.fun', phoenix: 'Phoenix',
    aerodrome: 'Aerodrome', baseswap: 'BaseSwap', baseswap_v3: 'BaseSwap V3',
    sushiswap: 'SushiSwap', swapbased: 'SwapBased', alienbase: 'AlienBase',
    dedust: 'DeDust', stonfi: 'STON.fi', megaton: 'Megaton Finance',
  }
  return map[dexId] || dexId
}

// ── Explorer URL helper ───────────────────────────────────────────────────
function explorerTokenUrl(chain, tokenAddress) {
  if (chain === 'bsc')  return `https://bscscan.com/token/${tokenAddress}`
  if (chain === 'eth')  return `https://etherscan.io/token/${tokenAddress}`
  if (chain === 'sol')  return `https://solscan.io/token/${tokenAddress}`
  if (chain === 'base') return `https://basescan.org/token/${tokenAddress}`
  if (chain === 'ton')  return `https://tonscan.org/address/${tokenAddress}`
  return '#'
}

function explorerTxUrl(chain, txHash) {
  if (chain === 'bsc')  return `https://bscscan.com/tx/${txHash}`
  if (chain === 'eth')  return `https://etherscan.io/tx/${txHash}`
  if (chain === 'sol')  return `https://solscan.io/tx/${txHash}`
  if (chain === 'base') return `https://basescan.org/tx/${txHash}`
  if (chain === 'ton')  return `https://tonscan.org/tx/${txHash}`
  return '#'
}

// ── Compact number formatting ─────────────────────────────────────────────
function fmtCompact(num) {
  if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B'
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M'
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(1) + 'K'
  return '$' + num.toLocaleString('en-US')
}

function fmtPct(val) {
  return (val > 0 ? '+' : '') + val.toFixed(1) + '%'
}

function buildTxnBar(buys, sells) {
  const total = buys + sells
  if (total === 0) return ''
  const buyPct = Math.round((buys / total) * 100)
  const sellPct = 100 - buyPct
  const filled = Math.round(buyPct / 5)
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)
  return `\`[${bar}]\`\n🟢 ${buys} buys (${buyPct}%) │ 🔴 ${sells} sells (${sellPct}%)`
}

// ── Format a single gem card (reusable — returns text + metadata) ─────────
// Returns { text, chainTicker, buyAmount } for use in telegram.js card display.
function formatGemCard(gem, settings) {
  const scoreEmoji = gem.gemScore >= 70 ? '🟢' : gem.gemScore >= 40 ? '🟡' : '🔴'
  const chainLabel = gem.chain === 'bsc'  ? '🟡 BNB Chain'
    : gem.chain === 'eth'  ? '💠 Ethereum'
    : gem.chain === 'sol'  ? '🟣 Solana'
    : gem.chain === 'base' ? '🔵 Base'
    : gem.chain === 'ton'  ? '🔷 TON'
    : gem.chain
  const chainTicker = gem.chain === 'bsc'  ? 'BNB'
    : gem.chain === 'eth'  ? 'ETH'
    : gem.chain === 'sol'  ? 'SOL'
    : gem.chain === 'base' ? 'ETH'
    : gem.chain === 'ton'  ? 'TON'
    : gem.chain.toUpperCase()
  const buyAmount = gem.chain === 'sol'
    ? (settings?.gemBuyAmountSol ?? 0.05)
    : gem.chain === 'eth'
    ? (settings?.gemBuyAmountEth ?? 0.01)
    : (settings?.gemBuyAmountBsc ?? 0.005)

  const priceStr = gem.priceUsd < 0.00001
    ? gem.priceUsd.toExponential(3)
    : gem.priceUsd.toFixed(8)

  const ageStr = gem.ageHours != null
    ? (gem.ageHours < 1 ? `${Math.round(gem.ageHours * 60)}m` : `${gem.ageHours.toFixed(1)}h`)
    : '?'

  const mcapStr = gem.marketCap > 0 ? fmtCompact(gem.marketCap) : 'N/A'
  const fdvStr  = gem.fdv > 0 ? fmtCompact(gem.fdv) : 'N/A'
  const liqStr  = fmtCompact(gem.liquidity)
  const volStr  = fmtCompact(gem.volume24h)

  const explorerUrl      = explorerTokenUrl(gem.chain, gem.tokenAddress)
  const dexScreenerChain = CHAIN_MAP[gem.chain] || gem.chain
  const dexUrl           = gem.dexUrl || `https://dexscreener.com/${dexScreenerChain}/${gem.tokenAddress}`
  const pairStr          = gem.quoteSymbol ? `${gem.tokenSymbol}/${gem.quoteSymbol}` : gem.tokenSymbol

  // Safety section
  let safetySection = ''
  if (gem.safety) {
    const s = gem.safety
    const riskEmoji = s.riskLevel === 'LOW'        ? '✅'
      : s.riskLevel === 'MEDIUM'     ? '⚠️'
      : s.riskLevel === 'HIGH'       ? '🚨'
      : s.riskLevel === 'UNVERIFIED' ? '❓'
      : '❓'

    const checks = []
    if (s.gpChecked) checks.push('GoPlus')
    if (s.hpChecked) checks.push('Honeypot.is')
    if (s.rcChecked) checks.push('RugCheck')

    const taxLine    = (s.buyTax != null || s.sellTax != null)
      ? `Tax: Buy ${s.buyTax ?? '?'}% / Sell ${s.sellTax ?? '?'}%`
      : null
    const holderLine = s.holderCount > 0
      ? `Holders: ${s.holderCount.toLocaleString()}`
      : null
    const flagLine   = s.flags?.length
      ? `⚠️ ${s.flags.slice(0, 3).join(' | ')}`
      : null

    const details   = [taxLine, holderLine].filter(Boolean).join(' | ')
    const checkedBy = checks.length ? `Checked by: ${checks.join(', ')}` : 'Unverified'

    safetySection =
      `\n🛡 *Safety* ${riskEmoji} *${s.riskLevel}*\n` +
      (details                   ? `├ ${details}\n`                   : '') +
      (s.isOpenSource === false  ? `├ ⚠️ Contract unverified\n`       : '') +
      (s.isMintable   === true   ? `├ ⚠️ Token is mintable\n`         : '') +
      (flagLine                  ? `├ ${flagLine}\n`                  : '') +
      `└ _${checkedBy}_\n`
  }

  // Description snippet
  let descSection = ''
  if (gem.description) {
    const desc = gem.description.length > 150
      ? gem.description.slice(0, 150) + '...'
      : gem.description
    descSection = `\n📝 _${desc}_\n`
  }

  const txnSection = buildTxnBar(gem.buys24h, gem.sells24h)

  const text =
    `💎 *GEM SIGNAL* ─ ${gem.tokenName}\n` +
    `──────────────────────────\n\n` +
    `${scoreEmoji} *Score: ${gem.gemScore}/100*` +
    `${gem.boosted ? ' | 🚀 Boosted' : ''}\n\n` +
    `*Token:* ${gem.tokenName} (\`${gem.tokenSymbol}\`)\n` +
    `*Chain:* ${chainLabel}\n` +
    `*DEX:* ${gem.dexName} (${pairStr})\n` +
    `*Age:* ${ageStr}\n\n` +
    `💰 *Market Data*\n` +
    `├ Price: \`$${priceStr}\`\n` +
    `├ MCap: *${mcapStr}*\n` +
    `├ FDV: ${fdvStr}\n` +
    `├ Liq: *${liqStr}*\n` +
    `└ Vol 24h: *${volStr}*\n\n` +
    `📈 *Price Action*\n` +
    `├ 5m: \`${fmtPct(gem.priceChange5m)}\`\n` +
    `├ 1h: \`${fmtPct(gem.priceChange1h)}\`\n` +
    `└ 24h: \`${fmtPct(gem.priceChange24h)}\`\n\n` +
    `📊 *Transactions (24h)*\n` +
    (txnSection ? txnSection + '\n' : '') +
    safetySection +
    descSection +
    `\n📜 *Contract*\n` +
    `\`${gem.tokenAddress}\`\n\n` +
    `🔗 [DexScreener](${dexUrl}) | [Explorer](${explorerUrl})`

  return { text, chainTicker, buyAmount }
}

// ── Send Telegram gem alerts (full detail format) ───────────────────────
async function sendGemAlerts(gems, settings, bot, chatId, db, uid) {
  const alertsRef = db.collection(`users/${uid}/gemAlerts`)
  let sentCount = 0

  for (const gem of gems.slice(0, 10)) {
    // Dedup: skip if already alerted for this token in the last 6 hours
    const existing = await alertsRef
      .where('tokenAddress', '==', gem.tokenAddress)
      .where('chain', '==', gem.chain)
      .orderBy('alertedAt', 'desc')
      .limit(1)
      .get()

    if (!existing.empty) {
      const lastAlert = existing.docs[0].data()
      const lastTime  = lastAlert.alertedAt?.toMillis?.() || lastAlert.alertedAt || 0
      if (Date.now() - lastTime < 6 * 60 * 60 * 1000) continue
    }

    // Build the rich alert message
    const scoreEmoji = gem.gemScore >= 70 ? '🟢' : gem.gemScore >= 40 ? '🟡' : '🔴'
    const chainLabel = gem.chain === 'bsc'  ? '🟡 BNB Chain'
      : gem.chain === 'eth'  ? '💠 Ethereum'
      : gem.chain === 'sol'  ? '🟣 Solana'
      : gem.chain === 'base' ? '🔵 Base'
      : gem.chain === 'ton'  ? '🔷 TON'
      : gem.chain
    const chainTicker = gem.chain === 'bsc' ? 'BNB'
      : gem.chain === 'eth'  ? 'ETH'
      : gem.chain === 'sol'  ? 'SOL'
      : gem.chain === 'base' ? 'ETH'
      : gem.chain === 'ton'  ? 'TON'
      : gem.chain.toUpperCase()
    const buyAmount = gem.chain === 'bsc'
      ? (settings.gemBuyAmountBsc || 0.005)
      : gem.chain === 'eth'
      ? (settings.gemBuyAmountEth || 0.01)
      : gem.chain === 'base'
      ? (settings.gemBuyAmountEth || 0.01)
      : (settings.gemBuyAmountSol || 0.05)

    const priceStr = gem.priceUsd < 0.00001
      ? gem.priceUsd.toExponential(3)
      : gem.priceUsd.toFixed(8)

    const ageStr = gem.ageHours != null
      ? (gem.ageHours < 1 ? `${Math.round(gem.ageHours * 60)}m` : `${gem.ageHours.toFixed(1)}h`)
      : '?'

    const mcapStr = gem.marketCap > 0 ? fmtCompact(gem.marketCap) : 'N/A'
    const fdvStr  = gem.fdv > 0 ? fmtCompact(gem.fdv) : 'N/A'
    const liqStr  = fmtCompact(gem.liquidity)
    const volStr  = fmtCompact(gem.volume24h)

    const explorerUrl = explorerTokenUrl(gem.chain, gem.tokenAddress)
    const dexScreenerChain = CHAIN_MAP[gem.chain] || gem.chain
    const dexUrl = gem.dexUrl || `https://dexscreener.com/${dexScreenerChain}/${gem.tokenAddress}`
    const pairStr = gem.quoteSymbol ? `${gem.tokenSymbol}/${gem.quoteSymbol}` : gem.tokenSymbol

    // Short contract address
    const shortCA = gem.tokenAddress.length > 16
      ? gem.tokenAddress.slice(0, 6) + '...' + gem.tokenAddress.slice(-4)
      : gem.tokenAddress

    // Safety section — shown for all chains using the full multi-layer data
    let safetySection = ''
    if (gem.safety) {
      const s = gem.safety
      const riskEmoji = s.riskLevel === 'LOW'        ? '✅'
        : s.riskLevel === 'MEDIUM'     ? '⚠️'
        : s.riskLevel === 'HIGH'       ? '🚨'
        : s.riskLevel === 'UNVERIFIED' ? '❓'
        : '❓'

      // Which APIs were checked
      const checks = []
      if (s.gpChecked) checks.push('GoPlus')
      if (s.hpChecked) checks.push('Honeypot.is')
      if (s.rcChecked) checks.push('RugCheck')

      const taxLine = (s.buyTax != null || s.sellTax != null)
        ? `Tax: Buy ${s.buyTax ?? '?'}% / Sell ${s.sellTax ?? '?'}%`
        : null

      const holderLine = s.holderCount > 0
        ? `Holders: ${s.holderCount.toLocaleString()}`
        : null

      const flagLine = s.flags?.length
        ? `⚠️ ${s.flags.slice(0, 3).join(' | ')}`
        : null

      const details = [taxLine, holderLine].filter(Boolean).join(' | ')
      const checkedBy = checks.length ? `Checked by: ${checks.join(', ')}` : 'Unverified'

      safetySection =
        `\n🛡 *Safety* ${riskEmoji} *${s.riskLevel}*\n` +
        (details  ? `├ ${details}\n` : '') +
        (s.isOpenSource === false ? `├ ⚠️ Contract unverified\n` : '') +
        (s.isMintable   === true  ? `├ ⚠️ Token is mintable\n`  : '') +
        (flagLine ? `├ ${flagLine}\n` : '') +
        `└ _${checkedBy}_\n`
    }

    // Description snippet
    let descSection = ''
    if (gem.description) {
      const desc = gem.description.length > 150
        ? gem.description.slice(0, 150) + '...'
        : gem.description
      descSection = `\n📝 _${desc}_\n`
    }

    // Transaction ratio bar
    const txnSection = buildTxnBar(gem.buys24h, gem.sells24h)

    const message =
      `💎 *GEM ALERT* ─ ${gem.tokenName}\n` +
      `──────────────────────────\n\n` +

      `${scoreEmoji} *Score: ${gem.gemScore}/100*` +
      `${gem.boosted ? ' | 🚀 Boosted' : ''}\n\n` +

      `*Token:* ${gem.tokenName} (\`${gem.tokenSymbol}\`)\n` +
      `*Chain:* ${chainLabel}\n` +
      `*DEX:* ${gem.dexName} (​${pairStr}​)\n` +
      `*Age:* ${ageStr}\n\n` +

      `💰 *Market Data*\n` +
      `├ Price: \`$${priceStr}\`\n` +
      `├ MCap: *${mcapStr}*\n` +
      `├ FDV: ${fdvStr}\n` +
      `├ Liq: *${liqStr}*\n` +
      `└ Vol 24h: *${volStr}*\n\n` +

      `📈 *Price Action*\n` +
      `├ 5m: \`${fmtPct(gem.priceChange5m)}\`\n` +
      `├ 1h: \`${fmtPct(gem.priceChange1h)}\`\n` +
      `└ 24h: \`${fmtPct(gem.priceChange24h)}\`\n\n` +

      `📊 *Transactions (24h)*\n` +
      (txnSection ? txnSection + '\n' : '') +
      safetySection +
      descSection +

      `\n📜 *Contract*\n` +
      `\`${gem.tokenAddress}\`\n\n` +

      `🔗 [DexScreener](${dexUrl}) | ` +
      `[Explorer](${explorerUrl})`

    const inlineKeyboard = {
      reply_markup: JSON.stringify({
        inline_keyboard: [
          [
            { text: `💰 Buy ${buyAmount} ${chainTicker}`, callback_data: `gem_buy_${gem.chain}_${gem.tokenAddress}_${buyAmount}` },
            { text: `💰 Buy ${buyAmount * 2} ${chainTicker}`, callback_data: `gem_buy_${gem.chain}_${gem.tokenAddress}_${buyAmount * 2}` },
          ],
          [
            { text: '📊 Price Check', callback_data: `gem_price_${gem.chain}_${gem.tokenAddress}` },
            { text: `🔍 ${gem.chain === 'bsc' ? 'BscScan' : gem.chain === 'eth' ? 'Etherscan' : gem.chain === 'base' ? 'BaseScan' : gem.chain === 'ton' ? 'TONScan' : 'Solscan'}`, url: explorerUrl },
          ],
          [
            { text: '📈 DexScreener', url: dexUrl },
          ],
        ],
      }),
    }

    try {
      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...inlineKeyboard,
      })

      // Log the alert
      await alertsRef.add({
        tokenAddress: gem.tokenAddress,
        tokenName:    gem.tokenName,
        tokenSymbol:  gem.tokenSymbol,
        chain:        gem.chain,
        score:        gem.gemScore,
        priceUsd:     gem.priceUsd,
        liquidity:    gem.liquidity,
        marketCap:    gem.marketCap || 0,
        alertedAt:    Date.now(),
        autoBought:   false,
        txHash:       null,
      })

      sentCount++
    } catch (err) {
      console.error(`Failed to send gem alert for ${gem.tokenSymbol}:`, err.message)
    }

    // Small delay between messages to avoid Telegram rate limits
    await new Promise(r => setTimeout(r, 500))
  }

  return sentCount
}

module.exports = {
  discoverGems,
  scoreToken,
  sendGemAlerts,
  formatGemCard,
  explorerTokenUrl,
  explorerTxUrl,
}

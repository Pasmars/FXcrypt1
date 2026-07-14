// Client-side gem scanner ported from the legacy bot.js.
// Discovers trending tokens from DexScreener, scores them, runs honeypot
// checks on EVM chains, and returns the top-scoring gems.

export const GEM_CHAIN_MAP: Record<string, string> = {
  bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base', ton: 'ton', matic: 'polygon', rhood: 'robinhood'
};
export const GEM_DEX_LABELS: Record<string, string> = {
  pancakeswap: 'PancakeSwap', pancakeswap_v3: 'PancakeSwap V3',
  raydium: 'Raydium', raydium_clmm: 'Raydium CLMM',
  orca: 'Orca', meteora: 'Meteora', pumpfun: 'Pump.fun',
  uniswap_v2: 'Uniswap V2', uniswap_v3: 'Uniswap V3',
  aerodrome: 'Aerodrome', baseswap: 'BaseSwap', baseswap_v3: 'BaseSwap V3',
  sushiswap: 'SushiSwap', swapbased: 'SwapBased', alienbase: 'AlienBase',
  dedust: 'DeDust', stonfi: 'STON.fi', megaton: 'Megaton Finance'
};

export interface Gem {
  chain: string; tokenAddress: string; tokenName: string; tokenSymbol: string;
  dexName: string; priceUsd: number; liquidity: number; volume24h: number;
  marketCap: number; priceChange5m: number; priceChange1h: number; priceChange24h: number;
  buys24h: number; sells24h: number; ageHours: number | null; gemScore: number;
  safety: any; boosted: boolean; icon: string | null; dexUrl: string;
}

export type GemSort = 'default' | 'score' | 'trending' | 'new' | 'gainers';
export interface GemConfig {
  chains: string[]; minLiquidity: number; maxAgeHours: number; minScore: number;
  narrative?: string; sort?: GemSort; minMarketCap?: number; maxMarketCap?: number;
  minVolume?: number; maxVolume?: number;
}

// ── Narratives: meme/theme buckets with search terms + match keywords ──────────
export interface Narrative { key: string; label: string; emoji: string; searchTerms: string[]; keywords: string[]; _re?: RegExp; }
export const NARRATIVES: Narrative[] = [
  { key: 'dog',    label: 'Dog',    emoji: '🐶', searchTerms: ['doge', 'shib', 'inu', 'dog', 'wif', 'floki', 'bonk'], keywords: ['dog', 'doge', 'shib', 'inu', 'puppy', 'wif', 'dogwif', 'floki', 'husky', 'corgi', 'akita', 'shiba', 'pup', 'woof', 'kabosu', 'samoyed', 'bonk', 'snoopy'] },
  { key: 'cat',    label: 'Cat',    emoji: '🐱', searchTerms: ['cat', 'popcat', 'kitty', 'meow', 'mew'], keywords: ['cat', 'kitty', 'meow', 'neko', 'feline', 'popcat', 'mew', 'garfield', 'kitten', 'catto', 'tom', 'purr'] },
  { key: 'frog',   label: 'Frog',   emoji: '🐸', searchTerms: ['pepe', 'frog', 'toad', 'kek'], keywords: ['frog', 'pepe', 'toad', 'ribbit', 'kek', 'kermit', 'croak', 'wojak', 'froge'] },
  { key: 'duck',   label: 'Duck',   emoji: '🦆', searchTerms: ['duck', 'quack', 'donald'], keywords: ['duck', 'quack', 'mallard', 'daffy', 'duckie', 'ducky'] },
  { key: 'bear',   label: 'Bear',   emoji: '🐻', searchTerms: ['bear', 'pooh', 'teddy', 'bera'], keywords: ['bear', 'grizzly', 'teddy', 'bruno', 'pooh', 'bera', 'beruh', 'paddington'] },
  { key: 'monkey', label: 'Monkey', emoji: '🐵', searchTerms: ['ape', 'monkey', 'kong', 'banana'], keywords: ['monkey', 'ape', 'kong', 'chimp', 'gorilla', 'banana', 'bonobo', 'mandrill', 'gmoon', 'baby ape'] },
  { key: 'fish',   label: 'Fish',   emoji: '🐟', searchTerms: ['fish', 'shark', 'whale'], keywords: ['fish', 'shark', 'whale', 'tuna', 'salmon', 'koi', 'dolphin', 'orca', 'fishy', 'nemo'] },
  { key: 'ai',     label: 'AI',     emoji: '🤖', searchTerms: ['ai', 'agent', 'gpt', 'grok'], keywords: ['ai', 'gpt', 'agent', 'neural', 'robot', 'llm', 'brain', 'intelligence', 'deepseek', 'grok', 'tao', 'fetch', 'autonomous', 'sentient', 'agentic'] }
];
const NAR_BY_KEY: Record<string, Narrative> = Object.fromEntries(NARRATIVES.map((n) => [n.key, n]));

function escRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function narrativeMatch(pair: any, key: string): boolean {
  const nar = NAR_BY_KEY[key];
  if (!nar) return true;
  if (!nar._re) nar._re = new RegExp(`\\b(${nar.keywords.map(escRe).join('|')})`, 'i');
  const text = `${pair.baseToken?.name || ''} ${pair.baseToken?.symbol || ''}`;
  return nar._re.test(text);
}

export function scoreGemToken(pair: any): number {
  let score = 0;
  const liq = pair.liquidity?.usd || 0;
  if (liq >= 5000 && liq <= 50000) score += 20;
  else if (liq > 50000 && liq <= 200000) score += 15;
  else if (liq > 200000 && liq <= 500000) score += 10;
  else if (liq > 500000) score += 5;
  else if (liq >= 2000) score += 8;

  const vol24 = pair.volume?.h24 || 0;
  if (liq > 0) {
    const vl = vol24 / liq;
    if (vl >= 3) score += 20; else if (vl >= 1.5) score += 16; else if (vl >= 0.5) score += 12; else if (vl >= 0.1) score += 6;
  }
  const ageH = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3.6e6 : 9999;
  if (ageH <= 1) score += 15; else if (ageH <= 6) score += 13; else if (ageH <= 24) score += 10; else if (ageH <= 72) score += 6; else if (ageH <= 168) score += 3;

  const m5 = pair.priceChange?.m5 || 0, h1 = pair.priceChange?.h1 || 0, h24 = pair.priceChange?.h24 || 0;
  if (m5 > 5) score += 5; else if (m5 > 0) score += 3;
  if (h1 > 20) score += 8; else if (h1 > 5) score += 5; else if (h1 > 0) score += 2;
  if (h24 > 50) score += 7; else if (h24 > 10) score += 5; else if (h24 > 0) score += 2;

  const buys = pair.txns?.h24?.buys || 0, sells = pair.txns?.h24?.sells || 0, total = buys + sells;
  if (total > 0) { const r = buys / total; if (r >= 0.65) score += 15; else if (r >= 0.55) score += 10; else if (r >= 0.45) score += 5; }

  if (pair.info?.websites?.length) score += 3;
  if (pair.info?.socials?.length) score += 3;
  if (pair.info?.imageUrl) score += 2;
  if (pair.info?.header) score += 2;
  return Math.min(100, Math.max(0, score));
}

export async function checkGemHoneypot(tokenAddress: string, chainID = 56) {
  try {
    const r = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${tokenAddress}&chainID=${chainID}`);
    const data = await r.json();
    const hp = data.honeypotResult || {}, sim = data.simulationResult || {};
    return {
      isHoneypot: hp.isHoneypot === true,
      buyTax: sim.buyTax != null ? parseFloat(sim.buyTax) : null,
      sellTax: sim.sellTax != null ? parseFloat(sim.sellTax) : null,
      riskLevel: hp.isHoneypot ? 'DANGER' : sim.sellTax > 10 ? 'HIGH' : sim.sellTax > 5 ? 'MEDIUM' : 'LOW'
    };
  } catch {
    return { isHoneypot: null, buyTax: null, sellTax: null, riskLevel: 'UNKNOWN' };
  }
}

const PAIR_CHAIN: Record<string, string> = { bsc: 'bsc', ethereum: 'eth', solana: 'sol', base: 'base', ton: 'ton', polygon: 'matic', robinhood: 'rhood' };

// ── GeckoTerminal (free, paginated — new pools + established/old pools) ───────
const GT_NET: Record<string, string> = { eth: 'eth', bsc: 'bsc', sol: 'solana', base: 'base', matic: 'polygon_pos', ton: 'ton' };
const GT_DS_CHAINID: Record<string, string> = { eth: 'ethereum', bsc: 'bsc', sol: 'solana', base: 'base', matic: 'polygon', ton: 'ton' };

function normalizeGtPool(pool: any, included: any[], dsChainId: string, net: string): any {
  const a = pool.attributes || {};
  const btId = pool.relationships?.base_token?.data?.id;
  const tok = btId ? included.find((x: any) => x.id === btId) : null;
  const addr = btId ? btId.substring(btId.indexOf('_') + 1) : '';
  const img = tok?.attributes?.image_url;
  const pc = a.price_change_percentage || {};
  const tx = a.transactions || {};
  return {
    chainId: dsChainId,
    baseToken: { address: addr, name: tok?.attributes?.name || (a.name || '').split(' / ')[0] || 'Unknown', symbol: tok?.attributes?.symbol || '' },
    priceUsd: a.base_token_price_usd || 0,
    liquidity: { usd: parseFloat(a.reserve_in_usd || 0) },
    volume: { h24: parseFloat(a.volume_usd?.h24 || 0) },
    marketCap: parseFloat(a.market_cap_usd || a.fdv_usd || 0),
    fdv: parseFloat(a.fdv_usd || 0),
    priceChange: { m5: +(pc.m5 || 0), h1: +(pc.h1 || 0), h6: +(pc.h6 || 0), h24: +(pc.h24 || 0) },
    txns: { h24: { buys: tx.h24?.buys || 0, sells: tx.h24?.sells || 0 }, h1: { buys: tx.h1?.buys || 0, sells: tx.h1?.sells || 0 } },
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    info: { imageUrl: img && !String(img).includes('missing') ? img : null },
    url: `https://www.geckoterminal.com/${net}/pools/${a.address}`,
    dexId: pool.relationships?.dex?.data?.id || 'geckoterminal'
  };
}

async function fetchGeckoTerminal(chains: string[], sort: GemSort, onStep: (s: string) => void): Promise<any[]> {
  const out: any[] = [];
  // new_pools = freshly created · pools = top/established (incl. multi-year-old) · trending = momentum.
  // Weight the page counts by the chosen Trend & Sort so discovery actually
  // favors the dimension the user asked for (more pages = wider coverage).
  let lists: [string, number][];
  if (sort === 'new') lists = [['new_pools', 4], ['trending_pools', 1], ['pools', 1]];
  else if (sort === 'trending') lists = [['trending_pools', 2], ['pools', 3], ['new_pools', 1]];
  else if (sort === 'gainers') lists = [['trending_pools', 2], ['pools', 2], ['new_pools', 1]];
  else lists = [['new_pools', 2], ['pools', 2], ['trending_pools', 1]]; // score = balanced
  for (const chain of chains) {
    const net = GT_NET[chain];
    if (!net) continue;
    const dsId = GT_DS_CHAINID[chain];
    for (const [path, pages] of lists) {
      for (let p = 1; p <= pages; p++) {
        onStep(`GeckoTerminal · ${chain.toUpperCase()} ${path.replace('_pools', '')} ${p}…`);
        try {
          const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/${path}?include=base_token&page=${p}`, { headers: { accept: 'application/json' } });
          if (!r.ok) break;
          const j = await r.json();
          const inc = j.included || [];
          for (const pool of (j.data || [])) out.push(normalizeGtPool(pool, inc, dsId, net));
        } catch {}
        await new Promise((r) => setTimeout(r, 260));
      }
    }
  }
  return out;
}

function sortGems(gems: Gem[], sort: GemSort) {
  if (sort === 'trending') gems.sort((a, b) => b.volume24h - a.volume24h);
  else if (sort === 'new') gems.sort((a, b) => (a.ageHours ?? 1e9) - (b.ageHours ?? 1e9));
  else if (sort === 'gainers') gems.sort((a, b) => b.priceChange24h - a.priceChange24h);
  else gems.sort((a, b) => b.gemScore - a.gemScore);
}

// Order scored candidates by the chosen Trend & Sort *before* the top-N cap,
// so the cap keeps the tokens that rank highest on the selected dimension
// (not always the highest score). Mirrors sortGems but works on raw pairs.
type ScoredCandidate = { addr: string; pair: any; chain: string; score: number };
function pairAgeHours(p: any) { return p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3.6e6 : 1e9; }
function sortCandidates(arr: ScoredCandidate[], sort: GemSort) {
  if (sort === 'trending') arr.sort((a, b) => (b.pair.volume?.h24 || 0) - (a.pair.volume?.h24 || 0));
  else if (sort === 'new') arr.sort((a, b) => pairAgeHours(a.pair) - pairAgeHours(b.pair));
  else if (sort === 'gainers') arr.sort((a, b) => (b.pair.priceChange?.h24 || 0) - (a.pair.priceChange?.h24 || 0));
  else arr.sort((a, b) => b.score - a.score);
}

export async function scanGems(cfg: GemConfig, onStep: (s: string) => void): Promise<Gem[]> {
  const { chains, minLiquidity, maxAgeHours, minScore, narrative = 'all', sort = 'score', minMarketCap = 0, maxMarketCap = 0, minVolume = 0, maxVolume = 0 } = cfg;
  const allPairs: any[] = [];
  const boostedSet = new Set<string>();
  const iconMap = new Map<string, string>();

  // 'all' and 'default' are both narrative-agnostic (no name/symbol filtering);
  // only a specific narrative key triggers the themed keyword search below.
  const useNarrative = !!narrative && narrative !== 'all' && narrative !== 'default';

  if (useNarrative) {
    // ── Narrative search: query DexScreener search for each theme term ──
    const nar = NAR_BY_KEY[narrative];
    const terms = nar?.searchTerms || [narrative];
    for (const term of terms) {
      onStep(`${nar?.emoji || '🔎'} Searching "${term}" tokens…`);
      try {
        const data = await (await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`)).json();
        if (Array.isArray(data?.pairs)) allPairs.push(...data.pairs);
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    // ── Trending discovery: DexScreener profiles + boosts → pair data ──
    const tokenMap = new Map<string, any>();
    const ingest = (data: any, boosted: boolean) => {
      if (!Array.isArray(data)) return;
      for (const t of data) for (const chain of chains) {
        if (t.chainId === GEM_CHAIN_MAP[chain] && t.tokenAddress) {
          const key = t.tokenAddress.toLowerCase();
          if (tokenMap.has(key)) { if (boosted) tokenMap.get(key).boosted = true; }
          else tokenMap.set(key, { address: t.tokenAddress, chain, icon: t.icon || '', boosted });
        }
      }
    };
    onStep('Fetching DexScreener latest profiles…');
    try { ingest(await (await fetch('https://api.dexscreener.com/token-profiles/latest/v1')).json(), false); } catch {}
    onStep('Fetching boosted tokens…');
    try { ingest(await (await fetch('https://api.dexscreener.com/token-boosts/latest/v1')).json(), true); } catch {}
    onStep('Fetching top boosted tokens…');
    try { ingest(await (await fetch('https://api.dexscreener.com/token-boosts/top/v1')).json(), true); } catch {}

    const allTokens = Array.from(tokenMap.values());
    for (const t of allTokens) { const a = t.address.toLowerCase(); if (t.boosted) boostedSet.add(a); if (t.icon) iconMap.set(a, t.icon); }

    const addresses = allTokens.map((t) => t.address);
    onStep(`Found ${allTokens.length} trending tokens. Fetching pair data…`);
    for (let i = 0; i < addresses.length; i += 30) {
      onStep(`Fetching pairs ${i + 1}–${Math.min(i + 30, addresses.length)} of ${addresses.length}…`);
      try {
        const data = await (await fetch('https://api.dexscreener.com/latest/dex/tokens/' + addresses.slice(i, i + 30).join(','))).json();
        if (data.pairs) allPairs.push(...data.pairs);
      } catch {}
      if (i + 30 < addresses.length) await new Promise((r) => setTimeout(r, 350));
    }

    // Broaden the net with discovery terms. 'default' is purely parameter-driven
    // (generic terms only — no narrative bias); 'all' additionally sweeps the meme
    // themes so it surfaces the most narrative tokens. GeckoTerminal's
    // new/top/trending pools above already give narrative-agnostic coverage.
    const GENERIC_TERMS = ['sol', 'base', 'eth', 'bnb', 'usdt', 'usdc', 'btc', 'token', 'protocol', 'finance', 'swap', 'chain', 'dao', 'defi', 'gaming', 'rwa'];
    const MEME_TERMS = ['pepe', 'doge', 'cat', 'ai', 'inu', 'meme', 'pump', 'moon'];
    const BROAD = narrative === 'all' ? [...MEME_TERMS, ...GENERIC_TERMS] : GENERIC_TERMS;
    for (const term of BROAD) {
      onStep(`Scanning "${term}" tokens…`);
      try {
        const d = await (await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`)).json();
        if (Array.isArray(d?.pairs)) allPairs.push(...d.pairs);
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // ── GeckoTerminal: paginated new + established pools (much larger pool) ──
  try { allPairs.push(...await fetchGeckoTerminal(chains, sort, onStep)); } catch {}

  // ── Best pair per token on the selected chains, with filters ──
  onStep(`Scoring ${allPairs.length} pairs…`);
  const bestPairs = new Map<string, any>();
  for (const pair of allPairs) {
    const pairChain = PAIR_CHAIN[pair.chainId];
    if (!pairChain || !chains.includes(pairChain)) continue;
    if (useNarrative && !narrativeMatch(pair, narrative)) continue;
    const addr = (pair.baseToken?.address || '').toLowerCase();
    const liq = pair.liquidity?.usd || 0;
    if (liq < minLiquidity) continue;
    // 24h volume range (allows hunting low-volume gems)
    const vol = pair.volume?.h24 || 0;
    if (minVolume && vol < minVolume) continue;
    if (maxVolume && vol > maxVolume) continue;
    // Market-cap range (uses marketCap, falls back to FDV)
    const mcap = pair.marketCap || pair.fdv || 0;
    if (minMarketCap && mcap < minMarketCap) continue;
    if (maxMarketCap && mcap > maxMarketCap) continue;
    // Age — apply the window only when the pair's creation time is known
    // (many DexScreener results omit pairCreatedAt; don't drop those).
    if (pair.pairCreatedAt && (Date.now() - pair.pairCreatedAt) / 3.6e6 > maxAgeHours) continue;
    const existing = bestPairs.get(addr);
    if (!existing || liq > (existing.pair.liquidity?.usd || 0)) bestPairs.set(addr, { pair, chain: pairChain });
  }

  // Pre-score everything, drop below threshold, then cap candidates. The cap is
  // ordered by the chosen Trend & Sort (not always score) so picking Newest /
  // Trending / Top Gainers actually surfaces those tokens instead of just
  // re-ordering the highest-scoring ones at the end.
  const scored: ScoredCandidate[] = [...bestPairs.entries()]
    .map(([addr, v]) => ({ addr, pair: v.pair, chain: v.chain, score: scoreGemToken(v.pair) }))
    .filter((c) => c.score >= minScore);
  sortCandidates(scored, sort);
  const candidates = scored.slice(0, 60);

  const gems: Gem[] = [];
  let hp = 0;
  for (const { addr, pair, chain, score: gemScore } of candidates) {
    let safety: any = { riskLevel: 'N/A' };
    if (chain === 'bsc' || chain === 'eth') {
      hp++; onStep(`Honeypot check ${hp}… (${pair.baseToken?.symbol || '…'})`);
      safety = await checkGemHoneypot(pair.baseToken?.address || addr, chain === 'eth' ? 1 : 56);
      if (safety.isHoneypot === true) continue;
      if (safety.sellTax != null && safety.sellTax > 15) continue;
    } else if (chain === 'base' || chain === 'ton' || chain === 'rhood') safety = { riskLevel: 'UNVERIFIED' }; // no honeypot simulator covers these chains yet

    const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3.6e6 : null;
    gems.push({
      chain, tokenAddress: pair.baseToken?.address || addr,
      tokenName: pair.baseToken?.name || 'Unknown', tokenSymbol: pair.baseToken?.symbol || '???',
      dexName: GEM_DEX_LABELS[pair.dexId] || pair.dexId,
      priceUsd: parseFloat(pair.priceUsd || 0), liquidity: pair.liquidity?.usd || 0, volume24h: pair.volume?.h24 || 0,
      marketCap: pair.marketCap || pair.fdv || 0,
      priceChange5m: pair.priceChange?.m5 || 0, priceChange1h: pair.priceChange?.h1 || 0, priceChange24h: pair.priceChange?.h24 || 0,
      buys24h: pair.txns?.h24?.buys || 0, sells24h: pair.txns?.h24?.sells || 0,
      ageHours: ageHours ? parseFloat(ageHours.toFixed(1)) : null,
      gemScore, safety, boosted: boostedSet.has(addr), icon: iconMap.get(addr) || pair.info?.imageUrl || null, dexUrl: pair.url || ''
    });
  }
  sortGems(gems, sort);
  return gems.slice(0, 50);
}

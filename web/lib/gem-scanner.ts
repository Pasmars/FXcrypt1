// Client-side gem scanner ported from the legacy bot.js.
// Discovers trending tokens from DexScreener, scores them, runs honeypot
// checks on EVM chains, and returns the top-scoring gems.

export const GEM_CHAIN_MAP: Record<string, string> = {
  bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base', ton: 'ton', matic: 'polygon'
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

export interface GemConfig { chains: string[]; minLiquidity: number; maxAgeHours: number; minScore: number; }

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

const PAIR_CHAIN: Record<string, string> = { bsc: 'bsc', ethereum: 'eth', solana: 'sol', base: 'base', ton: 'ton', polygon: 'matic' };

export async function scanGems(cfg: GemConfig, onStep: (s: string) => void): Promise<Gem[]> {
  const { chains, minLiquidity, maxAgeHours, minScore } = cfg;
  const tokenMap = new Map<string, any>();

  const ingest = (data: any, boosted: boolean) => {
    if (!Array.isArray(data)) return;
    for (const t of data) {
      for (const chain of chains) {
        if (t.chainId === GEM_CHAIN_MAP[chain] && t.tokenAddress) {
          const key = t.tokenAddress.toLowerCase();
          if (tokenMap.has(key)) { if (boosted) tokenMap.get(key).boosted = true; }
          else tokenMap.set(key, { address: t.tokenAddress, chain, icon: t.icon || '', links: t.links || [], boosted });
        }
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
  if (!allTokens.length) return [];

  onStep(`Found ${allTokens.length} tokens. Fetching pair data…`);
  const addresses = allTokens.map((t) => t.address);
  const allPairs: any[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    onStep(`Fetching pairs ${i + 1}–${Math.min(i + 30, addresses.length)} of ${addresses.length}…`);
    try {
      const data = await (await fetch('https://api.dexscreener.com/latest/dex/tokens/' + addresses.slice(i, i + 30).join(','))).json();
      if (data.pairs) allPairs.push(...data.pairs);
    } catch {}
    if (i + 30 < addresses.length) await new Promise((r) => setTimeout(r, 350));
  }

  onStep(`Got ${allPairs.length} pairs. Scoring & filtering…`);
  const bestPairs = new Map<string, any>();
  for (const pair of allPairs) {
    const pairChain = PAIR_CHAIN[pair.chainId];
    if (!pairChain || !chains.includes(pairChain)) continue;
    const addr = (pair.baseToken?.address || '').toLowerCase();
    const liq = pair.liquidity?.usd || 0;
    if (liq < minLiquidity) continue;
    if ((pair.volume?.h24 || 0) < 1000) continue;
    if (pair.pairCreatedAt && (Date.now() - pair.pairCreatedAt) / 3.6e6 > maxAgeHours) continue;
    const existing = bestPairs.get(addr);
    if (!existing || liq > (existing.pair.liquidity?.usd || 0)) bestPairs.set(addr, { pair, chain: pairChain });
  }

  const gems: Gem[] = [];
  let hp = 0;
  for (const [addr, { pair, chain }] of bestPairs.entries()) {
    const gemScore = scoreGemToken(pair);
    if (gemScore < minScore) continue;
    let safety: any = { riskLevel: 'N/A' };
    if (chain === 'bsc' || chain === 'eth') {
      hp++; onStep(`Honeypot check ${hp}… (${pair.baseToken?.symbol || '…'})`);
      safety = await checkGemHoneypot(pair.baseToken?.address || addr, chain === 'eth' ? 1 : 56);
      if (safety.isHoneypot === true) continue;
      if (safety.sellTax != null && safety.sellTax > 15) continue;
    } else if (chain === 'base' || chain === 'ton') safety = { riskLevel: 'UNVERIFIED' };

    const meta = tokenMap.get(addr) || {};
    const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3.6e6 : null;
    gems.push({
      chain, tokenAddress: pair.baseToken?.address || addr,
      tokenName: pair.baseToken?.name || 'Unknown', tokenSymbol: pair.baseToken?.symbol || '???',
      dexName: GEM_DEX_LABELS[pair.dexId] || pair.dexId,
      priceUsd: parseFloat(pair.priceUsd || 0), liquidity: liqOf(pair), volume24h: pair.volume?.h24 || 0,
      marketCap: pair.marketCap || pair.fdv || 0,
      priceChange5m: pair.priceChange?.m5 || 0, priceChange1h: pair.priceChange?.h1 || 0, priceChange24h: pair.priceChange?.h24 || 0,
      buys24h: pair.txns?.h24?.buys || 0, sells24h: pair.txns?.h24?.sells || 0,
      ageHours: ageHours ? parseFloat(ageHours.toFixed(1)) : null,
      gemScore, safety, boosted: !!meta.boosted, icon: meta.icon || pair.info?.imageUrl || null, dexUrl: pair.url || ''
    });
  }
  gems.sort((a, b) => b.gemScore - a.gemScore);
  return gems.slice(0, 50);
}

function liqOf(pair: any) { return pair.liquidity?.usd || 0; }

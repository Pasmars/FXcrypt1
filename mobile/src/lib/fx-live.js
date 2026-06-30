// fx-live.js — live data layer. Fetches real market/portfolio/signal data and
// merges it into window.FX (the shape the design screens already read), then
// dispatches a 'fx:update' event so the app re-renders. Keeps the design's
// fallback data for anything a source doesn't cover.
import { db } from './firebase';
import { auth } from './firebase';
import { collection, getDocs, query, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import {
  callGetCexBalances,
  callGetBalances,
} from './functions';

const CG = 'https://api.coingecko.com/api/v3';

// Native-chain hint for the logo chain badge (cosmetic; most coins have none).
const CHAIN_HINT = {
  SOL: 'sol', ETH: 'eth', BNB: 'bsc', POL: 'poly', MATIC: 'poly',
  WIF: 'sol', BONK: 'sol', POPCAT: 'sol', JUP: 'sol', JTO: 'sol', PYTH: 'sol',
  PEPE: 'eth', SHIB: 'eth', LINK: 'eth', UNI: 'eth', AAVE: 'eth', ARB: 'arb', OP: 'eth',
  CAKE: 'bsc',
};

// deterministic logo color from a symbol (design used hand-picked hex dots)
function colorFor(sym) {
  let h = 0; const s = String(sym || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const r = 80 + (h & 0x7f), g = 80 + ((h >> 8) & 0x7f), b = 80 + ((h >> 16) & 0x7f);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fmtBig(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(0) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
}

// downsample a long price series to ~n points for the sparkline
function downsample(arr, n) {
  if (!arr || !arr.length) return null;
  if (arr.length <= n) return arr.slice();
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function emit() {
  try { window.dispatchEvent(new CustomEvent('fx:update')); } catch (e) {}
}

// ─── Live market list (no auth needed) → window.FX.tokens (top ~100 by mcap) ───
const FAV_DEFAULT = new Set(['btc', 'eth', 'sol', 'bnb']);
async function refreshMarkets() {
  try {
    const res = await fetch(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h&sparkline=true`);
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return;
    // preserve any tokens the user had favourited across refreshes
    const prevFav = new Set((window.FX.tokens || []).filter((t) => t.fav).map((t) => t.sym));
    window.FX.tokens = rows.map((r) => {
      const sym = (r.symbol || '').toUpperCase();
      return {
        id: r.id,
        sym,
        name: r.name,
        chain: CHAIN_HINT[sym],
        price: r.current_price ?? 0,
        ch24: r.price_change_percentage_24h != null ? +r.price_change_percentage_24h.toFixed(2) : 0,
        mcap: r.market_cap != null ? fmtBig(r.market_cap) : '—',
        vol: r.total_volume != null ? fmtBig(r.total_volume) : '—',
        liq: '—',
        holders: '—',
        logo: colorFor(sym),
        img: r.image || null,
        spark: downsample(r.sparkline_in_7d && r.sparkline_in_7d.price, 32) || [],
        fav: prevFav.has(sym) || FAV_DEFAULT.has((r.symbol || '').toLowerCase()),
        cg: r.id,
        live: true,
      };
    });
    // apply fresh prices to wallet holdings + recompute USD value
    if (window.FX.holdings) {
      const px = {};
      window.FX.tokens.forEach((t) => { px[t.sym] = t.price; });
      window.FX.holdings = window.FX.holdings.map((h) => {
        const p = px[h.sym] ?? h.price;
        const amt = parseFloat(String(h.amount).replace(/[, ]/g, '').replace(/M$/, 'e6').replace(/K$/, 'e3')) || 0;
        return { ...h, price: p, value: amt ? amt * p : h.value, ch24: (window.FX.tokens.find((t) => t.sym === h.sym) || {}).ch24 ?? h.ch24 };
      });
    }
    emit();
  } catch (e) { /* keep fallback */ }
}

// ─── Live cross-chain token search (DexScreener) ───────────────────────────
// Powers the Markets search box: finds ANY coin/token in the market by name,
// symbol, or contract address across all chains — not just the top-100 list.
const DS_CHAIN = { solana: 'sol', ethereum: 'eth', bsc: 'bsc', base: 'base', polygon: 'poly', arbitrum: 'arb' };

function seedFrom(str) {
  let h = 0; const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
// DexScreener has no price series, so synthesize a sparkline (seeded by the
// token so it's stable) — keeps the list + detail charts from breaking.
function synthSpark(seed, up) {
  const out = []; let v = 50; let s = seed >>> 0;
  for (let i = 0; i < 32; i++) {
    s = (s * 9301 + 49297) % 233280;
    v += (s / 233280 - 0.5) * 14 + (up ? 1.7 : -1.7);
    v = Math.max(8, Math.min(92, v));
    out.push(v);
  }
  return out;
}

async function searchTokens(qRaw) {
  const q = String(qRaw || '').trim();
  if (q.length < 2) return [];
  let pairs = [];
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    pairs = Array.isArray(data && data.pairs) ? data.pairs : [];
  } catch (e) { return []; }
  // Keep the deepest-liquidity pair per token (one row per chain+contract).
  const best = {};
  for (const p of pairs) {
    const addr = p.baseToken && p.baseToken.address;
    if (!addr) continue;
    const k = `${p.chainId}:${addr.toLowerCase()}`;
    if (!best[k] || (p.liquidity?.usd || 0) > (best[k].liquidity?.usd || 0)) best[k] = p;
  }
  return Object.values(best)
    // Rank by 24h volume (active trading = relevance), liquidity as tiebreaker.
    // Sorting by liquidity alone floats spoofed-liquidity junk pairs to the top.
    .sort((a, b) => ((b.volume?.h24 || 0) - (a.volume?.h24 || 0)) || ((b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)))
    .slice(0, 24)
    .map((p) => {
      const sym = (p.baseToken.symbol || '').toUpperCase();
      const ch24 = p.priceChange && p.priceChange.h24 != null ? +Number(p.priceChange.h24).toFixed(2) : 0;
      return {
        id: `ds:${p.chainId}:${p.baseToken.address}`,
        sym,
        name: p.baseToken.name || sym,
        chain: DS_CHAIN[p.chainId] || p.chainId,
        price: p.priceUsd != null ? parseFloat(p.priceUsd) : 0,
        ch24,
        mcap: (p.marketCap ?? p.fdv) != null ? fmtBig(p.marketCap ?? p.fdv) : '—',
        vol: p.volume && p.volume.h24 != null ? fmtBig(p.volume.h24) : '—',
        liq: p.liquidity && p.liquidity.usd != null ? fmtBig(p.liquidity.usd) : '—',
        holders: '—',
        logo: colorFor(sym),
        img: (p.info && p.info.imageUrl) || null,
        spark: synthSpark(seedFrom(sym + p.baseToken.address), ch24 >= 0),
        fav: false,
        tokenAddress: p.baseToken.address,
        chainId: p.chainId,
        dexUrl: p.url || null,
        live: true,
        market: true, // sourced from a live market search (not the curated list)
      };
    });
}

// ─── Per-timeframe price series for token charts ───────────────────────────
// Real history from CoinGecko for listed coins; a deterministic synthetic
// series (varied by timeframe) for on-chain tokens CoinGecko doesn't index.
const TF_DAYS = { '15m': 1, '1H': 7, '4H': 14, '1D': 90, '1W': 365 };
const _seriesCache = new Map(); // key `${cg}:${tf}` → { at, data }
async function fetchSeries(token, tf) {
  const days = TF_DAYS[tf] || 30;
  const cg = token && (token.cg || (token.live && token.id));
  if (cg && !token.market) {
    const key = `${cg}:${tf}`;
    const hit = _seriesCache.get(key);
    if (hit && Date.now() - hit.at < 120000) return hit.data;
    try {
      const res = await fetch(`${CG}/coins/${cg}/market_chart?vs_currency=usd&days=${days}`);
      if (res.ok) {
        const j = await res.json();
        const prices = (j.prices || []).map((p) => p[1]).filter((v) => v != null);
        const data = downsample(prices, 48) || [];
        if (data.length > 1) { _seriesCache.set(key, { at: Date.now(), data }); return data; }
      }
    } catch (e) { /* fall through to synthetic */ }
  }
  // Synthetic fallback: stable per token+timeframe so the control visibly responds.
  const seed = seedFrom((token.sym || '') + (token.address || token.tokenAddress || '') + tf);
  return synthSpark(seed + days, (token.ch24 ?? 0) >= 0);
}

// ─── Auth-gated: on-chain wallet balances → window.FX.holdings ───
// Simple data fetch via getBalances (the bot wallet's native balance per chain).
// No unlock UX — the backend reads balances from the saved wallet addresses.
const NATIVE = {
  sol:  { sym: 'SOL', name: 'Solana',   cg: 'solana',          logo: '#14F195' },
  eth:  { sym: 'ETH', name: 'Ethereum', cg: 'ethereum',        logo: '#627EEA' },
  bsc:  { sym: 'BNB', name: 'BNB Chain', cg: 'binancecoin',    logo: '#F0B90B' },
  base: { sym: 'ETH', name: 'Base',     cg: 'ethereum',        logo: '#0052FF' },
  ton:  { sym: 'TON', name: 'TON',      cg: 'the-open-network', logo: '#0098EA' },
};
async function refreshWallet() {
  if (!auth.currentUser) return;
  try {
    const data = (await callGetBalances({})).data || {};
    const bals = data.balances || {};
    const ids = [...new Set(Object.keys(bals).map((c) => NATIVE[c] && NATIVE[c].cg).filter(Boolean))].join(',');
    let px = {};
    if (ids) {
      try { px = await (await fetch(`${CG}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`)).json(); }
      catch (e) { px = {}; }
    }
    const holdings = [];
    for (const [chain, b] of Object.entries(bals)) {
      const meta = NATIVE[chain];
      if (!meta || !b || b.error) continue;
      const amt = parseFloat(b.native) || 0;
      if (amt <= 0) continue;
      const q = px[meta.cg] || {};
      const price = q.usd != null ? q.usd : 0;
      holdings.push({
        sym: meta.sym, name: meta.name, chain,
        amount: amt < 1 ? amt.toFixed(4) : amt.toFixed(3),
        price, value: amt * price,
        ch24: q.usd_24h_change != null ? +q.usd_24h_change.toFixed(2) : 0,
        logo: meta.logo, live: true,
      });
    }
    if (holdings.length) { window.FX.holdings = holdings; emit(); }
  } catch (e) { /* no bot wallet / keep fallback */ }
}

// ─── Auth-gated: CEX exchange balances → window.FX.exchanges ───
async function refreshExchanges() {
  try {
    const data = (await callGetCexBalances({})).data || {};
    const bals = data.balances || {};
    if (window.FX.exchanges) {
      window.FX.exchanges = window.FX.exchanges.map((ex) => {
        const b = bals[ex.id];
        if (b == null) return { ...ex, connected: false, bal: '', perms: ex.perms };
        const total = typeof b === 'object' ? (b.totalUsd ?? b.total ?? 0) : b;
        return { ...ex, connected: true, bal: '$' + fmtBig(total) };
      });
      emit();
    }
  } catch (e) { /* not connected / no keys */ }
}

// ─── Auth-gated: agent-generated CEX signals → window.FX.signals ───
async function refreshSignals() {
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;
  try {
    let docs;
    try { docs = (await getDocs(query(collection(db, 'users', uid, 'signals'), orderBy('generatedAt', 'desc'), limit(40)))).docs; }
    catch { docs = (await getDocs(query(collection(db, 'users', uid, 'signals'), limit(40)))).docs; }
    if (!docs.length) return; // keep design samples if user has none yet
    // Map the persisted signal (from signal-generator.js) into the UI shape.
    // The backend stores bias / tp1-3 / lowercase exchange / setup — translate
    // those to the design's dir / tp[] / display-name / tags so cards, the chart
    // and the exchange filters all render correctly.
    const exMap = { binance: 'Binance', bybit: 'Bybit', mexc: 'MEXC', kucoin: 'KuCoin', okx: 'OKX', kraken: 'Kraken' };
    const fmtPrice = (n) => {
      const x = typeof n === 'number' ? n : parseFloat(n);
      if (!isFinite(x)) return '—';
      if (x >= 1000) return x.toLocaleString('en-US', { maximumFractionDigits: 2 });
      if (x >= 1) return x.toFixed(4);
      if (x >= 0.01) return x.toFixed(6);
      return x.toFixed(8);
    };
    window.FX.signals = docs.map((d) => {
      const s = d.data();
      const tpsRaw = Array.isArray(s.takeProfits) ? s.takeProfits
        : Array.isArray(s.tp) ? s.tp
        : [s.tp1, s.tp2, s.tp3].filter((v) => v != null);
      const biasStr = String(s.bias ?? s.direction ?? s.side ?? 'long').toLowerCase();
      const exRaw = String(s.exchange ?? s.ex ?? 'binance');
      return {
        id: d.id,
        pair: s.pair || s.symbol || '—',
        dir: biasStr === 'short' ? 'SHORT' : 'LONG',
        conf: Math.round(s.confidence ?? s.score ?? 0),
        entry: fmtPrice(s.entry ?? s.entryPrice),
        sl: fmtPrice(s.stopLoss ?? s.sl),
        tp: tpsRaw.map(fmtPrice),
        rr: String(s.riskReward ?? s.rr ?? '—'),
        tf: s.timeframe || s.tf || '4H',
        ex: exMap[exRaw.toLowerCase()] || exRaw,
        tags: (s.tags && s.tags.length) ? s.tags : (s.reasons && s.reasons.length) ? s.reasons : (s.setup ? String(s.setup).split(' + ') : []),
        // Separate spot vs futures from the authoritative marketType field, with
        // an explicit type / leverage fallback for older signal docs. The Signals
        // screen's Spot/Futures filter compares against this exact label.
        type: (() => {
          const mt = String(s.marketType ?? s.type ?? '').toLowerCase();
          if (mt === 'futures' || mt === 'perp' || mt === 'perpetual') return 'Futures';
          if (mt === 'spot') return 'Spot';
          return s.leverage ? 'Futures' : 'Spot';
        })(),
        lev: s.leverage ? s.leverage + 'x' : '—',
        live: true,
      };
    });
    emit();
  } catch (e) { /* keep fallback */ }
}

// ─── Auth-gated: profile identity → window.FX.user ───
async function refreshProfile() {
  const u = auth.currentUser;
  if (!u) return;
  try {
    const snap = await getDoc(doc(db, 'users', u.uid));
    const p = snap.exists() ? snap.data() : {};
    // Real subscription plan (server-set). Treat an expired plan as free.
    const expired = p.planExpiry && p.planExpiry < Date.now();
    window.FX.plan = (!p.plan || expired) ? 'free' : p.plan;
    window.FX.planExpiry = p.planExpiry || null;
    const name = `${p.firstName || ''} ${p.lastName || ''}`.trim() || u.displayName || (u.email ? u.email.split('@')[0] : 'Trader');
    const initials = (((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || '')).toUpperCase() || (u.email || 'A')[0].toUpperCase();
    window.FX.user = { name, email: u.email || p.email || '', initials };
    // Real deposit addresses (public) from the configured wallet — used by Receive.
    const wallets = (p.botSettings && p.botSettings.wallets) || {};
    const addrs = {};
    for (const [chain, w] of Object.entries(wallets)) if (w && w.address) addrs[chain] = w.address;
    window.FX.addresses = addrs;
    emit();
  } catch (e) {}
}

window.FXLive = {
  refreshMarkets,
  searchTokens,
  fetchSeries,
  refreshWallet,
  refreshExchanges,
  refreshSignals,
  refreshProfile,
  // called once the user is authenticated
  bootstrapUser: async () => {
    await Promise.allSettled([refreshProfile(), refreshWallet(), refreshSignals(), refreshExchanges()]);
  },
};

// Market data needs no auth — start fetching immediately and on a 60s interval.
// Pause the interval while the tab is hidden to save bandwidth and battery.
refreshMarkets();
let _marketsTimer = setInterval(refreshMarkets, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(_marketsTimer);
  } else {
    refreshMarkets();
    _marketsTimer = setInterval(refreshMarkets, 60000);
  }
});

export {};

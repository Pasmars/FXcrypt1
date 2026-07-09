// fx-api.js — bridges the ported design screens to the real callable Cloud
// Functions (unchanged backend in europe-west1). Exposed on window.FXAPI so the
// window-global design modules can call live endpoints. Extend this as more
// screens are wired (wallet balances, gem scanner, bot/agent, exchanges…).
import {
  callChatPointer,
  callExecuteTrade,
  callGetBalances,
  callGetBotInfo,
  callGetHolderGraph,
  callScanGems,
  callGetCexBalances,
  callSaveCexApiKey,
  callRemoveCexApiKey,
  callGenerateTelegramCode,
  callGenerateDiscordCode,
  callApproveTrade,
  callSkipSignal,
  callRunAgentScan,
  callGetPlans,
  callCreateCryptoInvoice,
  callVerifyCryptoPayment,
  callGetPointerUsage,
  callGetSignalStats,
  callGetSignalOutcomes,
  callGetGemStats,
  callGetGemOutcomes,
  callSavePriceAlert,
  callGetReferralInfo,
  callGetCopyFeed,
  callGetCopyLeaderboard,
  callTrackFunnel,
} from './functions';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, query, where, orderBy, limit } from 'firebase/firestore';

// ── Gem age unit conversion ──
// The backend filters by hours; the UI lets users pick hours/days/weeks/months/
// years. Months = 30d, years = 365d. Stored canonically in hours + the picked
// amount/unit so the settings sheet shows exactly what the user chose.
const AGE_UNIT_HOURS = { hours: 1, days: 24, weeks: 168, months: 720, years: 8760 };
// Derive a clean { amount, unit } from an hours value, preferring the largest
// unit it divides into evenly (falls back to the given unit, rounded).
function hoursToAge(hours, fallbackUnit) {
  const h = Math.max(0, parseInt(hours) || 0);
  if (h > 0) {
    for (const u of ['years', 'months', 'weeks', 'days', 'hours']) {
      const m = AGE_UNIT_HOURS[u];
      if (h >= m && h % m === 0) return { amount: h / m, unit: u, hours: h };
    }
  }
  const m = AGE_UNIT_HOURS[fallbackUnit] || 1;
  return { amount: h ? Math.max(1, Math.round(h / m)) : 0, unit: fallbackUnit || 'hours', hours: h };
}
// Read a stored age field, preferring the explicit amount+unit when present.
function readAge(bs, hoursKey, defHours, defUnit) {
  const unit = AGE_UNIT_HOURS[bs[hoursKey + 'Unit']] ? bs[hoursKey + 'Unit'] : null;
  const amount = bs[hoursKey + 'Amount'];
  if (unit && amount != null) {
    const a = Math.max(0, parseInt(amount) || 0);
    return { amount: a, unit, hours: a * AGE_UNIT_HOURS[unit] };
  }
  return hoursToAge(bs[hoursKey] != null ? bs[hoursKey] : defHours, defUnit);
}
function gemSettingsDefault() {
  const minA = hoursToAge(0, 'hours'), maxA = hoursToAge(24, 'days');
  return {
    minLiquidity: 5000, minVolume: 1000, minMarketCap: 0, minScore: 60, sort: 'score',
    minAgeAmount: minA.amount, minAgeUnit: minA.unit, minAgeHours: minA.hours,
    maxAgeAmount: maxA.amount, maxAgeUnit: maxA.unit, maxAgeHours: maxA.hours,
    // Auto-execute (gem trading bot) config — per-chain native buy size + slippage.
    buyAmountBsc: 0.005, buyAmountEth: 0.01, buyAmountSol: 0.05, buySlippage: 10,
    // Exit defaults armed on every auto-bought position (0 = rule off).
    exitTp: 100, exitSl: 30, exitTrail: 0, exitMaxHold: 0,
    // Chains the Telegram auto-alert scheduler (processGemScanner) scans + sends.
    telegramChains: [...TG_GEM_CHAINS],
  };
}

// Chains the Telegram gem-alert scheduler can cover. Matches the scanner's
// supported chains (no TON — the gem scanner doesn't index it).
const TG_GEM_CHAINS = ['bsc', 'eth', 'sol', 'base'];
// Sanitize a chain list → an ordered, deduped subset of the supported chains;
// falls back to all when nothing valid is selected (an empty list would silently
// disable the scheduler, which is never what a user means by "save").
function cleanTgChains(list) {
  const set = new Set((Array.isArray(list) ? list : []).map((c) => String(c).toLowerCase()));
  const picked = TG_GEM_CHAINS.filter((c) => set.has(c));
  return picked.length ? picked : [...TG_GEM_CHAINS];
}

function big(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
}
function age(hours) {
  if (hours == null) return '—';
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + 'm';
  if (hours < 48) return Math.round(hours) + 'h';
  return Math.round(hours / 24) + 'd';
}
// Classify a token across the full spectrum of blockchain narratives from its
// name/symbol/description keywords. The scan itself is narrative-agnostic ("All"
// is a general on-chain sweep); this only labels each result so users can slice
// the general scan by any narrative. Order = most-specific first; the first
// matching bucket wins, with 'New' as the catch-all for the unclassifiable.
// Keep these labels in sync with the GemScanner narrative chips (trade.jsx).
const NARRATIVE_RULES = [
  ['AI',       /\b(ai|agi|gpt|llm|agent|agentic|neural|inference|deepseek|grok|tao|sentient|machine|robot|brain|deep ?learn)\b/],
  ['DePIN',    /\b(depin|infra(structure)?|node|wireless|sensor|bandwidth|gpu|render|helium|mobility|hotspot|edge ?compute)\b/],
  ['RWA',      /\b(rwa|real ?world|treasur|t-?bill|tokeniz(e|ed|ation)|estate|equit|bond|commodit|invoice|carbon|gold|silver)\b/],
  ['GameFi',   /\b(game ?fi|gamefi|gaming|p2e|play ?to ?earn|metaverse|guild|quest|arena|rpg|mmo|nft ?game)\b/],
  ['SocialFi', /\b(social ?fi|socialfi|creator|fan ?token|tribe|friend ?tech|content)\b/],
  ['Layer',    /\b(l1|l2|layer ?[12]|rollup|zk|zero ?knowledge|modular|appchain|sidechain|scaling|restak)\b/],
  ['Payments', /\b(payment|stable ?coin|remit|merchant|on ?ramp|neobank)\b/],
  ['DeFi',     /\b(defi|dex|amm|swap|lend|borrow|yield|vault|stak(e|ing)|perp(etual)?|liquidity|farm|lsd|lst)\b/],
  ['Meme',     /(dog|doge|shib|inu|pepe|wif|bonk|meme|frog|moon|elon|baby|chad|wojak|pump|floki|cat|kitty|pup|trump|maga|coin)/],
];
function classifyNarrative(g) {
  const t = ((g.tokenName || '') + ' ' + (g.tokenSymbol || '') + ' ' + (g.description || '')).toLowerCase();
  for (const [label, re] of NARRATIVE_RULES) if (re.test(t)) return label;
  return 'New';
}
// Backend safety object → a simple "safe" boolean for the card badge.
function isSafe(g) {
  const s = g.safety;
  if (s && s.riskLevel != null) return !['high', 'critical', 'danger'].includes(String(s.riskLevel).toLowerCase());
  return (g.gemScore || 0) >= 50;
}
// Map a backend gem (gem-scanner Gem) into the design's gem card shape.
function mapGem(g) {
  const holders = g.safety && g.safety.holderCount != null ? g.safety.holderCount : null;
  return {
    sym: g.tokenSymbol || '—',
    name: g.tokenName || g.tokenSymbol || '—',
    chain: g.chain || 'sol',
    age: age(g.ageHours),
    mcap: '$' + big(g.marketCap),
    liq: '$' + big(g.liquidity),
    vol: '$' + big(g.volume24h),
    score: Math.round(g.gemScore || 0),
    ch: Math.round(g.priceChange24h ?? g.priceChange1h ?? 0),
    safe: isSafe(g),
    narrative: classifyNarrative(g),
    holders: holders != null ? big(holders) : '—',
    address: g.tokenAddress,
    price: g.priceUsd,
    dexUrl: g.dexUrl,
    img: g.icon || null,
  };
}

// ── Holder bubble map ──
// Union-find over the transfer edges → groups wallets that move funds between
// each other into clusters (bundled launches, sybils). Returns the in-cluster
// set, a cluster-id per address, and the count of multi-wallet clusters.
function clusterize(holders, edges) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  holders.forEach((h) => parent.set(h.address, h.address));
  for (const e of (edges || [])) {
    if (!parent.has(e.from) || !parent.has(e.to)) continue;
    const ra = find(e.from), rb = find(e.to);
    if (ra !== rb) parent.set(ra, rb);
  }
  const size = new Map();
  holders.forEach((h) => { const r = find(h.address); size.set(r, (size.get(r) || 0) + 1); });
  const inCluster = new Set();
  const clusterId = new Map();
  let clusters = 0;
  const rootSeen = new Set();
  holders.forEach((h) => {
    const r = find(h.address);
    clusterId.set(h.address, r);
    if (size.get(r) > 1) { inCluster.add(h.address); if (!rootSeen.has(r)) { rootSeen.add(r); clusters++; } }
  });
  return { inCluster, clusterId, clusters };
}
// Map a getHolderGraph response → { nodes, links, summary } for the bubble
// canvas. Tracks up to 2000 holders; nodes carry pct/kind/weight, links are
// index pairs of transfer-connected wallets (drawn as connections + cluster pull).
function mapHolderGraph(res) {
  const holders = ((res && res.holders) || []).filter((h) => h && h.address)
    .sort((a, b) => (b.pct || 0) - (a.pct || 0)).slice(0, 2000);
  if (!holders.length) return null;
  const { inCluster, clusterId, clusters } = clusterize(holders, res.edges);
  const maxPct = Math.max(...holders.map((h) => h.pct || 0), 0.0001);
  const idxByAddr = new Map(holders.map((h, i) => [h.address, i]));
  const nodes = holders.map((h, i) => {
    const pct = h.pct || 0;
    const kind = h.isContract ? 'lp' : pct >= 5 ? 'whale' : inCluster.has(h.address) ? 'insider' : 'normal';
    return {
      id: i, address: h.address, pct,
      pctLabel: (pct < 1 ? pct.toFixed(2) : pct.toFixed(1)) + '%',
      kind, weight: Math.sqrt(pct / maxPct),
      cluster: clusterId.get(h.address) || h.address,
      label: h.label || (h.isContract ? 'Contract / LP' : kind === 'whale' ? 'Whale' : kind === 'insider' ? 'Insider' : 'Holder'),
    };
  });
  const links = [];
  for (const e of (res.edges || [])) {
    const a = idxByAddr.get(e.from), b = idxByAddr.get(e.to);
    if (a != null && b != null && a !== b) links.push([a, b]);
  }
  const top10 = holders.slice(0, 10).reduce((a, h) => a + (h.pct || 0), 0);
  const whales = holders.filter((h) => !h.isContract && (h.pct || 0) >= 5).length;
  const totalHolders = Math.max(holders.length, (res.meta && parseInt(res.meta.totalHolders)) || 0);
  return {
    nodes, links, holderCount: holders.length, totalHolders,
    summary: { top10: top10.toFixed(0) + '%', clusters, whales, healthy: top10 < 50 && whales <= 3 },
    source: (res.meta && res.meta.source) || '',
  };
}

window.FXAPI = {
  // Real on-chain holder graph for the bubble map (Helius for SOL, Moralis for EVM)
  holderGraph: async (chain, contractAddress) => {
    const res = (await callGetHolderGraph({ chain, contractAddress, limit: 2000 })).data || {};
    return mapHolderGraph(res);
  },
  // Pointer AI chat → { text, proposal }. The model is chosen by the admin
  // (config/billing.aiProvider) — the client no longer sends a provider.
  // opts.deep = true asks the backend to use that provider's top-tier model.
  chatPointer: async (prompt, history, opts) => {
    const res = await callChatPointer({ prompt, history: history || [], deep: !!(opts && opts.deep) });
    return res.data || {};
  },
  // Execute a gated trade proposal.
  executeTrade: async (p) => {
    const res = await callExecuteTrade({
      chain: p.chain,
      tokenAddress: p.tokenAddress,
      action: p.action,
      amount: p.action === 'buy' ? String(p.amount) : undefined,
      percent: p.action === 'sell' ? p.percent : undefined,
      slippage: p.slippage ?? 10,
    });
    return res.data || {};
  },
  getBalances: async (payload) => (await callGetBalances(payload || {})).data,
  getBotInfo: async (payload) => (await callGetBotInfo(payload || {})).data,

  // Gem scanner → array of design-shaped gem cards
  scanGems: async (opts) => {
    const data = (await callScanGems(opts || {})).data || {};
    const gems = data.gems || data.results || (Array.isArray(data) ? data : []);
    return gems.map(mapGem);
  },

  // CEX exchanges
  getCexBalances: async () => (await callGetCexBalances({})).data,
  saveCexApiKey: async ({ exchange, apiKey, secret, passphrase }) =>
    (await callSaveCexApiKey({ exchange, apiKey: String(apiKey).trim(), secret: String(secret).trim(), passphrase: passphrase ? String(passphrase).trim() : undefined })).data,
  removeCexApiKey: async (exchange) => (await callRemoveCexApiKey({ exchange })).data,

  // Telegram / Discord linking
  generateTelegramCode: async () => (await callGenerateTelegramCode({})).data,
  generateDiscordCode: async () => (await callGenerateDiscordCode({})).data,

  // ── Bot / agent delivery toggles ──
  // Persisted directly to the owner's user doc. The pubsub schedulers read them:
  //   botSettings.gemAutoEnabled → processGemScanner (Telegram gem alerts)
  //   agentSettings.enabled / telegramSignals / autoExecute → processAgentScans
  // None are protected keys, so the owner may write them under firestore.rules;
  // setDoc(merge) deep-merges so other bot/wallet/cex settings are preserved.
  getBotPrefs: async () => {
    const u = auth.currentUser;
    if (!u) return null;
    try {
      const snap = await getDoc(doc(db, 'users', u.uid));
      const d = snap.exists() ? snap.data() : {};
      const bs = d.botSettings || {}, ag = d.agentSettings || {};
      return {
        telegramLinked:  !!bs.telegramChatId,
        gemAutoEnabled:  !!bs.gemAutoEnabled,
        gemAutoBuy:      !!bs.gemAutoBuy,
        signalAuto:      !!ag.enabled,
        autoExecute:     !!ag.autoExecute,
        telegramSignals: ag.telegramSignals !== false,
        riskPercent:     ag.riskPercent != null ? ag.riskPercent : 1,
        riskMode:        ag.riskMode === 'fixed' ? 'fixed' : 'percent',
        riskUsd:         ag.riskUsd != null ? ag.riskUsd : 50,
      };
    } catch (e) { return null; }
  },
  // Toggle the automatic gem scanner → Telegram alerts (processGemScanner).
  setGemAutoAlerts: async (on) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in to enable gem alerts.');
    await setDoc(doc(db, 'users', u.uid), { botSettings: { gemAutoEnabled: !!on } }, { merge: true });
    return { gemAutoEnabled: !!on };
  },
  // Toggle auto-execution (the gem trading bot auto-buys qualifying gems each
  // scan). Read by processGemScanner (botSettings.gemAutoBuy). Real on-chain
  // trades — requires a funded bot wallet on the relevant chain.
  setGemAutoBuy: async (on) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in to enable auto-execution.');
    await setDoc(doc(db, 'users', u.uid), { botSettings: { gemAutoBuy: !!on } }, { merge: true });
    return { gemAutoBuy: !!on };
  },
  // Read the persisted gem-scan filter settings (botSettings.gem*). These drive
  // BOTH the manual scan (passed to scanGems) and the auto scheduler
  // (processGemScanner). Returns sensible defaults when unset/unauthenticated.
  getGemSettings: async () => {
    const u = auth.currentUser;
    if (!u) return gemSettingsDefault();
    try {
      const snap = await getDoc(doc(db, 'users', u.uid));
      const bs = (snap.exists() && snap.data().botSettings) || {};
      const minA = readAge(bs, 'gemMinAge', 0, 'hours');
      const maxA = readAge(bs, 'gemMaxAge', 24, 'days');
      return {
        minLiquidity: bs.gemMinLiquidity != null ? bs.gemMinLiquidity : 5000,
        minVolume:    bs.gemMinVolume    != null ? bs.gemMinVolume    : 1000,
        minMarketCap: bs.gemMinMcap      != null ? bs.gemMinMcap      : 0,
        minScore:     bs.gemMinScore     != null ? bs.gemMinScore     : 60,
        sort:         ['score', 'trending', 'new', 'gainers'].includes(bs.gemSort) ? bs.gemSort : 'score',
        minAgeAmount: minA.amount, minAgeUnit: minA.unit, minAgeHours: minA.hours,
        maxAgeAmount: maxA.amount, maxAgeUnit: maxA.unit, maxAgeHours: maxA.hours,
        buyAmountBsc: bs.gemBuyAmountBsc != null ? bs.gemBuyAmountBsc : 0.005,
        buyAmountEth: bs.gemBuyAmountEth != null ? bs.gemBuyAmountEth : 0.01,
        buyAmountSol: bs.gemBuyAmountSol != null ? bs.gemBuyAmountSol : 0.05,
        buySlippage:  bs.gemBuySlippage  != null ? bs.gemBuySlippage  : (bs.defaultSlippage != null ? bs.defaultSlippage : 10),
        exitTp:      bs.gemExitTp      != null ? bs.gemExitTp      : 100,
        exitSl:      bs.gemExitSl      != null ? bs.gemExitSl      : 30,
        exitTrail:   bs.gemExitTrail   != null ? bs.gemExitTrail   : 0,
        exitMaxHold: bs.gemExitMaxHold != null ? bs.gemExitMaxHold : 0,
        telegramChains: cleanTgChains(bs.gemChains),
      };
    } catch (e) { return gemSettingsDefault(); }
  },
  // Persist gem-scan filter settings to the owner's botSettings (deep-merged).
  // Age is stored as canonical hours (read by the scheduler) plus the user's
  // chosen amount + unit so the settings sheet round-trips exactly.
  saveGemSettings: async (s) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in to save scan settings.');
    const n = (v, lo, hi, d) => { const x = parseInt(v); return Number.isFinite(x) ? Math.max(lo, Math.min(x, hi)) : d; };
    // Float clamp for native buy amounts (e.g. 0.005 BNB).
    const f = (v, lo, hi, d) => { const x = parseFloat(v); return Number.isFinite(x) ? Math.max(lo, Math.min(x, hi)) : d; };
    const minUnit = AGE_UNIT_HOURS[s.minAgeUnit] ? s.minAgeUnit : 'hours';
    const maxUnit = AGE_UNIT_HOURS[s.maxAgeUnit] ? s.maxAgeUnit : 'days';
    const minAmount = n(s.minAgeAmount, 0, 9999, 0);
    const maxAmount = Math.max(1, n(s.maxAgeAmount, 1, 9999, 1));
    const minHours = Math.min(minAmount * AGE_UNIT_HOURS[minUnit], 87600);
    const maxHours = Math.max(1, Math.min(maxAmount * AGE_UNIT_HOURS[maxUnit], 87600));
    const botSettings = {
      gemMinLiquidity: n(s.minLiquidity, 1000, 1e9, 5000),
      gemMinVolume:    n(s.minVolume, 0, 1e9, 1000),
      gemMinMcap:      n(s.minMarketCap, 0, 1e12, 0),
      gemMinScore:     n(s.minScore, 0, 100, 60),
      gemSort:         ['score', 'trending', 'new', 'gainers'].includes(s.sort) ? s.sort : 'score',
      gemMinAge: minHours, gemMinAgeAmount: minAmount, gemMinAgeUnit: minUnit,
      gemMaxAge: maxHours, gemMaxAgeAmount: maxAmount, gemMaxAgeUnit: maxUnit,
      // Auto-execute (gem trading bot) config — read by processGemScanner.
      gemBuyAmountBsc: f(s.buyAmountBsc, 0, 1000, 0.005),
      gemBuyAmountEth: f(s.buyAmountEth, 0, 1000, 0.01),
      gemBuyAmountSol: f(s.buyAmountSol, 0, 100000, 0.05),
      gemBuySlippage:  n(s.buySlippage, 1, 50, 10),
      // Exit defaults armed on every auto-bought position (0 = rule off).
      gemExitTp:      f(s.exitTp, 0, 100000, 100),
      gemExitSl:      f(s.exitSl, 0, 99, 30),
      gemExitTrail:   f(s.exitTrail, 0, 99, 0),
      gemExitMaxHold: f(s.exitMaxHold, 0, 8760, 0),
      // Chains the Telegram auto-alert scheduler scans + sends (read by processGemScanner).
      gemChains: cleanTgChains(s.telegramChains),
    };
    await setDoc(doc(db, 'users', u.uid), { botSettings }, { merge: true });
    return {
      minLiquidity: botSettings.gemMinLiquidity, minVolume: botSettings.gemMinVolume,
      minMarketCap: botSettings.gemMinMcap, minScore: botSettings.gemMinScore, sort: botSettings.gemSort,
      minAgeAmount: minAmount, minAgeUnit: minUnit, minAgeHours: minHours,
      maxAgeAmount: maxAmount, maxAgeUnit: maxUnit, maxAgeHours: maxHours,
      buyAmountBsc: botSettings.gemBuyAmountBsc, buyAmountEth: botSettings.gemBuyAmountEth,
      buyAmountSol: botSettings.gemBuyAmountSol, buySlippage: botSettings.gemBuySlippage,
      exitTp: botSettings.gemExitTp, exitSl: botSettings.gemExitSl,
      exitTrail: botSettings.gemExitTrail, exitMaxHold: botSettings.gemExitMaxHold,
      telegramChains: botSettings.gemChains,
    };
  },
  // Patch the CEX signal agent settings (whitelisted fields only).
  saveSignalPrefs: async (patch) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in to change signal settings.');
    const agentSettings = {};
    for (const k of ['enabled', 'autoExecute', 'telegramSignals']) if (patch && patch[k] !== undefined) agentSettings[k] = !!patch[k];
    // Risk per trade (% of balance) for the auto-execute bot — clamp to a sane range.
    if (patch && patch.riskPercent !== undefined) {
      const r = parseFloat(patch.riskPercent);
      if (Number.isFinite(r)) agentSettings.riskPercent = Math.max(0.1, Math.min(r, 25));
    }
    // Position-sizing mode: 'percent' (of balance) or 'fixed' (a USDT amount/trade).
    if (patch && patch.riskMode !== undefined) agentSettings.riskMode = patch.riskMode === 'fixed' ? 'fixed' : 'percent';
    if (patch && patch.riskUsd !== undefined) {
      const u = parseFloat(patch.riskUsd);
      if (Number.isFinite(u)) agentSettings.riskUsd = Math.max(1, Math.min(u, 1000000));
    }
    if (!Object.keys(agentSettings).length) return {};
    await setDoc(doc(db, 'users', u.uid), { agentSettings }, { merge: true });
    return agentSettings;
  },

  // Signal actions
  approveTrade: async (payload) => (await callApproveTrade(payload || {})).data,
  skipSignal: async (signalId) => (await callSkipSignal({ signalId })).data,
  // Run the CEX signal scanner (agent) → { signals, scannedAt }. Pass
  // { marketTypes: ['spot','futures'] } so the manual scan covers both.
  runAgentScan: async (opts) => (await callRunAgentScan(opts || {})).data,

  // ── Paper trading mode ──
  // Account-level flag (users/{uid}.paperMode). When on, every execution path
  // (manual, Pointer, gem auto-buy, exits) simulates fills server-side — the
  // backend returns before any wallet/key access.
  getPaperMode: async () => {
    const u = auth.currentUser;
    if (!u) return false;
    if (window.__fxPaperMode != null) return window.__fxPaperMode;
    try {
      const snap = await getDoc(doc(db, 'users', u.uid));
      window.__fxPaperMode = !!(snap.exists() && snap.data().paperMode === true);
    } catch (e) { window.__fxPaperMode = false; }
    return window.__fxPaperMode;
  },
  setPaperMode: async (on) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in to switch trading mode.');
    await setDoc(doc(db, 'users', u.uid), { paperMode: !!on }, { merge: true });
    window.__fxPaperMode = !!on;
    return !!on;
  },

  // ── Portfolio / positions ──
  // Positions are bookkept server-side (trade trigger + exit monitor); clients
  // read them and may only edit exit rules. status: 'open' | 'closed'.
  // Lists are segregated by the CURRENT trading mode — paper and real never mix.
  getPositions: async (status) => {
    const u = auth.currentUser;
    if (!u) return [];
    try {
      const paper = await window.FXAPI.getPaperMode();
      const st = status === 'closed' ? 'closed' : 'open';
      const orderField = st === 'closed' ? 'closedAt' : 'openedAt';
      const qy = query(collection(db, 'users', u.uid, 'positions'), where('status', '==', st), orderBy(orderField, 'desc'), limit(100));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !!p.paper === paper);
    } catch (e) { return []; }
  },
  // Arm/update exit rules on a position. rules: { tp, sl, trail, maxHoldHours }
  // — all in %, 0/empty = rule off. Passing all-off disarms the position.
  setPositionExit: async (positionId, rules) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in to set exit rules.');
    const f = (v, lo, hi) => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? Math.max(lo, Math.min(x, hi)) : null; };
    const r = {
      tp: f(rules && rules.tp, 1, 100000), sl: f(rules && rules.sl, 1, 99),
      trail: f(rules && rules.trail, 1, 99), maxHoldHours: f(rules && rules.maxHoldHours, 0.1, 8760),
    };
    const armed = r.tp != null || r.sl != null || r.trail != null || r.maxHoldHours != null;
    // peakUsd resets on (re)arm so a stale peak from an earlier run can't
    // insta-fire the trailing stop.
    await setDoc(doc(db, 'users', u.uid, 'positions', positionId),
      { exit: armed ? { ...r, peakUsd: 0, status: 'armed', fails: 0, nextTryAt: 0 } : null, exitArmed: armed },
      { mergeFields: ['exit', 'exitArmed'] }); // replaces the whole exit map (no deep-merge with stale fields)
    return { armed, rules: r };
  },
  // Manual sell of a position (percent of holdings) through the bot wallet.
  sellPosition: async (chain, tokenAddress, percent) =>
    (await callExecuteTrade({ chain, tokenAddress, action: 'sell', percent: Math.min(100, Math.max(1, parseInt(percent) || 100)) })).data,
  // Trade journal (newest first) for the history view + CSV export. Filtered to
  // the current trading mode so paper fills never mix into the real journal.
  getTrades: async (max) => {
    const u = auth.currentUser;
    if (!u) return [];
    try {
      const paper = await window.FXAPI.getPaperMode();
      const qy = query(collection(db, 'users', u.uid, 'trades'), orderBy('timestamp', 'desc'), limit(Math.min(500, max || 200)));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, ...x, at: x.timestamp && x.timestamp.toMillis ? x.timestamp.toMillis() : null };
      }).filter((t) => !!t.paper === paper);
    } catch (e) { return []; }
  },

  // ── Price alerts ──
  // Created/edited only via the callable (server-enforced plan caps); listed
  // and deleted directly. kind: 'above' | 'below' | 'move' (± % from creation).
  savePriceAlert: async (a) => (await callSavePriceAlert(a || {})).data,
  togglePriceAlert: async (id, on) => (await callSavePriceAlert({ id, on: !!on })).data,
  listPriceAlerts: async () => {
    const u = auth.currentUser;
    if (!u) return [];
    try {
      const qy = query(collection(db, 'users', u.uid, 'priceAlerts'), orderBy('createdAt', 'desc'), limit(100));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) { return []; }
  },
  deletePriceAlert: async (id) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in first.');
    await deleteDoc(doc(db, 'users', u.uid, 'priceAlerts', String(id)));
    return true;
  },

  // ── Copy trading ──
  // Follow list lives client-writable (copyEnabled is intent only; the server
  // enforces Elite/flags/caps before executing anything).
  listFollowedWallets: async () => {
    const u = auth.currentUser;
    if (!u) return [];
    try {
      const snap = await getDocs(query(collection(db, 'users', u.uid, 'followedWallets'), orderBy('createdAt', 'desc'), limit(50)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) { return []; }
  },
  followWallet: async ({ chain, address, label }) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in to follow wallets.');
    const ch = ['bsc', 'eth', 'base', 'sol'].includes(chain) ? chain : null;
    const addr = String(address || '').trim();
    const okEvm = /^0x[0-9a-fA-F]{40}$/.test(addr);
    const okSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    if (!ch || !(ch === 'sol' ? okSol : okEvm)) throw new Error('Enter a valid wallet address for the selected chain.');
    const id = ch + '_' + addr.toLowerCase().replace(/[^a-z0-9]/g, '');
    await setDoc(doc(db, 'users', u.uid, 'followedWallets', id), {
      chain: ch, address: addr, label: String(label || '').slice(0, 40),
      active: true, copyEnabled: false, createdAt: Date.now(),
    });
    return { id };
  },
  setFollowedWallet: async (id, patch) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in first.');
    const clean = {};
    if (patch.active !== undefined) clean.active = !!patch.active;
    if (patch.copyEnabled !== undefined) clean.copyEnabled = !!patch.copyEnabled;
    if (patch.label !== undefined) clean.label = String(patch.label).slice(0, 40);
    await setDoc(doc(db, 'users', u.uid, 'followedWallets', String(id)), clean, { merge: true });
    return clean;
  },
  unfollowWallet: async (id) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in first.');
    await deleteDoc(doc(db, 'users', u.uid, 'followedWallets', String(id)));
    return true;
  },
  getCopyFeed: async () => { try { return (await callGetCopyFeed({})).data.items || []; } catch (e) { return []; } },
  getCopyLeaderboard: async () => { try { return (await callGetCopyLeaderboard({})).data; } catch (e) { return null; } },

  // ── Referral program ──
  // Server-issued code + real click/signup/paid stats (5-min cached).
  getReferralInfo: (() => {
    let cache = null, at = 0;
    return async () => {
      if (cache && Date.now() - at < 300000) return cache;
      try { cache = (await callGetReferralInfo({})).data; at = Date.now(); return cache; }
      catch (e) { return cache; }
    };
  })(),

  // ── Daily digest ──
  // Opt-in morning summary; hour is stored in UTC (client converts local→UTC).
  getDigestPrefs: async () => {
    const u = auth.currentUser;
    if (!u) return { enabled: false, hourUtc: 8 };
    try {
      const snap = await getDoc(doc(db, 'users', u.uid));
      const dg = (snap.exists() && snap.data().digest) || {};
      return { enabled: dg.enabled === true, hourUtc: Number.isFinite(dg.hourUtc) ? dg.hourUtc : 8 };
    } catch (e) { return { enabled: false, hourUtc: 8 }; }
  },
  setDigestPrefs: async ({ enabled, hourUtc }) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in first.');
    const h = Math.min(23, Math.max(0, parseInt(hourUtc) || 0));
    await setDoc(doc(db, 'users', u.uid), { digest: { enabled: !!enabled, hourUtc: h } }, { merge: true });
    return { enabled: !!enabled, hourUtc: h };
  },

  // ── Pointer watch-tasks ──
  // Created only by the Pointer agent (create_watch_task); the client lists,
  // pauses/resumes (status-only per rules), and deletes.
  listPointerTasks: async () => {
    const u = auth.currentUser;
    if (!u) return [];
    try {
      const qy = query(collection(db, 'users', u.uid, 'pointerTasks'), orderBy('createdAt', 'desc'), limit(50));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) { return []; }
  },
  setPointerTaskStatus: async (id, status) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in first.');
    if (!['armed', 'paused'].includes(status)) throw new Error('Invalid status');
    await setDoc(doc(db, 'users', u.uid, 'pointerTasks', String(id)), { status }, { merge: true });
    return status;
  },
  deletePointerTask: async (id) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Sign in first.');
    await deleteDoc(doc(db, 'users', u.uid, 'pointerTasks', String(id)));
    return true;
  },

  // ── Signal track record ──
  // 30/90-day win rate & avg R aggregates (server-computed from resolved
  // signals). Cached for 5 min — the paywall and Signals screen both read it.
  getSignalStats: (() => {
    let cache = null, at = 0;
    return async () => {
      if (cache && Date.now() - at < 300000) return cache;
      try { cache = (await callGetSignalStats({})).data; at = Date.now(); return cache; }
      catch (e) { return cache; }
    };
  })(),

  // Individual won/lost signals behind the track-record card (90d). Cached 5 min.
  getSignalOutcomes: (() => {
    let cache = null, at = 0;
    return async () => {
      if (cache && Date.now() - at < 300000) return cache;
      try { cache = (await callGetSignalOutcomes({})).data; at = Date.now(); return cache; }
      catch (e) { return cache; }
    };
  })(),

  // ── Gem hindsight stats ──
  // Median/best 24h & 7d performance of gems the scanner surfaced (30d window,
  // server-computed). Cached 5 min; the Gem Scanner reads it.
  getGemStats: (() => {
    let cache = null, at = 0;
    return async () => {
      if (cache && Date.now() - at < 300000) return cache;
      try { cache = (await callGetGemStats({})).data; at = Date.now(); return cache; }
      catch (e) { return cache; }
    };
  })(),

  // Individual won/lost gems behind the track-record card (90d). Cached 5 min.
  getGemOutcomes: (() => {
    let cache = null, at = 0;
    return async () => {
      if (cache && Date.now() - at < 300000) return cache;
      try { cache = (await callGetGemOutcomes({})).data; at = Date.now(); return cache; }
      catch (e) { return cache; }
    };
  })(),

  // Auto-scanned gems (the 5-min scheduler's finds, also pushed to Telegram),
  // read from the user's own server-written gemAlerts log so they list in-app.
  getGemAlerts: async () => {
    const u = auth.currentUser;
    if (!u) return [];
    try {
      const q = query(collection(db, 'users', u.uid, 'gemAlerts'), orderBy('alertedAt', 'desc'), limit(40));
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const x = d.data();
        const at = x.alertedAt && x.alertedAt.toMillis ? x.alertedAt.toMillis() : x.alertedAt;
        return { id: d.id, ...x, alertedAt: at };
      });
    } catch (e) { return []; }
  },

  // ── Pointer usage & credits ──
  // Usage snapshot for the in-app quota pill/paywall.
  getPointerUsage: async () => {
    try { return (await callGetPointerUsage({})).data; } catch (e) { return null; }
  },
  // (Stripe credit-pack checkout removed with the rest of card payments —
  // out-of-requests users upgrade their plan via crypto on the paywall, and
  // admins can still grant credits from the dashboard.)
  // Handle the ?credits=success|cancel return from Stripe: strip the param and
  // report what happened so the shell can toast + refresh the usage pill.
  // Returns 'success' | 'cancel' | null.
  consumeCreditsReturn: () => {
    try {
      const url = new URL(window.location.href);
      const v = url.searchParams.get('credits');
      if (!v) return null;
      url.searchParams.delete('credits');
      window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash);
      return v === 'success' ? 'success' : 'cancel';
    } catch (e) { return null; }
  },

  // ── Premium billing (crypto-only) ──
  // Fire-and-forget conversion-funnel event ('paywallView' | 'checkoutStart').
  trackFunnel: (event) => { try { callTrackFunnel({ event }).catch(() => {}); } catch (e) {} },
  // Admin-set plan prices (config/billing.planPricesUsd) — the same numbers the
  // crypto invoice charges, so the price cards can never drift from checkout.
  // Cached 5 min.
  getPlans: (() => {
    let cache = null, at = 0;
    return async () => {
      if (cache && Date.now() - at < 300000) return cache;
      try { cache = (await callGetPlans({})).data; at = Date.now(); return cache; }
      catch (e) { return cache; }
    };
  })(),
  // Crypto pay-to-address invoice → { invoiceId, address, amountToken, symbol, ... }
  createCryptoInvoice: async ({ plan, chain, asset }) => {
    window.FXAPI.trackFunnel('checkoutStart');
    return (await callCreateCryptoInvoice({ plan, chain, asset })).data;
  },
  // Poll on-chain verification → { status: 'paid'|'pending', plan }
  verifyCryptoPayment: async (invoiceId) => (await callVerifyCryptoPayment({ invoiceId })).data,
};

// ── Pointer chat sessions ──
// Saved conversations live at users/{uid}/pointerChats/{id}. Each holds the
// rendered message list + a title so a user can keep multiple threads (each with
// its own context) and start fresh ones. Stateless backend — context is the
// stored message history, replayed to chatPointer on each turn.
const newChatId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
window.FXChats = {
  newId: newChatId,
  // List saved sessions (newest first) for the session switcher.
  list: async () => {
    const u = auth.currentUser;
    if (!u) return [];
    try {
      const snap = await getDocs(query(collection(db, 'users', u.uid, 'pointerChats'), orderBy('updatedAt', 'desc'), limit(50)));
      return snap.docs.map((d) => {
        const x = d.data() || {};
        const msgs = x.messages || [];
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        return { id: d.id, title: x.title || 'New chat', updatedAt: x.updatedAt || 0, count: msgs.length, preview: (lastUser && lastUser.text) || '' };
      });
    } catch (e) { return []; }
  },
  // Load one session's full message list.
  load: async (id) => {
    const u = auth.currentUser;
    if (!u || !id) return null;
    try { const s = await getDoc(doc(db, 'users', u.uid, 'pointerChats', id)); return s.exists() ? { id, ...s.data() } : null; }
    catch (e) { return null; }
  },
  // Upsert a session. Returns the (possibly new) id. Messages are sanitized +
  // capped so the doc stays small and JSON-clean (no undefined for Firestore).
  save: async (id, { title, messages } = {}) => {
    const u = auth.currentUser;
    if (!u) return id || null;
    const chatId = id || newChatId();
    const msgs = (messages || []).slice(-60).map((m) => ({
      role: m.role || 'ai', text: m.text || '',
      proposal: m.proposal ? JSON.parse(JSON.stringify(m.proposal)) : null,
      token: m.token || null,
      // Reference links Pointer cited (web_search sources) so they survive reload.
      sources: Array.isArray(m.sources) && m.sources.length
        ? m.sources.slice(0, 6).map((s) => ({ label: s.label || '', title: s.title || '', url: s.url || '' })).filter((s) => s.url)
        : null,
    }));
    try {
      await setDoc(doc(db, 'users', u.uid, 'pointerChats', chatId), {
        title: String(title || 'New chat').slice(0, 60), messages: msgs, updatedAt: Date.now(),
      }, { merge: true });
    } catch (e) { /* keep local even if the write fails */ }
    return chatId;
  },
  remove: async (id) => {
    const u = auth.currentUser;
    if (!u || !id) return;
    try { await deleteDoc(doc(db, 'users', u.uid, 'pointerChats', id)); } catch (e) {}
  },
};

// ── Referral link capture (?ref=CODE) ──
// Stash the code for the signup form (fx-auth reads fx_ref) and ping the
// public click counter once. Runs at module load in both apps.
try {
  const refCode = new URL(window.location.href).searchParams.get('ref');
  if (refCode && /^[A-Za-z0-9]{6,22}$/.test(refCode)) {
    localStorage.setItem('fx_ref', refCode.toUpperCase());
    const clickUrl = 'https://europe-west1-pnl-calculator.cloudfunctions.net/refClick?code=' + encodeURIComponent(refCode.toUpperCase());
    if (navigator.sendBeacon) navigator.sendBeacon(clickUrl);
    else fetch(clickUrl, { method: 'POST', keepalive: true }).catch(() => {});
  }
} catch (e) { /* no URL access (SSR) — ignore */ }

export {};

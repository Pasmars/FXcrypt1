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
  callCreateStripeCheckout,
  callCreateCryptoInvoice,
  callVerifyCryptoPayment,
} from './functions';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, query, orderBy, limit } from 'firebase/firestore';

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
  };
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
  chatPointer: async (prompt, history) => {
    const res = await callChatPointer({ prompt, history: history || [] });
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
    };
    await setDoc(doc(db, 'users', u.uid), { botSettings }, { merge: true });
    return {
      minLiquidity: botSettings.gemMinLiquidity, minVolume: botSettings.gemMinVolume,
      minMarketCap: botSettings.gemMinMcap, minScore: botSettings.gemMinScore, sort: botSettings.gemSort,
      minAgeAmount: minAmount, minAgeUnit: minUnit, minAgeHours: minHours,
      maxAgeAmount: maxAmount, maxAgeUnit: maxUnit, maxAgeHours: maxHours,
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

  // ── Premium billing ──
  // Stripe Checkout → { url }. billing: 'subscription' | 'onetime'.
  createStripeCheckout: async (plan, billing) => (await callCreateStripeCheckout({ plan, billing })).data,
  // Crypto pay-to-address invoice → { invoiceId, address, amountToken, symbol, ... }
  createCryptoInvoice: async ({ plan, chain, asset }) => (await callCreateCryptoInvoice({ plan, chain, asset })).data,
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

export {};

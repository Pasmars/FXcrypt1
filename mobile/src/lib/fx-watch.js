// fx-watch.js — persistent watchlist for the Markets tab.
//
// Before this, the star toggle only flipped local React state, so a coin/token
// added to the watchlist never persisted or showed up. This stores the watchlist
// in Firestore (users/{uid}/watchlist), marks matching window.FX.tokens as `fav`,
// and exposes on-chain (non-CoinGecko) entries as live rows for the list.
import { db, auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocs, setDoc, deleteDoc, query, where } from 'firebase/firestore';

const DS_CID = { bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base', poly: 'polygon', arb: 'arbitrum' };

let keys = new Set();   // set of watchlist keys
let entries = [];       // [{ key, sym, name, cg, chain, address, img, price, ch24, mcap, vol, dexUrl }]
let loaded = false;

function emit() { try { window.dispatchEvent(new CustomEvent('fx:update')); } catch (e) {} }
function uid() { return auth.currentUser && auth.currentUser.uid; }

function colorFor(sym) {
  let h = 0; const s = String(sym || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const r = 80 + (h & 0x7f), g = 80 + ((h >> 8) & 0x7f), b = 80 + ((h >> 16) & 0x7f);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function fmtBig(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(0) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
}

// Stable identity for a coin/token across the app.
function tokenKey(t) {
  if (!t) return '';
  if (t.cg) return 'cg:' + t.cg;
  const a = t.address || t.tokenAddress;
  if (a) return 'tk:' + (t.chain || '') + ':' + String(a).toLowerCase();
  return 'sym:' + String(t.sym || '').toUpperCase();
}
const docId = (key) => key.replace(/[^a-zA-Z0-9_-]/g, '_');

function applyFav() {
  const tokens = window.FX && window.FX.tokens;
  if (tokens) tokens.forEach((t) => { t.fav = keys.has(tokenKey(t)); });
  if (window.FX) { window.FX.watchKeys = keys; window.FX.watchlist = entries; }
}

// Map a Token Tracker doc (users/{uid}/trackedTokens) → a watchlist entry so
// anything tracked in the standalone tracker also shows on the Markets watchlist.
// Tracker docs are { contractAddress, chain, name, symbol, addedAt }; its chain
// keys (bsc/eth/sol) match ours, so the tokenKey lines up for dedup.
function trackedToEntry(d) {
  const address = d.contractAddress || d.address;
  if (!address) return null;
  const chain = d.chain || null;
  const t = { chain, address, sym: d.symbol || '', name: d.name || d.symbol || '' };
  return {
    key: tokenKey(t), sym: t.sym, name: t.name, cg: null, chain, address,
    img: null, price: 0, ch24: 0, mcap: null, vol: null, dexUrl: null,
    addedAt: (d.addedAt && Date.parse(d.addedAt)) || Date.now(), source: 'tracker',
  };
}

async function load() {
  const id = uid();
  if (!id) { keys = new Set(); entries = []; loaded = false; applyFav(); return; }
  try {
    const snap = await getDocs(collection(db, 'users', id, 'watchlist'));
    const list = snap.docs.map((d) => ({ ...d.data() }));
    // Merge in Token Tracker tokens (deduped by key) so they reflect here too.
    try {
      const tsnap = await getDocs(collection(db, 'users', id, 'trackedTokens'));
      const seen = new Set(list.map((e) => e.key));
      for (const td of tsnap.docs) {
        const e = trackedToEntry(td.data());
        if (e && e.key && !seen.has(e.key)) { list.push(e); seen.add(e.key); }
      }
    } catch (_) { /* tracker optional */ }
    entries = list;
    keys = new Set(entries.map((e) => e.key));
  } catch (e) { /* keep */ }
  loaded = true;
  applyFav();
  emit();
  refreshPrices();
}

// Refresh live prices for on-chain watchlist tokens via DexScreener (CoinGecko
// coins are already priced in window.FX.tokens).
async function refreshPrices() {
  const onchain = entries.filter((e) => e.address && e.chain);
  if (!onchain.length) return;
  await Promise.all(onchain.map(async (e) => {
    try {
      const cid = DS_CID[e.chain] || e.chain;
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/${cid}/${e.address}`);
      const data = await r.json();
      const arr = Array.isArray(data) ? data.slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)) : [];
      const p = arr[0];
      if (p) {
        e.price = parseFloat(p.priceUsd) || e.price || 0;
        e.ch24 = p.priceChange?.h24 != null ? +Number(p.priceChange.h24).toFixed(2) : (e.ch24 || 0);
        e.mcap = p.marketCap || p.fdv || e.mcap;
        e.vol = p.volume?.h24 != null ? p.volume.h24 : e.vol;
        e.img = (p.info && p.info.imageUrl) || e.img || null;
        e.dexUrl = p.url || e.dexUrl || null;
      }
    } catch (_) {}
  }));
  if (window.FX) window.FX.watchlist = entries;
  emit();
}

function has(t) { return keys.has(tokenKey(t)); }

// Remove any matching docs from the Token Tracker (users/{uid}/trackedTokens)
// so a token un-starred here doesn't resurface from the tracker merge on reload.
async function removeFromTracker(id, t) {
  const addr = String(t.address || t.tokenAddress || '').toLowerCase();
  const chain = t.chain;
  if (!addr || !chain) return;
  try {
    const snap = await getDocs(query(collection(db, 'users', id, 'trackedTokens'), where('chain', '==', chain)));
    await Promise.all(snap.docs
      .filter((d) => String(d.data().contractAddress || '').toLowerCase() === addr)
      .map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch (_) { /* tracker optional */ }
}

async function toggle(t) {
  const id = uid();
  if (!id) return false;
  const key = tokenKey(t);
  if (!key) return false;
  const adding = !keys.has(key);
  if (adding) {
    const entry = {
      key, sym: t.sym || '', name: t.name || t.sym || '', cg: t.cg || null,
      chain: t.chain || null, address: t.address || t.tokenAddress || null,
      img: t.img || null, price: t.price || 0,
      ch24: typeof t.ch24 === 'number' ? t.ch24 : 0,
      mcap: t.mcap || null, vol: t.vol || null, dexUrl: t.dexUrl || null, addedAt: Date.now(),
    };
    entries = [...entries.filter((e) => e.key !== key), entry];
    keys.add(key);
    setDoc(doc(db, 'users', id, 'watchlist', docId(key)), entry).catch(() => {});
  } else {
    entries = entries.filter((e) => e.key !== key);
    keys.delete(key);
    deleteDoc(doc(db, 'users', id, 'watchlist', docId(key))).catch(() => {});
    // Also untrack it in the Token Tracker so it stays gone after a refresh.
    removeFromTracker(id, t);
  }
  applyFav();
  emit();
  if (adding) refreshPrices();
  return adding;
}

// On-chain watchlist entries as token-list rows (CoinGecko favs come from FX.tokens).
function rows() {
  return entries.filter((e) => e.address && e.chain).map((e) => ({
    id: e.key, sym: e.sym, name: e.name || e.sym, chain: e.chain,
    price: e.price || 0, ch24: +(e.ch24 || 0),
    mcap: e.mcap != null ? fmtBig(e.mcap) : '—', vol: e.vol != null ? fmtBig(e.vol) : '—', liq: '—', holders: '—',
    logo: colorFor(e.sym), img: e.img || null, address: e.address, tokenAddress: e.address, dexUrl: e.dexUrl || null,
    fav: true, spark: [], live: true, market: true,
  }));
}

window.FXWatch = { load, has, toggle, rows, ready: () => loaded, tokenKey };

// Load on auth, clear on sign-out.
onAuthStateChanged(auth, (u) => { if (u) load(); else { keys = new Set(); entries = []; loaded = false; applyFav(); emit(); } });

export {};

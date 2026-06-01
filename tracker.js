import { requireAuth } from './authObserver.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, collection, addDoc, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";
import { auth, db, fns } from './firebase.js';

// ── Constants ────────────────────────────────────────────────────────────────
const DS_BASE   = 'https://api.dexscreener.com';
const CHAIN_ID  = { bsc: 'bsc', eth: 'ethereum', sol: 'solana' };
const REFRESH_MS = 10000;

// ── Cloud Function references ─────────────────────────────────────────────────
const getTokenHoldersFn = httpsCallable(fns, 'getTokenHolders');
const getWalletTokensFn  = httpsCallable(fns, 'getWalletTokens');

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser    = null;
let tokenChain     = 'bsc';
let walletChain    = 'bsc';
let trackedTokens  = [];
let trackedWallets = [];
let refreshTimer   = null;
let countdown      = 10;
let lastWalletData = null;

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (n == null) return 'N/A';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString();
}

function fmtUSD(n) {
  if (n == null) return 'N/A';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${Number(n).toFixed(2)}`;
}

function fmtPrice(p) {
  if (!p) return 'N/A';
  const n = parseFloat(p);
  if (isNaN(n)) return 'N/A';
  if (n < 0.000001) return `$${n.toExponential(4)}`;
  if (n < 0.01) return `$${n.toFixed(8)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function fmtChange(val) {
  if (val == null) return { text: 'N/A', cls: '' };
  const n = parseFloat(val);
  return { text: `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`, cls: n >= 0 ? 'price-up' : 'price-down' };
}

function chainBadge(c) {
  const l = { bsc: 'BSC', eth: 'ETH', sol: 'SOL' };
  return `<span class="chain-badge ${c}">${l[c] || c}</span>`;
}

function shortAddr(a) {
  if (!a) return '';
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

// ── DexScreener ───────────────────────────────────────────────────────────────
async function fetchTokenPairs(contractAddress, chain) {
  const cid = CHAIN_ID[chain];
  const res = await fetch(`${DS_BASE}/token-pairs/v1/${cid}/${contractAddress}`);
  if (!res.ok) throw new Error(`DexScreener error: ${res.status}`);
  const pairs = await res.json();
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('Token not found. Check the contract address and chain.');
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return pairs[0];
}

async function batchFetchByChain(tokens, chain) {
  const addrs = tokens.map(t => t.contractAddress).join(',');
  const cid = CHAIN_ID[chain];
  const res = await fetch(`${DS_BASE}/tokens/v1/${cid}/${addrs}`);
  if (!res.ok) return {};
  const pairs = await res.json();
  if (!Array.isArray(pairs)) return {};
  const best = {};
  for (const p of pairs) {
    const addr = p.baseToken?.address?.toLowerCase();
    if (!addr) continue;
    if (!best[addr] || (p.liquidity?.usd || 0) > (best[addr].liquidity?.usd || 0)) best[addr] = p;
  }
  return best;
}

// ── Holder count via Cloud Function ──────────────────────────────────────────
async function fetchHolderCount(contractAddress, chain) {
  try {
    const result = await getTokenHoldersFn({ chain, contractAddress });
    return result.data.holders;
  } catch (_) { return null; }
}

// ── Wallet tokens via Cloud Function ─────────────────────────────────────────
async function fetchWalletTokens(address, chain) {
  const result = await getWalletTokensFn({ chain, address });
  return result.data.tokens;
}

// ── Render helpers ────────────────────────────────────────────────────────────
function renderTokenResultCard(pair, chain, addr, alreadySaved, holders) {
  const ch = fmtChange(pair.priceChange?.h24);
  const logo = pair.info?.imageUrl || '';
  const holdersText = holders != null ? fmtNum(holders) : '...';
  const alreadySavedHtml = alreadySaved
    ? '<span style="margin-left:auto;color:#0ECB81;font-size:12px;font-weight:700;">✓ In Watchlist</span>'
    : `<button class="save-watchlist-btn" id="saveWatchlistBtn">⭐ Save to Watchlist</button>`;
  return `
    <div class="token-result-card">
      <div class="token-card-header">
        ${logo ? `<img class="token-logo" src="${logo}" alt="" onerror="this.style.display='none'"/>` : ''}
        <div class="token-card-title">
          <strong>${pair.baseToken?.name || 'Unknown'}</strong>
          <span class="token-symbol">${pair.baseToken?.symbol || ''}</span>
          ${chainBadge(chain)}
        </div>
        <div class="token-price-big">${fmtPrice(pair.priceUsd)}</div>
      </div>
      <div class="token-card-stats">
        <div class="stat-box"><span class="stat-label">24h Change</span><span class="stat-val ${ch.cls}">${ch.text}</span></div>
        <div class="stat-box"><span class="stat-label">Market Cap</span><span class="stat-val">${pair.marketCap ? fmtUSD(pair.marketCap) : 'N/A'}</span></div>
        <div class="stat-box"><span class="stat-label">24h Volume</span><span class="stat-val">${pair.volume?.h24 ? fmtUSD(pair.volume.h24) : 'N/A'}</span></div>
        <div class="stat-box"><span class="stat-label">Liquidity</span><span class="stat-val">${pair.liquidity?.usd ? fmtUSD(pair.liquidity.usd) : 'N/A'}</span></div>
        <div class="stat-box"><span class="stat-label">Holders</span><span class="stat-val" id="holderCountVal">${holdersText}</span></div>
      </div>
      <div class="token-card-footer">
        <span class="contract-addr" title="${addr}">${shortAddr(addr)}</span>
        ${pair.url ? `<a href="${pair.url}" target="_blank" rel="noopener" class="dex-link">View on DEX ↗</a>` : ''}
        ${alreadySavedHtml}
      </div>
    </div>`;
}

function renderWatchlistCard(token, pair, holders) {
  const ch = pair ? fmtChange(pair.priceChange?.h24) : { text: '...', cls: '' };
  const price = pair ? fmtPrice(pair.priceUsd) : '...';
  const mcap = pair?.marketCap ? fmtUSD(pair.marketCap) : '—';
  const vol = pair?.volume?.h24 ? fmtUSD(pair.volume.h24) : '—';
  const liq = pair?.liquidity?.usd ? fmtUSD(pair.liquidity.usd) : '—';
  const holdersText = holders != null ? fmtNum(holders) : '—';
  return `
    <div class="watchlist-card watchlist-card-clickable" id="wcard-${token.id}"
         data-address="${token.contractAddress}" data-chain="${token.chain}">
      <div class="wcard-header">
        ${chainBadge(token.chain)}
        <strong class="wcard-name">${token.name || token.symbol}</strong>
        <button class="remove-btn" data-id="${token.id}" title="Remove">✕</button>
      </div>
      <div class="wcard-price">${price}</div>
      <div class="wcard-change ${ch.cls}">${ch.text}</div>
      <div class="wcard-stats">
        <span>MCap: ${mcap}</span>
        <span>Vol: ${vol}</span>
        <span>Liq: ${liq}</span>
        <span>👥 ${holdersText}</span>
      </div>
      <div class="wcard-tap-hint">Tap for full details →</div>
    </div>`;
}

function renderHoldingsTable(tokens, walletAddr, chain) {
  if (!tokens.length) return '<div class="tracker-error">No token holdings found in this wallet.</div>';
  const total = tokens.reduce((s, t) => s + (t.usdValue || 0), 0);
  const rows = tokens.map(t => {
    const ch = t.change24h != null ? fmtChange(t.change24h) : { text: '—', cls: '' };
    return `<tr>
      <td>${t.symbol || t.name || shortAddr(t.contractAddress || t.mint)}</td>
      <td>${t.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
      <td>${t.priceUsd ? fmtPrice(t.priceUsd) : '—'}</td>
      <td class="${ch.cls}">${ch.text}</td>
      <td>${t.usdValue ? fmtUSD(t.usdValue) : '—'}</td>
    </tr>`;
  }).join('');
  return `
    <div class="wallet-result-header">
      <span class="wallet-total">Total Value: ${fmtUSD(total)}</span>
      <button class="save-wallet-btn" id="saveWalletBtn">💾 Save Wallet</button>
    </div>
    <div style="overflow-x:auto;">
      <table class="holdings-table">
        <thead><tr><th>Token</th><th>Balance</th><th>Price</th><th>24h</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Watchlist render ──────────────────────────────────────────────────────────
function renderWatchlist(pairMap, holdersMap) {
  const grid = document.getElementById('watchlistGrid');
  if (!grid) return;
  if (!trackedTokens.length) {
    grid.innerHTML = '<div class="empty-state">No tokens in your watchlist yet. Track a token above!</div>';
    return;
  }
  grid.innerHTML = trackedTokens.map(t => {
    const pair = pairMap ? pairMap[t.contractAddress.toLowerCase()] : null;
    const holders = holdersMap ? holdersMap[t.contractAddress.toLowerCase()] : null;
    return renderWatchlistCard(t, pair, holders);
  }).join('');
  grid.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); removeTrackedToken(btn.dataset.id); });
  });
  grid.querySelectorAll('.watchlist-card-clickable').forEach(card => {
    card.addEventListener('click', () => {
      window.location.href = `token.html?chain=${card.dataset.chain}&address=${card.dataset.address}`;
    });
  });
}

// ── Firestore ─────────────────────────────────────────────────────────────────
async function loadTrackedTokens() {
  try {
    const col = collection(db, 'users', currentUser.uid, 'trackedTokens');
    const snap = await getDocs(col);
    trackedTokens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error('loadTrackedTokens:', e); }
}

async function saveTrackedToken(pair, addr, chain) {
  const data = {
    contractAddress: addr,
    chain,
    name: pair.baseToken?.name || '',
    symbol: pair.baseToken?.symbol || '',
    addedAt: new Date().toISOString()
  };
  const ref = await addDoc(collection(db, 'users', currentUser.uid, 'trackedTokens'), data);
  trackedTokens.push({ id: ref.id, ...data });
}

async function removeTrackedToken(id) {
  await deleteDoc(doc(db, 'users', currentUser.uid, 'trackedTokens', id));
  trackedTokens = trackedTokens.filter(t => t.id !== id);
  refreshWatchlist();
}

async function loadTrackedWallets() {
  try {
    const col = collection(db, 'users', currentUser.uid, 'trackedWallets');
    const snap = await getDocs(col);
    trackedWallets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error('loadTrackedWallets:', e); }
}

async function saveWallet(addr, chain) {
  const data = { address: addr, chain, addedAt: new Date().toISOString() };
  const ref = await addDoc(collection(db, 'users', currentUser.uid, 'trackedWallets'), data);
  trackedWallets.push({ id: ref.id, ...data });
  renderSavedWallets();
}

async function removeWallet(id) {
  await deleteDoc(doc(db, 'users', currentUser.uid, 'trackedWallets', id));
  trackedWallets = trackedWallets.filter(w => w.id !== id);
  renderSavedWallets();
}

// ── Refresh watchlist ─────────────────────────────────────────────────────────
async function refreshWatchlist() {
  if (!trackedTokens.length) { renderWatchlist(null, null); return; }
  const chains = ['bsc', 'eth', 'sol'];
  const allPairs = {};
  for (const chain of chains) {
    const group = trackedTokens.filter(t => t.chain === chain);
    if (!group.length) continue;
    try {
      const pairs = await batchFetchByChain(group, chain);
      Object.assign(allPairs, pairs);
    } catch (e) { console.error(`refresh ${chain}:`, e); }
  }

  const holdersMap = {};
  const holderPromises = trackedTokens.map(async (t) => {
    try {
      const count = await fetchHolderCount(t.contractAddress, t.chain);
      if (count != null) holdersMap[t.contractAddress.toLowerCase()] = count;
    } catch (_) {}
  });
  await Promise.allSettled(holderPromises);

  renderWatchlist(allPairs, holdersMap);
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  countdown = 10;
  updateCountdownLabel();
  refreshTimer = setInterval(async () => {
    countdown--;
    updateCountdownLabel();
    if (countdown <= 0) {
      countdown = 10;
      await refreshWatchlist();
    }
  }, 1000);
}

function updateCountdownLabel() {
  const lbl = document.getElementById('refreshLabel');
  if (lbl) lbl.textContent = `Auto-refresh: ${countdown}s`;
}

// ── Saved wallets list ────────────────────────────────────────────────────────
function renderSavedWallets() {
  const el = document.getElementById('savedWalletsList');
  if (!el) return;
  if (!trackedWallets.length) {
    el.innerHTML = '<div class="empty-state">No wallets saved yet. Look up a wallet above!</div>';
    return;
  }
  el.innerHTML = trackedWallets.map(w => `
    <div class="saved-wallet-card" data-addr="${w.address}" data-chain="${w.chain}">
      ${chainBadge(w.chain)}
      <span class="saved-wallet-addr">${w.address}</span>
      <button class="saved-wallet-remove" data-id="${w.id}" title="Remove">✕</button>
    </div>`).join('');
  el.querySelectorAll('.saved-wallet-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('saved-wallet-remove')) return;
      walletChain = card.dataset.chain;
      document.getElementById('walletAddressInput').value = card.dataset.addr;
      switchTab('wallet');
      loadWallet(card.dataset.addr, card.dataset.chain);
    });
  });
  el.querySelectorAll('.saved-wallet-remove').forEach(btn => {
    btn.addEventListener('click', () => removeWallet(btn.dataset.id));
  });
}

// ── Tab switch ────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tracker-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tracker-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
}

// ── Token lookup ──────────────────────────────────────────────────────────────
async function lookupToken(addr, chain) {
  const el = document.getElementById('tokenLookupResult');
  el.innerHTML = '<div class="loading-msg"><span class="spinner"></span>Fetching token data...</div>';
  const btn = document.getElementById('lookupTokenBtn');
  btn.disabled = true; btn.textContent = 'Loading...';
  try {
    const pair = await fetchTokenPairs(addr.trim(), chain);
    const alreadySaved = trackedTokens.some(t => t.contractAddress.toLowerCase() === addr.toLowerCase() && t.chain === chain);
    el.innerHTML = renderTokenResultCard(pair, chain, addr, alreadySaved, null);
    if (!alreadySaved) {
      document.getElementById('saveWatchlistBtn')?.addEventListener('click', async () => {
        await saveTrackedToken(pair, addr.trim(), chain);
        const holders = await fetchHolderCount(addr.trim(), chain);
        el.innerHTML = renderTokenResultCard(pair, chain, addr, true, holders);
        refreshWatchlist();
      });
    }
    fetchHolderCount(addr.trim(), chain).then(holders => {
      const holderEl = document.getElementById('holderCountVal');
      if (holderEl) holderEl.textContent = holders != null ? fmtNum(holders) : 'N/A';
    });
  } catch (e) {
    el.innerHTML = `<div class="tracker-error">❌ ${e.message}</div>`;
  } finally { btn.disabled = false; btn.textContent = 'Track Token'; }
}

// ── Wallet lookup ─────────────────────────────────────────────────────────────
async function loadWallet(addr, chain) {
  const el = document.getElementById('walletResult');
  el.style.display = 'block';
  el.innerHTML = '<div class="loading-msg"><span class="spinner"></span>Loading wallet holdings...</div>';
  const btn = document.getElementById('lookupWalletBtn');
  btn.disabled = true; btn.textContent = 'Loading...';
  try {
    let tokens = [];
    if (chain === 'sol') {
      const rawTokens = await fetchWalletTokens(addr.trim(), 'sol');
      const mints = rawTokens.map(t => t.mint);
      const BATCH = 30;
      const pairMap = {};
      for (let i = 0; i < mints.length; i += BATCH) {
        const chunk = mints.slice(i, i + BATCH).join(',');
        try {
          const res = await fetch(`${DS_BASE}/tokens/v1/solana/${chunk}`);
          if (res.ok) {
            const pairs = await res.json();
            if (Array.isArray(pairs)) {
              for (const p of pairs) {
                const m = p.baseToken?.address?.toLowerCase();
                if (m && (!pairMap[m] || (p.liquidity?.usd || 0) > (pairMap[m].liquidity?.usd || 0))) pairMap[m] = p;
              }
            }
          }
        } catch (_) {}
      }
      tokens = rawTokens.map(t => {
        const pair = pairMap[t.mint.toLowerCase()];
        const price = pair?.priceUsd ? parseFloat(pair.priceUsd) : 0;
        return {
          symbol: pair?.baseToken?.symbol || shortAddr(t.mint),
          name: pair?.baseToken?.name || '',
          mint: t.mint,
          balance: t.balance,
          priceUsd: price || null,
          change24h: pair?.priceChange?.h24 ?? null,
          usdValue: price ? t.balance * price : null
        };
      }).sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
    } else {
      tokens = await fetchWalletTokens(addr.trim(), chain);
      tokens.sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
    }
    lastWalletData = { tokens, addr, chain };
    el.innerHTML = renderHoldingsTable(tokens, addr, chain);
    document.getElementById('saveWalletBtn')?.addEventListener('click', async () => {
      const alreadySaved = trackedWallets.some(w => w.address.toLowerCase() === addr.toLowerCase() && w.chain === chain);
      if (alreadySaved) { alert('Wallet already saved!'); return; }
      await saveWallet(addr.trim(), chain);
      alert('Wallet saved!');
    });
  } catch (e) {
    el.innerHTML = `<div class="tracker-error">❌ ${e.message}</div>`;
  } finally { btn.disabled = false; btn.textContent = 'Load Wallet'; }
}

// ── Nav & auth helpers ────────────────────────────────────────────────────────
function setupNav() {
  const menuBtn    = document.getElementById('menuBtn');
  const sideMenu   = document.getElementById('sideMenu');
  const closeMenuBtn = document.getElementById('closeMenuBtn');
  const overlay    = document.getElementById('menuOverlay');
  const openMenu   = e => { e.stopPropagation(); sideMenu.classList.add('open'); overlay?.classList.add('visible'); };
  const closeMenu  = () => { sideMenu.classList.remove('open'); overlay?.classList.remove('visible'); };
  menuBtn.addEventListener('click', openMenu);
  menuBtn.addEventListener('touchstart', openMenu);
  closeMenuBtn.addEventListener('click', closeMenu);
  closeMenuBtn.addEventListener('touchstart', closeMenu);
  overlay?.addEventListener('click', closeMenu);
  document.getElementById('sideLogoutBtn').onclick = () =>
    signOut(auth).then(() => { window.location.href = 'login.html'; });
}

async function setProfileInitials(user) {
  let initials = user.email[0].toUpperCase();
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const d = snap.data();
      if (d.firstName || d.lastName) {
        initials = ((d.firstName?.[0] || '') + (d.lastName?.[0] || '')).toUpperCase();
      }
    }
  } catch (_) {}
  document.getElementById('profileInitials').textContent = initials;
}

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupNav();

  document.querySelectorAll('.tracker-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('#tokenChainPills .chain-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#tokenChainPills .chain-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      tokenChain = pill.dataset.chain;
    });
  });

  document.querySelectorAll('#walletChainPills .chain-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#walletChainPills .chain-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      walletChain = pill.dataset.chain;
    });
  });

  document.getElementById('lookupTokenBtn').addEventListener('click', () => {
    const addr = document.getElementById('tokenAddressInput').value.trim();
    if (!addr) return;
    lookupToken(addr, tokenChain);
  });

  document.getElementById('tokenAddressInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('lookupTokenBtn').click();
  });

  document.getElementById('lookupWalletBtn').addEventListener('click', () => {
    const addr = document.getElementById('walletAddressInput').value.trim();
    if (!addr) return;
    loadWallet(addr, walletChain);
  });

  document.getElementById('walletAddressInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('lookupWalletBtn').click();
  });

  requireAuth(async (user) => {
    currentUser = user;
    await setProfileInitials(user);
    await loadTrackedTokens();
    await loadTrackedWallets();
    await refreshWatchlist();
    renderSavedWallets();
    startAutoRefresh();
  });
});

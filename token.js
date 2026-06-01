import { requireAuth } from './authObserver.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";
import { fns } from './firebase.js';

const DS_BASE  = 'https://api.dexscreener.com';
const CHAIN_ID = { bsc: 'bsc', eth: 'ethereum', sol: 'solana' };

const params  = new URLSearchParams(window.location.search);
const chain   = params.get('chain')   || '';
const address = params.get('address') || '';

const getTokenHoldersFn = httpsCallable(fns, 'getTokenHolders');

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtUSD(n) {
  if (n == null || isNaN(n)) return 'N/A';
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
  if (n < 0.01)     return `$${n.toFixed(8)}`;
  if (n < 1)        return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function fmtChange(val) {
  if (val == null) return { text: 'N/A', cls: '' };
  const n = parseFloat(val);
  return {
    text: `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`,
    cls:  n >= 0 ? 'price-up' : 'price-down'
  };
}

function chainBadge(c) {
  const labels = { bsc: 'BSC', eth: 'ETH', sol: 'SOL' };
  return `<span class="chain-badge ${c}">${labels[c] || c.toUpperCase()}</span>`;
}

function explorerLink(c, addr) {
  if (c === 'bsc') return `https://bscscan.com/token/${addr}`;
  if (c === 'eth') return `https://etherscan.io/token/${addr}`;
  return `https://solscan.io/token/${addr}`;
}

// ── Data fetchers ─────────────────────────────────────────────────────────────
async function fetchPairs() {
  const res = await fetch(`${DS_BASE}/token-pairs/v1/${CHAIN_ID[chain]}/${address}`);
  if (!res.ok) throw new Error(`DexScreener error: ${res.status}`);
  const pairs = await res.json();
  if (!Array.isArray(pairs) || !pairs.length) throw new Error('Token not found on DexScreener.');
  return pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
}

async function fetchHolders() {
  try {
    const result = await getTokenHoldersFn({ chain, contractAddress: address });
    return result.data.holders;
  } catch (_) { return null; }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderPairs(pairs, holders) {
  const best  = pairs[0];
  const token = best.baseToken || {};
  const logo  = best.info?.imageUrl || '';

  const ch5m = fmtChange(best.priceChange?.m5);
  const ch1h = fmtChange(best.priceChange?.h1);
  const ch6h = fmtChange(best.priceChange?.h6);
  const ch24 = fmtChange(best.priceChange?.h24);

  const created = best.pairCreatedAt
    ? new Date(best.pairCreatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'N/A';

  const holdersText = holders != null ? holders.toLocaleString() : 'N/A';

  const otherPairs = pairs.slice(0, 5).map(p => `
    <div class="td-pair-row">
      <span class="td-pair-dex">${p.dexId || '—'}</span>
      <span class="td-pair-liq">${p.liquidity?.usd ? fmtUSD(p.liquidity.usd) : '—'} liq</span>
      <span class="td-pair-price">${fmtPrice(p.priceUsd)}</span>
      ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener" class="td-pair-link">↗</a>` : ''}
    </div>`).join('');

  return `
    <div class="td-header">
      ${logo ? `<img class="td-logo" src="${logo}" alt="" onerror="this.style.display='none'" />` : '<div class="td-logo-placeholder"></div>'}
      <div class="td-title">
        <h1 class="td-name">${token.name || 'Unknown Token'}</h1>
        <div class="td-meta">
          <span class="token-symbol">${token.symbol || ''}</span>
          ${chainBadge(chain)}
        </div>
      </div>
    </div>

    <div class="td-price">${fmtPrice(best.priceUsd)}</div>

    <div class="td-changes">
      <div class="td-change-item">
        <span class="td-ci-label">5m</span>
        <span class="td-ci-val ${ch5m.cls}">${ch5m.text}</span>
      </div>
      <div class="td-change-item">
        <span class="td-ci-label">1h</span>
        <span class="td-ci-val ${ch1h.cls}">${ch1h.text}</span>
      </div>
      <div class="td-change-item">
        <span class="td-ci-label">6h</span>
        <span class="td-ci-val ${ch6h.cls}">${ch6h.text}</span>
      </div>
      <div class="td-change-item">
        <span class="td-ci-label">24h</span>
        <span class="td-ci-val ${ch24.cls}">${ch24.text}</span>
      </div>
    </div>

    <div class="td-stats">
      <div class="td-stat">
        <span class="td-stat-label">Market Cap</span>
        <span class="td-stat-val">${best.marketCap ? fmtUSD(best.marketCap) : 'N/A'}</span>
      </div>
      <div class="td-stat">
        <span class="td-stat-label">Liquidity</span>
        <span class="td-stat-val">${best.liquidity?.usd ? fmtUSD(best.liquidity.usd) : 'N/A'}</span>
      </div>
      <div class="td-stat">
        <span class="td-stat-label">24h Volume</span>
        <span class="td-stat-val">${best.volume?.h24 ? fmtUSD(best.volume.h24) : 'N/A'}</span>
      </div>
      <div class="td-stat">
        <span class="td-stat-label">Holders</span>
        <span class="td-stat-val">${holdersText}</span>
      </div>
    </div>

    <div class="td-info">
      <div class="td-info-row">
        <span class="td-info-label">Top DEX</span>
        <span class="td-info-val">${best.dexId || 'N/A'}</span>
      </div>
      <div class="td-info-row">
        <span class="td-info-label">Pair</span>
        <span class="td-info-val td-mono">${best.pairAddress ? best.pairAddress.slice(0, 18) + '…' : 'N/A'}</span>
      </div>
      <div class="td-info-row">
        <span class="td-info-label">Pair Created</span>
        <span class="td-info-val">${created}</span>
      </div>
      <div class="td-info-row">
        <span class="td-info-label">Contract</span>
        <span class="td-info-val td-mono">${address.slice(0, 18)}…</span>
      </div>
    </div>

    <div class="td-links">
      <a href="${explorerLink(chain, address)}" target="_blank" rel="noopener" class="td-link-btn">
        View on Explorer ↗
      </a>
      ${best.url ? `<a href="${best.url}" target="_blank" rel="noopener" class="td-link-btn td-link-dex">View on DEX ↗</a>` : ''}
    </div>

    ${pairs.length > 1 ? `
    <div class="td-pairs-section">
      <h3 class="td-section-title">Trading Pairs</h3>
      <div class="td-pairs-list">${otherPairs}</div>
    </div>` : ''}
  `;
}

// ── Boot ───────────────────────────────────────────────────────────────────────
requireAuth(async () => {
  const el = document.getElementById('tokenDetailContent');

  if (!chain || !address) {
    el.innerHTML = '<div class="tracker-error">❌ Missing token address or chain.</div>';
    return;
  }

  try {
    const [pairs, holders] = await Promise.all([fetchPairs(), fetchHolders()]);
    el.innerHTML = renderPairs(pairs, holders);
    document.title = `${pairs[0].baseToken?.name || 'Token'} — FXcrypt`;
  } catch (e) {
    el.innerHTML = `<div class="tracker-error">❌ ${e.message}</div>`;
  }
});

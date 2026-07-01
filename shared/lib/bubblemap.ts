// ════════════════════════════════════════════════════════════════════════════
// BUBBLE MAP — on-chain holder graph visualizer
//   • Force-directed canvas of top holders sized by % supply
//   • Transfer links + cluster detection (union-find)
//   • Magic Nodes (intermediary discovery) · Time Travel (transfer replay)
//   • Click-to-inspect · filters · custom address · CSV export · permalinks
// ════════════════════════════════════════════════════════════════════════════
// @ts-nocheck
/* eslint-disable */
import { httpsCallable } from 'firebase/functions';
import { fns } from './firebase';

const getHolderGraphFn  = httpsCallable(fns, 'getHolderGraph');
const getPairTransfersFn = httpsCallable(fns, 'getPairTransfers');

const CLUSTER_COLORS = [
  '#00c853', '#F0B90B', '#627EEA', '#9945FF', '#0098EA', '#ff6b6b',
  '#26a69a', '#ec407a', '#42a5f5', '#ffa726', '#ab47bc', '#66bb6a'
];
const NEUTRAL = '#5a6472';
const MAGIC_COLOR = '#FCD535';

// ── Module state ───────────────────────────────────────────────────────────
let graph = null;            // { token, holders, edges, transfers }
let nodes = [];              // sim nodes
let edges = [];              // active edges (filtered)
let chain = 'bsc';
let view = { scale: 1, x: 0, y: 0 };
let selected = null;
let magicOn = false;
let travelTs = null;         // null = live/now
let customAddrs = [];
let filters = { minPct: 0, minEdge: 0, hideContracts: false };
let anim = null, alpha = 0;
let canvas, ctx, dpr = 1;
let drag = { node: null, panning: false, lastX: 0, lastY: 0, moved: false };

const $ = (id) => document.getElementById(id);
const lc = (a) => (a || '').toLowerCase();
const short = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
function fmtUSD(n) {
  if (n == null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${Number(n).toFixed(2)}`;
}
function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });
}
const EXPLORER = {
  bsc: 'https://bscscan.com/address/', eth: 'https://etherscan.io/address/',
  base: 'https://basescan.org/address/', sol: 'https://solscan.io/account/'
};

// ── Union-find for cluster detection ────────────────────────────────────────
function detectClusters(nodeList, edgeList) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  nodeList.forEach(n => parent.set(n.address, n.address));
  for (const e of edgeList) {
    if (!parent.has(e.from) || !parent.has(e.to)) continue;
    const ra = find(e.from), rb = find(e.to);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  nodeList.forEach(n => {
    const root = find(n.address);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  });
  // assign cluster ids only to groups with >1 member
  let cid = 0;
  const clusterOf = new Map();
  const clusterStats = new Map();
  for (const [, members] of groups) {
    if (members.length < 2) { members.forEach(m => clusterOf.set(m.address, -1)); continue; }
    const id = cid++;
    let pct = 0, usd = 0;
    members.forEach(m => { clusterOf.set(m.address, id); pct += m.pct || 0; usd += m.usdValue || 0; });
    clusterStats.set(id, { id, size: members.length, pct, usd });
  }
  return { clusterOf, clusterStats };
}

// ── Magic Nodes: intermediaries in transfer sample linking ≥2 holders ───────
function computeMagicNodes(holderSet) {
  const counter = new Map(); // intermediary -> Set(holders touched)
  const interEdges = [];
  for (const t of (graph.transfers || [])) {
    const f = lc(t.from), to = lc(t.to);
    const fH = holderSet.has(f), tH = holderSet.has(to);
    if (fH && !tH) { if (!counter.has(to)) counter.set(to, new Set()); counter.get(to).add(f); }
    if (tH && !fH) { if (!counter.has(f)) counter.set(f, new Set()); counter.get(f).add(to); }
  }
  const magic = [];
  for (const [addr, set] of counter) {
    if (set.size >= 2) magic.push({ address: addr, touches: [...set] });
  }
  // edges between magic node and the holders it touches
  for (const m of magic) for (const h of m.touches) interEdges.push({ from: m.address, to: h, value: 0, count: 1, magic: true });
  return { magic, interEdges };
}

// ── Time Travel: approximate balances by replaying transfers after T ────────
function balancesAt(ts) {
  const bal = new Map();
  graph.holders.forEach(h => bal.set(h.address, h.balance));
  if (ts == null) return bal;
  for (const t of (graph.transfers || [])) {
    if ((t.ts || 0) <= ts) continue;          // only undo transfers that happened AFTER T
    const f = lc(t.from), to = lc(t.to), v = t.value || 0;
    if (bal.has(to)) bal.set(to, bal.get(to) - v);
    if (bal.has(f)) bal.set(f, bal.get(f) + v);
  }
  return bal;
}

// ── Build the sim node/edge sets from current state ─────────────────────────
function rebuild() {
  if (!graph) return;
  const holderSet = new Set(graph.holders.map(h => h.address));
  const balMap = balancesAt(travelTs);
  const totalSupplyApprox = graph.holders.reduce((s, h) => s + (h.balance || 0), 0);

  // base holder nodes
  let list = graph.holders.map(h => {
    const bal = balMap.get(h.address) ?? h.balance;
    const pct = (travelTs != null && totalSupplyApprox)
      ? (bal / totalSupplyApprox) * 100 : h.pct;
    return { ...h, balance: bal, pct, _magic: false };
  }).filter(h => h.balance > 0);

  // filters
  if (filters.minPct > 0) list = list.filter(n => (n.pct || 0) >= filters.minPct);
  if (filters.hideContracts) list = list.filter(n => !n.isContract);

  // custom addresses
  for (const ca of customAddrs) {
    if (list.some(n => n.address === ca)) continue;
    const h = graph.holders.find(x => x.address === ca);
    list.push(h ? { ...h, _custom: true } : { address: ca, balance: 0, pct: 0, usdValue: null, isContract: false, label: '', _custom: true });
  }

  // active edges (filtered by min transfer value) among visible nodes
  const visible = new Set(list.map(n => n.address));
  let activeEdges = (graph.edges || []).filter(e =>
    visible.has(e.from) && visible.has(e.to) && (e.value || 0) >= filters.minEdge);

  // magic nodes
  if (magicOn) {
    const { magic, interEdges } = computeMagicNodes(holderSet);
    for (const m of magic) {
      if (!visible.has(m.address)) {
        list.push({ address: m.address, balance: 0, pct: 0, usdValue: null, isContract: false, label: 'intermediary', _magic: true });
        visible.add(m.address);
      }
    }
    activeEdges = activeEdges.concat(interEdges.filter(e => visible.has(e.from) && visible.has(e.to)));
  }

  // clusters
  const { clusterOf, clusterStats } = detectClusters(list, activeEdges);
  window.__clusterStats = clusterStats;

  // radius scale by sqrt(pct)
  const maxPct = Math.max(...list.map(n => n.pct || 0), 0.0001);
  const cx = canvas.width / dpr / 2, cy = canvas.height / dpr / 2;
  const prev = new Map(nodes.map(n => [n.address, n]));
  nodes = list.map(n => {
    const p = prev.get(n.address);
    const r = n._magic ? 6 : Math.max(5, Math.min(46, 7 + Math.sqrt((n.pct || 0) / maxPct) * 40));
    return {
      ...n, r,
      cluster: clusterOf.get(n.address) ?? -1,
      x: p ? p.x : cx + (Math.random() - 0.5) * 300,
      y: p ? p.y : cy + (Math.random() - 0.5) * 300,
      vx: 0, vy: 0
    };
  });
  edges = activeEdges;

  renderClusterBar(clusterStats);
  alpha = 1; startSim();
}

// ── Force simulation ────────────────────────────────────────────────────────
function startSim() {
  if (anim) cancelAnimationFrame(anim);
  const cx = canvas.width / dpr / 2, cy = canvas.height / dpr / 2;
  const idx = new Map(nodes.map((n, i) => [n.address, i]));

  function tick() {
    const k = alpha;
    // repulsion (O(n^2), fine for ≤300)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const minD = a.r + b.r + 4;
        const force = (a.r * b.r * 0.8) / d2;
        const d = Math.sqrt(d2);
        let fx = (dx / d) * force * 60 * k, fy = (dy / d) * force * 60 * k;
        // collision separation
        if (d < minD) { const push = (minD - d) * 0.5; fx += (dx / d) * push; fy += (dy / d) * push; }
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    // spring along edges
    for (const e of edges) {
      const a = nodes[idx.get(e.from)], b = nodes[idx.get(e.to)];
      if (!a || !b) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const target = (a.r + b.r) + 40;
      const f = (d - target) * 0.02 * k;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    // gravity to center + integrate
    for (const n of nodes) {
      if (n === drag.node) { n.vx = 0; n.vy = 0; continue; }
      n.vx += (cx - n.x) * 0.005 * k;
      n.vy += (cy - n.y) * 0.005 * k;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x += n.vx; n.y += n.vy;
    }
    alpha *= 0.985;
    render();
    if (alpha > 0.02) anim = requestAnimationFrame(tick);
  }
  anim = requestAnimationFrame(tick);
}

// ── Render ──────────────────────────────────────────────────────────────────
function render() {
  if (!ctx) return;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  const idx = new Map(nodes.map((n, i) => [n.address, i]));
  const selAddr = selected?.address;
  const neighborSet = new Set();
  if (selAddr) edges.forEach(e => { if (e.from === selAddr) neighborSet.add(e.to); if (e.to === selAddr) neighborSet.add(e.from); });

  // edges
  for (const e of edges) {
    const a = nodes[idx.get(e.from)], b = nodes[idx.get(e.to)];
    if (!a || !b) continue;
    const hot = selAddr && (e.from === selAddr || e.to === selAddr);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = e.magic ? 'rgba(252,213,53,0.35)' : (hot ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.10)');
    ctx.lineWidth = (hot ? 1.6 : 0.8) / view.scale;
    ctx.stroke();
  }
  // nodes
  for (const n of nodes) {
    const dim = selAddr && n.address !== selAddr && !neighborSet.has(n.address);
    let color = n._magic ? MAGIC_COLOR : (n.cluster >= 0 ? CLUSTER_COLORS[n.cluster % CLUSTER_COLORS.length] : NEUTRAL);
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.globalAlpha = dim ? 0.18 : 1;
    ctx.fillStyle = color;
    ctx.fill();
    if (n.isContract) { ctx.lineWidth = 2 / view.scale; ctx.strokeStyle = '#181A20'; ctx.setLineDash([3 / view.scale, 2 / view.scale]); ctx.stroke(); ctx.setLineDash([]); }
    if (n._custom) { ctx.lineWidth = 2.5 / view.scale; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    if (n.address === selAddr) { ctx.lineWidth = 3 / view.scale; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    ctx.globalAlpha = 1;
    // label for large bubbles
    if (n.r > 16 && view.scale > 0.5) {
      ctx.fillStyle = '#0B0E11';
      ctx.font = `bold ${Math.max(8, n.r / 2.6)}px Inter, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((n.pct || 0).toFixed(1) + '%', n.x, n.y);
    }
  }
  ctx.restore();
}

// ── Coordinate helpers ──────────────────────────────────────────────────────
function toGraph(px, py) {
  return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
}
function nodeAt(px, py) {
  const g = toGraph(px, py);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if ((g.x - n.x) ** 2 + (g.y - n.y) ** 2 <= n.r * n.r) return n;
  }
  return null;
}

// ── Inspect panel ───────────────────────────────────────────────────────────
function selectNode(n) {
  selected = n;
  render();
  const panel = $('bubbleInspect');
  if (!n) { panel.classList.remove('open'); return; }
  const stats = window.__clusterStats;
  const cstat = (n.cluster >= 0 && stats) ? stats.get(n.cluster) : null;
  const nbrs = [];
  edges.forEach(e => { if (e.from === n.address) nbrs.push(e.to); else if (e.to === n.address) nbrs.push(e.from); });
  const uniqNbrs = [...new Set(nbrs)];

  panel.innerHTML = `
    <div class="bm-inspect-head">
      <span class="bm-inspect-title">${n._magic ? '🪄 Intermediary' : (n.isContract ? '📜 Contract' : '👛 Wallet')}</span>
      <button class="bm-inspect-close" id="bmInspectClose">✕</button>
    </div>
    <div class="bm-addr-row">
      <a href="${(EXPLORER[chain] || '') + n.address}" target="_blank" rel="noopener" title="${n.address}">${short(n.address)} ↗</a>
      <button class="bm-copy" data-copy="${n.address}">Copy</button>
    </div>
    ${n.label ? `<div class="bm-label-chip">${n.label}</div>` : ''}
    <div class="bm-stat-grid">
      <div class="bm-stat"><span>% Supply</span><b>${n.pct != null ? n.pct.toFixed(3) + '%' : '—'}</b></div>
      <div class="bm-stat"><span>Tokens</span><b>${fmtNum(n.balance)}</b></div>
      <div class="bm-stat"><span>USD Value</span><b>${fmtUSD(n.usdValue)}</b></div>
      <div class="bm-stat"><span>Cluster</span><b>${n.cluster >= 0 ? '#' + (n.cluster + 1) : 'None'}</b></div>
    </div>
    ${cstat ? `<div class="bm-cluster-box">
        <div class="bm-cluster-title">🔗 Cluster #${cstat.id + 1} aggregate</div>
        <div class="bm-cluster-line">${cstat.size} wallets · ${cstat.pct.toFixed(2)}% supply · ${fmtUSD(cstat.usd)}</div>
      </div>` : ''}
    <div class="bm-nbr-title">Connections (${uniqNbrs.length})</div>
    <div class="bm-nbr-list">
      ${uniqNbrs.length ? uniqNbrs.slice(0, 30).map(a => `
        <button class="bm-nbr" data-pair="${a}">${short(a)} <span>IN/OUT ↗</span></button>`).join('')
      : '<div class="bm-empty">No transfer links in the loaded sample.</div>'}
    </div>
    <div id="bmPairHist"></div>`;
  panel.classList.add('open');

  $('bmInspectClose').onclick = () => selectNode(null);
  panel.querySelectorAll('.bm-copy').forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy));
  panel.querySelectorAll('.bm-nbr').forEach(b => b.onclick = () => loadPairHistory(n.address, b.dataset.pair));
}

async function loadPairHistory(a, b) {
  const box = $('bmPairHist');
  box.innerHTML = '<div class="bm-loading"><span class="spinner"></span>Loading transfer history…</div>';
  try {
    const res = await getPairTransfersFn({ chain, addrA: a, addrB: b });
    const list = res.data.transfers || [];
    box.innerHTML = `
      <div class="bm-pair-title">${short(a)} ⇄ ${short(b)}</div>
      ${list.length ? `<div class="bm-pair-list">${list.slice(0, 40).map(t => `
        <div class="bm-pair-row ${t.direction === 'IN' ? 'in' : 'out'}">
          <span class="bm-dir">${t.direction}</span>
          <span class="bm-pair-amt">${fmtNum(t.amount)} ${t.symbol || ''}</span>
          <span class="bm-pair-date">${t.ts ? new Date(t.ts).toLocaleDateString() : ''}</span>
        </div>`).join('')}</div>`
      : '<div class="bm-empty">No direct transfers found between these wallets.</div>'}`;
  } catch (e) {
    box.innerHTML = `<div class="tracker-error">${e.message || 'Failed to load history.'}</div>`;
  }
}

// ── Cluster legend bar ──────────────────────────────────────────────────────
function renderClusterBar(clusterStats) {
  const bar = $('bmClusterBar');
  if (!bar) return;
  const arr = [...clusterStats.values()].sort((a, b) => b.pct - a.pct).slice(0, 8);
  if (!arr.length) { bar.innerHTML = '<span class="bm-legend-empty">No coordinated clusters detected in the loaded transfer sample.</span>'; return; }
  bar.innerHTML = `<span class="bm-legend-label">Clusters:</span>` + arr.map(c => `
    <span class="bm-legend-item" style="--cc:${CLUSTER_COLORS[c.id % CLUSTER_COLORS.length]}">
      #${c.id + 1} · ${c.size}w · ${c.pct.toFixed(1)}%
    </span>`).join('');
}

// ── CSV export ──────────────────────────────────────────────────────────────
function exportCSV() {
  const rows = [['address', 'label', 'balance', 'pct_supply', 'usd_value', 'cluster', 'is_contract']];
  nodes.forEach(n => rows.push([
    n.address, (n.label || '').replace(/,/g, ' '), n.balance,
    n.pct != null ? n.pct.toFixed(6) : '', n.usdValue != null ? n.usdValue.toFixed(2) : '',
    n.cluster >= 0 ? n.cluster + 1 : '', n.isContract ? 'yes' : 'no'
  ]));
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `bubblemap_${chain}_${graph?.token?.symbol || 'token'}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Permalink ───────────────────────────────────────────────────────────────
function buildPermalink() {
  const state = {
    c: chain, a: graph?.token?.address || '',
    f: filters, m: magicOn ? 1 : 0, t: travelTs, ca: customAddrs
  };
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  const url = `${location.origin}${location.pathname}?tab=bubble&map=${enc}`;
  navigator.clipboard?.writeText(url);
  const btn = $('bmPermalinkBtn');
  if (btn) { const o = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = o, 1500); }
  return url;
}
function readPermalink() {
  const p = new URLSearchParams(location.search);
  if (p.get('map')) {
    try {
      const s = JSON.parse(decodeURIComponent(escape(atob(p.get('map')))));
      return s;
    } catch (_) {}
  }
  return null;
}

// ── Load graph from backend ─────────────────────────────────────────────────
async function generateMap(addr, restore) {
  const status = $('bmStatus');
  const btn = $('generateMapBtn');
  btn.disabled = true; btn.textContent = 'Loading…';
  status.innerHTML = `<div class="bm-loading"><span class="spinner"></span>Fetching top holders & transfers on ${chain.toUpperCase()}…</div>`;
  $('bubbleStage').style.display = 'none';
  try {
    const res = await getHolderGraphFn({ chain, contractAddress: addr });
    graph = res.data;
    graph.holders = (graph.holders || []).map(h => ({ ...h, address: lc(h.address) }));
    graph.edges = (graph.edges || []).map(e => ({ ...e, from: lc(e.from), to: lc(e.to) }));
    if (!graph.holders.length) throw new Error('No holders returned for this token.');

    // token header
    const t = graph.token || {};
    $('bmTokenHead').innerHTML = `
      <div class="bm-token-name">${t.name || 'Token'} <span>${t.symbol || ''}</span></div>
      <div class="bm-token-sub">${graph.holders.length} holders mapped · ${graph.transfers?.length || 0} transfers sampled · ${chain.toUpperCase()}</div>`;

    // restore state
    if (restore) {
      filters = restore.f || filters;
      magicOn = !!restore.m; travelTs = restore.t ?? null; customAddrs = restore.ca || [];
      $('bmMinPct').value = filters.minPct || 0;
      $('bmMinEdge').value = filters.minEdge || 0;
      $('bmHideContracts').checked = !!filters.hideContracts;
      $('bmMagicToggle').checked = magicOn;
    }

    // time-travel slider range
    const tss = (graph.transfers || []).map(x => x.ts).filter(Boolean);
    const slider = $('bmTravel');
    if (tss.length) {
      const min = Math.min(...tss), max = Math.max(...tss);
      slider.min = min; slider.max = max; slider.step = Math.max(1, Math.floor((max - min) / 200));
      slider.value = travelTs ?? max;
      slider.disabled = false;
      updateTravelLabel();
    } else { slider.disabled = true; $('bmTravelLabel').textContent = 'No transfer history for replay'; }

    $('bubbleStage').style.display = 'block';
    status.innerHTML = '';
    resizeCanvas();
    view = { scale: 1, x: 0, y: 0 };
    selectNode(null);
    rebuild();
  } catch (e) {
    status.innerHTML = `<div class="tracker-error">❌ ${e.message || 'Failed to generate map.'}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Generate Map';
  }
}

function updateTravelLabel() {
  const lbl = $('bmTravelLabel');
  if (travelTs == null) { lbl.textContent = '⏱ Live (now)'; return; }
  lbl.textContent = `⏱ ${new Date(travelTs).toLocaleString()} (approx.)`;
}

// ── Canvas sizing ───────────────────────────────────────────────────────────
function resizeCanvas() {
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  render();
}

// ── DOM scaffolding (injected once) ─────────────────────────────────────────
function buildScaffold() {
  const wrap = $('bubbleMapWrap');
  wrap.innerHTML = `
    <div id="bmTokenHead" class="bm-token-head"></div>
    <div id="bmStatus" class="bm-status"></div>

    <div id="bubbleStage" class="bm-stage" style="display:none;">
      <div class="bm-toolbar">
        <div class="bm-tool-group">
          <label>Min % supply</label>
          <input type="number" id="bmMinPct" class="bm-mini-input" min="0" step="0.1" value="0" />
        </div>
        <div class="bm-tool-group">
          <label>Min transfer</label>
          <input type="number" id="bmMinEdge" class="bm-mini-input" min="0" step="1" value="0" />
        </div>
        <label class="bm-check"><input type="checkbox" id="bmHideContracts" /> Hide contracts</label>
        <label class="bm-check"><input type="checkbox" id="bmMagicToggle" /> 🪄 Magic Nodes</label>
        <div class="bm-tool-group bm-grow">
          <input type="text" id="bmCustomAddr" class="bm-mini-input" placeholder="Add custom wallet address…" />
          <button id="bmAddCustom" class="bm-tool-btn">+ Add</button>
        </div>
        <button id="bmExportBtn" class="bm-tool-btn">⬇ CSV</button>
        <button id="bmPermalinkBtn" class="bm-tool-btn">🔗 Permalink</button>
      </div>

      <div class="bm-travel-row">
        <span id="bmTravelLabel" class="bm-travel-label">⏱ Live (now)</span>
        <input type="range" id="bmTravel" class="bm-travel-slider" disabled />
        <button id="bmTravelLive" class="bm-tool-btn">Live</button>
      </div>

      <div id="bmClusterBar" class="bm-cluster-bar"></div>

      <div class="bm-canvas-wrap">
        <canvas id="bubbleCanvas"></canvas>
        <div class="bm-zoom-ctrl">
          <button id="bmZoomIn">+</button>
          <button id="bmZoomOut">−</button>
          <button id="bmZoomReset">⟳</button>
        </div>
        <div id="bubbleInspect" class="bm-inspect"></div>
        <div class="bm-hint">Drag to pan · scroll to zoom · click a bubble to inspect</div>
      </div>
    </div>`;

  canvas = $('bubbleCanvas');
  ctx = canvas.getContext('2d');
  wireControls();
  wireCanvas();
  window.addEventListener('resize', () => { if ($('bubbleStage').style.display !== 'none') resizeCanvas(); });
}

function wireControls() {
  const reapply = () => {
    filters.minPct = parseFloat($('bmMinPct').value) || 0;
    filters.minEdge = parseFloat($('bmMinEdge').value) || 0;
    filters.hideContracts = $('bmHideContracts').checked;
    rebuild();
  };
  $('bmMinPct').addEventListener('change', reapply);
  $('bmMinEdge').addEventListener('change', reapply);
  $('bmHideContracts').addEventListener('change', reapply);
  $('bmMagicToggle').addEventListener('change', e => { magicOn = e.target.checked; rebuild(); });
  $('bmAddCustom').addEventListener('click', () => {
    const v = lc($('bmCustomAddr').value.trim());
    if (v && !customAddrs.includes(v)) { customAddrs.push(v); $('bmCustomAddr').value = ''; rebuild(); }
  });
  $('bmExportBtn').addEventListener('click', exportCSV);
  $('bmPermalinkBtn').addEventListener('click', buildPermalink);
  $('bmTravel').addEventListener('input', e => { travelTs = parseInt(e.target.value, 10); updateTravelLabel(); rebuild(); });
  $('bmTravelLive').addEventListener('click', () => {
    travelTs = null; updateTravelLabel();
    const s = $('bmTravel'); if (!s.disabled) s.value = s.max;
    rebuild();
  });
  $('bmZoomIn').addEventListener('click', () => zoomBy(1.25));
  $('bmZoomOut').addEventListener('click', () => zoomBy(0.8));
  $('bmZoomReset').addEventListener('click', () => { view = { scale: 1, x: 0, y: 0 }; render(); });
}

function zoomBy(f) {
  const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
  const g = toGraph(cx, cy);
  view.scale = Math.max(0.15, Math.min(5, view.scale * f));
  view.x = cx - g.x * view.scale; view.y = cy - g.y * view.scale;
  render();
}

function wireCanvas() {
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const g = toGraph(mx, my);
    const f = e.deltaY < 0 ? 1.1 : 0.9;
    view.scale = Math.max(0.15, Math.min(5, view.scale * f));
    view.x = mx - g.x * view.scale; view.y = my - g.y * view.scale;
    render();
  }, { passive: false });

  const down = (mx, my) => {
    const n = nodeAt(mx, my);
    drag.moved = false;
    if (n) { drag.node = n; }
    else { drag.panning = true; }
    drag.lastX = mx; drag.lastY = my;
  };
  const move = (mx, my) => {
    if (drag.node) {
      const g = toGraph(mx, my);
      drag.node.x = g.x; drag.node.y = g.y; drag.moved = true;
      render();
    } else if (drag.panning) {
      view.x += mx - drag.lastX; view.y += my - drag.lastY;
      drag.lastX = mx; drag.lastY = my; drag.moved = true;
      render();
    }
  };
  const up = (mx, my) => {
    if (!drag.moved) { const n = nodeAt(mx, my); selectNode(n); }
    drag.node = null; drag.panning = false;
  };

  canvas.addEventListener('mousedown', e => { const r = canvas.getBoundingClientRect(); down(e.clientX - r.left, e.clientY - r.top); });
  window.addEventListener('mousemove', e => { if (!drag.node && !drag.panning) return; const r = canvas.getBoundingClientRect(); move(e.clientX - r.left, e.clientY - r.top); });
  window.addEventListener('mouseup', e => { if (!drag.node && !drag.panning) return; const r = canvas.getBoundingClientRect(); up(e.clientX - r.left, e.clientY - r.top); });

  canvas.addEventListener('touchstart', e => { const t = e.touches[0]; const r = canvas.getBoundingClientRect(); down(t.clientX - r.left, t.clientY - r.top); }, { passive: true });
  canvas.addEventListener('touchmove', e => { if (!drag.node && !drag.panning) return; e.preventDefault(); const t = e.touches[0]; const r = canvas.getBoundingClientRect(); move(t.clientX - r.left, t.clientY - r.top); }, { passive: false });
  canvas.addEventListener('touchend', e => { const r = canvas.getBoundingClientRect(); const t = e.changedTouches[0]; up(t.clientX - r.left, t.clientY - r.top); });
}

// ── Public init (called from tracker.js after auth) ─────────────────────────
export function initBubbleMap() {
  if (!$('bubbleMapWrap')) return;
  buildScaffold();

  document.querySelectorAll('#bubbleChainPills .chain-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#bubbleChainPills .chain-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      chain = pill.dataset.chain;
    });
  });
  $('generateMapBtn').addEventListener('click', () => {
    const addr = $('bubbleAddressInput').value.trim();
    if (addr) generateMap(addr);
  });
  $('bubbleAddressInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('generateMapBtn').click(); });

  // auto-restore from permalink
  const restore = readPermalink();
  if (restore && restore.a) {
    chain = restore.c || 'bsc';
    document.querySelectorAll('#bubbleChainPills .chain-pill').forEach(p => p.classList.toggle('active', p.dataset.chain === chain));
    $('bubbleAddressInput').value = restore.a;
    // ensure bubble tab visible
    document.querySelector('.tracker-tab-btn[data-tab="bubble"]')?.click();
    generateMap(restore.a, restore);
  }
}

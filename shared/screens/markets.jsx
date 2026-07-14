// markets.jsx — Tracker: token list, watchlist, token detail, bubble map
const { useState: mS, useEffect: mE, useRef: mR } = React;

function Markets({ go }) {
  const FX = window.FX;
  const [tab, setTab] = mS('watchlist');
  const [q, setQ] = mS('');
  const [results, setResults] = mS([]);   // live cross-chain market search results
  const [searching, setSearching] = mS(false);

  // Search ANY coin/token in the market (DexScreener) as the user types — not
  // just the curated top-100 list. Debounced; local matches render instantly.
  mE(() => {
    const term = q.trim();
    setResults([]);
    if (term.length < 2 || !(window.FXLive && window.FXLive.searchTokens)) { setSearching(false); return; }
    setSearching(true);
    let alive = true;
    const timer = setTimeout(async () => {
      try { const r = await window.FXLive.searchTokens(term); if (alive) setResults(r); }
      finally { if (alive) setSearching(false); }
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  // Re-render when the watchlist or live market data changes.
  const [, force] = mS(0);
  mE(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('fx:update', h);
    if (window.FXWatch && !window.FXWatch.ready()) window.FXWatch.load();
    return () => window.removeEventListener('fx:update', h);
  }, []);

  let list;
  if (q) {
    const term = q.toLowerCase();
    const local = FX.tokens.filter(t => (t.sym + ' ' + t.name).toLowerCase().includes(term));
    // Merge: curated matches first, then live results not already shown.
    const seen = new Set(local.map(t => (t.chain + ':' + t.sym).toLowerCase()));
    const extra = results.filter(t => {
      const k = (t.chain + ':' + t.sym).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    list = [...local, ...extra];
  } else {
    list = FX.tokens;
    if (tab === 'watchlist') {
      // Favourited CoinGecko coins + any on-chain tokens saved to the watchlist.
      const favs = list.filter(t => t.fav);
      const watchRows = window.FXWatch ? window.FXWatch.rows() : [];
      list = [...favs, ...watchRows];
    }
    else if (tab === 'gainers') list = [...list].sort((a, b) => b.ch24 - a.ch24);
    else if (tab === 'trending') list = [...list].sort((a, b) => parseFloat(b.vol) - parseFloat(a.vol));
  }
  const chainName = (t) => (window.FX.chains.find(c => c.id === t.chain) || {}).name || t.chainId || t.chain;

  return (
    <div>
      <TopBar title="Markets" sub="Tracker · watchlist & analytics"
        right={<><IconBtn name="scan" onClick={() => go('scanner')} /><IconBtn name="bell" badge onClick={() => go('alerts')} /></>} />
      <div style={{ padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface2)', borderRadius: 13, padding: '11px 14px', marginBottom: 12 }}>
          <Icon name="search" size={18} color="var(--muted)" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, ticker or contract" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14.5, fontFamily: 'inherit' }} />
          {q && <button onClick={() => setQ('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}><Icon name="xCircle" size={18} /></button>}
        </div>
        {!q && <div style={{ display: 'flex', gap: 7, marginBottom: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[['watchlist', 'Watchlist', 'star'], ['trending', 'Trending', 'flame'], ['gainers', 'Gainers', 'trend'], ['all', 'All', 'grid']].map(([v, l, ic]) => (
            <Chip key={v} active={tab === v} onClick={() => setTab(v)} icon={ic}>{l}</Chip>
          ))}
        </div>}
      </div>
      <div style={{ padding: '4px 8px 16px' }}>
        {list.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>{searching ? 'Searching the market…' : q ? 'No tokens found' : tab === 'watchlist' ? 'Your watchlist is empty — tap ☆ on any token to add it.' : 'Loading live markets…'}</div>}
        {list.map(t => (
          <div key={t.id} onClick={() => go('token', { token: t })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 10px', cursor: 'pointer', borderRadius: 12 }}>
            <Logo color={t.logo} sym={t.sym} chain={t.chain} img={t.img} address={t.address || t.tokenAddress} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{t.sym}</span>
                <button onClick={(e) => { e.stopPropagation(); if (window.FXWatch) window.FXWatch.toggle(t); }} aria-label="Toggle watchlist" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <Icon name="star" size={13} color={t.fav ? 'var(--accent)' : 'var(--faint)'} fill={t.fav ? 'var(--accent)' : 'none'} />
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.market ? `${chainName(t)} · Vol ${t.vol}` : `Vol ${t.vol}`}</div>
            </div>
            <Sparkline data={t.spark} up={t.ch24 >= 0} w={58} h={26} />
            <div style={{ textAlign: 'right', minWidth: 86 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.price)}</div>
              <Change v={t.ch24} size={12.5} />
            </div>
          </div>
        ))}
        {q && searching && list.length > 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '10px 0 4px', fontSize: 12.5 }}>Searching more across chains…</div>
        )}
      </div>
    </div>
  );
}

// ─── Token research links (real URLs to DexScreener, explorers, DEXTools…) ───
const DS_SLUG = { sol: 'solana', eth: 'ethereum', bsc: 'bsc', base: 'base', poly: 'polygon', arb: 'arbitrum' };
const DT_SLUG = { sol: 'solana', eth: 'ether', bsc: 'bnb', base: 'base', poly: 'polygon', arb: 'arbitrum' };
const EXPLORER = {
  sol: (a) => `https://solscan.io/token/${a}`,
  eth: (a) => `https://etherscan.io/token/${a}`,
  bsc: (a) => `https://bscscan.com/token/${a}`,
  base: (a) => `https://basescan.org/token/${a}`,
  poly: (a) => `https://polygonscan.com/token/${a}`,
  arb: (a) => `https://arbiscan.io/token/${a}`,
};
function shortAddr(a) { return a && a.length > 16 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
function openUrl(u) { try { window.open(u, '_blank', 'noopener,noreferrer'); } catch (e) {} }
// Build the list of working research links for a token (contract-based or coin-based).
function tokenLinks(t) {
  const a = t.address || t.tokenAddress;
  const out = [];
  if (a) {
    out.push({ ic: 'candles', title: 'DexScreener', sub: 'Live chart, trades & pools', url: t.dexUrl || `https://dexscreener.com/${DS_SLUG[t.chain] || t.chain}/${a}` });
    out.push({ ic: 'trend', title: 'DEXTools', sub: 'Pair explorer & analytics', url: `https://www.dextools.io/app/en/${DT_SLUG[t.chain] || t.chain}/pair-explorer/${a}` });
    if (EXPLORER[t.chain]) out.push({ ic: 'globe', title: t.chain === 'sol' ? 'Solscan' : 'Block explorer', sub: 'Holders, transfers & contract', url: EXPLORER[t.chain](a) });
    out.push({ ic: 'search', title: 'GeckoTerminal', sub: 'On-chain DEX charts', url: `https://www.geckoterminal.com/${DS_SLUG[t.chain] || t.chain}/pools/${a}` });
  }
  if (t.cg) out.push({ ic: 'trend', title: 'CoinGecko', sub: 'Market data & history', url: `https://www.coingecko.com/en/coins/${t.cg}` });
  else if (!a) out.push({ ic: 'trend', title: 'CoinGecko', sub: 'Search market data', url: `https://www.coingecko.com/en/search?query=${encodeURIComponent(t.sym || t.name || '')}` });
  return out;
}

// ─── Token detail ───
function TokenDetail({ token, go, onTrade }) {
  const t = token;
  const [tf, setTf] = mS('1D');
  const [series, setSeries] = mS(t.spark || []);
  const [chLoading, setChLoading] = mS(false);
  const [fav, setFav] = mS(window.FXWatch ? window.FXWatch.has(t) : t.fav);
  const [links, setLinks] = mS(false);
  const [toast, setToast] = mS('');

  // Pull a real price series for the selected timeframe (CoinGecko for listed
  // coins; synthetic-but-varied for on-chain tokens). Re-runs on tf change.
  mE(() => {
    let alive = true;
    if (!(window.FXLive && window.FXLive.fetchSeries)) { setSeries(t.spark || []); return; }
    setChLoading(true);
    window.FXLive.fetchSeries(t, tf)
      .then((d) => { if (alive && d && d.length) setSeries(d); })
      .finally(() => { if (alive) setChLoading(false); });
    return () => { alive = false; };
  }, [tf]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1600); };
  const stats = [
    ['Market cap', '$' + t.mcap], ['24h Volume', '$' + t.vol],
    ['Liquidity', t.liq === '—' ? '—' : '$' + t.liq], ['Holders', t.holders],
  ];
  return (
    <div>
      <div style={{ padding: '4px 16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Logo color={t.logo} sym={t.sym} chain={t.chain} img={t.img} address={t.address || t.tokenAddress} size={44} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 19, fontWeight: 800 }}>{t.sym}</span>
            <Pill tone="muted">{window.FX.chains.find(c => c.id === t.chain)?.name}</Pill>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t.name}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconBtn name="external" onClick={() => setLinks(true)} />
          <IconBtn name="star" active={fav} onClick={async () => { const added = window.FXWatch ? await window.FXWatch.toggle(t) : !fav; setFav(added); flash(added ? 'Added to watchlist' : 'Removed from watchlist'); }} />
        </div>
      </div>
      <div style={{ padding: '14px 16px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.price)}</span>
          <Change v={t.ch24} size={15} />
        </div>
      </div>
      {/* chart */}
      <div style={{ padding: '8px 8px 0', position: 'relative', opacity: chLoading ? 0.55 : 1, transition: 'opacity .2s' }}>
        <BigChart data={series} up={series.length > 1 ? series[series.length - 1] >= series[0] : t.ch24 >= 0} />
        {chLoading && <div style={{ position: 'absolute', top: 10, right: 18, width: 15, height: 15, border: '2px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} />}
      </div>
      <div style={{ padding: '10px 16px 0' }}>
        <Segmented options={['15m', '1H', '4H', '1D', '1W']} value={tf} onChange={setTf} />
      </div>
      <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {stats.map(([k, v]) => (
          <div key={k} style={{ background: 'var(--surface)', borderRadius: 13, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{k}</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '0 16px' }}>
        <Card onClick={() => go('bubble', { token: t })} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="globe" size={22} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>Bubble map</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Holder clusters · whale & insider signal</div>
          </div>
          <Icon name="chevR" size={18} color="var(--faint)" />
        </Card>
      </div>
      <div style={{ height: 90 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', background: 'var(--bar)', backdropFilter: 'blur(20px)', borderTop: '1px solid var(--line)', display: 'flex', gap: 10 }}>
        <Btn kind="down" full icon="arrowDR" onClick={() => onTrade(t, 'sell')}>Sell</Btn>
        <Btn kind="up" full icon="arrowUR" onClick={() => onTrade(t, 'buy')}>Buy</Btn>
      </div>

      {/* toast */}
      {toast && (
        <div style={{ position: 'absolute', left: '50%', bottom: 96, transform: 'translateX(-50%)', background: 'var(--elevated)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, padding: '11px 18px', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.4), inset 0 0 0 1px var(--line)', display: 'flex', alignItems: 'center', gap: 8, zIndex: 50, whiteSpace: 'nowrap' }}>
          <Icon name="checkCircle" size={16} color="var(--up)" /> {toast}
        </div>
      )}

      {/* links sheet \u2014 real research links */}
      <Sheet open={links} onClose={() => setLinks(false)} title={t.sym + ' \u00b7 research'}>
        <div style={{ paddingBottom: 10 }}>
          {(t.address || t.tokenAddress) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>Contract</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, fontFamily: 'ui-monospace, monospace', marginTop: 1 }}>{shortAddr(t.address || t.tokenAddress)}</div>
              </div>
              <button onClick={() => { try { navigator.clipboard.writeText(t.address || t.tokenAddress); } catch (e) {} flash('Address copied'); }} style={{ background: 'var(--chip)', border: 'none', borderRadius: 9, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: 12.5, fontFamily: 'inherit' }}><Icon name="copy" size={15} /> Copy</button>
            </div>
          )}
          {tokenLinks(t).map(({ ic, title, sub, url }) => (
            <button key={title} onClick={() => openUrl(url)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 4px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name={ic} size={18} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div>
              </div>
              <Icon name="external" size={17} color="var(--faint)" />
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function BigChart({ data, up }) {
  if (!data || data.length < 2) return null;
  const w = 360, h = 150;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 16) - 8]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const col = up ? 'var(--up)' : 'var(--down)';
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block' }} preserveAspectRatio="none">
      <defs><linearGradient id="bigc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.22" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
      {[0.25, 0.5, 0.75].map(g => <line key={g} x1="0" y1={h * g} x2={w} y2={h * g} stroke="var(--line)" strokeWidth="1" />)}
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill="url(#bigc)" />
      <path d={d} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="4" fill={col} />
    </svg>
  );
}

// ─── Bubble map ───
const BUBBLE_COLORS = { lp: '#FCD535', whale: '#F6465D', insider: '#7B61FF', normal: '#16C784' };

// Interactive holder bubble map (bubblemaps.io-style): a canvas force layout
// with collision packing, transfer-link springs, drag, tap-to-select and
// pan/zoom (wheel + pinch). Renders up to ~2000 bubbles performantly.
function BubbleCanvas({ nodes, links, selectedId, onSelect }) {
  const wrapRef = mR(null);
  const canvasRef = mR(null);
  const simRef = mR(null);
  const rafRef = mR(0);
  const selRef = mR(selectedId);
  mE(() => { selRef.current = selectedId; }, [selectedId]);

  mE(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas || !nodes || !nodes.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = wrap.clientWidth || 320, H = W;

    const minR = 2.6, maxR = Math.max(14, Math.min(W, H) * 0.13);
    const parts = nodes.map((n) => ({
      ...n,
      r: Math.max(minR, minR + n.weight * (maxR - minR)),
      x: W / 2 + (Math.random() - 0.5) * W * 0.6,
      y: H / 2 + (Math.random() - 0.5) * H * 0.6,
      vx: 0, vy: 0, fixed: false,
    }));
    const linkArr = (links || []).slice(0, 4000);
    // Adjacency + cluster membership → used to spotlight a wallet's transfer
    // links and its whole bundle when it's tapped.
    const adj = new Map();
    for (const [i, j] of linkArr) { if (!adj.has(i)) adj.set(i, new Set()); if (!adj.has(j)) adj.set(j, new Set()); adj.get(i).add(j); adj.get(j).add(i); }
    const clusterMembers = new Map();
    for (const n of nodes) { if (!clusterMembers.has(n.cluster)) clusterMembers.set(n.cluster, []); clusterMembers.get(n.cluster).push(n.id); }
    const view = { s: 1, tx: 0, ty: 0 };
    const sim = { parts, linkArr, view, alpha: 1, drag: null, pan: null, pinch: null };
    simRef.current = sim;

    const resize = () => {
      W = wrap.clientWidth || W; H = W;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    };
    resize();

    const cell = maxR * 2 + 6;
    const step = () => {
      const cx = W / 2, cy = H / 2, P = parts, a = sim.alpha;
      for (const p of P) { if (p.fixed) continue; p.vx += (cx - p.x) * 0.0016 * a; p.vy += (cy - p.y) * 0.0016 * a; }
      for (const [i, j] of linkArr) {
        const pa = P[i], pb = P[j]; if (!pa || !pb) continue;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1;
        const f = (d - (pa.r + pb.r + 6)) * 0.012 * a, ux = dx / d, uy = dy / d;
        if (!pa.fixed) { pa.vx += ux * f; pa.vy += uy * f; }
        if (!pb.fixed) { pb.vx -= ux * f; pb.vy -= uy * f; }
      }
      // grid collision (O(n))
      const grid = new Map();
      for (let i = 0; i < P.length; i++) { const p = P[i]; const k = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell); let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); } arr.push(i); }
      for (let i = 0; i < P.length; i++) {
        const p = P[i], gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get((gx + ox) + ',' + (gy + oy)); if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue; const q = P[j];
            const dx = q.x - p.x, dy = q.y - p.y; let d = Math.hypot(dx, dy); const min = p.r + q.r + 1;
            if (d > 0 && d < min) { const push = (min - d) / d * 0.5, px = dx * push, py = dy * push; if (!p.fixed) { p.x -= px; p.y -= py; } if (!q.fixed) { q.x += px; q.y += py; } }
            else if (d === 0) { p.x -= 0.5; q.x += 0.5; }
          }
        }
      }
      for (const p of P) { if (p.fixed) { p.vx = 0; p.vy = 0; continue; } p.x += p.vx; p.y += p.vy; p.vx *= 0.82; p.vy *= 0.82; }
      sim.alpha *= 0.992;
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(view.tx, view.ty); ctx.scale(view.s, view.s);
      const selId = selRef.current;
      // Spotlight = the selected wallet + everything it transfers with + its bundle.
      let spot = null;
      if (selId != null && parts[selId]) {
        spot = new Set([selId]);
        const a = adj.get(selId); if (a) a.forEach((x) => spot.add(x));
        (clusterMembers.get(parts[selId].cluster) || []).forEach((x) => spot.add(x));
      }
      // transfer links
      for (const [i, j] of linkArr) {
        const pa = parts[i], pb = parts[j]; if (!pa || !pb) continue;
        const hot = spot && spot.has(i) && spot.has(j);
        ctx.strokeStyle = spot ? (hot ? 'rgba(123,97,255,0.9)' : 'rgba(123,97,255,0.05)') : 'rgba(123,97,255,0.32)';
        ctx.lineWidth = (hot ? 2 : 1) / view.s;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      // bubbles
      for (const p of parts) {
        const dim = spot && !spot.has(p.id);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fillStyle = BUBBLE_COLORS[p.kind] || '#8A94A3'; ctx.globalAlpha = dim ? 0.16 : 0.9; ctx.fill(); ctx.globalAlpha = 1;
        if (p.id === selId) { ctx.lineWidth = 2.6 / view.s; ctx.strokeStyle = '#fff'; ctx.stroke(); }
        else if (spot && spot.has(p.id)) { ctx.lineWidth = 1.6 / view.s; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke(); }
      }
      // % labels on big / spotlighted bubbles
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const p of parts) { if (p.r * view.s > 18 && (!spot || spot.has(p.id))) { ctx.font = '700 ' + Math.min(p.r * 0.62, 13) + 'px ui-sans-serif, system-ui, sans-serif'; ctx.fillText(p.pctLabel, p.x, p.y); } }
      ctx.restore();
    };

    const tick = () => { if (sim.alpha > 0.02 || sim.drag) step(); draw(); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);

    // ── interaction ──
    const ptrs = new Map();
    const toWorld = (sx, sy) => ({ x: (sx - view.tx) / view.s, y: (sy - view.ty) / view.s });
    const rectPos = (e) => { const rc = canvas.getBoundingClientRect(); return { x: e.clientX - rc.left, y: e.clientY - rc.top }; };
    const hit = (wx, wy) => { let best = null, bd = 1e9; for (const p of parts) { const dx = p.x - wx, dy = p.y - wy, d = dx * dx + dy * dy; if (d < (p.r + 3) * (p.r + 3) && d < bd) { bd = d; best = p; } } return best; };
    const onDown = (e) => {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      const s = rectPos(e); ptrs.set(e.pointerId, s);
      if (ptrs.size === 2) {
        sim.drag = null; sim.pan = null;
        const [a, b] = [...ptrs.values()];
        sim.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), s0: view.s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx0: view.tx, ty0: view.ty };
        return;
      }
      const w = toWorld(s.x, s.y), node = hit(w.x, w.y);
      if (node) { sim.drag = node; node.fixed = true; sim.alpha = Math.max(sim.alpha, 0.4); onSelect && onSelect(node.id); }
      else { sim.pan = { sx: s.x, sy: s.y, tx: view.tx, ty: view.ty }; }
    };
    const onMove = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const s = rectPos(e); ptrs.set(e.pointerId, s);
      if (sim.pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ns = Math.max(0.3, Math.min(6, sim.pinch.s0 * (d / (sim.pinch.d0 || 1))));
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const wx = (sim.pinch.mx - sim.pinch.tx0) / sim.pinch.s0, wy = (sim.pinch.my - sim.pinch.ty0) / sim.pinch.s0;
        view.s = ns; view.tx = mx - wx * ns; view.ty = my - wy * ns;
        return;
      }
      if (sim.drag) { const w = toWorld(s.x, s.y); sim.drag.x = w.x; sim.drag.y = w.y; sim.drag.vx = 0; sim.drag.vy = 0; }
      else if (sim.pan) { view.tx = sim.pan.tx + (s.x - sim.pan.sx); view.ty = sim.pan.ty + (s.y - sim.pan.sy); }
    };
    const onUp = (e) => {
      ptrs.delete(e.pointerId);
      if (sim.drag) { sim.drag.fixed = false; sim.drag = null; }
      sim.pan = null;
      if (ptrs.size < 2) sim.pinch = null;
    };
    const onWheel = (e) => {
      e.preventDefault();
      const s = rectPos(e), w = toWorld(s.x, s.y);
      const ns = Math.max(0.3, Math.min(6, view.s * Math.exp(-e.deltaY * 0.0015)));
      view.s = ns; view.tx = s.x - w.x * ns; view.ty = s.y - w.y * ns;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    // expose a zoom helper for the +/−/reset buttons
    sim.zoom = (factor) => { const cxp = W / 2, cyp = H / 2, w = toWorld(cxp, cyp); const ns = factor === 0 ? 1 : Math.max(0.3, Math.min(6, view.s * factor)); if (factor === 0) { view.s = 1; view.tx = 0; view.ty = 0; } else { view.s = ns; view.tx = cxp - w.x * ns; view.ty = cyp - w.y * ns; } };

    return () => {
      cancelAnimationFrame(rafRef.current); rafRef.current = 0;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    };
  }, [nodes, links]);

  const zoom = (f) => { const sim = simRef.current; if (sim && sim.zoom) sim.zoom(f); };
  // Reset: recenter the view AND clear any selected bubble so the whole graph
  // returns to full colour (no focus/dim spotlight).
  const reset = () => { zoom(0); if (onSelect) onSelect(null); };
  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', aspectRatio: '1' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }} />
      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[['+', () => zoom(1.3), 'Zoom in'], ['−', () => zoom(1 / 1.3), 'Zoom out'], ['⤢', reset, 'Reset view & clear focus']].map(([t, fn, lbl], i) => (
          <button key={i} aria-label={lbl} title={lbl} onClick={fn} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--surface2)', color: 'var(--text)', fontSize: 17, fontWeight: 800, fontFamily: 'inherit', boxShadow: 'inset 0 0 0 1px var(--line)' }}>{t}</button>
        ))}
      </div>
    </div>
  );
}

function BubbleMap({ token, go }) {
  const [sel, setSel] = mS(null);
  const addr = token.address || token.tokenAddress;
  const supported = ['sol', 'eth', 'bsc', 'base', 'rhood'].includes(token.chain);
  // Real holder graph when we have a contract address on a supported chain
  // (majors like BTC/ETH have no single contract → nothing to map).
  const [state, setState] = mS({ loading: !!(addr && supported), nodes: null, links: null, summary: null, source: '', holderCount: 0, totalHolders: 0, err: '' });
  mE(() => {
    if (!addr || !supported || !(window.FXAPI && window.FXAPI.holderGraph)) { setState((s) => ({ ...s, loading: false })); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, err: '' }));
    window.FXAPI.holderGraph(token.chain, addr)
      .then((r) => { if (!alive) return; if (r && r.nodes && r.nodes.length) setState({ loading: false, nodes: r.nodes, links: r.links || [], summary: r.summary, source: r.source, holderCount: r.holderCount || r.nodes.length, totalHolders: r.totalHolders || r.holderCount || r.nodes.length, err: '' }); else setState({ loading: false, nodes: null, links: null, summary: null, source: '', holderCount: 0, totalHolders: 0, err: 'No holder data available for this token.' }); })
      .catch((e) => { if (alive) setState({ loading: false, nodes: null, links: null, summary: null, source: '', holderCount: 0, totalHolders: 0, err: (e && e.message) || 'Could not load holders. Sign in to view live data.' }); });
    return () => { alive = false; };
  }, [addr, token.chain]);

  const nodes = state.nodes;
  const isLive = !!(nodes && nodes.length);
  const sourceLabel = isLive ? (state.source === 'helius' ? 'Live · Helius' : state.source === 'moralis' ? 'Live · Moralis' : 'Live on-chain') : 'No live data';
  const selNode = sel != null && nodes ? nodes.find((n) => n.id === sel) : null;
  let selConns = 0, selBundle = 0;
  if (selNode) {
    const nb = new Set();
    for (const [a, b] of (state.links || [])) { if (a === sel) nb.add(b); else if (b === sel) nb.add(a); }
    selConns = nb.size;
    selBundle = nodes.filter((n) => n.cluster === selNode.cluster).length;
  }

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Logo color={token.logo} sym={token.sym} chain={token.chain} img={token.img} address={token.address || token.tokenAddress} size={34} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{token.sym} holder map</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {state.loading ? 'Loading holders…' : <><span style={{ width: 6, height: 6, borderRadius: '50%', background: isLive ? 'var(--up)' : 'var(--faint)' }} />{sourceLabel}{isLive ? ' · ' + (state.totalHolders > state.holderCount ? state.holderCount.toLocaleString() + ' of ' + state.totalHolders.toLocaleString() : state.holderCount.toLocaleString()) + ' holders' : ''}</>}
          </div>
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1', background: 'radial-gradient(circle at 50% 45%, var(--surface), var(--bg))', borderRadius: 20, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden', marginTop: 8 }}>
        {state.loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}><span style={{ width: 28, height: 28, border: '3px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} /></div>}
        {!state.loading && !isLive && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center', color: 'var(--muted)' }}><Icon name="globe" size={30} color="var(--faint)" /><div style={{ fontSize: 13, maxWidth: 230, lineHeight: 1.5 }}>{state.err || 'No holder graph — this token needs an on-chain contract address (SOL · ETH · BSC · Base).'}</div></div>}
        {!state.loading && isLive && <BubbleCanvas nodes={nodes} links={state.links} selectedId={sel} onSelect={setSel} />}
      </div>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', margin: '14px 0', flexWrap: 'wrap' }}>
        {[['LP / Contract', 'lp'], ['Whale', 'whale'], ['Insider', 'insider'], ['Holder', 'normal']].map(([l, k]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)', fontWeight: 600 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: BUBBLE_COLORS[k] }} /> {l}
          </div>
        ))}
      </div>
      <Card style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="info" size={18} color="var(--accent)" style={{ marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
          {selNode
            ? <><b style={{ color: 'var(--text)' }}>{selNode.label}</b> {selNode.address ? `(${shortAddr(selNode.address)}) ` : ''}holds <b style={{ color: 'var(--text)' }}>{selNode.pctLabel}</b> of supply. {selNode.kind === 'insider' ? 'Moves funds with other holders — possible bundle.' : selNode.kind === 'whale' ? 'Large concentrated position.' : selNode.kind === 'lp' ? 'Liquidity / contract address.' : 'Organic holder.'}{selConns > 0 ? <> Linked to <b style={{ color: 'var(--text)' }}>{selConns}</b> wallet{selConns > 1 ? 's' : ''} via transfers.</> : ''}{selBundle > 1 ? <> Part of a <b style={{ color: 'var(--text)' }}>{selBundle}</b>-wallet bundle.</> : ''}</>
            : state.loading ? 'Fetching holders and clustering wallets that transfer between each other…'
            : isLive ? <>Mapped <b style={{ color: 'var(--text)' }}>{state.holderCount.toLocaleString()}</b> holders. Top 10 hold <b style={{ color: 'var(--text)' }}>{state.summary.top10}</b>. {state.summary.clusters > 0 ? <>{state.summary.clusters} transfer-linked cluster{state.summary.clusters > 1 ? 's' : ''} detected. </> : 'No transfer-linked clusters. '}Distribution looks <b style={{ color: state.summary.healthy ? 'var(--up)' : 'var(--down)' }}>{state.summary.healthy ? 'healthy' : 'concentrated'}</b>. Drag bubbles, pinch/scroll to zoom, tap for details.</>
            : <>{state.err || 'Holder maps load for on-chain tokens (SOL · ETH · BSC · Base). Open a token with a contract address to see its live holder graph.'}</>}
        </div>
      </Card>
    </div>
  );
}

Object.assign(window, { Markets, TokenDetail, BubbleMap });

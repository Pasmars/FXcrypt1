// portfolio.jsx — Position Manager: open positions with live PnL, exit rules
// (TP/SL/trailing/max-hold), partial sells, closed history, and the trade
// journal with CSV export. Positions are bookkept server-side; this screen
// reads them and edits only exit rules (enforced by Firestore rules).
const { useState: pfS, useEffect: pfE, useRef: pfR } = React;

const PF_DS_CID = { bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base' };
const PF_EXPLORER = {
  bsc: (h) => `https://bscscan.com/tx/${h}`,
  eth: (h) => `https://etherscan.io/tx/${h}`,
  base: (h) => `https://basescan.org/tx/${h}`,
  sol: (h) => `https://solscan.io/tx/${h}`,
};
const pfUsd = (n, d) => n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: d != null ? d : (Math.abs(n) < 1 ? 6 : 2) });
const pfPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
const pfDate = (ms) => ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const SOURCE_LABEL = {
  'manual': 'Manual', 'pointer': 'Pointer', 'gem-auto': 'Auto-buy', 'gem-hybrid': 'Gem buy', 'sniper': 'Sniper',
  'exit-tp': 'Take-profit', 'exit-sl': 'Stop-loss', 'exit-trail': 'Trailing stop', 'exit-time': 'Max hold',
};

// Live prices for a set of open positions (DexScreener, batched per chain).
async function pfFetchPrices(positionList) {
  const byChain = {};
  for (const p of positionList) {
    if (!PF_DS_CID[p.chain]) continue;
    (byChain[p.chain] = byChain[p.chain] || new Set()).add(String(p.tokenAddress).toLowerCase());
  }
  const out = {};
  await Promise.all(Object.entries(byChain).map(async ([chain, set]) => {
    const addrs = [...set];
    for (let i = 0; i < addrs.length; i += 30) {
      try {
        const r = await fetch(`https://api.dexscreener.com/tokens/v1/${PF_DS_CID[chain]}/${addrs.slice(i, i + 30).join(',')}`);
        const data = await r.json();
        if (Array.isArray(data)) for (const pair of data) {
          const a = pair.baseToken && pair.baseToken.address && pair.baseToken.address.toLowerCase();
          if (!a) continue;
          const key = chain + ':' + a;
          const liq = (pair.liquidity && pair.liquidity.usd) || 0;
          if (!out[key] || liq > out[key].liq) out[key] = { liq, px: parseFloat(pair.priceUsd) || 0, ch24: pair.priceChange && pair.priceChange.h24 };
        }
      } catch (e) { /* tokens without pairs just get no live price */ }
    }
  }));
  return out;
}

function Portfolio({ go }) {
  const [tab, setTab] = pfS('open');
  const [open, setOpen] = pfS(null);      // null = loading
  const [closed, setClosed] = pfS(null);
  const [trades, setTrades] = pfS(null);
  const [prices, setPrices] = pfS({});
  const [sheet, setSheet] = pfS(null);    // { kind: 'exit'|'sell', pos }
  const [toast, setToast] = pfS('');
  const [paper, setPaper] = pfS(false);   // current trading mode (lists are pre-filtered to it)
  const timer = pfR(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800); };
  pfE(() => {
    let alive = true;
    if (window.FXAPI.getPaperMode) window.FXAPI.getPaperMode().then((v) => { if (alive) setPaper(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const loadOpen = async () => {
    const list = await window.FXAPI.getPositions('open');
    setOpen(list);
    if (list.length) setPrices(await pfFetchPrices(list));
  };
  pfE(() => {
    loadOpen();
    // Live PnL refresh every 30s while the screen is mounted.
    timer.current = setInterval(async () => {
      const list = await window.FXAPI.getPositions('open');
      setOpen(list);
      if (list.length) setPrices(await pfFetchPrices(list));
    }, 30000);
    return () => clearInterval(timer.current);
  }, []);
  pfE(() => { if (tab === 'closed' && closed == null) window.FXAPI.getPositions('closed').then(setClosed); }, [tab]);
  pfE(() => { if (tab === 'journal' && trades == null) window.FXAPI.getTrades(300).then(setTrades); }, [tab]);

  // Totals across open positions.
  const rows = (open || []).map((p) => {
    const live = prices[p.chain + ':' + String(p.tokenAddress).toLowerCase()];
    const px = live ? live.px : (p.lastPriceUsd || 0);
    const value = px > 0 ? p.qty * px : null;
    const uPnl = px > 0 && p.avgEntryUsd ? p.qty * (px - p.avgEntryUsd) : null;
    const uPct = px > 0 && p.avgEntryUsd ? (px / p.avgEntryUsd - 1) * 100 : null;
    return { ...p, px, value, uPnl, uPct };
  });
  const totValue = rows.reduce((s, r) => s + (r.value || 0), 0);
  const totUPnl = rows.reduce((s, r) => s + (r.uPnl || 0), 0);
  const totRealized = (open || []).concat(closed || []).reduce((s, p) => s + (p.realizedUsd || 0), 0);

  const exportCsv = () => {
    const list = trades || [];
    if (!list.length) { flash('Nothing to export yet'); return; }
    const cols = ['date', 'chain', 'token', 'type', 'source', 'amountNative', 'percentSold', 'entryPriceUsd', 'exitPriceUsd', 'status', 'txHash'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.join(',')].concat(list.map((t) => [
      t.at ? new Date(t.at).toISOString() : '', t.chain, t.tokenSymbol || t.tokenAddress || t.pair || '',
      t.type, t.source || '', t.amountIn || '', t.percentSold || '', t.entryPriceUsd || '', t.exitPriceUsd || '', t.status || '', t.txHash || t.txHashBuy || '',
    ].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fxcrypt-trades-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    flash('CSV downloaded');
  };

  const exitChips = (p) => {
    if (!p.exitArmed || !p.exit) return <Pill tone="muted">No exit rules</Pill>;
    const e = p.exit;
    return <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
      {e.tp != null && <Pill tone="up">TP +{e.tp}%</Pill>}
      {e.sl != null && <Pill tone="down">SL −{e.sl}%</Pill>}
      {e.trail != null && <Pill tone="accent">Trail {e.trail}%</Pill>}
      {e.maxHoldHours != null && <Pill tone="muted">⏰ {e.maxHoldHours}h</Pill>}
    </span>;
  };

  const posCard = (r) => (
    <Card key={r.id} style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
            {r.tokenSymbol || '—'}
            {r.paper && <Pill tone="accent">PAPER</Pill>}
            <Pill tone="muted">{String(r.chain).toUpperCase()}</Pill>
            <Pill tone="muted">{SOURCE_LABEL[r.source] || r.source || ''}</Pill>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Opened {pfDate(r.openedAt)} · entry {pfUsd(r.avgEntryUsd)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{r.value != null ? pfUsd(r.value, 2) : '—'}</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: r.uPct == null ? 'var(--muted)' : r.uPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {r.uPct != null ? `${pfPct(r.uPct)} (${r.uPnl >= 0 ? '+' : ''}${pfUsd(Math.abs(r.uPnl), 2).replace('$', '$')})` : 'no live price'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {exitChips(r)}
        <span style={{ display: 'inline-flex', gap: 7, flexShrink: 0 }}>
          <Btn size="sm" kind="ghost" onClick={() => setSheet({ kind: 'exit', pos: r })}>Exits</Btn>
          <Btn size="sm" kind="down" onClick={() => setSheet({ kind: 'sell', pos: r })}>Sell</Btn>
        </span>
      </div>
      {r.exit && r.exit.status === 'failed' && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--down)', display: 'flex', gap: 5, alignItems: 'center' }}>
          <Icon name="alert" size={13} /> Automated exit failed {r.exit.fails}× — sell manually or re-arm.
        </div>
      )}
    </Card>
  );

  return (
    <div style={{ padding: '0 16px 24px' }}>
      {/* Trading-mode banner — everything below is EITHER paper or real, never mixed. */}
      {paper && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--glow)', borderRadius: 11, padding: '9px 13px', marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>
          <Icon name="edit" size={15} /> PAPER TRADING — all positions & fills below are simulated
        </div>
      )}
      {/* Paper-profit upsell: once the simulated strategy is demonstrably
          working (+20% on open cost basis, or realized gains), invite going live. */}
      {paper && (() => {
        const costBasis = rows.reduce((s, r) => s + (r.qty || 0) * (r.avgEntryUsd || 0), 0);
        const pnl = totUPnl + totRealized;
        const pct = costBasis > 0 ? (totUPnl / costBasis) * 100 : 0;
        if (!(pnl > 0 && (pct >= 20 || totRealized > 0))) return null;
        return (
          <div onClick={() => go('paywall')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11, background: 'linear-gradient(135deg, var(--surface), var(--glow))', borderRadius: 13, padding: '12px 14px', marginBottom: 12, boxShadow: 'inset 0 0 0 1.5px var(--accent)' }}>
            <Icon name="trophy" size={20} color="var(--accent)" />
            <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.45 }}>
              <b style={{ color: 'var(--text)' }}>Your paper strategy is up {pfUsd(pnl, 2)}{pct >= 1 ? ` (+${pct.toFixed(0)}%)` : ''}.</b> Go live with Pro — real auto-execution, exits and deep research.
            </div>
            <Icon name="chevR" size={16} color="var(--accent)" />
          </div>
        );
      })()}
      {/* Totals strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[['Value', pfUsd(totValue, 2), 'var(--text)'],
          ['Unrealized', (totUPnl >= 0 ? '+' : '−') + pfUsd(Math.abs(totUPnl), 2).slice(1), totUPnl >= 0 ? 'var(--up)' : 'var(--down)'],
          ['Realized', (totRealized >= 0 ? '+' : '−') + pfUsd(Math.abs(totRealized), 2).slice(1), totRealized >= 0 ? 'var(--up)' : 'var(--down)']]
          .map(([l, v, c]) => (
            <div key={l} style={{ flex: 1, background: 'var(--surface)', borderRadius: 13, padding: '11px 12px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: c }}>{v.startsWith('−$') ? '−$' + v.slice(2) : v}</div>
            </div>
          ))}
      </div>

      <Segmented options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'journal', label: 'Journal' }]} value={tab} onChange={setTab} />
      <div style={{ height: 12 }} />

      {tab === 'open' && (open == null
        ? <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>Loading positions…</div>
        : rows.length === 0
          ? <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>No open positions yet.<br />Buys from manual trades, Pointer and the gem bot appear here automatically.</div>
          : rows.map(posCard))}

      {tab === 'closed' && (closed == null
        ? <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>Loading…</div>
        : closed.length === 0
          ? <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>No closed positions yet.</div>
          : closed.map((p) => (
            <Card key={p.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, display: 'flex', gap: 6, alignItems: 'center' }}>
                    {p.tokenSymbol || '—'} <Pill tone="muted">{String(p.chain).toUpperCase()}</Pill>
                    {p.exit && p.exit.firedReason && <Pill tone={p.exit.firedReason === 'exit-sl' ? 'down' : 'up'}>{SOURCE_LABEL[p.exit.firedReason]}</Pill>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{pfDate(p.openedAt)} → {pfDate(p.closedAt)}</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 15, color: (p.realizedUsd || 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>
                  {(p.realizedUsd || 0) >= 0 ? '+' : '−'}{pfUsd(Math.abs(p.realizedUsd || 0), 2).slice(1)}
                </div>
              </div>
            </Card>
          )))}

      {tab === 'journal' && <>
        <Btn size="sm" kind="ghost" icon="download" onClick={exportCsv} style={{ marginBottom: 10 }}>Export CSV</Btn>
        {trades == null
          ? <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>Loading…</div>
          : trades.length === 0
            ? <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40, fontSize: 14 }}>No trades yet.</div>
            : trades.map((t) => {
              const buy = t.type === 'buy';
              const link = t.txHash && PF_EXPLORER[t.chain] ? PF_EXPLORER[t.chain](t.txHash) : null;
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.status === 'failed' ? 'var(--down-bg)' : buy ? 'var(--glow)' : 'var(--down-bg)', color: t.status === 'failed' ? 'var(--down)' : buy ? 'var(--accent)' : 'var(--down)' }}>
                    <Icon name={t.status === 'failed' ? 'alert' : buy ? 'arrowDR' : 'arrowUR'} size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}>
                      {buy ? 'Buy' : t.type === 'sell' ? 'Sell' : t.type} {t.tokenSymbol || (t.tokenAddress ? t.tokenAddress.slice(0, 6) + '…' : t.pair || '')}
                      <Pill tone="muted">{SOURCE_LABEL[t.source] || t.source || ''}</Pill>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {pfDate(t.at)} · {buy ? (t.amountIn || '—') + ' native' : (t.percentSold || 0) + '% sold'}{t.status === 'failed' ? ' · FAILED' : ''}
                    </div>
                  </div>
                  {link && <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>TX ↗</a>}
                </div>
              );
            })}
      </>}

      {/* Exit rules sheet */}
      <ExitSheet sheet={sheet} onClose={() => setSheet(null)} flash={flash} reload={loadOpen} />
      {toast && <div style={{ position: 'fixed', left: '50%', bottom: 110, transform: 'translateX(-50%)', background: 'var(--surface2)', color: 'var(--text)', padding: '10px 16px', borderRadius: 11, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,.4)', zIndex: 50 }}>{toast}</div>}
    </div>
  );
}

// Sheet for editing exit rules or selling a position.
function ExitSheet({ sheet, onClose, flash, reload }) {
  const pos = sheet && sheet.pos;
  const [v, setV] = pfS({ tp: '', sl: '', trail: '', maxHoldHours: '' });
  const [pct, setPct] = pfS(100);
  const [busy, setBusy] = pfS(false);
  pfE(() => {
    if (!pos) return;
    const e = (pos.exitArmed && pos.exit) || {};
    setV({ tp: e.tp || '', sl: e.sl || '', trail: e.trail || '', maxHoldHours: e.maxHoldHours || '' });
    setPct(100); setBusy(false);
  }, [pos && pos.id, sheet && sheet.kind]);
  if (!pos) return <Sheet open={false} onClose={onClose} title="" />;

  const field = (key, label, hint) => (
    <label style={{ display: 'block', marginBottom: 12, flex: 1 }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>{label} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{hint}</span></span>
      <input type="number" inputMode="decimal" min={0} value={v[key]} placeholder="off"
        onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: 'none', background: 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', boxShadow: 'inset 0 0 0 1px var(--line)', outline: 'none' }} />
    </label>
  );

  const saveExits = async () => {
    if (busy) return; setBusy(true);
    try {
      const r = await window.FXAPI.setPositionExit(pos.id, v);
      flash(r.armed ? 'Exit rules armed — the bot will sell automatically' : 'Exit rules cleared');
      onClose(); reload();
    } catch (e) { flash(e.message || 'Failed to save'); setBusy(false); }
  };
  const sell = async () => {
    if (busy) return; setBusy(true);
    try {
      await window.FXAPI.sellPosition(pos.chain, pos.tokenAddress, pct);
      flash(`Sold ${pct}% of ${pos.tokenSymbol || 'position'}`);
      onClose(); reload();
    } catch (e) { flash(e.message || 'Sell failed'); setBusy(false); }
  };

  return (
    <Sheet open={!!sheet} onClose={onClose} title={(sheet && sheet.kind === 'sell' ? 'Sell ' : 'Exit rules — ') + (pos.tokenSymbol || '')}>
      {sheet && sheet.kind === 'exit' ? <>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
          The bot checks prices every minute and sells the whole position from your bot wallet when a rule triggers. Leave a field empty to turn that rule off.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>{field('tp', 'Take profit', '+%')}{field('sl', 'Stop loss', '−%')}</div>
        <div style={{ display: 'flex', gap: 10 }}>{field('trail', 'Trailing stop', '% off peak')}{field('maxHoldHours', 'Max hold', 'hours')}</div>
        <Btn full onClick={saveExits} disabled={busy}>{busy ? 'Saving…' : 'Save exit rules'}</Btn>
      </> : <>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>{pos.paper ? 'Paper position — the sell is simulated at the live market price. No real funds move.' : 'Sell from your bot wallet at your configured slippage. This is a real on-chain trade.'}</div>
        <Segmented options={[25, 50, 75, 100].map((p) => ({ value: p, label: p + '%' }))} value={pct} onChange={setPct} />
        <div style={{ height: 14 }} />
        <Btn full kind="down" onClick={sell} disabled={busy}>{busy ? 'Selling…' : `Sell ${pct}% now`}</Btn>
      </>}
    </Sheet>
  );
}

Object.assign(window, { Portfolio: Portfolio });

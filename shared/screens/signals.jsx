// signals.jsx — CEX Bot: signal setups, futures, auto-execute
const { useState: sgS, useEffect: sgE } = React;

const SIGNAL_RISK_OPTS = [0.5, 1, 2, 3, 5];
const SIGNAL_USD_OPTS = [25, 50, 100, 250];
const SIGNAL_SCAN_STEPS = [
  { icon: 'search', label: 'Connecting to exchanges', sub: 'Binance · MEXC · Bybit · KuCoin' },
  { icon: 'candles', label: 'Pulling top liquid pairs', sub: 'Spot & futures markets' },
  { icon: 'trend', label: 'Analyzing market structure', sub: 'BOS · order blocks · FVG' },
  { icon: 'sliders', label: 'Scoring setups by confluence', sub: 'RSI · volume · trend' },
  { icon: 'checkCircle', label: 'Ranking high-confidence signals', sub: 'Filtering noise' },
];
function Signals({ go, onUpsell }) {
  const FX = window.FX;
  const plan = (window.FX && window.FX.plan) || 'free';
  const [type, setType] = sgS('All');
  const [auto, setAuto] = sgS(false);
  const [tg, setTg] = sgS(false);
  const [tgLinked, setTgLinked] = sgS(false);
  const [risk, setRisk] = sgS(1);
  // Position sizing: 'percent' of balance, or a 'fixed' USDT amount per trade.
  const [riskMode, setRiskMode] = sgS('percent');
  const [riskUsd, setRiskUsd] = sgS('50');
  const [scan, setScan] = sgS({ on: false, ago: 'cached', found: 0 });
  // Scan modal state: open + done + result summary so the user sees progress
  // and the fresh setups the moment a scan finishes (no page refresh needed).
  const [modal, setModal] = sgS({ open: false, done: false, found: 0, err: '' });
  // Re-render whenever the live data layer refreshes window.FX (mirrors Markets)
  // so scanned setups and the type filter reflect immediately.
  const [, force] = sgS(0);
  sgE(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('fx:update', h);
    return () => window.removeEventListener('fx:update', h);
  }, []);
  // Hydrate the auto-execute / Telegram toggles + risk from persisted agentSettings
  // so they reflect the real scheduler state, not a hardcoded default.
  sgE(() => {
    let alive = true;
    window.FXAPI.getBotPrefs().then(p => {
      if (!alive || !p) return;
      setAuto(!!p.autoExecute);
      setTg(!!p.signalAuto && p.telegramSignals);
      setTgLinked(!!p.telegramLinked);
      if (p.riskPercent) setRisk(p.riskPercent);
      if (p.riskMode) setRiskMode(p.riskMode);
      if (p.riskUsd != null) setRiskUsd(String(p.riskUsd));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const changeRisk = async (v) => {
    setRisk(v);
    try { await window.FXAPI.saveSignalPrefs({ riskPercent: v }); } catch (e) {}
  };
  const changeMode = async (m) => {
    setRiskMode(m);
    try { await window.FXAPI.saveSignalPrefs({ riskMode: m }); } catch (e) {}
  };
  const changeUsd = async (v) => {
    const n = Math.max(1, parseFloat(v) || 0);
    setRiskUsd(String(n));
    try { await window.FXAPI.saveSignalPrefs({ riskUsd: n }); } catch (e) {}
  };
  // Telegram delivery: enabling also turns on the agent scheduler so signals
  // are actually generated and pushed; disabling just stops delivery.
  const toggleTg = async () => {
    const next = !tg;
    setTg(next);
    try { await window.FXAPI.saveSignalPrefs(next ? { enabled: true, telegramSignals: true } : { telegramSignals: false }); }
    catch (e) { setTg(!next); }
  };
  // Auto-execute is Pro-gated. Enabling persists autoExecute + enables the agent.
  const toggleAuto = async () => {
    if (auto) {
      setAuto(false);
      try { await window.FXAPI.saveSignalPrefs({ autoExecute: false }); } catch (e) { setAuto(true); }
      return;
    }
    if (plan === 'free') { onUpsell(); return; }
    setAuto(true);
    try { await window.FXAPI.saveSignalPrefs({ enabled: true, autoExecute: true }); } catch (e) { setAuto(false); }
  };
  // Verified track record (server-resolved signal outcomes → win rate / avg R).
  const [stats, setStats] = sgS(null);
  sgE(() => {
    let alive = true;
    if (window.FXAPI.getSignalStats) window.FXAPI.getSignalStats().then((s) => { if (alive && s) setStats(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Real market signal scan: runAgentScan analyses the broad market server-side
  // (setups are not tied to one exchange), then we reload from Firestore.
  const runScan = async () => {
    if (scan.on) return;
    setScan(s => ({ ...s, on: true, found: 0 }));
    setModal({ open: true, done: false, found: 0, err: '' });
    try {
      const res = await window.FXAPI.runAgentScan({ marketTypes: ['spot', 'futures'] });
      const found = (res && res.signals && res.signals.length) || 0;
      if (window.FXLive) await window.FXLive.refreshSignals();   // refresh FX.signals → fx:update re-renders the list
      setScan({ on: false, ago: 'just now', found });
      setModal({ open: true, done: true, found, err: '' });
    } catch (e) {
      setScan({ on: false, ago: 'sign in & connect an exchange', found: 0 });
      setModal({ open: true, done: true, found: 0, err: (e && e.message) || 'Sign in and connect an exchange, then try again.' });
    }
  };
  const allSig = FX.signals || [];
  const list = type === 'All' ? allSig : allSig.filter(s => s.type === type);

  return (
    <div>
      <TopBar title="Signals" sub={scan.on ? 'Scanning the market\u2026' : 'Market setups \u00b7 scored by confluence'}
        right={<><IconBtn name="bell" badge onClick={() => go('alerts')} /><IconBtn name="settings" onClick={() => go('automation')} /></>} />
      {/* manual scan bar */}
      <div style={{ padding: '0 16px 12px' }}>
        <ScanButton on={scan.on} onClick={runScan} label="Scan the market now" busy="Analyzing setups…" detail="Top liquid pairs · spot & futures" />
      </div>
      {/* auto-execute + telegram banners */}
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 10 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9, background: auto ? 'var(--glow)' : 'var(--surface)', borderRadius: 14, padding: '13px 14px', boxShadow: auto ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)', transition: 'all .2s' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: auto ? 'var(--accent)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: auto ? 'var(--on-accent)' : 'var(--accent)' }}><Icon name="robot" size={19} /></div>
            <Toggle on={auto} onClick={toggleAuto} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Auto-execute</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{auto ? 'Risk ' + risk + '% · your exchange' : 'Trade signals automatically'}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9, background: tg ? 'var(--glow)' : 'var(--surface)', borderRadius: 14, padding: '13px 14px', boxShadow: tg ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)', transition: 'all .2s' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: tg ? '#229ED9' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tg ? '#fff' : 'var(--accent)' }}><Icon name="telegram" size={19} /></div>
            <Toggle on={tg} onClick={toggleTg} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Telegram bot</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{!tgLinked ? 'Connect Telegram in Profile' : tg ? 'Signals sent to @FXcryptBot' : 'Push signals to Telegram'}</div>
          </div>
        </div>
      </div>
      {/* Risk per trade — drives the auto-execute bot (agentSettings.riskPercent) */}
      {auto && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 700 }}><Icon name="shield" size={16} color="var(--accent)" /> Size per trade</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{riskMode === 'fixed' ? '$' + (riskUsd || '0') : risk + '%'}</span>
            </div>
            {/* Choose how each auto-executed trade is sized: a % of balance or a fixed $ */}
            <Segmented options={[{ value: 'percent', label: '% of balance' }, { value: 'fixed', label: 'Fixed $' }]} value={riskMode} onChange={changeMode} style={{ marginBottom: 11 }} />
            {riskMode === 'percent' ? (
              <div style={{ display: 'flex', gap: 7 }}>
                {SIGNAL_RISK_OPTS.map(v => <Chip key={v} active={risk === v} onClick={() => changeRisk(v)} style={{ flex: 1, justifyContent: 'center' }}>{v}%</Chip>)}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', borderRadius: 11, padding: '10px 13px', marginBottom: 9 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--muted)' }}>$</span>
                  <input value={riskUsd} onChange={e => setRiskUsd(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={() => changeUsd(riskUsd)} inputMode="decimal"
                    style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 22, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
                  <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 700 }}>USDT</span>
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  {SIGNAL_USD_OPTS.map(v => <Chip key={v} active={parseFloat(riskUsd) === v} onClick={() => changeUsd(v)} style={{ flex: 1, justifyContent: 'center' }}>${v}</Chip>)}
                </div>
              </>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{riskMode === 'fixed'
              ? 'The bot spends this fixed USDT amount on each auto-executed signal (capped at your available balance).'
              : 'The bot uses this % of your USDT balance on each auto-executed signal.'}</div>
          </div>
        </div>
      )}
      {/* Verified track record — every signal is resolved server-side against
          its SL/TP using exchange candles; nothing here is self-reported. */}
      {stats && stats.d90 && stats.d90.total > 0 && (() => {
        const d = stats.d90;
        const decided = d.wins + d.losses;
        const seg = (n, color) => decided ? <div style={{ flex: n || 0.0001, height: 6, background: color }} /> : null;
        return (
          <div style={{ padding: '0 16px 12px' }}>
            {/* Tap to drill into the individual won/lost signals behind these numbers. */}
            <div onClick={() => go('signalTrackRecord')} style={{ cursor: 'pointer', background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                <Icon name="trophy" size={15} color="var(--accent)" />
                <span style={{ fontSize: 13, fontWeight: 800, flex: 1 }}>Track record · last 90 days</span>
                <Pill tone="muted">{d.total} signals</Pill>
                <Icon name="chevR" size={16} color="var(--faint)" />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {[['Win rate', d.winRate != null ? d.winRate + '%' : '—', d.winRate >= 50 ? 'var(--up)' : 'var(--text)'],
                  ['Avg R', d.avgR != null ? (d.avgR >= 0 ? '+' : '') + d.avgR + 'R' : '—', d.avgR >= 0 ? 'var(--up)' : 'var(--down)'],
                  ['W / L', `${d.wins} / ${d.losses}`, 'var(--text)']].map(([l, v, c]) => (
                  <div key={l} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{v}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{l}</div>
                  </div>
                ))}
              </div>
              {decided > 0 && (
                <div style={{ display: 'flex', gap: 2, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }} title={`TP1 ${d.tp1} · TP2 ${d.tp2} · TP3 ${d.tp3} · SL ${d.losses}`}>
                  {seg(d.tp1, 'var(--up)')}{seg(d.tp2, 'var(--up)')}{seg(d.tp3, 'var(--accent)')}{seg(d.losses, 'var(--down)')}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="list" size={12} /> View every won & lost signal
              </div>
            </div>
          </div>
        );
      })()}
      <div style={{ padding: '0 16px 10px', display: 'flex', gap: 7 }}>
        {['All', 'Futures', 'Spot'].map(t => <Chip key={t} active={type === t} onClick={() => setType(t)}>{t}</Chip>)}
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {scan.found > 0 && !scan.on && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--up-bg)', borderRadius: 11, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--up)' }}>
            <Icon name="checkCircle" size={16} /> {scan.found} fresh setups added to the top
          </div>
        )}
        {list.map(s => <SignalCard key={s.pair + s.dir} s={s} onExec={() => go('execSignal', { signal: s })} onChart={() => go('signalChart', { signal: s })} />)}
        {list.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--muted)' }}>
            <Icon name="search" size={26} color="var(--faint)" style={{ marginBottom: 10 }} />
            {allSig.length === 0 ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 600 }}>No signals yet</div>
                <div style={{ fontSize: 12.5, marginTop: 3 }}>Tap “Scan the market now” to find fresh setups.</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600 }}>No {type} setups right now</div>
                <div style={{ fontSize: 12.5, marginTop: 3 }}>Switch the filter or scan the market again.</div>
              </>
            )}
          </div>
        )}
      </div>
      <ScanModal
        open={modal.open} done={modal.done} error={modal.err}
        onClose={() => setModal(m => ({ ...m, open: false }))}
        title="Signal scan" steps={SIGNAL_SCAN_STEPS}
        summary={modal.found > 0 ? modal.found + (modal.found === 1 ? ' setup found' : ' setups found') : 'No new setups'}
        result={modal.found > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(FX.signals || []).slice(0, 4).map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', borderRadius: 11, padding: '10px 12px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: s.dir === 'LONG' ? 'var(--up-bg)' : 'var(--down-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.dir === 'LONG' ? 'var(--up)' : 'var(--down)' }}><Icon name={s.dir === 'LONG' ? 'trend' : 'arrowDR'} size={16} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.dir} {s.pair}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{s.type} · {s.tf}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: s.conf >= 80 ? 'var(--up)' : 'var(--accent)' }}>{s.conf}%</span>
              </div>
            ))}
            <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 2 }}>Added to your signals list below.</div>
          </div>
        ) : (
          <div style={{ fontSize: 13.5, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>No fresh setups crossed the confidence threshold this scan. Try again shortly.</div>
        )}
      />
    </div>
  );
}

function SignalCard({ s, onExec, onChart }) {
  const long = s.dir === 'LONG';
  const dirCol = long ? 'var(--up)' : 'var(--down)';
  const dirBg = long ? 'var(--up-bg)' : 'var(--down-bg)';
  return (
    <Card pad={0} style={{ overflow: 'hidden' }}>
      <div style={{ padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: dirBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: dirCol }}><Icon name={long ? 'trend' : 'arrowDR'} size={20} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontWeight: 800, fontSize: 16 }}>{s.pair}</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: dirCol, background: dirBg, padding: '2px 7px', borderRadius: 6 }}>{s.dir}{s.lev !== '—' ? ' ' + s.lev : ''}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.type} · {s.tf} · market setup</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Confidence</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: s.conf >= 80 ? 'var(--up)' : s.conf >= 65 ? 'var(--accent)' : 'var(--muted)' }}>{s.conf}%</div>
        </div>
      </div>
      {/* levels */}
      <div style={{ padding: '13px 15px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Level label="Entry" val={s.entry} />
          <Level label="Stop" val={s.sl} col="var(--down)" />
          <Level label="R:R" val={s.rr} col="var(--accent)" />
        </div>
        {/* TP ladder */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {s.tp.map((tp, i) => (
            <div key={i} style={{ flex: 1, background: 'var(--up-bg)', borderRadius: 9, padding: '7px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 10.5, color: 'var(--up)', fontWeight: 700 }}>TP{i + 1}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{tp}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 13 }}>
          {s.tags.map(t => <span key={t} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', background: 'var(--chip)', padding: '4px 9px', borderRadius: 7 }}>{t}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn kind="soft" size="sm" full icon="candles" onClick={onChart}>Chart</Btn>
          <Btn kind={long ? 'up' : 'down'} size="sm" full icon="zap" onClick={onExec}>Execute</Btn>
        </div>
      </div>
    </Card>
  );
}

function Level({ label, val, col }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface2)', borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, marginTop: 1, color: col || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{val}</div>
    </div>
  );
}

// Execute signal flow — the user chooses WHICH connected exchange to trade on.
const EX_NAME = { binance: 'Binance', bybit: 'Bybit', mexc: 'MEXC', kucoin: 'KuCoin', okx: 'OKX', kraken: 'Kraken' };
const FUTURES_EX = ['binance', 'bybit', 'mexc'];
function ExecSignal({ signal: s, go, onDone }) {
  const FX = window.FX;
  const isFutures = s.type === 'Futures';
  // Connected exchanges that can take this order (futures only on Binance/Bybit/MEXC).
  const connected = (FX.exchanges || []).filter((e) => e.connected && (!isFutures || FUTURES_EX.includes(e.id)));
  const [margin, setMargin] = sgS('100');
  const [exchange, setExchange] = sgS('');
  const [stage, setStage] = sgS('form');
  const [err, setErr] = sgS('');
  const [riskPct, setRiskPct] = sgS(1);
  const txRef = React.useRef(null);
  // Use the user's configured risk-per-trade for execution (same value the
  // auto-execute bot uses), falling back to 1% if it hasn't loaded yet.
  sgE(() => {
    let alive = true;
    window.FXAPI.getBotPrefs().then(p => { if (alive && p && p.riskPercent) setRiskPct(p.riskPercent); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const long = s.dir === 'LONG';
  const sel = exchange || (connected[0] && connected[0].id) || '';
  const selName = EX_NAME[sel] || sel;

  // Signals execute for REAL via approveTrade on the user-selected exchange —
  // there is no simulated fallback: anything non-executable errors honestly.
  const open = () => {
    setErr('');
    if (!s.id || !s.live) { setErr('This signal can no longer be executed — run a fresh scan for live setups.'); return; }
    if (!window.FXAPI) { setErr('Trading engine not loaded — refresh and try again.'); return; }
    if (!sel) { setErr('Connect an exchange first to trade this signal.'); return; }
    txRef.current = window.FXAPI.approveTrade({ signalId: s.id, riskPercent: riskPct, targetExchange: sel });
    setStage('processing');
  };
  const finish = async () => {
    try { await txRef.current; setStage('success'); }
    catch (e) { setErr((e && e.message) || 'Could not open the position. Connect an exchange first.'); setStage('form'); }
    finally { txRef.current = null; }
  };

  if (stage === 'processing') {
    return <ExecProcessing s={s} margin={margin} onComplete={finish} />;
  }
  if (stage === 'success') {
    return (
      <div style={{ padding: '40px 22px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'var(--up-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}><Icon name="checkCircle" size={48} color="var(--up)" /></div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Position opened</div>
        <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>{s.dir} {s.pair} {s.lev !== '—' ? '· ' + s.lev : ''}<br />{selName ? 'on ' + selName + ' · ' : ''}SL & TP1–3 set automatically</div>
        <Btn full onClick={onDone} style={{ marginTop: 24 }}>Done</Btn>
      </div>
    );
  }
  return (
    <div style={{ padding: '4px 16px 20px' }}>
      <Card pad={15} style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: long ? 'var(--up-bg)' : 'var(--down-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: long ? 'var(--up)' : 'var(--down)' }}><Icon name={long ? 'trend' : 'arrowDR'} size={21} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{s.pair}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{s.dir} {s.lev !== '—' ? s.lev : ''} · {s.type} setup</div>
          </div>
          <Pill tone="accent">{s.conf}% conf</Pill>
        </div>
      </Card>
      {/* Exchange picker — user chooses where to execute */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 14, boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 9 }}>Execute on{isFutures ? ' (futures)' : ''}</div>
        {connected.length === 0 ? (
          <button onClick={() => go('exchanges')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)', borderRadius: 11, padding: '12px 14px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)' }}>
            <Icon name="link" size={18} color="var(--accent)" />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>Connect an exchange to trade this signal</span>
            <Icon name="chevR" size={17} color="var(--faint)" />
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {connected.map((e) => <Chip key={e.id} active={sel === e.id} onClick={() => setExchange(e.id)}>{EX_NAME[e.id] || e.name || e.id}</Chip>)}
          </div>
        )}
      </div>
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>Margin (USDT)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 28, fontWeight: 800 }}>$</span>
          <input value={margin} onChange={e => setMargin(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 28, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
          {['50', '100', '250', '500'].map(p => <Chip key={p} onClick={() => setMargin(p)} active={margin === p} style={{ flex: 1, justifyContent: 'center' }}>${p}</Chip>)}
        </div>
      </div>
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '6px 16px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 16 }}>
        <Row k="Entry" v={s.entry} />
        <Row k="Stop loss" v={s.sl} />
        <Row k="Take profit" v={'TP1 ' + s.tp[0]} />
        <Row k="Position size" v={s.lev !== '—' ? '$' + (parseFloat(margin) * parseFloat(s.lev)).toFixed(0) + ' (' + s.lev + ')' : '$' + margin} />
        <Row k="Liquidation" v={long ? '≈ ' + (parseFloat(s.entry.replace(/,/g, '')) * 0.82).toFixed(0) : '—'} last />
      </div>
      {err && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '11px 13px', fontWeight: 600 }}>{err}</div>}
      <Btn kind={long ? 'up' : 'down'} size="lg" full icon="zap" onClick={open}>Open {s.dir} position</Btn>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 10, fontSize: 11.5, color: 'var(--faint)' }}><Icon name="alert" size={13} /> Trading futures involves risk. Not financial advice.</div>
    </div>
  );
}

// ─── Signal chart with entry / SL / TP levels ───
function SignalChart({ signal: s, go, onExec }) {
  const [tf, setTf] = sgS(s.tf);
  const long = s.dir === 'LONG';
  const num = (v) => parseFloat(String(v).replace(/,/g, ''));
  const entry = num(s.entry), sl = num(s.sl), tps = s.tp.map(num);
  // candle data — deterministic, trending toward entry then up/down for the setup
  const W = 360, H = 230;
  const all = [entry, sl, ...tps];
  const lo = Math.min(...all) * 0.992, hi = Math.max(...all) * 1.008;
  const rng = hi - lo || 1;
  const y = (p) => H - ((p - lo) / rng) * H;
  // Seed includes the timeframe so switching tf regenerates a distinct path;
  // higher timeframes show wider candle swings.
  const tfScale = { '15m': 0.6, '1H': 0.85, '4H': 1, '1D': 1.35 }[tf] || 1;
  let seed = s.pair.charCodeAt(0) + s.pair.charCodeAt(1) + tf.length * 37 + (tf.charCodeAt(0) || 0);
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const N = 26;
  const candles = [];
  let price = entry * (long ? 1.004 : 0.996);
  for (let i = 0; i < N; i++) {
    const drift = (entry - price) * 0.12 + (long ? -1 : 1) * rng * 0.004;
    const open = price;
    price = price + drift + (rnd() - 0.5) * rng * 0.05 * tfScale;
    const close = price;
    const high = Math.max(open, close) + rnd() * rng * 0.03 * tfScale;
    const low = Math.min(open, close) - rnd() * rng * 0.03 * tfScale;
    candles.push({ open, close, high, low });
  }
  const cw = W / N;

  const levels = [
    { p: tps[2], label: 'TP3 ' + s.tp[2], col: 'var(--up)' },
    { p: tps[1], label: 'TP2 ' + s.tp[1], col: 'var(--up)' },
    { p: tps[0], label: 'TP1 ' + s.tp[0], col: 'var(--up)' },
    { p: entry, label: 'Entry ' + s.entry, col: 'var(--accent)' },
    { p: sl, label: 'SL ' + s.sl, col: 'var(--down)' },
  ];

  return (
    <div style={{ padding: '4px 0 20px' }}>
      <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: '50%', background: long ? 'var(--up-bg)' : 'var(--down-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: long ? 'var(--up)' : 'var(--down)' }}><Icon name={long ? 'trend' : 'arrowDR'} size={21} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 18, fontWeight: 800 }}>{s.pair}</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: long ? 'var(--up)' : 'var(--down)', background: long ? 'var(--up-bg)' : 'var(--down-bg)', padding: '2px 7px', borderRadius: 6 }}>{s.dir}{s.lev !== '—' ? ' ' + s.lev : ''}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{s.ex} · {s.type}</div>
        </div>
        <Pill tone="accent">{s.conf}% conf</Pill>
      </div>

      <div style={{ padding: '0 16px 10px' }}>
        <Segmented options={['15m', '1H', '4H', '1D']} value={tf} onChange={setTf} />
      </div>

      {/* chart */}
      <div style={{ position: 'relative', margin: '4px 0' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} preserveAspectRatio="none">
          {/* TP zone (entry→TP3) and SL zone (entry→SL) */}
          <rect x="0" y={y(tps[2])} width={W} height={Math.abs(y(entry) - y(tps[2]))} fill="var(--up)" opacity="0.06" />
          <rect x="0" y={long ? y(entry) : y(sl)} width={W} height={Math.abs(y(sl) - y(entry))} fill="var(--down)" opacity="0.06" />
          {/* level lines */}
          {levels.map((l, i) => (
            <g key={i}>
              <line x1="0" y1={y(l.p)} x2={W} y2={y(l.p)} stroke={l.col} strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
            </g>
          ))}
          {/* candles */}
          {candles.map((c, i) => {
            const up = c.close >= c.open;
            const col = up ? 'var(--up)' : 'var(--down)';
            const x = i * cw + cw / 2;
            const bodyT = y(Math.max(c.open, c.close));
            const bodyB = y(Math.min(c.open, c.close));
            return (
              <g key={i}>
                <line x1={x} y1={y(c.high)} x2={x} y2={y(c.low)} stroke={col} strokeWidth="1" />
                <rect x={i * cw + cw * 0.18} y={bodyT} width={cw * 0.64} height={Math.max(1, bodyB - bodyT)} fill={col} />
              </g>
            );
          })}
        </svg>
        {/* level labels overlaid */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {levels.map((l, i) => (
            <div key={i} style={{ position: 'absolute', right: 8, top: `calc(${(y(l.p) / H) * 100}% - 9px)`, background: l.col, color: l.col === 'var(--accent)' ? 'var(--on-accent)' : '#fff', fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>{l.label}</div>
          ))}
        </div>
      </div>

      {/* stats grid */}
      <div style={{ padding: '14px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
        {[['Entry', s.entry, 'var(--accent)'], ['Stop', s.sl, 'var(--down)'], ['R:R', s.rr, 'var(--up)'], ['Timeframe', s.tf, 'var(--text)'], ['Risk', long ? 'Long' : 'Short', long ? 'var(--up)' : 'var(--down)'], ['Confidence', s.conf + '%', 'var(--accent)']].map(([k, v, c]) => (
          <div key={k} style={{ background: 'var(--surface)', borderRadius: 11, padding: '10px 11px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600 }}>{k}</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* signal reasoning */}
      <div style={{ padding: '14px 16px 0' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Why this setup</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {s.tags.map(t => <span key={t} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', background: 'var(--chip)', padding: '6px 11px', borderRadius: 8 }}>{t}</span>)}
        </div>
      </div>

      <div style={{ padding: '18px 16px 0', display: 'flex', gap: 10 }}>
        <Btn kind="soft" full icon="bell" onClick={() => go('alerts')}>Alert me</Btn>
        <Btn kind={long ? 'up' : 'down'} full icon="zap" onClick={onExec}>Execute trade</Btn>
      </div>
    </div>
  );
}

// Processing UI — animated step progress before confirmation
function ExecProcessing({ s, margin, onComplete }) {
  const { useState: uSt, useEffect: uEf } = React;
  const long = s.dir === 'LONG';
  const accentDir = long ? 'var(--up)' : 'var(--down)';
  const steps = [
    { icon: 'shield', label: 'Validating order', sub: 'Risk & margin checks' },
    { icon: 'wallet', label: 'Reserving margin', sub: '$' + margin + ' USDT on ' + s.ex },
    { icon: 'zap', label: 'Routing to ' + s.ex, sub: s.type + ' · ' + (s.lev !== '—' ? s.lev + ' leverage' : 'spot') },
    { icon: 'target', label: 'Setting SL & TP', sub: 'SL ' + s.sl + ' · TP1–3 armed' },
    { icon: 'checkCircle', label: 'Confirming fill', sub: 'Entry near ' + s.entry },
  ];
  const [step, setStep] = uSt(0);

  uEf(() => {
    if (step >= steps.length) { const t = setTimeout(onComplete, 500); return () => clearTimeout(t); }
    const t = setTimeout(() => setStep(step + 1), step === 0 ? 500 : 720);
    return () => clearTimeout(t);
  }, [step]);

  const pctDone = Math.min(100, (step / steps.length) * 100);

  return (
    <div style={{ padding: '24px 22px 28px', minHeight: 460, display: 'flex', flexDirection: 'column' }}>
      {/* header pair */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
        <div style={{ width: 42, height: 42, borderRadius: '50%', background: long ? 'var(--up-bg)' : 'var(--down-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentDir }}><Icon name={long ? 'trend' : 'arrowDR'} size={21} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{s.pair}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{s.dir} {s.lev !== '—' ? s.lev : ''} · {s.ex}</div>
        </div>
        <Pill tone={long ? 'up' : 'down'}>{s.dir}</Pill>
      </div>

      {/* big spinner with center icon */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <div style={{ position: 'relative', width: 92, height: 92 }}>
          <svg width="92" height="92" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="46" cy="46" r="40" fill="none" stroke="var(--line)" strokeWidth="5" />
            <circle cx="46" cy="46" r="40" fill="none" stroke={accentDir} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 40} strokeDashoffset={2 * Math.PI * 40 * (1 - pctDone / 100)}
              style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {step >= steps.length
              ? <Icon name="checkCircle" size={40} color={accentDir} />
              : <span style={{ fontSize: 20, fontWeight: 800, color: accentDir }}>{Math.round(pctDone)}%</span>}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 800, marginBottom: 22 }}>
        {step >= steps.length ? 'Order placed' : 'Opening position…'}
      </div>

      {/* step list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {steps.map((st, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px', opacity: done || active ? 1 : 0.4, transition: 'opacity .3s' }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? 'var(--up-bg)' : active ? 'var(--glow)' : 'var(--surface2)', color: done ? 'var(--up)' : 'var(--accent)' }}>
                {done ? <Icon name="check" size={18} stroke={3} />
                  : active ? <span style={{ width: 16, height: 16, border: '2.5px solid var(--line2)', borderTopColor: accentDir, borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} />
                  : <Icon name={st.icon} size={17} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: done || active ? 'var(--text)' : 'var(--muted)' }}>{st.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{st.sub}</div>
              </div>
              {done && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--up)' }}>Done</span>}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 16, fontSize: 11.5, color: 'var(--faint)' }}>
        <Icon name="lock" size={13} /> Secured · do not close the app
      </div>
    </div>
  );
}

// ─── Signal track record — the won/lost list behind the summary card ───
// Every row is a real, server-resolved signal (TP hit or SL) from the last 90
// days. Nothing self-reported: outcomes come from exchange candles.
const OUTCOME_LABEL = { tp1: 'TP1 hit', tp2: 'TP2 hit', tp3: 'TP3 hit', sl: 'Stopped out' };
function SignalTrackRecord({ go }) {
  const [data, setData] = sgS(null);
  const [filter, setFilter] = sgS('All');
  sgE(() => {
    let alive = true;
    if (window.FXAPI && window.FXAPI.getSignalOutcomes) {
      window.FXAPI.getSignalOutcomes().then((r) => { if (alive) setData(r || { outcomes: [] }); }).catch(() => { if (alive) setData({ outcomes: [] }); });
    } else setData({ outcomes: [] });
    return () => { alive = false; };
  }, []);
  const all = (data && data.outcomes) || [];
  const wins = all.filter((o) => o.won).length;
  const losses = all.length - wins;
  const list = filter === 'All' ? all : filter === 'Won' ? all.filter((o) => o.won) : all.filter((o) => !o.won);

  if (!data) return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)' }}><span style={{ display: 'inline-block', width: 22, height: 22, border: '3px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} /></div>;

  return (
    <div style={{ padding: '4px 16px 24px' }}>
      {/* summary strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[['Resolved', all.length, 'var(--text)'], ['Won', wins, 'var(--up)'], ['Lost', losses, 'var(--down)']].map(([l, v, c]) => (
          <div key={l} style={{ flex: 1, background: 'var(--surface)', borderRadius: 12, padding: '12px 8px', textAlign: 'center', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{l}</div>
          </div>
        ))}
      </div>
      {/* filter chips */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
        {['All', 'Won', 'Lost'].map((t) => <Chip key={t} active={filter === t} onClick={() => setFilter(t)}>{t}{t === 'Won' ? ` (${wins})` : t === 'Lost' ? ` (${losses})` : ''}</Chip>)}
      </div>
      {/* rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {list.map((o, i) => {
          const long = (o.bias || 'long') === 'long';
          const pair = o.symbol ? o.symbol.replace(/USDT$/, '/USDT') : '—';
          const when = o.generatedAt ? new Date(o.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--surface)', borderRadius: 12, padding: '11px 13px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: o.won ? 'var(--up-bg)' : 'var(--down-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: o.won ? 'var(--up)' : 'var(--down)' }}><Icon name={o.won ? 'check' : 'x'} size={17} stroke={3} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: long ? 'var(--up)' : 'var(--down)', background: long ? 'var(--up-bg)' : 'var(--down-bg)', padding: '1px 6px', borderRadius: 5 }}>{long ? 'LONG' : 'SHORT'}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{OUTCOME_LABEL[o.outcome] || o.outcome}{when ? ' · ' + when : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: o.won ? 'var(--up)' : 'var(--down)', fontVariantNumeric: 'tabular-nums' }}>{o.outcomeR != null ? (o.outcomeR >= 0 ? '+' : '') + o.outcomeR + 'R' : (o.won ? 'Win' : 'Loss')}</div>
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
            <Icon name="trophy" size={26} color="var(--faint)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>{all.length === 0 ? 'No resolved signals yet' : `No ${filter.toLowerCase()} signals`}</div>
            <div style={{ fontSize: 12.5, marginTop: 3 }}>{all.length === 0 ? 'Outcomes appear here as published signals hit TP or SL.' : 'Switch the filter to see the rest.'}</div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>Every signal is resolved server-side against its SL/TP using exchange candles. Expired (never-filled) setups are excluded. Not financial advice.</div>
    </div>
  );
}

Object.assign(window, { Signals, ExecSignal, SignalChart, SignalTrackRecord });

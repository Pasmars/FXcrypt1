// wallet.jsx — multi-chain portfolio, send/receive, PnL
import { QRCodeSVG } from 'qrcode.react';
const { useState: wS, useEffect: wE, useRef: wR } = React;

// Live snapshot of the self-custody wallet engine; re-renders on 'fx:update'.
const EMPTY_W = { loaded: false, locked: false, protected: false, hasWallets: false, wallets: [], addresses: {}, holdings: [], allHoldings: [], total: 0, settings: { hiddenChains: [], hiddenTokens: [], hideSmall: false }, contacts: [], connectedApps: [] };
function useFXW() {
  const [, force] = wS(0);
  wE(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('fx:update', h);
    if (window.FXWallet && !window.FXWallet.ready()) window.FXWallet.load();
    return () => window.removeEventListener('fx:update', h);
  }, []);
  return (window.FXWallet && window.FXWallet.state()) || EMPTY_W;
}
const FXW = () => window.FXWallet;

// Password prompt used for unlock, set-password, and reveal/confirm gates.
function PwGate({ title, sub, cta, onSubmit, confirm }) {
  const [pw, setPw] = wS('');
  const [pw2, setPw2] = wS('');
  const [err, setErr] = wS('');
  const [busy, setBusy] = wS(false);
  const submit = async () => {
    if (busy) return;
    if (confirm && pw !== pw2) { setErr('Passwords do not match'); return; }
    setErr(''); setBusy(true);
    try { await onSubmit(pw); } catch (e) { setErr(e.message || 'Failed'); setBusy(false); }
  };
  return (
    <div style={{ padding: '6px 2px' }}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)', marginTop: 14 }}>
        <Icon name="lock" size={17} color="var(--muted)" />
        <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !confirm) submit(); }} placeholder="Wallet password" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit' }} />
      </div>
      {confirm && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)', marginTop: 9 }}>
          <Icon name="lock" size={17} color="var(--muted)" />
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Confirm password" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit' }} />
        </div>
      )}
      {err && <div style={{ marginTop: 12, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '10px 12px', fontWeight: 600 }}>{err}</div>}
      <div style={{ marginTop: 16 }}><Btn size="lg" full icon="check" onClick={submit} disabled={busy || !pw} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'Please wait…' : (cta || 'Unlock')}</Btn></div>
    </div>
  );
}

function Wallet({ go }) {
  const FX = window.FX;
  const W = useFXW();
  const [tab, setTab] = wS('tokens');
  const [send, setSend] = wS(false);
  const [recv, setRecv] = wS(false);
  const [manage, setManage] = wS(false);
  const [hide, setHide] = wS(false);
  const holdings = W.holdings;
  const total = W.total;
  const todayVal = holdings.reduce((a, h) => a + h.value * (h.ch24 / 100), 0);
  const todayPct = total ? (todayVal / (total - todayVal || total)) * 100 : 0;
  const dim = (v) => (hide ? '••••••' : v);

  return (
    <div>
      <TopBar title="Wallet" sub={W.hasWallets ? (W.wallets.length + (W.wallets.length === 1 ? ' chain' : ' chains') + ' · self-custody') : 'Self-custody'}
        right={<><IconBtn name="history" onClick={() => setTab('activity')} /><IconBtn name="qr" onClick={() => setRecv(true)} /></>} />
      <div style={{ padding: '0 16px' }}>
        {/* balance card */}
        <div style={{ background: 'linear-gradient(150deg, var(--surface2), var(--surface))', borderRadius: 18, padding: 18, boxShadow: 'inset 0 0 0 1px var(--line)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -30, right: -20, width: 140, height: 140, borderRadius: '50%', background: 'var(--glow)', filter: 'blur(30px)' }} />
          <div style={{ position: 'relative' }}>
            <button onClick={() => setHide((h) => !h)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Total balance <Icon name={hide ? 'xCircle' : 'eye'} size={14} /></button>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.8, margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>{dim(fmtUsd(total))}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
              <Change v={+todayPct.toFixed(2)} size={13.5} />
              <span style={{ color: 'var(--muted)' }}>{todayVal >= 0 ? '+' : '-'}{dim(fmtUsd(Math.abs(todayVal)))} today</span>
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 16 }}>
              {[['send', 'Send', () => setSend(true)], ['receive', 'Receive', () => setRecv(true)], ['swap', 'Swap', () => go('trade')], ['dollar', 'PnL', () => setTab('pnl')]].map(([ic, l, fn]) => (
                <button key={l} onClick={fn} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit' }}>
                  <span style={{ width: 46, height: 46, borderRadius: 14, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)' }}><Icon name={ic} size={21} /></span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{l}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Segmented options={[{ value: 'tokens', label: 'Tokens' }, { value: 'pnl', label: 'PnL' }, { value: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} />
        </div>
        <button onClick={() => setManage(true)} aria-label="Manage wallet" style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
          <Icon name="sliders" size={20} />
        </button>
      </div>
      {tab === 'tokens' && <div style={{ padding: '6px 8px 16px' }}>
        {!W.hasWallets && (
          <div style={{ textAlign: 'center', padding: '30px 16px' }}>
            <div style={{ width: 60, height: 60, borderRadius: 18, background: 'var(--surface2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, color: 'var(--accent)' }}><Icon name="wallet" size={28} /></div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>No wallet yet</div>
            <div style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 16px', lineHeight: 1.5 }}>Create a fresh encrypted wallet or import an existing one. Your keys are encrypted on this device and never leave it.</div>
            <Btn full icon="plus" onClick={() => setManage(true)}>Create or import a wallet</Btn>
          </div>
        )}
        {W.hasWallets && holdings.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 36, fontSize: 13.5 }}>{W.loaded ? 'No funds yet — receive to get started.' : 'Loading balances…'}</div>
        )}
        {holdings.map((h) => (
          <div key={h.chain + ':' + h.sym + (h.address || '')} onClick={() => { const t = FX.tokens.find((x) => x.sym === h.sym); if (t) go('token', { token: t }); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 10px', cursor: 'pointer' }}>
            <Logo color={h.logo} sym={h.sym} chain={h.chain} img={h.img} address={h.address || h.tokenAddress} size={40} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{h.sym}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{dim(h.amount)} {h.sym}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>{dim(fmtUsd(h.value))}</div>
              <Change v={h.ch24} size={12} />
            </div>
          </div>
        ))}
      </div>}
      {tab === 'pnl' && <PnL holdings={holdings} total={total} />}
      {tab === 'activity' && <Activity wallets={W.wallets} />}

      <Sheet open={send} onClose={() => setSend(false)} title="Send"><SendForm onClose={() => setSend(false)} go={go} /></Sheet>
      <Sheet open={recv} onClose={() => setRecv(false)} title="Receive"><ReceiveBody /></Sheet>
      <Sheet open={manage} onClose={() => setManage(false)} height="86%"><WalletManage onClose={() => setManage(false)} go={go} /></Sheet>
    </div>
  );
}

function PnL({ holdings, total }) {
  // Real 24h P/L derived from live holdings. Cost-basis (all-time/realized) PnL
  // needs trade history we don't track yet, so we show what is genuinely known.
  const rows = (holdings || []).map((h) => { const yest = h.value / (1 + h.ch24 / 100); return { ...h, pl: h.value - yest }; });
  const dayPl = rows.reduce((a, r) => a + r.pl, 0);
  const dayPct = total ? (dayPl / (total - dayPl || total)) * 100 : 0;
  if (!rows.length) return <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 36, fontSize: 13.5 }}>No positions to compute PnL.</div>;
  return (
    <div style={{ padding: '6px 16px 16px' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: dayPl >= 0 ? 'var(--up-bg)' : 'var(--down-bg)', borderRadius: 14, padding: 14 }}>
          <div style={{ fontSize: 12, color: dayPl >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>24h P/L</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3, color: dayPl >= 0 ? 'var(--up)' : 'var(--down)' }}>{dayPl >= 0 ? '+' : '-'}{fmtUsd(Math.abs(dayPl))}</div>
          <div style={{ fontSize: 12, color: dayPl >= 0 ? 'var(--up)' : 'var(--down)', marginTop: 1 }}>{dayPct >= 0 ? '+' : ''}{dayPct.toFixed(2)}% today</div>
        </div>
        <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 14, padding: 14, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>Portfolio value</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>{fmtUsd(total)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{rows.length} position{rows.length === 1 ? '' : 's'}</div>
        </div>
      </div>
      <SecHead>By position</SecHead>
      <div style={{ marginTop: 8 }}>
        {rows.map((h) => (
          <div key={h.chain + ':' + h.sym} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px', borderBottom: '1px solid var(--line)' }}>
            <Logo color={h.logo} sym={h.sym} chain={h.chain} img={h.img} address={h.address || h.tokenAddress} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{h.sym}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{h.amount} {h.sym} · {fmtUsd(h.value)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: h.pl >= 0 ? 'var(--up)' : 'var(--down)' }}>{h.pl >= 0 ? '+' : ''}{fmtUsd(Math.abs(h.pl))}</div>
              <Change v={h.ch24} size={12} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 14, fontSize: 12, color: 'var(--faint)' }}>
        <Icon name="layers" size={14} /> 24h P/L auto-computed from on-chain holdings
      </div>
    </div>
  );
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); return d + 'd ago';
}
function truncAddr(a) { return a && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }

function Activity({ wallets }) {
  const [items, setItems] = wS(null); // null = loading
  wE(() => {
    let alive = true;
    (async () => {
      if (!wallets || !wallets.length || !window.FXWallet) { setItems([]); return; }
      const lists = await Promise.all(wallets.map((w) => window.FXWallet.txHistory(w.chain).then((tx) => (tx || []).map((t) => ({ ...t, chain: w.chain })))));
      if (!alive) return;
      const merged = lists.flat().filter((t) => t.ts).sort((a, b) => b.ts - a.ts).slice(0, 25);
      setItems(merged);
    })();
    return () => { alive = false; };
  }, [JSON.stringify((wallets || []).map((w) => w.chain + w.address))]);

  if (items === null) return <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 36, fontSize: 13.5 }}>Loading activity…</div>;
  if (!items.length) return <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 36, fontSize: 13.5 }}>No recent transactions.</div>;
  const CC = window.FXWallet ? window.FXWallet.chains : [];
  const explorerFor = (chain) => (CC.find((c) => c.key === chain) || {}).txExplorer;
  return (
    <div style={{ padding: '6px 16px 16px' }}>
      {items.map((a, i) => {
        const incoming = a.incoming === true;
        const ic = a.err ? ['xCircle', 'var(--down)'] : incoming ? ['receive', 'var(--up)'] : a.incoming === false ? ['send', 'var(--text2)'] : ['layers', 'var(--muted)'];
        const label = a.err ? 'Failed' : incoming ? 'Received' : a.incoming === false ? 'Sent' : 'Transaction';
        const ex = explorerFor(a.chain);
        return (
          <div key={a.hash + i} onClick={() => { if (ex) window.open(ex + a.hash, '_blank'); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px', borderBottom: '1px solid var(--line)', cursor: ex ? 'pointer' : 'default' }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ic[1] }}><Icon name={ic[0]} size={18} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{label} {a.symbol || ''}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.counterparty ? truncAddr(a.counterparty) + ' · ' : ''}{timeAgo(a.ts)}</div>
            </div>
            {a.value != null && <div style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: incoming ? 'var(--up)' : 'var(--text)' }}>{incoming ? '+' : '-'}{(+a.value).toFixed(4)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function SendForm({ onClose }) {
  const W = useFXW();
  const holdings = W.holdings;
  const [tok, setTok] = wS(null);
  const [picking, setPicking] = wS(false);
  const [to, setTo] = wS('');
  const [amt, setAmt] = wS('');
  const [mode, setMode] = wS('token'); // 'token' | 'usd'
  const [stage, setStage] = wS('form'); // form | review | sending | done | error
  const [result, setResult] = wS(null);
  const [err, setErr] = wS('');

  const sel = tok || holdings[0] || null;
  const fmtTok = (n) => (n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : n.toFixed(8));

  // Locked wallet → unlock first.
  if (W.locked) return <div style={{ paddingTop: 4 }}><PwGate title="Unlock to send" sub="Enter your wallet password to authorise transfers." cta="Unlock" onSubmit={(pw) => FXW().unlock(pw)} /></div>;
  if (!holdings.length) return <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30, fontSize: 14 }}>No funds available to send.</div>;
  if (!sel) return null;

  const bal = parseFloat(String(sel.amount).replace(/[^0-9.]/g, '')) || 0;
  const num = parseFloat(amt) || 0;
  const tokenAmt = mode === 'token' ? num : (sel.price ? num / sel.price : 0);
  const usdAmt = mode === 'token' ? num * (sel.price || 0) : num;
  const setMax = () => { setMode('token'); setAmt(String(bal)); };
  const recipientOk = to.trim() && window.FXWallet && window.FXWallet.isValidAddress(sel.chain, to.trim());

  const doSend = async () => {
    setStage('sending'); setErr('');
    try {
      const sig = await FXW().send({ chain: sel.chain, to: to.trim(), amount: tokenAmt, token: sel.address ? { address: sel.address, decimals: sel.decimals } : null });
      const hash = typeof sig === 'string' ? sig : (sig && sig.hash) || '';
      const ex = (FXW().chains.find((c) => c.key === sel.chain) || {}).txExplorer;
      setResult({ hash, url: ex ? ex + hash : null });
      setStage('done');
      FXW().refreshPortfolio();
    } catch (e) { setErr(e.message || 'Transaction failed'); setStage('error'); }
  };

  if (stage === 'sending') return (
    <div style={{ padding: '36px 6px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 60, height: 60, borderRadius: '50%', border: '3px solid var(--line2)', borderTopColor: 'var(--accent)', animation: 'fxspin .8s linear infinite', marginBottom: 18 }} />
      <div style={{ fontSize: 16.5, fontWeight: 800 }}>Broadcasting transaction…</div>
      <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6 }}>Signing and submitting to the network.</div>
    </div>
  );
  if (stage === 'done') return (
    <FlowSuccess icon="checkCircle" title="Sent" body={`${fmtTok(tokenAmt)} ${sel.sym} is on its way to ${truncAddr(to.trim())}.`} onDone={onClose} />
  );
  if (stage === 'error') return (
    <div style={{ padding: '10px 4px' }}>
      <div style={{ background: 'var(--down-bg)', borderRadius: 13, padding: 14, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="alert" size={18} color="var(--down)" style={{ marginTop: 1 }} /><div style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5 }}>{err}</div>
      </div>
      <Btn full kind="soft" icon="refresh" onClick={() => setStage('form')}>Back</Btn>
    </div>
  );
  if (stage === 'review') return (
    <div style={{ paddingBottom: 10 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        {[['Asset', sel.sym + ' · ' + (FXW().chains.find((c) => c.key === sel.chain) || {}).label], ['Amount', fmtTok(tokenAmt) + ' ' + sel.sym], ['≈ Value', fmtUsd(usdAmt)], ['To', truncAddr(to.trim())]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--line)', fontSize: 14 }}>
            <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 700, fontFamily: k === 'To' ? 'ui-monospace, monospace' : 'inherit' }}>{v}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, fontSize: 12, color: 'var(--down)', fontWeight: 600 }}><Icon name="alert" size={14} /> Crypto transfers are irreversible. Check the address.</div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn kind="soft" full icon="chevL" onClick={() => setStage('form')}>Back</Btn>
        <Btn full kind="up" icon="send" onClick={doSend}>Confirm send</Btn>
      </div>
    </div>
  );

  if (picking) {
    return (
      <div style={{ paddingBottom: 10 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600, margin: '0 2px 8px' }}>Select asset to send</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {holdings.map((h) => (
            <button key={h.chain + ':' + h.sym} onClick={() => { setTok(h); setAmt(''); setPicking(false); }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 6px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
              <Logo color={h.logo} sym={h.sym} chain={h.chain} img={h.img} address={h.address || h.tokenAddress} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>{h.sym}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{h.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{h.amount}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtUsd(h.value)}</div>
              </div>
              {sel.chain === h.chain && sel.sym === h.sym && <Icon name="checkCircle" size={18} color="var(--accent)" />}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 10 }}>
      {/* asset selector */}
      <button onClick={() => setPicking(true)} style={{ width: '100%', background: 'var(--surface)', borderRadius: 13, padding: '13px 15px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 11, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
        <Logo color={sel.logo} sym={sel.sym} chain={sel.chain} img={sel.img} address={sel.address || sel.tokenAddress} size={38} />
        <div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontWeight: 700, color: 'var(--text)' }}>{sel.name}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>Balance {sel.amount} {sel.sym} · {fmtUsd(sel.value)}</div></div>
        <Icon name="chevD" size={18} color="var(--muted)" />
      </button>
      {/* recipient */}
      <div style={{ background: 'var(--surface)', borderRadius: 13, padding: '13px 15px', boxShadow: `inset 0 0 0 1px ${to && !recipientOk ? 'var(--down)' : 'var(--line)'}`, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>Recipient ({(FXW().chains.find((c) => c.key === sel.chain) || {}).label})</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={sel.chain === 'sol' ? 'Solana address' : sel.chain === 'ton' ? 'TON address' : '0x… address'} style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14.5, fontFamily: 'ui-monospace, monospace' }} />
          {to && <Icon name={recipientOk ? 'checkCircle' : 'xCircle'} size={18} color={recipientOk ? 'var(--up)' : 'var(--down)'} />}
        </div>
      </div>
      {/* amount with native/USD toggle */}
      <div style={{ background: 'var(--surface)', borderRadius: 13, padding: '13px 15px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Amount</span>
          <div style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 8, padding: 3, gap: 2 }}>
            {[['token', sel.sym], ['usd', 'USD']].map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setAmt(''); }} style={{ border: 'none', cursor: 'pointer', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit', background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? 'var(--on-accent)' : 'var(--muted)' }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {mode === 'usd' && <span style={{ fontSize: 26, fontWeight: 800, color: num ? 'var(--text)' : 'var(--faint)' }}>$</span>}
          <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" inputMode="decimal" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 26, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
          <button onClick={setMax} style={{ background: 'var(--chip)', border: 'none', borderRadius: 8, padding: '6px 11px', fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>Max</button>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{mode === 'token' ? sel.sym : 'USD'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 13, color: 'var(--muted)' }}>
          <Icon name="swap" size={13} color="var(--muted)" />
          <span>{mode === 'token' ? '≈ ' + fmtUsd(usdAmt) : '≈ ' + fmtTok(tokenAmt) + ' ' + sel.sym}</span>
        </div>
      </div>
      {tokenAmt > bal && <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: -6, marginBottom: 12, fontSize: 12.5, color: 'var(--down)', fontWeight: 600 }}><Icon name="alert" size={14} /> Amount exceeds balance</div>}
      <Btn size="lg" full icon="send" onClick={() => setStage('review')} disabled={!num || tokenAmt > bal || !recipientOk}>
        {!recipientOk && to ? 'Invalid address' : num ? 'Review · ' + fmtTok(tokenAmt) + ' ' + sel.sym : 'Enter an amount'}
      </Btn>
    </div>
  );
}

function ReceiveBody() {
  const W = useFXW();
  const addrs = W.addresses || {};
  const entries = Object.entries(addrs);
  const [sel, setSel] = wS(entries[0] ? entries[0][0] : null);
  const [copied, setCopied] = wS(false);
  const chainName = (id) => ((W.wallets.find((w) => w.chain === id) || {}).label) || String(id).toUpperCase();

  // No wallet configured → never show a placeholder address someone might use.
  if (!entries.length) {
    return (
      <div style={{ textAlign: 'center', padding: '22px 12px 14px' }}>
        <div style={{ width: 60, height: 60, borderRadius: 18, background: 'var(--surface2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, color: 'var(--muted)' }}><Icon name="wallet" size={28} /></div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>No deposit address yet</div>
        <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>Set up or link a wallet first to get an address you can safely receive funds on.</div>
      </div>
    );
  }

  const cur = (sel && addrs[sel]) ? sel : entries[0][0];
  const address = addrs[cur];
  const copy = () => { try { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };
  const share = () => { try { if (navigator.share) navigator.share({ text: address }); else copy(); } catch (e) {} };

  return (
    <div style={{ textAlign: 'center', paddingBottom: 12 }}>
      {entries.length > 1 && (
        <div style={{ display: 'flex', gap: 7, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          {entries.map(([id]) => <Chip key={id} active={cur === id} onClick={() => setSel(id)}>{chainName(id)}</Chip>)}
        </div>
      )}
      <div style={{ display: 'inline-block', background: '#fff', padding: 16, borderRadius: 18, margin: '6px 0 14px' }}>
        <QRCodeSVG value={address} size={156} bgColor="#ffffff" fgColor="#0B0E11" />
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>Your {chainName(cur)} address</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--surface)', borderRadius: 12, padding: '12px 16px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{address}</span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn kind="soft" full icon={copied ? 'check' : 'copy'} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Btn>
        <Btn full icon="send" onClick={share}>Share</Btn>
      </div>
    </div>
  );
}

// ─── Wallet management (multi-view sheet) ───
function WMHeader({ title, sub, onBack, onClose, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '2px 0 14px' }}>
      {onBack && <button onClick={onBack} style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--surface)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)', boxShadow: 'inset 0 0 0 1px var(--line)' }}><Icon name="chevL" size={19} /></button>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3 }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: -1 }}>{sub}</div>}
      </div>
      {action}
      {onClose && !onBack && <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--chip)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}><Icon name="x" size={16} /></button>}
    </div>
  );
}

function WMRow({ icon, title, detail, onClick, danger, right, tone }) {
  return (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
      <div style={{ width: 36, height: 36, borderRadius: 11, background: danger ? 'var(--down-bg)' : tone === 'accent' ? 'var(--glow)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: danger ? 'var(--down)' : 'var(--accent)', flexShrink: 0 }}><Icon name={icon} size={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: danger ? 'var(--down)' : 'var(--text)' }}>{title}</div>
        {detail && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{detail}</div>}
      </div>
      {right !== undefined ? right : <Icon name="chevR" size={17} color="var(--faint)" />}
    </button>
  );
}

// Gate that ensures a session password exists (set first-time, or unlock) before
// rendering its children. Re-renders automatically once the engine unlocks.
function GateThen({ children }) {
  const W = useFXW();
  if (!W.protected) return <PwGate title="Set a wallet password" sub="This encrypts your keys on this device — you'll need it to unlock and to send. We can't reset it for you, so store it safely." cta="Set password" confirm onSubmit={(pw) => FXW().setInitialPassword(pw)} />;
  if (W.locked) return <PwGate title="Unlock wallet" sub="Enter your wallet password to continue." cta="Unlock" onSubmit={(pw) => FXW().unlock(pw)} />;
  return children;
}

function WalletManage({ onClose, go }) {
  const W = useFXW();
  const [view, setView] = wS('menu');
  const [copied, setCopied] = wS('');
  const wallets = W.wallets;
  const copy = (addr) => { try { navigator.clipboard.writeText(addr); setCopied(addr); setTimeout(() => setCopied(''), 1400); } catch (e) {} };

  // ── menu ──
  if (view === 'menu') {
    const items = [
      ['wallet', 'Manage wallets', wallets.length + (wallets.length === 1 ? ' chain wallet' : ' chain wallets'), 'wallets'],
      ['layers', 'Networks', 'Choose visible chains', 'networks'],
      ['eye', 'Token visibility', 'Hide tokens & small balances', 'tokens'],
      ['shield', 'Security & backup', 'Recovery phrase, keys, password', 'security'],
      ['link', 'Connected apps', W.connectedApps.length + ' dApps connected', 'apps'],
      ['user', 'Address book', W.contacts.length + ' saved addresses', 'contacts'],
    ];
    return (
      <div style={{ paddingBottom: 10 }}>
        <WMHeader title="Wallet management" sub={W.hasWallets ? 'Self-custody · encrypted on device' : 'No wallet yet'} onClose={onClose} />
        {/* portfolio card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg, var(--surface), var(--glow))', borderRadius: 14, padding: 14, boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)' }}><Icon name={W.locked ? 'lock' : 'wallet'} size={23} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800 }}>{W.hasWallets ? 'Your wallet' : 'No wallet'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{W.locked ? 'Locked' : wallets.length + ' chain' + (wallets.length === 1 ? '' : 's')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(W.total)}</div>
            {W.locked && <button onClick={() => setView('unlock')} style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Unlock</button>}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden' }}>
          {items.map(([ic, t, d, v]) => <WMRow key={v} icon={ic} title={t} detail={d} onClick={() => setView(v)} />)}
        </div>
        <div style={{ marginTop: 16 }}>
          <Btn kind="soft" full icon="plus" onClick={() => setView('add')}>Add or import wallet</Btn>
        </div>
      </div>
    );
  }

  if (view === 'unlock') return <div style={{ paddingBottom: 10 }}><WMHeader title="Unlock wallet" onBack={() => setView('menu')} /><PwGate title="Enter your wallet password" cta="Unlock" onSubmit={async (pw) => { await FXW().unlock(pw); setView('menu'); }} /></div>;

  // ── manage wallets (per-chain) ──
  if (view === 'wallets') {
    return (
      <div style={{ paddingBottom: 10 }}>
        <WMHeader title="Manage wallets" sub="One self-custody wallet per chain" onBack={() => setView('menu')}
          action={<button onClick={() => setView('add')} style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--glow)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="plus" size={19} /></button>} />
        {!wallets.length && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30, fontSize: 14 }}>No wallets yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {wallets.map((w) => {
            const h = W.allHoldings.filter((x) => x.chain === w.chain).reduce((a, x) => a + x.value, 0);
            return (
              <div key={w.chain} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', borderRadius: 14, padding: 14, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: w.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 14.5, fontWeight: 700 }}>{w.label}</span><Pill tone="muted">{w.symbol}</Pill></div>
                  <button onClick={() => copy(w.address)} style={{ fontSize: 12, color: copied === w.address ? 'var(--up)' : 'var(--muted)', fontFamily: 'ui-monospace, monospace', marginTop: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}>{truncAddr(w.address)} <Icon name={copied === w.address ? 'check' : 'copy'} size={12} /></button>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(h)}</div>
                  <button onClick={() => { if (confirm(`Remove the ${w.label} wallet from this device? Make sure you have its recovery phrase or private key backed up — this cannot be undone.`)) FXW().removeWallet(w.chain); }} style={{ fontSize: 11, color: 'var(--down)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Remove</button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 14 }}><Btn kind="soft" full icon="plus" onClick={() => setView('add')}>Add or import wallet</Btn></div>
      </div>
    );
  }

  // ── add / import wallet ──
  if (view === 'add') {
    const opts = [
      ['plus', 'Create new wallet', 'Fresh encrypted wallet', 'Recommended', 'create'],
      ['receive', 'Import seed phrase', 'Restore from a 12/24-word phrase', '', 'seed'],
      ['lock', 'Import private key', 'Single-chain account', '', 'pkey'],
      ['link', 'WalletConnect', 'MetaMask, Phantom, Rabby…', 'Soon', 'wc'],
      ['shield', 'Hardware wallet', 'Ledger · most secure', 'Soon', 'hardware'],
    ];
    return (
      <div style={{ paddingBottom: 10 }}>
        <WMHeader title="Add wallet" sub="Create or import" onBack={() => setView(wallets.length ? 'wallets' : 'menu')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {opts.map(([ic, t, d, tag, dest], i) => (
            <button key={t} onClick={() => setView(dest)} style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--surface)', borderRadius: 14, padding: 14, border: 'none', boxShadow: i === 0 ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: i === 0 ? 'var(--accent)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: i === 0 ? 'var(--on-accent)' : 'var(--accent)', flexShrink: 0 }}><Icon name={ic} size={20} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>{t}</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{d}</div>
              </div>
              {tag ? <Pill tone={tag === 'Soon' ? 'muted' : 'accent'}>{tag}</Pill> : <Icon name="chevR" size={17} color="var(--faint)" />}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const done = () => setView('wallets');
  if (view === 'create')   return <CreateWalletFlow onBack={() => setView('add')} onDone={done} />;
  if (view === 'seed')     return <ImportSeedFlow onBack={() => setView('add')} onDone={done} />;
  if (view === 'pkey')     return <ImportKeyFlow onBack={() => setView('add')} onDone={done} />;
  if (view === 'wc' || view === 'hardware') return <SoonFlow kind={view} onBack={() => setView('add')} />;

  // ── networks ──
  if (view === 'networks') return <NetworksView onBack={() => setView('menu')} />;
  // ── token visibility ──
  if (view === 'tokens') return <TokenVisibilityView onBack={() => setView('menu')} />;
  // ── security ──
  if (view === 'security') return <SecurityView onBack={() => setView('menu')} />;
  // ── connected apps ──
  if (view === 'apps') return <ConnectedAppsView onBack={() => setView('menu')} />;
  // ── address book ──
  if (view === 'contacts') return <ContactsView onBack={() => setView('menu')} />;

  return null;
}

function NetworksView({ onBack }) {
  const W = useFXW();
  const chains = FXW() ? FXW().chains : [];
  const hidden = new Set(W.settings.hiddenChains || []);
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Networks" sub="Show or hide chains" onBack={onBack} />
      <div style={{ background: 'var(--surface)', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden' }}>
        {chains.map((c) => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>{c.label}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.symbol}</div>
            </div>
            <Toggle on={!hidden.has(c.key)} onClick={() => FXW().toggleHidden('hiddenChains', c.key)} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 11.5, color: 'var(--faint)', marginTop: 14 }}><Icon name="info" size={13} /> Hidden chains are excluded from your balances</div>
    </div>
  );
}

function TokenVisibilityView({ onBack }) {
  const W = useFXW();
  const hidden = new Set(W.settings.hiddenTokens || []);
  // Show every token the wallet has seen (visible + hidden), de-duped by symbol.
  const seen = []; const seenSet = new Set();
  for (const h of W.allHoldings) { if (!seenSet.has(h.sym)) { seenSet.add(h.sym); seen.push(h); } }
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Token visibility" sub="Curate what appears in your wallet" onBack={onBack} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}><Icon name="filter" size={16} color="var(--accent)" /> Hide small balances ({'<'}$1)</span>
        <Toggle on={!!W.settings.hideSmall} onClick={() => FXW().saveSettings({ hideSmall: !W.settings.hideSmall })} />
      </div>
      {seen.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13.5 }}>No tokens to manage yet.</div>}
      <div style={{ background: 'var(--surface)', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden' }}>
        {seen.map((h) => {
          const vis = !hidden.has(h.sym);
          return (
            <div key={h.chain + ':' + h.sym} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
              <Logo color={h.logo} sym={h.sym} chain={h.chain} img={h.img} address={h.address || h.tokenAddress} size={34} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{h.sym}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtUsd(h.value)}</div>
              </div>
              <button onClick={() => FXW().toggleHidden('hiddenTokens', h.sym)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <Icon name={vis ? 'eye' : 'xCircle'} size={20} color={vis ? 'var(--accent)' : 'var(--faint)'} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RevealFlow({ type, onBack }) {
  const W = useFXW();
  const usable = W.wallets.filter((w) => (type === 'mnemonic' ? w.hasMnemonic : true));
  const [chain, setChain] = wS(usable[0] ? usable[0].chain : null);
  const [secret, setSecret] = wS(null);
  const title = type === 'mnemonic' ? 'Recovery phrase' : 'Private key';

  if (!usable.length) return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title={title} onBack={onBack} />
      <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30, fontSize: 13.5, lineHeight: 1.5 }}>{type === 'mnemonic' ? 'None of your wallets has a stored recovery phrase. Only wallets created here or imported from a phrase have one — use “Export private key” instead.' : 'No wallet to export yet.'}</div>
    </div>
  );
  if (secret) return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title={title} sub={(FXW().chains.find((c) => c.key === chain) || {}).label} onBack={onBack} />
      <SecretBackup secret={type === 'mnemonic' ? { mnemonic: secret } : { privateKey: secret }} onSaved={onBack} />
    </div>
  );
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title={'Reveal ' + title.toLowerCase()} onBack={onBack} />
      {usable.length > 1 && <>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '0 2px 8px' }}>Wallet</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>{usable.map((w) => <Chip key={w.chain} active={chain === w.chain} onClick={() => setChain(w.chain)}>{w.label}</Chip>)}</div>
      </>}
      <PwGate title={'Enter your wallet password'} sub={'Authenticate to reveal your ' + title.toLowerCase() + '. Make sure nobody is watching your screen.'} cta="Reveal" onSubmit={async (pw) => { const s = await FXW().reveal(chain, type, pw); setSecret(s); }} />
    </div>
  );
}

function ChangePwFlow({ onBack }) {
  const [oldPw, setOldPw] = wS('');
  const [n1, setN1] = wS('');
  const [n2, setN2] = wS('');
  const [busy, setBusy] = wS(false);
  const [err, setErr] = wS('');
  const [done, setDone] = wS(false);
  const submit = async () => {
    if (n1 !== n2) { setErr('New passwords do not match'); return; }
    setBusy(true); setErr('');
    try { await FXW().changePassword(oldPw, n1); setDone(true); } catch (e) { setErr(e.message || 'Failed'); setBusy(false); }
  };
  if (done) return <FlowSuccess icon="shield" title="Password changed" body="All your wallets were re-encrypted with the new password." onDone={onBack} />;
  const field = (val, set, ph) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 9 }}>
      <Icon name="lock" size={17} color="var(--muted)" />
      <input type="password" value={val} onChange={(e) => set(e.target.value)} placeholder={ph} style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit' }} />
    </div>
  );
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Change password" sub="Re-encrypts every wallet" onBack={onBack} />
      {field(oldPw, setOldPw, 'Current password')}
      {field(n1, setN1, 'New password')}
      {field(n2, setN2, 'Confirm new password')}
      {err && <div style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '10px 12px', fontWeight: 600 }}>{err}</div>}
      <div style={{ marginTop: 16 }}><Btn size="lg" full icon="check" onClick={submit} disabled={busy || !oldPw || !n1} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'Re-encrypting…' : 'Change password'}</Btn></div>
    </div>
  );
}

function SecurityView({ onBack }) {
  const W = useFXW();
  const [mode, setMode] = wS('menu');
  if (mode === 'phrase') return <RevealFlow type="mnemonic" onBack={() => setMode('menu')} />;
  if (mode === 'key') return <RevealFlow type="privateKey" onBack={() => setMode('menu')} />;
  if (mode === 'change') return <ChangePwFlow onBack={() => setMode('menu')} />;
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Security & backup" sub="Protect your funds" onBack={onBack} />
      <div style={{ background: 'var(--down-bg)', borderRadius: 14, padding: 14, marginBottom: 14, display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <Icon name="alert" size={18} color="var(--down)" style={{ marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>Never share your recovery phrase. FXcrypt will <b style={{ color: 'var(--text)' }}>never</b> ask for it. Anyone with it controls your funds.</div>
      </div>
      {!W.hasWallets ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 24, fontSize: 13.5 }}>Create or import a wallet to access backup options.</div>
      ) : (
        <div style={{ background: 'var(--surface)', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden', marginBottom: 14 }}>
          <WMRow icon="eye" title="Reveal recovery phrase" detail="Password required" onClick={() => setMode('phrase')} tone="accent" />
          <WMRow icon="lock" title="Export private key" detail="Per-chain · password required" onClick={() => setMode('key')} tone="accent" />
          <WMRow icon="shield" title="Change password" detail="Re-encrypts all wallets" onClick={() => setMode('change')} tone="accent" />
        </div>
      )}
      {W.protected && (
        <div style={{ background: 'var(--surface)', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden' }}>
          <WMRow icon="lock" title={W.locked ? 'Wallet is locked' : 'Lock wallet now'} detail={W.locked ? 'Enter your password to use it' : 'Require your password again'} onClick={() => { if (!W.locked) FXW().lock(); }} right={W.locked ? <Pill tone="muted">Locked</Pill> : undefined} />
        </div>
      )}
    </div>
  );
}

function ConnectedAppsView({ onBack }) {
  const W = useFXW();
  const apps = W.connectedApps;
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Connected apps" sub={apps.length + (apps.length === 1 ? ' active session' : ' active sessions')} onBack={onBack} />
      {apps.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
          <Icon name="link" size={28} color="var(--faint)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14 }}>No connected apps</div>
          <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.5, maxWidth: 270, margin: '6px auto 0' }}>dApps you link (via WalletConnect, coming soon) will appear here, and you can revoke them any time.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {apps.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', borderRadius: 14, padding: 13, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: a.logo || 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15 }}>{(a.name || '?')[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.url}{a.perm ? ' · ' + a.perm : ''}</div>
              </div>
              <button onClick={() => FXW().removeConnectedApp(a.id)} style={{ background: 'var(--down-bg)', border: 'none', borderRadius: 9, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, color: 'var(--down)', cursor: 'pointer', fontFamily: 'inherit' }}>Revoke</button>
            </div>
          ))}
        </div>
      )}
      {apps.length > 0 && <div style={{ marginTop: 14 }}><Btn kind="ghost" full icon="x" onClick={() => FXW().removeConnectedApp(null)}>Disconnect all</Btn></div>}
    </div>
  );
}

function ContactsView({ onBack }) {
  const W = useFXW();
  const [add, setAdd] = wS(false);
  const [name, setName] = wS('');
  const [address, setAddress] = wS('');
  const [chain, setChain] = wS('eth');
  const [err, setErr] = wS('');
  const [busy, setBusy] = wS(false);
  const chains = FXW() ? FXW().chains : [];
  const save = async () => {
    setBusy(true); setErr('');
    try { await FXW().addContact({ name: name.trim(), address: address.trim(), chain }); setName(''); setAddress(''); setAdd(false); }
    catch (e) { setErr(e.message || 'Failed'); } finally { setBusy(false); }
  };
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Address book" sub="Saved recipients" onBack={onBack}
        action={<button onClick={() => setAdd(!add)} style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--glow)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name={add ? 'x' : 'plus'} size={19} /></button>} />
      {add && (
        <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 14, boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface2)', borderRadius: 11, padding: '11px 13px', marginBottom: 9 }}>
            <Icon name="user" size={17} color="var(--muted)" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Label (e.g. Coinbase)" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9 }}>{chains.map((c) => <Chip key={c.key} active={chain === c.key} onClick={() => setChain(c.key)}>{c.label}</Chip>)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface2)', borderRadius: 11, padding: '11px 13px', marginBottom: 11 }}>
            <Icon name="wallet" size={17} color="var(--muted)" />
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={chain === 'sol' ? 'Solana address' : chain === 'ton' ? 'TON address' : '0x… address'} style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14, fontFamily: 'ui-monospace, monospace' }} />
          </div>
          {err && <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--down)', fontWeight: 600 }}>{err}</div>}
          <Btn size="sm" full icon="check" onClick={save} disabled={busy || !name.trim() || !address.trim()}>{busy ? 'Saving…' : 'Save contact'}</Btn>
        </div>
      )}
      {W.contacts.length === 0 && !add && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30, fontSize: 13.5 }}>No saved addresses yet.</div>}
      <div style={{ background: 'var(--surface)', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden' }}>
        {W.contacts.map((p) => {
          const ch = chains.find((c) => c.key === p.chain) || { color: 'var(--accent)', label: (p.chain || '').toUpperCase() };
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: ch.color + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ch.color, fontWeight: 800, fontSize: 15 }}>{(p.name || '?')[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{p.name} <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>· {ch.label}</span></div>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>{truncAddr(p.address)}</div>
              </div>
              <button onClick={() => FXW().removeContact(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--faint)' }}><Icon name="x" size={16} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Add-wallet flows ───
function FlowSuccess({ icon, title, body, onDone }) {
  return (
    <div style={{ padding: '24px 6px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--up-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Icon name={icon || 'checkCircle'} size={44} color="var(--up)" />
      </div>
      <div style={{ fontSize: 21, fontWeight: 800 }}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5, maxWidth: 290 }}>{body}</div>
      <div style={{ width: '100%', marginTop: 22 }}><Btn size="lg" full icon="check" onClick={onDone}>Done</Btn></div>
    </div>
  );
}

function StepDots({ n, i }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
      {Array.from({ length: n }).map((_, k) => (
        <div key={k} style={{ flex: 1, height: 4, borderRadius: 2, background: k <= i ? 'var(--accent)' : 'var(--line2)', transition: 'background .2s' }} />
      ))}
    </div>
  );
}

function ChainChips({ value, onChange, only }) {
  const chains = (window.FXWallet ? window.FXWallet.chains : []).filter((c) => !only || only.includes(c.key));
  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
      {chains.map((c) => <Chip key={c.key} active={value === c.key} onClick={() => onChange(c.key)}>{c.label}</Chip>)}
    </div>
  );
}

// Reveal-and-back-up panel for a freshly created/exported secret.
function SecretBackup({ secret, onSaved }) {
  const [revealed, setRevealed] = wS(false);
  const [copied, setCopied] = wS(false);
  const words = secret && secret.mnemonic ? secret.mnemonic.trim().split(/\s+/) : null;
  const blob = words ? secret.mnemonic.trim() : (secret && secret.privateKey) || '';
  const copy = () => { try { navigator.clipboard.writeText(blob); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };
  return (
    <>
      <div style={{ background: 'var(--down-bg)', borderRadius: 13, padding: 13, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="alert" size={17} color="var(--down)" style={{ marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>{words ? 'Write these words down in order.' : 'Save this private key somewhere safe.'} This is the <b style={{ color: 'var(--text)' }}>only</b> way to recover your wallet. Never share it.</div>
      </div>
      <div style={{ position: 'relative', background: 'var(--surface)', borderRadius: 14, padding: 14, boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        {words ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, filter: revealed ? 'none' : 'blur(7px)' }}>
            {words.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', borderRadius: 9, padding: '9px 11px' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, width: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{w}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ filter: revealed ? 'none' : 'blur(7px)', fontFamily: 'ui-monospace, monospace', fontSize: 13, wordBreak: 'break-all', lineHeight: 1.6 }}>{blob}</div>
        )}
        {!revealed && (
          <button onClick={() => setRevealed(true)} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }}>
            <Icon name="eye" size={24} color="var(--accent)" />
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Tap to reveal</span>
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn kind="soft" full icon={copied ? 'check' : 'copy'} onClick={copy} disabled={!revealed}>{copied ? 'Copied' : 'Copy'}</Btn>
        <Btn full icon="check" onClick={onSaved} disabled={!revealed}>I’ve saved it</Btn>
      </div>
    </>
  );
}

function CreateWalletFlow({ onBack, onDone }) {
  const W = useFXW();
  const [chain, setChain] = wS('eth');
  const [phase, setPhase] = wS('pick'); // pick -> backup -> done
  const [secret, setSecret] = wS(null);
  const [busy, setBusy] = wS(false);
  const [err, setErr] = wS('');
  const exists = W.wallets.some((w) => w.chain === chain);
  const label = (FXW().chains.find((c) => c.key === chain) || {}).label;

  const gen = async () => {
    setBusy(true); setErr('');
    try { const r = await FXW().createAndSave(chain, null); setSecret(r); setPhase(r.mnemonic ? 'backup' : 'done'); }
    catch (e) { setErr(e.message || 'Failed'); } finally { setBusy(false); }
  };

  if (phase === 'done') return <FlowSuccess icon="wallet" title="Wallet created" body={`Your ${label} wallet is encrypted on this device and ready to use.`} onDone={onDone} />;
  if (phase === 'backup') return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Back up your wallet" sub="Recovery phrase" onBack={() => setPhase('done')} />
      <SecretBackup secret={secret} onSaved={() => setPhase('done')} />
    </div>
  );

  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Create new wallet" sub="Choose a network" onBack={onBack} />
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '0 2px 8px' }}>Network</div>
      <ChainChips value={chain} onChange={setChain} />
      {exists && <div style={{ display: 'flex', gap: 9, background: 'var(--down-bg)', borderRadius: 12, padding: 12, marginBottom: 12 }}><Icon name="alert" size={16} color="var(--down)" style={{ marginTop: 1 }} /><div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>You already have a {label} wallet. Creating a new one replaces it — back up the old one first.</div></div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--faint)', marginBottom: 16, padding: '0 2px' }}><Icon name="shield" size={14} color="var(--up)" /> Encrypted with PBKDF2 600k · keys never leave your device</div>
      <GateThen>
        {err && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '10px 12px', fontWeight: 600 }}>{err}</div>}
        <Btn size="lg" full icon="plus" onClick={gen} disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'Generating…' : 'Generate ' + label + ' wallet'}</Btn>
      </GateThen>
    </div>
  );
}

function SoonFlow({ kind, onBack }) {
  const meta = kind === 'wc'
    ? { name: 'WalletConnect', icon: 'link', body: 'Linking external wallets like MetaMask and Phantom over WalletConnect is coming soon. For now, import an existing wallet with its recovery phrase or private key — your keys stay encrypted on this device.' }
    : { name: 'Hardware wallet', icon: 'shield', body: 'Ledger / hardware support is on the way. For now, create or import a software wallet — encrypted on-device with your password.' };
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title={meta.name} sub="Coming soon" onBack={onBack} />
      <div style={{ padding: '20px 6px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 70, height: 70, borderRadius: 20, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: 'var(--accent)' }}><Icon name={meta.icon} size={32} /></div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Not available yet</div>
        <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.55, maxWidth: 300 }}>{meta.body}</div>
        <div style={{ width: '100%', marginTop: 22 }}><Btn full kind="soft" icon="chevL" onClick={onBack}>Back to options</Btn></div>
      </div>
    </div>
  );
}

function ImportSeedFlow({ onBack, onDone }) {
  const [chain, setChain] = wS('eth');
  const [phrase, setPhrase] = wS('');
  const [busy, setBusy] = wS(false);
  const [err, setErr] = wS('');
  const wordCount = phrase.trim() ? phrase.trim().split(/\s+/).length : 0;
  const ok = wordCount === 12 || wordCount === 24;
  const importIt = async () => {
    setBusy(true); setErr('');
    try { await FXW().importAndSave(chain, phrase.trim().toLowerCase(), null); onDone(); }
    catch (e) { setErr(e.message || 'Import failed'); setBusy(false); }
  };
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Import seed phrase" sub="Restore a wallet" onBack={onBack} />
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '0 2px 8px' }}>Network</div>
      <ChainChips value={chain} onChange={setChain} only={['eth', 'bsc', 'base', 'matic', 'ton']} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, background: 'var(--surface)', borderRadius: 13, padding: '13px 14px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 10 }}>
        <Icon name="receive" size={18} color="var(--muted)" style={{ marginTop: 2 }} />
        <textarea value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Enter your 12 or 24-word recovery phrase, separated by spaces" rows={4} style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', resize: 'none', minWidth: 0 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--faint)', marginBottom: 16, padding: '0 2px' }}><Icon name="lock" size={13} /> {wordCount} word{wordCount === 1 ? '' : 's'} · processed locally, encrypted on device</div>
      <GateThen>
        {err && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '10px 12px', fontWeight: 600 }}>{err}</div>}
        <Btn size="lg" full icon="check" onClick={importIt} disabled={!ok || busy} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'Importing…' : ok ? 'Import wallet' : 'Enter 12 or 24 words'}</Btn>
      </GateThen>
    </div>
  );
}

function ImportKeyFlow({ onBack, onDone }) {
  const [key, setKey] = wS('');
  const [chain, setChain] = wS('eth');
  const [busy, setBusy] = wS(false);
  const [err, setErr] = wS('');
  const importIt = async () => {
    setBusy(true); setErr('');
    try { await FXW().importAndSave(chain, key.trim(), null); onDone(); }
    catch (e) { setErr(e.message || 'Import failed'); setBusy(false); }
  };
  return (
    <div style={{ paddingBottom: 10 }}>
      <WMHeader title="Import private key" sub="Single-chain account" onBack={onBack} />
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '0 2px 8px' }}>Network</div>
      <ChainChips value={chain} onChange={setChain} />
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '0 2px 8px' }}>Private key</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, background: 'var(--surface)', borderRadius: 13, padding: '13px 14px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        <Icon name="lock" size={18} color="var(--muted)" style={{ marginTop: 2 }} />
        <textarea value={key} onChange={(e) => setKey(e.target.value)} placeholder={chain === 'sol' ? 'Base58 / hex / JSON array secret key' : chain === 'ton' ? 'Hex private key (or 24-word phrase)' : '0x… private key'} rows={3} style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14, fontFamily: 'ui-monospace, monospace', resize: 'none', minWidth: 0 }} />
      </div>
      <div style={{ background: 'var(--down-bg)', borderRadius: 12, padding: 12, marginBottom: 16, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <Icon name="alert" size={16} color="var(--down)" style={{ marginTop: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>Importing a private key is less secure than a seed phrase. Only paste keys you fully control.</div>
      </div>
      <GateThen>
        {err && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '10px 12px', fontWeight: 600 }}>{err}</div>}
        <Btn size="lg" full icon="check" onClick={importIt} disabled={key.trim().length < 8 || busy} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'Importing…' : 'Import account'}</Btn>
      </GateThen>
    </div>
  );
}

Object.assign(window, { Wallet });

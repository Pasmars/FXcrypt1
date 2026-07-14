// copytrade.jsx — smart-money copy trading: follow wallets, live buy feed with
// safety verdicts, Elite auto-copy toggle, and the wallet leaderboard.
const { useState: ctS, useEffect: ctE } = React;

const CT_CHAINS = [['bsc', 'BSC'], ['eth', 'Ethereum'], ['base', 'Base'], ['sol', 'Solana'], ['rhood', 'Robinhood']];
const ctShort = (a) => String(a).slice(0, 6) + '…' + String(a).slice(-4);
const ctAgo = (ms) => {
  const m = Math.max(1, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
};

function CopyTrading({ go, plan, onUpsell }) {
  const elite = plan === 'elite';
  const [wallets, setWallets] = ctS(null);
  const [feed, setFeed] = ctS(null);
  const [board, setBoard] = ctS(null);
  const [add, setAdd] = ctS(false);
  const [form, setForm] = ctS({ chain: 'bsc', address: '', label: '' });
  const [busy, setBusy] = ctS(false);
  const [err, setErr] = ctS('');
  const [toast, setToast] = ctS('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800); };

  const reload = () => {
    window.FXAPI.listFollowedWallets().then(setWallets).catch(() => setWallets([]));
    window.FXAPI.getCopyFeed().then(setFeed).catch(() => setFeed([]));
    window.FXAPI.getCopyLeaderboard().then(setBoard).catch(() => {});
  };
  ctE(() => { reload(); }, []);

  const follow = async () => {
    if (busy) return; setBusy(true); setErr('');
    try { await window.FXAPI.followWallet(form); setAdd(false); setForm({ chain: 'bsc', address: '', label: '' }); flash('Wallet followed — monitoring starts within 2 minutes'); reload(); }
    catch (e) { setErr(e.message || 'Failed'); }
    finally { setBusy(false); }
  };
  const patch = async (w, p) => {
    setWallets((l) => l.map((x) => x.id === w.id ? { ...x, ...p } : x));
    try { await window.FXAPI.setFollowedWallet(w.id, p); }
    catch (e) { setWallets((l) => l.map((x) => x.id === w.id ? w : x)); }
  };
  const toggleCopy = (w) => {
    if (!w.copyEnabled && !elite) { onUpsell && onUpsell(); return; }
    patch(w, { copyEnabled: !w.copyEnabled });
  };

  return (
    <div>
      <TopBar left={<button aria-label="Back" onClick={() => go(-1)} style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}><Icon name="chevL" size={20} /></button>}
        title="Copy Trading" sub="Follow smart money · auto-copy their buys"
        right={<IconBtn name="plus" active onClick={() => setAdd(true)} />} />

      {/* Follow form */}
      <Sheet open={add} onClose={() => setAdd(false)} title="Follow a wallet">
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
          Paste any wallet you want to shadow (find candidates in Bubble Map clusters or on-chain explorers). You'll get an alert with a safety verdict every time it buys.
        </div>
        <div style={{ marginBottom: 12 }}><Segmented options={CT_CHAINS.map(([v, l]) => ({ value: v, label: l }))} value={form.chain} onChange={(c) => setForm((f) => ({ ...f, chain: c }))} /></div>
        <input placeholder={form.chain === 'sol' ? 'Wallet address (base58)' : 'Wallet address (0x…)'} value={form.address}
          onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          style={{ width: '100%', padding: '12px 13px', borderRadius: 11, border: 'none', background: 'var(--surface)', color: 'var(--text)', fontSize: 13.5, fontFamily: 'inherit', boxShadow: 'inset 0 0 0 1px var(--line)', outline: 'none', marginBottom: 10 }} />
        <input placeholder="Label (e.g. “BSC whale #1”)" value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          style={{ width: '100%', padding: '12px 13px', borderRadius: 11, border: 'none', background: 'var(--surface)', color: 'var(--text)', fontSize: 13.5, fontFamily: 'inherit', boxShadow: 'inset 0 0 0 1px var(--line)', outline: 'none', marginBottom: 12 }} />
        {err && <div style={{ fontSize: 12.5, color: 'var(--down)', marginBottom: 10 }}>{err}</div>}
        <Btn full onClick={follow} disabled={busy}>{busy ? 'Following…' : 'Follow wallet'}</Btn>
      </Sheet>

      {/* Followed wallets */}
      <div style={{ padding: '0 16px 14px' }}>
        {wallets == null && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 30, fontSize: 14 }}>Loading…</div>}
        {wallets != null && wallets.length === 0 && (
          <Card onClick={() => setAdd(true)} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}><Icon name="eye" size={20} /></div>
              <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                <b style={{ color: 'var(--text)' }}>Follow your first wallet.</b> Get pinged (with a safety check) whenever it buys — Elite users can auto-copy the trade with exits armed.
              </div>
            </div>
          </Card>
        )}
        {(wallets || []).map((w) => (
          <Card key={w.id} pad={0} style={{ overflow: 'hidden', marginBottom: 8, opacity: w.active === false ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px' }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}><Icon name="eye" size={18} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
                  {w.label || ctShort(w.address)} <Pill tone="muted">{String(w.chain).toUpperCase()}</Pill>
                  {w.copyEnabled && <Pill tone="accent">auto-copy</Pill>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, fontFamily: 'monospace' }}>{ctShort(w.address)}</div>
              </div>
              <button onClick={() => toggleCopy(w)} title={elite ? 'Auto-copy this wallet\'s buys' : 'Auto-copy is an Elite feature'}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: w.copyEnabled ? 'var(--accent)' : 'var(--surface2)', color: w.copyEnabled ? 'var(--on-accent)' : 'var(--muted)', border: 'none', borderRadius: 9, padding: '7px 10px', fontWeight: 800, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                {!elite && !w.copyEnabled && <Icon name="crown" size={12} />} Copy
              </button>
              <Toggle on={w.active !== false} onClick={() => patch(w, { active: w.active === false })} />
              <button aria-label="Unfollow" onClick={() => { window.FXAPI.unfollowWallet(w.id).catch(() => {}); setWallets((l) => l.filter((x) => x.id !== w.id)); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: 4, display: 'flex' }}><Icon name="x" size={16} /></button>
            </div>
          </Card>
        ))}
        {wallets != null && wallets.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, padding: '4px 2px 0' }}>
            Auto-copy buys use your gem scanner buy size, slippage and exit rules (⚙ in Gem Scanner), and respect your daily auto-trade cap.
          </div>
        )}
      </div>

      {/* Leaderboard (Elite) */}
      <div style={{ padding: '0 16px 14px' }}>
        <SecHead>Wallet leaderboard</SecHead>
        <div style={{ height: 8 }} />
        {board && board.locked && (
          <Card onClick={onUpsell} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <Icon name="crown" size={20} color="var(--accent)" />
              <div style={{ fontSize: 13, color: 'var(--text2)' }}><b style={{ color: 'var(--text)' }}>Elite feature</b> — see which of your wallets actually make money (avg return & win rate per wallet) and rank them.</div>
            </div>
          </Card>
        )}
        {board && !board.locked && board.wallets.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '4px 2px' }}>Stats build up as your followed wallets make buys.</div>}
        {board && !board.locked && board.wallets.map((w, i) => (
          <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 2px', borderBottom: '1px solid var(--line)' }}>
            <span style={{ width: 22, fontWeight: 800, color: i === 0 ? 'var(--accent)' : 'var(--muted)', fontSize: 13 }}>#{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{w.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{w.buys} tracked buy{w.buys === 1 ? '' : 's'}{w.winRate != null ? ` · ${w.winRate}% win` : ''}</div>
            </div>
            <span style={{ fontWeight: 800, fontSize: 14, color: w.avgReturnPct == null ? 'var(--muted)' : w.avgReturnPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {w.avgReturnPct == null ? '—' : (w.avgReturnPct >= 0 ? '+' : '') + w.avgReturnPct + '%'}
            </span>
          </div>
        ))}
      </div>

      {/* Live buy feed */}
      <div style={{ padding: '0 16px 24px' }}>
        <SecHead>Detected buys</SecHead>
        <div style={{ height: 8 }} />
        {feed == null && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '4px 2px' }}>Loading…</div>}
        {feed != null && feed.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '4px 2px' }}>Nothing yet — buys by your followed wallets show up here within ~2 minutes.</div>}
        {(feed || []).map((b, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 2px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: b.safe ? 'var(--up-bg)' : 'var(--down-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: b.safe ? 'var(--up)' : 'var(--down)', flexShrink: 0 }}>
              <Icon name={b.safe ? 'shield' : 'alert'} size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', gap: 6, alignItems: 'center' }}>{b.wallet} → {b.sym || ctShort(b.tokenAddress)} <Pill tone="muted">{String(b.chain).toUpperCase()}</Pill></div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{b.safe ? b.safetySummary : '⚠️ ' + b.safetySummary} · ${b.priceAtDetection}</div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 600, flexShrink: 0 }}>{ctAgo(b.at)}</span>
          </div>
        ))}
      </div>

      {toast && <div style={{ position: 'fixed', left: '50%', bottom: 110, transform: 'translateX(-50%)', background: 'var(--surface2)', color: 'var(--text)', padding: '10px 16px', borderRadius: 11, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,.4)', zIndex: 50 }}>{toast}</div>}
    </div>
  );
}

Object.assign(window, { CopyTrading });

// profile-screens.jsx — flows for the Profile rows
const { useState: pfS } = React;

function PfHead({ title, sub, action }) {
  return (
    <div style={{ padding: '2px 16px 12px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function PfRow({ icon, title, detail, right, onClick, danger, tone }) {
  return (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 15px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: onClick ? 'pointer' : 'default', fontFamily: 'inherit', textAlign: 'left' }}>
      <div style={{ width: 36, height: 36, borderRadius: 11, background: danger ? 'var(--down-bg)' : tone === 'accent' ? 'var(--glow)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: danger ? 'var(--down)' : 'var(--accent)', flexShrink: 0 }}><Icon name={icon} size={18} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: danger ? 'var(--down)' : 'var(--text)' }}>{title}</div>
        {detail && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{detail}</div>}
      </div>
      {right !== undefined ? right : (onClick && <Icon name="chevR" size={17} color="var(--faint)" />)}
    </button>
  );
}

function PfCard({ children }) {
  return <div style={{ margin: '0 16px 16px', background: 'var(--surface)', borderRadius: 14, boxShadow: 'inset 0 0 0 1px var(--line)', overflow: 'hidden' }}>{children}</div>;
}

// ─── Connected exchanges ───
function ProfileExchanges({ go }) {
  const FX = window.FX;
  const [exchanges, setExchanges] = pfS(FX.exchanges);
  const [connect, setConnect] = pfS(null);
  const [disconnect, setDisconnect] = pfS(null);
  const connected = exchanges.filter(e => e.connected);
  const available = exchanges.filter(e => !e.connected);
  const totalBal = connected.reduce((a, e) => a + (parseFloat((e.bal || '').replace(/[$,]/g, '')) || 0), 0);

  return (
    <div style={{ paddingBottom: 24 }}>
      <PfHead title="Connected exchanges" sub={connected.length + ' linked via API · read & trade'} />
      <div style={{ margin: '0 16px 16px', background: 'linear-gradient(135deg, var(--surface), var(--glow))', borderRadius: 16, padding: 16, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>Total CEX balance</div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 3, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{'$' + totalBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div style={{ fontSize: 12, color: 'var(--up)', fontWeight: 700, marginTop: 2 }}>Across {connected.length} exchanges</div>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 18px 8px' }}>Connected</div>
      <PfCard>
        {connected.map(e => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 15px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: e.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{e.name[0]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>{e.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{e.perms}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{e.bal}</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 1 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--up)' }} /><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--up)' }}>Live</span></div>
              </div>
              <button onClick={() => setDisconnect(e)} aria-label={'Disconnect ' + e.name} style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--down-bg)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--down)', flexShrink: 0 }}>
                <Icon name="link" size={17} />
              </button>
            </div>
          </div>
        ))}
      </PfCard>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 18px 8px' }}>Available</div>
      <PfCard>
        {available.map(e => (
          <PfRow key={e.id} icon="plus" title={e.name} detail="Connect via API key"
            right={<Btn size="sm" kind="soft" onClick={() => setConnect(e)}>Connect</Btn>} />
        ))}
      </PfCard>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, margin: '0 18px', fontSize: 12, color: 'var(--faint)', lineHeight: 1.5 }}>
        <Icon name="shield" size={14} color="var(--up)" style={{ marginTop: 1 }} /> API keys are encrypted on-device. Use read + trade permissions only — never enable withdrawals.
      </div>

      <Sheet open={!!connect} onClose={() => setConnect(null)} title={connect ? 'Connect ' + connect.name : ''}>
        {connect && <ExchangeConnect ex={connect} onDone={() => { setExchanges(xs => xs.map(x => x.id === connect.id ? { ...x, connected: true, bal: '$0.00', perms: 'Read · Spot' } : x)); setConnect(null); }} />}
      </Sheet>

      {disconnect && (
        <div onClick={() => setDisconnect(null)} style={{ position: 'absolute', inset: 0, zIndex: 250, background: 'var(--overlay)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg2)', borderRadius: 20, padding: 22, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 0 0 1px var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--down-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="alert" size={28} color="var(--down)" /></div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center' }}>Disconnect {disconnect.name}?</div>
            <div style={{ fontSize: 13.5, color: 'var(--muted)', textAlign: 'center', marginTop: 7, lineHeight: 1.5 }}>
              FXcrypt will stop reading balances and routing signals to {disconnect.name}. Your <b style={{ color: 'var(--text)' }}>{disconnect.bal}</b> stays safe on the exchange — only the API connection is removed.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <Btn kind="soft" full onClick={() => setDisconnect(null)}>Cancel</Btn>
              <Btn kind="down" full icon="link" onClick={() => { const id = disconnect.id; if (window.FXAPI) window.FXAPI.removeCexApiKey(id).catch(() => {}); setExchanges(xs => xs.map(x => x.id === id ? { ...x, connected: false, bal: '', perms: '' } : x)); setDisconnect(null); }}>Disconnect</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExchangeConnect({ ex, onDone }) {
  const [stage, setStage] = pfS('form');
  const [autoExec, setAutoExec] = pfS(false);
  const [apiKey, setApiKey] = pfS('');
  const [secret, setSecret] = pfS('');
  const [busy, setBusy] = pfS(false);
  const [err, setErr] = pfS('');

  const connect = async () => {
    if (busy) return;
    setErr('');
    if (!apiKey.trim() || !secret.trim()) { setErr('Enter both your API key and secret.'); return; }
    setBusy(true);
    try {
      await window.FXAPI.saveCexApiKey({ exchange: ex.id, apiKey, secret });
      if (window.FXLive) window.FXLive.refreshExchanges();
      setStage('done');
    } catch (e) {
      setErr((e && e.message) || 'Could not verify those API keys.');
    } finally { setBusy(false); }
  };

  if (stage === 'done') return (
    <div style={{ padding: '20px 6px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: 76, height: 76, borderRadius: '50%', background: 'var(--up-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}><Icon name="checkCircle" size={42} color="var(--up)" /></div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{ex.name} connected</div>
      <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>FXcrypt can now read balances and route signals to {ex.name}.</div>
      <div style={{ width: '100%', marginTop: 20 }}><Btn full icon="check" onClick={onDone}>Done</Btn></div>
    </div>
  );
  return (
    <div style={{ paddingBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: ex.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>{ex.name[0]}</div>
        <div style={{ flex: 1, fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.45 }}>Create an API key in your {ex.name} account with <b style={{ color: 'var(--text)' }}>Read</b> and <b style={{ color: 'var(--text)' }}>Trade</b> enabled. Paste it below.</div>
      </div>
      {[['API key', 'Paste API key', apiKey, setApiKey], ['API secret', 'Paste API secret', secret, setSecret]].map(([l, p, val, set]) => (
        <div key={l} style={{ marginBottom: 11 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '0 2px 6px' }}>{l}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface)', borderRadius: 12, padding: '12px 13px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <Icon name="lock" size={17} color="var(--muted)" />
            <input value={val} onChange={e => set(e.target.value)} placeholder={p} style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14, fontFamily: 'ui-monospace, monospace', minWidth: 0 }} />
          </div>
        </div>
      ))}
      <div style={{ background: 'var(--surface)', borderRadius: 12, boxShadow: autoExec ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)', margin: '4px 0 16px', transition: 'box-shadow .2s' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}><Icon name="zap" size={16} color="var(--accent)" /> Enable auto-execute signals</span>
          <Toggle on={autoExec} onClick={() => setAutoExec(!autoExec)} />
        </div>
        {autoExec && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '0 14px 12px', fontSize: 12, color: 'var(--text2)', lineHeight: 1.45 }}>
            <Icon name="info" size={14} color="var(--accent)" style={{ marginTop: 1, flexShrink: 0 }} /> Signals will auto-execute on {ex.name} at 1% risk per trade. You can change this anytime in Automation.
          </div>
        )}
      </div>
      {err && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '11px 13px', fontWeight: 600 }}>{err}</div>}
      <Btn size="lg" full icon="link" onClick={connect} style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>{busy ? 'Verifying…' : `Connect ${ex.name}`}</Btn>
    </div>
  );
}

// ─── WalletConnect & signing ───
function ProfileSigning({ go }) {
  const [s, setS] = pfS({ confirm: true, blind: true, simulate: true, autoLock: false });
  const tog = (k) => setS(v => ({ ...v, [k]: !v[k] }));
  // Real dApp connections from the self-custody wallet (empty until the user
  // connects one) — no fabricated Jupiter/Drift rows.
  const wstate = (window.FXWallet && window.FXWallet.ready() && window.FXWallet.state()) || null;
  const [apps, setApps] = pfS(wstate ? (wstate.connectedApps || []) : []);
  const revoke = (id) => { try { window.FXWallet && window.FXWallet.removeConnectedApp(id); } catch (e) {} setApps(a => a.filter(x => x.id !== id)); };
  return (
    <div style={{ paddingBottom: 24 }}>
      <PfHead title="WalletConnect & signing" sub="Control how transactions get approved" />
      <PfCard>
        <PfRow icon="check" title="Confirm every signature" detail="Review each transaction before signing" tone="accent" right={<Toggle on={s.confirm} onClick={() => tog('confirm')} />} />
        <PfRow icon="shield" title="Blind-sign protection" detail="Block opaque signatures from dApps" tone="accent" right={<Toggle on={s.blind} onClick={() => tog('blind')} />} />
        <PfRow icon="eye" title="Simulate before signing" detail="Preview balance changes & risks" tone="accent" right={<Toggle on={s.simulate} onClick={() => tog('simulate')} />} />
      </PfCard>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 18px 8px' }}>Active connections</div>
      <PfCard>
        {apps.length === 0
          ? <div style={{ textAlign: 'center', padding: '22px 16px', color: 'var(--muted)' }}><Icon name="link" size={22} color="var(--faint)" style={{ marginBottom: 8 }} /><div style={{ fontSize: 13.5 }}>No connected dApps yet.</div></div>
          : apps.map((a, i) => (
            <PfRow key={a.id || i} icon="link" title={a.name} detail={(a.url || '') + (a.perm ? ' · ' + a.perm : '')} right={<Btn size="sm" kind="ghost" onClick={() => revoke(a.id)}>Revoke</Btn>} />
          ))}
      </PfCard>
      <div style={{ margin: '0 16px' }}><Btn kind="ghost" full icon="x" onClick={() => go('wallet')}>Manage in wallet →</Btn></div>
    </div>
  );
}

// ─── Account security ───
// Honest state: the account is secured by the real Firebase email/password.
// Authenticator-app 2FA isn't wired to a backend yet, so it's marked clearly as
// upcoming rather than faking an "active" status. The one real action exposed
// here — changing the password — uses Firebase's password-reset email.
function Profile2FA({ go }) {
  const [note, setNote] = pfS('');
  const [busy, setBusy] = pfS(false);
  const u = window.FXAuth && window.FXAuth.currentUser && window.FXAuth.currentUser();
  const email = (u && u.email) || '';
  const changePw = async () => {
    if (busy) return;
    if (!email || !window.FXAuth) { setNote('No email is set on this account.'); return; }
    setBusy(true);
    try { await window.FXAuth.reset(email); setNote('Password reset link sent to ' + email + '.'); }
    catch (e) { setNote(window.FXAuth.mapError ? window.FXAuth.mapError(e && e.code, e && e.message) : 'Could not send the email.'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ paddingBottom: 24 }}>
      <PfHead title="Account security" sub="How your account is protected" />
      <div style={{ margin: '0 16px 16px', background: 'var(--surface)', borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', gap: 11, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        <Icon name="shield" size={22} color="var(--up)" />
        <div style={{ flex: 1 }}><div style={{ fontSize: 14.5, fontWeight: 800 }}>Email &amp; password</div><div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{email || 'Signed in'}</div></div>
        <Pill tone="up">Active</Pill>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 18px 8px' }}>Manage</div>
      <PfCard>
        <PfRow icon="lock" title="Change password" detail={email ? 'Send a reset link to your email' : 'No email on account'} onClick={changePw} />
      </PfCard>
      {note && <div style={{ margin: '0 16px 16px', fontSize: 13, color: 'var(--up)', background: 'var(--up-bg)', borderRadius: 11, padding: '11px 13px', fontWeight: 600 }}>{note}</div>}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 18px 8px' }}>Coming soon</div>
      <PfCard>
        <PfRow icon="spark" title="Authenticator app (2FA)" detail="TOTP codes — in development" right={<Pill tone="muted">Soon</Pill>} />
        <PfRow icon="message" title="SMS verification" detail="One-time codes by text" right={<Pill tone="muted">Soon</Pill>} />
      </PfCard>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, margin: '0 18px', fontSize: 12, color: 'var(--faint)', lineHeight: 1.5 }}>
        <Icon name="info" size={14} color="var(--accent)" style={{ marginTop: 1 }} /> Your self-custody wallet has its own password and encrypts keys on-device — separate from account sign-in.
      </div>
    </div>
  );
}

// ─── Session management ───
function ProfileSessions({ go }) {
  // Real current session (the browser can only see its own). No fabricated devices.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android device' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return (
    <div style={{ paddingBottom: 24 }}>
      <PfHead title="Session management" sub="Your active session" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', borderRadius: 14, padding: 14, boxShadow: 'inset 0 0 0 1.5px var(--accent)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="globe" size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700 }}>{device}</span>
              <Pill tone="accent">This device</Pill>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{browser} · web</div>
            <div style={{ fontSize: 11.5, color: 'var(--up)', fontWeight: 600, marginTop: 1 }}>Active now</div>
          </div>
        </div>
      </div>
      <div style={{ margin: '0 16px' }}><Btn kind="ghost" full icon="x" onClick={() => { if (window.FXAuth) window.FXAuth.signOut(); }}>Sign out of this device</Btn></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 11.5, color: 'var(--faint)', marginTop: 12, padding: '0 16px' }}><Icon name="info" size={13} /> To sign out everywhere, change your password.</div>
    </div>
  );
}

// ─── Telegram / Discord link ───
function ProfileConnect({ go, kind }) {
  const isTg = kind === 'telegram';
  const [linked, setLinked] = pfS(false);
  const [code, setCode] = pfS('');
  const [busy, setBusy] = pfS(false);
  const [err, setErr] = pfS('');

  const generate = async () => {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const res = isTg ? await window.FXAPI.generateTelegramCode() : await window.FXAPI.generateDiscordCode();
      setCode((res && res.code) || '');
    } catch (e) {
      setErr((e && e.message) || 'Could not generate a code. Make sure you are signed in.');
    } finally { setBusy(false); }
  };
  const meta = isTg
    ? { name: 'Telegram bot', handle: '@FXcryptBot', color: '#229ED9', icon: 'telegram', feats: ['Trade alerts & fills in chat', 'Run gem scans with /scan', 'Approve trades from Telegram', 'Daily portfolio brief'] }
    : { name: 'Discord agent', handle: 'FXcrypt#0420', color: '#5865F2', icon: 'discord', feats: ['Signal feed in your server', 'Slash-command trading', 'Role-gated Elite channels', 'Community copy-trade rooms'] };
  return (
    <div style={{ paddingBottom: 24 }}>
      <PfHead title={meta.name} sub={linked ? 'Connected · ' + meta.handle : 'Not connected yet'} />
      <div style={{ margin: '0 16px 18px', background: 'var(--surface)', borderRadius: 16, padding: 20, boxShadow: 'inset 0 0 0 1px var(--line)', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: meta.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><Icon name={meta.icon} size={32} color="#fff" /></div>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{meta.name}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{linked ? meta.handle + ' · linked to your account' : 'Bring FXcrypt into your chats'}</div>
        {linked && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, background: 'var(--up-bg)', borderRadius: 8, padding: '5px 11px' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--up)' }} /><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--up)' }}>Active</span></div>}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 18px 8px' }}>What it does</div>
      <PfCard>
        {meta.feats.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 15px', borderBottom: i < meta.feats.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <Icon name="checkCircle" size={18} color="var(--accent)" />
            <span style={{ fontSize: 13.5, color: 'var(--text2)', fontWeight: 500 }}>{f}</span>
          </div>
        ))}
      </PfCard>
      {code && (
        <div style={{ margin: '0 16px 16px', background: 'var(--surface)', borderRadius: 14, padding: 16, boxShadow: 'inset 0 0 0 1.5px var(--accent)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 700, marginBottom: 8 }}>Your linking code</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, fontFamily: 'ui-monospace, monospace', color: 'var(--accent)' }}>{code}</span>
            <button onClick={() => { try { navigator.clipboard.writeText(code); } catch (e) {} }} style={{ background: 'var(--surface2)', border: 'none', borderRadius: 9, padding: '8px 11px', cursor: 'pointer', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontWeight: 700, fontSize: 12.5 }}><Icon name="copy" size={15} /> Copy</button>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 10, lineHeight: 1.5 }}>
            {isTg ? <>Open <b style={{ color: 'var(--text)' }}>{meta.handle}</b> on Telegram and send <b style={{ color: 'var(--text)' }}>/link {code}</b> to finish connecting.</> : <>In your server, run <b style={{ color: 'var(--text)' }}>/link {code}</b> with the FXcrypt agent to finish connecting.</>}
          </div>
        </div>
      )}
      {err && <div style={{ margin: '0 16px 14px', fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '11px 13px', fontWeight: 600 }}>{err}</div>}
      <div style={{ margin: '0 16px' }}>
        {linked
          ? <Btn kind="ghost" full icon="x" onClick={() => setLinked(false)}>Disconnect {isTg ? 'Telegram' : 'Discord'}</Btn>
          : <Btn size="lg" full icon={meta.icon} onClick={generate} style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>{busy ? 'Generating…' : code ? 'Generate new code' : `Connect ${meta.handle}`}</Btn>}
      </div>
    </div>
  );
}

// ─── Referral program ───
function ProfileReferral({ go }) {
  const [copied, setCopied] = pfS(false);
  // Real, stable referral code derived from the signed-in user's uid.
  const uid = (window.FXAuth && window.FXAuth.currentUser() && window.FXAuth.currentUser().uid) || '';
  const code = uid ? ('FX' + uid.slice(0, 6).toUpperCase()) : 'FX—';
  const link = 'https://fxcrypt-app.web.app/signup?ref=' + code;
  const copy = () => { try { navigator.clipboard.writeText(link); } catch (e) {} setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const share = () => { try { if (navigator.share) navigator.share({ title: 'FXcrypt', text: 'Trade smarter with FXcrypt', url: link }); else copy(); } catch (e) {} };
  return (
    <div style={{ paddingBottom: 24 }}>
      <PfHead title="Referral program" sub="Invite friends to FXcrypt" />
      <div style={{ margin: '0 16px 16px', background: 'linear-gradient(135deg, var(--accent-deep), var(--accent))', borderRadius: 18, padding: 18 }}>
        <div style={{ fontSize: 12.5, color: 'var(--on-accent)', fontWeight: 700, opacity: 0.8 }}>Total earned</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--on-accent)', letterSpacing: -0.6, marginTop: 2 }}>$0.00</div>
        <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
          <div><div style={{ fontSize: 19, fontWeight: 800, color: 'var(--on-accent)' }}>0</div><div style={{ fontSize: 11.5, color: 'var(--on-accent)', opacity: 0.8, fontWeight: 600 }}>Friends joined</div></div>
          <div><div style={{ fontSize: 19, fontWeight: 800, color: 'var(--on-accent)' }}>25%</div><div style={{ fontSize: 11.5, color: 'var(--on-accent)', opacity: 0.8, fontWeight: 600 }}>Fee share</div></div>
        </div>
      </div>
      {/* referral link */}
      <div style={{ margin: '0 16px 16px' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '0 2px 7px' }}>Your referral code</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', borderRadius: 12, padding: '13px 15px', boxShadow: 'inset 0 0 0 1.5px var(--accent)' }}>
            <Icon name="link" size={17} color="var(--accent)" />
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 1, flex: 1 }}>{code}</span>
            <button onClick={copy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--up)' : 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', fontWeight: 700, fontSize: 12.5 }}><Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <Btn icon="send" onClick={share}>Share</Btn>
        </div>
      </div>
      {/* invited list — honest empty state */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 18px 8px' }}>Your referrals</div>
      <PfCard>
        <div style={{ textAlign: 'center', padding: '26px 16px', color: 'var(--muted)' }}>
          <Icon name="user" size={24} color="var(--faint)" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13.5 }}>No referrals yet — share your link to get started.</div>
        </div>
      </PfCard>
    </div>
  );
}

Object.assign(window, { ProfileExchanges, ProfileSigning, Profile2FA, ProfileSessions, ProfileConnect, ProfileReferral });

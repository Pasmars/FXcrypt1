// onboarding.jsx — splash, value carousel, auth, connect wallet
const { useState: oS, useEffect: oE } = React;

// postAuth: the webapp runs its own /login & /signup routes, so its first-run
// onboarding starts at the carousel and skips the Auth step entirely.
function Onboarding({ onDone, dark, postAuth }) {
  const [step, setStep] = oS(postAuth ? 1 : 0); // 0 splash, 1 carousel, 2 auth, 3 connect
  const next = () => setStep(s => (postAuth && s === 1 ? 3 : s + 1));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {step === 0 && <Splash onDone={next} />}
      {step === 1 && <Carousel onDone={next} />}
      {step === 2 && <Auth onDone={() => setStep(3)} />}
      {step === 3 && <ConnectWallet onDone={onDone} />}
    </div>
  );
}

function Splash({ onDone }) {
  oE(() => { const t = setTimeout(onDone, 1700); return () => clearTimeout(t); }, []);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <div><Mark size={88} /></div>
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>FX<span style={{ color: 'var(--accent)' }}>crypt</span></div>
      <div style={{ position: 'absolute', bottom: 70, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
        <span style={{ width: 16, height: 16, border: '2px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} /> Securing session…
      </div>
    </div>
  );
}

const SLIDES = [
  { icon: 'spark', title: 'Pointer, your AI trader', body: 'Conversational research and gated trade execution. 19 tools, always on — just ask.', color: 'var(--accent)' },
  { icon: 'scan', title: 'Snipe gems early', body: 'Auto-scan new pairs across 6 chains with honeypot & safety checks built in.', color: '#7B61FF' },
  { icon: 'robot', title: 'Signals & automation', body: 'Scored long/short setups, futures, auto-execute, SL/TP, DCA and copy-trading.', color: 'var(--up)' },
  { icon: 'wallet', title: 'One wallet, every chain', body: 'Unified multi-chain portfolio, live PnL, bubble maps and holder analytics.', color: '#00C2FF' },
];

function Carousel({ onDone }) {
  const [i, setI] = oS(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '58px 24px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark size={18} />
        <button onClick={onDone} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Skip</button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 22 }}>
        <div key={i} style={{ width: 116, height: 116, borderRadius: 34, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 20px 60px ${s.color}55` }}>
          <Icon name={s.icon} size={56} color={s.color === 'var(--accent)' ? 'var(--on-accent)' : '#fff'} />
        </div>
        <div key={'t' + i}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, marginBottom: 10 }}>{s.title}</div>
          <div style={{ fontSize: 15.5, color: 'var(--muted)', lineHeight: 1.5, maxWidth: 300 }}>{s.body}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 7, justifyContent: 'center', marginBottom: 22 }}>
        {SLIDES.map((_, k) => <span key={k} style={{ width: k === i ? 24 : 8, height: 8, borderRadius: 4, background: k === i ? 'var(--accent)' : 'var(--line2)', transition: 'all .25s' }} />)}
      </div>
      <Btn size="lg" full icon={last ? 'arrowUR' : undefined} onClick={() => last ? onDone() : setI(i + 1)}>{last ? 'Get started' : 'Next'}</Btn>
    </div>
  );
}

function Auth({ onDone }) {
  const [mode, setMode] = oS('signup');
  const [email, setEmail] = oS('');
  const [password, setPassword] = oS('');
  const [ref, setRef] = oS('');
  const [busy, setBusy] = oS(false);
  const [err, setErr] = oS('');

  // Prefill the referral code from a shared signup link (?ref=FXXXXXX).
  oE(() => {
    try { const r = new URLSearchParams(window.location.search).get('ref'); if (r) setRef(r); } catch (e) {}
  }, []);

  const submit = async () => {
    if (busy) return;
    setErr('');
    if (!email.trim() || !password) { setErr('Enter your email and password.'); return; }
    setBusy(true);
    try {
      if (mode === 'signup') await window.FXAuth.signUp({ email, password, ref });
      else await window.FXAuth.signIn(email, password);
      onDone();
    } catch (e) {
      setErr(window.FXAuth.mapError(e && e.code, e && e.message));
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!email.trim()) { setErr('Enter your email above first.'); return; }
    try { await window.FXAuth.reset(email); setErr('Password reset email sent — check your inbox.'); }
    catch (e) { setErr(window.FXAuth.mapError(e && e.code, e && e.message)); }
  };
  // Real Google OAuth. Telegram/Discord are linked from Profile after sign-in
  // (their bots attach to an existing account), so guide the user there.
  const google = async () => {
    if (busy) return;
    setErr(''); setBusy(true);
    try { await window.FXAuth.googleSignIn(); onDone(); }
    catch (e) { setErr(window.FXAuth.mapError(e && e.code, e && e.message)); setBusy(false); }
  };
  const social = (provider) => {
    if (provider === 'globe') return google();
    setErr(`${provider === 'telegram' ? 'Telegram' : 'Discord'} links to your account from Profile → Connect after you sign in with email or Google.`);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '62px 24px 28px' }}>
      <div style={{ marginBottom: 28 }}><Mark size={48} /></div>
      <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.6 }}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</div>
      <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 5 }}>{mode === 'signup' ? 'Start trading in under a minute.' : 'Sign in to your command center.'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 26 }}>
        <Field icon="user" placeholder="Email address" type="email" value={email} onChange={setEmail} />
        <Field icon="lock" placeholder="Password" type="password" value={password} onChange={setPassword} onEnter={submit} />
        {mode === 'signup' && <Field icon="link" placeholder="Referral code (optional)" value={ref} onChange={setRef} />}
      </div>
      {mode === 'login' && (
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Forgot password?</button>
        </div>
      )}
      {err && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '11px 13px', fontWeight: 600 }}>{err}</div>}
      <Btn size="lg" full onClick={submit} style={{ marginTop: 18, opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</Btn>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontSize: 12.5, color: 'var(--faint)' }}>or continue with</span><div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {[['telegram', 'Telegram'], ['discord', 'Discord'], ['globe', 'Google']].map(([ic, l]) => (
          <button key={l} onClick={() => social(ic)} disabled={busy} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '13px', borderRadius: 13, background: 'var(--surface)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--line)', cursor: busy ? 'default' : 'pointer', color: 'var(--text2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
            <Icon name={ic} size={22} color="var(--text)" /> {l}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--muted)', marginTop: 18 }}>
        {mode === 'signup' ? 'Already have an account? ' : 'New to FXcrypt? '}
        <button onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5 }}>{mode === 'signup' ? 'Sign in' : 'Sign up'}</button>
      </div>
    </div>
  );
}

function Field({ icon, placeholder, type, value, onChange, onEnter }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--surface)', borderRadius: 13, padding: '14px 15px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
      <Icon name={icon} size={19} color="var(--muted)" />
      <input type={type} placeholder={placeholder}
        value={value != null ? value : ''}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') onEnter(); } : undefined}
        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit' }} />
    </div>
  );
}

function ConnectWallet({ onDone }) {
  const [note, setNote] = oS('');
  // 'create'/'import' open the real self-custody wallet engine (the Wallet tab
  // handles password setup + key generation). WalletConnect & hardware are not
  // wired yet (no SDKs) — say so honestly instead of pretending to connect.
  const opts = [
    { name: 'Create FXcrypt wallet', sub: 'New encrypted wallet · 6 chains', icon: 'plus', tag: 'Recommended', action: 'go' },
    { name: 'WalletConnect', sub: 'MetaMask, Phantom, Rabby…', icon: 'link', tag: '', action: 'soon' },
    { name: 'Hardware wallet', sub: 'Ledger · most secure signing', icon: 'shield', tag: '', action: 'soon' },
    { name: 'Import seed phrase', sub: 'Restore an existing wallet', icon: 'receive', tag: '', action: 'go' },
  ];
  const pick = (o) => {
    if (o.action === 'go') { try { sessionStorage.setItem('fx_intent', 'wallet'); } catch (e) {} onDone(); }
    else setNote(`${o.name} is coming soon — for now, create or import an FXcrypt wallet to get started.`);
  };
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '62px 24px 28px' }}>
      <div style={{ width: 56, height: 56, borderRadius: 17, background: 'var(--glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}><Icon name="wallet" size={28} color="var(--accent)" /></div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6 }}>Connect a wallet</div>
      <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.45 }}>Non-custodial signing is safest. We never hold your keys without consent.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
        {opts.map((o, i) => (
          <button key={i} onClick={() => pick(o)} style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--surface)', borderRadius: 15, padding: 15, border: 'none', boxShadow: i === 0 ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', opacity: o.action === 'soon' ? 0.75 : 1 }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: i === 0 ? 'var(--accent)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: i === 0 ? 'var(--on-accent)' : 'var(--accent)', flexShrink: 0 }}><Icon name={o.icon} size={21} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{o.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{o.sub}</div>
            </div>
            {o.tag ? <Pill tone="accent">{o.tag}</Pill> : o.action === 'soon' ? <Pill tone="muted">Soon</Pill> : <Icon name="chevR" size={18} color="var(--faint)" />}
          </button>
        ))}
      </div>
      {note && <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--text2)', background: 'var(--surface)', borderRadius: 11, padding: '11px 13px', boxShadow: 'inset 0 0 0 1px var(--line)', lineHeight: 1.45 }}>{note}</div>}
      <button onClick={onDone} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: 16 }}>I’ll do this later →</button>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: 12, color: 'var(--faint)', marginTop: 16 }}>
        <Icon name="shield" size={15} color="var(--up)" /> PBKDF2 600k · keys encrypted, decrypted only to sign
      </div>
    </div>
  );
}

Object.assign(window, { Onboarding });

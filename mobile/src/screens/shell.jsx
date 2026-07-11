// shell.jsx — app shell: nav, bottom bar, profile, first-trade wizard, tweaks
const { useState: shS, useEffect: shE, useRef: shR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": true,
  "accent": "gold",
  "homeLayout": "agent",
  "pointerStyle": "bubbles",
  "plan": "free"
}/*EDITMODE-END*/;

const TABS = [
  { id: 'pointer', label: 'Pointer', icon: 'spark' },
  { id: 'markets', label: 'Markets', icon: 'candles' },
  { id: 'trade', label: 'Trade', icon: 'swap', center: true },
  { id: 'signals', label: 'Signals', icon: 'robot' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const rootRef = shR(null);
  const [tab, setTab] = shS(() => {
    try { const t = new URLSearchParams(window.location.search).get('tab'); return ['markets', 'signals', 'wallet'].includes(t) ? t : 'pointer'; }
    catch (e) { return 'pointer'; }
  });
  const [stack, setStack] = shS([]); // overlay routes
  const [phase, setPhase] = shS('onboard');
  const [wizard, setWizard] = shS(false);
  const [chatSeed, setChatSeed] = shS(null);

  shE(() => { if (rootRef.current) applyTheme(rootRef.current, t.dark, t.accent); }, [t.dark, t.accent]);

  // Returning users with a live Firebase session skip onboarding.
  shE(() => {
    let mounted = true;
    if (window.FXAuth) {
      window.FXAuth.ready().then(() => { if (mounted && window.FXAuth.currentUser()) setPhase('app'); });
    }
    return () => { mounted = false; };
  }, []);

  // Re-render screens when the live data layer refreshes window.FX.
  const [dataVer, setDataVer] = shS(0);
  shE(() => {
    const onUpdate = () => setDataVer(v => v + 1);
    window.addEventListener('fx:update', onUpdate);
    return () => window.removeEventListener('fx:update', onUpdate);
  }, []);

  // Stripe credit-pack return (?credits=success|cancel) → toast the outcome.
  // The usage pill re-fetches on chat mount, so the fresh balance shows there.
  shE(() => {
    const r = window.FXAPI && window.FXAPI.consumeCreditsReturn && window.FXAPI.consumeCreditsReturn();
    if (r && window.FXToast) window.FXToast.show(r === 'success' ? '✅ Credits added to your account' : 'Checkout canceled — you were not charged');
  }, []);

  // Push-notification deep link (?goto=portfolio|signals|…) → open that screen
  // once the app phase is live, then strip the param.
  shE(() => {
    if (phase !== 'app') return;
    try {
      const url = new URL(window.location.href);
      const target = url.searchParams.get('goto');
      if (!target) return;
      // Optional chat-session id (Pointer watch-task analyses deep-link here).
      const session = url.searchParams.get('session');
      if (session) window.__fxOpenSession = session;
      url.searchParams.delete('goto'); url.searchParams.delete('session');
      window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
      go(target);
    } catch (e) { /* bad URL — ignore */ }
  }, [phase]);

  // Pull the user's live data (profile, signals, exchange balances) once in the app.
  shE(() => {
    if (phase === 'app' && window.FXLive) window.FXLive.bootstrapUser();
  }, [phase]);

  // ─── Hardware / browser back button (Android TWA + PWA) ───
  // Navigation lives in React state (overlay stack + active tab), not the URL, so
  // without this the device back button finds no history to pop and the TWA just
  // closes. We keep a single "trap" history entry; on each back press we undo one
  // step of in-app navigation and re-seed the trap. When nothing is left to undo
  // we let the back propagate so the app closes (TWA) or leaves the site (PWA).
  const navRef = shR({ phase, tab, stackLen: stack.length, wizard });
  shE(() => { navRef.current = { phase, tab, stackLen: stack.length, wizard }; });
  shE(() => {
    window.history.pushState({ fxTrap: true }, '');
    const onPop = () => {
      const st = navRef.current;
      if (st.wizard) { setWizard(false); window.history.pushState({ fxTrap: true }, ''); return; }
      if (st.stackLen > 0) { setStack(s => s.slice(0, -1)); window.history.pushState({ fxTrap: true }, ''); return; }
      if (st.phase === 'app' && st.tab !== 'pointer') { setTab('pointer'); window.history.pushState({ fxTrap: true }, ''); return; }
      window.removeEventListener('popstate', onPop); // nothing to undo → let it close
      window.history.back();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (key, props = {}) => {
    if (key === -1) { setStack(s => s.slice(0, -1)); return; }
    if (['wallet', 'markets', 'signals', 'pointer'].includes(key)) { setStack([]); setTab(key); return; }
    setStack(s => [...s, { key, props }]);
  };
  const back = () => setStack(s => s.slice(0, -1));
  const resetTo = (tb) => { setStack([]); setTab(tb); };

  const openChat = (seed) => { setChatSeed(typeof seed === 'string' ? seed : null); go('chat'); };
  const openTrade = (token, side) => go('trade', { token, side });
  const upsell = () => go('paywall');

  // Real subscription plan from the live data layer (set by fx-live after auth);
  // falls back to the local setting before the profile loads. dataVer forces a
  // re-read whenever window.FX refreshes.
  void dataVer;
  const plan = (window.FX && window.FX.plan) || t.plan;
  const planLabel = { free: 'Free', pro: 'Pro', elite: 'Elite' }[plan] || 'Free';

  // ─── base tab content ───
  function TabContent() {
    if (tab === 'pointer') return (
      <div>
        <TopBar left={<Mark size={32} />} title="FXcrypt"
          sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--up)' }} /> Pointer online</span>}
          right={<>
            <button onClick={() => go('paywall')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: plan === 'free' ? 'var(--surface2)' : 'var(--glow)', color: plan === 'free' ? 'var(--muted)' : 'var(--accent)', border: 'none', borderRadius: 9, padding: '7px 11px', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              {plan !== 'free' && <Icon name="crown" size={13} />}{planLabel}
            </button>
            <button aria-label="Profile" onClick={() => go('profile')} style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),var(--accent-deep))', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)', fontWeight: 800, fontSize: 15 }}>{(window.FX.user && window.FX.user.initials) || 'A'}</button>
          </>} />
        <PointerHome go={go} layout={t.homeLayout} openChat={openChat} user={(window.FX.user && window.FX.user.name && window.FX.user.name.split(' ')[0]) || 'there'} />
      </div>
    );
    if (tab === 'markets') return <Markets go={go} />;
    if (tab === 'signals') return <Signals go={go} onUpsell={upsell} />;
    if (tab === 'wallet') return <Wallet go={go} />;
    return null;
  }

  // ─── overlay router ───
  function Overlay({ route }) {
    const { key, props } = route;
    const head = (title, right) => (
      <TopBar left={<button aria-label="Back" onClick={back} style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}><Icon name="chevL" size={21} /></button>} title={title} right={right} />
    );
    let inner, header = null, custom = false;
    if (key === 'chat') { header = head('Pointer'); inner = <PointerChat go={go} seed={chatSeed} style={t.pointerStyle} onProposalTrade={() => {}} />; }
    else if (key === 'token') { header = head(props.token.sym); inner = <TokenDetail token={props.token} go={go} onTrade={openTrade} />; }
    else if (key === 'bubble') { header = head('Bubble Map'); inner = <BubbleMap token={props.token} go={go} />; }
    else if (key === 'trade') { header = head('Manual Trade', <Pill tone="muted">{plan === 'free' ? '1.0%' : plan === 'pro' ? '0.5%' : '0.2%'} fee</Pill>); inner = <TradeFlow token={props.token} side={props.side} go={go} onDone={back} />; }
    else if (key === 'execSignal') { header = head('Execute Signal'); inner = <ExecSignal signal={props.signal} go={go} onDone={back} />; }
    else if (key === 'signalChart') { header = head(props.signal.pair, <Pill tone="accent">{props.signal.conf}%</Pill>); inner = <SignalChart signal={props.signal} go={go} onExec={() => go('execSignal', { signal: props.signal })} />; }
    else if (key === 'signalTrackRecord') { header = head('Signal track record'); inner = <SignalTrackRecord go={go} />; }
    else if (key === 'gemTrackRecord') { header = head('Gem track record'); inner = <GemTrackRecord go={go} />; }
    else if (key === 'scanner') { custom = true; inner = <GemScanner go={go} onTrade={openTrade} locked={plan === 'free'} onUpsell={upsell} />; }
    else if (key === 'paywall') { custom = true; inner = <Paywall go={go} onDone={back} />; }
    else if (key === 'profile') { header = head('Profile'); inner = <Profile go={go} t={t} setTweak={setTweak} plan={plan} planLabel={planLabel} onSignOut={() => { if (window.FXAuth) window.FXAuth.signOut(); setStack([]); setPhase('onboard'); }} />; }
    else if (key === 'automation') { custom = true; inner = <Automation go={go} plan={plan} onUpsell={upsell} />; }
    else if (key === 'alerts') { custom = true; inner = <Alerts go={go} />; }
    else if (key === 'exchanges') { header = head('Exchanges'); inner = <ProfileExchanges go={go} />; }
    else if (key === 'signing') { header = head('Signing'); inner = <ProfileSigning go={go} />; }
    else if (key === '2fa') { header = head('Security'); inner = <Profile2FA go={go} />; }
    else if (key === 'sessions') { header = head('Sessions'); inner = <ProfileSessions go={go} />; }
    else if (key === 'connect') { header = head(props.kind === 'telegram' ? 'Telegram' : 'Discord'); inner = <ProfileConnect go={go} kind={props.kind} />; }
    else if (key === 'referral') { header = head('Referrals'); inner = <ProfileReferral go={go} />; }
    else if (key === 'portfolio') { header = head('Portfolio'); inner = <Portfolio go={go} />; }
    else if (key === 'copytrade') { custom = true; inner = <CopyTrading go={go} plan={plan} onUpsell={upsell} />; }

    return (
      <div className="fx-overlay" style={{ position: 'absolute', inset: 0, background: 'var(--bg)', zIndex: 30, display: 'flex', flexDirection: 'column' }}>
        <div className="fx-top-spacer" style={{ height: 54, flexShrink: 0 }} />
        {header}
        <div className="fx-scroll" style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>{inner}</div>
      </div>
    );
  }

  const body = (
    <div ref={rootRef} style={{ height: '100%', position: 'relative', fontFamily: 'inherit', overflow: 'hidden', background: 'var(--bg)', color: 'var(--text)' }}>
      {phase === 'onboard' && <Onboarding dark={t.dark} onDone={() => {
        let intent = null;
        try { intent = sessionStorage.getItem('fx_intent'); sessionStorage.removeItem('fx_intent'); } catch (e) {}
        setPhase('app');
        if (intent === 'wallet') setTab('wallet'); else setWizard(true);
      }} />}
      {phase === 'app' && <>
        <div className="fx-main" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="fx-top-spacer" style={{ height: 54, flexShrink: 0 }} />
          <div className="fx-scroll" style={{ flex: 1, overflowY: 'auto' }} data-ver={dataVer}>{TabContent()}<div style={{ height: 96 }} /></div>
        </div>
        <BottomNav tab={tab} onTab={(id) => { if (id === 'trade') go('trade', { token: window.FX.tokens[4], side: 'buy' }); else resetTo(id); }} />
        {/* Invoke TabContent()/Overlay() as functions (not <Component/>) so an App
            re-render — e.g. the 60s data refresh — does NOT remount these nested
            helpers and wipe in-screen state like the Pointer chat history. */}
        {stack.length > 0 && Overlay({ route: stack[stack.length - 1] })}
        {wizard && <FirstTradeWizard onTrade={() => { setWizard(false); go('trade', { token: window.FX.tokens[4], side: 'buy' }); }} onClose={() => setWizard(false)} />}
      </>}
    </div>
  );

  // Real mobile web app: render full-screen (no iOS device frame, no tweaks panel —
  // those were prototype scaffolding). Appearance is controlled from Profile.
  return body;
}

function BottomNav({ tab, onTab }) {
  return (
    <div className="fx-nav" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 25, paddingBottom: 22, background: 'var(--bar)', backdropFilter: 'blur(20px) saturate(150%)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid var(--line)' }}>
      {/* desktop-only brand header (revealed by the ≥1024px media query) */}
      <div className="fx-nav-brand" style={{ display: 'none', alignItems: 'center', gap: 9, padding: '10px 12px 22px' }}>
        <Mark size={30} />
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.5 }}>FX<span style={{ color: 'var(--accent)' }}>crypt</span></span>
      </div>
      <div className="fx-nav-row" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', padding: '8px 8px 2px' }}>
        {TABS.map(tb => {
          if (tb.center) return (
            <button key={tb.id} onClick={() => onTab(tb.id)} className="fx-nav-btn fx-nav-center" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transform: 'translateY(-10px)' }}>
              <span className="fx-nav-chip" style={{ width: 54, height: 54, borderRadius: 18, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)', boxShadow: '0 8px 22px var(--glow)' }}><Icon name="swap" size={26} stroke={2.4} /></span>
              <span className="fx-nav-label" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)' }}>{tb.label}</span>
            </button>
          );
          const on = tab === tb.id;
          return (
            <button key={tb.id} onClick={() => onTab(tb.id)} className={'fx-nav-btn' + (on ? ' fx-nav-btn-on' : '')} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4px 0', color: on ? 'var(--accent)' : 'var(--faint)' }}>
              <Icon name={tb.icon} size={23} fill={on ? 'var(--glow)' : 'none'} stroke={on ? 2.4 : 2} />
              <span className="fx-nav-label" style={{ fontSize: 10.5, fontWeight: on ? 800 : 600 }}>{tb.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FirstTradeWizard({ onTrade, onClose }) {
  return (
    <div onClick={onClose} className="fx-sheet" style={{ position: 'absolute', inset: 0, zIndex: 150, background: 'var(--overlay)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', padding: '0 14px 110px', animation: 'fxfade .3s' }}>
      <div onClick={e => e.stopPropagation()} className="fx-sheet-panel" style={{ background: 'var(--bg2)', borderRadius: 22, padding: 22, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.5), inset 0 0 0 1px var(--line)', animation: 'fxslideUp .35s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, boxShadow: '0 8px 24px var(--glow)' }}><Icon name="zap" size={27} color="var(--on-accent)" /></div>
        <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.4 }}>You’re all set{(window.FX.user && window.FX.user.name) ? ', ' + window.FX.user.name.split(' ')[0] : ''} 👋</div>
        <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>Let’s make your first trade together. Pointer will walk you through buying a token with safety checks on — it takes about 20 seconds.</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Btn kind="ghost" full onClick={onClose}>Explore first</Btn>
          <Btn full icon="arrowUR" onClick={onTrade}>Make first trade</Btn>
        </div>
      </div>
    </div>
  );
}

function Profile({ go, t, setTweak, plan, planLabel, onSignOut }) {
  // Live counts derived from the same data the detail screens render, so the
  // summary never contradicts what the user sees when they tap through.
  const FX = window.FX || {};
  // Paper trading mode — account-level; every execution path simulates fills.
  const [paper, setPaper] = shS(null);
  shE(() => {
    let alive = true;
    if (window.FXAPI && window.FXAPI.getPaperMode) window.FXAPI.getPaperMode().then((v) => { if (alive) setPaper(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const togglePaper = async () => {
    const next = !paper;
    setPaper(next);
    try {
      await window.FXAPI.setPaperMode(next);
      if (window.FXToast) window.FXToast.show(next ? '📝 Paper trading ON — all fills are simulated' : 'Live trading — real on-chain orders');
    } catch (e) { setPaper(!next); }
  };
  const exConnected = (FX.exchanges || []).filter((e) => e.connected).length;
  const wstate = (window.FXWallet && window.FXWallet.ready() && window.FXWallet.state()) || null;
  const walletCount = wstate ? wstate.wallets.length : 0;
  const autoActive = (FX.automations || []).filter((a) => a.on).length;
  const alertCount = (FX.alerts || []).length;
  const item = (icon, title, detail, onClick, danger) => (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: danger ? 'var(--down-bg)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: danger ? 'var(--down)' : 'var(--accent)' }}><Icon name={icon} size={18} /></div>
      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: danger ? 'var(--down)' : 'var(--text)' }}>{title}</span>
      {detail && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{detail}</span>}
      {!danger && <Icon name="chevR" size={17} color="var(--faint)" />}
    </button>
  );
  return (
    <div style={{ padding: '4px 16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 4px 18px' }}>
        <div style={{ width: 58, height: 58, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),var(--accent-deep))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)', fontWeight: 800, fontSize: 24 }}>{(window.FX.user && window.FX.user.initials) || 'A'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{(window.FX.user && window.FX.user.name) || 'Trader'}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{(window.FX.user && window.FX.user.email) || ''}</div>
        </div>
      </div>
      {/* plan card */}
      <div onClick={() => go('paywall')} style={{ cursor: 'pointer', background: plan === 'free' ? 'var(--surface)' : 'linear-gradient(135deg, var(--surface), var(--glow))', borderRadius: 16, padding: 16, boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)' }}><Icon name="crown" size={23} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800 }}>{planLabel} plan</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{plan === 'free' ? 'Upgrade for lower fees & automation' : 'Manage subscription'}</div>
        </div>
        {plan === 'free' ? <Btn size="sm" icon="crown">Upgrade</Btn> : <Icon name="chevR" size={18} color="var(--faint)" />}
      </div>
      <Group title="Trading">
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: paper ? 'var(--glow)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="edit" size={18} /></div>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>Paper trading</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{paper == null ? 'Loading…' : paper ? 'Simulated fills — no real funds move' : 'Off — trades are real'}</span>
          </span>
          <Toggle on={!!paper} onClick={togglePaper} />
        </div>
        {item('briefcase', 'Portfolio & PnL', 'Positions · exits', () => go('portfolio'))}
        {item('layers', 'Connected exchanges', exConnected ? exConnected + ' linked' : 'Connect', () => go('exchanges'))}
        {item('wallet', 'Wallets', walletCount ? walletCount + (walletCount === 1 ? ' chain' : ' chains') : 'Set up', () => go('wallet'))}
        {item('robot', 'Automation rules', autoActive ? autoActive + ' active' : 'Set up', () => go('automation'))}
        {item('bell', 'Alerts & notifications', alertCount ? alertCount + ' set' : 'Add', () => go('alerts'))}
      </Group>
      <Group title="Security">
        {item('shield', 'WalletConnect & signing', 'Confirm every tx', () => go('signing'))}
        {item('lock', '2FA', null, () => go('2fa'))}
        {item('history', 'Session management', 'This device', () => go('sessions'))}
      </Group>
      <Group title="Connect">
        {item('telegram', 'Telegram bot', 'Connect', () => go('connect', { kind: 'telegram' }))}
        {item('discord', 'Discord agent', 'Connect', () => go('connect', { kind: 'discord' }))}
        {item('link', 'Referral program', 'Earn 25%', () => go('referral'))}
      </Group>
      <AppearanceGroup t={t} setTweak={setTweak} />
      <div style={{ marginTop: 18 }}>
        <Card pad={0} style={{ overflow: 'hidden' }}>{item('arrowDR', 'Sign out', null, onSignOut, true)}</Card>
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)', marginTop: 18 }}>FXcrypt v2.4.0 · web · PWA · Android</div>
    </div>
  );
}

function AppearanceGroup({ t, setTweak }) {
  const [open, setOpen] = shS(false);
  const accentName = { gold: 'Binance Gold', cyan: 'Electric Cyan', green: 'Bull Green', violet: 'Neon Violet' }[t.accent] || 'Binance Gold';
  const accentHex = { gold: '#FCD535', cyan: '#00C2FF', green: '#16C784', violet: '#7B61FF' }[t.accent] || '#FCD535';
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 4px 7px' }}>Appearance</div>
      <Card pad={0} style={{ overflow: 'hidden' }}>
        {/* summary row — tap to expand */}
        <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="eye" size={18} /></div>
          <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: 'var(--text)' }}>Theme, color & layout</span>
          <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{t.dark ? 'Dark' : 'Light'}</span>
          <span style={{ width: 16, height: 16, borderRadius: '50%', background: accentHex, flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)' }} />
          <Icon name={open ? 'chevU' : 'chevD'} size={17} color="var(--faint)" />
        </button>
        {/* expandable body */}
        <div style={{ maxHeight: open ? 560 : 0, overflow: 'hidden', transition: 'max-height .3s cubic-bezier(.4,0,.2,1)' }}>
          <div style={{ borderTop: '1px solid var(--line)' }}>
            <ThemeRow t={t} setTweak={setTweak} />
            <AccentRow t={t} setTweak={setTweak} />
            <HomeLayoutRow t={t} setTweak={setTweak} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function ThemeRow({ t, setTweak }) {
  const opts = [
    { v: false, label: 'Light', bg: '#FFFFFF', fg: '#1E2329', bar: '#F0F2F5' },
    { v: true, label: 'Dark', bg: '#0B0E11', fg: '#EAECEF', bar: '#1E2329' },
  ];
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 13 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="eye" size={18} /></div>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>Theme</span>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{t.dark ? 'Dark' : 'Light'}</span>
      </div>
      <div style={{ display: 'flex', gap: 11 }}>
        {opts.map(o => {
          const on = t.dark === o.v;
          return (
            <button key={o.label} onClick={() => setTweak('dark', o.v)} style={{
              flex: 1, padding: 0, border: 'none', cursor: 'pointer', background: 'none', fontFamily: 'inherit',
            }}>
              {/* mini phone preview */}
              <div style={{ position: 'relative', borderRadius: 13, overflow: 'hidden', background: o.bg, height: 78, boxShadow: on ? '0 0 0 2.5px var(--accent)' : 'inset 0 0 0 1.5px var(--line2)', transition: 'box-shadow .15s' }}>
                <div style={{ position: 'absolute', top: 9, left: 10, right: 10, height: 9, borderRadius: 3, background: o.bar }} />
                <div style={{ position: 'absolute', top: 24, left: 10, width: 30, height: 7, borderRadius: 3, background: 'var(--accent)' }} />
                <div style={{ position: 'absolute', top: 24, left: 46, right: 10, height: 7, borderRadius: 3, background: o.bar }} />
                <div style={{ position: 'absolute', top: 38, left: 10, right: 24, height: 7, borderRadius: 3, background: o.bar }} />
                <div style={{ position: 'absolute', bottom: 9, left: 10, right: 10, height: 13, borderRadius: 4, background: o.bar, display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: o.fg, opacity: 0.4 }} />
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: o.fg, opacity: 0.4 }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 8 }}>
                {on && <Icon name="checkCircle" size={15} color="var(--accent)" />}
                <span style={{ fontSize: 13, fontWeight: on ? 800 : 600, color: on ? 'var(--text)' : 'var(--muted)' }}>{o.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AccentRow({ t, setTweak }) {
  const swatches = [
    { key: 'gold', hex: '#FCD535', name: 'Binance Gold' },
    { key: 'cyan', hex: '#00C2FF', name: 'Electric Cyan' },
    { key: 'green', hex: '#16C784', name: 'Bull Green' },
    { key: 'violet', hex: '#7B61FF', name: 'Neon Violet' },
  ];
  const cur = swatches.find(s => s.key === t.accent) || swatches[0];
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 13 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="spark" size={18} /></div>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>Accent color</span>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{cur.name}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {swatches.map(s => {
          const on = t.accent === s.key;
          return (
            <button key={s.key} onClick={() => setTweak('accent', s.key)} aria-label={s.name} style={{
              width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer', background: s.hex,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              boxShadow: on ? `0 0 0 2px var(--surface), 0 0 0 4px ${s.hex}` : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
              transition: 'box-shadow .15s, transform .1s',
            }}
              onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.9)')}
              onMouseUp={e => (e.currentTarget.style.transform = '')}
              onMouseLeave={e => (e.currentTarget.style.transform = '')}>
              {on && <Icon name="check" size={15} color={s.key === 'gold' ? '#0B0E11' : '#fff'} stroke={3.2} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HomeLayoutRow({ t, setTweak }) {
  const opts = [
    { key: 'agent', label: 'Agent', desc: 'AI-first' },
    { key: 'hub', label: 'Hub', desc: 'Portfolio' },
    { key: 'feed', label: 'Feed', desc: 'Market brief' },
  ];
  const cur = opts.find(o => o.key === t.homeLayout) || opts[0];
  // tiny representative previews of each home layout
  const Preview = ({ kind, on }) => (
    <div style={{ position: 'relative', borderRadius: 11, overflow: 'hidden', background: 'var(--bg2)', height: 72, boxShadow: on ? '0 0 0 2.5px var(--accent)' : 'inset 0 0 0 1.5px var(--line2)', transition: 'box-shadow .15s', padding: 7 }}>
      {kind === 'agent' && <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <div style={{ width: 18, height: 18, borderRadius: 6, background: 'var(--accent)' }} />
        <div style={{ width: 30, height: 4, borderRadius: 2, background: 'var(--line2)' }} />
        <div style={{ width: '100%', height: 9, borderRadius: 4, background: 'var(--surface)', marginTop: 2 }} />
      </div>}
      {kind === 'hub' && <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ width: '100%', height: 22, borderRadius: 5, background: 'var(--accent)', opacity: 0.85 }} />
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          <div style={{ flex: 1, borderRadius: 5, background: 'var(--surface)' }} />
          <div style={{ flex: 1, borderRadius: 5, background: 'var(--surface)' }} />
        </div>
      </div>}
      {kind === 'feed' && <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ width: '100%', height: 16, borderRadius: 5, background: 'var(--surface)', borderLeft: '3px solid var(--accent)' }} />
        {[0, 1, 2].map(i => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--line2)' }} />
          <div style={{ flex: 1, height: 5, borderRadius: 2, background: 'var(--line2)' }} />
          <div style={{ width: 12, height: 5, borderRadius: 2, background: i % 2 ? 'var(--up)' : 'var(--accent)' }} />
        </div>)}
      </div>}
    </div>
  );
  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 13 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="grid" size={18} /></div>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>Home layout</span>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{cur.label}</span>
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        {opts.map(o => {
          const on = t.homeLayout === o.key;
          return (
            <button key={o.key} onClick={() => setTweak('homeLayout', o.key)} style={{ flex: 1, padding: 0, border: 'none', cursor: 'pointer', background: 'none', fontFamily: 'inherit' }}>
              <Preview kind={o.key} on={on} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 7 }}>
                {on && <Icon name="checkCircle" size={14} color="var(--accent)" />}
                <span style={{ fontSize: 12.5, fontWeight: on ? 800 : 600, color: on ? 'var(--text)' : 'var(--muted)' }}>{o.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 4px 7px' }}>{title}</div>
      <Card pad={0} style={{ overflow: 'hidden' }}>{children}</Card>
    </div>
  );
}

// last child of each Group shouldn't show border — handled visually by container clipping
Object.assign(window, { App });

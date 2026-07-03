// automation.jsx — Automation rules (DCA, SL/TP, copy-trade, limit) + create flow + Alerts center
const { useState: auS, useEffect: auE } = React;

const KIND_META = {
  dca: { icon: 'clock', color: '#14F195', label: 'DCA' },
  sltp: { icon: 'shield', color: '#F6465D', label: 'SL/TP' },
  copy: { icon: 'user', color: '#7B61FF', label: 'Copy' },
  limit: { icon: 'target', color: '#FCD535', label: 'Limit' },
  trail: { icon: 'trend', color: '#00C2FF', label: 'Trail' },
  rebal: { icon: 'layers', color: '#16C784', label: 'Rebalance' },
};

// Pointer watch-tasks — standing "watch X and ping me" orders created in chat.
function PointerTasksSection({ go }) {
  const [tasks, setTasks] = auS(null);
  auE(() => {
    let alive = true;
    window.FXAPI.listPointerTasks().then((t) => { if (alive) setTasks(t); }).catch(() => { if (alive) setTasks([]); });
    return () => { alive = false; };
  }, []);
  const setStatus = async (t, status) => {
    setTasks((l) => l.map((x) => x.id === t.id ? { ...x, status } : x));
    try { await window.FXAPI.setPointerTaskStatus(t.id, status); }
    catch (e) { setTasks((l) => l.map((x) => x.id === t.id ? { ...x, status: t.status } : x)); }
  };
  const remove = async (t) => {
    setTasks((l) => l.filter((x) => x.id !== t.id));
    try { await window.FXAPI.deletePointerTask(t.id); } catch (e) {}
  };
  const condText = (t) => t.cond === 'above' ? `above $${t.value}` : t.cond === 'below' ? `below $${t.value}` : `±${t.value}% move`;
  const statusPill = (t) =>
    t.status === 'armed' ? <Pill tone="up">armed</Pill>
    : t.status === 'fired' ? <Pill tone="accent">fired</Pill>
    : t.status === 'quota-paused' ? <Pill tone="down">out of requests</Pill>
    : <Pill tone="muted">paused</Pill>;
  return (
    <div style={{ padding: '0 16px 14px' }}>
      <SecHead>Pointer watch-tasks</SecHead>
      <div style={{ height: 8 }} />
      {tasks == null && <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 2px' }}>Loading…</div>}
      {tasks != null && tasks.length === 0 && (
        <Card onClick={() => go('chat')} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}><Icon name="spark" size={18} /></div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.45 }}>
              Ask Pointer to watch anything: <b style={{ color: 'var(--text)' }}>“watch BTC and ping me if it breaks $150k”</b> — it monitors 24/7 and analyzes the move when it fires.
            </div>
          </div>
        </Card>
      )}
      {(tasks || []).map((t) => (
        <Card key={t.id} pad={0} style={{ overflow: 'hidden', marginBottom: 8, opacity: t.status === 'paused' ? 0.65 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}><Icon name="spark" size={17} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 14 }}>{t.sym} {statusPill(t)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{condText(t)}{t.firedAt ? ' · fired ' + new Date(t.firedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div>
            </div>
            {t.status === 'fired' && t.chatId && (
              <Btn size="sm" kind="soft" onClick={() => { window.__fxOpenSession = t.chatId; go('chat'); }}>Analysis</Btn>
            )}
            {(t.status === 'armed' || t.status === 'paused') && (
              <Toggle on={t.status === 'armed'} onClick={() => setStatus(t, t.status === 'armed' ? 'paused' : 'armed')} />
            )}
            <button aria-label="Delete task" onClick={() => remove(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: 4, display: 'flex' }}><Icon name="x" size={16} /></button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Automation({ go, plan, onUpsell }) {
  const FX = window.FX;
  const [rules, setRules] = auS(FX.automations);
  const [create, setCreate] = auS(false);
  const active = rules.filter(r => r.on).length;
  const toggle = (id) => setRules(rs => rs.map(r => r.id === id ? { ...r, on: !r.on } : r));

  return (
    <div>
      <TopBar left={<button onClick={() => go(-1)} style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}><Icon name="chevL" size={21} /></button>}
        title="Automation" sub={active + ' active · ' + rules.length + ' rules'}
        right={<IconBtn name="plus" active onClick={() => plan === 'free' ? onUpsell() : setCreate(true)} />} />

      {/* Real Pointer watch-tasks (created in chat; fire → analysis + push) */}
      <PointerTasksSection go={go} />

      {/* Copy trading — real feature with its own screen */}
      <div style={{ padding: '0 16px 14px' }}>
        <Card onClick={() => go('copytrade')} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}><Icon name="eye" size={20} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>Copy trading</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>Follow smart-money wallets · auto-copy their buys</div>
            </div>
            <Icon name="chevR" size={17} color="var(--faint)" />
          </div>
        </Card>
      </div>

      {/* summary band — real counts only (no execution backend to fabricate PnL) */}
      {rules.length > 0 && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatBox label="Active rules" val={String(active)} sub="running" up={active > 0} />
            <StatBox label="Total rules" val={String(rules.length)} sub="configured" />
            <StatBox label="Paused" val={String(rules.length - active)} sub="off" />
          </div>
        </div>
      )}

      {plan === 'free' && (
        <div style={{ padding: '0 16px 14px' }}>
          <div onClick={onUpsell} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11, background: 'var(--glow)', borderRadius: 14, padding: '13px 15px', boxShadow: 'inset 0 0 0 1.5px var(--accent)' }}>
            <Icon name="crown" size={20} color="var(--accent)" />
            <div style={{ flex: 1, fontSize: 13, color: 'var(--text2)', fontWeight: 600, lineHeight: 1.4 }}>Automation is a <b style={{ color: 'var(--text)' }}>Pro</b> feature. Upgrade to create and run your own rules.</div>
            <Icon name="chevR" size={18} color="var(--accent)" />
          </div>
        </div>
      )}

      {rules.length === 0 && (
        <div style={{ padding: '30px 24px', textAlign: 'center', color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', marginBottom: 12 }}><Icon name="robot" size={26} /></div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>No automation rules yet</div>
          <div style={{ fontSize: 13, marginTop: 4, maxWidth: 260, lineHeight: 1.5 }}>Create a DCA, stop-loss/take-profit, limit order or copy-trade rule to automate your strategy.</div>
        </div>
      )}

      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {rules.map(r => {
          const m = KIND_META[r.kind];
          return (
            <Card key={r.id} pad={0} style={{ overflow: 'hidden', opacity: r.on ? 1 : 0.62, transition: 'opacity .2s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 15px' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 13, background: m.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.color }}><Icon name={m.icon} size={21} /></div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontWeight: 800, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 1 }}>{r.detail}</div>
                </div>
                <Toggle on={r.on} onClick={() => toggle(r.id)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 15px', background: 'var(--surface2)', borderTop: '1px solid var(--line)' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{r.meta}</span>
                <Pill tone={r.kind === 'sltp' ? 'accent' : r.up ? 'up' : 'muted'}>{r.stat}</Pill>
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ padding: '0 16px 24px' }}>
        <Btn kind="soft" full icon="plus" onClick={() => plan === 'free' ? onUpsell() : setCreate(true)}>New automation</Btn>
      </div>

      <Sheet open={create} onClose={() => setCreate(false)} title="New automation">
        <CreateRule onClose={() => setCreate(false)} onCreate={(rule) => { setRules(rs => [rule, ...rs]); setCreate(false); }} />
      </Sheet>
    </div>
  );
}

function StatBox({ label, val, sub, up }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 13, padding: '12px 13px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3, color: up ? 'var(--up)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{val}</div>
      <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 1 }}>{sub}</div>
    </div>
  );
}

// Shown when the live market list hasn't loaded yet (token pickers need it).
function TokensLoading() {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 24, height: 24, border: '3px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} />
      <div style={{ fontSize: 13.5 }}>Loading market data — one moment…</div>
    </div>
  );
}

function CreateRule({ onClose, onCreate }) {
  const FX = window.FX;
  const [stage, setStage] = auS('pick'); // pick | config
  const [kind, setKind] = auS(null);
  const [tok, setTok] = auS(FX.tokens[0] || null);
  const [amt, setAmt] = auS('100');
  const [freq, setFreq] = auS('Weekly');
  const [notify, setNotify] = auS(true);

  if (stage === 'pick') {
    return (
      <div style={{ paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {FX.autoTypes.map(t => (
          <button key={t.kind} onClick={() => { setKind(t); setStage('config'); }} style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--surface)', borderRadius: 14, padding: 14, border: 'none', boxShadow: 'inset 0 0 0 1px var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: t.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.color, flexShrink: 0 }}><Icon name={t.icon} size={21} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>{t.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t.desc}</div>
            </div>
            <Icon name="chevR" size={18} color="var(--faint)" />
          </button>
        ))}
      </div>
    );
  }

  // config
  if (!tok) return <TokensLoading />;
  const m = KIND_META[kind.kind];
  return (
    <div style={{ paddingBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: m.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.color }}><Icon name={m.icon} size={20} /></div>
        <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 15.5 }}>{kind.name}</div><div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{kind.desc}</div></div>
        <button onClick={() => setStage('pick')} style={{ background: 'var(--chip)', border: 'none', borderRadius: 9, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit' }}>Change</button>
      </div>

      {/* token select */}
      <Label>Token</Label>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 14, paddingBottom: 2 }}>
        {FX.tokens.slice(0, 6).map(t => (
          <button key={t.id} onClick={() => setTok(t)} style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, padding: '8px 12px 8px 8px', borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: tok.id === t.id ? 'var(--glow)' : 'var(--surface)', boxShadow: tok.id === t.id ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)' }}>
            <Logo color={t.logo} sym={t.sym} size={24} /><span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>{t.sym}</span>
          </button>
        ))}
      </div>

      {(kind.kind === 'dca' || kind.kind === 'limit' || kind.kind === 'copy') && <>
        <Label>{kind.kind === 'copy' ? 'Per-trade size (USDT)' : 'Amount (USDT)'}</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', borderRadius: 13, padding: '12px 15px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
          <span style={{ fontSize: 22, fontWeight: 800 }}>$</span>
          <input value={amt} onChange={e => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 22, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
        </div>
      </>}

      {kind.kind === 'dca' && <>
        <Label>Frequency</Label>
        <Segmented options={['Daily', 'Weekly', 'Monthly']} value={freq} onChange={setFreq} style={{ marginBottom: 14 }} />
      </>}

      {kind.kind === 'sltp' && <>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}><Label>Stop-loss</Label><InputBox prefix="-" suffix="%" val="8" /></div>
          <div style={{ flex: 1 }}><Label>Take-profit</Label><InputBox prefix="+" suffix="%" val="25" /></div>
        </div>
      </>}

      {kind.kind === 'limit' && <>
        <Label>Trigger price</Label>
        <InputBox prefix="$" val={tok.price.toString()} style={{ marginBottom: 14 }} />
      </>}

      {(kind.kind === 'trail' || kind.kind === 'rebal') && <>
        <Label>{kind.kind === 'trail' ? 'Trail distance' : 'Rebalance band'}</Label>
        <InputBox prefix="" suffix="%" val={kind.kind === 'trail' ? '8' : '5'} style={{ marginBottom: 14 }} />
      </>}

      {/* notify row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)', borderRadius: 13, padding: '13px 15px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 18 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, fontWeight: 600 }}><Icon name="bell" size={17} color="var(--accent)" /> Notify on every execution</span>
        <Toggle on={notify} onClick={() => setNotify(n => !n)} />
      </div>

      <Btn size="lg" full icon="zap" onClick={() => onCreate({
        id: 'a' + Date.now(), kind: kind.kind, name: kind.name.replace(/ \/.*/, '') + (tok.sym ? ' · ' + tok.sym : ''), sym: tok.sym, logo: tok.logo, chain: tok.chain, on: true,
        detail: kind.kind === 'dca' ? `Buy $${amt} ${freq.toLowerCase()}` : kind.kind === 'limit' ? `Buy at $${tok.price}` : kind.desc,
        meta: 'Created just now', stat: 'Armed', up: true,
      })}>Activate rule</Btn>
    </div>
  );
}

function Label({ children }) { return <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', margin: '0 2px 7px' }}>{children}</div>; }
function InputBox({ prefix, suffix, val, style }) {
  const [v, setV] = auS(val);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', borderRadius: 13, padding: '12px 15px', boxShadow: 'inset 0 0 0 1px var(--line)', ...style }}>
      {prefix && <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--muted)' }}>{prefix}</span>}
      <input value={v} onChange={e => setV(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 19, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
      {suffix && <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--muted)' }}>{suffix}</span>}
    </div>
  );
}

// ─── Alerts center ───
// Push-notification settings card — device opt-in + per-category mutes.
// Permission prompt fires ONLY from the button tap (never on load).
const PUSH_CATS = [
  ['trades', 'Trade fills & exits', 'zap'],
  ['gems', 'Gem auto-buys & alerts', 'scan'],
  ['signals', 'New signals', 'robot'],
  ['alerts', 'Price alerts', 'bell'],
  ['tasks', 'Pointer watch-tasks', 'spark'],
  ['copy', 'Copy trading', 'eye'],
  ['system', 'Account & system', 'shield'],
];
function PushSettings() {
  const [sup, setSup] = auS(null);       // null = probing
  const [st, setSt] = auS({ permission: 'default', enabled: false });
  const [prefs, setPrefs] = auS({});
  const [busy, setBusy] = auS(false);
  const [err, setErr] = auS('');
  auE(() => {
    let alive = true;
    const P = window.FXPush;
    if (!P) { setSup(false); return; }
    P.supported().then((v) => { if (alive) { setSup(v); setSt(P.status()); } });
    P.getPrefs().then((p) => { if (alive && p) setPrefs(p); });
    return () => { alive = false; };
  }, []);
  const toggleDevice = async () => {
    if (busy) return; setBusy(true); setErr('');
    try {
      if (st.enabled) { await window.FXPush.disable(); }
      else { await window.FXPush.enable(); if (window.FXToast) window.FXToast.show('🔔 Notifications enabled on this device'); }
      setSt(window.FXPush.status());
    } catch (e) { setErr((e && e.message) || 'Failed'); }
    finally { setBusy(false); }
  };
  const toggleCat = async (cat) => {
    const next = !(prefs[cat] !== false);
    setPrefs((p) => ({ ...p, [cat]: next }));
    try { await window.FXPush.setPref(cat, next); }
    catch (e) { setPrefs((p) => ({ ...p, [cat]: !next })); }
  };
  if (sup === false) return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--muted)' }}>
        <Icon name="bell" size={16} /> Push notifications aren't supported in this browser.
      </div>
    </Card>
  );
  return (
    <Card pad={0} style={{ marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 15px', borderBottom: st.enabled ? '1px solid var(--line)' : 'none' }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: st.enabled ? 'var(--accent)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: st.enabled ? 'var(--on-accent)' : 'var(--accent)' }}><Icon name="bell" size={18} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>Push notifications</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
            {sup === null ? 'Checking…' : st.enabled ? 'On for this device' : st.permission === 'denied' ? 'Blocked in browser settings' : 'Trade fills, exits, gems & signals'}
          </div>
        </div>
        <Btn size="sm" kind={st.enabled ? 'ghost' : 'primary'} onClick={toggleDevice} disabled={busy || st.permission === 'denied'}>
          {busy ? '…' : st.enabled ? 'Turn off' : 'Enable'}
        </Btn>
      </div>
      {err && <div style={{ padding: '9px 15px', fontSize: 12, color: 'var(--down)' }}>{err}</div>}
      {st.enabled && PUSH_CATS.map(([cat, label, icon]) => (
        <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 15px', borderBottom: '1px solid var(--line)' }}>
          <Icon name={icon} size={16} color="var(--muted)" />
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{label}</span>
          <Toggle on={prefs[cat] !== false} onClick={() => toggleCat(cat)} />
        </div>
      ))}
    </Card>
  );
}

// Human condition line for a price alert doc.
function alertCond(a) {
  if (a.kind === 'above') return `Price above $${a.value}`;
  if (a.kind === 'below') return `Price below $${a.value}`;
  return `Moves ±${a.value}% from $${a.basePrice != null ? (a.basePrice < 1 ? a.basePrice.toPrecision(4) : a.basePrice.toLocaleString()) : '—'}`;
}

// Daily digest opt-in: a Pointer-composed morning summary (portfolio, movers,
// signals) via push + Telegram at the user's chosen local hour.
function DigestSettings() {
  const [prefs, setPrefs] = auS(null); // { enabled, hourUtc }
  const [busy, setBusy] = auS(false);
  const tzOffH = -Math.round(new Date().getTimezoneOffset() / 60); // local = UTC + tzOffH
  const localHour = (utc) => ((utc + tzOffH) % 24 + 24) % 24;
  const utcHour = (local) => ((local - tzOffH) % 24 + 24) % 24;
  auE(() => {
    let alive = true;
    window.FXAPI.getDigestPrefs().then((p) => { if (alive) setPrefs(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const save = async (patch) => {
    if (!prefs || busy) return;
    const next = { ...prefs, ...patch };
    setPrefs(next); setBusy(true);
    try { await window.FXAPI.setDigestPrefs(next); }
    catch (e) { setPrefs(prefs); }
    finally { setBusy(false); }
  };
  const fmtH = (h) => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  return (
    <Card pad={0} style={{ marginBottom: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 15px' }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, background: prefs && prefs.enabled ? 'var(--accent)' : 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: prefs && prefs.enabled ? 'var(--on-accent)' : 'var(--accent)' }}><Icon name="spark" size={18} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>Daily digest</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
            {prefs == null ? 'Loading…' : prefs.enabled ? `Pointer's morning summary at ~${fmtH(localHour(prefs.hourUtc))}` : 'Portfolio, movers & signals — once a day'}
          </div>
        </div>
        <Toggle on={!!(prefs && prefs.enabled)} onClick={() => save({ enabled: !(prefs && prefs.enabled) })} />
      </div>
      {prefs && prefs.enabled && (
        <div style={{ padding: '0 15px 13px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>Send around</span>
          {[6, 7, 8, 9, 12, 18, 21].map((lh) => (
            <Chip key={lh} active={localHour(prefs.hourUtc) === lh} onClick={() => save({ hourUtc: utcHour(lh) })}>{fmtH(lh)}</Chip>
          ))}
        </div>
      )}
    </Card>
  );
}

function Alerts({ go }) {
  const FX = window.FX;
  const [tab, setTab] = auS('notifs');
  const [alerts, setAlerts] = auS(null);   // null = loading (real users/{uid}/priceAlerts)
  const [add, setAdd] = auS(false);
  const [toast, setToast] = auS('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };
  const load = () => window.FXAPI.listPriceAlerts().then(setAlerts).catch(() => setAlerts([]));
  auE(() => { load(); }, []);
  const toggle = async (a) => {
    const next = !a.on;
    setAlerts((list) => list.map((x) => x.id === a.id ? { ...x, on: next } : x));
    try { await window.FXAPI.togglePriceAlert(a.id, next); }
    catch (e) {
      setAlerts((list) => list.map((x) => x.id === a.id ? { ...x, on: !next } : x));
      flash((e && e.message) || 'Failed');
    }
  };
  const remove = async (a) => {
    setAlerts((list) => list.filter((x) => x.id !== a.id));
    try { await window.FXAPI.deletePriceAlert(a.id); } catch (e) { load(); }
  };
  const kindIcon = { above: 'trend', below: 'arrowDR', move: 'zap' };

  return (
    <div>
      <TopBar left={<button onClick={() => go(-1)} style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}><Icon name="chevL" size={21} /></button>}
        title="Notifications" right={<IconBtn name="plus" active onClick={() => setAdd(true)} />} />
      <div style={{ padding: '0 16px 12px' }}>
        <Segmented options={[{ value: 'notifs', label: 'Activity' }, { value: 'alerts', label: 'My alerts' }]} value={tab} onChange={setTab} />
      </div>

      {tab === 'notifs' && <div style={{ padding: '0 16px 20px' }}>
        <PushSettings />
        <DigestSettings />
        {(FX.notifs || []).length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
            <Icon name="bell" size={26} color="var(--faint)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No notifications yet</div>
            <div style={{ fontSize: 12.5, marginTop: 3 }}>Trade fills, alerts and signals will show up here.</div>
          </div>
        )}
        {(FX.notifs || []).map(n => (
          <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 2px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: n.col, flexShrink: 0 }}><Icon name={n.icon} size={19} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>{n.title}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 1 }}>{n.body}</div>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--faint)', whiteSpace: 'nowrap', fontWeight: 600 }}>{n.time}</span>
          </div>
        ))}
        {(FX.notifs || []).length > 0 && <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--faint)', marginTop: 16 }}>That's everything from the last 24h</div>}
      </div>}

      {tab === 'alerts' && <div style={{ padding: '0 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alerts == null && <div style={{ textAlign: 'center', padding: 36, color: 'var(--muted)', fontSize: 14 }}>Loading alerts…</div>}
        {alerts != null && alerts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px 20px 8px', color: 'var(--muted)' }}>
            <Icon name="dollar" size={26} color="var(--faint)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No alerts set</div>
            <div style={{ fontSize: 12.5, marginTop: 3 }}>Get a push + Telegram ping on price targets and big moves.</div>
          </div>
        )}
        {(alerts || []).map(a => (
          <Card key={a.id} pad={0} style={{ overflow: 'hidden', opacity: a.on ? 1 : 0.6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px' }}>
              <Logo sym={a.sym} chain={a.chain} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: 14.5 }}>{a.sym || '—'}</span>
                  <Pill tone="muted"><Icon name={kindIcon[a.kind] || 'bell'} size={11} /> {a.kind}</Pill>
                  {a.firedAt && !a.on && <Pill tone="up">fired</Pill>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2, fontWeight: 600 }}>{alertCond(a)}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{a.firedAt ? 'Fired ' + new Date(a.firedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Once · push + Telegram'}</div>
              </div>
              <button aria-label="Delete alert" onClick={() => remove(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', padding: 4, display: 'flex' }}><Icon name="x" size={16} /></button>
              <Toggle on={!!a.on} onClick={() => toggle(a)} />
            </div>
          </Card>
        ))}
        <Btn kind="soft" full icon="plus" onClick={() => setAdd(true)} style={{ marginTop: 4 }}>New alert</Btn>
      </div>}

      <Sheet open={add} onClose={() => setAdd(false)} title="New alert">
        <NewAlert onClose={() => setAdd(false)} onCreated={(a) => { setAlerts(prev => [a, ...(prev || [])]); setTab('alerts'); setAdd(false); flash('🔔 Alert armed'); }} />
      </Sheet>
      {toast && <div style={{ position: 'fixed', left: '50%', bottom: 100, transform: 'translateX(-50%)', background: 'var(--surface2)', color: 'var(--text)', padding: '10px 16px', borderRadius: 11, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,.4)', zIndex: 60, maxWidth: '86vw', textAlign: 'center' }}>{toast}</div>}
    </div>
  );
}

function NewAlert({ onClose, onCreated }) {
  const FX = window.FX;
  // Watchlist tokens first (that's what people actually watch), then majors.
  const watch = (window.FXWatch && window.FXWatch.ready() && window.FXWatch.rows && window.FXWatch.rows()) || [];
  const seen = new Set();
  const opts = [...watch, ...(FX.tokens || [])].filter((t) => {
    const k = t.cg ? 'cg:' + t.cg : 'a:' + (t.address || t.tokenAddress || t.sym);
    if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 12);
  const [tok, setTok] = auS(opts[0] || null);
  const [kind, setKind] = auS('above');
  const [val, setVal] = auS(opts[0] && opts[0].price ? String(opts[0].price) : '');
  const [busy, setBusy] = auS(false);
  const [err, setErr] = auS('');
  if (!tok) return <TokensLoading />;
  const kinds = [['above', 'Above $', 'trend'], ['below', 'Below $', 'arrowDR'], ['move', 'Moves ±%', 'zap']];
  const create = async () => {
    if (busy) return; setBusy(true); setErr('');
    try {
      const a = await window.FXAPI.savePriceAlert({
        kind, value: parseFloat(val),
        cg: tok.cg || null, chain: tok.chain || null, address: tok.address || tok.tokenAddress || null,
        sym: tok.sym, name: tok.name || tok.sym,
      });
      onCreated(a);
    } catch (e) { setErr((e && e.message) || 'Could not create the alert.'); setBusy(false); }
  };
  return (
    <div style={{ paddingBottom: 12 }}>
      <Label>Token</Label>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 14 }}>
        {opts.map((t, i) => (
          <button key={i} onClick={() => { setTok(t); if (kind !== 'move' && t.price) setVal(String(t.price)); }} style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, padding: '8px 12px 8px 8px', borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: tok === t ? 'var(--glow)' : 'var(--surface)', boxShadow: tok === t ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)' }}>
            <Logo color={t.logo} sym={t.sym} chain={t.chain} img={t.img} size={24} /><span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>{t.sym}</span>
          </button>
        ))}
      </div>
      <Label>Trigger</Label>
      <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
        {kinds.map(([v, l, ic]) => <Chip key={v} active={kind === v} onClick={() => { setKind(v); setVal(v === 'move' ? '10' : (tok.price ? String(tok.price) : '')); }} icon={ic} style={{ flex: 1, justifyContent: 'center' }}>{l}</Chip>)}
      </div>
      <Label>{kind === 'above' ? 'Price is above' : kind === 'below' ? 'Price is below' : 'Moves up or down by'}</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', borderRadius: 13, padding: '12px 15px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--muted)' }}>{kind === 'move' ? '±' : '$'}</span>
        <input value={val} onChange={e => setVal(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 20, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
        {kind === 'move' && <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--muted)' }}>%</span>}
      </div>
      {tok.price ? <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 14 }}>Now {fmtUsd(tok.price)}</div> : <div style={{ height: 14 }} />}
      <Label>Deliver via</Label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['Push', 'bell'], ['Telegram', 'telegram']].map(([l, ic]) => (
          <div key={l} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px', borderRadius: 12, background: 'var(--glow)', boxShadow: 'inset 0 0 0 1.5px var(--accent)', color: 'var(--accent)' }}>
            <Icon name={ic} size={20} /><span style={{ fontSize: 12, fontWeight: 700 }}>{l}</span>
          </div>
        ))}
      </div>
      {err && <div style={{ fontSize: 12.5, color: 'var(--down)', marginBottom: 12 }}>{err}</div>}
      <Btn size="lg" full icon="bell" onClick={create} disabled={busy || !(parseFloat(val) > 0)}>{busy ? 'Arming…' : 'Create alert'}</Btn>
    </div>
  );
}

Object.assign(window, { Automation, Alerts });

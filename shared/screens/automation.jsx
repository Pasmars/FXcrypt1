// automation.jsx — Automation rules (DCA, SL/TP, copy-trade, limit) + create flow + Alerts center
const { useState: auS } = React;

const KIND_META = {
  dca: { icon: 'clock', color: '#14F195', label: 'DCA' },
  sltp: { icon: 'shield', color: '#F6465D', label: 'SL/TP' },
  copy: { icon: 'user', color: '#7B61FF', label: 'Copy' },
  limit: { icon: 'target', color: '#FCD535', label: 'Limit' },
  trail: { icon: 'trend', color: '#00C2FF', label: 'Trail' },
  rebal: { icon: 'layers', color: '#16C784', label: 'Rebalance' },
};

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
function Alerts({ go }) {
  const FX = window.FX;
  const [tab, setTab] = auS('notifs');
  const [alerts, setAlerts] = auS(FX.alerts);
  const [add, setAdd] = auS(false);
  const toggle = (id) => setAlerts(a => a.map(x => x.id === id ? { ...x, on: !x.on } : x));
  const kindIcon = { price: 'dollar', whale: 'eye', signal: 'robot' };

  return (
    <div>
      <TopBar left={<button onClick={() => go(-1)} style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}><Icon name="chevL" size={21} /></button>}
        title="Notifications" right={<IconBtn name="plus" active onClick={() => setAdd(true)} />} />
      <div style={{ padding: '0 16px 12px' }}>
        <Segmented options={[{ value: 'notifs', label: 'Activity' }, { value: 'alerts', label: 'My alerts' }]} value={tab} onChange={setTab} />
      </div>

      {tab === 'notifs' && <div style={{ padding: '0 16px 20px' }}>
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
        {alerts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px 20px 8px', color: 'var(--muted)' }}>
            <Icon name="dollar" size={26} color="var(--faint)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No alerts set</div>
            <div style={{ fontSize: 12.5, marginTop: 3 }}>Get notified on price targets, whale moves and new signals.</div>
          </div>
        )}
        {alerts.map(a => (
          <Card key={a.id} pad={0} style={{ overflow: 'hidden', opacity: a.on ? 1 : 0.6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px' }}>
              <Logo color={a.logo} sym={a.sym} chain={a.chain} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: 14.5 }}>{a.sym}</span>
                  <Pill tone="muted"><Icon name={kindIcon[a.kind]} size={11} /> {a.kind}</Pill>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2, fontWeight: 600 }}>{a.cond}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{a.meta}</div>
              </div>
              <Toggle on={a.on} onClick={() => toggle(a.id)} />
            </div>
          </Card>
        ))}
        <Btn kind="soft" full icon="plus" onClick={() => setAdd(true)} style={{ marginTop: 4 }}>New alert</Btn>
      </div>}

      <Sheet open={add} onClose={() => setAdd(false)} title="New alert">
        <NewAlert onClose={() => setAdd(false)} onCreate={(a) => { setAlerts(prev => [a, ...prev]); setTab('alerts'); setAdd(false); }} />
      </Sheet>
    </div>
  );
}

function NewAlert({ onClose, onCreate }) {
  const FX = window.FX;
  const [tok, setTok] = auS(FX.tokens[0] || null);
  const [kind, setKind] = auS('price');
  const [px, setPx] = auS(tok ? tok.price.toString() : '');
  if (!tok) return <TokensLoading />;
  const kinds = [['price', 'Price target', 'dollar'], ['whale', 'Whale move', 'eye'], ['signal', 'New signal', 'robot']];
  return (
    <div style={{ paddingBottom: 12 }}>
      <Label>Token</Label>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 14 }}>
        {FX.tokens.slice(0, 6).map(t => (
          <button key={t.id} onClick={() => { setTok(t); setPx(t.price.toString()); }} style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, padding: '8px 12px 8px 8px', borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: tok.id === t.id ? 'var(--glow)' : 'var(--surface)', boxShadow: tok.id === t.id ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)' }}>
            <Logo color={t.logo} sym={t.sym} size={24} /><span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>{t.sym}</span>
          </button>
        ))}
      </div>
      <Label>Trigger</Label>
      <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
        {kinds.map(([v, l, ic]) => <Chip key={v} active={kind === v} onClick={() => setKind(v)} icon={ic} style={{ flex: 1, justifyContent: 'center' }}>{l.split(' ')[0]}</Chip>)}
      </div>
      {kind === 'price' && <>
        <Label>Price is above</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', borderRadius: 13, padding: '12px 15px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 18 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--muted)' }}>$</span>
          <input value={px} onChange={e => setPx(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 20, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
        </div>
      </>}
      {kind !== 'price' && <div style={{ background: 'var(--surface)', borderRadius: 13, padding: '14px 15px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 18, fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5 }}>
        {kind === 'whale' ? `Notify when a wallet buys or sells more than $50K of ${tok.sym}.` : `Notify when Pointer detects a new high-confidence signal for ${tok.sym}.`}
      </div>}
      <Label>Deliver via</Label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {[['Push', 'bell'], ['Telegram', 'telegram'], ['Email', 'message']].map(([l, ic], i) => (
          <div key={l} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px', borderRadius: 12, background: i < 2 ? 'var(--glow)' : 'var(--surface)', boxShadow: i < 2 ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)', color: i < 2 ? 'var(--accent)' : 'var(--muted)' }}>
            <Icon name={ic} size={20} /><span style={{ fontSize: 12, fontWeight: 700 }}>{l}</span>
          </div>
        ))}
      </div>
      <Btn size="lg" full icon="bell" onClick={() => onCreate({
        id: 'al' + Date.now(), sym: tok.sym, logo: tok.logo, chain: tok.chain, kind,
        cond: kind === 'price' ? `Price above $${px}` : kind === 'whale' ? 'Whale move > $50K' : 'New signal detected',
        meta: 'Once · push + Telegram', on: true,
      })}>Create alert</Btn>
    </div>
  );
}

Object.assign(window, { Automation, Alerts });

// ui.jsx — FXcrypt shared UI primitives

const { useState, useEffect, useRef } = React;

// fmt helpers
function fmtUsd(n, dp) {
  if (n == null) return '—';
  if (n === 0) return '$0.00';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: dp ?? 2, minimumFractionDigits: dp ?? 2 });
  if (n >= 1) return '$' + n.toFixed(dp ?? 2);
  if (n >= 0.001) return '$' + n.toFixed(4);
  return '$' + n.toFixed(8);
}
function pct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

// Token logo dot with symbol initial
// Pick a readable text colour (dark vs light) for the fallback initials based on
// the background's perceived luminance, so initials never wash out on the chip.
function readableOn(hex) {
  const c = String(hex || '').replace('#', '');
  if (c.length < 6) return '#fff';
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#0B0E11' : '#fff';
}
const DS_LOGO_CHAIN = { sol: 'solana', eth: 'ethereum', bsc: 'bsc', base: 'base', poly: 'polygon', arb: 'arbitrum', ton: 'ton' };
function Logo({ color = '#888', sym = '', size = 38, chain, img, address }) {
  const ch = chain && window.FX.chains && window.FX.chains.find(c => c.id === chain);
  // Resolve the best logo we can find, in order: explicit img → a matching
  // live-market coin by symbol (gives native/major tokens their real CoinGecko
  // logo for free) → DexScreener's token image CDN for on-chain contracts.
  // Any miss is handled by onError, which reveals the initials underneath.
  const FXt = (window.FX && window.FX.tokens) || [];
  const symU = String(sym || '').toUpperCase();
  const resolved = img
    || (FXt.find(t => String(t.sym || '').toUpperCase() === symU && t.img) || {}).img
    || (address && DS_LOGO_CHAIN[chain] ? `https://dd.dexscreener.com/ds-data/tokens/${DS_LOGO_CHAIN[chain]}/${address}.png` : null)
    || null;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{
        position: 'relative', overflow: 'hidden',
        width: size, height: size, borderRadius: '50%',
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: size * 0.36, color: readableOn(color), letterSpacing: -0.5,
        fontFamily: 'inherit', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
      }}>
        <span>{sym.slice(0, 2)}</span>
        {resolved && <img src={resolved} alt={sym} width={size} height={size} loading="lazy" referrerPolicy="no-referrer"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{ position: 'absolute', inset: 0, width: size, height: size, borderRadius: '50%', objectFit: 'cover', background: color }} />}
      </div>
      {ch && (
        <div style={{
          position: 'absolute', right: -2, bottom: -2, width: size * 0.42, height: size * 0.42,
          borderRadius: '50%', background: ch.color, border: '2px solid var(--surface)',
        }} />
      )}
    </div>
  );
}

// Sparkline (SVG)
function Sparkline({ data, up, w = 80, h = 28, fill = true }) {
  if (!data || !data.length) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const col = up ? 'var(--up)' : 'var(--down)';
  const id = useRef('sp' + Math.random().toString(36).slice(2)).current;
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={col} stopOpacity="0.28" />
        <stop offset="1" stopColor={col} stopOpacity="0" />
      </linearGradient></defs>}
      {fill && <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Buttons
function Btn({ children, onClick, kind = 'primary', size = 'md', icon, full, disabled, style = {} }) {
  const sizes = { sm: { p: '8px 14px', f: 13, h: 36 }, md: { p: '12px 18px', f: 15, h: 46 }, lg: { p: '15px 22px', f: 16, h: 54 } };
  const s = sizes[size];
  const kinds = {
    primary: { background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700 },
    deep: { background: 'var(--accent-deep)', color: '#fff', fontWeight: 700 },
    up: { background: 'var(--up)', color: '#fff', fontWeight: 700 },
    down: { background: 'var(--down)', color: '#fff', fontWeight: 700 },
    soft: { background: 'var(--chip)', color: 'var(--text)', fontWeight: 600 },
    ghost: { background: 'transparent', color: 'var(--text2)', fontWeight: 600, boxShadow: 'inset 0 0 0 1px var(--line)' },
    outline: { background: 'transparent', color: 'var(--accent)', fontWeight: 700, boxShadow: 'inset 0 0 0 1.5px var(--accent)' },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: s.p, minHeight: s.h, fontSize: s.f, borderRadius: 12, border: 'none',
      cursor: disabled ? 'default' : 'pointer', width: full ? '100%' : undefined,
      opacity: disabled ? 0.4 : 1, fontFamily: 'inherit', letterSpacing: 0.1,
      transition: 'transform .12s, filter .12s', ...kinds[kind], ...style,
    }}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = 'scale(0.97)')}
      onMouseUp={e => (e.currentTarget.style.transform = '')}
      onMouseLeave={e => (e.currentTarget.style.transform = '')}>
      {icon && <Icon name={icon} size={s.f + 3} />}
      {children}
    </button>
  );
}

function Chip({ children, active, onClick, icon, color, style = {} }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px',
      borderRadius: 9, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
      border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      background: active ? (color || 'var(--accent)') : 'var(--chip)',
      color: active ? (color ? '#fff' : 'var(--on-accent)') : 'var(--text2)',
      transition: 'all .12s', ...style,
    }}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}

function Segmented({ options, value, onChange, style = {} }) {
  return (
    <div style={{
      display: 'flex', background: 'var(--surface2)', borderRadius: 12, padding: 4, gap: 2, ...style,
    }}>
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const on = v === value;
        return (
          <button key={v} onClick={() => onChange(v)} style={{
            flex: 1, padding: '9px 6px', borderRadius: 9, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: on ? 700 : 600, fontFamily: 'inherit',
            background: on ? 'var(--accent)' : 'transparent',
            color: on ? 'var(--on-accent)' : 'var(--muted)', transition: 'all .15s',
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function Card({ children, style = {}, onClick, pad = 16 }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--surface)', borderRadius: 16, padding: pad,
      boxShadow: 'inset 0 0 0 1px var(--line)', cursor: onClick ? 'pointer' : undefined, ...style,
    }}>{children}</div>
  );
}

function Pill({ children, tone = 'muted', style = {} }) {
  const tones = {
    up: { background: 'var(--up-bg)', color: 'var(--up)' },
    down: { background: 'var(--down-bg)', color: 'var(--down)' },
    accent: { background: 'var(--glow)', color: 'var(--accent)' },
    muted: { background: 'var(--chip)', color: 'var(--muted)' },
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
      borderRadius: 7, fontSize: 12, fontWeight: 700, ...tones[tone], ...style,
    }}>{children}</span>
  );
}

function Change({ v, size = 13 }) {
  const up = v >= 0;
  return <span style={{ color: up ? 'var(--up)' : 'var(--down)', fontWeight: 700, fontSize: size, fontVariantNumeric: 'tabular-nums' }}>{pct(v)}</span>;
}

// Bottom sheet
function Sheet({ open, onClose, children, title, height }) {
  const [show, setShow] = useState(open);
  useEffect(() => { if (open) setShow(true); }, [open]);
  if (!show && !open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-end',
      background: 'var(--overlay)', backdropFilter: 'blur(2px)',
      opacity: open ? 1 : 0, transition: 'opacity .25s',
    }} onTransitionEnd={() => { if (!open) setShow(false); }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', background: 'var(--bg2)', borderRadius: '22px 22px 0 0',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.4), inset 0 1px 0 var(--line)',
        transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .3s cubic-bezier(.32,.72,0,1)',
        maxHeight: '90%', display: 'flex', flexDirection: 'column', paddingBottom: 28,
        height,
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 40, height: 4.5, borderRadius: 3, background: 'var(--line2)' }} />
        </div>
        {title && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 18px 10px' }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
            <button onClick={onClose} style={{ background: 'var(--chip)', border: 'none', borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)' }}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div style={{ overflowY: 'auto', padding: '0 18px' }}>{children}</div>
      </div>
    </div>
  );
}

// Section header
function SecHead({ children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 2px' }}>
      <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.2 }}>{children}</div>
      {action && <button onClick={onAction} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 2 }}>{action} <Icon name="chevR" size={14} /></button>}
    </div>
  );
}

// App top bar (in-app, not iOS)
function TopBar({ left, title, right, sub }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 16px 12px', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {left}
        {title && <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -1 }}>{sub}</div>}
        </div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>
    </div>
  );
}

function IconBtn({ name, onClick, badge, active, size = 20 }) {
  return (
    <button onClick={onClick} style={{
      position: 'relative', width: 40, height: 40, borderRadius: 12, border: 'none', cursor: 'pointer',
      background: active ? 'var(--glow)' : 'var(--surface2)', color: active ? 'var(--accent)' : 'var(--text2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <Icon name={name} size={size} />
      {badge && <span style={{ position: 'absolute', top: 7, right: 7, width: 8, height: 8, borderRadius: '50%', background: 'var(--down)', boxShadow: '0 0 0 2px var(--bg)' }} />}
    </button>
  );
}

// Wordmark + geometric mark
function Wordmark({ size = 22, light }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <Mark size={size * 1.25} />
      <span style={{ fontSize: size, fontWeight: 800, letterSpacing: -0.6, color: light ? '#fff' : 'var(--text)' }}>
        FX<span style={{ color: 'var(--accent)' }}>crypt</span>
      </span>
    </div>
  );
}

function Mark({ size = 30 }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg viewBox="0 0 32 32" width={size} height={size}>
        <rect x="2" y="2" width="28" height="28" rx="9" fill="var(--accent)" />
        <path d="M11 10h11M11 16h8M11 22V10" stroke="var(--on-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="21.5" cy="21" r="2.4" fill="var(--on-accent)" />
      </svg>
    </div>
  );
}

// ── Scan progress modal (shared by the gem & signal scanners) ──────────────
// A bottom-sheet that animates through `steps` while a scan runs, then shows a
// result summary + optional preview when `done` flips true. The parent owns the
// scan: open it, run the async scan, then set done + summary/result.
function ScanModal({ open, onClose, accent = 'var(--accent)', title, steps = [], done, error, summary, result }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!open) { setStep(0); return; }
    if (done || error) { setStep(steps.length); return; }
    if (step >= steps.length - 1) return;          // hold on the last step until the scan resolves
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), step === 0 ? 420 : 720);
    return () => clearTimeout(t);
  }, [open, step, done, error, steps.length]);
  if (!open) return null;
  const finished = done || error;
  const pctDone = finished ? 100 : Math.min(94, (step / Math.max(steps.length, 1)) * 100);
  const ring = error ? 'var(--down)' : accent;
  return (
    <div onClick={finished ? onClose : undefined} style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end', background: 'var(--overlay)', backdropFilter: 'blur(3px)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg2)', borderRadius: '22px 22px 0 0', boxShadow: '0 -8px 40px rgba(0,0,0,0.45), inset 0 1px 0 var(--line)', maxHeight: '88%', display: 'flex', flexDirection: 'column', paddingBottom: 26, animation: 'fxslideUp .32s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 2px' }}><div style={{ width: 40, height: 4.5, borderRadius: 3, background: 'var(--line2)' }} /></div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 20px 8px' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
          {finished && <button onClick={onClose} style={{ background: 'var(--chip)', border: 'none', borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)' }}><Icon name="x" size={16} /></button>}
        </div>
        {/* progress ring */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0 4px' }}>
          <div style={{ position: 'relative', width: 84, height: 84 }}>
            <svg width="84" height="84" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="42" cy="42" r="36" fill="none" stroke="var(--line)" strokeWidth="5" />
              <circle cx="42" cy="42" r="36" fill="none" stroke={ring} strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 36} strokeDashoffset={2 * Math.PI * 36 * (1 - pctDone / 100)} style={{ transition: 'stroke-dashoffset .5s cubic-bezier(.4,0,.2,1)' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {error ? <Icon name="alert" size={34} color="var(--down)" />
                : done ? <Icon name="checkCircle" size={36} color={accent} />
                : <span style={{ fontSize: 19, fontWeight: 800, color: accent }}>{Math.round(pctDone)}%</span>}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: 15.5, fontWeight: 800, margin: '4px 0 14px' }}>
          {error ? 'Scan failed' : done ? (summary || 'Scan complete') : (steps[Math.min(step, steps.length - 1)]?.label || 'Scanning…')}
        </div>
        <div style={{ overflowY: 'auto', padding: '0 20px' }}>
          {error
            ? <div style={{ fontSize: 13.5, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5, paddingBottom: 8 }}>{error}</div>
            : !done
              ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {steps.map((st, i) => {
                    const sdone = i < step, active = i === step;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 2px', opacity: sdone || active ? 1 : 0.4, transition: 'opacity .3s' }}>
                        <div style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sdone ? 'var(--up-bg)' : active ? 'var(--glow)' : 'var(--surface2)', color: sdone ? 'var(--up)' : 'var(--accent)' }}>
                          {sdone ? <Icon name="check" size={16} stroke={3} />
                            : active ? <span style={{ width: 15, height: 15, border: '2.4px solid var(--line2)', borderTopColor: accent, borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} />
                            : <Icon name={st.icon || 'scan'} size={15} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: sdone || active ? 'var(--text)' : 'var(--muted)' }}>{st.label}</div>
                          {st.sub && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{st.sub}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
              : <div style={{ paddingBottom: 4 }}>{result}</div>}
        </div>
        {finished && (
          <div style={{ padding: '14px 20px 0' }}>
            <Btn full icon={error ? 'refresh' : 'checkCircle'} onClick={onClose}>{error ? 'Close' : 'View results'}</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, {
  fmtUsd, pct, Logo, Sparkline, Btn, Chip, Segmented, Card, Pill, Change,
  Sheet, SecHead, TopBar, IconBtn, Wordmark, Mark, ScanModal,
});

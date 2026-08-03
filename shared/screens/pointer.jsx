// pointer.jsx — Pointer AI: home/landing variants + full chat with gated trade proposals
const { useState: uS, useEffect: uE, useRef: uR } = React;

// ─── Shared: AI composer bar ───
// While `busy` (a reply is being generated or typed out) the send button turns
// into a Stop control that calls onStop — mirrors the ChatGPT/Claude pattern.
// Composer input is a textarea, not a single-line input: a prompt can be
// written line by line and paragraph by paragraph. Enter inserts a newline
// (and `enterKeyHint="enter"` makes phone keyboards show a return key rather
// than a Send/Go key that would submit), so sending is the button — or
// Ctrl/Cmd+Enter on a hardware keyboard.
const COMPOSER_MAX_H = 168;   // ~6 lines, then it scrolls instead of growing

// ─── Chart-screenshot attachments ───
// Images travel to Pointer inside the callable payload, so they are downscaled
// here first. 1600px on the long edge is the floor at which a chart's price axis
// and indicator readouts stay legible to the vision model — go smaller and the
// numbers blur into each other, which is the one failure the whole feature
// cannot tolerate. At that size a screenshot lands around 200-400KB.
const MAX_ATTACH = 3;
const ATTACH_MAX_EDGE = 1600;
const ATTACH_QUALITY = 0.85;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(img.width, img.height);
      const scale = longest > ATTACH_MAX_EDGE ? ATTACH_MAX_EDGE / longest : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const cx = canvas.getContext('2d');
      if (!cx) { reject(new Error('Could not process that image.')); return; }
      // JPEG has no alpha, so a transparent PNG would flatten onto black by
      // default anyway — do it explicitly against the app's own background so a
      // screenshot with rounded/transparent corners stays consistent.
      cx.fillStyle = '#0B0E11';
      cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/jpeg', ATTACH_QUALITY)); }
      catch (e) { reject(new Error('Could not process that image.')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a readable image.")); };
    img.src = url;
  });
}

function AIBar({ onFocus, value, onChange, onSend, compact, deep, onToggleDeep, busy, onStop, attachments, onAttach, onRemoveAttach }) {
  const taRef = uR(null);
  // Height follows content on every change, including programmatic ones (the
  // Edit affordance reloads a past prompt into the composer) and the reset to
  // empty after a send — hence keying off `value` rather than onInput.
  uE(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, COMPOSER_MAX_H) + 'px';
  }, [value]);

  const onKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    // Let IME composition finish before treating Enter as anything.
    if (e.nativeEvent && e.nativeEvent.isComposing) return;
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); if (!busy && onSend) onSend(); }
    // Plain Enter falls through to the textarea's own newline.
  };

  const shots = attachments || [];
  // The send button lights up for an image-only message too: attaching a chart
  // and hitting send with no text is a complete request.
  const hasContent = !!value || shots.length > 0;

  return (
    <div style={{ background: 'var(--surface)', borderRadius: 16, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
      {shots.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 12px 2px' }}>
          {shots.map((a) => (
            <div key={a.id} style={{ position: 'relative', width: 62, height: 62, borderRadius: 10, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--line2)', background: 'var(--surface2)' }}>
              <img src={a.dataUrl} alt={a.name || 'Attached chart'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {onRemoveAttach && (
                <button onClick={() => onRemoveAttach(a.id)} aria-label={`Remove ${a.name || 'image'}`} title="Remove"
                  style={{ position: 'absolute', top: 3, right: 3, width: 19, height: 19, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,.62)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  <Icon name="x" size={11} color="#fff" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 8px 8px 14px' }}>
      <Icon name="spark" size={18} color="var(--accent)" style={{ flexShrink: 0, marginBottom: 9 }} />
      <textarea ref={taRef} value={value} rows={1}
        onChange={e => onChange && onChange(e.target.value)} onFocus={onFocus}
        onKeyDown={onKeyDown}
        enterKeyHint="enter"
        aria-label="Message Pointer"
        placeholder={compact ? 'Message Pointer…' : 'Ask about crypto, trading & markets…'}
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
          color: 'var(--text)', fontSize: 15, fontFamily: 'inherit', resize: 'none',
          lineHeight: 1.45, padding: '7px 0', margin: 0, maxHeight: COMPOSER_MAX_H,
          overflowY: 'auto', display: 'block',
          // Explicit so the max-height cap means the same thing whether or not
          // the host page ships a border-box reset.
          boxSizing: 'border-box',
        }} />
      {onAttach && (
        <button onClick={onAttach} aria-label="Attach a chart screenshot" disabled={shots.length >= MAX_ATTACH}
          title={shots.length >= MAX_ATTACH ? `Up to ${MAX_ATTACH} images per message` : 'Attach a chart screenshot for Pointer to analyze'}
          style={{ width: 38, height: 38, borderRadius: 11, border: 'none', cursor: shots.length >= MAX_ATTACH ? 'default' : 'pointer', background: shots.length ? 'var(--glow)' : 'var(--chip)', color: shots.length ? 'var(--accent)' : 'var(--muted)', opacity: shots.length >= MAX_ATTACH ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
          <Icon name="image" size={18} />
        </button>
      )}
      {onToggleDeep && (
        <button onClick={onToggleDeep} aria-pressed={!!deep} aria-label="Deep research"
          title={deep ? 'Deep research: on — uses the most capable model' : 'Deep research: off'}
          style={{ width: 38, height: 38, borderRadius: 11, border: 'none', cursor: 'pointer', background: deep ? 'var(--accent)' : 'var(--chip)', color: deep ? 'var(--on-accent)' : 'var(--muted)', boxShadow: deep ? '0 0 0 2px var(--glow)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
          <Icon name="compass" size={18} />
        </button>
      )}
      {busy ? (
        <button onClick={onStop} aria-label="Stop generating" title="Stop generating"
          style={{ width: 38, height: 38, borderRadius: 11, border: 'none', cursor: 'pointer', background: 'var(--down-bg)', color: 'var(--down)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'currentColor', display: 'block' }} />
        </button>
      ) : (
        <button onClick={onSend} aria-label="Send" title="Send (Ctrl+Enter) — Enter starts a new line" style={{ width: 38, height: 38, borderRadius: 11, border: 'none', cursor: 'pointer', background: hasContent ? 'var(--accent)' : 'var(--chip)', color: hasContent ? 'var(--on-accent)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
          <Icon name={compact ? 'send' : 'arrowUR'} size={18} />
        </button>
      )}
      </div>
    </div>
  );
}

// ─── Home / Landing (variants) ───
function PointerHome({ go, layout, openChat, user }) {
  const FX = window.FX;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const movers = (FX.tokens || []).filter(t => Math.abs(t.ch24) > 3).sort((a, b) => b.ch24 - a.ch24);
  // Real portfolio value from the self-custody wallet engine.
  const wstate = (window.FXWallet && window.FXWallet.ready() && window.FXWallet.state()) || null;
  const portfolioTotal = wstate ? wstate.total : 0;
  const portfolioToday = wstate ? wstate.holdings.reduce((a, h) => a + h.value * (h.ch24 / 100), 0) : 0;
  const portfolioPct = portfolioTotal ? (portfolioToday / (portfolioTotal - portfolioToday || portfolioTotal)) * 100 : 0;

  const Suggest = () => (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -16px', padding: '0 16px', scrollbarWidth: 'none' }}>
      {FX.suggestions.map((s, i) => (
        <button key={i} onClick={() => openChat(s)} style={{ flexShrink: 0, textAlign: 'left', maxWidth: 200, background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--line)', borderRadius: 13, padding: '11px 13px', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', lineHeight: 1.35 }}>
          <Icon name="spark" size={14} color="var(--accent)" style={{ marginBottom: 5 }} />
          <div>{s}</div>
        </button>
      ))}
    </div>
  );

  const Hero = () => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 600 }}>{greet}, {user}</div>
      <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.6, marginTop: 2, lineHeight: 1.12 }}>
        What are we trading<br />today?
      </div>
    </div>
  );

  return (
    <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* HUB layout: portfolio + quick grid first */}
      {layout === 'hub' && <>
        <Hero />
        <Card pad={16} style={{ background: 'linear-gradient(135deg, var(--surface) 60%, var(--glow))' }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>Portfolio value</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 3 }}>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(portfolioTotal)}</div>
            {portfolioTotal > 0 && <Change v={portfolioPct} size={14} />}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Btn size="sm" icon="zap" onClick={() => go('trade')} style={{ flex: 1 }}>Trade</Btn>
            <Btn size="sm" kind="soft" icon="scan" onClick={() => go('scanner')} style={{ flex: 1 }}>Scan gems</Btn>
            <Btn size="sm" kind="soft" icon="briefcase" onClick={() => go('portfolio')} style={{ flex: 1 }}>Portfolio</Btn>
          </div>
        </Card>
        <div>
          <SecHead>Ask Pointer</SecHead>
          <div style={{ height: 10 }} />
          <AIBar value="" onChange={() => {}} onFocus={() => openChat()} onSend={() => openChat()} />
          <div style={{ height: 12 }} />
          <Suggest />
        </div>
      </>}

      {/* AGENT layout: chat-forward */}
      {layout === 'agent' && <>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: 14 }}>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <div style={{ width: 76, height: 76, borderRadius: 24, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 40px var(--glow)' }}>
              <Icon name="spark" size={38} color="var(--on-accent)" />
            </div>
            <div style={{ position: 'absolute', bottom: -3, right: -3, background: 'var(--up)', borderRadius: '50%', width: 20, height: 20, border: '3px solid var(--bg)' }} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>Pointer</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4, maxWidth: 280, lineHeight: 1.4 }}>
            Your AI command center. Research, trade, automate — 19 tools, always on.
          </div>
        </div>
        <Suggest />
        <AIBar value="" onChange={() => {}} onFocus={() => openChat()} onSend={() => openChat()} />
        {(() => {
          // Real recent signals from the user's feed (no prototype activity log).
          const recent = (window.FX.signals || []).filter((s) => s.live).slice(0, 3);
          if (!recent.length) return null;
          return (
            <div>
              <SecHead action="View all" onAction={() => go('signals')}>Recent signals</SecHead>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {recent.map((s, i) => (
                  <Card key={i} pad={13} onClick={() => go('signals')} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: s.dir === 'LONG' ? 'var(--up-bg)' : 'var(--down-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.dir === 'LONG' ? 'var(--up)' : 'var(--down)' }}><Icon name={s.dir === 'LONG' ? 'trend' : 'arrowDR'} size={17} /></div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.dir} {s.pair} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {s.conf}% · {s.tf}</span></div>
                    <Icon name="chevR" size={16} color="var(--faint)" />
                  </Card>
                ))}
              </div>
            </div>
          );
        })()}
      </>}

      {/* FEED layout: market brief + movers */}
      {layout === 'feed' && <>
        <Hero />
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="spark" size={18} color="var(--on-accent)" /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>Market snapshot</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Live · top 100 by market cap</div>
            </div>
          </div>
          <div style={{ padding: '13px 16px', fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5 }}>
            {movers.length ? (() => {
              const g = movers[0], l = movers[movers.length - 1];
              return <>{g.sym} leads at <span style={{ color: g.ch24 >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>{pct(g.ch24)}</span>{l && l !== g && l.ch24 < 0 ? <>, while {l.sym} is down <span style={{ color: 'var(--down)', fontWeight: 700 }}>{pct(l.ch24)}</span></> : ''}. {movers.length} coins moving more than 3% in the last 24h. Ask Pointer to find a setup or scan for gems.</>;
            })() : 'Loading live market data… ask Pointer to scan for gems or build a trade setup.'}
          </div>
          <button onClick={() => openChat()} style={{ width: '100%', padding: '12px', background: 'var(--surface2)', border: 'none', borderTop: '1px solid var(--line)', color: 'var(--accent)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            Discuss with Pointer <Icon name="arrowUR" size={15} />
          </button>
        </Card>
        <AIBar value="" onChange={() => {}} onFocus={() => openChat()} onSend={() => openChat()} />
        <div>
          <SecHead action="Markets" onAction={() => go('markets')}>Top movers</SecHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
            {movers.slice(0, 4).map(t => (
              <div key={t.id} onClick={() => go('token', { token: t })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', cursor: 'pointer' }}>
                <Logo color={t.logo} sym={t.sym} chain={t.chain} img={t.img} address={t.address || t.tokenAddress} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t.sym}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                </div>
                <Sparkline data={t.spark} up={t.ch24 >= 0} w={56} h={24} />
                <div style={{ textAlign: 'right', minWidth: 78 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.price)}</div>
                  <Change v={t.ch24} size={12} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </>}
    </div>
  );
}

// ─── Full chat (with saved sessions) ───
const POINTER_GREETING = { role: 'ai', text: 'Hey — I’m Pointer, your crypto trading copilot. I live and breathe markets, tokens and on-chain data: I can scan gems, analyze any coin, build trade setups and execute with your approval. You can also send me a screenshot of a chart and I’ll read it, then check it against live data. What do you want to look at?' };
function chatAgo(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function PointerChat({ go, seed, style, onProposalTrade }) {
  const [msgs, setMsgs] = uS([POINTER_GREETING]);
  const [input, setInput] = uS(seed || '');
  const [typing, setTyping] = uS(false);
  const [deep, setDeep] = uS(false);           // deep-research: use the admin model's top tier
  const deepRef = uR(false);                    // latest deep flag for send() closures
  uE(() => { deepRef.current = deep; }, [deep]);
  // Chat model. Paid plans may switch between DeepSeek and ChatGPT; free plans
  // get DeepSeek and no picker. This is only ever a REQUEST — the server decides
  // from the stored plan, so nothing here can unlock a model the plan lacks.
  const [model, setModel] = uS(null);           // 'deepseek' | 'openai' | null (= server default)
  const modelRef = uR(null);
  uE(() => { modelRef.current = model; }, [model]);
  const [chatId, setChatId] = uS(null);        // null = unsaved new chat
  const [sheetOpen, setSheetOpen] = uS(false);
  const [sessions, setSessions] = uS([]);
  const scroller = uR(null);
  const history = uR([]); // [{ role, content }] sent to the backend
  const played = uR(false);
  const saveT = uR(null);
  const streamT = uR(null);   // typewriter interval handle
  const streaming = uR(false); // true while a reply is being typed out
  const genRef = uR(0);        // generation counter — bumping it discards in-flight replies
  const [genBusy, setGenBusy] = uS(false); // true from send until the reply is fully shown (drives the Stop button)
  const [usage, setUsage] = uS(null); // { remaining, quota, credits, resetsAt, pack }
  // Chart screenshots staged in the composer: [{ id, dataUrl, name }].
  const [attach, setAttach] = uS([]);
  const [attachErr, setAttachErr] = uS('');
  const fileRef = uR(null);

  const pickImages = () => { if (fileRef.current) fileRef.current.click(); };
  const onFiles = async (e) => {
    const files = Array.from((e.target && e.target.files) || []);
    e.target.value = ''; // let the same file be re-picked after a remove
    if (!files.length) return;
    setAttachErr('');
    const room = MAX_ATTACH - attach.length;
    if (room <= 0) { setAttachErr(`Up to ${MAX_ATTACH} images per message.`); return; }
    if (files.length > room) setAttachErr(`Only the first ${room} image${room === 1 ? '' : 's'} were added — ${MAX_ATTACH} per message.`);
    const added = [];
    for (const f of files.slice(0, room)) {
      if (!f.type || f.type.indexOf('image/') !== 0) { setAttachErr('Only image files can be attached.'); continue; }
      try { added.push({ id: Math.random().toString(36).slice(2), dataUrl: await compressImage(f), name: f.name || 'chart' }); }
      catch (err) { setAttachErr((err && err.message) || 'Could not read that image.'); }
    }
    if (added.length) setAttach((a) => [...a, ...added].slice(0, MAX_ATTACH));
  };
  const removeAttach = (id) => setAttach((a) => a.filter((x) => x.id !== id));

  // Stop generation: discard a reply still in flight (network phase), or freeze
  // the typewriter where it is (keeping the partial text as the reply — the
  // backend history is patched to match what's on screen).
  const stopGen = () => {
    genRef.current++;
    if (streaming.current) {
      // Don't clear the interval here — flipping the flag lets the typewriter
      // tick see it, self-terminate and resolve streamReply's promise.
      streaming.current = false;
      setMsgs(m => {
        const n = m.slice();
        for (let j = n.length - 1; j >= 0; j--) {
          if (n[j].role === 'ai' && n[j].streaming) {
            const h = history.current;
            if (h.length && h[h.length - 1].role === 'assistant') h[h.length - 1] = { role: 'assistant', content: n[j].text };
            n[j] = { ...n[j], streaming: false };
            break;
          }
        }
        return n;
      });
    }
    setTyping(false);
    setGenBusy(false);
  };

  // Load the Pointer usage snapshot (quota pill / out-of-requests paywall).
  uE(() => {
    let alive = true;
    if (window.FXAPI && window.FXAPI.getPointerUsage) window.FXAPI.getPointerUsage().then((u) => {
      if (!alive || !u) return;
      setUsage(u);
      // Seed the picker from whatever the server says this plan defaults to.
      if (u.models && u.models.current) setModel((m) => m || u.models.current);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  uE(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [msgs, typing]);
  // Stop any in-flight typewriter when the chat unmounts.
  uE(() => () => clearInterval(streamT.current), []);

  // Reveal an AI reply one keystroke at a time (typewriter effect). Resolves
  // once the full text is on screen so the caller can append any proposal after.
  function streamReply(full, token, sources, images) {
    return new Promise((resolve) => {
      const text = String(full == null ? '' : full);
      const src = (sources && sources.length) ? sources : null;
      // Attached up front, not after the typewriter finishes: the graphic is the
      // payoff, so it appears immediately and the commentary types in beneath it.
      const imgs = (images && images.length) ? images : null;
      streaming.current = true;
      setTyping(false); // swap the "thinking" dots for live text
      setMsgs(m => [...m, { role: 'ai', text: '', token, sources: src, images: imgs, streaming: true }]);
      if (!text) { streaming.current = false; resolve(); return; }
      let i = 0;
      // Scale the stride so long replies still finish in a few seconds while
      // short ones keep a natural per-character cadence.
      const step = Math.max(1, Math.round(text.length / 220));
      clearInterval(streamT.current);
      streamT.current = setInterval(() => {
        if (!streaming.current) { clearInterval(streamT.current); resolve(); return } // stopped externally
        i += step;
        const done = i >= text.length;
        setMsgs(m => {
          const n = m.slice();
          for (let j = n.length - 1; j >= 0; j--) {
            if (n[j].role === 'ai' && n[j].streaming) {
              n[j] = { ...n[j], text: done ? text : text.slice(0, i), streaming: !done };
              break;
            }
          }
          return n;
        });
        if (done) { clearInterval(streamT.current); streaming.current = false; resolve(); }
      }, 18);
    });
  }

  // Auto-save the session (debounced) once it has real content — creating the
  // doc on the first user message and titling it from that message.
  uE(() => {
    if (typing || streaming.current || !msgs.some((m) => m.role === 'user')) return;
    clearTimeout(saveT.current);
    saveT.current = setTimeout(async () => {
      const title = (msgs.find((m) => m.role === 'user') || {}).text || 'New chat';
      const id = await window.FXChats.save(chatId, { title, messages: msgs });
      if (id && id !== chatId) setChatId(id);
    }, 450);
    return () => clearTimeout(saveT.current);
  }, [msgs, typing]);

  // Real Pointer AI call → europe-west1 chatPointer (DeepSeek / ChatGPT switchable).
  // Every await checks the generation counter so Stop (which bumps it) cleanly
  // discards a reply that arrives after the user cancelled.
  async function send(t) {
    const text = String((typeof t === 'string' ? t : '') || input).trim();
    // An attached chart is a complete request on its own — Pointer is told to
    // give its read when a message arrives with images and no question.
    const shots = attach.slice();
    if ((!text && !shots.length) || typing || streaming.current) return;
    const gen = ++genRef.current;
    setInput('');
    setAttach([]); setAttachErr('');
    // `preview` is the local downscaled copy, shown immediately; `url` is filled
    // in from the server's Storage upload so the saved session keeps the image.
    const shown = shots.length ? shots.map((s) => ({ url: '', preview: s.dataUrl, prompt: s.name || 'Attached chart' })) : null;
    setMsgs(m => [...m, { role: 'user', text, images: shown }]);
    setTyping(true);
    setGenBusy(true);
    const hist = history.current.slice();
    history.current.push({ role: 'user', content: text });
    const isDeep = deepRef.current;
    try {
      const res = await window.FXAPI.chatPointer(text, hist, { deep: isDeep, provider: modelRef.current, images: shots });
      if (genRef.current !== gen) return; // stopped while waiting — drop the reply
      const reply = res.text || res.reply || '…';
      // Fold the chart transcription into our own copy of the history (the
      // client owns context, not the server), so a follow-up question about the
      // same chart still has its figures without re-uploading the image.
      if (res.imageNote) {
        const h = history.current;
        for (let j = h.length - 1; j >= 0; j--) {
          if (h[j].role === 'user') { h[j] = { role: 'user', content: text + res.imageNote }; break; }
        }
      }
      // Swap in the persistable Storage URLs, keeping the local preview on
      // screen so the thumbnail doesn't blink through a re-fetch.
      if (shots.length && Array.isArray(res.attachments) && res.attachments.length) {
        setMsgs(m => {
          const n = m.slice();
          for (let j = n.length - 1; j >= 0; j--) {
            if (n[j].role === 'user' && n[j].images) {
              n[j] = { ...n[j], images: n[j].images.map((im, k) => (res.attachments[k] && res.attachments[k].url ? { ...im, url: res.attachments[k].url } : im)) };
              break;
            }
          }
          return n;
        });
      }
      history.current.push({ role: 'assistant', content: reply });
      if (res.usage) setUsage((u) => ({ ...(u || {}), ...res.usage }));
      await streamReply(reply, res.proposal ? (res.proposal.tokenSymbol || res.proposal.tokenAddress) : undefined, res.sources, res.images);
      if (genRef.current !== gen) return; // stopped mid-typewriter — partial kept by stopGen
      if (res.proposal) setMsgs(m => [...m, { role: 'proposal', proposal: res.proposal }]);
    } catch (e) {
      if (genRef.current !== gen) return; // stopped — swallow the late error
      // Out of Pointer requests → show a buy-credits paywall card instead of an error.
      const details = (e && e.details) || {};
      const isQuota = details.code === 'quota_exhausted' || String((e && e.code) || '').includes('resource-exhausted');
      if (isQuota) {
        if (details.quota != null) setUsage((u) => ({ ...(u || {}), remaining: 0, quota: details.quota, credits: details.credits ?? (u && u.credits) ?? 0, resetsAt: details.resetsAt, pack: details.pack || (u && u.pack) }));
        setMsgs(m => [...m, { role: 'quota', info: details, restore: text }]);
      } else {
        setMsgs(m => [...m, { role: 'ai', text: '⚠️ ' + ((e && e.message) || 'Pointer is unavailable. Make sure you are signed in and try again.') }]);
      }
    } finally {
      if (genRef.current === gen) { setTyping(false); setGenBusy(false); }
    }
  }

  // Edit a previously sent prompt: stop any generation, drop that message and
  // everything after it (screen + backend context), and load the text back into
  // the composer for editing.
  const editMsg = (i) => {
    const target = msgs[i];
    if (!target || target.role !== 'user') return;
    stopGen();
    const kept = msgs.slice(0, i);
    history.current = kept.filter((x) => x.role === 'user' || x.role === 'ai').map((x) => ({ role: x.role === 'ai' ? 'assistant' : 'user', content: x.text }));
    setMsgs(kept.length ? kept : [POINTER_GREETING]);
    setInput(target.text);
  };

  uE(() => { if (seed && !played.current) { played.current = true; setInput(''); send(seed); } /* eslint-disable-next-line */ }, []);

  // ── Session controls ──
  const newChat = () => {
    clearTimeout(saveT.current);
    genRef.current++; // discard any in-flight reply so it can't land in the fresh chat
    clearInterval(streamT.current); streaming.current = false;
    setTyping(false); setGenBusy(false);
    setMsgs([POINTER_GREETING]); history.current = []; setChatId(null); setInput(''); played.current = true; setSheetOpen(false);
  };
  const openSessions = async () => { setSheetOpen(true); try { setSessions(await window.FXChats.list()); } catch (e) {} };
  // Deep link from a watch-task push (?goto=chat&session=…) → open that session.
  uE(() => {
    const sid = window.__fxOpenSession;
    if (sid) { window.__fxOpenSession = null; switchTo(sid); }
  }, []);
  const switchTo = async (id) => {
    const s = await window.FXChats.load(id);
    setSheetOpen(false);
    genRef.current++; // discard any in-flight reply from the previous session
    clearInterval(streamT.current); streaming.current = false;
    setTyping(false); setGenBusy(false);
    if (!s) return;
    const loaded = (s.messages && s.messages.length) ? s.messages : [POINTER_GREETING];
    setMsgs(loaded);
    // Rebuild the backend context from the saved turns (proposals are display-only).
    history.current = loaded.filter((m) => m.role === 'user' || m.role === 'ai').map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
    setChatId(id); played.current = true;
  };
  const delSession = async (e, id) => {
    e.stopPropagation();
    await window.FXChats.remove(id);
    setSessions((ss) => ss.filter((x) => x.id !== id));
    if (id === chatId) newChat();
  };
  const curTitle = (msgs.find((m) => m.role === 'user') || {}).text || 'New chat';
  const sbBtn = { width: 34, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--surface2)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* session bar: current chat title + history + new chat */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 16px 8px' }}>
        <Icon name="message" size={15} color="var(--muted)" />
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{curTitle}</div>
        {usage && (() => {
          const rem = usage.remaining != null ? usage.remaining : 0;
          const low = rem <= 3;
          return (
            <button aria-label="Pointer requests remaining" title={`${rem} Pointer requests left${usage.credits ? ' · ' + usage.credits + ' credits' : ''} · tap to upgrade`}
              onClick={() => go && go('paywall')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 800, padding: '6px 9px', borderRadius: 9, border: 'none', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit', background: low ? 'var(--down-bg)' : 'var(--surface2)', color: low ? 'var(--down)' : 'var(--muted)' }}>
              <Icon name="zap" size={12} /> {rem}
            </button>
          );
        })()}
        {/* Model picker — renders itself only for plans with a real choice (paid). */}
        {usage && usage.models && (
          <ModelPicker
            allowed={usage.models.allowed}
            value={model || usage.models.current}
            onChange={setModel}
            disabled={genBusy}
          />
        )}
        <button aria-label="Chat history" onClick={openSessions} style={sbBtn}><Icon name="history" size={18} /></button>
        <button aria-label="New chat" onClick={newChat} style={{ ...sbBtn, background: 'var(--accent)', color: 'var(--on-accent)' }}><Icon name="plus" size={18} /></button>
      </div>
      <div ref={scroller} style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {msgs.map((m, i) => <Msg key={i} m={m} style={style} go={go} onTrade={onProposalTrade} onEdit={m.role === 'user' ? () => editMsg(i) : undefined} />)}
        {typing && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
          <div style={{ width: 26, height: 26, borderRadius: 9, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={deep ? 'compass' : 'spark'} size={15} color="var(--on-accent)" /></div>
          {deep ? <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--accent)' }}>Researching deeply <TypingDots /></span> : <TypingDots />}
          <SlowHint text="still working — research and graphics can take up to a minute" />
        </div>}
      </div>
      {deep && <div style={{ padding: '0 16px 6px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
        <Icon name="compass" size={13} /> Deep research on — replies use the most capable model and may take longer.
      </div>}
      <div style={{ padding: '8px 16px 10px', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={onFiles}
          style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
        <AIBar compact value={input} onChange={setInput} onSend={() => send()} deep={deep} onToggleDeep={() => setDeep(d => !d)}
          busy={genBusy} onStop={stopGen}
          attachments={attach} onAttach={pickImages} onRemoveAttach={removeAttach} />
        {attachErr && <div style={{ fontSize: 11.5, color: 'var(--down)', marginTop: 6, paddingLeft: 2 }}>{attachErr}</div>}
        <div style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--faint)', marginTop: 6, lineHeight: 1.4 }}>
          Pointer can make mistakes — verify important info before acting on it. Not financial advice.
        </div>
      </div>
      {/* saved sessions sheet */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Your chats">
        <button onClick={newChat} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--glow)', color: 'var(--accent)', border: 'none', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 14, marginBottom: 10 }}>
          <Icon name="plus" size={18} /> New chat
        </button>
        {sessions.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '18px 0' }}>No saved chats yet — start typing to create one.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingBottom: 6 }}>
          {sessions.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: s.id === chatId ? 'var(--glow)' : 'var(--surface)', borderRadius: 12, boxShadow: s.id === chatId ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)' }}>
              <button onClick={() => switchTo(s.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '11px 13px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{chatAgo(s.updatedAt)}{s.preview ? ' · ' + s.preview : ''}</div>
              </button>
              <button aria-label="Delete chat" onClick={(e) => delSession(e, s.id)} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 6 }}><Icon name="x" size={16} /></button>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function TypingDots() {
  return <div style={{ display: 'flex', gap: 4 }}>
    {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--muted)', animation: `fxdot 1s ${i * 0.15}s infinite ease-in-out` }} />)}
  </div>;
}

// Chat model picker for paid plans: a bot-head button that opens a menu.
//
// The providers are presented as "Model 1" / "Model 2" rather than by vendor —
// the user picks a capability tier, not a supplier, and that keeps the UI stable
// if a slot is ever repointed at a different provider. The wire values stay the
// real provider ids, because that is what the server's entitlement check reads.
const MODEL_ORDER = ['deepseek', 'openai'];
const MODEL_LABEL = { deepseek: 'Model 1', openai: 'Model 2' };
const MODEL_HINT  = { deepseek: 'Fast, everyday analysis', openai: 'Stronger reasoning, images & web research' };

function ModelPicker({ allowed, value, onChange, disabled }) {
  const [open, setOpen] = uS(false);
  const wrap = uR(null);
  // Dismiss on outside click or Escape — a menu that can only be closed by
  // picking something is a trap on touch screens.
  uE(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const options = MODEL_ORDER.filter((p) => (allowed || []).includes(p));
  if (options.length < 2) return null; // nothing to choose from → no control at all
  const cur = options.includes(value) ? value : options[0];

  return (
    <div ref={wrap} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu" aria-expanded={open}
        aria-label={`AI model: ${MODEL_LABEL[cur]}. Change model`}
        title={`AI model — ${MODEL_LABEL[cur]}`}
        style={{
          width: 34, height: 34, borderRadius: 10, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: disabled ? 'default' : 'pointer', flexShrink: 0, fontFamily: 'inherit', opacity: disabled ? 0.5 : 1,
          background: open ? 'var(--accent)' : 'var(--surface2)', color: open ? 'var(--on-accent)' : 'var(--text)',
        }}>
        <Icon name="robot" size={18} />
      </button>
      {open && (
        <div role="menu" aria-label="Choose AI model"
          style={{
            position: 'absolute', top: 40, right: 0, zIndex: 40, minWidth: 210,
            background: 'var(--surface)', borderRadius: 12, padding: 5,
            boxShadow: '0 10px 30px rgba(0,0,0,.35), inset 0 0 0 1px var(--line)',
          }}>
          {options.map((p) => {
            const active = p === cur;
            return (
              <button key={p} role="menuitemradio" aria-checked={active}
                onClick={() => { onChange(p); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                  padding: '9px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: active ? 'var(--surface2)' : 'transparent', color: 'var(--text)',
                }}>
                <Icon name="robot" size={15} color={active ? 'var(--accent)' : 'var(--muted)'} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{MODEL_LABEL[p]}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{MODEL_HINT[p]}</span>
                </span>
                {active && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Long waits became normal once Pointer could draw: generating an infographic
// adds ~30-60s on top of its data gathering. A minute of silent bouncing dots
// reads as a hang, so say something once the wait stops looking routine.
function SlowHint({ afterMs = 15000, text }) {
  const [show, setShow] = uS(false);
  uE(() => {
    setShow(false);
    const t = setTimeout(() => setShow(true), afterMs);
    return () => clearTimeout(t);
  }, [afterMs]);
  if (!show) return null;
  return <span style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.85 }}>{text}</span>;
}

// Copy-to-clipboard action for a chat message. Falls back to execCommand for
// non-secure contexts / older webviews, and flashes a "Copied" confirmation.
function CopyBtn({ text, onAccent }) {
  const [ok, setOk] = uS(false);
  const doneT = uR(null);
  uE(() => () => clearTimeout(doneT.current), []);
  const copy = async (e) => {
    e && e.stopPropagation();
    const val = String(text == null ? '' : text);
    if (!val) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(val);
      } else {
        const ta = document.createElement('textarea');
        ta.value = val; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      setOk(true);
      clearTimeout(doneT.current); doneT.current = setTimeout(() => setOk(false), 1400);
    } catch (_) { /* clipboard blocked — silently ignore */ }
  };
  const col = onAccent ? 'var(--on-accent)' : 'var(--muted)';
  return (
    <button onClick={copy} aria-label={ok ? 'Copied' : 'Copy message'} title="Copy"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: col, opacity: ok ? 1 : (onAccent ? 0.85 : 0.7), fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '2px 3px', transition: 'opacity .15s' }}>
      <Icon name={ok ? 'check' : 'copy'} size={13} />{ok ? 'Copied' : 'Copy'}
    </button>
  );
}

// Inline markdown: **bold**, *italic*, `code`.
function mdInline(t) {
  const nodes = []; const s = String(t); let last = 0, k = 0;
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g; let m;
  while ((m = re.exec(s))) {
    if (m.index > last) nodes.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) nodes.push(<b key={k++} style={{ color: 'var(--text)', fontWeight: 700 }}>{tok.slice(2, -2)}</b>);
    else if (tok.startsWith('`')) nodes.push(<code key={k++} style={{ background: 'var(--surface2)', padding: '1px 5px', borderRadius: 5, fontFamily: 'ui-monospace, monospace', fontSize: '0.92em', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{tok.slice(1, -1)}</code>);
    else nodes.push(<i key={k++}>{tok.slice(1, -1)}</i>);
    last = m.index + tok.length;
  }
  if (last < s.length) nodes.push(s.slice(last));
  return nodes;
}

// Block markdown → readable React: headings, bullet/numbered lists, paragraphs.
function mdRender(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = []; let lst = null;
  const flush = () => {
    if (!lst) return;
    // Ordered items carry their source number so the displayed ordinal always
    // matches the model's text — robust even if items end up split apart. (A
    // blank line between numbered items no longer restarts the count at 1.)
    const items = lst.items.map((it, i) => (
      <li key={i} value={lst.type === 'ol' ? it.num : undefined} style={{ marginBottom: 2 }}>{mdInline(it.text)}</li>
    ));
    out.push(lst.type === 'ol'
      ? <ol key={'l' + out.length} start={lst.items[0].num} style={{ margin: '4px 0 8px', paddingLeft: 20 }}>{items}</ol>
      : <ul key={'l' + out.length} style={{ margin: '4px 0 8px', paddingLeft: 18 }}>{items}</ul>);
    lst = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    // A blank line doesn't end a list on its own — keep it open so "loose"
    // lists (a blank line between items) stay a single, correctly-numbered list.
    if (!line.trim()) { if (!lst) flush(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    const ul = line.match(/^\s*(?:[-*•])\s+(.*)/);
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    if (h) { flush(); const lvl = h[1].length; out.push(<div key={'h' + out.length} style={{ fontWeight: 800, color: 'var(--text)', fontSize: lvl === 1 ? 16 : lvl === 2 ? 15 : 14.5, margin: out.length ? '9px 0 4px' : '0 0 4px' }}>{mdInline(h[2])}</div>); }
    else if (ul) { if (!lst || lst.type !== 'ul') { flush(); lst = { type: 'ul', items: [] }; } lst.items.push({ text: ul[1] }); }
    else if (ol) { if (!lst || lst.type !== 'ol') { flush(); lst = { type: 'ol', items: [] }; } lst.items.push({ num: parseInt(ol[1], 10), text: ol[2] }); }
    else { flush(); out.push(<div key={'p' + out.length} style={{ margin: '0 0 6px' }}>{mdInline(line)}</div>); }
  }
  flush();
  return out;
}

// Out-of-requests card shown when the Pointer quota is exhausted. Card
// payments were removed, so the CTA is a plan upgrade (crypto checkout).
function QuotaCard({ info, go }) {
  const reset = info.resetsAt ? new Date(info.resetsAt) : null;
  const resetStr = reset ? reset.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  return (
    <div style={{ display: 'flex', gap: 9, alignSelf: 'flex-start', maxWidth: '92%' }}>
      <div style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="zap" size={15} color="var(--on-accent)" /></div>
      <div style={{ background: 'var(--surface)', borderRadius: '16px 16px 16px 4px', boxShadow: 'inset 0 0 0 1.5px var(--accent)', padding: 14 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 4 }}>You're out of Pointer requests</div>
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 12 }}>
          You've used all {info.quota != null ? info.quota : ''} requests in your plan for this period{resetStr ? <> — they reset on <b style={{ color: 'var(--text)' }}>{resetStr}</b></> : ''}. Upgrade your plan for a bigger monthly allowance.
        </div>
        <Btn full icon="crown" onClick={() => go && go('paywall')}>Upgrade plan</Btn>
      </div>
    </div>
  );
}

function Msg({ m, style, go, onTrade, onEdit }) {
  if (!m) return null;
  if (m.role === 'proposal') return <TradeProposal proposal={m.proposal} go={go} onTrade={onTrade} style={style} />;
  if (m.role === 'quota') return <QuotaCard info={m.info || {}} go={go} />;
  const ai = m.role === 'ai';
  if (m.role === 'user') {
    return <div style={{ alignSelf: 'flex-end', maxWidth: '82%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      {m.images && m.images.length > 0 && <AttachedImages images={m.images} />}
      {/* An image-only message has no bubble — an empty accent pill under the
          thumbnail reads as a rendering bug. */}
      {m.text && <div style={{ background: 'var(--accent)', color: 'var(--on-accent)', padding: '10px 14px', borderRadius: '16px 16px 4px 16px', fontSize: 14.5, fontWeight: 500, lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{m.text}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {onEdit && m.text && (
          <button onClick={onEdit} aria-label="Edit this prompt" title="Edit — reloads this prompt into the composer and rewinds the chat to this point"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', opacity: 0.7, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '2px 3px', transition: 'opacity .15s' }}>
            <Icon name="edit" size={13} /> Edit
          </button>
        )}
        {m.text && <CopyBtn text={m.text} />}
      </div>
    </div>;
  }
  // AI message — style variants
  const body = (
    <div style={{ fontSize: 14.5, color: 'var(--text2)', lineHeight: 1.5, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
      {m.tool && <Pill tone="accent" style={{ marginBottom: 7 }}><Icon name="sliders" size={12} /> {m.tool}</Pill>}
      {/* Above the text so the graphic stays put while the commentary types in below it. */}
      {m.images && m.images.length > 0 && <ChatImages images={m.images} />}
      <div>{mdRender(m.text)}{m.streaming && <span style={{ display: 'inline-block', width: 2, height: '1em', marginLeft: 1, verticalAlign: '-0.15em', background: 'var(--accent)', animation: 'fxblink 1s step-end infinite' }} />}</div>
      {!m.streaming && m.token && <TokenInline sym={m.token} go={go} />}
      {!m.streaming && m.sources && m.sources.length > 0 && <SourceChips sources={m.sources} />}
      {!m.streaming && m.text && <div style={{ marginTop: 6, marginLeft: -3 }}><CopyBtn text={m.text} /></div>}
    </div>
  );
  if (style === 'compact') {
    return <div style={{ display: 'flex', gap: 9 }}>
      <div style={{ width: 5, alignSelf: 'stretch', borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
      {body}
    </div>;
  }
  if (style === 'cards') {
    return <Card pad={13} style={{ alignSelf: 'flex-start', maxWidth: '92%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
        <div style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="spark" size={13} color="var(--on-accent)" /></div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)' }}>Pointer</span>
      </div>
      {body}
    </Card>;
  }
  // bubbles (default)
  return <div style={{ display: 'flex', gap: 9, alignSelf: 'flex-start', maxWidth: '90%', minWidth: 0 }}>
    <div style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="spark" size={15} color="var(--on-accent)" /></div>
    <div style={{ background: 'var(--surface)', padding: '11px 14px', borderRadius: '16px 16px 16px 4px', boxShadow: 'inset 0 0 0 1px var(--line)', minWidth: 0 }}>{body}</div>
  </div>;
}

// Chart screenshots the USER attached, shown above their message bubble.
// Each item carries `preview` (the local downscaled copy, on screen instantly)
// and `url` (the Storage copy the backend saved, which is what survives a
// reload). Preview wins while both exist so the thumbnail never blinks; a
// session reopened from Firestore has only `url`.
function AttachedImages({ images }) {
  const safeSrc = (u) => {
    const s = String(u || '');
    // A reopened session's URL comes back from Firestore, so it gets the same
    // protocol check as any other link before it reaches an attribute. The
    // local preview is a data: URL we just built ourselves.
    if (s.startsWith('data:image/')) return s;
    try {
      const p = new URL(s).protocol;
      return (p === 'http:' || p === 'https:') ? s : null;
    } catch (_) { return null; }
  };
  const safe = (images || []).map((im) => ({ ...im, src: safeSrc(im.preview || im.url) })).filter((im) => im.src);
  if (!safe.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 4 }}>
      {safe.map((im, i) => {
        const thumb = (
          <img src={im.src} alt={im.prompt || 'Attached chart'} loading="lazy"
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
        );
        return (
          <div key={im.src.slice(0, 64) + i} style={{ width: 132, height: 92, borderRadius: 12, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--line)', background: 'var(--surface2)' }}>
            {/* Only the persisted copy is worth opening full size — a data: URL
                in a new tab is a multi-hundred-KB address bar entry. */}
            {im.url && im.url.startsWith('http')
              ? <a href={im.url} target="_blank" rel="noopener noreferrer" title="Open full size" style={{ display: 'block', width: '100%', height: '100%', lineHeight: 0 }}>{thumb}</a>
              : thumb}
          </div>
        );
      })}
    </div>
  );
}

// Infographics/charts Pointer generated with generate_image. The backend stores
// the PNG in Cloud Storage and returns a download-token URL, so what lands here
// is just a link — small enough to persist with the saved chat session.
function ChatImages({ images }) {
  // Same reasoning as SourceChips: only ever put http(s) in the DOM. These URLs
  // come from our own backend, but this is the second lock — if the shape of
  // that response ever changes, nothing exotic reaches an attribute.
  const safeSrc = (u) => {
    try {
      const p = new URL(String(u)).protocol;
      return (p === 'http:' || p === 'https:') ? String(u) : null;
    } catch (_) { return null; }
  };
  const safe = (images || []).map((im) => ({ ...im, url: safeSrc(im.url) })).filter((im) => im.url);
  if (!safe.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 9 }}>
      {safe.map((im, i) => <ChatImage key={im.url || i} im={im} />)}
    </div>
  );
}

function ChatImage({ im }) {
  const [state, setState] = uS('loading'); // loading → ok | error
  // The spec doubles as alt text — it literally describes what was drawn.
  const alt = (im.prompt || 'Pointer-generated crypto graphic').slice(0, 180);
  if (state === 'error') {
    return <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '10px 12px', borderRadius: 12, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
      This graphic could not be loaded. Ask Pointer to generate it again.
    </div>;
  }
  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--line)', background: 'var(--surface2)' }}>
      {state === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
          Loading graphic…
        </div>
      )}
      <a href={im.url} target="_blank" rel="noopener noreferrer" title="Open full size" style={{ display: 'block', lineHeight: 0 }}>
        <img
          src={im.url} alt={alt} loading="lazy"
          onLoad={() => setState('ok')} onError={() => setState('error')}
          style={{ display: 'block', width: '100%', height: 'auto', maxWidth: '100%', minHeight: state === 'loading' ? 180 : 0, cursor: 'zoom-in' }}
        />
      </a>
      {state === 'ok' && (
        <a href={im.url} download target="_blank" rel="noopener noreferrer" aria-label="Download graphic" title="Download"
          style={{ position: 'absolute', right: 8, bottom: 8, width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', color: '#fff', textDecoration: 'none', backdropFilter: 'blur(4px)' }}>
          <Icon name="download" size={14} color="#fff" />
        </a>
      )}
    </div>
  );
}

// Clickable, shortened reference links for sources Pointer consulted via
// web_search. Shows the publisher name (or domain) as a compact chip; the full
// article title is the hover tooltip, and the chip opens the article.
function SourceChips({ sources }) {
  const short = (s) => {
    let label = s.label || '';
    if (!label) { try { label = new URL(s.url).hostname.replace(/^www\./, ''); } catch (_) { label = 'source'; } }
    return label.length > 24 ? label.slice(0, 22) + '…' : label;
  };
  // These URLs originate in third-party feeds Pointer searched, and React does
  // NOT sanitize href — a `javascript:` link would run script in this origin,
  // where the wallet lives. The server filters them too; this is the second
  // lock, so a bad URL can never reach the DOM even if the server changes.
  const safeHref = (u) => {
    try {
      const p = new URL(String(u)).protocol;
      return (p === 'http:' || p === 'https:') ? String(u) : null;
    } catch (_) { return null; }
  };
  const safe = sources.map((s) => ({ ...s, url: safeHref(s.url) })).filter((s) => s.url);
  if (!safe.length) return null;
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Sources</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {safe.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.title || s.url}
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 170, background: 'var(--surface2)', color: 'var(--accent)', fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 8, textDecoration: 'none', border: '1px solid var(--line)' }}>
            <Icon name="link" size={11} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{short(s)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function TokenInline({ sym, go }) {
  // Resolve the symbol Pointer mentioned against real scanned gems / live tokens.
  const gem = (window.FX.gems || []).find(g => g.sym === sym);
  const t = gem || (window.FX.tokens || []).find(x => x.sym === sym);
  if (!t) return null;
  const tok = gem
    ? { sym: t.sym, name: t.name || t.sym, chain: t.chain, price: t.price || 0, ch24: t.ch || 0, mcap: String(t.mcap || '—').replace(/^\$/, ''), vol: String(t.vol || '—').replace(/^\$/, ''), liq: String(t.liq || '—').replace(/^\$/, ''), holders: t.holders || '—', logo: t.logo || '#7B61FF', img: t.img || null, address: t.address, tokenAddress: t.address, dexUrl: t.dexUrl || null, spark: [] }
    : t;
  return (
    <div onClick={() => go('token', { token: tok })} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, background: 'var(--surface2)', borderRadius: 12, padding: 10, cursor: 'pointer' }}>
      <Logo color={tok.logo} sym={sym} chain={t.chain} img={tok.img} address={tok.address} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>${sym}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gem ? <>${tok.mcap} mcap · score {t.score || '—'}</> : <>{fmtUsd(tok.price)} · {tok.name}</>}</div>
      </div>
      {gem && (t.safe ? <Pill tone="up"><Icon name="shield" size={12} /> Safe</Pill> : <Pill tone="down"><Icon name="alert" size={12} /> Risky</Pill>)}
    </div>
  );
}

// Renders the REAL gated trade proposal returned by the Pointer backend and
// executes it on approval via the live executeTrade Cloud Function.
const PROP_CHAIN = { sol: 'Solana', eth: 'Ethereum', bsc: 'BNB Chain', base: 'Base', poly: 'Polygon', arb: 'Arbitrum' };
const PROP_DEX = { sol: 'Jupiter', eth: 'Uniswap', bsc: 'PancakeSwap', base: 'Aerodrome', poly: 'QuickSwap', arb: 'Camelot' };
const PROP_NATIVE = { sol: 'SOL', eth: 'ETH', bsc: 'BNB', base: 'ETH', poly: 'POL', arb: 'ETH' };
function TradeProposal({ proposal, go, onTrade, style }) {
  const [done, setDone] = uS(null);     // null | 'app' | 'rej'
  const [busy, setBusy] = uS(false);
  const [result, setResult] = uS('');
  const [err, setErr] = uS('');
  const p = proposal || {};
  const chain = p.chain || 'sol';
  const isBuy = (p.action || 'buy') === 'buy';
  const sym = p.tokenSymbol || (p.tokenAddress ? p.tokenAddress.slice(0, 4) + '…' : '—');
  const size = isBuy ? `${p.amount ?? '—'} ${PROP_NATIVE[chain] || ''}` : `${p.percent ?? '—'}%`;
  const slip = p.slippage != null ? p.slippage + '%' : '10%';
  const colorFor = (s) => { let h = 0; const x = String(s || ''); for (let i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) >>> 0; return '#' + [(80 + (h & 0x7f)), (80 + ((h >> 8) & 0x7f)), (80 + ((h >> 16) & 0x7f))].map(v => v.toString(16).padStart(2, '0')).join(''); };

  const approve = async () => {
    if (busy) return;
    setErr('');
    if (!p.tokenAddress || !window.FXAPI) { setErr('This proposal can’t be executed — open the token to trade manually.'); return; }
    setBusy(true);
    try {
      const res = await window.FXAPI.executeTrade({
        chain, tokenAddress: p.tokenAddress, action: p.action || 'buy',
        amount: isBuy ? String(p.amount) : undefined,
        percent: !isBuy ? p.percent : undefined,
        slippage: p.slippage ?? 10,
      });
      const tx = (res && (res.txHash || res.signature || res.hash)) || '';
      setResult(tx ? 'Filled · ' + tx.slice(0, 6) + '…' + tx.slice(-4) : 'Order submitted');
      setDone('app');
      onTrade && onTrade(res);
    } catch (e) {
      setErr((e && e.message) || 'Trade failed — check your DEX bot wallet is funded.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ alignSelf: 'flex-start', width: '94%' }}>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="spark" size={15} color="var(--on-accent)" /></div>
        <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 16, boxShadow: 'inset 0 0 0 1.5px var(--accent)', overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--line)' }}>
            <Icon name="zap" size={16} color="var(--accent)" />
            <div style={{ fontSize: 13.5, fontWeight: 800 }}>Trade proposal</div>
            <Pill tone="muted" style={{ marginLeft: 'auto' }}>Requires approval</Pill>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Logo color={colorFor(sym)} sym={sym} chain={chain} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{isBuy ? 'Buy' : 'Sell'} ${sym}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{PROP_DEX[chain] || 'DEX'} · {PROP_CHAIN[chain] || chain}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{size}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{isBuy ? 'spend' : 'of position'}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[['Action', (p.action || 'buy').toUpperCase()], ['Slippage', slip], ['Chain', (PROP_CHAIN[chain] || chain)], ['Contract', p.tokenAddress ? p.tokenAddress.slice(0, 5) + '…' + p.tokenAddress.slice(-4) : '—']].map(([k, v]) => (
                <div key={k} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '8px 10px', minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
                </div>
              ))}
            </div>
            {err && <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 10, padding: '9px 11px', fontWeight: 600 }}>{err}</div>}
            {done === null ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn kind="ghost" size="sm" full onClick={() => setDone('rej')} disabled={busy}>Reject</Btn>
                <Btn kind="up" size="sm" full icon={busy ? undefined : 'check'} onClick={approve} disabled={busy}>{busy ? 'Executing…' : 'Approve & ' + (isBuy ? 'buy' : 'sell')}</Btn>
              </div>
            ) : done === 'app' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: '10px', background: 'var(--up-bg)', borderRadius: 11, color: 'var(--up)', fontWeight: 700, fontSize: 14 }}>
                <Icon name="checkCircle" size={18} /> {result || 'Order submitted'}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: '10px', background: 'var(--chip)', borderRadius: 11, color: 'var(--muted)', fontWeight: 700, fontSize: 14 }}>
                <Icon name="xCircle" size={18} /> Proposal rejected
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PointerHome, PointerChat, AIBar });

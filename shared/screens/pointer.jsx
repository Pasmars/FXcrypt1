// pointer.jsx — Pointer AI: home/landing variants + full chat with gated trade proposals
const { useState: uS, useEffect: uE, useRef: uR } = React;

// ─── Shared: AI composer bar ───
// While `busy` (a reply is being generated or typed out) the send button turns
// into a Stop control that calls onStop — mirrors the ChatGPT/Claude pattern.
function AIBar({ onFocus, value, onChange, onSend, compact, deep, onToggleDeep, busy, onStop }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)',
      borderRadius: 16, padding: '8px 8px 8px 14px', boxShadow: 'inset 0 0 0 1px var(--line)',
    }}>
      <Icon name="spark" size={18} color="var(--accent)" />
      <input value={value} onChange={e => onChange && onChange(e.target.value)} onFocus={onFocus}
        onKeyDown={e => e.key === 'Enter' && !busy && onSend && onSend()}
        placeholder={compact ? 'Message Pointer…' : 'Ask Pointer anything…'}
        style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: 15, fontFamily: 'inherit' }} />
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
        <button onClick={onSend} aria-label="Send" style={{ width: 38, height: 38, borderRadius: 11, border: 'none', cursor: 'pointer', background: value ? 'var(--accent)' : 'var(--chip)', color: value ? 'var(--on-accent)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
          <Icon name={compact ? 'send' : 'arrowUR'} size={18} />
        </button>
      )}
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
const POINTER_GREETING = { role: 'ai', text: 'Hey — I’m Pointer. I can scan gems, analyze tokens, build trade setups and execute with your approval. What do you want to do?' };
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
    if (window.FXAPI && window.FXAPI.getPointerUsage) window.FXAPI.getPointerUsage().then((u) => { if (alive && u) setUsage(u); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  uE(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [msgs, typing]);
  // Stop any in-flight typewriter when the chat unmounts.
  uE(() => () => clearInterval(streamT.current), []);

  // Reveal an AI reply one keystroke at a time (typewriter effect). Resolves
  // once the full text is on screen so the caller can append any proposal after.
  function streamReply(full, token, sources) {
    return new Promise((resolve) => {
      const text = String(full == null ? '' : full);
      const src = (sources && sources.length) ? sources : null;
      streaming.current = true;
      setTyping(false); // swap the "thinking" dots for live text
      setMsgs(m => [...m, { role: 'ai', text: '', token, sources: src, streaming: true }]);
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
    if (!text || typing || streaming.current) return;
    const gen = ++genRef.current;
    setInput('');
    setMsgs(m => [...m, { role: 'user', text }]);
    setTyping(true);
    setGenBusy(true);
    const hist = history.current.slice();
    history.current.push({ role: 'user', content: text });
    const isDeep = deepRef.current;
    try {
      const res = await window.FXAPI.chatPointer(text, hist, { deep: isDeep });
      if (genRef.current !== gen) return; // stopped while waiting — drop the reply
      const reply = res.text || res.reply || '…';
      history.current.push({ role: 'assistant', content: reply });
      if (res.usage) setUsage((u) => ({ ...(u || {}), ...res.usage }));
      await streamReply(reply, res.proposal ? (res.proposal.tokenSymbol || res.proposal.tokenAddress) : undefined, res.sources);
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
        <button aria-label="Chat history" onClick={openSessions} style={sbBtn}><Icon name="history" size={18} /></button>
        <button aria-label="New chat" onClick={newChat} style={{ ...sbBtn, background: 'var(--accent)', color: 'var(--on-accent)' }}><Icon name="plus" size={18} /></button>
      </div>
      <div ref={scroller} style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {msgs.map((m, i) => <Msg key={i} m={m} style={style} go={go} onTrade={onProposalTrade} onEdit={m.role === 'user' ? () => editMsg(i) : undefined} />)}
        {typing && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
          <div style={{ width: 26, height: 26, borderRadius: 9, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={deep ? 'compass' : 'spark'} size={15} color="var(--on-accent)" /></div>
          {deep ? <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--accent)' }}>Researching deeply <TypingDots /></span> : <TypingDots />}
        </div>}
      </div>
      {deep && <div style={{ padding: '0 16px 6px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
        <Icon name="compass" size={13} /> Deep research on — replies use the most capable model and may take longer.
      </div>}
      <div style={{ padding: '8px 16px 10px', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
        <AIBar compact value={input} onChange={setInput} onSend={() => send()} deep={deep} onToggleDeep={() => setDeep(d => !d)}
          busy={genBusy} onStop={stopGen} />
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
      <div style={{ background: 'var(--accent)', color: 'var(--on-accent)', padding: '10px 14px', borderRadius: '16px 16px 4px 16px', fontSize: 14.5, fontWeight: 500, lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{m.text}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {onEdit && (
          <button onClick={onEdit} aria-label="Edit this prompt" title="Edit — reloads this prompt into the composer and rewinds the chat to this point"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', opacity: 0.7, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '2px 3px', transition: 'opacity .15s' }}>
            <Icon name="edit" size={13} /> Edit
          </button>
        )}
        <CopyBtn text={m.text} />
      </div>
    </div>;
  }
  // AI message — style variants
  const body = (
    <div style={{ fontSize: 14.5, color: 'var(--text2)', lineHeight: 1.5, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
      {m.tool && <Pill tone="accent" style={{ marginBottom: 7 }}><Icon name="sliders" size={12} /> {m.tool}</Pill>}
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

// Clickable, shortened reference links for sources Pointer consulted via
// web_search. Shows the publisher name (or domain) as a compact chip; the full
// article title is the hover tooltip, and the chip opens the article.
function SourceChips({ sources }) {
  const short = (s) => {
    let label = s.label || '';
    if (!label) { try { label = new URL(s.url).hostname.replace(/^www\./, ''); } catch (_) { label = 'source'; } }
    return label.length > 24 ? label.slice(0, 22) + '…' : label;
  };
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Sources</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sources.map((s, i) => (
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

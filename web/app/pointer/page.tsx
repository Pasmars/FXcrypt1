'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { TxModal, TxData } from '@/components/TxModal';
import { Chip } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { callChatPointer, callExecuteTrade } from '@/lib/functions';

type Provider = 'deepseek' | 'openai';
interface Proposal { chain: string; action: 'buy' | 'sell'; tokenAddress: string; tokenSymbol?: string; amount?: string; percent?: number; rationale?: string; }
interface Msg { role: 'user' | 'assistant'; content: string; proposal?: Proposal | null; status?: 'pending' | 'executed' | 'rejected'; }

const MODELS: { key: Provider; label: string; note: string }[] = [
  { key: 'deepseek', label: '🐬 DeepSeek', note: 'Open-source' },
  { key: 'openai', label: '⚡ ChatGPT', note: 'OpenAI' },
];
const EXPLORER: Record<string, string> = { bsc: 'https://bscscan.com/tx/', eth: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', sol: 'https://solscan.io/tx/' };
const NATIVE: Record<string, string> = { bsc: 'BNB', eth: 'ETH', base: 'ETH', sol: 'SOL' };

const SUGGESTIONS = [
  "What's my BSC balance?",
  'Scan SOL gems',
  'Bubble map for a token',
  'Find brett across chains',
  'Any arbitrage on BSC?',
  '4H signals on Bybit',
];

// ── lightweight markdown-ish renderer (bold, inline code, bullets, line breaks) ──
function renderInline(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) parts.push(<code key={k++} className="rounded bg-surface-3 px-1 py-0.5 text-[0.85em]">{t.slice(1, -1)}</code>);
    else { const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!; parts.push(<a key={k++} href={mm[2]} target="_blank" rel="noopener" className="text-brand underline">{mm[1]}</a>); }
    last = m.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split('\n').map((line, i) => {
        const bullet = /^\s*[-*]\s+/.test(line);
        const c = bullet ? line.replace(/^\s*[-*]\s+/, '') : line;
        if (!c.trim()) return <div key={i} className="h-1" />;
        return bullet
          ? <div key={i} className="flex gap-2"><span className="text-muted">•</span><span>{renderInline(c)}</span></div>
          : <div key={i}>{renderInline(c)}</div>;
      })}
    </div>
  );
}

export default function PointerPage() {
  const { user } = useAuth();
  const uid = user?.uid;
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<TxData | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const current = MODELS.find((m) => m.key === provider) || MODELS[0];

  useEffect(() => {
    if (!uid) return;
    getDoc(doc(db, 'users', uid)).then((s) => {
      const p = s.exists() ? (s.data().botSettings?.aiProvider) : null;
      if (p === 'openai' || p === 'deepseek') setProvider(p);
    }).catch(() => {});
  }, [uid]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);

  const switchModel = async (p: Provider) => {
    if (p === provider) return;
    setProvider(p);
    if (uid) setDoc(doc(db, 'users', uid), { botSettings: { aiProvider: p } }, { merge: true }).catch(() => {});
  };

  const send = async (text?: string) => {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;
    setInput('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: prompt }]);
    setBusy(true);
    try {
      const res: any = (await callChatPointer({ prompt, history, provider })).data;
      setMessages((m) => [...m, { role: 'assistant', content: res.text || '…', proposal: res.proposal || null, status: res.proposal ? 'pending' : undefined }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ ' + (e.message || 'Pointer error') }]);
    } finally { setBusy(false); }
  };

  const setStatus = (idx: number, status: Msg['status']) => setMessages((m) => m.map((x, i) => (i === idx ? { ...x, status } : x)));

  const approve = async (idx: number, p: Proposal) => {
    const native = NATIVE[p.chain] || p.chain.toUpperCase();
    const size = p.action === 'buy' ? `${p.amount} ${native}` : `${p.percent}%`;
    setTx({ id: Date.now(), steps: ['Preparing', 'Swapping', 'Confirming', 'Complete'], status: 'processing', title: 'Processing Trade', subtitle: 'Submitting…', tokenName: p.tokenSymbol || p.tokenAddress, tokenMeta: `${p.action.toUpperCase()} ${size} · ${p.chain.toUpperCase()}` });
    try {
      const res: any = (await callExecuteTrade({ chain: p.chain, tokenAddress: p.tokenAddress, action: p.action, amount: p.action === 'buy' ? String(p.amount) : undefined, percent: p.action === 'sell' ? p.percent : undefined, slippage: 10 })).data;
      const hash = res?.txHash || res?.signature || res?.hash;
      setStatus(idx, 'executed');
      setTx((t) => t && { ...t, status: 'success', title: 'Trade Confirmed!', subtitle: 'Submitted successfully.', result: { hash, explorer: EXPLORER[p.chain] } });
    } catch (e: any) {
      setTx((t) => t && { ...t, status: 'error', title: 'Trade Failed', result: { errorMsg: e.message || 'Trade failed' } });
    }
  };

  return (
    <AppShell title="Pointer">
      {/* Chat window */}
      <div ref={scrollRef} className="h-[60vh] overflow-y-auto rounded-2xl border border-border bg-surface/40 p-3 sm:p-4">
        {messages.length === 0 && !busy && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-on-accent shadow-glow">
              <Icon name="spark" size={28} />
            </div>
            <div className="text-base font-extrabold">Hi, I’m Pointer.</div>
            <p className="mb-4 mt-1 max-w-sm text-xs text-muted">Your research & ops assistant. I can scan gems, check balances & holders, run bubble maps, find signals and arbitrage, track tokens, and propose trades for your approval.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Chip key={s} onClick={() => send(s)}>{s}</Chip>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm font-medium text-on-accent">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-surface-3 px-3.5 py-2.5 text-sm">
                  <RichText text={m.content} />
                  {m.proposal && (
                    <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-brand">Trade proposal — approval required</div>
                      <div className="mt-1 text-sm font-semibold">{m.proposal.action.toUpperCase()} {m.proposal.tokenSymbol || ''} on {m.proposal.chain.toUpperCase()} · {m.proposal.action === 'buy' ? `${m.proposal.amount} ${NATIVE[m.proposal.chain] || ''}` : `${m.proposal.percent}%`}</div>
                      <div className="mt-0.5 break-all font-mono text-[10px] text-muted">{m.proposal.tokenAddress}</div>
                      {m.status === 'pending' ? (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => approve(i, m.proposal!)} className="btn-accent px-3 py-1.5 text-xs">✅ Approve</button>
                          <button onClick={() => setStatus(i, 'rejected')} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:text-foreground">❌ Reject</button>
                        </div>
                      ) : (
                        <div className={`mt-2 text-xs font-semibold ${m.status === 'executed' ? 'text-success' : 'text-danger'}`}>{m.status === 'executed' ? '✅ Approved & executed' : '❌ Rejected'}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-surface-3 px-4 py-3 text-sm text-muted">
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.2s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.1s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted" />
                <span className="ml-1 text-xs">Pointer is thinking…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prompt widget — model selector docked on the right */}
      <div className="mt-3 flex items-end gap-1.5 rounded-2xl border border-border bg-surface-2 p-1.5 transition focus-within:border-brand">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Ask Pointer anything… (Shift+Enter for newline)"
          className="max-h-32 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted"
        />

        {/* Model dropdown */}
        <div className="relative">
          {modelOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
              <div className="absolute bottom-full right-0 z-20 mb-2 w-52 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-card animate-fade-in">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted">AI model</div>
                {MODELS.map((m) => (
                  <button key={m.key} onClick={() => { switchModel(m.key); setModelOpen(false); }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-surface-3 ${provider === m.key ? 'bg-surface-3' : ''}`}>
                    <span className="text-xs"><span className="font-semibold">{m.label}</span> <span className="text-[10px] text-muted">· {m.note}</span></span>
                    {provider === m.key && <span className="text-brand">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" onClick={() => setModelOpen((o) => !o)} title="Switch AI model"
            className="mb-0.5 flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-semibold text-muted transition hover:bg-surface-3 hover:text-foreground">
            <span className="max-w-[90px] truncate">{current.label}</span>
            <span className={`text-[9px] transition-transform ${modelOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>
        </div>

        <button onClick={() => send()} disabled={busy || !input.trim()} className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-on-accent transition active:scale-95 disabled:opacity-40"><Icon name="chevU" size={20} stroke={2.6} /></button>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted">Pointer can access everything except your Wallet and the PnL Calculator. Trades always require your approval.</p>

      <TxModal tx={tx} onClose={() => setTx(null)} />
    </AppShell>
  );
}

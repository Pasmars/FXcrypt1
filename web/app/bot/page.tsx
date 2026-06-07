'use client';

import { useCallback, useEffect, useState } from 'react';
import Script from 'next/script';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { Button, Card, Input } from '@/components/ui';
import {
  callGetBalances, callExecuteTrade, callSaveBotWallet, callRemoveBotWallet,
  callGenerateTelegramCode, callGetBotInfo
} from '@/lib/functions';
import { importWallet } from '@/lib/wallet-crypto';
import { GemScanner } from '@/components/GemScanner';

const CHAINS = ['bsc', 'eth', 'sol', 'base'];
const EXPLORER: Record<string, string> = { bsc: 'https://bscscan.com/tx/', eth: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', sol: 'https://solscan.io/tx/' };
const short = (a = '') => (a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a);

export default function BotPage() {
  const { user } = useAuth();
  const uid = user?.uid;
  const [tab, setTab] = useState<'trade' | 'gems' | 'wallets' | 'telegram'>('trade');
  const [settings, setSettings] = useState<any>({});
  const [balances, setBalances] = useState<any>({});
  const [loadingBal, setLoadingBal] = useState(false);
  const [toast, setToast] = useState('');

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async () => {
    if (!uid) return;
    const snap = await getDoc(doc(db, 'users', uid));
    setSettings(snap.exists() ? snap.data().botSettings || {} : {});
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const refreshBalances = useCallback(async () => {
    setLoadingBal(true);
    try { setBalances(((await callGetBalances({})).data as any).balances || {}); } catch {} finally { setLoadingBal(false); }
  }, []);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  const enabled = !!settings.enabled;
  const toggleBot = async () => {
    await setDoc(doc(db, 'users', uid!), { botSettings: { enabled: !enabled } }, { merge: true });
    setSettings((s: any) => ({ ...s, enabled: !enabled }));
  };

  const fmtBal = (b: any) => {
    if (!b) return '—';
    if (b.error) return 'error';
    if (typeof b === 'string') return b;
    return [b.native, b.symbol].filter(Boolean).join(' ') || JSON.stringify(b).slice(0, 24);
  };

  return (
    <AppShell title="DEX Bot">
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js" strategy="afterInteractive" />

      {/* Status + toggle */}
      <Card className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${enabled ? 'bg-success shadow-[0_0_8px] shadow-success' : 'bg-muted'}`} />
            <div>
              <div className="font-semibold">Automated Bot</div>
              <div className="text-xs text-muted">{enabled ? 'Running — monitoring & executing' : 'Stopped'}</div>
            </div>
          </div>
          <button onClick={toggleBot} className={`relative h-7 w-12 rounded-full transition ${enabled ? 'bg-accent' : 'bg-border-2'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHAINS.map((c) => (
            <div key={c} className="rounded-xl bg-surface-3 p-3 text-center">
              <div className="text-[11px] uppercase text-muted">{c}</div>
              <div className="text-sm font-semibold">{loadingBal ? '…' : fmtBal(balances[c])}</div>
            </div>
          ))}
        </div>
        <button onClick={refreshBalances} className="mt-3 text-xs text-brand">⟳ Refresh balances</button>
      </Card>

      <div className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {([['trade', 'Trade'], ['gems', '💎 Gem Scanner'], ['wallets', 'Wallets'], ['telegram', 'Telegram']] as const).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === t ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-foreground'}`}>{l}</button>
        ))}
      </div>

      {tab === 'trade' && <TradeTab notify={notify} onDone={refreshBalances} />}
      {tab === 'gems' && <GemScanner uid={uid} settings={settings} reload={load} notify={notify} />}
      {tab === 'wallets' && uid && <WalletsTab uid={uid} settings={settings} reload={load} notify={notify} />}
      {tab === 'telegram' && <TelegramTab notify={notify} />}

      {toast && <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-surface-3 px-4 py-2.5 text-sm shadow-card md:bottom-8">{toast}</div>}
    </AppShell>
  );
}

function TradeTab({ notify, onDone }: any) {
  const [chain, setChain] = useState('bsc');
  const [token, setToken] = useState('');
  const [action, setAction] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('100');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

  const execute = async () => {
    if (!token.trim()) return notify('Enter a token address');
    setBusy(true); setResult(null);
    try {
      const res: any = (await callExecuteTrade({ chain, tokenAddress: token.trim(), action, amount: action === 'buy' ? amount : undefined, percent: action === 'sell' ? percent : undefined })).data;
      setResult({ ok: true, text: 'Trade executed', tx: res?.txHash || res?.signature || res?.hash });
      onDone();
    } catch (e: any) {
      setResult({ ok: false, text: e.message || 'Trade failed' });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="chain-pills no-scrollbar mb-4">
        {CHAINS.map((c) => <button key={c} className={`chain-pill ${c} ${chain === c ? 'active' : ''}`} onClick={() => setChain(c)}>{c.toUpperCase()}</button>)}
      </div>
      <div className="mb-4 flex overflow-hidden rounded-xl border border-border">
        <button onClick={() => setAction('buy')} className={`flex-1 py-2.5 text-sm font-semibold ${action === 'buy' ? 'bg-success-soft text-success' : 'text-muted'}`}>Buy</button>
        <button onClick={() => setAction('sell')} className={`flex-1 py-2.5 text-sm font-semibold ${action === 'sell' ? 'bg-danger-soft text-danger' : 'text-muted'}`}>Sell</button>
      </div>
      <Input className="mb-3 font-mono" placeholder="Token contract address" value={token} onChange={(e) => setToken(e.target.value)} />
      {action === 'buy' ? (
        <Input className="mb-4" type="number" step="any" placeholder="Amount (native currency)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      ) : (
        <div className="mb-4">
          <label className="label-base">Sell percent: {percent}%</label>
          <input type="range" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} className="w-full accent-brand" />
        </div>
      )}
      <Button loading={busy} onClick={execute} className="w-full" variant={action === 'buy' ? 'accent' : 'primary'}>
        {action === 'buy' ? 'Execute Buy' : 'Execute Sell'}
      </Button>
      {result && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${result.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
          {result.text}
          {result.tx && <a href={EXPLORER[chain] + result.tx} target="_blank" rel="noopener" className="ml-2 underline">View Tx ↗</a>}
        </div>
      )}
    </Card>
  );
}

function WalletsTab({ uid, settings, reload, notify }: any) {
  const wallets = settings.wallets || {};
  const [chain, setChain] = useState('bsc');
  const [pk, setPk] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!pk.trim()) return notify('Enter a private key');
    setBusy(true);
    try {
      const wd: any = await importWallet(chain === 'sol' ? 'sol' : chain, pk.trim());
      await callSaveBotWallet({ chain, address: wd.address, privateKey: wd.privateKey });
      setPk(''); await reload(); notify(`${chain.toUpperCase()} trading wallet saved`);
    } catch (e: any) { notify(e.message || 'Failed to save wallet'); } finally { setBusy(false); }
  };
  const remove = async (c: string) => {
    if (!confirm(`Remove ${c.toUpperCase()} trading wallet?`)) return;
    await callRemoveBotWallet({ chain: c }); await reload(); notify('Wallet removed');
  };

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-1 text-sm font-bold">Add Trading Wallet</h3>
        <p className="mb-3 text-xs text-muted">The bot needs a hot wallet key to execute trades. Keys are encrypted server-side.</p>
        <div className="chain-pills no-scrollbar mb-3">
          {CHAINS.map((c) => <button key={c} className={`chain-pill ${c} ${chain === c ? 'active' : ''}`} onClick={() => setChain(c)}>{c.toUpperCase()}</button>)}
        </div>
        <textarea className="input-base mb-3 font-mono" rows={2} placeholder="Private key" value={pk} onChange={(e) => setPk(e.target.value)} />
        <Button loading={busy} onClick={save} className="w-full">Save Wallet</Button>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-bold">Configured Wallets</h3>
        {CHAINS.filter((c) => wallets[c]?.address).length === 0 ? (
          <p className="text-sm text-muted">No trading wallets configured yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {CHAINS.filter((c) => wallets[c]?.address).map((c) => (
              <div key={c} className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3">
                <span className="text-xs font-bold uppercase text-brand">{c}</span>
                <span className="flex-1 truncate font-mono text-xs">{short(wallets[c].address)}</span>
                <button className="text-muted hover:text-danger" onClick={() => remove(c)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function TelegramTab({ notify }: any) {
  const [code, setCode] = useState('');
  const [botName, setBotName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { callGetBotInfo({}).then((r: any) => setBotName(r.data?.username || '')).catch(() => {}); }, []);

  const gen = async () => {
    setBusy(true);
    try { setCode(((await callGenerateTelegramCode({})).data as any).code); } catch (e: any) { notify(e.message || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <Card>
      <h3 className="mb-1 text-sm font-bold">Link Telegram</h3>
      <p className="mb-4 text-sm text-muted">
        Control the bot and receive alerts from Telegram{botName ? <> via <span className="font-semibold text-brand">@{botName}</span></> : ''}.
      </p>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Generate a link code below.</li>
        <li>Open the bot in Telegram{botName ? <> (<span className="text-brand">@{botName}</span>)</> : ''}.</li>
        <li>Send <code className="rounded bg-surface-3 px-1.5 py-0.5 text-brand">/link CODE</code> within 10 minutes.</li>
      </ol>
      <Button loading={busy} onClick={gen} className="w-full">Generate Link Code</Button>
      {code && (
        <div className="mt-4 rounded-xl bg-surface-3 p-4 text-center">
          <div className="text-xs text-muted">Your link code (valid 10 min)</div>
          <button onClick={() => navigator.clipboard?.writeText(code).then(() => notify('Copied!'))} className="mt-1 text-2xl font-bold tracking-widest text-success">{code}</button>
        </div>
      )}
    </Card>
  );
}

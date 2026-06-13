'use client';

import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc, collection, getDocs, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { Button, Card, Input, Select } from '@/components/ui';
import { TxModal, TxData } from '@/components/TxModal';
import { Portal } from '@/components/Portal';
import {
  callRunAgentScan, callSaveAgentSettings, callSaveCexApiKey, callRemoveCexApiKey,
  callGetCexBalances, callApproveTrade, callSkipSignal
} from '@/lib/functions';

const EXCHANGES = ['binance', 'mexc', 'bybit', 'kucoin'];
const EX_COLOR: Record<string, string> = { binance: '#F0B90B', mexc: '#2354E6', bybit: '#EF8C1A', kucoin: '#00A478' };

const fmtP = (p: any) => { if (p == null || isNaN(p)) return '?'; if (p >= 10000) return p.toFixed(0); if (p >= 1000) return p.toFixed(2); if (p >= 1) return p.toFixed(4); if (p >= 0.01) return p.toFixed(6); return p.toFixed(8); };
const pct = (entry: number, target: number) => { if (!entry || !target) return ''; const v = ((target - entry) / entry) * 100; return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };
const relTime = (ts: number) => { const d = Date.now() - ts; if (d < 0) { const p = -d; return p < 3.6e6 ? `in ${Math.round(p / 6e4)}m` : `in ${Math.round(p / 3.6e6)}h`; } if (d < 6e4) return 'just now'; if (d < 3.6e6) return `${Math.round(d / 6e4)}m ago`; if (d < 8.64e7) return `${Math.round(d / 3.6e6)}h ago`; return `${Math.round(d / 8.64e7)}d ago`; };

export default function AgentPage() {
  const { user } = useAuth();
  const uid = user?.uid;
  const [tab, setTab] = useState<'overview' | 'exchanges' | 'signals' | 'history'>('overview');
  const [s, setS] = useState<any>({});
  const [stats, setStats] = useState({ today: 0, active: 0, total: 0 });
  const [toast, setToast] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [tx, setTx] = useState<TxData | null>(null);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async () => {
    if (!uid) return;
    const snap = await getDoc(doc(db, 'users', uid));
    setS(snap.exists() ? snap.data().agentSettings || {} : {});
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const loadStats = useCallback(async () => {
    if (!uid) return;
    try {
      const today = await getDocs(query(collection(db, 'users', uid, 'signals'), where('generatedAt', '>', Date.now() - 86400000)));
      const open = await getDocs(query(collection(db, 'users', uid, 'cexTrades'), where('status', '==', 'open')));
      const all = await getDocs(query(collection(db, 'users', uid, 'signals'), limit(200)));
      setStats({ today: today.size, active: open.size, total: all.size });
    } catch {}
  }, [uid]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const enabled = !!s.enabled;
  const configuredExchanges = Object.keys(s.cexKeys || {});
  const saveField = async (patch: any) => { setS((p: any) => ({ ...p, ...patch })); try { await callSaveAgentSettings(patch); } catch (e: any) { notify(e.message || 'Save failed'); } };

  const scanNow = async () => {
    setScanning(true); setScanMsg('Analyzing top symbols across exchanges (up to 60s)…');
    try {
      const res: any = (await callRunAgentScan({})).data;
      const count = res?.signals?.length || 0;
      setScanMsg(`✅ Scan complete — ${count} signal${count !== 1 ? 's' : ''} found.`);
      await loadStats();
      if (count > 0) setTimeout(() => setTab('signals'), 900);
    } catch (e: any) { setScanMsg('❌ Scan failed: ' + (e.message || 'error')); } finally {
      setScanning(false); setTimeout(() => setScanMsg(''), 10000);
    }
  };

  return (
    <AppShell title="AI Agent">
      <Card className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${enabled ? 'bg-success shadow-[0_0_8px] shadow-success' : 'bg-muted'}`} />
            <div>
              <div className="font-semibold">AI Trading Agent</div>
              <div className="text-xs text-muted">{enabled ? (s.lastScanAt ? `Last scan: ${relTime(s.lastScanAt)}` : 'Next scan in ~15 min') : 'Agent is disabled'}</div>
            </div>
          </div>
          <button onClick={() => saveField({ enabled: !enabled })} className={`relative h-7 w-12 rounded-full transition ${enabled ? 'bg-accent' : 'bg-border-2'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <Button loading={scanning} onClick={scanNow} className="mt-4 w-full">{scanning ? '🔍 Scanning markets…' : '🔍 Scan Markets Now'}</Button>
        {scanMsg && <div className="mt-2 text-center text-sm text-muted">{scanMsg}</div>}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="Signals Today" value={stats.today} />
          <MiniStat label="Active Trades" value={stats.active} />
          <MiniStat label="Total Signals" value={stats.total} />
        </div>
      </Card>

      <div className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {([['overview', 'Settings'], ['exchanges', 'Exchanges'], ['signals', 'Signals'], ['history', 'History']] as const).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === t ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-foreground'}`}>{l}</button>
        ))}
      </div>

      {tab === 'overview' && <SettingsTab s={s} save={saveField} notify={notify} />}
      {tab === 'exchanges' && uid && <ExchangesTab s={s} reload={load} notify={notify} />}
      {tab === 'signals' && uid && <SignalsTab uid={uid} riskPercent={s.riskPercent || 2} configuredExchanges={configuredExchanges} notify={notify} setTx={setTx} reloadStats={loadStats} />}
      {tab === 'history' && uid && <HistoryTab uid={uid} />}

      {toast && <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-surface-3 px-4 py-2.5 text-sm shadow-card md:bottom-8">{toast}</div>}
      <TxModal tx={tx} onClose={() => setTx(null)} />
    </AppShell>
  );
}

const MiniStat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-xl bg-surface-3 p-3 text-center"><div className="text-xl font-bold text-brand">{value}</div><div className="text-[10px] uppercase text-muted">{label}</div></div>
);

function SettingsTab({ s, save, notify }: any) {
  const exchanges: string[] = s.exchanges || ['binance', 'mexc', 'bybit', 'kucoin'];
  const marketTypes: string[] = s.marketTypes || ['spot'];
  const toggleArr = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <Card className="space-y-5">
      <div>
        <label className="label-base">Exchanges to scan</label>
        <div className="flex flex-wrap gap-2">
          {EXCHANGES.map((ex) => (
            <button key={ex} onClick={() => save({ exchanges: toggleArr(exchanges, ex) })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${exchanges.includes(ex) ? 'bg-surface-3 text-foreground ring-1 ring-brand/40' : 'bg-surface-2 text-muted'}`}>{ex}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="label-base">Market types</label>
        <div className="flex gap-2">
          {['spot', 'futures'].map((mt) => (
            <button key={mt} onClick={() => { const next = toggleArr(marketTypes, mt); save({ marketTypes: next.length ? next : ['spot'] }); }} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize transition ${marketTypes.includes(mt) ? 'bg-surface-3 text-foreground ring-1 ring-brand/40' : 'bg-surface-2 text-muted'}`}>{mt === 'futures' ? '📊 Futures' : '💰 Spot'}</button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">The agent scans and generates signals for the selected market types.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label className="label-base">Timeframe</label><Select defaultValue={s.timeframe || '4H'} onChange={(e) => save({ timeframe: e.target.value })}>{['15m', '1H', '4H', '1D'].map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
        <div><label className="label-base">Min confidence (%)</label><Select defaultValue={String(s.minConfidence || 70)} onChange={(e) => save({ minConfidence: parseInt(e.target.value) })}>{[60, 65, 70, 75, 80, 85].map((c) => <option key={c} value={c}>{c}%</option>)}</Select></div>
      </div>

      <div>
        <label className="label-base">Risk per trade: {s.riskPercent || 2}%</label>
        <input type="range" min={0.5} max={10} step={0.5} defaultValue={s.riskPercent || 2} onChange={(e) => save({ riskPercent: parseFloat(e.target.value) })} className="w-full accent-brand" />
      </div>

      <label className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3"><span className="text-sm">Auto-execute approved signals</span><input type="checkbox" defaultChecked={!!s.autoExecute} onChange={(e) => save({ autoExecute: e.target.checked })} className="h-4 w-4 accent-accent" /></label>
      <label className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3"><span className="text-sm">Send signals to Telegram</span><input type="checkbox" defaultChecked={s.telegramSignals !== false} onChange={(e) => save({ telegramSignals: e.target.checked })} className="h-4 w-4 accent-accent" /></label>
    </Card>
  );
}

function ExchangesTab({ s, reload, notify }: any) {
  const keys = s.cexKeys || {};
  const [ex, setEx] = useState('binance');
  const [apiKey, setApiKey] = useState(''); const [secret, setSecret] = useState(''); const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false); const [balances, setBalances] = useState<any>(null); const [loadingBal, setLoadingBal] = useState(false);

  const save = async () => {
    if (apiKey.trim().length < 10 || secret.trim().length < 10) return notify('Enter a valid API key and secret');
    setBusy(true);
    try { await callSaveCexApiKey({ exchange: ex, apiKey: apiKey.trim(), secret: secret.trim(), passphrase: passphrase.trim() || undefined }); setApiKey(''); setSecret(''); setPassphrase(''); await reload(); notify(`${ex} key saved`); }
    catch (e: any) { notify(e.message || 'Failed to save key'); } finally { setBusy(false); }
  };
  const remove = async (e: string) => { if (!confirm(`Remove ${e} API key?`)) return; await callRemoveCexApiKey({ exchange: e }); await reload(); notify('Key removed'); };
  const loadBalances = async () => {
    setLoadingBal(true);
    try { setBalances(((await callGetCexBalances({})).data as any).balances || {}); }
    catch (e: any) { notify(e.message || 'Failed'); }
    finally { setLoadingBal(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-1 text-sm font-bold">Connect Exchange</h3>
        <p className="mb-3 text-xs text-muted">Keys are encrypted server-side. Use read+trade keys without withdrawal permission.</p>
        <Select value={ex} onChange={(e) => setEx(e.target.value)} className="mb-3 capitalize">{EXCHANGES.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
        <Input className="mb-2 font-mono" placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <Input className="mb-2 font-mono" placeholder="API Secret" value={secret} onChange={(e) => setSecret(e.target.value)} />
        {ex === 'kucoin' && <Input className="mb-2 font-mono" placeholder="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />}
        <Button loading={busy} onClick={save} className="mt-1 w-full">Save Key</Button>
      </Card>
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Connected Exchanges</h3>
          {Object.keys(keys).length > 0 && (
            <button onClick={loadBalances} disabled={loadingBal} className="flex items-center gap-1.5 text-xs text-brand disabled:opacity-60">
              {loadingBal && <span className="h-3 w-3 animate-spin rounded-full border border-brand/40 border-t-brand" />}
              {loadingBal ? 'Fetching balances…' : 'Load balances'}
            </button>
          )}
        </div>
        {Object.keys(keys).length === 0 ? <p className="text-sm text-muted">No exchanges connected yet.</p> : (
          <div className="flex flex-col gap-2">
            {Object.entries(keys).map(([name, k]: any) => (
              <div key={name} className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3">
                <span className="text-sm font-semibold capitalize" style={{ color: EX_COLOR[name] }}>{name}</span>
                <span className="font-mono text-xs text-muted">{k.maskedKey || '••••'}</span>
                {balances?.[name] && <span className={`text-xs ${balances[name].error ? 'text-danger' : 'text-success'}`}>{balances[name].error ? '⚠ Error' : `$${parseFloat(balances[name].free || 0).toFixed(2)}`}</span>}
                <button className="ml-auto text-muted hover:text-danger" onClick={() => remove(name)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function SignalsTab({ uid, riskPercent, configuredExchanges, notify, setTx, reloadStats }: any) {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('active');
  const [mktFilter, setMktFilter] = useState('all');
  const [picker, setPicker] = useState<{ signalId: string; signal: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let docs;
      try { docs = (await getDocs(query(collection(db, 'users', uid, 'signals'), orderBy('generatedAt', 'desc'), limit(60)))).docs; }
      catch { docs = (await getDocs(query(collection(db, 'users', uid, 'signals'), limit(60)))).docs; }
      let list = docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      list = list.map((s) => ({ ...s, status: s.status === 'pending' && s.expiresAt < Date.now() ? 'expired' : s.status }));
      setSignals(list);
    } finally { setLoading(false); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  let shown = signals;
  if (statusFilter === 'active') shown = shown.filter((s) => s.status !== 'expired');
  else if (statusFilter !== 'all') shown = shown.filter((s) => s.status === statusFilter);
  if (mktFilter !== 'all') shown = shown.filter((s) => (s.marketType || 'spot') === mktFilter);

  const doApprove = async (signal: any, targetExchange: string) => {
    setPicker(null);
    const bias = signal.bias === 'long' ? '▲ LONG' : '▼ SHORT';
    const mkt = signal.marketType === 'futures' ? 'FUTURES' : 'SPOT';
    setTx({ id: Date.now(), steps: ['Preparing', 'Placing Order', 'Confirming', 'Complete'], status: 'processing', title: 'Executing Trade', subtitle: `Placing order on ${targetExchange.toUpperCase()}…`, tokenName: signal.symbol, tokenMeta: `${bias} · ${mkt} · ${targetExchange.toUpperCase()}` });
    try {
      const d: any = (await callApproveTrade({ signalId: signal.id, riskPercent, targetExchange })).data;
      setTx((t: any) => t && { ...t, status: 'success', title: 'Order Placed!', subtitle: `Submitted to ${targetExchange.toUpperCase()} successfully.`, result: { orderId: d?.orderId, sizeUsd: d?.tradeUSDT ? parseFloat(d.tradeUSDT).toFixed(2) : undefined } });
      await load(); await reloadStats();
    } catch (e: any) {
      setTx((t: any) => t && { ...t, status: 'error', title: 'Order Failed', result: { errorMsg: `${targetExchange.toUpperCase()}: ${e.message}` } });
    }
  };

  const approve = (signal: any) => {
    if (!configuredExchanges.length) return notify('No CEX keys configured — add one in the Exchanges tab.');
    if (configuredExchanges.length === 1) doApprove(signal, configuredExchanges[0]);
    else setPicker({ signalId: signal.id, signal });
  };
  const [skippingId, setSkippingId] = useState<string | null>(null);
  const skip = async (id: string) => {
    setSkippingId(id);
    try { await callSkipSignal({ signalId: id }); await load(); }
    catch (e: any) { notify(e.message || 'Failed'); }
    finally { setSkippingId(null); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
          {['active', 'all', 'pending', 'executed', 'skipped', 'expired'].map((f) => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}
        </Select>
        <div className="flex gap-1">
          {['all', 'spot', 'futures'].map((m) => (
            <button key={m} onClick={() => setMktFilter(m)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${mktFilter === m ? 'bg-surface-3 text-foreground' : 'text-muted hover:text-foreground'}`}>{m}</button>
          ))}
        </div>
        <button onClick={load} className="ml-auto text-xs text-brand">⟳ Refresh</button>
      </div>

      {loading ? <div className="loading-msg"><span className="spinner" />Loading signals…</div>
        : shown.length === 0 ? <Card className="text-center text-sm text-muted">📡 No {mktFilter !== 'all' ? mktFilter + ' ' : ''}signals yet. Run a scan or enable the agent.</Card>
        : <div className="flex flex-col gap-3">{shown.map((sig) => <SignalCard key={sig.id} s={sig} skipping={skippingId === sig.id} onApprove={() => approve(sig)} onSkip={() => skip(sig.id)} />)}</div>}

      {picker && (
        <Portal>
        <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) setPicker(null); }}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative max-h-[90dvh] w-full max-w-md animate-slide-up overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-h-[88vh] sm:rounded-2xl sm:pb-5">
            <h3 className="mb-1 font-bold">Choose Exchange</h3>
            <p className="mb-4 text-xs text-muted">Place this trade on which connected exchange?</p>
            <div className="grid grid-cols-2 gap-2">
              {configuredExchanges.map((ex: string) => (
                <button key={ex} onClick={() => doApprove(picker.signal, ex)} className="rounded-xl bg-surface-2 px-4 py-3 text-center hover:ring-1 hover:ring-brand/40">
                  <div className="text-sm font-bold capitalize" style={{ color: EX_COLOR[ex] }}>{ex}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setPicker(null)} className="btn-ghost mt-4 w-full">Cancel</button>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

function SignalCard({ s, skipping, onApprove, onSkip }: any) {
  const pending = s.status === 'pending';
  const long = s.bias === 'long';
  const tags = [
    s.indicators?.rsi != null && `RSI ${s.indicators.rsi}`,
    s.structure?.bos && 'BOS ✓', s.structure?.hasFVG && 'FVG', s.structure?.hasOB && 'OB',
    s.indicators?.volumeSpike && 'Vol Spike',
    s.marketType === 'futures' && s.indicators?.adx != null && `ADX ${s.indicators.adx}`,
    s.marketType === 'futures' && s.tvRecommend?.label && `TV: ${s.tvRecommend.label}`
  ].filter(Boolean) as string[];
  const exchanges = (s.exchanges || [s.exchange]).filter(Boolean).map((e: string) => e.toUpperCase()).join(' / ');

  return (
    <Card className={`p-4 ${s.status === 'expired' ? 'opacity-60' : ''}`} >
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold">{s.symbol}</span>
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${long ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>{long ? '▲ LONG' : '▼ SHORT'}</span>
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${s.marketType === 'futures' ? 'bg-brand/15 text-brand' : 'bg-surface-3 text-muted'}`}>{s.marketType === 'futures' ? 'FUTURES' : 'SPOT'}</span>
          {s.marketType === 'futures' && s.leverage && <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold">{s.leverage}x</span>}
          {s.isAlpha && <span className="rounded-md bg-danger-soft px-2 py-0.5 text-[10px] font-bold text-danger">🔥 ALPHA</span>}
        </div>
        <span className="text-xs text-muted">{s.confidence}%</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted"><span>{exchanges}</span><span>{s.timeframe}</span><span>{s.expiresAt > Date.now() ? `Expires ${relTime(s.expiresAt)}` : 'Expired'}</span></div>

      <div className="mt-3 space-y-1.5 rounded-xl bg-surface-2 p-3 text-sm">
        <Row label="Entry" value={s.entryHigh ? `$${fmtP(s.entry)} – $${fmtP(s.entryHigh)}` : `$${fmtP(s.entry)}`} />
        <Row label="Stop Loss" value={`$${fmtP(s.stopLoss)}`} sub={pct(s.entry, s.stopLoss)} tone="danger" />
        <Row label="TP1" value={`$${fmtP(s.tp1)}`} sub={pct(s.entry, s.tp1)} tone="success" />
        {(s.tp2 || s.tp3) && <Row label="TP2 / TP3" value={`$${fmtP(s.tp2)} / $${fmtP(s.tp3)}`} sub={`${pct(s.entry, s.tp2)} / ${pct(s.entry, s.tp3)}`} tone="success" />}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full bg-brand" style={{ width: `${s.confidence}%` }} /></div>
        {s.riskReward && <span className="text-xs text-muted">R:R 1:{s.riskReward}</span>}
      </div>
      {s.setup && <div className="mt-2 text-xs text-muted">{s.setup}</div>}
      {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{tags.map((t) => <span key={t} className="rounded bg-surface-3 px-2 py-0.5 text-[10px] text-muted">{t}</span>)}</div>}

      {pending ? (
        <div className="mt-3 flex gap-2">
          <Button variant="accent" className="flex-1 py-2 text-xs" onClick={onApprove}>✅ Approve Trade</Button>
          <Button variant="ghost" className="py-2 text-xs" loading={skipping} onClick={onSkip}>{skipping ? 'Skipping…' : '❌ Skip'}</Button>
        </div>
      ) : (
        <div className="mt-3 text-center text-xs font-semibold text-muted">{({ executed: '✅ Executed', skipped: '❌ Skipped', expired: '⏰ Expired' } as any)[s.status] || s.status}</div>
      )}
    </Card>
  );
}

const Row = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'success' | 'danger' }) => (
  <div className="flex items-center justify-between">
    <span className="text-muted">{label}</span>
    <span className="flex items-center gap-2">
      <span className={`font-medium ${tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>{value}</span>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </span>
  </div>
);

function HistoryTab({ uid }: { uid: string }) {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        let docs;
        try { docs = (await getDocs(query(collection(db, 'users', uid, 'cexTrades'), orderBy('openedAt', 'desc'), limit(25)))).docs; }
        catch { docs = (await getDocs(query(collection(db, 'users', uid, 'cexTrades'), limit(25)))).docs; }
        setTrades(docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      } finally { setLoading(false); }
    })();
  }, [uid]);

  if (loading) return <div className="loading-msg"><span className="spinner" />Loading trades…</div>;
  if (!trades.length) return <Card className="text-center text-sm text-muted">📜 No CEX trades yet.</Card>;

  return (
    <div className="flex flex-col gap-2">
      {trades.map((t) => {
        const long = t.bias === 'long';
        const pnl = t.pnl != null ? parseFloat(t.pnl) : null;
        const date = t.openedAt?.toDate?.()?.toLocaleDateString('en-GB') || '—';
        return (
          <Card key={t.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold">{t.symbol}</span>
                <span className={long ? 'text-success' : 'text-danger'}>{long ? '▲' : '▼'} {(t.bias || '').toUpperCase()}</span>
                <span className="text-[11px] uppercase text-muted">{t.exchange}</span>
              </div>
              {pnl != null && <span className={`font-semibold ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>{pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}</span>}
            </div>
            <div className="mt-1 text-[11px] text-muted">{date} · Qty: {t.qty || '—'} · ${parseFloat(t.tradeUSDT || 0).toFixed(2)} · {t.status === 'open' ? '⏳ Open' : 'Closed'}</div>
            <div className="mt-0.5 text-[11px] text-muted">SL: ${fmtP(t.stopLoss)} · TP1: ${fmtP(t.tp1)} · Conf: {t.confidence}%</div>
          </Card>
        );
      })}
    </div>
  );
}

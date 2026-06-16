'use client';

import { useEffect, useState } from 'react';
import { updateDoc, doc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, Button, Input } from '@/components/ui';
import { TxModal, TxData } from '@/components/TxModal';
import { scanGems, Gem, NARRATIVES, GemSort } from '@/lib/gem-scanner';
import { callExecuteTrade } from '@/lib/functions';

const SORTS: { key: GemSort; label: string }[] = [
  { key: 'default', label: '⚙️ Default (use my filters)' },
  { key: 'score', label: '⭐ Best Score' }, { key: 'trending', label: '🔥 Trending (Volume)' },
  { key: 'new', label: '🆕 Newest' }, { key: 'gainers', label: '📈 Top Gainers' }
];

const CHAINS = [
  { key: 'bsc', label: 'BSC' }, { key: 'eth', label: 'ETH' }, { key: 'sol', label: 'SOL' },
  { key: 'base', label: 'Base' }, { key: 'ton', label: 'TON' }, { key: 'matic', label: 'Polygon' }
];
const BUYABLE = ['bsc', 'eth', 'sol', 'base', 'matic'];
const EXPLORER: Record<string, string> = { bsc: 'https://bscscan.com/tx/', eth: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', matic: 'https://polygonscan.com/tx/', sol: 'https://solscan.io/tx/' };
const NATIVE_OF: Record<string, string> = { bsc: 'bnb', eth: 'eth', base: 'eth', matic: 'matic', sol: 'sol' };
const NATIVE_TICKER: Record<string, string> = { bnb: 'BNB', eth: 'ETH', sol: 'SOL', matic: 'MATIC' };
const AGE_UNITS: Record<string, number> = { hours: 1, days: 24, weeks: 168, months: 720, years: 8760 };
const compact = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const parseMoney = (s: string) => {
  if (!s) return 0;
  const m = String(s).trim().toLowerCase().replace(/[$,\s]/g, '');
  const mult = m.endsWith('k') ? 1e3 : m.endsWith('m') ? 1e6 : m.endsWith('b') ? 1e9 : 1;
  const n = parseFloat(m);
  return isNaN(n) ? 0 : n * mult;
};
const DEFAULT_NARRATIVE = { key: 'default', emoji: '⚙️', label: 'Default (use my filters)' };
const ALL_NARRATIVE = { key: 'all', emoji: '🌐', label: 'All Narratives' };
const NAR_OPTIONS = [DEFAULT_NARRATIVE, ALL_NARRATIVE, ...NARRATIVES];

export function GemScanner({ uid, settings, reload, notify }: { uid?: string; settings: any; reload: () => void; notify: (m: string) => void }) {
  const [selected, setSelected] = useState<string[]>(['bsc', 'eth', 'sol', 'base']);
  const [narrative, setNarrative] = useState('default');
  const [narOpen, setNarOpen] = useState(false);
  const [sort, setSort] = useState<GemSort>('default');
  const [minMcap, setMinMcap] = useState('');
  const [maxMcap, setMaxMcap] = useState('');
  const [minVol, setMinVol] = useState('');
  const [maxVol, setMaxVol] = useState('');
  const [minLiquidity, setMinLiquidity] = useState('5000');
  const [maxAge, setMaxAge] = useState('30');
  const [maxAgeUnit, setMaxAgeUnit] = useState('days');
  const [minScore, setMinScore] = useState('30');

  // Buy config
  const [buyMode, setBuyMode] = useState<'native' | 'usd'>('native');
  const [amounts, setAmounts] = useState<Record<string, string>>({ bnb: '0.01', eth: '0.01', sol: '0.05', matic: '5' });
  const [prices, setPrices] = useState<Record<string, number>>({});

  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState('');
  const [gems, setGems] = useState<Gem[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [lastScan, setLastScan] = useState('');
  const [found, setFound] = useState(0);
  const [bought, setBought] = useState<Record<string, string>>({});
  const [tx, setTx] = useState<TxData | null>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [notif, setNotif] = useState('default');

  // Native USD prices for $ equivalents
  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum,solana,matic-network&vs_currencies=usd')
      .then((r) => r.json())
      .then((d) => setPrices({ bnb: d.binancecoin?.usd || 0, eth: d.ethereum?.usd || 0, sol: d.solana?.usd || 0, matic: d['matic-network']?.usd || 0 }))
      .catch(() => {});
    if (typeof Notification !== 'undefined') setNotif(Notification.permission);
  }, []);

  // Gem call history
  const loadCalls = async () => {
    if (!uid) return;
    try {
      const snap = await getDocs(query(collection(db, 'users', uid, 'gemCalls'), orderBy('calledAt', 'desc'), limit(20)));
      setCalls(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch { try { const snap = await getDocs(query(collection(db, 'users', uid, 'gemCalls'), limit(20))); setCalls(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); } catch {} }
  };
  useEffect(() => { loadCalls(); }, [uid]);

  const autoEnabled = !!settings.gemAutoEnabled;
  const autoBuy = !!settings.gemAutoBuy;

  // Persist the current scanner filters so the backend auto-scan + Telegram alerts use them
  const buildAutoConfig = () => ({
    'botSettings.gemChains': selected,
    'botSettings.gemNarrative': narrative,
    'botSettings.gemSort': sort,
    'botSettings.gemMinLiquidity': parseInt(minLiquidity) || 5000,
    'botSettings.gemMaxAge': (parseFloat(maxAge) || 72) * (AGE_UNITS[maxAgeUnit] || 1),
    'botSettings.gemMinScore': parseInt(minScore) || 40,
    'botSettings.gemMinMcap': parseMoney(minMcap),
    'botSettings.gemMaxMcap': parseMoney(maxMcap),
    'botSettings.gemMinVolume': parseMoney(minVol),
    'botSettings.gemMaxVolume': parseMoney(maxVol)
  });
  const saveAutoConfig = async (silent = false) => {
    if (!uid) return;
    try { await updateDoc(doc(db, 'users', uid), buildAutoConfig()); reload(); if (!silent) notify('Auto-scan filters saved ✓'); }
    catch (e: any) { notify(e.message || 'Failed'); }
  };
  const setAuto = async (field: string, val: boolean) => {
    if (!uid) return;
    try {
      // When turning auto-scan on, also snapshot the current filters
      const patch: any = { [`botSettings.${field}`]: val };
      if (field === 'gemAutoEnabled' && val) Object.assign(patch, buildAutoConfig());
      await updateDoc(doc(db, 'users', uid), patch); reload();
    } catch (e: any) { notify(e.message || 'Failed'); }
  };

  const toggleChain = (c: string) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  const run = async () => {
    if (!selected.length) return notify('Select at least one chain');
    setScanning(true); setGems(null); setStep('Starting scan…');
    try {
      const maxAgeHours = (parseFloat(maxAge) || 72) * (AGE_UNITS[maxAgeUnit] || 1);
      const res = await scanGems({ chains: selected, minLiquidity: parseInt(minLiquidity) || 5000, maxAgeHours, minScore: parseInt(minScore) || 40, narrative, sort, minMarketCap: parseMoney(minMcap), maxMarketCap: parseMoney(maxMcap), minVolume: parseMoney(minVol), maxVolume: parseMoney(maxVol) }, setStep);
      setGems(res); setFilter('all'); setFound(res.length); setLastScan(new Date().toLocaleTimeString());
      notify(res.length ? `Found ${res.length} gem${res.length === 1 ? '' : 's'}!` : 'No gems found — try lowering min score');
    } catch (e: any) { notify('Scan error: ' + (e.message || 'failed')); } finally { setScanning(false); }
  };

  const amountFor = (chain: string) => {
    const native = NATIVE_OF[chain];
    const raw = parseFloat(amounts[native]) || 0;
    if (buyMode === 'usd' && prices[native] > 0) return raw / prices[native];
    return raw;
  };

  const buy = async (gem: Gem) => {
    if (!BUYABLE.includes(gem.chain)) return notify(`Buying not supported on ${gem.chain.toUpperCase()} yet`);
    const amount = amountFor(gem.chain);
    const ticker = NATIVE_TICKER[NATIVE_OF[gem.chain]];
    setTx({ id: Date.now(), steps: ['Preparing', 'Swapping', 'Confirming', 'Complete'], status: 'processing', title: 'Processing Transaction', subtitle: 'Submitting your buy…', tokenName: gem.tokenSymbol || gem.tokenName, tokenMeta: `${amount.toFixed(5)} ${ticker} · ${gem.chain.toUpperCase()}` });
    try {
      const res: any = (await callExecuteTrade({ chain: gem.chain, tokenAddress: gem.tokenAddress, action: 'buy', amount: String(amount), slippage: 10 })).data;
      const hash = res?.txHash || res?.signature || res?.hash;
      setBought((b) => ({ ...b, [gem.tokenAddress]: hash || 'done' }));
      setTx((t) => t && { ...t, status: 'success', title: 'Transaction Confirmed!', subtitle: 'Your buy was submitted successfully.', result: { hash, explorer: EXPLORER[gem.chain] } });
    } catch (e: any) {
      setTx((t) => t && { ...t, status: 'error', title: 'Transaction Failed', result: { errorMsg: e.message || 'Buy failed' } });
    }
  };

  const requestNotif = async () => { if (typeof Notification === 'undefined') return; const p = await Notification.requestPermission(); setNotif(p); };

  const shown = gems ? (filter === 'all' ? gems : gems.filter((g) => g.chain === filter)) : [];
  const resultChains = gems ? ['all', ...Array.from(new Set(gems.map((g) => g.chain)))] : [];
  const boughtCount = Object.keys(bought).length;
  // 'default' & 'all' are narrative-agnostic; only a specific theme filters by name/symbol
  const isBroadNarrative = narrative === 'default' || narrative === 'all';
  const curNar = NAR_OPTIONS.find((n) => n.key === narrative) || DEFAULT_NARRATIVE;

  return (
    <div className="space-y-4">
      {/* Auto toggles */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Auto Gem Scanner</div>
            <div className="text-xs text-muted">{autoEnabled ? 'Scanning every 5 min — alerts via Telegram' : 'Auto-scan for new gems in the background'}</div>
          </div>
          <button onClick={() => setAuto('gemAutoEnabled', !autoEnabled)} className={`relative h-7 w-12 rounded-full transition ${autoEnabled ? 'bg-accent' : 'bg-border-2'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${autoEnabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        {autoEnabled && (
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <div>
              <div className="text-sm font-semibold">Auto-Buy</div>
              <div className="text-xs text-muted">{autoBuy ? 'Auto-buying high-score gems' : 'Automatically buy high-score gems'}</div>
            </div>
            <button onClick={() => setAuto('gemAutoBuy', !autoBuy)} className={`relative h-7 w-12 rounded-full transition ${autoBuy ? 'bg-accent' : 'bg-border-2'}`}>
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${autoBuy ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
        )}
        {autoEnabled && (
          <div className="mt-3 border-t border-border pt-3">
            <Button variant="ghost" className="w-full text-xs" onClick={() => saveAutoConfig()}>💾 Save current filters for Telegram auto-scan</Button>
            <p className="mt-2 text-[11px] text-muted">Scans <b>{(settings.gemChains || selected).map((c: string) => c.toUpperCase()).join(', ')}</b> every 5 min and sends matching gems to your Telegram. Link Telegram in the <b>Telegram</b> tab to receive alerts.</p>
          </div>
        )}
      </Card>

      {/* Scanner settings */}
      <Card>
        <h3 className="mb-3 text-sm font-bold">Scanner Settings</h3>

        {/* Chains */}
        <label className="label-base">Chains</label>
        <div className="mb-3 flex flex-wrap gap-2">
          {CHAINS.map((c) => <button key={c.key} onClick={() => toggleChain(c.key)} className={`chain-pill ${c.key} ${selected.includes(c.key) ? 'active' : ''}`}>{c.label}</button>)}
        </div>

        {/* Narrative dropdown */}
        <label className="label-base">Narrative</label>
        <div className="relative mb-3">
          <button type="button" onClick={() => setNarOpen((o) => !o)} className="input-base flex items-center justify-between">
            <span>{curNar.emoji} {curNar.label}</span>
            <span className={`text-muted transition-transform ${narOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {narOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setNarOpen(false)} />
              <div className="absolute left-0 right-0 z-20 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card animate-fade-in">
                {NAR_OPTIONS.map((n) => (
                  <button key={n.key} type="button" onClick={() => { setNarrative(n.key); setNarOpen(false); }} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition hover:bg-surface-3 ${narrative === n.key ? 'bg-surface-3 text-foreground' : 'text-muted'}`}>
                    <span className="text-base">{n.emoji}</span><span className="font-medium">{n.label}</span>
                    {narrative === n.key && <span className="ml-auto text-brand">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {narrative === 'default' && <p className="mb-3 -mt-1 text-[11px] text-muted">Scanning all gems by your filters (liquidity, market cap, volume, age, score) — no narrative bias.</p>}
        {!isBroadNarrative && <p className="mb-3 -mt-1 text-[11px] text-muted">Searching tokens by name/symbol across the selected chains.</p>}

        {/* Trend / sort + market cap */}
        <label className="label-base">Trend &amp; Sort</label>
        <select value={sort} onChange={(e) => setSort(e.target.value as GemSort)} className="input-base mb-3">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div><label className="label-base">Min market cap</label><Input placeholder="e.g. 100k" value={minMcap} onChange={(e) => setMinMcap(e.target.value)} /></div>
          <div><label className="label-base">Max market cap</label><Input placeholder="e.g. 5m" value={maxMcap} onChange={(e) => setMaxMcap(e.target.value)} /></div>
        </div>
        <label className="label-base">24h Volume range</label>
        <div className="mb-1 grid grid-cols-2 gap-3">
          <div><Input placeholder="Min (e.g. 0)" value={minVol} onChange={(e) => setMinVol(e.target.value)} /></div>
          <div><Input placeholder="Max (e.g. 10k)" value={maxVol} onChange={(e) => setMaxVol(e.target.value)} /></div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => { setMinVol(''); setMaxVol('10k'); }} className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-semibold text-muted hover:text-foreground">🔎 Low volume (&lt;$10k)</button>
          <button type="button" onClick={() => { setMinVol(''); setMaxVol('50k'); }} className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-semibold text-muted hover:text-foreground">&lt;$50k</button>
          <button type="button" onClick={() => { setMinVol(''); setMaxVol(''); }} className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-semibold text-muted hover:text-foreground">Any volume</button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className="label-base">Min liquidity ($)</label><Input type="number" value={minLiquidity} onChange={(e) => setMinLiquidity(e.target.value)} /></div>
          <div>
            <label className="label-base">Max age</label>
            <div className="flex gap-1">
              <Input type="number" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
              <select value={maxAgeUnit} onChange={(e) => setMaxAgeUnit(e.target.value)} className="input-base w-24">
                {Object.keys(AGE_UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div><label className="label-base">Min score</label><Input type="number" value={minScore} onChange={(e) => setMinScore(e.target.value)} /></div>
        </div>
        <Button loading={scanning} onClick={run} className="mt-4 w-full">
          {scanning ? 'Scanning…' : isBroadNarrative ? '🔍 Scan for Gems' : `${curNar.emoji} Scan ${curNar.label} Gems`}
        </Button>
        {/* Stats */}
        {(found > 0 || boughtCount > 0) && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-surface-2 p-2.5 text-center"><div className="text-lg font-bold text-brand">{found}</div><div className="text-[10px] uppercase text-muted">Found</div></div>
            <div className="rounded-xl bg-surface-2 p-2.5 text-center"><div className="text-lg font-bold text-success">{boughtCount}</div><div className="text-[10px] uppercase text-muted">Bought</div></div>
          </div>
        )}
      </Card>

      {/* Buy config */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Buy Amount</h3>
          <div className="flex overflow-hidden rounded-lg border border-border text-xs">
            <button onClick={() => setBuyMode('native')} className={`px-3 py-1 font-semibold ${buyMode === 'native' ? 'bg-surface-3 text-foreground' : 'text-muted'}`}>Native</button>
            <button onClick={() => setBuyMode('usd')} className={`px-3 py-1 font-semibold ${buyMode === 'usd' ? 'bg-surface-3 text-foreground' : 'text-muted'}`}>USD</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['bnb', 'eth', 'sol', 'matic'] as const).map((n) => {
            const amt = parseFloat(amounts[n]) || 0;
            const equiv = buyMode === 'native' ? (prices[n] ? `≈ $${(amt * prices[n]).toFixed(2)}` : '≈ $—') : (prices[n] ? `≈ ${(amt / prices[n]).toFixed(4)} ${NATIVE_TICKER[n]}` : '≈ —');
            return (
              <div key={n}>
                <label className="label-base">{buyMode === 'usd' ? `${NATIVE_TICKER[n]} ($)` : NATIVE_TICKER[n]}</label>
                <Input type="number" step="any" value={amounts[n]} onChange={(e) => setAmounts((a) => ({ ...a, [n]: e.target.value }))} />
                <div className="mt-1 text-[10px] text-muted">{equiv}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Scanning overlay */}
      {scanning && (
        <Card className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-border-2 border-t-brand" />
          <div className="text-sm">{step}</div>
        </Card>
      )}

      {/* Results */}
      {gems && !scanning && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-1.5">
              {resultChains.map((c) => (
                <button key={c} onClick={() => setFilter(c)} className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${filter === c ? 'bg-surface-3 text-foreground' : 'text-muted hover:text-foreground'}`}>
                  {c === 'all' ? `All (${gems.length})` : c.toUpperCase()}
                </button>
              ))}
            </div>
            {lastScan && <span className="text-xs text-muted">Last scan: {lastScan}</span>}
          </div>

          {shown.length === 0 ? (
            <Card className="text-center text-sm text-muted">No gems found above your thresholds.</Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {shown.map((gem) => {
                const scoreColor = gem.gemScore >= 70 ? 'text-success' : gem.gemScore >= 50 ? 'text-brand' : 'text-muted';
                const txt = bought[gem.tokenAddress];
                return (
                  <Card key={gem.tokenAddress} className="p-4">
                    <div className="flex items-center gap-2">
                      {gem.icon && <img src={gem.icon} alt="" className="h-8 w-8 rounded-full" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5"><strong className="truncate text-sm">{gem.tokenName}</strong>{gem.boosted && <span className="text-xs">🚀</span>}</div>
                        <div className="text-[11px] text-muted">{gem.tokenSymbol} · {gem.chain.toUpperCase()} · {gem.dexName}</div>
                      </div>
                      <div className={`text-right ${scoreColor}`}><div className="text-lg font-bold leading-none">{gem.gemScore}</div><div className="text-[9px] uppercase text-muted">score</div></div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <Stat label="Liq" value={compact(gem.liquidity)} />
                      <Stat label="Vol 24h" value={compact(gem.volume24h)} />
                      <Stat label="MCap" value={gem.marketCap ? compact(gem.marketCap) : '—'} />
                      <Stat label="Age" value={gem.ageHours != null ? `${gem.ageHours}h` : '—'} />
                      <Stat label="1h" value={`${gem.priceChange1h >= 0 ? '+' : ''}${gem.priceChange1h.toFixed(1)}%`} tone={gem.priceChange1h >= 0 ? 'up' : 'down'} />
                      <Stat label="24h" value={`${gem.priceChange24h >= 0 ? '+' : ''}${gem.priceChange24h.toFixed(1)}%`} tone={gem.priceChange24h >= 0 ? 'up' : 'down'} />
                    </div>
                    {gem.safety?.riskLevel && gem.safety.riskLevel !== 'N/A' && (
                      <div className="mt-2 text-[11px] text-muted">Safety: <span className={gem.safety.riskLevel === 'LOW' ? 'text-success' : gem.safety.riskLevel === 'DANGER' || gem.safety.riskLevel === 'HIGH' ? 'text-danger' : 'text-brand'}>{gem.safety.riskLevel}</span>{gem.safety.sellTax != null && ` · sell tax ${gem.safety.sellTax}%`}</div>
                    )}
                    <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                      <span className="text-xs text-muted">{gem.buys24h}/{gem.sells24h} B/S</span>
                      {gem.dexUrl && <a href={gem.dexUrl} target="_blank" rel="noopener" className="text-xs text-brand">Chart ↗</a>}
                      {txt ? (
                        <span className="ml-auto flex items-center gap-2 text-xs font-semibold text-success">✅ Bought {txt !== 'done' && EXPLORER[gem.chain] && <a href={EXPLORER[gem.chain] + txt} target="_blank" rel="noopener" className="underline">TX ↗</a>}</span>
                      ) : (
                        <button onClick={() => buy(gem)} className="btn-accent ml-auto px-4 py-1.5 text-xs">Buy</button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Gem call history */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Gem Call History</h3>
          {typeof Notification !== 'undefined' && (
            <button onClick={requestNotif} className="text-xs font-semibold text-brand">
              {notif === 'granted' ? '🔔 Notifications ON' : notif === 'denied' ? '🔕 Blocked' : '🔔 Enable Alerts'}
            </button>
          )}
        </div>
        {calls.length === 0 ? (
          <p className="text-sm text-muted">No gem calls recorded yet. Run a scan to start tracking performance.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {calls.map((c) => {
              const perf = c.currentPriceUsd && c.entryPriceUsd ? ((c.currentPriceUsd - c.entryPriceUsd) / c.entryPriceUsd) * 100 : null;
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
                  <span className="font-semibold">{c.tokenSymbol || c.symbol || '—'}</span>
                  <span className="text-[11px] uppercase text-muted">{c.chain}</span>
                  {c.gemScore != null && <span className="text-xs text-brand">Score {c.gemScore}</span>}
                  {perf != null && <span className={`ml-auto text-xs font-semibold ${perf >= 0 ? 'text-success' : 'text-danger'}`}>{perf >= 0 ? '+' : ''}{perf.toFixed(1)}%</span>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <TxModal tx={tx} onClose={() => setTx(null)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-1.5">
      <div className="text-[9px] uppercase text-muted">{label}</div>
      <div className={`text-xs font-semibold ${tone === 'up' ? 'text-success' : tone === 'down' ? 'text-danger' : 'text-foreground'}`}>{value}</div>
    </div>
  );
}

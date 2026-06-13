'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { callGetTokenHolders, callGetWalletTokens } from '@/lib/functions';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { BubbleMap } from '@/components/BubbleMap';
import { Button, Input } from '@/components/ui';
import { fmtNum, fmtUSD, fmtPrice, shortAddr } from '@/lib/format';

const DS_BASE = 'https://api.dexscreener.com';
const CHAIN_ID: Record<string, string> = { bsc: 'bsc', eth: 'ethereum', sol: 'solana' };
const CHAIN_LABEL: Record<string, string> = { bsc: 'BSC', eth: 'ETH', sol: 'SOL' };

const fmtChange = (v: any) => {
  if (v == null) return { text: 'N/A', up: true };
  const n = parseFloat(v);
  return { text: `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(2)}%`, up: n >= 0 };
};

function ChainPills({ value, onChange, chains = ['bsc', 'eth', 'sol'] }: { value: string; onChange: (c: string) => void; chains?: string[] }) {
  return (
    <div className="chain-pills no-scrollbar">
      {chains.map((c) => (
        <button key={c} className={`chain-pill ${c} ${value === c ? 'active' : ''}`} onClick={() => onChange(c)}>
          {CHAIN_LABEL[c] || c.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function ChainBadge({ c }: { c: string }) {
  const color: Record<string, string> = { bsc: '#F0B90B', eth: '#627EEA', sol: '#9945FF', base: '#0052FF' };
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${color[c]}22`, color: color[c] }}>
      {CHAIN_LABEL[c] || c.toUpperCase()}
    </span>
  );
}

async function fetchTokenPairs(addr: string, chain: string) {
  const res = await fetch(`${DS_BASE}/token-pairs/v1/${CHAIN_ID[chain]}/${addr}`);
  if (!res.ok) throw new Error(`DexScreener error: ${res.status}`);
  const pairs = await res.json();
  if (!Array.isArray(pairs) || !pairs.length) throw new Error('Token not found. Check the contract address and chain.');
  pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return pairs[0];
}

// ── TOKEN TAB ───────────────────────────────────────────────────────────────
function TokenTab({ uid }: { uid: string }) {
  const router = useRouter();
  const [chain, setChain] = useState('bsc');
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [tracked, setTracked] = useState<any[]>([]);
  const [pairMap, setPairMap] = useState<Record<string, any>>({});
  const [countdown, setCountdown] = useState(10);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const isAddress = (s: string) =>
    chain === 'sol' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) : /^0x[0-9a-fA-F]{40}$/.test(s);

  const copyAddress = (e: React.MouseEvent, id: string, address: string) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(address).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    });
  };

  const loadTracked = useCallback(async () => {
    const snap = await getDocs(collection(db, 'users', uid, 'trackedTokens'));
    setTracked(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, [uid]);

  useEffect(() => { loadTracked(); }, [loadTracked]);

  const refresh = useCallback(async () => {
    if (!tracked.length) return;
    const map: Record<string, any> = {};
    for (const ch of ['bsc', 'eth', 'sol']) {
      const group = tracked.filter((t) => t.chain === ch);
      if (!group.length) continue;
      try {
        const res = await fetch(`${DS_BASE}/tokens/v1/${CHAIN_ID[ch]}/${group.map((t) => t.contractAddress).join(',')}`);
        if (!res.ok) continue;
        const pairs = await res.json();
        if (Array.isArray(pairs)) for (const p of pairs) {
          const a = p.baseToken?.address?.toLowerCase();
          if (a && (!map[a] || (p.liquidity?.usd || 0) > (map[a].liquidity?.usd || 0))) map[a] = p;
        }
      } catch {}
    }
    setPairMap(map);
  }, [tracked]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => { if (c <= 1) { refresh(); return 10; } return c - 1; }), 1000);
    return () => clearInterval(t);
  }, [refresh]);

  // Full single-token lookup by contract address
  const lookupAddress = async (address: string) => {
    setLoading(true); setError(''); setResult(null); setSearchResults(null);
    try {
      const pair = await fetchTokenPairs(address, chain);
      let holders: any = null;
      try { holders = (await callGetTokenHolders({ chain, contractAddress: address })).data as any; } catch {}
      setResult({ pair, holders: holders?.holders ?? null, address });
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  // Entry point: contract address → direct lookup; otherwise → name/ticker search
  const lookup = async () => {
    const q = addr.trim();
    if (!q) return;
    if (isAddress(q)) return lookupAddress(q);

    setLoading(true); setError(''); setResult(null); setSearchResults(null); setSearchQuery(q);
    try {
      const res = await fetch(`${DS_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
      const cid = CHAIN_ID[chain];
      const best: Record<string, any> = {};
      for (const p of pairs) {
        if (p.chainId !== cid) continue;
        const a = p.baseToken?.address?.toLowerCase();
        if (!a) continue;
        if (!best[a] || (p.liquidity?.usd || 0) > (best[a].liquidity?.usd || 0)) best[a] = p;
      }
      const list = Object.values(best).sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)).slice(0, 20);
      if (!list.length) setError(`No ${chain.toUpperCase()} tokens found for "${q}". Try another name, ticker or the contract address.`);
      setSearchResults(list);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const pickResult = (p: any) => {
    const address = p.baseToken?.address || '';
    setAddr(address);
    lookupAddress(address);
  };

  const save = async (pair: any, address: string) => {
    const data = { contractAddress: address, chain, name: pair.baseToken?.name || '', symbol: pair.baseToken?.symbol || '', addedAt: new Date().toISOString() };
    await addDoc(collection(db, 'users', uid, 'trackedTokens'), data);
    await loadTracked();
  };
  const remove = async (id: string) => {
    await deleteDoc(doc(db, 'users', uid, 'trackedTokens', id));
    setTracked((t) => t.filter((x) => x.id !== id));
  };

  const alreadySaved = result && tracked.some((t) => t.contractAddress.toLowerCase() === result.address.toLowerCase() && t.chain === chain);

  return (
    <div>
      <div className="mb-5 rounded-2xl border border-border bg-surface-2 p-4">
        <ChainPills value={chain} onChange={setChain} />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input className="flex-1 font-mono" placeholder="Contract address, or search by name / ticker…" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} />
          <Button loading={loading} onClick={lookup} className="sm:w-auto">{loading ? 'Loading…' : isAddress(addr.trim()) ? 'Track Token' : 'Search'}</Button>
        </div>
        <p className="mt-2 text-[11px] text-muted">Paste a contract address to track directly, or type a token name/ticker (e.g. “pepe”, “WIF”) to search.</p>
      </div>

      {error && <div className="tracker-error">❌ {error}</div>}

      {loading && (
        <div className="card mb-5 flex items-center gap-3 p-4 text-sm text-muted">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-2 border-t-brand" />
          {isAddress(addr.trim()) ? 'Fetching token data & holder count…' : 'Searching tokens…'}
        </div>
      )}

      {searchResults && searchResults.length > 0 && !loading && (
        <div className="card mb-5 animate-fade-in">
          <div className="mb-2 text-xs text-muted">{searchResults.length} {chain.toUpperCase()} result{searchResults.length !== 1 ? 's' : ''} for “{searchQuery}” — tap to view</div>
          <div className="flex flex-col gap-1.5">
            {searchResults.map((p) => (
              <button key={p.baseToken.address} onClick={() => pickResult(p)} className="flex items-center gap-3 rounded-xl bg-surface-3/50 px-3 py-2.5 text-left transition hover:bg-surface-3">
                {p.info?.imageUrl
                  ? <img src={p.info.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded-full" />
                  : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-muted">{(p.baseToken.symbol || '?').slice(0, 2)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{p.baseToken.name}</span>
                    <span className="text-[11px] uppercase text-muted">{p.baseToken.symbol}</span>
                  </div>
                  <div className="text-[11px] text-muted">{fmtPrice(p.priceUsd)} · Liq {p.liquidity?.usd ? fmtUSD(p.liquidity.usd) : '—'}</div>
                </div>
                <span className="shrink-0 text-xs font-semibold text-brand">View →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className="card mb-5 animate-fade-in">
          <div className="flex flex-wrap items-center gap-3">
            {result.pair.info?.imageUrl && <img src={result.pair.info.imageUrl} alt="" className="h-10 w-10 rounded-full" />}
            <div className="flex-1">
              <span className="font-bold">{result.pair.baseToken?.name}</span>{' '}
              <span className="text-sm text-muted">{result.pair.baseToken?.symbol}</span> <ChainBadge c={chain} />
            </div>
            <div className="text-xl font-bold text-brand">{fmtPrice(result.pair.priceUsd)}</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['24h', fmtChange(result.pair.priceChange?.h24).text, fmtChange(result.pair.priceChange?.h24).up],
              ['Market Cap', result.pair.marketCap ? fmtUSD(result.pair.marketCap) : 'N/A'],
              ['Volume', result.pair.volume?.h24 ? fmtUSD(result.pair.volume.h24) : 'N/A'],
              ['Liquidity', result.pair.liquidity?.usd ? fmtUSD(result.pair.liquidity.usd) : 'N/A'],
              ['Holders', result.holders != null ? fmtNum(result.holders) : 'N/A']
            ].map(([l, v, up]: any, i) => (
              <div key={i} className="rounded-xl bg-surface-3 p-3">
                <div className="text-[11px] uppercase text-muted">{l}</div>
                <div className={`text-sm font-semibold ${up === true ? 'text-success' : up === false ? 'text-danger' : ''}`}>{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
            <span className="font-mono text-xs text-muted">{shortAddr(result.address)}</span>
            {result.pair.url && <a href={result.pair.url} target="_blank" rel="noopener" className="text-xs text-brand">View on DEX ↗</a>}
            {alreadySaved ? (
              <span className="ml-auto text-xs font-bold text-success">✓ In Watchlist</span>
            ) : (
              <button className="btn-accent ml-auto px-3 py-1.5 text-xs" onClick={() => save(result.pair, result.address)}>⭐ Save</button>
            )}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">My Watchlist</h3>
        <div className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-success" />Auto-refresh: {countdown}s</div>
      </div>
      {tracked.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">No tokens in your watchlist yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tracked.map((t) => {
            const pair = pairMap[t.contractAddress.toLowerCase()];
            const ch = pair ? fmtChange(pair.priceChange?.h24) : null;
            return (
              <div key={t.id} className="card cursor-pointer p-4 transition hover:border-border-2" onClick={() => router.push(`/token?chain=${t.chain}&address=${t.contractAddress}`)}>
                <div className="flex items-center gap-2">
                  <ChainBadge c={t.chain} />
                  <strong className="flex-1 truncate text-sm">{t.name || t.symbol}</strong>
                  <button className="text-muted hover:text-danger" onClick={(e) => { e.stopPropagation(); remove(t.id); }}>✕</button>
                </div>
                <div className="mt-2 text-xl font-bold text-brand">{pair ? fmtPrice(pair.priceUsd) : '…'}</div>
                {ch && <div className={`text-sm font-semibold ${ch.up ? 'text-success' : 'text-danger'}`}>{ch.text}</div>}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border pt-2 text-[11px] text-muted">
                  <span>MCap: {pair?.marketCap ? fmtUSD(pair.marketCap) : '—'}</span>
                  <span>Vol: {pair?.volume?.h24 ? fmtUSD(pair.volume.h24) : '—'}</span>
                  <span>Liq: {pair?.liquidity?.usd ? fmtUSD(pair.liquidity.usd) : '—'}</span>
                </div>
                <button
                  onClick={(e) => copyAddress(e, t.id, t.contractAddress)}
                  title="Copy contract address"
                  className={`mt-2 flex w-full items-center gap-2 rounded-lg bg-surface-3/60 px-2.5 py-1.5 font-mono text-[11px] transition hover:bg-surface-3 ${copiedId === t.id ? 'text-success' : 'text-muted'}`}
                >
                  {copiedId === t.id ? (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      <span className="font-sans font-semibold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                      <span className="flex-1 truncate text-left">{shortAddr(t.contractAddress)}</span>
                      <span className="font-sans">Copy</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── WALLET TAB ────────────────────────────────────────────────────────────────
function WalletTab({ uid }: { uid: string }) {
  const [chain, setChain] = useState('bsc');
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<any[]>([]);

  const loadSaved = useCallback(async () => {
    const snap = await getDocs(collection(db, 'users', uid, 'trackedWallets'));
    setSaved(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, [uid]);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const load = async (address = addr, ch = chain) => {
    if (!address.trim()) return;
    setLoading(true); setError(''); setTokens(null);
    try {
      let list: any[] = [];
      if (ch === 'sol') {
        const raw = ((await callGetWalletTokens({ chain: 'sol', address: address.trim() })).data as any).tokens;
        const mints = raw.map((t: any) => t.mint);
        const pm: Record<string, any> = {};
        for (let i = 0; i < mints.length; i += 30) {
          try {
            const res = await fetch(`${DS_BASE}/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`);
            if (res.ok) { const pairs = await res.json(); if (Array.isArray(pairs)) for (const p of pairs) { const m = p.baseToken?.address?.toLowerCase(); if (m && (!pm[m] || (p.liquidity?.usd || 0) > (pm[m].liquidity?.usd || 0))) pm[m] = p; } }
          } catch {}
        }
        list = raw.map((t: any) => {
          const pair = pm[t.mint.toLowerCase()];
          const price = pair?.priceUsd ? parseFloat(pair.priceUsd) : 0;
          return { symbol: pair?.baseToken?.symbol || shortAddr(t.mint), mint: t.mint, balance: t.balance, priceUsd: price || null, change24h: pair?.priceChange?.h24 ?? null, usdValue: price ? t.balance * price : null };
        }).sort((a: any, b: any) => (b.usdValue || 0) - (a.usdValue || 0));
      } else {
        list = ((await callGetWalletTokens({ chain: ch, address: address.trim() })).data as any).tokens;
        list.sort((a: any, b: any) => (b.usdValue || 0) - (a.usdValue || 0));
      }
      setTokens(list);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const save = async () => {
    if (saved.some((w) => w.address.toLowerCase() === addr.toLowerCase() && w.chain === chain)) return;
    await addDoc(collection(db, 'users', uid, 'trackedWallets'), { address: addr.trim(), chain, addedAt: new Date().toISOString() });
    await loadSaved();
  };
  const remove = async (id: string) => { await deleteDoc(doc(db, 'users', uid, 'trackedWallets', id)); setSaved((s) => s.filter((w) => w.id !== id)); };

  const total = tokens?.reduce((s, t) => s + (t.usdValue || 0), 0) || 0;

  return (
    <div>
      <div className="mb-5 rounded-2xl border border-border bg-surface-2 p-4">
        <ChainPills value={chain} onChange={setChain} />
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input className="flex-1 font-mono" placeholder="Paste wallet address…" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <Button loading={loading} onClick={() => load()} className="sm:w-auto">{loading ? 'Loading…' : 'Load Wallet'}</Button>
        </div>
      </div>

      {error && <div className="tracker-error">❌ {error}</div>}

      {loading && (
        <div className="card mb-5 flex items-center gap-3 p-4 text-sm text-muted">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-2 border-t-brand" />
          Loading wallet holdings &amp; prices…
        </div>
      )}

      {tokens && (
        <div className="card mb-5 animate-fade-in">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-brand">Total Value: {fmtUSD(total)}</span>
            <button className="btn-accent px-3 py-1.5 text-xs" onClick={save}>💾 Save Wallet</button>
          </div>
          {tokens.length === 0 ? (
            <div className="text-sm text-muted">No token holdings found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5">Token</th>
                    <th className="px-3 py-2.5">Balance</th>
                    <th className="px-3 py-2.5">Price</th>
                    <th className="px-3 py-2.5">24h</th>
                    <th className="px-3 py-2.5">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t, i) => {
                    const ch = t.change24h != null ? fmtChange(t.change24h) : null;
                    return (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-3 py-2.5 font-medium">{t.symbol || t.name || shortAddr(t.contractAddress || t.mint)}</td>
                        <td className="px-3 py-2.5">{t.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td className="px-3 py-2.5">{t.priceUsd ? fmtPrice(t.priceUsd) : '—'}</td>
                        <td className={`px-3 py-2.5 font-semibold ${ch ? (ch.up ? 'text-success' : 'text-danger') : ''}`}>{ch ? ch.text : '—'}</td>
                        <td className="px-3 py-2.5">{t.usdValue ? fmtUSD(t.usdValue) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <h3 className="mb-3 text-sm font-bold">Saved Wallets</h3>
      {saved.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">No wallets saved yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {saved.map((w) => (
            <div key={w.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 hover:border-border-2" onClick={() => { setChain(w.chain); setAddr(w.address); load(w.address, w.chain); }}>
              <ChainBadge c={w.chain} />
              <span className="flex-1 truncate font-mono text-xs">{w.address}</span>
              <button className="text-muted hover:text-danger" onClick={(e) => { e.stopPropagation(); remove(w.id); }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PAGE ──────────────────────────────────────────────────────────────────────
export default function TrackerPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'token' | 'wallet' | 'bubble'>('token');
  const tabs: [typeof tab, string][] = [['token', '📈 Token'], ['wallet', '👛 Wallet'], ['bubble', '🫧 Bubble Map']];

  return (
    <AppShell title="Token Tracker">
      <div className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === t ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {user && tab === 'token' && <TokenTab uid={user.uid} />}
      {user && tab === 'wallet' && <WalletTab uid={user.uid} />}
      {tab === 'bubble' && <BubbleMap />}
    </AppShell>
  );
}

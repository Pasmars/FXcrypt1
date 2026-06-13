'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/ui';
import { callGetTokenHolders } from '@/lib/functions';
import { fmtUSD, fmtPrice } from '@/lib/format';

const DS_BASE = 'https://api.dexscreener.com';
const CHAIN_ID: Record<string, string> = { bsc: 'bsc', eth: 'ethereum', sol: 'solana' };

const change = (v: any) => {
  if (v == null) return { text: 'N/A', up: true };
  const n = parseFloat(v);
  return { text: `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(2)}%`, up: n >= 0 };
};
const explorer = (c: string, a: string) =>
  c === 'bsc' ? `https://bscscan.com/token/${a}` : c === 'eth' ? `https://etherscan.io/token/${a}` : `https://solscan.io/token/${a}`;

function TokenDetail() {
  const params = useSearchParams();
  const router = useRouter();
  const chain = params.get('chain') || '';
  const address = params.get('address') || '';
  const [pairs, setPairs] = useState<any[] | null>(null);
  const [holders, setHolders] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!chain || !address) { setError('Missing token address or chain.'); return; }
    (async () => {
      try {
        const res = await fetch(`${DS_BASE}/token-pairs/v1/${CHAIN_ID[chain]}/${address}`);
        if (!res.ok) throw new Error(`DexScreener error: ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) throw new Error('Token not found on DexScreener.');
        data.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        setPairs(data);
      } catch (e: any) { setError(e.message); }
      try { setHolders(((await callGetTokenHolders({ chain, contractAddress: address })).data as any).holders); } catch {}
    })();
  }, [chain, address]);

  if (error) return <div className="tracker-error">❌ {error}</div>;
  if (!pairs) return <div className="loading-msg"><span className="spinner" />Loading token…</div>;

  const best = pairs[0];
  const token = best.baseToken || {};
  const changes: [string, any][] = [['5m', best.priceChange?.m5], ['1h', best.priceChange?.h1], ['6h', best.priceChange?.h6], ['24h', best.priceChange?.h24]];

  return (
    <div className="animate-fade-in">
      <button onClick={() => router.back()} className="mb-4 text-sm text-muted hover:text-foreground">← Back</button>
      <Card>
        <div className="flex items-center gap-3">
          {best.info?.imageUrl && <img src={best.info.imageUrl} alt="" className="h-12 w-12 rounded-full" />}
          <div>
            <h1 className="text-xl font-bold">{token.name || 'Unknown Token'}</h1>
            <div className="text-sm text-muted">{token.symbol} · {chain.toUpperCase()}</div>
          </div>
        </div>

        <div className="mt-4 text-3xl font-bold text-brand">{fmtPrice(best.priceUsd)}</div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {changes.map(([l, v]) => {
            const c = change(v);
            return (
              <div key={l} className="rounded-xl bg-surface-3 p-2.5 text-center">
                <div className="text-[10px] uppercase text-muted">{l}</div>
                <div className={`text-sm font-semibold ${c.up ? 'text-success' : 'text-danger'}`}>{c.text}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Market Cap', best.marketCap ? fmtUSD(best.marketCap) : 'N/A'],
            ['Liquidity', best.liquidity?.usd ? fmtUSD(best.liquidity.usd) : 'N/A'],
            ['24h Volume', best.volume?.h24 ? fmtUSD(best.volume.h24) : 'N/A'],
            ['Holders', holders != null ? holders.toLocaleString() : 'N/A']
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-surface-2 p-3">
              <div className="text-[11px] uppercase text-muted">{l}</div>
              <div className="text-sm font-semibold">{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <a href={explorer(chain, address)} target="_blank" rel="noopener" className="btn-ghost px-4 py-2 text-xs">View on Explorer ↗</a>
          {best.url && <a href={best.url} target="_blank" rel="noopener" className="btn-accent px-4 py-2 text-xs">View on DEX ↗</a>}
        </div>

        {pairs.length > 1 && (
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-bold">Trading Pairs</h3>
            <div className="flex flex-col gap-2">
              {pairs.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-2.5 text-sm">
                  <span className="font-semibold">{p.dexId || '—'}</span>
                  <span className="text-muted">{p.liquidity?.usd ? fmtUSD(p.liquidity.usd) : '—'} liq</span>
                  <span className="ml-auto">{fmtPrice(p.priceUsd)}</span>
                  {p.url && <a href={p.url} target="_blank" rel="noopener" className="text-brand">↗</a>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function TokenPage() {
  return (
    <AppShell title="Token Detail">
      <Suspense fallback={<div className="loading-msg"><span className="spinner" />Loading…</div>}>
        <TokenDetail />
      </Suspense>
    </AppShell>
  );
}

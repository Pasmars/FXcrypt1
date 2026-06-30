'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui';
import { Portal } from '@/components/Portal';

const CG_BASE = 'https://api.coingecko.com/api/v3';
const PER_PAGE = 250;

interface Coin {
  id: string;
  name: string;
  symbol: string;
  image: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  market_cap_rank: number | null;
}

const fmtUSD = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
};
const fmtPrice = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(4)}`;
};

function Pct({ n }: { n: number | null | undefined }) {
  if (n == null) return <span className="text-muted">—</span>;
  const up = n >= 0;
  return (
    <span className={up ? 'text-success' : 'text-danger'}>
      {up ? '▲' : '▼'} {Math.abs(n).toFixed(2)}%
    </span>
  );
}

function Sparkline({ prices, positive }: { prices: number[]; positive: boolean }) {
  if (!prices || prices.length < 2) return null;
  const W = 600, H = 70, PAD = 4;
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices
    .map((p, i) => {
      const x = PAD + (i / (prices.length - 1)) * (W - PAD * 2);
      const y = PAD + (1 - (p - min) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const color = positive ? 'rgb(var(--c-success))' : 'rgb(var(--c-danger))';
  const fillPts = `${PAD},${H} ${pts} ${(W - PAD).toFixed(1)},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full">
      <defs>
        <linearGradient id="spGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill="url(#spGrad)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CoinModal({ coinId, onClose }: { coinId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState(false);

  // Lock background scroll while the sheet is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`${CG_BASE}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((c) => { if (live) { setData(c); setLoading(false); } })
      .catch((e) => { if (live) { setErr(e.message); setLoading(false); } });
    return () => { live = false; };
  }, [coinId]);

  const md = data?.market_data || {};
  const desc = (data?.description?.en || '').replace(/<[^>]*>/g, '').trim();
  const links = [
    ['Website', (data?.links?.homepage || []).find((l: string) => l)],
    ['Explorer', (data?.links?.blockchain_site || []).find((l: string) => l)],
    ['Reddit', data?.links?.subreddit_url]
  ].filter(([, u]) => u) as [string, string][];

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full max-w-lg animate-slide-up overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-h-[88vh] sm:rounded-2xl sm:pb-5">
        {loading ? (
          <div className="grid place-items-center gap-3 py-16 text-muted">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-border-2 border-t-brand" />
            Loading details…
          </div>
        ) : err ? (
          <div>
            <button onClick={onClose} className="ml-auto block text-2xl text-muted">×</button>
            <div className="rounded-xl bg-danger-soft p-4 text-center text-danger">❌ Failed to load coin details.<br /><small>{err}</small></div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {data.image?.large && <img src={data.image.large} alt="" className="h-11 w-11 rounded-full" />}
              <div className="flex-1">
                <div className="text-lg font-bold">{data.name}</div>
                <div className="text-xs uppercase text-muted">{data.symbol} {data.market_cap_rank ? `· #${data.market_cap_rank}` : ''}</div>
              </div>
              <button onClick={onClose} className="text-2xl leading-none text-muted hover:text-foreground">×</button>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-2xl font-bold">{fmtPrice(md.current_price?.usd)}</span>
              <span className="text-sm font-semibold"><Pct n={md.price_change_percentage_24h} /></span>
              <span className="text-xs text-muted">24h</span>
            </div>

            {md.sparkline_7d?.price?.length > 1 && (
              <div className="mt-3"><Sparkline prices={md.sparkline_7d.price} positive={(md.price_change_percentage_24h || 0) >= 0} /></div>
            )}

            <Section title="Price Stats">
              <StatGrid items={[
                ['24h High', fmtPrice(md.high_24h?.usd)],
                ['24h Low', fmtPrice(md.low_24h?.usd)],
                ['All-Time High', fmtPrice(md.ath?.usd)],
                ['All-Time Low', fmtPrice(md.atl?.usd)]
              ]} />
            </Section>

            <Section title="Market Stats">
              <StatGrid items={[
                ['Market Cap', fmtUSD(md.market_cap?.usd)],
                ['24h Volume', fmtUSD(md.total_volume?.usd)],
                ['Circulating Supply', md.circulating_supply ? md.circulating_supply.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'],
                ['Max Supply', md.max_supply ? md.max_supply.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '∞']
              ]} />
            </Section>

            <Section title="Price Change">
              <div className="grid grid-cols-4 gap-2">
                {([['24h', md.price_change_percentage_24h], ['7d', md.price_change_percentage_7d], ['30d', md.price_change_percentage_30d], ['1yr', md.price_change_percentage_1y]] as [string, number][]).map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-surface-2 p-2.5 text-center">
                    <div className="text-[10px] uppercase text-muted">{l}</div>
                    <div className="mt-1 text-xs font-semibold"><Pct n={v} /></div>
                  </div>
                ))}
              </div>
            </Section>

            {links.length > 0 && (
              <Section title="Links">
                <div className="flex flex-wrap gap-2">
                  {links.map(([label, url]) => (
                    <a key={label} href={url} target="_blank" rel="noopener" className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-border-2">{label}</a>
                  ))}
                </div>
              </Section>
            )}

            {desc && (
              <Section title={`About ${data.name}`}>
                <p className={`text-sm leading-relaxed text-muted ${expanded ? '' : 'line-clamp-4'}`}>{desc}</p>
                <button onClick={() => setExpanded((e) => !e)} className="mt-2 text-xs font-semibold text-brand">{expanded ? 'Show less' : 'Read more'}</button>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
    </Portal>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mt-5">
    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{title}</div>
    {children}
  </div>
);
const StatGrid = ({ items }: { items: [string, string][] }) => (
  <div className="grid grid-cols-2 gap-2">
    {items.map(([l, v]) => (
      <div key={l} className="rounded-xl bg-surface-2 p-3">
        <div className="text-[11px] text-muted">{l}</div>
        <div className="mt-0.5 text-sm font-semibold">{v}</div>
      </div>
    ))}
  </div>
);

export default function PricesPage() {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Coin[]>([]);
  const [searchLabel, setSearchLabel] = useState('');
  const [countdown, setCountdown] = useState(60);
  const [modalCoin, setModalCoin] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const fetchPage = async (p: number): Promise<Coin[]> => {
    const res = await fetch(`${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${PER_PAGE}&page=${p}&sparkline=false&price_change_percentage=24h`);
    if (!res.ok) throw new Error(`CoinGecko error ${res.status}`);
    return res.json();
  };

  const loadInitial = useCallback(async () => {
    try {
      const data = await fetchPage(1);
      setCoins(data);
      setPage(1);
      setHasMore(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  // Auto-refresh
  useEffect(() => {
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (!searchMode) loadInitial();
          return 60;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [searchMode, loadInitial]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await fetchPage(page + 1);
      if (!data.length) { setHasMore(false); return; }
      setPage((p) => p + 1);
      setCoins((prev) => [...prev, ...data]);
      if (data.length < PER_PAGE) setHasMore(false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMore(false);
    }
  };

  const runSearch = async (query: string) => {
    if (!query.trim()) { setSearchMode(false); setSearching(false); setSearchResults([]); setSearchLabel(''); return; }
    setSearchMode(true);
    const q = query.toLowerCase();
    const local = coins.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
    if (local.length) { setSearchResults(local); setSearchLabel(`${local.length} result${local.length !== 1 ? 's' : ''} for "${query}"`); return; }
    setSearchLabel(`Searching for "${query}"…`);
    setSearchResults([]);
    setSearching(true);
    try {
      const res = await fetch(`${CG_BASE}/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      const ids = (data.coins || []).slice(0, 50).map((c: any) => c.id).join(',');
      if (!ids) { setSearchResults([]); setSearchLabel(`No results for "${query}"`); return; }
      const mr = await fetch(`${CG_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`);
      const md = await mr.json();
      setSearchResults(md);
      setSearchLabel(`${md.length} result${md.length !== 1 ? 's' : ''} for "${query}"`);
    } catch {
      setSearchLabel('Search error');
    } finally {
      setSearching(false);
    }
  };

  const onSearchChange = (v: string) => {
    setSearch(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(v), 350);
  };

  const rows = searchMode ? searchResults : coins;

  return (
    <AppShell title="Crypto Prices">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-muted">{!searchMode && `Showing ${coins.length} coins`}</div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
          Auto-refresh: {countdown}s
        </div>
      </div>

      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">🔍</span>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search coin name or symbol…"
          className="input-base pl-10 pr-10"
          autoComplete="off"
          spellCheck={false}
        />
        {search && (
          <button onClick={() => onSearchChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">×</button>
        )}
      </div>

      {searchMode && searchLabel && <div className="mb-3 text-sm text-muted">{searchLabel}</div>}

      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-2 border-t-brand" />
            Loading cryptocurrencies…
          </div>
        ) : searching ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-2 border-t-brand" />
            Searching CoinGecko…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No coins found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Price</th>
                  <th className="px-3 py-3">24h</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Market Cap</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Volume</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setModalCoin(c.id)} className="cursor-pointer border-b border-border/50 transition hover:bg-white/[0.02]">
                    <td className="px-3 py-3 text-muted">{c.market_cap_rank ?? '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {c.image && <img src={c.image} alt="" width={22} height={22} className="rounded-full" />}
                        <span className="font-medium">{c.name}</span>
                        <span className="text-[11px] uppercase text-muted">{c.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold">{fmtPrice(c.current_price)}</td>
                    <td className="px-3 py-3 font-semibold"><Pct n={c.price_change_percentage_24h} /></td>
                    <td className="hidden px-3 py-3 sm:table-cell">{fmtUSD(c.market_cap)}</td>
                    <td className="hidden px-3 py-3 sm:table-cell">{fmtUSD(c.total_volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!searchMode && !loading && hasMore && (
        <Button variant="ghost" className="mx-auto mt-4 flex" loading={loadingMore} onClick={loadMore}>
          {loadingMore ? 'Loading…' : 'Load More Coins'}
        </Button>
      )}

      {modalCoin && <CoinModal coinId={modalCoin} onClose={() => setModalCoin(null)} />}
    </AppShell>
  );
}

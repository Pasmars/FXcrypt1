'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Script from 'next/script';
import { QRCodeSVG } from 'qrcode.react';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { Logo } from '@/components/Logo';
import { Button, Input } from '@/components/ui';
import { Portal } from '@/components/Portal';
import { TxModal, TxData } from '@/components/TxModal';
import {
  CHAINS, chainMeta, initTonWeb, createWallet, importWallet, getBalanceNum, getTokenBalanceNum,
  encryptData, decryptData, getEvmTokenMeta, send, CHAIN_CFG, getTxs, tokenLogoUrl, fetchTokenPrices,
  buildAuthCheck, verifyAuthCheck, isValidAddress
} from '@/lib/wallet-crypto';

interface Asset {
  id: string; chain: string; type: 'native' | 'token';
  symbol: string; name: string; address?: string; walletAddress: string; decimals: number;
  balance: number | null; priceUsd: number | null; valueUsd: number; change24h: number; logo?: string | null;
}

const fmtUsd = (n: number | null) => n == null ? '$0.00' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtAmt = (n: number | null) => n == null ? '—' : n === 0 ? '0' : n < 0.0001 ? n.toExponential(2) : n.toLocaleString(undefined, { maximumFractionDigits: 6 });
const trunc = (a: string) => (a && a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');
const timeAgo = (ts: number) => { if (!ts) return ''; const d = Date.now() - ts; if (d < 6e4) return 'just now'; if (d < 3.6e6) return `${Math.round(d / 6e4)}m ago`; if (d < 8.64e7) return `${Math.round(d / 3.6e6)}h ago`; return `${Math.round(d / 8.64e7)}d ago`; };

function CoinIcon({ symbol, chain, logo, size = 40 }: { symbol: string; chain: string; logo?: string | null; size?: number }) {
  const color = chainMeta(chain)?.color || '#5a6472';
  const [err, setErr] = useState(false);
  return (
    <div className="relative grid shrink-0 place-items-center rounded-full font-bold" style={{ width: size, height: size, background: `${color}26`, color, fontSize: size * 0.36 }}>
      {logo && !err ? <img src={logo} alt="" className="h-full w-full rounded-full object-cover" onError={() => setErr(true)} /> : symbol.slice(0, 1).toUpperCase()}
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface" style={{ background: color }} />
    </div>
  );
}

export default function WalletPage() {
  const { user } = useAuth();
  const uid = user?.uid;
  const [wallets, setWallets] = useState<any>({});
  const [authCheck, setAuthCheck] = useState<any>(null);
  const [sessionPwd, setSessionPwd] = useState<string | null>(null);
  const [docLoaded, setDocLoaded] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [filterChain, setFilterChain] = useState('all');
  const [view, setView] = useState<'portfolio' | 'manage'>('portfolio');
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [tx, setTx] = useState<TxData | null>(null);

  const [sendModal, setSendModal] = useState<null | { asset?: Asset }>(null);
  const [receiveModal, setReceiveModal] = useState<null | { chain?: string }>(null);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [reveal, setReveal] = useState<null | { chain: string; type: 'key' | 'mnemonic' }>(null);
  const [mnemonic, setMnemonic] = useState<string[] | null>(null);

  const notify = (msg: string, type = 'info') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800); };

  const loadDoc = useCallback(async () => {
    if (!uid) return;
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : {};
    setWallets(data.wallets || {});
    setAuthCheck(data.walletAuth?.check || null);
    setDocLoaded(true);
  }, [uid]);
  useEffect(() => { loadDoc(); }, [loadDoc]);
  useEffect(() => { initTonWeb(); }, []);

  const configuredChains = useMemo(() => Object.keys(wallets).filter((c) => wallets[c]?.address), [wallets]);
  const hasWallet = configuredChains.length > 0;
  const isProtected = !!authCheck || hasWallet;

  // ── Lock / unlock ──
  const handleUnlock = async (pwd: string, create: boolean): Promise<boolean> => {
    if (!pwd) { notify('Enter your wallet password', 'error'); return false; }
    // Enforce the stronger minimum only when setting a NEW password — existing
    // users may have a shorter one and must still be able to unlock.
    if (create && pwd.length < 8) { notify('Password must be at least 8 characters', 'error'); return false; }
    try {
      if (create) {
        const check = await buildAuthCheck(pwd);
        await setDoc(doc(db, 'users', uid!), { walletAuth: { check } }, { merge: true });
        setAuthCheck(check);
      } else if (authCheck) {
        if (!(await verifyAuthCheck(authCheck, pwd))) { notify('Wrong password', 'error'); return false; }
      } else {
        // legacy wallets without an auth check — validate against first key, then adopt
        const first = wallets[configuredChains[0]];
        try { await decryptData(first.encPrivateKey, pwd); } catch { notify('Wrong password', 'error'); return false; }
        const check = await buildAuthCheck(pwd);
        await setDoc(doc(db, 'users', uid!), { walletAuth: { check } }, { merge: true });
        setAuthCheck(check);
      }
      setSessionPwd(pwd);
      return true;
    } catch (e: any) { notify(e.message || 'Unlock failed', 'error'); return false; }
  };
  const lock = useCallback(() => { setSessionPwd(null); setView('portfolio'); }, []);

  // Auto-lock after 5 minutes of inactivity so an unlocked, unattended session
  // can't be used to reveal keys or send funds.
  useEffect(() => {
    if (!sessionPwd) return;
    let timer: any;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { lock(); notify('Wallet locked due to inactivity', 'info'); }, 5 * 60 * 1000); };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [sessionPwd, lock]);

  // ── Portfolio ──
  const refresh = useCallback(async () => {
    if (!configuredChains.length) { setAssets([]); return; }
    setLoadingAssets(true);
    const ids = Array.from(new Set(configuredChains.map((c) => chainMeta(c)!.coingeckoId))).join(',');
    // Kick off the price fetch and all on-chain balance reads concurrently —
    // the network round-trips overlap instead of running price-then-balances.
    const cgPromise: Promise<any> = fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`).then((r) => r.json()).catch(() => ({}));

    const list: Asset[] = [];
    await Promise.all(configuredChains.map(async (chain) => {
      const w = wallets[chain]; const meta = chainMeta(chain)!;
      const bal = await getBalanceNum(chain, w.address).catch(() => null);
      const cg = await cgPromise;
      const cgEntry = cg[meta.coingeckoId] || {};
      list.push({ id: `${chain}:native`, chain, type: 'native', symbol: meta.symbol, name: meta.label, walletAddress: w.address, decimals: chain === 'sol' || chain === 'ton' ? 9 : 18, balance: bal, priceUsd: cgEntry.usd ?? null, valueUsd: bal != null && cgEntry.usd ? bal * cgEntry.usd : 0, change24h: cgEntry.usd_24h_change || 0, logo: meta.logo });

      const tokens = w.tokens || [];
      if (tokens.length && meta.evm && meta.cgPlatform) {
        const tp = await fetchTokenPrices(meta.cgPlatform, tokens.map((t: any) => t.address));
        await Promise.all(tokens.map(async (t: any) => {
          const tb = await getTokenBalanceNum(chain, w.address, t.address, t.decimals ?? 18).catch(() => null);
          const p = tp[t.address.toLowerCase()] || {};
          list.push({ id: `${chain}:${t.address}`, chain, type: 'token', symbol: t.symbol || '???', name: `${meta.label} token`, address: t.address, walletAddress: w.address, decimals: t.decimals ?? 18, balance: tb, priceUsd: p.usd ?? null, valueUsd: tb != null && p.usd ? tb * p.usd : 0, change24h: p.change || 0, logo: tokenLogoUrl(chain, t.address) });
        }));
      }
    }));
    list.sort((a, b) => b.valueUsd - a.valueUsd);
    setAssets(list);
    setLoadingAssets(false);
  }, [configuredChains, wallets]);
  useEffect(() => { if (sessionPwd) refresh(); }, [sessionPwd, refresh]);
  // Keep balances live: poll every 60s and on tab re-focus while viewing the portfolio.
  useEffect(() => {
    if (!sessionPwd || view !== 'portfolio') return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [sessionPwd, view, refresh]);

  const total = assets.reduce((s, a) => s + a.valueUsd, 0);
  const totalChange = useMemo(() => {
    const prev = assets.reduce((s, a) => s + a.valueUsd / (1 + (a.change24h || 0) / 100), 0);
    return prev > 0 ? ((total - prev) / prev) * 100 : 0;
  }, [assets, total]);
  const shownAssets = filterChain === 'all' ? assets : assets.filter((a) => a.chain === filterChain);

  // ── Firestore ops (use sessionPwd) ──
  const persist = async (chain: string, wd: any) => {
    const encPrivateKey = await encryptData(wd.privateKey, sessionPwd!);
    const encMnemonic = wd.mnemonic ? await encryptData(wd.mnemonic, sessionPwd!) : null;
    await setDoc(doc(db, 'users', uid!), { wallets: { [chain]: { address: wd.address, publicKey: wd.publicKey || null, encPrivateKey, encMnemonic, createdAt: Date.now() } } }, { merge: true });
    await loadDoc();
  };
  const removeWallet = async (chain: string) => {
    if (!confirm(`Remove ${chain.toUpperCase()} wallet? Make sure you have a backup.`)) return;
    await updateDoc(doc(db, 'users', uid!), { [`wallets.${chain}`]: deleteField() });
    notify(`${chain.toUpperCase()} wallet removed`); await loadDoc();
  };

  // ── Send ──
  const doSend = async (asset: Asset, to: string, amount: string) => {
    setSendModal(null); setDetail(null);
    const meta = chainMeta(asset.chain)!;
    setTx({ id: Date.now(), steps: ['Signing', 'Broadcasting', 'Confirming', 'Done'], status: 'processing', title: 'Sending', subtitle: `Sending ${amount} ${asset.symbol}…`, tokenName: `${amount} ${asset.symbol}`, tokenMeta: `${meta.label} → ${trunc(to)}` });
    try {
      const pk = await decryptData(wallets[asset.chain].encPrivateKey, sessionPwd!);
      let hash = '';
      if (asset.type === 'token') hash = (await send.evmToken(asset.chain, asset.address, to, amount, asset.decimals, pk)).hash;
      else if (asset.chain === 'sol') hash = await send.sol(to, amount, pk);
      else if (asset.chain === 'ton') { await send.ton(to, amount, pk); hash = ''; }
      else hash = (await send.evmNative(asset.chain, to, amount, pk)).hash;
      setTx((t: any) => t && { ...t, status: 'success', title: 'Sent!', subtitle: 'Your transfer was submitted.', result: hash ? { hash, explorer: meta.txExplorer } : {} });
      setTimeout(refresh, 4000);
    } catch (e: any) {
      setTx((t: any) => t && { ...t, status: 'error', title: 'Transfer Failed', result: { errorMsg: e.message || 'Transaction failed' } });
    }
  };

  // ── Render ──
  return (
    <AppShell title="Wallet">
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js" strategy="afterInteractive" />
      <Script src="https://unpkg.com/tonweb@0.0.66/dist/tonweb.js" strategy="afterInteractive" onLoad={() => initTonWeb()} />

      {!docLoaded ? (
        <div className="loading-msg"><span className="spinner" />Loading wallet…</div>
      ) : !sessionPwd ? (
        <LockScreen create={!isProtected} onUnlock={handleUnlock} />
      ) : view === 'manage' ? (
        <ManageWallets wallets={wallets} uid={uid!} onBack={() => setView('portfolio')} persist={persist} removeWallet={removeWallet} onReveal={(c, t) => setReveal({ chain: c, type: t })} onMnemonic={setMnemonic} reload={loadDoc} notify={notify} />
      ) : (
        <>
          <div className="card relative overflow-hidden p-6">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/10 blur-2xl" />
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted">Total Balance</span>
              <div className="flex items-center gap-2">
                <button onClick={refresh} className="text-muted hover:text-foreground" title="Refresh">⟳</button>
                <button onClick={lock} className="rounded-lg bg-surface-3 px-2.5 py-1 text-xs font-semibold text-brand">🔒 Lock</button>
              </div>
            </div>
            <div className="mt-2 text-4xl font-bold tracking-tight">{loadingAssets && !assets.length ? '…' : fmtUsd(total)}</div>
            {assets.length > 0 && <div className={`mt-1 text-sm font-medium ${totalChange >= 0 ? 'text-success' : 'text-danger'}`}>{totalChange >= 0 ? '▲' : '▼'} {Math.abs(totalChange).toFixed(2)}% (24h)</div>}
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Button onClick={() => hasWallet ? setSendModal({}) : setView('manage')} className="text-sm">↑ Send</Button>
              <Button variant="ghost" onClick={() => hasWallet ? setReceiveModal({}) : setView('manage')} className="text-sm">↓ Receive</Button>
              <Button variant="ghost" onClick={() => setView('manage')} className="text-sm">⚙ Manage</Button>
            </div>
          </div>

          {hasWallet ? (
            <>
              {/* Network filter */}
              <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1">
                {['all', ...configuredChains].map((c) => {
                  const m = c === 'all' ? null : chainMeta(c);
                  return (
                    <button key={c} onClick={() => setFilterChain(c)} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${filterChain === c ? 'bg-surface-3 text-foreground' : 'bg-surface-2 text-muted hover:text-foreground'}`}>
                      {m && <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />}{m ? m.label : 'All'}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold">Assets</h3>
                {loadingAssets && (
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <span className="h-3 w-3 animate-spin rounded-full border border-border-2 border-t-brand" />
                    Updating balances…
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {loadingAssets && !assets.length && [1, 2, 3].map((i) => (
                  <div key={i} className="card flex animate-pulse items-center gap-3 p-3.5">
                    <div className="h-10 w-10 rounded-full bg-surface-3" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-24 rounded bg-surface-3" />
                      <div className="h-2 w-16 rounded bg-surface-3" />
                    </div>
                    <div className="space-y-2 text-right">
                      <div className="ml-auto h-3 w-16 rounded bg-surface-3" />
                      <div className="ml-auto h-2 w-12 rounded bg-surface-3" />
                    </div>
                  </div>
                ))}
                {shownAssets.map((a) => (
                  <button key={a.id} onClick={() => setDetail(a)} className="card flex items-center gap-3 p-3.5 text-left transition hover:border-border-2">
                    <CoinIcon symbol={a.symbol} chain={a.chain} logo={a.logo} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{a.symbol}</div>
                      <div className="text-xs text-muted">{a.name}{a.type === 'token' ? ' · Token' : ''}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{a.valueUsd ? fmtUsd(a.valueUsd) : '—'}</div>
                      <div className="text-xs text-muted">{fmtAmt(a.balance)} {a.symbol}</div>
                    </div>
                  </button>
                ))}
                {!loadingAssets && shownAssets.length === 0 && <p className="py-6 text-center text-sm text-muted">No assets on this network.</p>}
              </div>
            </>
          ) : (
            <div className="card mt-6 text-center">
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-surface-3 text-3xl">👛</div>
              <h2 className="text-lg font-bold">No wallets yet</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Add a wallet on any network to start managing your crypto.</p>
              <Button className="mx-auto mt-5" onClick={() => setView('manage')}>+ Add Wallet</Button>
            </div>
          )}
        </>
      )}

      {toast && <div className={`fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-card md:bottom-8 ${toast.type === 'error' ? 'bg-danger text-white' : toast.type === 'success' ? 'bg-success text-black' : 'bg-surface-3 text-foreground'}`}>{toast.msg}</div>}

      {detail && <AssetDetailModal asset={detail} onClose={() => setDetail(null)} onSend={() => { setSendModal({ asset: detail }); setDetail(null); }} onReceive={() => { setReceiveModal({ chain: detail.chain }); setDetail(null); }} onReveal={(type) => { setReveal({ chain: detail.chain, type }); setDetail(null); }} hasMnemonic={!!wallets[detail.chain]?.encMnemonic} />}
      {sendModal && <SendModal assets={assets} preset={sendModal.asset} onClose={() => setSendModal(null)} onSend={doSend} notify={notify} />}
      {receiveModal && <ReceiveModal wallets={wallets} chains={configuredChains} preset={receiveModal.chain} onClose={() => setReceiveModal(null)} notify={notify} />}
      {reveal && <RevealModal data={wallets[reveal.chain]} type={reveal.type} chain={reveal.chain} sessionPwd={sessionPwd!} onClose={() => setReveal(null)} notify={notify} />}
      {mnemonic && <MnemonicModal words={mnemonic} onClose={() => setMnemonic(null)} />}
      <TxModal tx={tx} onClose={() => setTx(null)} />
    </AppShell>
  );
}

// ── Lock screen ──
function LockScreen({ create, onUnlock }: { create: boolean; onUnlock: (pwd: string, create: boolean) => Promise<boolean>; }) {
  const [pwd, setPwd] = useState(''); const [cfm, setCfm] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (create && pwd !== cfm) return;
    setBusy(true); await onUnlock(pwd, create); setBusy(false);
  };
  return (
    <div className="mx-auto mt-6 max-w-sm">
      <div className="card p-7 text-center">
        <div className="mb-4 flex justify-center"><Logo size={44} /></div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-3 text-2xl">{create ? '🔑' : '🔒'}</div>
        <h2 className="text-lg font-bold">{create ? 'Create Wallet Password' : 'Wallet Locked'}</h2>
        <p className="mx-auto mt-2 mb-5 max-w-xs text-sm text-muted">{create ? 'Set a password to encrypt your wallets. You’ll need it to unlock and to send funds.' : 'Enter your password to unlock your wallets.'}</p>
        <Input type="password" placeholder="Wallet password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !create && submit()} autoFocus />
        {create && <Input type="password" placeholder="Confirm password" value={cfm} onChange={(e) => setCfm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} className="mt-3" />}
        <Button loading={busy} onClick={submit} className="mt-4 w-full">{create ? 'Create & Unlock' : 'Unlock'}</Button>
      </div>
    </div>
  );
}

// ── Sheet ──
function Sheet({ title, onClose, children }: any) {
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="absolute inset-0 bg-black/70" />
        <div className="relative max-h-[90dvh] w-full max-w-md animate-slide-up overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-h-[88vh] sm:rounded-2xl sm:pb-5">
          <div className="mb-4 flex items-center justify-between"><h3 className="font-bold">{title}</h3><button onClick={onClose} className="text-2xl leading-none text-muted hover:text-foreground">×</button></div>
          {children}
        </div>
      </div>
    </Portal>
  );
}

// ── Asset detail + tx history ──
function AssetDetailModal({ asset, onClose, onSend, onReceive, onReveal, hasMnemonic }: any) {
  const meta = chainMeta(asset.chain)!;
  const [txs, setTxs] = useState<any[] | null>(null);
  const [loadingTx, setLoadingTx] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    let live = true;
    getTxs(asset.chain, asset.walletAddress).then((res: any) => { if (!live) return; if (res == null) setUnsupported(true); else setTxs(res); setLoadingTx(false); }).catch(() => { if (live) setLoadingTx(false); });
    return () => { live = false; };
  }, [asset]);

  return (
    <Sheet title={`${asset.symbol} · ${meta.label}`} onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <CoinIcon symbol={asset.symbol} chain={asset.chain} logo={asset.logo} size={56} />
        <div className="mt-3 text-2xl font-bold">{fmtAmt(asset.balance)} {asset.symbol}</div>
        <div className="text-sm text-muted">{asset.valueUsd ? fmtUsd(asset.valueUsd) : '—'}</div>
        {asset.priceUsd ? <div className={`mt-1 text-xs ${asset.change24h >= 0 ? 'text-success' : 'text-danger'}`}>{fmtUsd(asset.priceUsd)} · {asset.change24h >= 0 ? '+' : ''}{(asset.change24h || 0).toFixed(2)}% (24h)</div> : null}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button onClick={onSend}>↑ Send</Button>
        <Button variant="ghost" onClick={onReceive}>↓ Receive</Button>
      </div>
      {asset.type === 'native' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => onReveal('key')} className="flex-1 rounded-lg bg-surface-3 py-2 text-xs font-medium">Show Key</button>
          {hasMnemonic && <button onClick={() => onReveal('mnemonic')} className="flex-1 rounded-lg bg-surface-3 py-2 text-xs font-medium">Recovery Phrase</button>}
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Recent Activity</div>
        {loadingTx ? <div className="loading-msg"><span className="spinner" />Loading activity…</div>
          : unsupported ? <p className="text-sm text-muted">Activity not available for {meta.label}.</p>
          : !txs || !txs.length ? <p className="text-sm text-muted">No recent activity.</p>
          : (
            <div className="flex flex-col gap-1.5">
              {txs.map((t: any, i: number) => {
                const inc = t.incoming;
                return (
                  <a key={i} href={meta.txExplorer + t.hash} target="_blank" rel="noopener" className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 transition hover:bg-surface-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-full text-sm ${inc == null ? 'bg-surface-3 text-muted' : inc ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>{inc == null ? '↪' : inc ? '↓' : '↑'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{inc == null ? 'Transaction' : inc ? 'Received' : 'Sent'}{t.err ? ' (failed)' : ''}</div>
                      <div className="text-[11px] text-muted">{timeAgo(t.ts)}{t.counterparty ? ` · ${trunc(t.counterparty)}` : ''}</div>
                    </div>
                    {t.value != null && <span className={`text-sm font-semibold ${inc ? 'text-success' : 'text-danger'}`}>{inc ? '+' : '−'}{fmtAmt(t.value)} {t.symbol}</span>}
                  </a>
                );
              })}
            </div>
          )}
      </div>
    </Sheet>
  );
}

// ── Send ──
function SendModal({ assets, preset, onClose, onSend, notify }: any) {
  const sendable = assets.filter((a: Asset) => (a.balance || 0) > 0);
  const [assetId, setAssetId] = useState(preset?.id || sendable[0]?.id || '');
  const asset: Asset = assets.find((a: Asset) => a.id === assetId);
  const [to, setTo] = useState(''); const [amount, setAmount] = useState('');
  if (!asset) return <Sheet title="Send" onClose={onClose}><p className="text-sm text-muted">No assets with a balance to send.</p></Sheet>;
  const submit = () => {
    if (!to.trim()) return notify('Enter a recipient address', 'error');
    if (!isValidAddress(asset.chain, to)) return notify(`Invalid ${chainMeta(asset.chain)?.label || asset.chain} address`, 'error');
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return notify('Enter a valid amount', 'error');
    if (asset.balance != null && amt > asset.balance) return notify('Amount exceeds balance', 'error');
    onSend(asset, to.trim(), amount);
  };
  return (
    <Sheet title="Send" onClose={onClose}>
      <label className="label-base">Asset</label>
      <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="input-base mb-3">
        {sendable.map((a: Asset) => <option key={a.id} value={a.id}>{a.symbol} · {chainMeta(a.chain)?.label} ({fmtAmt(a.balance)})</option>)}
      </select>
      <label className="label-base">Recipient address</label>
      <Input className="mb-3 font-mono" placeholder="Recipient address" value={to} onChange={(e) => setTo(e.target.value)} />
      <label className="label-base">Amount</label>
      <div className="relative mb-1">
        <Input type="number" step="any" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button onClick={() => setAmount(String(asset.balance ?? ''))} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-brand">MAX</button>
      </div>
      <div className="mb-4 text-xs text-muted">Balance: {fmtAmt(asset.balance)} {asset.symbol}{asset.priceUsd ? ` · ≈ ${fmtUsd((parseFloat(amount) || 0) * asset.priceUsd)}` : ''}</div>
      <Button onClick={submit} className="w-full">Send {asset.symbol}</Button>
    </Sheet>
  );
}

// ── Receive ──
function ReceiveModal({ wallets, chains, preset, onClose, notify }: any) {
  const [chain, setChain] = useState(preset || chains[0]);
  const address = wallets[chain]?.address || '';
  const meta = chainMeta(chain);
  return (
    <Sheet title="Receive" onClose={onClose}>
      <label className="label-base">Network</label>
      <select value={chain} onChange={(e) => setChain(e.target.value)} className="input-base mb-4">
        {chains.map((c: string) => <option key={c} value={c}>{chainMeta(c)?.label} ({chainMeta(c)?.symbol})</option>)}
      </select>
      <div className="flex flex-col items-center">
        <div className="rounded-2xl bg-white p-4"><QRCodeSVG value={address} size={184} fgColor="#0B0E11" bgColor="#ffffff" /></div>
        <p className="mt-3 text-center text-xs text-muted">Only send <b style={{ color: meta?.color }}>{meta?.label}</b> network assets to this address.</p>
        <div className="mt-3 w-full break-all rounded-xl bg-surface-2 p-3 text-center font-mono text-xs">{address}</div>
        <Button variant="ghost" className="mt-3 w-full" onClick={() => navigator.clipboard?.writeText(address).then(() => notify('Address copied!', 'success'))}>Copy Address</Button>
      </div>
    </Sheet>
  );
}

// ── Reveal (uses unlocked session password) ──
function RevealModal({ data, type, chain, sessionPwd, onClose, notify }: any) {
  const [plain, setPlain] = useState(''); const [busy, setBusy] = useState(false);
  const doReveal = async () => {
    setBusy(true);
    try { setPlain(await decryptData(type === 'mnemonic' ? data.encMnemonic : data.encPrivateKey, sessionPwd)); }
    catch { notify('Could not decrypt — session password mismatch', 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`${type === 'key' ? 'Private Key' : 'Recovery Phrase'} — ${chain.toUpperCase()}`} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">⚠️ Never share this. Anyone with it controls your funds.</div>
      {!plain ? <Button loading={busy} onClick={doReveal} className="w-full">Reveal</Button> : (
        <div className="space-y-3">
          <div className="break-all rounded-xl bg-surface-2 p-3 font-mono text-sm">{plain}</div>
          <Button variant="ghost" className="w-full" onClick={() => navigator.clipboard?.writeText(plain).then(() => { notify('Copied — clears in 60s', 'success'); setTimeout(() => navigator.clipboard?.writeText('').catch(() => {}), 60000); })}>Copy</Button>
        </div>
      )}
    </Sheet>
  );
}

function MnemonicModal({ words, onClose }: any) {
  return (
    <Sheet title="⚠️ Back Up Your Recovery Phrase" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Write these words down in order and keep them offline. This is the only way to recover your wallet.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{words.map((w: string, i: number) => <div key={i} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-sm"><span className="text-xs text-muted">{i + 1}</span><span className="font-medium">{w}</span></div>)}</div>
      <Button className="mt-4 w-full" onClick={onClose}>I&apos;ve Backed It Up</Button>
    </Sheet>
  );
}

// ── Manage ──
function ManageWallets({ wallets, uid, onBack, persist, removeWallet, onReveal, onMnemonic, reload, notify }: any) {
  const [adding, setAdding] = useState<string | null>(null);
  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-muted hover:text-foreground">← Back to portfolio</button>
      <h3 className="mb-1 text-sm font-bold">Manage Wallets</h3>
      <p className="mb-3 text-xs text-muted">New wallets are encrypted with your session password.</p>
      <div className="flex flex-col gap-3">
        {CHAINS.map((c) => {
          const w = wallets[c.key];
          return (
            <div key={c.key} className="card p-4">
              <div className="flex items-center gap-3">
                <CoinIcon symbol={c.symbol} chain={c.key} logo={c.logo} size={36} />
                <div className="flex-1">
                  <div className="text-sm font-semibold">{c.label}</div>
                  {w?.address ? <button onClick={() => navigator.clipboard?.writeText(w.address).then(() => notify('Address copied!', 'success'))} className="font-mono text-xs text-muted hover:text-brand">{trunc(w.address)} 📋</button> : <div className="text-xs text-muted">Not set up</div>}
                </div>
                {!w?.address && <Button className="px-3 py-1.5 text-xs" onClick={() => setAdding(adding === c.key ? null : c.key)}>{adding === c.key ? 'Cancel' : 'Add'}</Button>}
              </div>
              {w?.address && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <button onClick={() => onReveal(c.key, 'key')} className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs font-medium">Show Key</button>
                  {w.encMnemonic && <button onClick={() => onReveal(c.key, 'mnemonic')} className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs font-medium">Phrase</button>}
                  {c.evm && <AddTokenButton chain={c.key} uid={uid} reload={reload} notify={notify} />}
                  <button onClick={() => removeWallet(c.key)} className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft">Remove</button>
                </div>
              )}
              {adding === c.key && <AddWalletForm chain={c.key} persist={persist} onMnemonic={onMnemonic} notify={notify} onDone={() => setAdding(null)} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddWalletForm({ chain, persist, onMnemonic, notify, onDone }: any) {
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [imp, setImp] = useState(''); const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const wd: any = mode === 'create' ? await createWallet(chain) : await importWallet(chain, imp);
      await persist(chain, wd);
      notify(`${chain.toUpperCase()} wallet ${mode === 'create' ? 'created' : 'imported'}!`, 'success');
      if (mode === 'create' && wd.mnemonic) onMnemonic(wd.mnemonic.split(' '));
      onDone();
    } catch (e: any) { notify(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="flex overflow-hidden rounded-lg border border-border text-xs">
        <button onClick={() => setMode('create')} className={`flex-1 py-1.5 font-semibold ${mode === 'create' ? 'bg-surface-3 text-foreground' : 'text-muted'}`}>Create New</button>
        <button onClick={() => setMode('import')} className={`flex-1 py-1.5 font-semibold ${mode === 'import' ? 'bg-surface-3 text-foreground' : 'text-muted'}`}>Import</button>
      </div>
      {mode === 'import' && <textarea className="input-base font-mono" rows={2} placeholder="Mnemonic or private key" value={imp} onChange={(e) => setImp(e.target.value)} />}
      <Button loading={busy} onClick={run} className="w-full">{mode === 'create' ? 'Generate Wallet' : 'Import Wallet'}</Button>
    </div>
  );
}

function AddTokenButton({ chain, uid, reload, notify }: any) {
  const [open, setOpen] = useState(false); const [addr, setAddr] = useState(''); const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr.trim())) return notify('Enter a valid ERC-20 contract (0x…)', 'error');
    setBusy(true);
    try {
      const meta = await getEvmTokenMeta(addr.trim(), CHAIN_CFG[chain].rpcs);
      const snap = await getDoc(doc(db, 'users', uid));
      const tokens = [...(snap.data()?.wallets?.[chain]?.tokens || [])];
      if (tokens.some((t: any) => t.address.toLowerCase() === addr.trim().toLowerCase())) { notify('Token already added', 'info'); setOpen(false); return; }
      tokens.push({ address: addr.trim(), symbol: meta.symbol, decimals: meta.decimals });
      await updateDoc(doc(db, 'users', uid), { [`wallets.${chain}.tokens`]: tokens });
      await reload(); setAddr(''); setOpen(false); notify(`${meta.symbol} added!`, 'success');
    } catch (e: any) { notify(e.message || 'Failed', 'error'); } finally { setBusy(false); }
  };
  if (!open) return <button onClick={() => setOpen(true)} className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs font-medium">+ Token</button>;
  return (
    <div className="mt-2 flex w-full gap-2">
      <Input placeholder="Token contract 0x…" value={addr} onChange={(e) => setAddr(e.target.value)} className="font-mono text-xs" />
      <Button loading={busy} onClick={add} className="px-3 py-1.5 text-xs">Add</Button>
    </div>
  );
}

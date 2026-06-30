'use client';
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { setPayload, getPayload, keyToPath } from '@/lib/nav';

// Mirrors the mobile app's TWEAK_DEFAULTS (theme/appearance + fallback plan).
const TWEAK_DEFAULTS: any = { dark: true, accent: 'gold', homeLayout: 'agent', pointerStyle: 'bubbles', plan: 'free' };
const PUBLIC_ROUTES = new Set(['/login', '/signup']);

const Ctx = createContext<any>(null);
export const useApp = () => useContext(Ctx);

function Splash() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: '#0B0E11', color: '#8A94A3' }}>
      <div style={{ width: 40, height: 40, border: '3px solid #232932', borderTopColor: '#3B82F6', borderRadius: '50%', animation: 'fxspin .8s linear infinite' }} />
      <div style={{ fontSize: 13 }}>Loading FXcrypt…</div>
    </div>
  );
}

// Redirects between protected and public (auth) routes based on sign-in state.
function AuthRedirector() {
  const { user, authReady } = useApp();
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!authReady) return;
    const isPublic = PUBLIC_ROUTES.has(path);
    if (!user && !isPublic) router.replace('/login');
    else if (user && isPublic) router.replace('/');
  }, [user, authReady, path, router]);
  return null;
}

export function ClientRoot({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  const [t, setT] = useState<any>(TWEAK_DEFAULTS);
  const [model, setModel] = useState('DeepSeek');
  const [user, setUser] = useState<any>(undefined); // undefined = unknown, null = signed out
  const [, setDataVer] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem('fx_settings') || '{}'); setT((p: any) => ({ ...p, ...s })); } catch {}
  }, []);

  // Load the ported design modules once (registers all window globals).
  useEffect(() => {
    let alive = true;
    import('@/src/bootstrap').then(() => { if (alive) setReady(true); }).catch((e) => console.error('bootstrap failed', e));
    return () => { alive = false; };
  }, []);

  // Warm every route's JS chunk as soon as the app is ready. Navigation here is
  // programmatic (router.push), which does NOT prefetch — so without this each
  // first click to a screen blocks while its bundle is fetched over the network.
  // Prefetching upfront makes subsequent clicks resolve from cache (instant).
  useEffect(() => {
    if (!ready) return;
    const ROUTES = ['/', '/markets', '/signals', '/wallet', '/token', '/trade', '/scanner',
      '/chat', '/profile', '/automation', '/alerts', '/paywall', '/bubble', '/execSignal',
      '/signalChart', '/exchanges', '/signing', '/2fa', '/sessions', '/connect', '/referral'];
    const id = setTimeout(() => { ROUTES.forEach((r) => { try { router.prefetch(r); } catch {} }); }, 0);
    return () => clearTimeout(id);
  }, [ready, router]);

  // Track auth state once the bootstrap exposed window.FXAuth.
  useEffect(() => {
    if (!ready) return;
    const FXAuth = (window as any).FXAuth;
    if (!FXAuth) { setUser(null); return; }
    const unsub = FXAuth.onChange((u: any) => setUser(u || null));
    return () => { try { unsub && unsub(); } catch {} };
  }, [ready]);

  useEffect(() => {
    const h = () => setDataVer((v) => v + 1);
    window.addEventListener('fx:update', h);
    return () => window.removeEventListener('fx:update', h);
  }, []);

  useEffect(() => {
    if (ready && (window as any).applyTheme && rootRef.current) (window as any).applyTheme(rootRef.current, t.dark, t.accent);
  }, [ready, t.dark, t.accent]);

  // Pull live data once signed in.
  useEffect(() => {
    if (ready && user && (window as any).FXLive) (window as any).FXLive.bootstrapUser?.();
  }, [ready, user]);

  const setTweak = useCallback((k: string, v: any) => {
    setT((prev: any) => { const n = { ...prev, [k]: v }; try { localStorage.setItem('fx_settings', JSON.stringify(n)); } catch {} return n; });
  }, []);

  const go = useCallback((key: any, props?: any) => {
    if (key === -1) { router.back(); return; }
    setPayload(key, props);
    router.push(keyToPath(key));
  }, [router]);
  const back = useCallback(() => router.back(), [router]);

  const plan = (ready && (window as any).FX?.plan) || t.plan || 'free';
  const planLabel = ({ free: 'Free', pro: 'Pro', elite: 'Elite' } as any)[plan] || 'Free';
  const authReady = user !== undefined;

  const value = {
    ready, t, setTweak, model, setModel, plan, planLabel, user, authReady,
    go, back, getPayload,
    openChat: (seed: any) => go('chat', { seed: typeof seed === 'string' ? seed : null }),
    onTrade: (token: any, side: any) => go('trade', { token, side }),
    onUpsell: () => go('paywall'),
    onDone: () => router.back(),
  };

  // Gate: wait for bootstrap + first auth resolution. Don't flash protected
  // content for signed-out users (AuthRedirector will bounce them to /login).
  const isPublic = PUBLIC_ROUTES.has(path);
  const gated = !ready || !authReady || (!user && !isPublic);

  return (
    <div ref={rootRef} className="fx-root">
      <Ctx.Provider value={value}>
        {ready && authReady && <AuthRedirector />}
        {gated ? <Splash /> : children}
      </Ctx.Provider>
    </div>
  );
}

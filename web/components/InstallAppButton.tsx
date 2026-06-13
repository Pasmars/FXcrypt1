'use client';

import { useEffect, useState } from 'react';
import { Portal } from './Portal';

type Platform = 'android' | 'ios' | 'desktop' | 'other';

const DownloadIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M5 21h14" />
  </svg>
);

// Menu "download / install" entry.
//   context="desktop"  → PWA install button (desktop sidebar)
//   context="mobile"   → signed APK download card on Android, install prompt on iOS
export function InstallAppButton({ context, onDone }: { context: 'mobile' | 'desktop'; onDone?: () => void }) {
  const [deferred, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const [platform, setPlatform] = useState<Platform>('other');

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    if (standalone) setInstalled(true);

    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) setPlatform('ios');
    else if (/android/.test(ua)) setPlatform('android');
    else setPlatform('desktop');

    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (deferred) {
      deferred.prompt();
      try { const { outcome } = await deferred.userChoice; if (outcome === 'accepted') setInstalled(true); } catch {}
      setDeferred(null);
      onDone?.();
    } else {
      setHelp(true);
    }
  };

  const steps: Record<Platform, { title: string; lines: string[] }> = {
    ios: { title: 'Install on iPhone / iPad', lines: ['Open this site in Safari.', 'Tap the Share button (square with an ↑).', 'Tap “Add to Home Screen”.', 'Tap “Add” — FXcrypt lands on your home screen.'] },
    android: { title: 'Install on Android', lines: ['Open this site in Chrome.', 'Tap the ⋮ menu (top-right).', 'Tap “Install app” / “Add to Home screen”.', 'Confirm to install.'] },
    desktop: { title: 'Install on Desktop', lines: ['Use Chrome, Edge or Brave.', 'Click the install icon (⊕) at the right of the address bar,', 'or open the ⋮ menu → “Install FXcrypt”.'] },
    other: { title: 'Install FXcrypt', lines: ['Open this site in Chrome or Edge.', 'Use the browser menu → “Install app”.'] }
  };
  const s = steps[platform];

  const helpModal = help ? (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) setHelp(false); }}>
        <div className="absolute inset-0 bg-black/70" />
        <div className="relative max-h-[90dvh] w-full max-w-md animate-slide-up overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-h-[88vh] sm:rounded-2xl sm:pb-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold">{s.title}</h3>
            <button onClick={() => setHelp(false)} className="text-2xl leading-none text-muted hover:text-foreground">×</button>
          </div>
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-base"><img src="/icons/icon-192.png" alt="FXcrypt" className="h-full w-full object-cover" /></div>
            <div><div className="text-sm font-semibold">FXcrypt</div><div className="text-xs text-muted">Installs to your home screen — full-screen, offline-ready.</div></div>
          </div>
          <ol className="space-y-2.5">
            {s.lines.map((line, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-bold text-brand">{i + 1}</span>
                <span className="text-foreground">{line}</span>
              </li>
            ))}
          </ol>
          <button onClick={() => setHelp(false)} className="btn-ghost mt-5 w-full">Got it</button>
        </div>
      </div>
    </Portal>
  ) : null;

  // Reusable install pill (gradient CTA)
  const InstallPill = ({ label }: { label: string }) => (
    <button onClick={promptInstall} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-accent px-4 py-2.5 text-sm font-bold text-black shadow-glow transition active:scale-[0.98]">
      <DownloadIcon /> {label}
    </button>
  );

  // ── DESKTOP VIEW → install button only ──
  if (context === 'desktop') {
    if (installed) return null;
    return <>{<InstallPill label="Install App" />}{helpModal}</>;
  }

  // ── MOBILE VIEW ──
  // Android → clean signed-APK download card
  if (platform === 'android') {
    return (
      <a href="/fxcrypt.apk" download="FXcrypt.apk" onClick={onDone}
         className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-brand/15 via-surface-2 to-accent/10 p-3 ring-1 ring-brand/25 transition active:scale-[0.99]">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-base ring-1 ring-white/10">
          <img src="/icons/icon-192.png" alt="" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground">Download FXcrypt</div>
          <div className="text-[11px] text-muted">Android APK · 3.6 MB</div>
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-accent text-black shadow-glow">
          <DownloadIcon size={18} />
        </span>
      </a>
    );
  }

  // iOS / other mobile (or narrow desktop window) → install / add-to-home
  if (installed) return null;
  return <>{<InstallPill label={platform === 'ios' ? 'Add to Home Screen' : 'Install App'} />}{helpModal}</>;
}

'use client';
import React from 'react';
import { useApp } from '@/app/providers';
import ScreenHost from './ScreenHost';

// Title for the standard overlay header (dynamic ones read the payload).
const TITLE: Record<string, (p: any) => string> = {
  chat: () => 'Pointer', token: (p) => p.token?.sym || 'Token', bubble: () => 'Bubble Map',
  trade: () => 'Manual Trade', execSignal: () => 'Execute Signal', signalChart: (p) => p.signal?.pair || 'Signal',
  profile: () => 'Profile', exchanges: () => 'Exchanges', signing: () => 'Signing', '2fa': () => 'Security',
  sessions: () => 'Sessions', connect: (p) => (p.kind === 'telegram' ? 'Telegram' : 'Discord'), referral: () => 'Referrals',
  portfolio: () => 'Portfolio',
};
// These render their own full-screen chrome (no standard header).
const CUSTOM = new Set(['scanner', 'paywall', 'automation', 'alerts', 'copytrade']);

export default function OverlayScreen({ screen }: { screen: string }) {
  const app = useApp();
  const payload = app?.getPayload ? app.getPayload(screen) : {};
  const custom = CUSTOM.has(screen);
  const title = TITLE[screen] ? TITLE[screen](payload) : '';
  const Icon = (typeof window !== 'undefined' ? (window as any).Icon : null);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column', zIndex: 1 }}>
      <div style={{ height: 'max(env(safe-area-inset-top), 8px)', flexShrink: 0 }} />
      {!custom && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px 12px' }}>
          <button onClick={app.back} aria-label="Back" style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>
            {Icon ? React.createElement(Icon, { name: 'chevL', size: 21 }) : '‹'}
          </button>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3 }}>{title}</div>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        <ScreenHost screen={screen} />
      </div>
    </div>
  );
}

'use client';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/app/providers';

// Old nav key → the window-global React component the bootstrap registered.
const COMPONENT: Record<string, string> = {
  pointer: 'PointerHome', markets: 'Markets', signals: 'Signals', wallet: 'Wallet',
  chat: 'PointerChat', token: 'TokenDetail', bubble: 'BubbleMap', trade: 'TradeFlow',
  execSignal: 'ExecSignal', signalChart: 'SignalChart', signalTrackRecord: 'SignalTrackRecord',
  gemTrackRecord: 'GemTrackRecord', scanner: 'GemScanner',
  paywall: 'Paywall', profile: 'Profile', automation: 'Automation', alerts: 'Alerts',
  exchanges: 'ProfileExchanges', signing: 'ProfileSigning', '2fa': 'Profile2FA',
  sessions: 'ProfileSessions', connect: 'ProfileConnect', referral: 'ProfileReferral',
  portfolio: 'Portfolio',
  copytrade: 'CopyTrading',
};
// Screens that can't render without a payload object → bounce home if opened cold.
const NEEDS: Record<string, string[]> = {
  token: ['token'], bubble: ['token'], trade: ['token'], execSignal: ['signal'], signalChart: ['signal'],
};

// Build the exact props each screen expects (mirrors the old shell.jsx wiring).
function buildProps(screen: string, app: any, payload: any) {
  const W: any = window;
  switch (screen) {
    case 'pointer': return { go: app.go, layout: app.t.homeLayout, openChat: app.openChat, user: (W.FX?.user?.name?.split(' ')[0]) || 'there' };
    case 'markets': return { go: app.go };
    case 'wallet': return { go: app.go };
    case 'signals': return { go: app.go, onUpsell: app.onUpsell };
    case 'chat': return { go: app.go, seed: payload.seed, style: app.t.pointerStyle, onProposalTrade: () => {} };
    case 'token': return { token: payload.token, go: app.go, onTrade: app.onTrade };
    case 'bubble': return { token: payload.token, go: app.go };
    case 'trade': return { token: payload.token, side: payload.side, go: app.go, onDone: app.onDone };
    case 'execSignal': return { signal: payload.signal, go: app.go, onDone: app.onDone };
    case 'signalChart': return { signal: payload.signal, go: app.go, onExec: () => app.go('execSignal', { signal: payload.signal }) };
    case 'scanner': return { go: app.go, onTrade: app.onTrade, locked: app.plan === 'free', onUpsell: app.onUpsell };
    case 'copytrade': return { go: app.go, plan: app.plan, onUpsell: app.onUpsell };
    case 'paywall': return { go: app.go, onDone: app.onDone };
    case 'profile': return { go: app.go, t: app.t, setTweak: app.setTweak, plan: app.plan, planLabel: app.planLabel, onSignOut: () => { W.FXAuth?.signOut?.(); app.go('pointer'); } };
    case 'automation': return { go: app.go, plan: app.plan, onUpsell: app.onUpsell };
    case 'alerts': return { go: app.go };
    case 'connect': return { go: app.go, kind: payload.kind };
    default: return { go: app.go };
  }
}

export default function ScreenHost({ screen }: { screen: string }) {
  const app = useApp();
  const router = useRouter();
  const payload = app?.getPayload ? app.getPayload(screen) : {};
  const missing = (NEEDS[screen] || []).some((k) => payload[k] == null);

  useEffect(() => { if (missing) router.replace('/'); }, [missing, router]);
  if (missing) return null;

  const Comp = typeof window !== 'undefined' ? (window as any)[COMPONENT[screen]] : null;
  if (!Comp) return null;
  return React.createElement(Comp, buildProps(screen, app, payload));
}

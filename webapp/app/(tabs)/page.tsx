'use client';
import React from 'react';
import { useApp } from '@/app/providers';
import ScreenHost from '@/components/ScreenHost';

// Pointer home — replicates the special TopBar (logo + plan pill + avatar) the
// old shell rendered above PointerHome on the home tab.
export default function PointerPage() {
  const app = useApp();
  const W: any = typeof window !== 'undefined' ? window : {};
  const TopBar = W.TopBar, Mark = W.Mark, Icon = W.Icon;
  const initials = W.FX?.user?.initials || 'A';
  if (!TopBar) return React.createElement(ScreenHost, { screen: 'pointer' });

  const header = React.createElement(TopBar, {
    left: React.createElement(Mark, { size: 32 }),
    title: 'FXcrypt',
    sub: React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
      React.createElement('span', { style: { width: 7, height: 7, borderRadius: '50%', background: 'var(--up)' } }),
      ' Pointer online'),
    right: React.createElement(React.Fragment, null,
      React.createElement('button', {
        onClick: () => app.go('paywall'),
        style: { display: 'flex', alignItems: 'center', gap: 4, background: app.plan === 'free' ? 'var(--surface2)' : 'var(--glow)', color: app.plan === 'free' ? 'var(--muted)' : 'var(--accent)', border: 'none', borderRadius: 9, padding: '7px 11px', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
      }, app.plan !== 'free' ? React.createElement(Icon, { name: 'crown', size: 13 }) : null, app.planLabel),
      React.createElement('button', {
        onClick: () => app.go('profile'),
        style: { width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),var(--accent-deep))', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)', fontWeight: 800, fontSize: 15 },
      }, initials),
    ),
  });
  return React.createElement(React.Fragment, null, header, React.createElement(ScreenHost, { screen: 'pointer' }));
}

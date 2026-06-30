'use client';
import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/app/providers';
import { pathToTab, keyToPath } from '@/lib/nav';

export default function BottomNavHost() {
  const app = useApp();
  const path = usePathname();
  const router = useRouter();
  const BottomNav = typeof window !== 'undefined' ? (window as any).BottomNav : null;
  if (!BottomNav) return null;
  const onTab = (id: string) => {
    if (id === 'trade') { app.go('trade', { token: (window as any).FX?.tokens?.[4], side: 'buy' }); return; }
    router.push(keyToPath(id));
  };
  return React.createElement(BottomNav, { tab: pathToTab(path), onTab });
}

'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    try { setTheme(localStorage.getItem('theme') === 'light' ? 'light' : 'dark'); } catch {}
  }, []);
  const setThemeValue = (next: Theme) => {
    const el = document.documentElement;
    el.classList.remove('light', 'dark');
    el.classList.add(next);
    try { localStorage.setItem('theme', next); } catch {}
    setTheme(next);
  };
  const toggle = () => setThemeValue(theme === 'dark' ? 'light' : 'dark');
  return { theme, toggle, setTheme: setThemeValue };
}

export type Accent = 'gold' | 'cyan' | 'green' | 'violet';
export const ACCENTS: { key: Accent; hex: string; name: string }[] = [
  { key: 'gold', hex: '#FCD535', name: 'Binance Gold' },
  { key: 'cyan', hex: '#00C2FF', name: 'Electric Cyan' },
  { key: 'green', hex: '#16C784', name: 'Bull Green' },
  { key: 'violet', hex: '#7B61FF', name: 'Neon Violet' },
];

export function useAccent() {
  const [accent, setAccentState] = useState<Accent>('gold');
  useEffect(() => {
    try {
      const a = (localStorage.getItem('accent') as Accent) || 'gold';
      setAccentState(a);
    } catch {}
  }, []);
  const setAccent = (a: Accent) => {
    document.documentElement.setAttribute('data-accent', a);
    try { localStorage.setItem('accent', a); } catch {}
    setAccentState(a);
  };
  return { accent, setAccent };
}

const Sun = (p: any) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);
const Moon = (p: any) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export function ThemeToggle({ full = false }: { full?: boolean }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon; // show the action you'll switch TO

  if (full) {
    return (
      <button
        onClick={toggle}
        className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted transition hover:bg-surface-3/60 hover:text-foreground"
      >
        <Icon />
        {isDark ? 'Light mode' : 'Dark mode'}
      </button>
    );
  }
  return (
    <button onClick={toggle} aria-label="Toggle theme" className="grid h-9 w-9 place-items-center rounded-full text-muted hover:text-foreground">
      <Icon />
    </button>
  );
}

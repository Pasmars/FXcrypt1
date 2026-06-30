'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { NAV_ITEMS } from '@/lib/nav';
import { Logo, Mark } from './Logo';
import { InstallAppButton } from './InstallAppButton';
import { ThemeToggle } from './ThemeToggle';
import { Icon } from './Icon';

function Avatar({ initials, size = 38 }: { initials: string; size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-full font-extrabold text-on-accent"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: 'linear-gradient(135deg, rgb(var(--c-brand)), rgb(var(--c-brand-dark)))',
      }}
    >
      {initials || <Icon name="user" size={size * 0.5} />}
    </div>
  );
}

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { user, loading, initials, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-border-2 border-t-brand" />
      </div>
    );
  }

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
              active ? 'bg-surface-2 text-foreground shadow-ring' : 'text-muted hover:bg-surface-2/60 hover:text-foreground'
            }`}
          >
            <Icon name={icon} size={20} className={active ? 'text-brand' : ''} stroke={active ? 2.3 : 2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const primary = NAV_ITEMS.filter((n) => n.primary);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      {/* ── Desktop sidebar ── */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-surface/70 p-4 backdrop-blur-md md:flex">
        <div className="px-2 py-3">
          <Logo />
        </div>
        <div className="mt-4 flex-1">
          <NavLinks />
        </div>
        <ThemeToggle full />
        <div className="px-1 py-2">
          <InstallAppButton context="desktop" />
        </div>
        <div className="mt-2 border-t border-border pt-3">
          <Link href="/profile" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2/60">
            <Avatar initials={initials} size={34} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{user.email}</div>
              <div className="text-xs text-muted">View profile</div>
            </div>
          </Link>
          <button
            onClick={handleLogout}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger-soft"
          >
            <Icon name="logout" size={20} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-h-screen flex-col">
        {/* Mobile top bar */}
        <header className="glass sticky top-0 z-30 flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="text-foreground">
            <Icon name="menu" size={24} />
          </button>
          <Mark size={32} />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link href="/profile" aria-label="Profile">
              <Avatar initials={initials} size={34} />
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
          {title && <h1 className="mb-5 text-2xl font-extrabold tracking-tight">{title}</h1>}
          <div className="animate-fade-in">{children}</div>
        </main>
      </div>

      {/* ── Mobile drawer ── */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 h-full w-72 animate-slide-in border-r border-border bg-surface p-4">
            <div className="flex items-center justify-between px-2 py-2">
              <Logo />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="text-muted">
                <Icon name="x" size={22} />
              </button>
            </div>
            <div className="mt-4">
              <NavLinks onNavigate={() => setDrawer(false)} />
            </div>
            <div className="mt-3">
              <InstallAppButton context="mobile" onDone={() => setDrawer(false)} />
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <Link href="/profile" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2/60">
                <Avatar initials={initials} size={34} />
                <span className="truncate text-sm">{user.email}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="mt-1 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-danger hover:bg-danger-soft"
              >
                <Icon name="logout" size={20} /> Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile bottom nav (fx style with center FAB) ── */}
      <nav className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex items-end justify-around px-2 pb-0.5 pt-2">
          {primary.map(({ href, label, icon, center }) => {
            const active = isActive(href);
            if (center) {
              return (
                <Link key={href} href={href} className="flex -translate-y-2.5 flex-col items-center gap-1">
                  <span className="grid h-[54px] w-[54px] place-items-center rounded-[18px] bg-brand text-on-accent shadow-glow-lg">
                    <Icon name={icon} size={26} stroke={2.4} />
                  </span>
                  <span className="text-[10.5px] font-bold text-muted">{label}</span>
                </Link>
              );
            }
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-1 flex-col items-center gap-1 py-1 ${active ? 'text-brand' : 'text-faint'}`}
              >
                <Icon name={icon} size={23} stroke={active ? 2.4 : 2} fill={active ? 'rgb(var(--c-brand) / 0.18)' : 'none'} />
                <span className={`text-[10.5px] ${active ? 'font-extrabold' : 'font-semibold'}`}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

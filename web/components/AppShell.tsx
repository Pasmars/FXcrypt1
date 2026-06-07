'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { NAV_ITEMS } from '@/lib/nav';
import { Logo } from './Logo';
import { IconMenu, IconClose, IconLogout, IconUser } from './icons';

function Avatar({ initials, size = 38 }: { initials: string; size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-full bg-accent font-bold text-black"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials || <IconUser width={size * 0.5} height={size * 0.5} />}
    </div>
  );
}

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { user, loading, initials, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);

  // Auth guard
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
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
            isActive(href)
              ? 'bg-surface-3 text-foreground shadow-inner'
              : 'text-muted hover:bg-surface-3/60 hover:text-foreground'
          }`}
        >
          <Icon className={isActive(href) ? 'text-brand' : ''} />
          {label}
        </Link>
      ))}
    </nav>
  );

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
        <div className="mt-2 border-t border-border pt-3">
          <Link href="/profile" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-3/60">
            <Avatar initials={initials} size={34} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{user.email}</div>
              <div className="text-xs text-muted">View profile</div>
            </div>
          </Link>
          <button
            onClick={handleLogout}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-danger transition hover:bg-danger-soft"
          >
            <IconLogout /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-h-screen flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/80 px-4 py-3 backdrop-blur-md md:hidden">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="text-foreground">
            <IconMenu width={26} height={26} />
          </button>
          <Logo size={30} />
          <Link href="/profile" aria-label="Profile">
            <Avatar initials={initials} size={34} />
          </Link>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
          {title && <h1 className="mb-5 text-2xl font-bold tracking-tight">{title}</h1>}
          <div className="animate-fade-in">{children}</div>
        </main>
      </div>

      {/* ── Mobile drawer ── */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 h-full w-72 animate-[slide-up_0.2s] border-r border-border bg-surface p-4">
            <div className="flex items-center justify-between px-2 py-2">
              <Logo />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="text-muted">
                <IconClose />
              </button>
            </div>
            <div className="mt-4">
              <NavLinks onNavigate={() => setDrawer(false)} />
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <Link href="/profile" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-3/60">
                <Avatar initials={initials} size={34} />
                <span className="truncate text-sm">{user.email}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="mt-1 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-danger hover:bg-danger-soft"
              >
                <IconLogout /> Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile bottom nav ── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-border bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {NAV_ITEMS.filter((n) => n.primary).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition ${
              isActive(href) ? 'text-brand' : 'text-muted'
            }`}
          >
            <Icon width={22} height={22} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

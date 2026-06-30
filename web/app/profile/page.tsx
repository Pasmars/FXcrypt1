'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/ui';
import { Icon, IconName } from '@/components/Icon';
import { useAuth } from '@/lib/auth';
import { useTheme, useAccent, ACCENTS } from '@/components/ThemeToggle';

export default function ProfilePage() {
  const { user, profile, initials, signOut } = useAuth();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || user?.displayName || '—';
  const created = user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString() : '—';

  return (
    <AppShell>
      <div className="mx-auto max-w-xl space-y-4">
        {/* Identity */}
        <div className="flex items-center gap-4 px-1 pb-1">
          <div
            className="grid h-16 w-16 place-items-center rounded-full text-2xl font-extrabold text-on-accent"
            style={{ background: 'linear-gradient(135deg, rgb(var(--c-brand)), rgb(var(--c-brand-dark)))' }}
          >
            {initials || <Icon name="user" size={28} />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xl font-extrabold">{fullName}</div>
            <div className="truncate text-sm text-muted">{user?.email}</div>
          </div>
        </div>

        {/* Appearance — theme + accent */}
        <div>
          <GroupLabel>Appearance</GroupLabel>
          <Card pad="p-4">
            {/* Theme */}
            <div className="mb-4 flex items-center gap-3">
              <RowIcon name="eye" />
              <span className="flex-1 text-[14.5px] font-semibold">Theme</span>
              <span className="text-[13px] font-semibold capitalize text-muted">{theme}</span>
            </div>
            <div className="mb-5 flex gap-3">
              {(['light', 'dark'] as const).map((mode) => {
                const on = theme === mode;
                const bg = mode === 'dark' ? '#0B0E11' : '#FFFFFF';
                const bar = mode === 'dark' ? '#1E2329' : '#F0F2F5';
                const fg = mode === 'dark' ? '#EAECEF' : '#1E2329';
                return (
                  <button key={mode} onClick={() => setTheme(mode)} className="flex-1">
                    <div
                      className="relative h-[78px] overflow-hidden rounded-xl transition"
                      style={{ background: bg, boxShadow: on ? '0 0 0 2.5px rgb(var(--c-brand))' : 'inset 0 0 0 1.5px rgb(var(--c-border-2))' }}
                    >
                      <div className="absolute left-2.5 right-2.5 top-2.5 h-2 rounded" style={{ background: bar }} />
                      <div className="absolute left-2.5 top-6 h-[7px] w-7 rounded" style={{ background: 'rgb(var(--c-brand))' }} />
                      <div className="absolute right-2.5 top-6 h-[7px] rounded" style={{ left: 46, background: bar }} />
                      <div
                        className="absolute bottom-2.5 left-2.5 right-2.5 flex h-[13px] items-center justify-around rounded"
                        style={{ background: bar }}
                      >
                        <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'rgb(var(--c-brand))' }} />
                        <span className="h-[5px] w-[5px] rounded-full" style={{ background: fg, opacity: 0.4 }} />
                        <span className="h-[5px] w-[5px] rounded-full" style={{ background: fg, opacity: 0.4 }} />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-center gap-1.5">
                      {on && <Icon name="checkCircle" size={15} className="text-brand" />}
                      <span className={`text-[13px] capitalize ${on ? 'font-extrabold' : 'font-semibold text-muted'}`}>{mode}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Accent */}
            <div className="mb-3 flex items-center gap-3 border-t border-border pt-4">
              <RowIcon name="spark" />
              <span className="flex-1 text-[14.5px] font-semibold">Accent color</span>
              <span className="text-[13px] font-semibold text-muted">{ACCENTS.find((a) => a.key === accent)?.name}</span>
            </div>
            <div className="flex items-center gap-4">
              {ACCENTS.map((s) => {
                const on = accent === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setAccent(s.key)}
                    aria-label={s.name}
                    className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full transition active:scale-90"
                    style={{
                      background: s.hex,
                      boxShadow: on
                        ? `0 0 0 2px rgb(var(--c-surface)), 0 0 0 4px ${s.hex}`
                        : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
                    }}
                  >
                    {on && (
                      <Icon name="check" size={15} stroke={3.2} style={{ color: s.key === 'gold' ? '#0B0E11' : '#fff' }} />
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Account */}
        <div>
          <GroupLabel>Account</GroupLabel>
          <Card pad="p-0" className="overflow-hidden">
            <InfoRow label="Name" value={fullName} />
            <InfoRow label="Email" value={user?.email || '—'} />
            <InfoRow label="Member since" value={created} last />
          </Card>
        </div>

        {/* Quick links */}
        <div>
          <GroupLabel>Trading</GroupLabel>
          <Card pad="p-0" className="overflow-hidden">
            <LinkRow href="/wallet" icon="wallet" label="Wallet" detail="Multi-chain" />
            <LinkRow href="/agent" icon="robot" label="CEX Bot" detail="Signals" />
            <LinkRow href="/bot" icon="swap" label="DEX Bot" detail="Gem scanner" />
            <LinkRow href="/tracker" icon="trend" label="Tracker" detail="Holders" last />
          </Card>
        </div>

        {/* Sign out */}
        <Card pad="p-0" className="overflow-hidden">
          <button
            onClick={async () => {
              await signOut();
              router.replace('/login');
            }}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
          >
            <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-danger-soft text-danger">
              <Icon name="logout" size={18} />
            </div>
            <span className="flex-1 text-[14.5px] font-semibold text-danger">Sign out</span>
          </button>
        </Card>

        <div className="pb-2 text-center text-xs text-faint">FXcrypt · web · PWA · Android</div>
      </div>
    </AppShell>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 ml-1 text-xs font-bold uppercase tracking-wide text-muted">{children}</div>;
}
function RowIcon({ name }: { name: IconName }) {
  return (
    <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-surface-2 text-brand">
      <Icon name={name} size={18} />
    </div>
  );
}
function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3.5 ${last ? '' : 'border-b border-border'}`}>
      <span className="text-sm text-muted">{label}</span>
      <span className="truncate text-right text-sm font-semibold">{value}</span>
    </div>
  );
}
function LinkRow({ href, icon, label, detail, last }: { href: string; icon: IconName; label: string; detail?: string; last?: boolean }) {
  return (
    <Link href={href} className={`flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2/50 ${last ? '' : 'border-b border-border'}`}>
      <RowIcon name={icon} />
      <span className="flex-1 text-[14.5px] font-semibold">{label}</span>
      {detail && <span className="text-[13px] text-muted">{detail}</span>}
      <Icon name="chevR" size={17} className="text-faint" />
    </Link>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Card, Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function ProfilePage() {
  const { user, profile, initials, signOut } = useAuth();
  const router = useRouter();

  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || user?.displayName || '—';

  return (
    <AppShell title="My Profile">
      <Card>
        <div className="flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-accent text-3xl font-bold text-black">
            {initials}
          </div>
          <h2 className="mt-4 text-lg font-bold">{fullName}</h2>
          <p className="break-all text-sm text-muted">{user?.email}</p>
        </div>

        <div className="mt-6 space-y-1 rounded-xl bg-surface-3/60 p-4">
          <Row label="Name" value={fullName} />
          <Row label="Email" value={user?.email || '—'} />
          <Row label="Account created" value={user?.metadata?.creationTime || '—'} />
          <Row label="Last sign-in" value={user?.metadata?.lastSignInTime || '—'} />
        </div>

        <Button
          variant="ghost"
          className="mt-6 w-full text-danger"
          onClick={async () => {
            await signOut();
            router.replace('/login');
          }}
        >
          Logout
        </Button>
      </Card>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="truncate text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

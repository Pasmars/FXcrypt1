import { Card } from './ui';

export function ComingSoon({ feature }: { feature: string }) {
  return (
    <Card className="text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-3 text-2xl">🚧</div>
      <h2 className="text-lg font-bold">{feature} — migration in progress</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        This screen is being ported to the new React&nbsp;+&nbsp;Next.js app. The backend stays live, so the existing
        version keeps working while we finish the redesign here.
      </p>
    </Card>
  );
}

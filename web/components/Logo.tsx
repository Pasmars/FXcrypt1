// fx geometric mark + wordmark (ported from fx ui.jsx).

export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} style={{ flexShrink: 0, display: 'block' }}>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="rgb(var(--c-brand))" />
      <path
        d="M11 10h11M11 16h8M11 22V10"
        stroke="rgb(var(--c-on-accent))"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="21.5" cy="21" r="2.4" fill="rgb(var(--c-on-accent))" />
    </svg>
  );
}

export function Logo({ size = 34, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Mark size={size} />
      {withText && (
        <span className="text-lg font-extrabold tracking-tight text-foreground" style={{ letterSpacing: '-0.6px' }}>
          FX<span className="text-brand">crypt</span>
        </span>
      )}
    </div>
  );
}

'use client';

import { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, ReactNode, forwardRef } from 'react';

function cx(...c: (string | false | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ── Button ──────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'accent' | 'ghost';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}
export function Button({ variant = 'primary', loading, className, children, disabled, ...rest }: BtnProps) {
  const map: Record<Variant, string> = {
    primary: 'btn-primary',
    accent: 'btn-accent',
    ghost: 'btn-ghost'
  };
  return (
    <button className={cx(map[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />}
      {children}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('card p-5 sm:p-6', className)}>{children}</div>;
}

// ── Label ───────────────────────────────────────────────────────────────────
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="label-base">
      {children}
    </label>
  );
}

// ── Input ───────────────────────────────────────────────────────────────────
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx('input-base', className)} {...rest} />;
  }
);

// ── Select ──────────────────────────────────────────────────────────────────
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx('input-base appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
    );
  }
);

// ── Segmented control (long/short, buy/sell) ────────────────────────────────
export function Segmented({
  options,
  value,
  onChange
}: {
  options: { value: string; label: string; tone?: 'success' | 'danger' }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-border bg-surface-2">
      {options.map((o) => {
        const active = o.value === value;
        const tone = o.tone === 'danger' ? 'text-danger' : 'text-success';
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cx(
              'flex-1 px-4 py-2.5 text-sm font-semibold transition',
              active
                ? (o.tone === 'danger' ? 'bg-danger-soft ' : 'bg-success-soft ') + tone
                : 'text-muted hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

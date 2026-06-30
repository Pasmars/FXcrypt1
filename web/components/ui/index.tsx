'use client';

import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Portal } from '../Portal';
import { Icon, IconName } from '../Icon';

export function cx(...c: (string | false | undefined | null)[]) {
  return c.filter(Boolean).join(' ');
}

// ── Button ──────────────────────────────────────────────────────────────────
// `variant` keeps back-compat names (primary/accent/ghost) and adds fx kinds.
type Variant = 'primary' | 'deep' | 'accent' | 'up' | 'down' | 'soft' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  full?: boolean;
  loading?: boolean;
}
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-on-accent font-bold shadow-glow hover:brightness-95',
  deep: 'bg-brand-deep text-white font-bold hover:brightness-95',
  accent: 'bg-brand-deep text-white font-bold hover:brightness-95',
  up: 'bg-up text-white font-bold hover:brightness-95',
  down: 'bg-down text-white font-bold hover:brightness-95',
  soft: 'bg-chip text-foreground font-semibold hover:brightness-95',
  ghost: 'bg-transparent text-text-2 font-semibold shadow-ring hover:bg-surface-2',
  outline: 'bg-transparent text-brand font-bold shadow-[inset_0_0_0_1.5px_rgb(var(--c-brand))] hover:bg-brand/5',
};
const SIZE: Record<Size, string> = {
  sm: 'min-h-9 px-3.5 text-[13px] gap-1.5',
  md: 'min-h-[46px] px-[18px] text-[15px] gap-2',
  lg: 'min-h-[54px] px-[22px] text-base gap-2',
};
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  full,
  loading,
  className,
  children,
  disabled,
  ...rest
}: BtnProps) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center rounded-xl tracking-[0.1px] transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        full && 'w-full',
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />}
      {!loading && icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
    </button>
  );
}

// ── IconBtn (square icon button, used in top bars) ──────────────────────────
export function IconBtn({
  name,
  badge,
  active,
  size = 20,
  className,
  ...rest
}: { name: IconName; badge?: boolean; active?: boolean; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        'relative grid h-10 w-10 shrink-0 place-items-center rounded-xl transition',
        active ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-text-2 hover:text-foreground',
        className
      )}
      {...rest}
    >
      <Icon name={name} size={size} />
      {badge && <span className="absolute right-[7px] top-[7px] h-2 w-2 rounded-full bg-down ring-2 ring-base" />}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({
  className,
  children,
  onClick,
  pad,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  pad?: string;
}) {
  return (
    <div onClick={onClick} className={cx('card', pad ?? 'p-4 sm:p-5', onClick && 'cursor-pointer', className)}>
      {children}
    </div>
  );
}

// ── Pill (small status badge) ───────────────────────────────────────────────
type Tone = 'up' | 'down' | 'accent' | 'muted';
const PILL: Record<Tone, string> = {
  up: 'bg-up-soft text-up',
  down: 'bg-down-soft text-down',
  accent: 'bg-brand/15 text-brand',
  muted: 'bg-chip text-muted',
};
export function Pill({ children, tone = 'muted', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[7px] px-2 py-[3px] text-xs font-bold',
        PILL[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ── Chip (selectable filter pill) ───────────────────────────────────────────
export function Chip({
  children,
  active,
  icon,
  className,
  ...rest
}: { children: ReactNode; active?: boolean; icon?: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-[7px] text-[13px] font-semibold transition',
        active ? 'bg-brand text-on-accent' : 'bg-chip text-text-2 hover:text-foreground',
        className
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}

// ── Change (signed percent, colored) ────────────────────────────────────────
export function Change({ v, size = 13 }: { v: number; size?: number }) {
  const up = v >= 0;
  return (
    <span
      className={cx('font-bold tabular-nums', up ? 'text-up' : 'text-down')}
      style={{ fontSize: size }}
    >
      {(up ? '+' : '') + v.toFixed(2)}%
    </span>
  );
}

// ── Label / Input / Select ──────────────────────────────────────────────────
export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="label-base">
      {children}
    </label>
  );
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx('input-base', className)} {...rest} />;
  }
);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx('input-base appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
    );
  }
);

// ── Segmented control ───────────────────────────────────────────────────────
// Active segment uses accent fill by default; tone (success/danger) tints it.
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; tone?: 'success' | 'danger' }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-xl bg-surface-2 p-1">
      {options.map((o) => {
        const active = o.value === value;
        const toneCls = !active
          ? 'text-muted hover:text-foreground'
          : o.tone === 'danger'
          ? 'bg-down-soft text-down'
          : o.tone === 'success'
          ? 'bg-up-soft text-up'
          : 'bg-brand text-on-accent';
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cx('flex-1 rounded-[9px] px-3 py-2.5 text-[13px] font-bold transition', toneCls)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── SecHead (section header with optional action) ───────────────────────────
export function SecHead({ children, action, onAction }: { children: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="my-1 flex items-center justify-between">
      <div className="text-[17px] font-extrabold tracking-[-0.2px]">{children}</div>
      {action && (
        <button onClick={onAction} className="flex items-center gap-0.5 text-[13px] font-semibold text-brand">
          {action} <Icon name="chevR" size={14} />
        </button>
      )}
    </div>
  );
}

// ── TokenLogo (colored dot with symbol initials + optional chain badge) ─────
export function TokenLogo({
  color = '#888',
  sym = '',
  size = 38,
  chainColor,
}: {
  color?: string;
  sym?: string;
  size?: number;
  chainColor?: string;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="grid h-full w-full place-items-center rounded-full font-extrabold text-[#0B0E11]"
        style={{ background: color, fontSize: size * 0.36, letterSpacing: -0.5, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}
      >
        {sym.slice(0, 2)}
      </div>
      {chainColor && (
        <div
          className="absolute rounded-full border-2 border-surface"
          style={{ right: -2, bottom: -2, width: size * 0.42, height: size * 0.42, background: chainColor }}
        />
      )}
    </div>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────
export function Sparkline({ data, up, w = 80, h = 28, fill = true }: { data: number[]; up: boolean; w?: number; h?: number; fill?: boolean }) {
  const idRef = useRef('sp' + Math.random().toString(36).slice(2));
  if (!data || !data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const col = up ? 'rgb(var(--c-success))' : 'rgb(var(--c-danger))';
  const id = idRef.current;
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={col} stopOpacity="0.28" />
            <stop offset="1" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Sheet (bottom sheet / modal) ────────────────────────────────────────────
export function Sheet({
  open,
  onClose,
  title,
  children,
  height,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  height?: number | string;
}) {
  const [show, setShow] = useState(open);
  useEffect(() => {
    if (open) setShow(true);
  }, [open]);
  if (!show && !open) return null;
  return (
    <Portal>
      <div
        onClick={onClose}
        onTransitionEnd={() => {
          if (!open) setShow(false);
        }}
        className="fixed inset-0 z-[200] flex items-end justify-center backdrop-blur-[2px] transition-opacity duration-300"
        style={{ background: 'rgb(var(--c-overlay) / 0.6)', opacity: open ? 1 : 0 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex w-full max-w-lg flex-col rounded-t-3xl bg-base-2 pb-7 shadow-sheet"
          style={{
            transform: open ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform .3s cubic-bezier(.32,.72,0,1)',
            maxHeight: '90%',
            height,
          }}
        >
          <div className="flex justify-center pb-1 pt-2.5">
            <div className="h-[4.5px] w-10 rounded-full bg-border-2" />
          </div>
          {title && (
            <div className="flex items-center justify-between px-[18px] pb-2.5 pt-1.5">
              <div className="text-lg font-extrabold">{title}</div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-[30px] w-[30px] place-items-center rounded-full bg-chip text-muted"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          )}
          <div className="overflow-y-auto px-[18px]">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ── Skeleton (loading shimmer) ──────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cx('relative overflow-hidden rounded-lg bg-surface-2', className)}>
      <div
        className="absolute inset-0 -translate-x-full"
        style={{
          background: 'linear-gradient(90deg, transparent, rgb(var(--c-shimmer) / 0.06), transparent)',
          animation: 'fxsweep 1.4s infinite',
        }}
      />
    </div>
  );
}

// fmt helpers (mirrors fx ui.jsx)
export function fmtUsd(n: number | null | undefined, dp?: number) {
  if (n == null) return '—';
  if (n === 0) return '$0.00';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: dp ?? 2, minimumFractionDigits: dp ?? 2 });
  if (n >= 1) return '$' + n.toFixed(dp ?? 2);
  if (n >= 0.001) return '$' + n.toFixed(4);
  return '$' + n.toFixed(8);
}
export function pct(n: number) {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

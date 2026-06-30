import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware tokens — values come from CSS variables (see globals.css)
        // so the same classes adapt to dark/light. Channels are space-separated
        // RGB to support Tailwind's /opacity modifiers.
        base: 'rgb(var(--c-base) / <alpha-value>)',
        'base-2': 'rgb(var(--c-base-2) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--c-surface-2) / <alpha-value>)',
        'surface-3': 'rgb(var(--c-surface-3) / <alpha-value>)',
        elevated: 'rgb(var(--c-elevated) / <alpha-value>)',
        chip: 'rgb(var(--c-chip) / <alpha-value>)',
        border: 'rgb(var(--c-border) / <alpha-value>)',
        'border-2': 'rgb(var(--c-border-2) / <alpha-value>)',
        foreground: 'rgb(var(--c-foreground) / <alpha-value>)',
        'text-2': 'rgb(var(--c-text-2) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        faint: 'rgb(var(--c-faint) / <alpha-value>)',
        // Brand / accent (switchable via data-accent)
        brand: {
          DEFAULT: 'rgb(var(--c-brand) / <alpha-value>)',
          dark: 'rgb(var(--c-brand-dark) / <alpha-value>)',
          deep: 'rgb(var(--c-brand-dark) / <alpha-value>)'
        },
        'on-accent': 'rgb(var(--c-on-accent) / <alpha-value>)',
        // Market direction
        success: { DEFAULT: 'rgb(var(--c-success) / <alpha-value>)', soft: 'rgb(var(--c-success) / 0.14)' },
        danger: { DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)', soft: 'rgb(var(--c-danger) / 0.14)' },
        up: { DEFAULT: 'rgb(var(--c-success) / <alpha-value>)', soft: 'rgb(var(--c-success) / 0.14)' },
        down: { DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)', soft: 'rgb(var(--c-danger) / 0.14)' },
        accent: { DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)', dark: 'rgb(var(--c-accent-dark) / <alpha-value>)' }
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        // 1px inset hairline that adapts to theme (replaces literal borders)
        ring: 'inset 0 0 0 1px rgb(var(--c-border))',
        'ring-2': 'inset 0 0 0 1.5px rgb(var(--c-border-2))',
        glow: '0 0 0 1px rgb(var(--c-brand) / 0.25), 0 8px 30px rgb(var(--c-brand) / 0.10)',
        'glow-lg': '0 8px 22px rgb(var(--c-brand) / 0.30)',
        card: '0 4px 24px rgba(0,0,0,0.35)',
        'card-hover': '0 12px 40px rgba(0,0,0,0.45)',
        sheet: '0 -8px 40px rgba(0,0,0,0.4)'
      },
      borderRadius: {
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '22px'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'slide-in': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'sheet-up': { from: { transform: 'translateY(40px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        pop: { from: { transform: 'scale(0.6)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } }
      },
      animation: {
        'fade-in': 'fade-in 0.35s ease both',
        'slide-up': 'slide-up 0.25s ease both',
        'slide-in': 'slide-in 0.25s cubic-bezier(.32,.72,0,1) both',
        'sheet-up': 'sheet-up 0.35s cubic-bezier(.32,.72,0,1) both',
        pop: 'pop 0.3s cubic-bezier(.32,.72,0,1) both'
      }
    }
  },
  plugins: []
};

export default config;

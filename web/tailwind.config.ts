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
        // Core surfaces (Binance-dark inspired, refreshed)
        base: '#0B0E11',
        surface: '#161A1E',
        'surface-2': '#1E2329',
        'surface-3': '#2B3139',
        border: '#2B3139',
        'border-2': '#363C45',
        foreground: '#EAECEF',
        muted: '#848E9C',
        // Brand
        brand: { DEFAULT: '#FCD535', dark: '#E0BC1E' },
        success: { DEFAULT: '#0ECB81', soft: 'rgba(14,203,129,0.12)' },
        danger: { DEFAULT: '#F6465D', soft: 'rgba(246,70,93,0.12)' },
        accent: { DEFAULT: '#00c853', dark: '#00a844' }
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(252,213,53,0.25), 0 8px 30px rgba(252,213,53,0.10)',
        card: '0 4px 24px rgba(0,0,0,0.35)',
        'card-hover': '0 12px 40px rgba(0,0,0,0.45)'
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px'
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } }
      },
      animation: {
        'fade-in': 'fade-in 0.35s ease both',
        'slide-up': 'slide-up 0.25s ease both'
      }
    }
  },
  plugins: []
};

export default config;

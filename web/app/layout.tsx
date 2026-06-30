import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'FXcrypt — Track & Trade On-Chain',
  description: 'Calculate PnL, track tokens & wallets, visualize holders and automate DEX trades.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ],
    apple: '/icons/apple-touch-icon.png'
  },
  appleWebApp: {
    capable: true,
    title: 'FXcrypt',
    statusBarStyle: 'black-translucent'
  }
};

export const viewport: Viewport = {
  themeColor: '#0B0E11',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans">
        {/* No-flash theme + accent: applied before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');document.documentElement.classList.add(t==='light'?'light':'dark');var a=localStorage.getItem('accent')||'gold';document.documentElement.setAttribute('data-accent',a);}catch(e){document.documentElement.classList.add('dark');document.documentElement.setAttribute('data-accent','gold');}})();`
          }}
        />
        <Providers>{children}</Providers>
        <Script id="sw-register" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) {
              window.addEventListener('load', function () {
                navigator.serviceWorker.register('/sw.js').catch(function () {});
              });
            }`}
        </Script>
      </body>
    </html>
  );
}

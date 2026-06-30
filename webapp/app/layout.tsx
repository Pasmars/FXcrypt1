import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ClientRoot } from './providers';

export const metadata: Metadata = {
  title: 'FXcrypt — AI Trading App',
  description: 'Track & trade on-chain: PnL, token & wallet tracking, holder bubble maps and automated DEX trades.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'FXcrypt', statusBarStyle: 'black-translucent' },
};
export const viewport: Viewport = {
  themeColor: '#0B0E11',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}

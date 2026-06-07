import { IconCalc, IconPrices, IconTracker, IconBot, IconAgent, IconWallet } from '@/components/icons';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof IconCalc;
  primary?: boolean; // shown in mobile bottom bar
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'PnL Calc', icon: IconCalc, primary: true },
  { href: '/prices', label: 'Prices', icon: IconPrices, primary: true },
  { href: '/tracker', label: 'Tracker', icon: IconTracker, primary: true },
  { href: '/bot', label: 'DEX Bot', icon: IconBot, primary: true },
  { href: '/agent', label: 'AI Agent', icon: IconAgent },
  { href: '/wallet', label: 'Wallet', icon: IconWallet }
];

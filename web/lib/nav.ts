import { IconName } from '@/components/Icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  primary?: boolean; // shown in mobile bottom bar
  center?: boolean; // center FAB in mobile bottom bar
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/pointer', label: 'Pointer', icon: 'spark', primary: true },
  { href: '/prices', label: 'Markets', icon: 'candles', primary: true },
  { href: '/bot', label: 'Trade', icon: 'swap', primary: true, center: true },
  { href: '/agent', label: 'Signals', icon: 'robot', primary: true },
  { href: '/wallet', label: 'Wallet', icon: 'wallet', primary: true },
  // secondary — sidebar / drawer only
  { href: '/', label: 'PnL Calc', icon: 'calc' },
  { href: '/tracker', label: 'Tracker', icon: 'trend' },
];

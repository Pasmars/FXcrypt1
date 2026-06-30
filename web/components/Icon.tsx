// Icon.tsx — fx design line-icon set (24×24, currentColor stroke).
// Ported from the fx standalone design (theme.jsx PATHS).
import { CSSProperties } from 'react';

export const ICON_PATHS = {
  pointer: '<path d="M12 3a4 4 0 0 1 4 4 4 4 0 0 1-1.2 2.9L12 13l-2.8-3.1A4 4 0 0 1 8 7a4 4 0 0 1 4-4Z"/><path d="M5 20c0-3 3-5 7-5s7 2 7 5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2Z"/>',
  candles: '<path d="M6 4v3M6 15v5M6 7h0a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1 1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><path d="M13 8v2M13 17v3M13 10a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0v-5a1 1 0 0 1 1-1Z"/><path d="M20 4v4M20 14v4M20 8a1 1 0 0 1 1 1v4a1 1 0 0 1-2 0V9a1 1 0 0 1 1-1Z"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5a2 2 0 0 0-2 2"/><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="16.5" cy="13" r="1.3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7Z"/>',
  receive: '<path d="M12 5v14"/><path d="M5 12l7 7 7-7"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17.5 17.5h.01M21 17.5v3.5h-3.5"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M3 12h18"/>',
  swap: '<path d="M7 4v13M7 4L3 8M7 4l4 4M17 20V7M17 20l4-4M17 20l-4-4"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  chevL: '<path d="M15 6l-6 6 6 6"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  chevU: '<path d="M6 15l6-6 6 6"/>',
  arrowUR: '<path d="M7 17L17 7M9 7h8v8"/>',
  arrowDR: '<path d="M7 7l10 10M17 9v8H9"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="M9 12l2 2 4-4"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8Z"/>',
  flame: '<path d="M12 2c2 4 5 5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.7 1.4-3.6C8.8 8 9 9 10 9.5 10 7 11 4 12 2Z"/>',
  crown: '<path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7Z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z"/>',
  robot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/><circle cx="12" cy="4" r="1.5"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v5h-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/>',
  telegram: '<path d="M21 4L3 11l5 2 2 6 3-4 5 4 3-15Z"/><path d="M8 13l8-5"/>',
  discord: '<path d="M8 6a14 14 0 0 1 8 0l1 2a10 10 0 0 1 3 9 13 13 0 0 1-4 2l-1-2M16 17a13 13 0 0 1-8 0l-1 2a13 13 0 0 1-4-2 10 10 0 0 1 3-9l1-2"/><circle cx="9.5" cy="13" r="1"/><circle cx="14.5" cy="13" r="1"/>',
  fingerprint: '<path d="M12 5a7 7 0 0 1 7 7M5 12a7 7 0 0 1 7-7M12 9a3 3 0 0 1 3 3v2M9 12a3 3 0 0 1 3-3M12 14v3M8 14v2M16 14v3"/>',
  alert: '<path d="M12 3l9 16H3l9-16Z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  gas: '<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M5 11h10M17 8l2 2v7a2 2 0 0 0 2-2v-6l-3-3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 4v4h4"/><path d="M12 8v4l3 2"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>',
  link: '<path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"/>',
  external: '<path d="M15 3h6v6M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  dollar: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14v4M8 18h4"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  size = 22,
  stroke = 2,
  fill = 'none',
  className,
  style,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  fill?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] || '' }}
    />
  );
}

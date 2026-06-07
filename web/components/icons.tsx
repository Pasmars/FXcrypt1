import { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p
});

export const IconCalc = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <line x1="8" y1="6" x2="16" y2="6" />
    <line x1="8" y1="10" x2="8" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="16" y1="10" x2="16" y2="10" />
    <line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="16" y1="14" x2="16" y2="18" />
  </svg>
);
export const IconPrices = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 17l6-6 4 4 7-7" /><path d="M21 8v4h-4" />
  </svg>
);
export const IconTracker = (p: P) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><circle cx="17" cy="6" r="2" />
    <path d="M9.5 8.5l5 6" /><path d="M9 6h5" />
  </svg>
);
export const IconBot = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V5" /><circle cx="12" cy="4" r="1" />
    <line x1="9" y1="13" x2="9" y2="13" /><line x1="15" y1="13" x2="15" y2="13" />
  </svg>
);
export const IconAgent = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l1.6 3.6L17 8l-3.4 1.4L12 13l-1.6-3.6L7 8l3.4-1.4z" /><path d="M19 14l.8 1.8L22 17l-2.2.9L19 20l-.8-2.1L16 17l2.2-1.2z" />
  </svg>
);
export const IconWallet = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="17" cy="14" r="1.3" />
  </svg>
);
export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
  </svg>
);
export const IconMenu = (p: P) => (
  <svg {...base(p)}>
    <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);
export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);
export const IconLogout = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><line x1="5" y1="12" x2="15" y2="12" />
  </svg>
);

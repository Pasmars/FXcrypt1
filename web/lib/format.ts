// Shared formatters ported from the legacy app.
export function fmtNum(n: number | null | undefined): string {
  if (n == null) return 'N/A';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function fmtUSD(n: number | null | undefined): string {
  if (n == null) return 'N/A';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${Number(n).toFixed(2)}`;
}

export function fmtPrice(p: number | string | null | undefined): string {
  if (!p) return 'N/A';
  const n = parseFloat(String(p));
  if (isNaN(n)) return 'N/A';
  if (n < 0.000001) return `$${n.toExponential(4)}`;
  if (n < 0.01) return `$${n.toFixed(8)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

export function shortAddr(a?: string): string {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

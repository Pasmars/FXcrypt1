'use client';

import { useEffect, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Renders children into document.body so fixed-position overlays escape any
// ancestor that establishes a containing block (transform / filter / etc.).
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

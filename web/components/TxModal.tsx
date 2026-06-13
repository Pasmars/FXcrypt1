'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TxData {
  id: number;
  steps: string[];
  status: 'processing' | 'success' | 'error';
  title?: string;
  subtitle?: string;
  tokenName: string;
  tokenMeta: string;
  result?: { hash?: string; explorer?: string; orderId?: string; sizeUsd?: string; errorMsg?: string };
}

// Shared 4-step processing popup for gem buys and agent trade approvals.
export function TxModal({ tx, onClose }: { tx: TxData | null; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Portal target only exists in the browser
  useEffect(() => { setMounted(true); }, []);

  // Lock background scroll while the modal is open
  useEffect(() => {
    if (!tx) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [tx]);

  // Animate steps 0 → 1 → 2 while processing (per new tx id)
  useEffect(() => {
    if (!tx || tx.status !== 'processing') return;
    setStep(0);
    const t1 = setTimeout(() => setStep(1), 400);
    const t2 = setTimeout(() => setStep(2), 1800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [tx?.id, tx?.status]);

  // Auto-close on success
  useEffect(() => {
    if (tx?.status === 'success') {
      const t = setTimeout(onClose, 6000);
      return () => clearTimeout(t);
    }
  }, [tx?.status, onClose]);

  if (!tx || !mounted) return null;
  const success = tx.status === 'success';
  const error = tx.status === 'error';
  const activeStep = success ? tx.steps.length : error ? 2 : step;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative max-h-[90dvh] w-full max-w-md animate-slide-up overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center sm:max-h-[88vh] sm:rounded-2xl sm:pb-6">
        <button onClick={onClose} className="absolute right-4 top-4 text-xl leading-none text-muted hover:text-foreground">×</button>

        {/* Icon */}
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full">
          {success ? (
            <span className="grid h-16 w-16 place-items-center rounded-full bg-success-soft text-3xl">✅</span>
          ) : error ? (
            <span className="grid h-16 w-16 place-items-center rounded-full bg-danger-soft text-3xl">❌</span>
          ) : (
            <span className="h-12 w-12 animate-spin rounded-full border-[3px] border-border-2 border-t-brand" />
          )}
        </div>

        <h3 className={`text-lg font-bold ${success ? 'text-success' : error ? 'text-danger' : 'text-foreground'}`}>
          {tx.title || (success ? 'Confirmed!' : error ? 'Failed' : 'Processing…')}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {tx.subtitle || (success ? 'Submitted successfully.' : error ? 'Something went wrong. See below.' : 'Please wait…')}
        </p>

        {/* Token chip */}
        <div className="mx-auto mt-4 flex w-fit flex-col items-center gap-0.5 rounded-xl bg-surface-2 px-5 py-2.5">
          <span className="text-sm font-bold">{tx.tokenName}</span>
          <span className="text-xs text-muted">{tx.tokenMeta}</span>
        </div>

        {/* Steps */}
        <div className="mt-5 flex items-start justify-between px-2">
          {tx.steps.map((label, i) => {
            const done = i < activeStep;
            const active = i === activeStep && !success && !error;
            const failed = error && i === tx.steps.length - 1;
            return (
              <div key={label} className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  <div className={`hidden h-0.5 flex-1 ${i === 0 ? 'opacity-0' : done || (error && i <= 2) ? 'bg-success' : 'bg-border-2'} sm:block`} />
                  <div className={`mx-auto grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${
                    failed ? 'bg-danger text-white' : done ? 'bg-success text-black' : active ? 'bg-brand text-black' : 'bg-surface-3 text-muted'
                  }`}>
                    {failed ? '✕' : done ? '✓' : i + 1}
                  </div>
                  <div className={`hidden h-0.5 flex-1 ${i === tx.steps.length - 1 ? 'opacity-0' : done ? 'bg-success' : 'bg-border-2'} sm:block`} />
                </div>
                <span className={`mt-1.5 text-[10px] ${done || active ? 'text-foreground' : 'text-muted'}`}>{label}</span>
              </div>
            );
          })}
        </div>

        {/* Result */}
        {success && tx.result && (
          <div className="mt-5 space-y-1 text-sm">
            {tx.result.orderId && <div className="text-muted">Order ID: <span className="text-foreground">{tx.result.orderId}</span></div>}
            {tx.result.sizeUsd && <div className="text-muted">Size: <span className="text-success">~${tx.result.sizeUsd} USDT</span></div>}
            {tx.result.hash && (
              <a href={(tx.result.explorer || '') + tx.result.hash} target="_blank" rel="noopener" className="inline-block text-brand underline">
                {tx.result.hash.slice(0, 8)}…{tx.result.hash.slice(-6)} ↗
              </a>
            )}
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-success" style={{ animation: 'shrinkbar 6s linear forwards' }} />
            </div>
          </div>
        )}
        {error && <div className="mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{tx.result?.errorMsg || 'Unknown error'}</div>}

        {(success || error) && (
          <button onClick={onClose} className="btn-ghost mt-4 w-full">Dismiss</button>
        )}
      </div>
    </div>,
    document.body
  );
}

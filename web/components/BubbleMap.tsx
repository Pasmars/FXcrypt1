'use client';

import { useEffect, useRef } from 'react';

// Wraps the imperative bubble-map canvas engine (lib/bubblemap.ts).
// The engine builds its own DOM into #bubbleMapWrap and wires the controls below.
export function BubbleMap() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    import('@/lib/bubblemap').then((m) => m.initBubbleMap()).catch(console.error);
  }, []);

  return (
    <div>
      <div className="mb-4 rounded-2xl border border-border bg-surface-2 p-4">
        <div className="chain-pills no-scrollbar" id="bubbleChainPills">
          <button className="chain-pill bsc active" data-chain="bsc">BSC</button>
          <button className="chain-pill eth" data-chain="eth">ETH</button>
          <button className="chain-pill base" data-chain="base">BASE</button>
          <button className="chain-pill sol" data-chain="sol">SOL</button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input type="text" id="bubbleAddressInput" className="tracker-input" placeholder="Paste token contract address…" />
          <button id="generateMapBtn" className="tracker-action-btn">Generate Map</button>
        </div>
      </div>
      <div id="bubbleMapWrap" />
    </div>
  );
}

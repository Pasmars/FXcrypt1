// trade.jsx — DEX Bot manual trade + Gem Scanner
const { useState: tS, useEffect: tE } = React;

// ─── Token picker: search any tradable token by name, ticker or contract ───
// DexScreener's search endpoint handles all three query kinds; results are
// filtered to the chains the DEX bot can actually execute on.
const PICK_CHAIN_MAP = { bsc: 'bsc', ethereum: 'eth', solana: 'sol', base: 'base', robinhood: 'rhood' };
// Chains the trading engine can actually execute on (mirrors the backend's
// validateChain + trader.js routers). A token on any other chain must never be
// sent to the router — the trade would target the wrong network.
const TRADE_CHAINS = ['sol', 'eth', 'bsc', 'base', 'rhood'];
// CoinGecko platform slug → executable chain key (canonical-contract resolution
// for curated market coins that arrive without a contract address).
const CG_PLATFORM_CHAIN = { ethereum: 'eth', 'binance-smart-chain': 'bsc', base: 'base', solana: 'sol', robinhood: 'rhood' };
// Session cache: cg id → resolved { ch, addr } (or null = known-unresolvable,
// e.g. BTC). Contracts don't move, and caching keeps repeat trade opens off
// CoinGecko's public rate limit.
const _cgResolveCache = new Map();
function TokenPickerSheet({ open, onClose, onPick }) {
  const [q, setQ] = tS('');
  const [rows, setRows] = tS(null); // null = idle, [] = no results
  const [busy, setBusy] = tS(false);
  tE(() => { if (open) { setQ(''); setRows(null); setBusy(false); } }, [open]);
  // Debounced live search.
  tE(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) { setRows(null); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(query));
        const data = await r.json();
        const seen = new Set();
        const out = [];
        for (const p of (data && data.pairs) || []) {
          const chain = PICK_CHAIN_MAP[p.chainId];
          const addr = p.baseToken && p.baseToken.address;
          if (!chain || !addr) continue;
          const key = chain + ':' + addr.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            sym: p.baseToken.symbol || '?', name: p.baseToken.name || p.baseToken.symbol || 'Unknown',
            chain, tokenAddress: addr,
            price: parseFloat(p.priceUsd) || 0,
            ch24: (p.priceChange && p.priceChange.h24) || 0,
            liqUsd: (p.liquidity && p.liquidity.usd) || 0,
            img: (p.info && p.info.imageUrl) || null,
            dexUrl: p.url || null,
          });
        }
        out.sort((a, b) => b.liqUsd - a.liqUsd);
        setRows(out.slice(0, 12));
      } catch (e) { setRows([]); }
      finally { setBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, open]);
  const liqStr = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n);
  return (
    <Sheet open={open} onClose={onClose} title="Select token">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface)', borderRadius: 13, padding: '12px 14px', boxShadow: 'inset 0 0 0 1.5px var(--accent)', marginBottom: 12 }}>
        <Icon name="search" size={17} color="var(--muted)" />
        <input value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Name, ticker or contract address"
          style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 14.5, fontFamily: 'inherit', minWidth: 0 }} />
        {busy && <span style={{ width: 15, height: 15, border: '2.5px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite', flexShrink: 0 }} />}
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto', margin: '0 -4px' }}>
        {rows == null && !busy && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '26px 16px', fontSize: 13, lineHeight: 1.5 }}>
            Search live markets on BSC, Ethereum, Base, Solana &amp; Robinhood.<br />Paste a contract address for an exact match.
          </div>
        )}
        {rows != null && rows.length === 0 && !busy && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '26px 16px', fontSize: 13 }}>No tradable tokens found for “{q.trim()}”.</div>
        )}
        {(rows || []).map((t) => (
          <button key={t.chain + t.tokenAddress} onClick={() => onPick(t)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 8px', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <Logo color={'#' + (t.sym.charCodeAt(0) * 4321 % 0xffffff).toString(16).padStart(6, '0')} sym={t.sym} chain={t.chain} img={t.img} address={t.tokenAddress} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{t.sym}</span>
                <Pill tone="muted">{t.chain.toUpperCase()}</Pill>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name} · liq {liqStr(t.liqUsd)}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.price)}</div>
              <Change v={t.ch24} size={11} />
            </div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ─── Manual trade (DEX Bot) ───
function TradeFlow({ token, side = 'buy', go, onDone }) {
  const FX = window.FX;
  const [s, setSide] = tS(side);
  const [tok, setTok] = tS(token || FX.tokens[4] || FX.tokens[0] || null);
  const [amt, setAmt] = tS('0.5');
  // How the "You pay" amount is entered when buying a token with the native
  // coin: 'native' = amount in the coin (e.g. BNB), 'usd' = its dollar worth.
  const [payMode, setPayMode] = tS('native');
  const [slip, setSlip] = tS(12);
  const [slipEdit, setSlipEdit] = tS(false);
  const [slipInput, setSlipInput] = tS('');
  const [stage, setStage] = tS('form'); // form | confirm | processing | success
  const [tradeErr, setTradeErr] = tS('');
  const [txHash, setTxHash] = tS('');
  const [wasPaper, setWasPaper] = tS(false); // last fill was simulated (paper mode)
  const [pickOpen, setPickOpen] = tS(false); // token picker (name/ticker/contract)
  const [resolving, setResolving] = tS(false); // auto-locating the token's on-chain market
  const txRef = React.useRef(null);
  const chain = (tok && FX.chains.find(c => c.id === tok.chain)) || FX.chains[0];

  // Tokens arriving from Markets (CoinGecko top-100) carry no contract address
  // and only a cosmetic chain hint. Resolve them via CoinGecko's platform list —
  // the CANONICAL contract per chain (a DexScreener symbol search is spoofable
  // by copycat tokens; an id-keyed platform lookup is not) — so the trade
  // executes on the chain the token actually lives on, with the real contract.
  tE(() => {
    if (!tok || tok.tokenAddress || !tok.cg) { setResolving(false); return; }
    let alive = true;
    setResolving(true);
    (async () => {
      try {
        let picked;
        if (_cgResolveCache.has(tok.cg)) {
          picked = _cgResolveCache.get(tok.cg);
        } else {
          const r = await fetch('https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(tok.cg) + '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false');
          if (!r.ok) return; // rate-limited/unknown — user can still pick manually
          const data = await r.json();
          const plats = (data && data.platforms) || {};
          const options = [];
          for (const plat in plats) {
            const ch = CG_PLATFORM_CHAIN[plat];
            if (ch && plats[plat]) options.push({ ch, addr: plats[plat] });
          }
          // Prefer the token's own native-chain hint, then a fixed depth order.
          const pref = [tok.chain, 'eth', 'sol', 'bsc', 'base', 'rhood'];
          options.sort((a, b) => { const ia = pref.indexOf(a.ch), ib = pref.indexOf(b.ch); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
          picked = options[0] || null;
          _cgResolveCache.set(tok.cg, picked);
        }
        if (!picked || !alive) return;
        // Enrich with the contract's own live pools (address-keyed — imposters
        // can't appear here) for liquidity, DEX link and executable price.
        let liqUsd = 0, dexUrl = null, px = 0;
        try {
          const dr = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + picked.addr);
          const dd = await dr.json();
          let bp = null;
          for (const p of (dd && dd.pairs) || []) {
            if (PICK_CHAIN_MAP[p.chainId] !== picked.ch) continue;
            const a = (p.baseToken && p.baseToken.address) || '';
            const same = picked.ch === 'sol' ? a === picked.addr : a.toLowerCase() === picked.addr.toLowerCase();
            if (!same) continue;
            if (!bp || ((p.liquidity && p.liquidity.usd) || 0) > ((bp.liquidity && bp.liquidity.usd) || 0)) bp = p;
          }
          if (bp) { liqUsd = (bp.liquidity && bp.liquidity.usd) || 0; dexUrl = bp.url || null; px = parseFloat(bp.priceUsd) || 0; }
        } catch (e) { /* pools unavailable — chain + contract are still correct */ }
        if (!alive) return;
        setTok((cur) => (cur && cur.sym === tok.sym && !cur.tokenAddress) ? {
          ...cur, chain: picked.ch, tokenAddress: picked.addr, liqUsd,
          dexUrl: dexUrl || cur.dexUrl || null, price: cur.price || px,
        } : cur);
      } catch (e) { /* leave unresolved — startTrade prompts the picker */ }
      finally { if (alive) setResolving(false); }
    })();
    return () => { alive = false; };
  }, [tok && tok.sym, tok && tok.tokenAddress, tok && tok.cg]);

  // Every trade is REAL (or paper-mode simulated server-side) — it must have a
  // contract address the DEX router can swap. No fake client-side fills.
  const startTrade = () => {
    setTradeErr('');
    if (!tok.tokenAddress) {
      setTradeErr(resolving
        ? 'Still locating this token’s on-chain market — give it a second, or tap the token above to pick one yourself.'
        : 'This asset has no DEX contract to trade. Tap the token above and pick one — search by name, ticker or contract address.');
      setStage('form');
      return;
    }
    // Execution must happen on the chain the token lives on — refuse chains the
    // engine can't trade rather than silently routing elsewhere.
    if (!TRADE_CHAINS.includes(tok.chain)) {
      const cname = (FX.chains.find(c => c.id === tok.chain) || {}).name || String(tok.chain || '').toUpperCase();
      setTradeErr('This token lives on ' + cname + ', which the trading engine doesn’t support yet. Supported: Solana, Ethereum, BNB Chain, Base & Robinhood — tap the token above to pick a market on one of those.');
      setStage('form');
      return;
    }
    if (!window.FXAPI) { setTradeErr('Trading engine not loaded — refresh and try again.'); return; }
    txRef.current = window.FXAPI.executeTrade({
      chain: tok.chain, tokenAddress: tok.tokenAddress, action: s,
      // Buys always execute in native units. When paying by dollar value we
      // convert USD → native here so the DEX router gets the coin amount.
      amount: s === 'buy' ? String(isNative ? amt : +nativePay.toFixed(8)) : undefined,
      percent: s === 'sell' ? parseFloat(amt) : undefined,
      slippage: slip,
    });
    setStage('processing');
  };
  const finishTrade = async () => {
    try { const res = await txRef.current; setTxHash((res && (res.txHash || res.signature || res.hash)) || ''); setWasPaper(!!(res && res.simulated)); setStage('success'); }
    catch (e) { setTradeErr((e && e.message) || 'Trade failed — check your DEX bot wallet.'); setStage('form'); }
    finally { txRef.current = null; }
  };
  // When buying the chain native token (e.g. SOL on Solana), switch pay side to USDT
  const isNative = !!tok && tok.sym === chain.sym;
  // Reset default amount + denomination when switching between native and non-native
  const { useEffect: uEffect } = React;
  uEffect(() => { setAmt(isNative ? '100' : '0.5'); setPayMode('native'); }, [isNative]);
  // No token to trade yet (live market list still loading) — honest placeholder.
  if (!tok) return (
    <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 26, height: 26, border: '3px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} />
      <div style={{ fontSize: 14 }}>Loading markets — pick a token from Markets to trade.</div>
      <Btn kind="soft" icon="candles" onClick={() => go('markets')}>Open Markets</Btn>
    </div>
  );
  const payUnit = isNative ? 'USDT' : chain.sym;
  const payColor = isNative ? '#26A17B' : chain.color;
  // Live native price from the market list (fallback to the token's own price if
  // we're trading the native asset); real bot-wallet balance for the pay asset.
  const liveNative = (FX.tokens || []).find((x) => x.sym === chain.sym);
  const nativePrice = (liveNative && liveNative.price) || (isNative ? tok.price : 0) || 0;
  const parseAmt = (a) => parseFloat(String(a).replace(/[, ]/g, '').replace(/M$/, 'e6').replace(/K$/, 'e3')) || 0;
  const payHolding = (FX.holdings || []).find((h) => h.sym === payUnit && (isNative || h.chain === tok.chain));
  const balNum = payHolding ? parseAmt(payHolding.amount) : 0;
  const payBalance = balNum ? balNum.toLocaleString('en-US', { maximumFractionDigits: balNum < 1 ? 4 : 2 }) : '0';
  // Denomination-aware amounts. usdMode = buying a token but entering the pay
  // amount as its dollar value instead of native coin units.
  const inputNum = parseFloat(amt) || 0;
  const usdMode = !isNative && payMode === 'usd';
  const usd = isNative ? inputNum : (usdMode ? inputNum : inputNum * nativePrice);
  const nativePay = isNative ? 0 : (usdMode ? (nativePrice > 0 ? inputNum / nativePrice : 0) : inputNum);
  const recv = tok.price ? usd / tok.price : 0;
  // Native-coin units actually spent (what the confirm/receipt shows).
  const paidUnits = isNative ? inputNum : nativePay;
  const paidUnitsStr = paidUnits ? paidUnits.toLocaleString('en-US', { maximumFractionDigits: paidUnits < 1 ? 6 : 4 }) : '0';
  // Toggle the pay input between the native coin and its USD value, converting
  // the current amount so the trade value stays the same across the switch.
  const togglePayMode = () => {
    if (isNative || nativePrice <= 0) return;
    if (payMode === 'native') { const v = inputNum * nativePrice; setAmt(v ? String(+v.toFixed(2)) : ''); setPayMode('usd'); }
    else { const v = nativePrice > 0 ? inputNum / nativePrice : 0; setAmt(v ? String(+v.toFixed(6)) : ''); setPayMode('native'); }
  };
  // Real platform fee tier from the live plan. Prefer the admin-set fee (fetched
  // once) so the displayed fee never drifts from what's actually charged.
  const plan = (FX && FX.plan) || 'free';
  const [adminFee, setAdminFee] = tS(null);
  tE(() => {
    let alive = true;
    if (window.FXAPI && window.FXAPI.getPlans) window.FXAPI.getPlans().then((p) => { if (alive && p && p.tradingFee) setAdminFee(p.tradingFee); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const defPct = plan === 'elite' ? 0.2 : plan === 'pro' ? 0.5 : 1.0;
  const feePctNum = adminFee && adminFee[plan] != null ? parseFloat(adminFee[plan]) : defPct;
  const feePct = (Number.isFinite(feePctNum) ? feePctNum : defPct) / 100;
  const feeLabel = (feePct * 100).toFixed(feePct * 100 % 1 === 0 ? 0 : 1) + '%';

  const presets = s === 'buy'
    ? ((isNative || usdMode) ? ['10', '50', '100', '500'] : ['0.1', '0.5', '1', '2'])
    : ['25%', '50%', '75%', '100%'];
  const presetPrefix = ((isNative || usdMode) && s === 'buy') ? '$' : '';

  if (stage === 'processing') {
    return <TradeProcessing s={s} tok={tok} amt={s === 'buy' ? paidUnitsStr : amt} payUnit={payUnit} recv={recv} chain={chain} onComplete={finishTrade} />;
  }
  if (stage === 'success') {
    return (
      <div style={{ padding: '40px 22px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'var(--up-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <Icon name="checkCircle" size={48} color="var(--up)" />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{wasPaper ? 'Paper trade filled' : 'Trade filled'}</div>
        {wasPaper && <Pill tone="accent" style={{ marginTop: 8 }}>📝 SIMULATED — no real funds moved</Pill>}
        <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
          {s === 'buy' ? 'Bought' : 'Sold'} <b style={{ color: 'var(--text)' }}>{recv.toLocaleString('en-US', { maximumFractionDigits: 4 })} {tok.sym}</b><br />for {s === 'buy' ? paidUnitsStr : amt} {payUnit} on {chain.dex}
        </div>
        <div style={{ width: '100%', marginTop: 22, background: 'var(--surface)', borderRadius: 14, padding: 16, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
          {[['Price', fmtUsd(tok.price)], ['Network fee (est.)', '~0.004 ' + chain.sym], ['Platform fee', feeLabel + ' · $' + (usd * feePct).toFixed(2)]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5 }}>
              <span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          {txHash && (() => {
            const url = ({ bsc: 'https://bscscan.com/tx/', eth: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', sol: 'https://solscan.io/tx/', rhood: 'https://robinhoodchain.blockscout.com/tx/' })[tok.chain];
            return (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5 }}>
                <span style={{ color: 'var(--muted)' }}>Tx</span>
                {url
                  ? <a href={url + txHash} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: 'var(--accent)' }}>{txHash.slice(0, 6) + '…' + txHash.slice(-4)} ↗</a>
                  : <span style={{ fontWeight: 600 }}>{txHash.slice(0, 6) + '…' + txHash.slice(-4)}</span>}
              </div>
            );
          })()}
        </div>
        <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 20 }}>
          <Btn kind="soft" full onClick={() => setStage('form')}>Trade again</Btn>
          <Btn full onClick={onDone}>Done</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 16px 20px' }}>
      <Segmented options={[{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }]} value={s} onChange={setSide} style={{ marginBottom: 16 }} />
      {tradeErr && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '11px 13px', fontWeight: 600 }}>{tradeErr}</div>}
      {/* token selector — tap to search any tradable token by name/ticker/contract */}
      <button onClick={() => setPickOpen(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', borderRadius: 14, padding: 13, boxShadow: tok.tokenAddress ? 'inset 0 0 0 1px var(--line)' : 'inset 0 0 0 1.5px var(--accent)', marginBottom: 10, border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--text)' }}>
        <Logo color={tok.logo} sym={tok.sym} chain={tok.chain} img={tok.img} address={tok.address || tok.tokenAddress} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 800, fontSize: 15.5 }}>{tok.sym}</span>
            <Icon name="chevD" size={15} color="var(--muted)" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tok.tokenAddress ? `${chain.name} · ${chain.dex}` : resolving ? 'Locating on-chain market…' : 'Tap to pick a tradable token'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(tok.price)}</div>
          <Change v={tok.ch24} size={12} />
        </div>
      </button>
      <TokenPickerSheet open={pickOpen} onClose={() => setPickOpen(false)} onPick={(t) => { setTok(t); setPickOpen(false); setTradeErr(''); }} />
      {/* amount */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>You pay</span>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Balance: {payBalance} {payUnit}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {usdMode && <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--muted)' }}>$</span>}
          <input value={amt} onChange={e => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal"
            style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 30, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
          {(!isNative && nativePrice > 0) ? (
            <button onClick={togglePayMode} title="Switch between coin amount and dollar value" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--chip)', borderRadius: 10, padding: '7px 10px', fontWeight: 700, flexShrink: 0, border: 'none', cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14 }}>
              {usdMode ? <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#26A17B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 800 }}>$</span> : <span style={{ width: 18, height: 18, borderRadius: '50%', background: payColor }} />}
              {usdMode ? 'USD' : payUnit}
              <Icon name="swap" size={13} color="var(--muted)" />
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--chip)', borderRadius: 10, padding: '7px 11px', fontWeight: 700, flexShrink: 0 }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: payColor }} /> {payUnit}
            </div>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{usdMode ? `≈ ${paidUnitsStr} ${payUnit}` : `≈ $${usd.toFixed(2)}`}</div>
      </div>
      <div style={{ display: 'flex', gap: 7, margin: '10px 0 14px' }}>
        {presets.map(p => <Chip key={p} onClick={() => setAmt(p.includes('%') ? (parseFloat(p) / 100 * balNum).toFixed(isNative ? 0 : 4) : p)} style={{ flex: 1, justifyContent: 'center' }}>{presetPrefix}{p}</Chip>)}
      </div>
      {/* receive */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '-6px 0 8px' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}><Icon name="swap" size={17} /></div>
      </div>
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>You receive (est.)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 26, fontWeight: 800, flex: 1, fontVariantNumeric: 'tabular-nums' }}>{recv < 0.001 ? recv.toFixed(6) : recv < 1 ? recv.toFixed(4) : recv.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--chip)', borderRadius: 10, padding: '7px 11px', fontWeight: 700 }}>
            <Logo color={tok.logo} sym={tok.sym} size={18} /> {tok.sym}
          </div>
        </div>
      </div>
      {/* controls */}
      <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '6px 16px', boxShadow: 'inset 0 0 0 1px var(--line)', marginBottom: 14 }}>
        <Row k="Slippage tolerance" v={<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{[5, 12, 20].map(x => <button key={x} onClick={() => setSlip(x)} style={{ border: 'none', cursor: 'pointer', borderRadius: 7, padding: '4px 9px', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', background: slip === x ? 'var(--accent)' : 'var(--chip)', color: slip === x ? 'var(--on-accent)' : 'var(--muted)' }}>{x}%</button>)}{![5, 12, 20].includes(slip) && <span style={{ borderRadius: 7, padding: '4px 9px', fontSize: 12.5, fontWeight: 700, background: 'var(--accent)', color: 'var(--on-accent)' }}>{slip}%</span>}<button onClick={() => { setSlipInput(String(slip)); setSlipEdit(true); }} aria-label="Custom slippage" style={{ border: 'none', cursor: 'pointer', borderRadius: 7, width: 28, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--chip)', color: 'var(--accent)' }}><Icon name="sliders" size={15} /></button></div>} />
        <Row k="Max gas (est.)" v={'~0.004 ' + chain.sym} icon="gas" />
        <Row k={tok.liqUsd ? 'Pool liquidity' : 'Execution guard'} v={tok.liqUsd
          ? <Pill tone={tok.liqUsd >= 10000 ? 'up' : 'down'}><Icon name="shield" size={12} /> ${tok.liqUsd >= 1e6 ? (tok.liqUsd / 1e6).toFixed(1) + 'M' : Math.round(tok.liqUsd / 1e3) + 'K'}</Pill>
          : <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Quote + slippage enforced on-chain</span>} last />
      </div>
      <Btn kind={s === 'buy' ? 'up' : 'down'} size="lg" full icon="zap" onClick={() => setStage('confirm')}>
        {s === 'buy' ? 'Buy' : 'Sell'} {tok.sym}
      </Btn>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 10, fontSize: 11.5, color: 'var(--faint)' }}>
        <Icon name="info" size={13} /> {feeLabel} platform fee{plan === 'free' ? ' (Free tier). Pro 0.5% · Elite 0.2%.' : ` · ${plan} plan.`}
      </div>

      <Sheet open={slipEdit} onClose={() => setSlipEdit(false)} title="Custom slippage">
        <div style={{ paddingBottom: 10 }}>
          <div style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 14 }}>Your trade reverts if the price moves against you by more than this. Higher tolerance fills faster on volatile tokens; lower protects your price.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', borderRadius: 13, padding: '14px 16px', boxShadow: 'inset 0 0 0 1.5px var(--accent)', marginBottom: 12 }}>
            <input value={slipInput} onChange={e => setSlipInput(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" autoFocus placeholder="0.0" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 30, fontWeight: 800, fontFamily: 'inherit', minWidth: 0 }} />
            <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--muted)' }}>%</span>
          </div>
          <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
            {[1, 5, 12, 20, 50].map(p => <Chip key={p} active={slipInput === String(p)} onClick={() => setSlipInput(String(p))} style={{ flex: 1, justifyContent: 'center' }}>{p}%</Chip>)}
          </div>
          {parseFloat(slipInput) > 25 && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--down-bg)', borderRadius: 11, padding: '11px 13px', marginBottom: 14, fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.45 }}><Icon name="alert" size={15} color="var(--down)" style={{ marginTop: 1, flexShrink: 0 }} /> High slippage — your trade may be front-run by MEV bots.</div>}
          <Btn size="lg" full icon="check" onClick={() => { const v = parseFloat(slipInput); if (v > 0) setSlip(v); setSlipEdit(false); }}>Set {slipInput || '0'}% slippage</Btn>
        </div>
      </Sheet>

      <Sheet open={stage === 'confirm'} onClose={() => setStage('form')} title="Confirm trade">
        <div style={{ paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
            <Logo color={tok.logo} sym={tok.sym} chain={tok.chain} img={tok.img} address={tok.address || tok.tokenAddress} size={46} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{s === 'buy' ? 'Buy' : 'Sell'} {tok.sym}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{chain.dex} · {chain.name}</div>
            </div>
            <div style={{ textAlign: 'right' }}><div style={{ fontSize: 17, fontWeight: 800 }}>{s === 'buy' ? paidUnitsStr : amt} {payUnit}</div><div style={{ fontSize: 12.5, color: 'var(--muted)' }}>${usd.toFixed(2)}</div></div>
          </div>
          <div style={{ background: 'var(--surface)', borderRadius: 13, padding: '6px 14px', boxShadow: 'inset 0 0 0 1px var(--line)', margin: '6px 0 16px' }}>
            <Row k="Receive (est.)" v={recv.toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' ' + tok.sym} />
            <Row k="Slippage" v={slip + '%'} />
            <Row k="Network fee" v={'0.004 ' + chain.sym} />
            <Row k={'Platform fee (' + feeLabel + ')'} v={'$' + (usd * feePct).toFixed(2)} last />
          </div>
          <Btn kind="up" size="lg" full icon="zap" onClick={startTrade}>Confirm {s === 'buy' ? 'buy' : 'sell'}</Btn>
          <div style={{ height: 8 }} />
        </div>
      </Sheet>
    </div>
  );
}

function Row({ k, v, last, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: last ? 'none' : '1px solid var(--line)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: 'var(--muted)', fontWeight: 500 }}>{icon && <Icon name={icon} size={15} />}{k}</span>
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{v}</span>
    </div>
  );
}

// Processing UI — animated swap progress before confirmation screen
function TradeProcessing({ s, tok, amt, payUnit, recv, chain, onComplete }) {
  const { useState: uSt, useEffect: uEf } = React;
  const isBuy = s === 'buy';
  const steps = [
    { icon: 'lock', label: 'Preparing order', sub: 'Amount, balance & slippage' },
    { icon: 'shield', label: 'Signing server-side', sub: 'Key never leaves the vault' },
    { icon: 'swap', label: 'Routing best price', sub: 'via ' + chain.dex },
    { icon: 'zap', label: 'Submitting to ' + chain.name, sub: 'Broadcasting transaction' },
    { icon: 'checkCircle', label: 'Confirming on-chain', sub: 'Awaiting block' },
  ];
  const [step, setStep] = uSt(0);
  uEf(() => {
    if (step >= steps.length) { const t = setTimeout(onComplete, 500); return () => clearTimeout(t); }
    const t = setTimeout(() => setStep(step + 1), step === 0 ? 500 : 720);
    return () => clearTimeout(t);
  }, [step]);
  const pctDone = Math.min(100, (step / steps.length) * 100);

  return (
    <div style={{ padding: '24px 22px 28px', minHeight: 480, display: 'flex', flexDirection: 'column' }}>
      {/* token header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 22 }}>
        <Logo color={tok.logo} sym={tok.sym} chain={tok.chain} img={tok.img} address={tok.address || tok.tokenAddress} size={42} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{isBuy ? 'Buy' : 'Sell'} {tok.sym}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{amt} {payUnit} · {chain.dex}</div>
        </div>
        <Pill tone="up">{isBuy ? 'BUY' : 'SELL'}</Pill>
      </div>

      {/* progress ring */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <div style={{ position: 'relative', width: 92, height: 92 }}>
          <svg width="92" height="92" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="46" cy="46" r="40" fill="none" stroke="var(--line)" strokeWidth="5" />
            <circle cx="46" cy="46" r="40" fill="none" stroke="var(--up)" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 40} strokeDashoffset={2 * Math.PI * 40 * (1 - pctDone / 100)}
              style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {step >= steps.length
              ? <Icon name="checkCircle" size={40} color="var(--up)" />
              : <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--up)' }}>{Math.round(pctDone)}%</span>}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
        {step >= steps.length ? 'Trade submitted' : (isBuy ? 'Buying ' : 'Selling ') + tok.sym + '…'}
      </div>
      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
        ≈ {recv.toLocaleString('en-US', { maximumFractionDigits: 4 })} {tok.sym}
      </div>

      {/* steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {steps.map((st, i) => {
          const done = i < step, active = i === step;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 4px', opacity: done || active ? 1 : 0.4, transition: 'opacity .3s' }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? 'var(--up-bg)' : active ? 'var(--glow)' : 'var(--surface2)', color: done ? 'var(--up)' : 'var(--accent)' }}>
                {done ? <Icon name="check" size={18} stroke={3} />
                  : active ? <span style={{ width: 16, height: 16, border: '2.5px solid var(--line2)', borderTopColor: 'var(--up)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} />
                  : <Icon name={st.icon} size={17} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: done || active ? 'var(--text)' : 'var(--muted)' }}>{st.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{st.sub}</div>
              </div>
              {done && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--up)' }}>Done</span>}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 16, fontSize: 11.5, color: 'var(--faint)' }}>
        <Icon name="lock" size={13} /> Secured · do not close the app
      </div>
    </div>
  );
}

// ─── Gem Scanner ───
// Build a token-detail object from a gem card so tapping a gem opens the full
// token view (with DexScreener / DEXTools / explorer research links).
const GEM_DS_SLUG = { sol: 'solana', eth: 'ethereum', bsc: 'bsc', base: 'base', poly: 'polygon', arb: 'arbitrum', rhood: 'robinhood' };
function gemToken(g) {
  const strip = (v) => String(v == null ? '—' : v).replace(/^\$/, '');
  return {
    sym: g.sym, name: g.name || g.sym, chain: g.chain,
    price: g.price || 0, ch24: g.ch || 0,
    mcap: strip(g.mcap), vol: strip(g.vol), liq: strip(g.liq), holders: g.holders || '—',
    logo: '#' + (g.sym.charCodeAt(0) * 4321 % 0xffffff).toString(16).padStart(6, '0'),
    img: g.img || null,
    address: g.address, tokenAddress: g.address, dexUrl: g.dexUrl || null, spark: [],
  };
}
function gemDexUrl(g) {
  if (g.dexUrl) return g.dexUrl;
  if (g.address) return `https://dexscreener.com/${GEM_DS_SLUG[g.chain] || g.chain}/${g.address}`;
  return null;
}
// Compact USD + relative-time helpers for the auto-scan feed.
function gemCompactUsd(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
function gemAgo(ms) {
  ms = Number(ms) || 0;
  if (!ms) return 'recently';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
// Map a stored gemAlert doc into the shape gemToken()/TokenDetail expect.
function gemAlertToken(a) {
  const sym = a.tokenSymbol || '?';
  return gemToken({
    sym, name: a.tokenName || sym, chain: a.chain, price: a.priceUsd || 0, ch: 0,
    mcap: a.marketCap ? gemCompactUsd(a.marketCap) : '—', liq: a.liquidity ? gemCompactUsd(a.liquidity) : '—',
    vol: '—', holders: '—', address: a.tokenAddress, img: null,
  });
}

// Full blockchain narrative taxonomy — must mirror classifyNarrative() in
// fx-api.js. "All" applies no filter (the scan is already narrative-agnostic).
const GEM_NARRATIVES = ['All', 'AI', 'Meme', 'DeFi', 'DePIN', 'RWA', 'GameFi', 'SocialFi', 'Layer', 'Payments', 'New'];
const GEM_CHAIN_OPTS = [['All', 'All chains'], ['sol', 'Solana'], ['eth', 'Ethereum'], ['base', 'Base'], ['bsc', 'BSC'], ['rhood', 'Robinhood']];
const GEM_SORT_OPTS = [{ value: 'score', label: 'Top score' }, { value: 'trending', label: 'Trending' }, { value: 'new', label: 'Newest' }, { value: 'gainers', label: 'Top gainers' }];
const GEM_AGE_UNITS = [{ value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }, { value: 'years', label: 'Years' }];
// Chains the Telegram auto-alert scheduler can scan + send (order = chip order).
const GEM_TG_CHAINS = [['bsc', 'BSC'], ['eth', 'Ethereum'], ['base', 'Base'], ['sol', 'Solana'], ['rhood', 'Robinhood']];
const GEM_SETTINGS_DEFAULT = { minLiquidity: 5000, minVolume: 1000, minMarketCap: 0, minScore: 60, sort: 'score', minAgeAmount: 0, minAgeUnit: 'hours', minAgeHours: 0, maxAgeAmount: 1, maxAgeUnit: 'days', maxAgeHours: 24, buyAmountBsc: 0.005, buyAmountEth: 0.01, buyAmountSol: 0.05, buySlippage: 10, exitTp: 100, exitSl: 30, exitTrail: 0, exitMaxHold: 0, telegramChains: ['bsc', 'eth', 'sol', 'base'] };
const GEM_SCAN_STEPS = [
  { icon: 'scan', label: 'Pulling fresh pairs', sub: 'DexScreener · GeckoTerminal' },
  { icon: 'layers', label: 'Scanning the broad market', sub: 'New, trending & established pools' },
  { icon: 'sliders', label: 'Applying your filters', sub: 'Liquidity · volume · age · mcap' },
  { icon: 'shield', label: 'Safety & honeypot checks', sub: 'GoPlus · Honeypot.is · RugCheck' },
  { icon: 'checkCircle', label: 'Scoring & ranking gems', sub: '0–100 gem score' },
];
function GemScanner({ go, onTrade, locked, onUpsell }) {
  const FX = window.FX;
  const [narr, setNarr] = tS('All');
  const [chain, setChain] = tS('All');
  const [safe, setSafe] = tS(true);
  const [gems, setGems] = tS(FX.gems);
  const [scan, setScan] = tS({ on: false, ago: 'cached', found: 0 });
  // Scan progress modal: shows the scanning steps then the fresh gems.
  const [modal, setModal] = tS({ open: false, done: false, found: 0, total: 0, err: '' });
  // Manually scanned gems get their OWN page ('results' view) so the user's
  // scan isn't buried under the record cards and the auto-scanned feed. The
  // last manual scan stays reachable from the main view.
  const [manual, setManual] = tS([]);
  const [manualAt, setManualAt] = tS(null);   // when the manual scan ran
  const [view, setView] = tS('main');          // 'main' | 'results'
  // Telegram auto-alerts (botSettings.gemAutoEnabled). null = unknown/loading.
  const [tgAlerts, setTgAlerts] = tS(null);
  const [tgLinked, setTgLinked] = tS(false);
  const [tgBusy, setTgBusy] = tS(false);
  // Auto-execution (botSettings.gemAutoBuy) — the trading bot auto-buys gems.
  const [autoBuy, setAutoBuy] = tS(null);
  const [abBusy, setAbBusy] = tS(false);
  // Persisted scan filter settings (botSettings.gem*) + the settings sheet.
  const [cfg, setCfg] = tS(GEM_SETTINGS_DEFAULT);
  const [setOpen, setSetOpen] = tS(false);
  // Hindsight stats: how gems the scanner surfaced actually performed.
  const [stats, setStats] = tS(null);
  // Auto-scanned gems (the 5-min scheduler's finds, sent to Telegram) so they're
  // listed in the app too, not only in Telegram.
  const [alerts, setAlerts] = tS([]);
  tE(() => {
    let alive = true;
    window.FXAPI.getBotPrefs().then(p => {
      if (!alive || !p) return;
      setTgAlerts(!!p.gemAutoEnabled);
      setTgLinked(!!p.telegramLinked);
      setAutoBuy(!!p.gemAutoBuy);
    }).catch(() => {});
    window.FXAPI.getGemSettings().then(s => { if (alive && s) setCfg(s); }).catch(() => {});
    if (window.FXAPI.getGemStats) window.FXAPI.getGemStats().then(s => { if (alive && s) setStats(s); }).catch(() => {});
    if (window.FXAPI.getGemAlerts) window.FXAPI.getGemAlerts().then(a => { if (alive && Array.isArray(a)) setAlerts(a); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const toggleTgAlerts = async () => {
    if (tgBusy) return;
    const next = !tgAlerts;
    setTgAlerts(next); setTgBusy(true);          // optimistic
    try { await window.FXAPI.setGemAutoAlerts(next); }
    catch (e) { setTgAlerts(!next); }            // revert on failure
    finally { setTgBusy(false); }
  };
  const toggleAutoBuy = async () => {
    if (abBusy) return;
    const next = !autoBuy;
    // Buying without exit rules means the bot enters positions it will never
    // manage — force an explicit confirmation before allowing that.
    if (next) {
      const noExits = !(parseFloat(cfg.exitTp) > 0 || parseFloat(cfg.exitSl) > 0 || parseFloat(cfg.exitTrail) > 0 || parseFloat(cfg.exitMaxHold) > 0);
      if (noExits && !window.confirm('No exit rules are set — the bot will BUY gems but never sell them. Set take-profit / stop-loss in scan settings (⚙), or tap OK to proceed anyway.')) return;
    }
    setAutoBuy(next); setAbBusy(true);           // optimistic
    try { await window.FXAPI.setGemAutoBuy(next); }
    catch (e) { setAutoBuy(!next); }             // revert on failure
    finally { setAbBusy(false); }
  };
  const runScan = async () => {
    if (scan.on) return;
    setScan(s => ({ ...s, on: true, found: 0 }));
    setModal({ open: true, done: false, found: 0, total: 0, err: '' });
    try {
      // "All" must enumerate the chains explicitly — the backend defaults to
      // only bsc+sol when no chains are sent, which would silently drop ETH/Base.
      // The persisted settings (cfg) drive depth/sort so the sliders icon and the
      // manual scan share one source of truth with the auto scheduler.
      const opts = {
        chains: chain !== 'All' ? [chain] : ['sol', 'eth', 'base', 'bsc', 'rhood'],
        minLiquidity: cfg.minLiquidity, minVolume: cfg.minVolume, minMarketCap: cfg.minMarketCap,
        minAgeHours: cfg.minAgeHours, maxAgeHours: cfg.maxAgeHours, minScore: cfg.minScore, sort: cfg.sort,
      };
      const res = await window.FXAPI.scanGems(opts);
      const arr = Array.isArray(res) ? res : [];
      if (arr.length) { setGems(arr); window.FX.gems = arr; setManual(arr); setManualAt(Date.now()); }
      const hi = arr.filter(g => g.score >= 80).length;
      setScan({ on: false, ago: 'just now', found: hi });
      setModal({ open: true, done: true, found: hi, total: arr.length, err: '' });
    } catch (e) {
      const details = (e && e.details) || {};
      const quota = details.code === 'quota_exhausted' || String((e && e.code) || '').includes('resource-exhausted');
      setScan({ on: false, ago: quota ? 'monthly scan limit reached' : 'failed — sign in to scan', found: 0 });
      setModal({ open: true, done: true, found: 0, total: 0, err: (e && e.message) || 'Sign in to scan, then try again.' });
    }
  };
  let list = gems;
  if (narr !== 'All') list = list.filter(g => g.narrative === narr);
  if (chain !== 'All') list = list.filter(g => g.chain === chain);
  if (safe) list = list.filter(g => g.safe);

  // One gem card — shared by the main feed and the manual-scan results page.
  const gemCard = (g, idx) => {
    const lock = locked && idx >= 3;
    return (
      <Card key={g.sym} pad={14} onClick={() => { if (lock) { onUpsell(); return; } go('token', { token: gemToken(g) }); }} style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
        {lock && <div style={{ position: 'absolute', inset: 0, background: 'var(--overlay)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, zIndex: 2 }}>
          <Icon name="lock" size={22} color="var(--accent)" /><div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Upgrade to see all scans</div>
          <Btn size="sm" icon="crown" onClick={onUpsell}>Unlock Pro</Btn>
        </div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 11 }}>
          <Logo color={'#' + (g.sym.charCodeAt(0) * 4321 % 0xffffff).toString(16).padStart(6, '0')} sym={g.sym} chain={g.chain} img={g.img} address={g.address || g.tokenAddress} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 15 }}>${g.sym}</span>
              <Pill tone="muted">{g.narrative}</Pill>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="clock" size={11} /> {g.age} old · {g.holders} holders</div>
          </div>
          <ScoreRing score={g.score} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[['MCap', g.mcap], ['Liq', g.liq], ['Vol', g.vol]].map(([k, v]) => (
            <div key={k} style={{ background: 'var(--surface2)', borderRadius: 9, padding: '7px 9px' }}>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 1 }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Pill tone={g.ch >= 0 ? 'up' : 'down'} style={{ fontSize: 13 }}>{g.ch >= 0 ? '+' : ''}{g.ch}%</Pill>
          {g.safe ? <Pill tone="up"><Icon name="shield" size={12} /> Safe</Pill> : <Pill tone="down"><Icon name="alert" size={12} /> Risky</Pill>}
          <Btn size="sm" kind="soft" icon="external" onClick={(e) => { e.stopPropagation(); const u = gemDexUrl(g); if (u) { try { window.open(u, '_blank', 'noopener,noreferrer'); } catch (_) {} } }} style={{ marginLeft: 'auto' }}>DEX</Btn>
          <Btn size="sm" icon="zap" onClick={(e) => { e.stopPropagation(); onTrade(gemToken(g), 'buy'); }}>Ape</Btn>
        </div>
      </Card>
    );
  };

  // ── Manual-scan results: a dedicated page so the user's own scan is never
  // mixed into the record cards / auto-scanned feed of the main screen. ──
  if (view === 'results') {
    const ranAgo = manualAt ? Math.max(0, Math.round((Date.now() - manualAt) / 60000)) : null;
    return (
      <div>
        <TopBar left={<button onClick={() => setView('main')} style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}><Icon name="chevL" size={20} /></button>}
          title="Scan results" sub={manual.length + (manual.length === 1 ? ' gem' : ' gems') + (ranAgo != null ? ' · ' + (ranAgo === 0 ? 'just now' : ranAgo + ' min ago') : '')} />
        <div style={{ padding: '0 16px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Pill tone="muted">{narr === 'All' ? 'Any narrative' : narr}</Pill>
          <Pill tone="muted">{chain === 'All' ? 'All chains' : chain.toUpperCase()}</Pill>
          <Pill tone="muted">min score {cfg.minScore}</Pill>
          <Btn size="sm" kind="soft" icon="scan" onClick={() => { setView('main'); runScan(); }} style={{ marginLeft: 'auto' }}>Rescan</Btn>
        </div>
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {manual.length === 0 && (
            <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--muted)' }}>
              <Icon name="scan" size={28} color="var(--faint)" style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>No results from your last scan</div>
              <div style={{ fontSize: 12.5, marginTop: 3 }}>Run a new scan from the scanner page.</div>
            </div>
          )}
          {manual.map((g, idx) => gemCard(g, idx))}
        </div>
      </div>
    );
  }

  // Compact toggle card — used for the Safe / Telegram / Auto-execute row.
  const toggleCard = ({ icon, tint, label, on, onClick }) => (
    <div style={{
      flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
      background: on ? 'var(--surface2)' : 'var(--surface)', borderRadius: 13, padding: '12px 6px 11px',
      boxShadow: on ? `inset 0 0 0 1.5px ${tint}` : 'inset 0 0 0 1px var(--line)', transition: 'all .2s',
    }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? tint : 'var(--surface2)', transition: 'all .2s' }}>
        <Icon name={icon} size={17} color={on ? '#fff' : tint} />
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', textAlign: 'center', lineHeight: 1.15, minHeight: 26, display: 'flex', alignItems: 'center' }}>{label}</span>
      <Toggle on={on} onClick={onClick} />
    </div>
  );

  return (
    <div>
      <TopBar left={<button onClick={() => go(-1)} style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--surface2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}><Icon name="chevL" size={20} /></button>}
        title="Gem Scanner" sub={scan.on ? 'Scanning\u2026' : 'Fresh on-chain gems \u00b7 safety-checked'}
        right={<IconBtn name="sliders" active={setOpen} onClick={() => setSetOpen(true)} />} />
      {/* manual scan bar */}
      <div style={{ padding: '0 16px 10px' }}>
        <ScanButton on={scan.on} onClick={runScan} label="Scan now" busy="Scanning new pairs…"
          detail={(narr === 'All' ? 'Whole market · any narrative' : narr + ' narrative')
            + ' · ' + (chain === 'All' ? 'SOL/ETH/BSC/Base' : chain.toUpperCase()) + ' · your filters'} />
      </div>
      <div style={{ padding: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Narrative + chain filters as dropdown menus */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Dropdown label="Narrative" icon="grid" value={narr} options={GEM_NARRATIVES.map(n => ({ value: n, label: n }))} onChange={setNarr} />
          <Dropdown label="Chain" icon="layers" value={chain} options={GEM_CHAIN_OPTS.map(([v, l]) => ({ value: v, label: l }))} onChange={setChain} />
        </div>
        {/* Safety + automation switches — one horizontal row */}
        <div style={{ display: 'flex', gap: 8 }}>
          {toggleCard({ icon: 'shield', tint: 'var(--up)', label: 'Safe only', on: safe, onClick: () => setSafe(!safe) })}
          {toggleCard({ icon: 'telegram', tint: '#229ED9', label: 'Telegram alerts', on: !!tgAlerts, onClick: toggleTgAlerts })}
          {toggleCard({ icon: 'zap', tint: 'var(--up)', label: 'Auto-execute', on: !!autoBuy, onClick: toggleAutoBuy })}
        </div>
        {/* Contextual hints for the switches above */}
        {tgAlerts && !tgLinked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', padding: '0 2px' }}>
            <Icon name="telegram" size={13} color="#229ED9" style={{ flexShrink: 0 }} />
            <span>Connect Telegram in Profile to receive gem alerts.</span>
          </div>
        )}
        {tgAlerts && tgLinked && (
          <button onClick={() => setSetOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', padding: '0 2px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            <Icon name="telegram" size={13} color="#229ED9" style={{ flexShrink: 0 }} />
            <span>Alerting on {(cfg.telegramChains && cfg.telegramChains.length ? cfg.telegramChains : ['bsc', 'eth', 'sol', 'base']).map((c) => c.toUpperCase()).join(' · ')} — tap to change chains.</span>
          </button>
        )}
        {autoBuy && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, padding: '0 2px' }}>
            <Icon name="alert" size={13} color="var(--down)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Auto-execute makes real on-chain buys from your funded bot wallet. Set buy size, slippage &amp; min score in scan settings (⚙).</span>
          </div>
        )}
      </div>
      {/* Verified 90-day track record — win rate / avg return / W-L of the gems
          this scanner surfaced, resolved server-side against live prices. Tap to
          drill into every won & lost gem. Mirrors the CEX signal bot's card.
          Always shown (even while the sample is still building) so the feature
          is discoverable; the numbers fill in as gems hit their 24h/7d marks. */}
      {stats && stats.d90 && (() => {
        const d = stats.d90;
        const has = d.total >= 1;
        const seg = (n, color) => has ? <div style={{ flex: n || 0.0001, height: 6, background: color }} /> : null;
        return (
          <div style={{ padding: '0 16px 12px' }}>
            <div onClick={() => go('gemTrackRecord')} style={{ cursor: 'pointer', background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                <Icon name="trophy" size={15} color="var(--accent)" />
                <span style={{ fontSize: 13, fontWeight: 800, flex: 1 }}>Gem track record · last 90 days</span>
                <Pill tone="muted">{has ? d.total + ' gems' : 'building'}</Pill>
                <Icon name="chevR" size={16} color="var(--faint)" />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {[['Win rate', d.winRate != null ? d.winRate + '%' : '—', d.winRate >= 50 ? 'var(--up)' : 'var(--text)'],
                  ['Avg return', d.avgReturn != null ? (d.avgReturn >= 0 ? '+' : '') + d.avgReturn + '%' : '—', d.avgReturn >= 0 ? 'var(--up)' : 'var(--down)'],
                  ['W / L', `${d.wins} / ${d.losses}`, 'var(--text)']].map(([l, v, c]) => (
                  <div key={l} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{v}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700 }}>{l}</div>
                  </div>
                ))}
              </div>
              {has ? (
                <div style={{ display: 'flex', gap: 2, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }} title={`2x+ ${d.moon} · up ${d.up} · down ${d.down}`}>
                  {seg(d.moon, 'var(--accent)')}{seg(d.up, 'var(--up)')}{seg(d.down, 'var(--down)')}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.4 }}>Scanned gems are re-priced at their 24h &amp; 7d marks — win rate and returns fill in as they resolve.</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="list" size={12} /> {has ? 'View every won & lost gem' : 'Open track record'}
              </div>
            </div>
          </div>
        );
      })()}
      {/* Hindsight stats — how gems the scanner surfaced actually performed.
          Only shown once there's a meaningful sample (≥10 resolved). */}
      {stats && stats.d1 && stats.d1.count >= 10 && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: '13px 15px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
              <Icon name="trophy" size={15} color="var(--accent)" />
              <span style={{ fontSize: 13, fontWeight: 800, flex: 1 }}>How past gems performed</span>
              <Pill tone="muted">{stats.d1.count} tracked</Pill>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['24h', stats.d1], ['7d', stats.d7]].map(([label, s]) => (
                <div key={label} style={{ flex: 1, background: 'var(--surface2)', borderRadius: 11, padding: '10px 11px' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 700, marginBottom: 5 }}>{label} after found</div>
                  {s ? <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                      <span style={{ color: 'var(--muted)' }}>Median</span>
                      <span style={{ fontWeight: 800, color: s.median >= 0 ? 'var(--up)' : 'var(--down)' }}>{s.median >= 0 ? '+' : ''}{s.median}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                      <span style={{ color: 'var(--muted)' }}>Best</span>
                      <span style={{ fontWeight: 800, color: 'var(--up)' }}>+{s.best}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                      <span style={{ color: 'var(--muted)' }}>Up</span>
                      <span style={{ fontWeight: 800 }}>{s.winRate}%</span>
                    </div>
                  </> : <div style={{ fontSize: 11.5, color: 'var(--faint)', paddingTop: 4 }}>building…</div>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 9, lineHeight: 1.4 }}>Median/best price change of gems this scanner surfaced, measured from when they were found. Last 90 days — not a prediction of future results.</div>
          </div>
        </div>
      )}
      {/* Your last manual scan → its own results page */}
      {manual.length > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <div onClick={() => setView('results')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11, background: 'var(--surface)', borderRadius: 14, padding: '12px 14px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}><Icon name="scan" size={17} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>Your last scan</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{manual.length} gem{manual.length === 1 ? '' : 's'} · {manual.filter((g) => g.score >= 80).length} scored 80+</div>
            </div>
            <Pill tone="accent">View results</Pill>
            <Icon name="chevR" size={16} color="var(--faint)" />
          </div>
        </div>
      )}
      {/* Auto-scanned feed — the 5-min scheduler's finds (also pushed to
          Telegram), so they're listed in the app and tracked on the record. */}
      {alerts.length > 0 && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, padding: '0 2px' }}>
            <Icon name="telegram" size={15} color="#229ED9" />
            <span style={{ fontSize: 13, fontWeight: 800, flex: 1 }}>Auto-scanned</span>
            <Pill tone="muted">every 5 min · Telegram</Pill>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((a) => {
              const sym = a.tokenSymbol || '?';
              const px = a.priceUsd ? '$' + (a.priceUsd < 0.00001 ? a.priceUsd.toExponential(2) : a.priceUsd.toPrecision(4)) : '—';
              return (
                <div key={a.id} onClick={() => go('token', { token: gemAlertToken(a) })} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--surface)', borderRadius: 12, padding: '11px 13px', boxShadow: 'inset 0 0 0 1px var(--line)', cursor: 'pointer' }}>
                  <Logo color={'#' + (sym.charCodeAt(0) * 4321 % 0xffffff).toString(16).padStart(6, '0')} sym={sym} chain={a.chain} address={a.tokenAddress} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${sym}</span>
                      <Pill tone="muted">{(a.chain || '').toUpperCase()}</Pill>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{gemAgo(a.alertedAt)} · {px}{a.marketCap ? ' · ' + gemCompactUsd(a.marketCap) + ' mcap' : ''}</div>
                  </div>
                  <ScoreRing score={Math.round(a.score || 0)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.length === 0 && !scan.on && alerts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--muted)' }}>
            <Icon name="scan" size={28} color="var(--faint)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>No gems scanned yet</div>
            <div style={{ fontSize: 12.5, marginTop: 3, maxWidth: 250, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>Tap “Scan now” to find fresh, safety-checked tokens across SOL, ETH, BSC &amp; Base.</div>
          </div>
        )}
        {scan.found > 0 && !scan.on && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--up-bg)', borderRadius: 11, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--up)' }}>
            <Icon name="checkCircle" size={16} /> {scan.found} new tokens found · scored 80+
          </div>
        )}
        {list.map((g, idx) => gemCard(g, idx))}
      </div>
      <GemSettingsSheet open={setOpen} onClose={() => setSetOpen(false)} cfg={cfg} onSaved={(s) => { setCfg(s); setSetOpen(false); }} />
      <ScanModal
        open={modal.open} done={modal.done} error={modal.err}
        onClose={() => { const openResults = modal.done && modal.total > 0; setModal(m => ({ ...m, open: false })); if (openResults) setView('results'); }}
        title="Gem scan" steps={GEM_SCAN_STEPS}
        summary={modal.total > 0 ? modal.total + (modal.total === 1 ? ' gem found' : ' gems found') : 'No gems found'}
        result={modal.total > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(window.FX.gems || []).slice(0, 4).map((g, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', borderRadius: 11, padding: '10px 12px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
                <Logo color={'#' + (g.sym.charCodeAt(0) * 4321 % 0xffffff).toString(16).padStart(6, '0')} sym={g.sym} chain={g.chain} img={g.img} address={g.address || g.tokenAddress} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${g.sym} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {g.narrative}</span></div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{g.mcap} mcap · {g.age} old</div>
                </div>
                {g.safe ? <Pill tone="up"><Icon name="shield" size={11} /> {g.score}</Pill> : <Pill tone="down"><Icon name="alert" size={11} /> {g.score}</Pill>}
              </div>
            ))}
            <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 2 }}>{modal.found > 0 ? modal.found + ' scored 80+ · ' : ''}Close to open the results page.</div>
          </div>
        ) : (
          <div style={{ fontSize: 13.5, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>No tokens matched your filters this scan. Try widening liquidity, volume or age in scan settings.</div>
        )}
      />
    </div>
  );
}

// Compact dropdown menu used for the gem scanner narrative & chain filters.
function Dropdown({ label, value, options, onChange, icon }) {
  const [open, setOpen] = tS(false);
  const cur = options.find(o => o.value === value) || options[0];
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 11,
        border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        background: 'var(--surface)', boxShadow: open ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)', transition: 'box-shadow .15s',
      }}>
        {icon && <Icon name={icon} size={16} color="var(--muted)" />}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', fontWeight: 600 }}>{label}</span>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur ? cur.label : '—'}</span>
        </span>
        <Icon name={open ? 'chevU' : 'chevD'} size={16} color="var(--faint)" />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 41, maxHeight: 264, overflowY: 'auto',
            background: 'var(--bg2)', borderRadius: 13, padding: 6, boxShadow: '0 12px 36px rgba(0,0,0,0.45), inset 0 0 0 1px var(--line)',
          }}>
            {options.map(o => {
              const on = o.value === value;
              return (
                <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 11px', borderRadius: 9,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  background: on ? 'var(--glow)' : 'transparent', color: on ? 'var(--accent)' : 'var(--text2)', fontSize: 13.5, fontWeight: on ? 800 : 600,
                }}>
                  {o.label}
                  {on && <Icon name="check" size={15} color="var(--accent)" stroke={3} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Advanced gem-scan settings — persisted to botSettings.gem* (drives both the
// manual scan and the processGemScanner auto scheduler).
function GemSettingsSheet({ open, onClose, cfg, onSaved }) {
  const [v, setV] = tS(cfg);
  const [busy, setBusy] = tS(false);
  const [err, setErr] = tS('');
  tE(() => { if (open) { setV(cfg); setErr(''); } }, [open, cfg]);
  const field = (key, label, hint, min, max, step) => (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
        <span>{label}</span><span style={{ color: 'var(--muted)', fontWeight: 600 }}>{hint}</span>
      </span>
      <input type="number" inputMode="decimal" min={min} max={max} step={step || 1} value={v[key]}
        onChange={(e) => setV(s => ({ ...s, [key]: e.target.value }))}
        style={{ width: '100%', padding: '11px 13px', borderRadius: 11, border: 'none', background: 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', boxShadow: 'inset 0 0 0 1px var(--line)', outline: 'none' }} />
    </label>
  );
  // Age row: a numeric amount + a unit dropdown (hours → years). `prefix` is
  // 'minAge' / 'maxAge'; reads/writes v[prefix+'Amount'] and v[prefix+'Unit'].
  const ageRow = (prefix, label, hint) => (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
        <span>{label}</span><span style={{ color: 'var(--muted)', fontWeight: 600 }}>{hint}</span>
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="number" inputMode="numeric" min={0} max={9999} value={v[prefix + 'Amount']}
          onChange={(e) => setV(s => ({ ...s, [prefix + 'Amount']: e.target.value }))}
          style={{ flex: 1, minWidth: 0, padding: '11px 13px', borderRadius: 11, border: 'none', background: 'var(--surface)', color: 'var(--text)', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', boxShadow: 'inset 0 0 0 1px var(--line)', outline: 'none' }} />
        <div style={{ width: 150, flexShrink: 0 }}>
          <Dropdown label="Unit" value={v[prefix + 'Unit']} options={GEM_AGE_UNITS} onChange={(u) => setV(s => ({ ...s, [prefix + 'Unit']: u }))} />
        </div>
      </div>
    </label>
  );
  // Chains the Telegram auto-alert scheduler scans + sends. At least one must
  // stay selected (an empty list would silently stop all Telegram alerts).
  const tgChains = Array.isArray(v.telegramChains) && v.telegramChains.length ? v.telegramChains : ['bsc', 'eth', 'sol', 'base'];
  const toggleChain = (id) => setV((s) => {
    const cur = Array.isArray(s.telegramChains) && s.telegramChains.length ? s.telegramChains : ['bsc', 'eth', 'sol', 'base'];
    const next = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id];
    return { ...s, telegramChains: next.length ? next : cur }; // never allow zero
  });
  const save = async () => {
    setBusy(true); setErr('');
    try { const saved = await window.FXAPI.saveGemSettings(v); onSaved(saved); }
    catch (e) { setErr(e.message || 'Could not save. Sign in and try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Scan settings">
      <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
        These tune both the manual scan and the automatic Telegram gem alerts.
      </div>

      {/* Telegram alert chains — which chains processGemScanner scans + sends. */}
      <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>
          <Icon name="telegram" size={15} color="#229ED9" /> Telegram alert chains
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 11 }}>
          The auto-alert bot scans these chains every 5 min and sends fresh gems to your Telegram. Tap to toggle — at least one stays on.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {GEM_TG_CHAINS.map(([id, label]) => {
            const on = tgChains.includes(id);
            return (
              <button key={id} onClick={() => toggleChain(id)} aria-pressed={on}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 13px', borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, transition: 'all .15s',
                  background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--muted)', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--line)' }}>
                {on && <Icon name="check" size={13} stroke={3} />}{label}
              </button>
            );
          })}
        </div>
      </div>
      {field('minLiquidity', 'Min liquidity', 'USD', 1000, 1000000000)}
      {field('minVolume', 'Min 24h volume', 'USD', 0, 1000000000)}
      {field('minMarketCap', 'Min market cap', 'USD (0 = any)', 0, 1000000000000)}
      {field('minScore', 'Min gem score', '0–100', 0, 100)}
      {ageRow('minAge', 'Min pair age', '0 = any')}
      {ageRow('maxAge', 'Max pair age', 'newest cutoff')}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 7 }}>Sort by</div>
        <Segmented options={GEM_SORT_OPTS} value={v.sort} onChange={(s) => setV(x => ({ ...x, sort: s }))} />
      </div>

      {/* Auto-execute (gem trading bot) — per-chain buy size + slippage. */}
      <div style={{ marginTop: 4, marginBottom: 10, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>
          <Icon name="zap" size={15} color="var(--accent)" /> Auto-execute (trading bot)
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
          When auto-execute is on, the bot buys this much native token per gem (score ≥ min gem score) from your funded bot wallet on each chain.
        </div>
      </div>
      {field('buyAmountBsc', 'Buy size — BSC', 'BNB per gem', 0, 1000, 'any')}
      {field('buyAmountEth', 'Buy size — ETH / Base', 'ETH per gem', 0, 1000, 'any')}
      {field('buyAmountSol', 'Buy size — Solana', 'SOL per gem', 0, 100000, 'any')}
      {field('buySlippage', 'Max slippage', '% (1–50)', 1, 50, 1)}

      {/* Exit rules armed on every auto-bought position (0 = rule off). The
          exit monitor sells automatically when one triggers — see Portfolio. */}
      <div style={{ marginTop: 4, marginBottom: 10, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>
          <Icon name="target" size={15} color="var(--accent)" /> Auto-exit (sell rules)
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
          Every auto-bought gem is armed with these rules; the bot sells automatically when one triggers. 0 turns a rule off. Manage armed positions in Profile → Portfolio.
        </div>
      </div>
      {field('exitTp', 'Take profit', '+% from entry (0 = off)', 0, 100000, 'any')}
      {field('exitSl', 'Stop loss', '−% from entry (0 = off)', 0, 99, 'any')}
      {field('exitTrail', 'Trailing stop', '% off peak (0 = off)', 0, 99, 'any')}
      {field('exitMaxHold', 'Max hold', 'hours (0 = off)', 0, 8760, 'any')}

      {err && <div style={{ fontSize: 12.5, color: 'var(--down)', marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
        <Btn kind="ghost" full onClick={() => setV(GEM_SETTINGS_DEFAULT)}>Reset</Btn>
        <Btn full icon={busy ? undefined : 'check'} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Btn>
      </div>
    </Sheet>
  );
}

function ScoreRing({ score }) {
  const col = score >= 75 ? 'var(--up)' : score >= 50 ? 'var(--accent)' : 'var(--down)';
  const r = 17, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
      <svg width="44" height="44" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--line)" strokeWidth="3.5" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={col} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: col, lineHeight: 1 }}>{score}</span>
      </div>
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--line2)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

// Manual scan button with progress sweep
function ScanButton({ on, onClick, label, busy, detail }) {
  return (
    <button onClick={onClick} disabled={on} style={{
      position: 'relative', overflow: 'hidden', width: '100%', display: 'flex', alignItems: 'center', gap: 11,
      padding: '13px 16px', borderRadius: 13, border: 'none', cursor: on ? 'default' : 'pointer', fontFamily: 'inherit',
      background: on ? 'var(--surface)' : 'var(--accent)', color: on ? 'var(--text)' : 'var(--on-accent)',
      boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : '0 6px 18px var(--glow)', transition: 'all .2s',
    }}>
      {on && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '40%', background: 'linear-gradient(90deg, transparent, var(--glow), transparent)', animation: 'fxsweep 1.2s linear infinite' }} />}
      <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26 }}>
        {on
          ? <span style={{ width: 18, height: 18, border: '2.5px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} />
          : <Icon name="scan" size={20} />}
      </span>
      <span style={{ position: 'relative', flex: 1, textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800 }}>{on ? busy : label}</span>
        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, opacity: 0.75 }}>{detail}</span>
      </span>
      {!on && <Icon name="refresh" size={18} style={{ position: 'relative' }} />}
    </button>
  );
}

// ─── Gem track record — the won/lost list behind the summary card ───
// Individual resolved gems from the last 90 days. Each token's outcome is its
// realized return (7d, or 24h while the 7d mark is still pending), re-priced
// server-side from when the scanner first surfaced it. Nothing self-reported.
const GEM_CHAIN_LABEL = { sol: 'SOL', eth: 'ETH', bsc: 'BSC', base: 'BASE' };
function GemTrackRecord({ go }) {
  const [data, setData] = tS(null);
  const [filter, setFilter] = tS('All');
  tE(() => {
    let alive = true;
    if (window.FXAPI && window.FXAPI.getGemOutcomes) {
      window.FXAPI.getGemOutcomes().then((r) => { if (alive) setData(r || { outcomes: [] }); }).catch(() => { if (alive) setData({ outcomes: [] }); });
    } else setData({ outcomes: [] });
    return () => { alive = false; };
  }, []);
  const all = (data && data.outcomes) || [];
  const wins = all.filter((o) => o.won).length;
  const losses = all.length - wins;
  const list = filter === 'All' ? all : filter === 'Won' ? all.filter((o) => o.won) : all.filter((o) => !o.won);

  if (!data) return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)' }}><span style={{ display: 'inline-block', width: 22, height: 22, border: '3px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} /></div>;

  return (
    <div style={{ padding: '4px 16px 24px' }}>
      {/* summary strip */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[['Tracked', all.length, 'var(--text)'], ['Up', wins, 'var(--up)'], ['Down', losses, 'var(--down)']].map(([l, v, c]) => (
          <div key={l} style={{ flex: 1, background: 'var(--surface)', borderRadius: 12, padding: '12px 8px', textAlign: 'center', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{l}</div>
          </div>
        ))}
      </div>
      {/* filter chips */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
        {['All', 'Won', 'Lost'].map((t) => <Chip key={t} active={filter === t} onClick={() => setFilter(t)}>{t}{t === 'Won' ? ` (${wins})` : t === 'Lost' ? ` (${losses})` : ''}</Chip>)}
      </div>
      {/* rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {list.map((o, i) => {
          const when = o.firstSeenAt ? new Date(o.firstSeenAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
          const window7 = o.perf7d != null;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--surface)', borderRadius: 12, padding: '11px 13px', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
              <Logo color={'#' + (((o.sym || '?').charCodeAt(0) * 4321) % 0xffffff).toString(16).padStart(6, '0')} sym={o.sym || '?'} chain={o.chain} address={o.address} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${o.sym || '—'}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--muted)', background: 'var(--chip)', padding: '1px 6px', borderRadius: 5 }}>{GEM_CHAIN_LABEL[o.chain] || (o.chain || '').toUpperCase()}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>Found {when || '—'} · {window7 ? '7d' : '24h'} return</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: o.won ? 'var(--up)' : 'var(--down)', fontVariantNumeric: 'tabular-nums' }}>{o.ret != null ? (o.ret >= 0 ? '+' : '') + o.ret + '%' : '—'}</div>
                {o.perf24h != null && o.perf7d != null && <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>24h {o.perf24h >= 0 ? '+' : ''}{o.perf24h}%</div>}
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
            <Icon name="trophy" size={26} color="var(--faint)" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>{all.length === 0 ? 'No tracked gems yet' : `No ${filter.toLowerCase()} gems`}</div>
            <div style={{ fontSize: 12.5, marginTop: 3 }}>{all.length === 0 ? 'Gems appear here once their 24h / 7d marks are priced.' : 'Switch the filter to see the rest.'}</div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>Realized price change of each gem this scanner surfaced, measured from when it was found. Last 90 days — not a prediction of future results.</div>
    </div>
  );
}

Object.assign(window, { TradeFlow, GemScanner, GemTrackRecord, Toggle, ScoreRing, ScanButton, Row });

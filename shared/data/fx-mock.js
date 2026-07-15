// FXcrypt app data — window.FX
//
// Only real, static configuration lives here now: the supported `chains`, the
// automation-type catalogue (`autoTypes`), the subscription `tiers` (real
// pricing), a few generic Pointer starter prompts, and the exchange catalogue
// (all disconnected until the user links real API keys). Every dynamic
// collection (tokens, holdings, signals, gems, alerts, automations, bubbles…)
// starts EMPTY and is populated only by the live data layer (fx-live / fx-api /
// FXWallet) or a real backend call. No prototype/sample records remain.
(function () {
  const chains = [
    { id: 'sol', name: 'Solana', sym: 'SOL', color: '#14F195', dex: 'Jupiter' },
    { id: 'eth', name: 'Ethereum', sym: 'ETH', color: '#627EEA', dex: 'Uniswap' },
    { id: 'bsc', name: 'BNB Chain', sym: 'BNB', color: '#F0B90B', dex: 'PancakeSwap' },
    { id: 'base', name: 'Base', sym: 'ETH', color: '#0052FF', dex: 'Aerodrome' },
    { id: 'rhood', name: 'Robinhood', sym: 'ETH', color: '#C3F53C', dex: 'Uniswap V2' },
    { id: 'poly', name: 'Polygon', sym: 'POL', color: '#8247E5', dex: 'QuickSwap' },
    { id: 'arb', name: 'Arbitrum', sym: 'ETH', color: '#28A0F0', dex: 'Camelot' },
  ];

  // deterministic sparkline generator
  function spark(seed, n, vol, up) {
    const out = [];
    let v = 50;
    let s = seed;
    for (let i = 0; i < n; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280;
      v += (r - 0.5) * vol + (up ? vol * 0.12 : -vol * 0.12);
      v = Math.max(8, Math.min(92, v));
      out.push(v);
    }
    return out;
  }

  // Live market list — populated by fx-live.refreshMarkets() (CoinGecko) on boot.
  const tokens = [];

  // Gem scanner results — populated by a real FXAPI.scanGems() run.
  const gems = [];

  // CEX signals — populated by fx-live.refreshSignals() from the user's feed.
  const signals = [];

  // Pointer starter prompts (generic UI affordances, not sample data).
  const suggestions = [
    'Scan for new gems on Solana',
    'What’s my portfolio PnL today?',
    'Find a high-confidence long setup',
    'What looks safe to buy right now?',
  ];

  // Wallet holdings — populated by fx-live.refreshWallet() (bot wallet) or the
  // self-custody FXWallet engine. The Wallet tab reads FXWallet directly.
  const holdings = [];

  // Bubble-map nodes — populated by FXAPI.holderGraph() (Helius / Moralis).
  const bubbles = [];

  // Automation rules — created by the user (no sample rules).
  const automations = [];
  const autoTypes = [
    { kind: 'dca', name: 'Recurring DCA', desc: 'Buy a fixed amount on a schedule', icon: 'clock', color: '#14F195' },
    { kind: 'sltp', name: 'Stop-loss / Take-profit', desc: 'Auto-exit at your risk levels', icon: 'shield', color: '#F6465D' },
    { kind: 'limit', name: 'Limit / trigger order', desc: 'Execute when price hits a target', icon: 'target', color: '#FCD535' },
    { kind: 'copy', name: 'Copy-trading', desc: 'Mirror a top trader automatically', icon: 'user', color: '#7B61FF' },
    { kind: 'trail', name: 'Trailing stop', desc: 'Lock gains as price climbs', icon: 'trend', color: '#00C2FF' },
    { kind: 'rebal', name: 'Auto-rebalance', desc: 'Hold target portfolio weights', icon: 'layers', color: '#16C784' },
  ];

  // Price/whale/signal alerts — created by the user (no sample alerts).
  const alerts = [];
  // Notification feed — filled by real events (no sample notifications).
  const notifs = [];

  // Self-custody wallets, connected dApps and saved contacts all live in the
  // FXWallet engine (Firestore-backed), not here. Kept empty for any legacy reads.
  const wallets = [];
  const connectedApps = [];
  const contacts = [];

  // Exchange catalogue — all disconnected until the user links real API keys;
  // fx-live.refreshExchanges() flips `connected`/`bal` from live balances.
  const exchanges = [
    { id: 'binance', name: 'Binance', color: '#F0B90B', connected: false, bal: '', perms: '' },
    { id: 'bybit', name: 'Bybit', color: '#F7A600', connected: false, bal: '', perms: '' },
    { id: 'mexc', name: 'MEXC', color: '#1972F5', connected: false, bal: '', perms: '' },
    { id: 'okx', name: 'OKX', color: '#1E1E1E', connected: false, bal: '', perms: '' },
    { id: 'kraken', name: 'Kraken', color: '#5741D9', connected: false, bal: '', perms: '' },
    { id: 'kucoin', name: 'KuCoin', color: '#23AF91', connected: false, bal: '', perms: '' },
  ];
  // Sessions are derived live from the browser; referrals load from the backend.
  const sessions = [];
  const referrals = [];

  const tiers = [
    { id: 'free', name: 'Free', price: '$0', per: 'forever', fee: '1.0%', accent: false, feats: ['Manual DEX/CEX trade', '5 gem scans / day', '15 Pointer messages / day', 'Basic alerts', 'View-only signals', '1 wallet / exchange'] },
    { id: 'pro', name: 'Pro', price: '$29', per: '/ month', fee: '0.5%', accent: true, popular: true, feats: ['Everything in Free, plus', 'Unlimited + auto gem scans', '200 Pointer messages / day', 'Custom alerts + push', 'Full signals + Telegram', 'Limited automation (SL/TP/DCA)', '5 wallets / exchanges', 'Priority support'] },
    { id: 'elite', name: 'Elite', price: '$99', per: '/ month', fee: '0.2%', accent: false, feats: ['Everything in Pro, plus', 'Priority gem scans', 'Unlimited Pointer (fair-use)', 'Auto-execute signals', 'Full automation + copy-trade', 'Unlimited wallets', 'Holder analytics + alerts', 'Concierge support'] },
  ];

  window.FX = { chains, tokens, gems, signals, suggestions, holdings, bubbles, tiers, spark, automations, autoTypes, alerts, notifs, wallets, connectedApps, contacts, exchanges, sessions, referrals };
})();

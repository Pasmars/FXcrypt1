# FXcrypt

A crypto trading platform: multi-chain wallets, DEX and CEX trading, an autonomous
gem-scanner/trading bot with Telegram alerts, verified signal generation, and an AI
trading assistant (Pointer).

See [`docs/PRODUCT_STRATEGY.md`](docs/PRODUCT_STRATEGY.md) for the full product picture
and current status.

## What it does

- **Trading loop** — multi-chain gem scanner with auto-buy, server-bookkept positions
  with live PnL, and automated exits (take-profit, stop-loss, trailing, max-hold).
  Paper trading mode simulates the whole loop.
- **Signals** — CEX signal generation across spot and futures, with every signal
  resolved on-exchange into a public win-rate track record.
- **Wallets** — custodial bot wallets plus non-custodial FXWallet self-custody, across
  ETH, BSC, Base, Polygon, Solana, TON, and Robinhood Chain.
- **Pointer** — a tool-calling AI agent with deep research, proactive watch-tasks,
  metered usage, and an MCP connection to Glassnode on-chain analytics.
- **Analysis** — bubble-map holder clustering, contract safety checks, arbitrage
  scan/execute.
- **Platform** — crypto-native checkout (Free/Pro/Elite), server-enforced entitlements,
  referrals, web push, and an admin panel with per-user usage controls.

## Repo layout

| Path | What it is |
| --- | --- |
| `/` | Legacy static PWA (original root app — still served, largely superseded) |
| `mobile/` | Mobile PWA |
| `webapp/` | Next.js port of the mobile PWA, deployed as a static export |
| `shared/` | Screens and libs shared between `mobile/` and `webapp/` |
| `functions/` | Firebase Cloud Functions — Telegram bot, trading loop, scanners, billing |
| `admin/` | Admin panel |
| `android/` | Android wrapper |
| `docs/` | Product strategy, roadmap, and integration notes |

UI code is duplicated across the root app, `mobile/`, and `webapp/`. A change that lands
in only one copy is the most common source of drift here — when touching shared UI
behavior, check all three.

## Development

The root app is static — open `index.html` in a browser, or serve the directory.

```bash
# Next.js webapp
cd webapp && npm install && npm run dev
```

The webapp **must** be built with `STATIC_EXPORT=1`, or the deployed `out/` directory
will be stale:

```bash
cd webapp && STATIC_EXPORT=1 npm run build
```

```bash
# Cloud Functions
cd functions && npm install && npm run serve
```

Deploys are Firebase-hosted (`firebase.json`); functions deploy to `europe-west1`.

## Note

Nothing here is financial advice. Automated trading carries real risk of loss.

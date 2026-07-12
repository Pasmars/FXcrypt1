# FXcrypt — Product Strategy Document
*Prepared from a senior product management lens: current state, gaps, and a path to profitability.*
*Last updated 2026-07-11 to reflect the signal-bot hardening + track-record depth build-out (see §0.1).*

---

## 0. Status Update — the strategy in this doc has largely been executed (2026-07)

When this doc was first written the product was **pre-monetization** with most revenue and retention features "proposed." **Those proposals are now built, deployed, and live in production.** Highlights:

**Monetization is live (crypto-only):**
- **Entitlements + tiers** (Free/Pro/Elite) fully server-enforced; **AI metering & credits** (monthly Pointer + gem-scan quotas, non-expiring credit packs); **configurable platform trading fee** (admin sets % per plan + a receiving wallet per chain, charged natively on each manual DEX trade); **crypto checkout** (USDT/USDC/native on ETH/BSC/Base/SOL) with **annual billing** (12-for-10); **admin-priced plan cards** (cards read the admin's prices so they never drift from checkout); **paywall conversion funnel** analytics.
- Card/Stripe checkout was **removed from the app** (backend dormant, reversible) — the product is deliberately crypto-native.

**The trading loop is closed** (was the biggest gap — "the bot buys but never sells"):
- **Position Manager** (server-bookkept positions, live PnL), **automated exits** (take-profit / stop-loss / trailing / max-hold via a 1-min monitor), **auto-buy exit defaults**, **trade journal + CSV export**.

**Proof, retention & growth loops shipped:**
- **Verified signal track record** (every signal resolved on-exchange → public win-rate/avg-R, surfaced on the paywall) and **gem hindsight stats** (how surfaced gems actually performed).
- **Paper trading mode** (the full autonomous loop simulated; the free-tier on-ramp).
- **Web push** (FCM, both apps, per-category, deep links), **real price alerts**, **Pointer proactive watch-tasks** ("watch X and ping me"), **daily portfolio digest**.
- **Referral program** (server codes, attribution, reward on referee's first payment) and **smart-money copy trading** (follow wallets → safety-checked buy alerts → Elite auto-copy with exits armed → wallet leaderboard).

**AI depth:**
- **Pointer** now has usage metering, a **deep-research** top-tier-model toggle, streaming replies, copy buttons, **clickable shortened source links** (from live web_search), **proactive monitors**, and a **safe MCP connection to Glassnode** (on-chain analytics tools, public or API-key access, admin-configured + monitored).

**Still open (the honest gaps):** WalletConnect / hardware-wallet / external signing (the #1 trust/liability item — keys are still custodial), a security audit, exchange affiliate links, backtesting, multi-language/accessibility, chart-image & voice input, a status/health page, and full tax reporting (raw CSV export exists). These are the priorities for the next phase.

Sections 4/6/7/10 below are annotated with **[LIVE]** where a proposal has shipped.

---

## 0.2 Latest increment — signal-bot correctness audit + CEX exit monitor (2026-07-12)

A correctness pass over the whole signal-bot loop plus the missing piece of trade accounting. All live in production:

**Critical bugs fixed (full audit of generation → delivery → execution → resolution):**
- **Track-record corruption** — the resolver's Bybit candle fallback read the wrong kline fields (its "high" was the low, "low" the close, "close" the turnover), corrupting any outcome resolved via Bybit. Fixed + parser-tested.
- **Futures signals missing from the record** — the resolver only fetched Binance/Bybit *spot* candles, so futures-only symbols never resolved; now falls through **7 venues** (Binance spot/USDM ×3 bases, Bybit spot+linear, MEXC spot+contract, KuCoin).
- **Wrong-direction executions** — spot orders ignored `side` (a SHORT spot signal was market-*bought*; now refused with a clear "shorts are futures" error), and **Telegram approvals dropped marketType/leverage/side** (futures shorts became unleveraged spot buys; now full parity with the app path incl. bracket attach).
- **Auto-execute decoupled from Telegram** — it only ran inside the TG-delivery block, so traders without Telegram never auto-executed.

**[LIVE] CEX exit monitor (`processCexExits`, every 10 min)** — `cexTrades` docs now **close with realized PnL** (they were opened and never closed). Exchange truth first: futures position-flat detection with **real PnL from fills** (Binance `userTrades`, Bybit `closed-pnl`), spot **OCO leg status** for bracket trades; candle-walk TP1/SL estimate as fallback (flagged `pnlEstimated`); 30-day timeout close. Docs get `exitPrice / exitReason (tp1|sl|manual|trail|timeout) / pnl / pnlPct`, one in-app push per close.

**[LIVE] Trailing-runner exit mode (`exitMode: 'trail'`, futures, opt-in)** — the "partial at TP1 + trail the runner" mode from the roadmap, built on the monitor: entry places a **half-position TP1** (reduce-only) + full hard stop; when TP1 banks, the monitor **moves the stop to breakeven** and then **ratchets it behind the 1h-candle peak** (1R gap, tightening to 0.5R once price clears TP2, never below BE) until the runner is stopped out — closed with **real PnL from fills** (TP1 partial + runner summed). Signals UI: "Bank all at TP1" / "Half out · trail rest" selector under the bracket toggle. Spot keeps full-close (OCO can't split).

**[LIVE] Brackets + trailing on all three futures venues** — the bracket-exit and trail mode now cover **Binance** (TP/STOP-market + closePosition), **Bybit** (conditional reduce-only market orders, auto-cancelled by the venue on flat; real PnL via `closed-pnl`) and **MEXC** (contract plan-orders, 7-day validity re-armed on every ratchet; PnL estimated — the venue has no usable fill-PnL query). The exit monitor dispatches order management per venue through one adapter table; sizes are read from the live position (Bybit/MEXC order responses don't return fill qty).

---

## 0.1 Previous increment — signal-bot hardening + track-record depth (2026-07-11)

A focused build-out that makes the **CEX signal bot** trustworthy and analyzable end-to-end, deepens the **verified track records**, and closes several delivery/UX gaps. All shipped to production (fxcrypt-app + fxcrypt-webapp + Cloud Functions):

**CEX signal bot — quality & execution:**
- **De-duplication + cooldown policy** (all four signal-generation paths): **max one active signal per symbol + timeframe**, a rest period after resolution (**6h after a TP win, 18h after a stop**), and an **opposite-bias whipsaw guard** (skip a symbol that just printed the other side). Kills the repeated-symbol noise.
- **Spot + futures both scanned** — the scheduled scan defaulted to spot-only (the app never persisted `marketTypes`) so futures never fired; now defaults to both, and signals are **ranked by score before the save cap** so strong futures setups actually persist and show in the app (previously spot filled every slot).
- **Fixed-$ per-trade sizing** alongside % of balance — traders choose a % of USDT balance *or* a fixed dollar amount per trade; applied consistently across all execution paths (app approve, auto-execute, Telegram approve).
- **[LIVE] CEX bracket-exit (Binance)** — the first real CEX *exit* management: after entry, best-effort attach an exchange-native **TP1 + hard-stop bracket** (futures: TAKE_PROFIT_MARKET + STOP_MARKET with `closePosition`; spot: an OCO). **Full-close at TP1** to maximize realized win rate. Opt-in (`agentSettings.bracketExit`, default off) with a Signals toggle; never unwinds the entry on failure. *(Bybit/MEXC bracket + "partial at TP1 + trail the runner" still open.)*

**Track records — depth & durability:**
- **Durable signal-outcome records** — outcomes are now written to a permanent server-only collection at resolution time, so the drill-down survives the ephemeral per-user signal doc's TTL (the list was going empty).
- **Full per-signal detail** in the track record — tappable rows expand to show **when it was called, when it hit TP/SL (exact candle time) + hold duration**, entry/stop/targets, R multiple, confidence, exchange, timeframe, market type and leverage.
- **Gem 90-day track record** (mirrors the signal card) + **clickable won/lost drill-downs** for both the gem and signal records.
- **[LIVE] Pointer can analyze both track records** — a `get_track_record` tool exposes the verified signal + gem records (win rate, avg R, 24h/7d gem returns, and individual recent won/lost outcomes with timing/levels) so Pointer can critique edge, hold time and setup quality.

**Delivery, wallet & UX fixes:**
- **Telegram delivery fixed** — gem *and* signal alerts were failing 100% ("can't parse entities" from token names/emojis breaking legacy Markdown); rebuilt as **HTML with escaping**. Verified live (deliveries went 0 → N).
- **In-app "Auto-scanned" gem feed** — the 5-min scheduler's finds are now **listed in the app** (Gem Scanner), not only pushed to Telegram; and each surfaced gem is logged **independent of Telegram success** (the log write previously sat after a failing send).
- **Wallet: import/add custom tokens across chains** — paste a contract/mint in Manage wallets to track any token; **EVM (auto symbol+decimals on-chain) + Solana SPL**; per-wallet chips with remove. **Security hardening:** wallet password minimum raised **6 → 8**.
- **USD-denominated native-coin buys** — the manual DEX buy flow adds a **native/USD toggle** so you can enter the dollar worth of the pay coin (converts to native for execution).
- **App icon** switched to the "F·" brand mark (PWA icons, favicons, Android launcher); **Pointer list-numbering fix** (loose markdown lists were restarting every item at "1.").

---

## 1. Executive Summary

**FXcrypt** is an all-in-one crypto trading and intelligence platform that combines on-chain DEX trading, centralized-exchange (CEX) signal trading, token research/analytics, portfolio management, and an AI agent ("Pointer") — accessible across **web, PWA, Android (APK), Telegram, and Discord**.

It sits at the intersection of three hot categories:
1. **DEX trading bots** (Trojan, BonkBot, Maestro, Banana Gun)
2. **Token analytics/scanners** (DEXScreener, DexTools, Bubblemaps)
3. **AI trading copilots** (an emerging category)

The product is feature-rich and technically mature, and — as of the 2026-07 build-out — **monetized and feature-complete against its original strategy** (see §0). The core infrastructure now earns via trading fees + subscriptions + AI credits, closes the full find→enter→manage→exit→prove→notify→convert→refer loop, and differentiates on AI depth (Pointer + Glassnode MCP). The next frontier is **trust/custody (WalletConnect + audit)** and **scale (growth loops, reliability)**.

---

## 2. Product Overview & Positioning

**Positioning statement:** *"The AI-powered command center for on-chain and CEX traders — research, trade, automate, and track everything in one place, on any device."*

**What makes it differentiated today:**
- **Multi-surface**: the same backend powers web, Telegram, and Discord — most competitors are single-surface (usually Telegram-only).
- **AI-native**: Pointer + the Discord agent give conversational research and gated trade execution — a genuine differentiator vs. menu-driven bots.
- **Breadth**: spans DEX (6 chains) *and* CEX (4 exchanges, spot + futures) *and* analytics (holders, bubble maps, gem scanning) *and* portfolio — competitors usually do one slice.

**Deployment footprint:**
- Legacy static app -> pnl-calculator.web.app
- Primary app (Next.js) -> fxcrypt-app.web.app + installable PWA + signed Android APK (TWA)
- Backend: Firebase (Auth, Firestore, Cloud Functions europe-west1)

---

## 3. Target Users (Personas)

| Persona | Needs | Which features serve them |
|---|---|---|
| **Degen / memecoin sniper** | Fast gem discovery, safety checks, instant buys, anti-rug | Gem Scanner, DEX Bot, honeypot/safety, Pointer |
| **Active CEX trader** | Signals, futures setups, auto-execution | CEX Bot, signal engine, exchange keys |
| **Researcher / analyst** | Holder distribution, bubble maps, token deep-dives | Tracker, Bubble Map, Pointer, Prices |
| **Portfolio holder** | Track holdings, PnL, multi-chain balances | Wallet, PnL Calc, Tracker watchlist |
| **Passive / busy user** | Alerts, automation, "tell me what's happening" | Telegram/Discord alerts, Pointer, auto-scan |

---

## 4. Current Feature Inventory (by module)

### 4.1 Pointer — AI Chat & Agent (post-login landing page)
- Conversational chatbot **and** autonomous research/ops agent.
- **Admin-selected model** (DeepSeek / OpenAI, set centrally — users no longer switch) plus a **[LIVE] deep-research toggle** that runs the provider's top-tier model with more reasoning headroom (Pro-gated).
- **20+ tools** spanning the whole app + **[LIVE] Glassnode MCP tools** (`gn_*`, on-chain analytics) when the admin enables the connection; gated trade proposals (Approve/Reject) with **on-chain address verification** (no hallucinated contracts).
- **[LIVE] Usage metering & credits**, **streaming replies** + copy buttons, **clickable shortened source links** (real web_search citations), and **proactive watch-tasks** ("watch BTC, ping me if it breaks $150k" → 24/7 monitor → metered analysis + push).
- Runs server-side (always-on Cloud Function); excludes Wallet & PnL by design.

### 4.2 DEX Bot
- **Manual Trade**: buy/sell tokens across **BSC, ETH, SOL, Base** (PancakeSwap, Uniswap, Jupiter, etc.), slippage/gas controls, USD-equivalent sizing with a **[LIVE] native/USD denomination toggle** (enter the dollar worth of the pay coin, converts to native for execution). **[LIVE] Token picker** — search any tradable token by name, ticker, or contract address (DexScreener live search, liquidity-ranked). **[LIVE] Configurable platform fee** skimmed natively per trade; real pool-liquidity readout; tx links to explorers. No more mock fills — non-tradable assets error honestly.
- **Gem Scanner**: narrative search, market-cap/volume/age/score/liquidity filters, trend & sort; sources stacked (DexScreener + GeckoTerminal + DexTools); auto-scan every 5 min → **Telegram alerts (HTML) *and* an [LIVE] in-app "Auto-scanned" feed** (the scheduler's finds are logged and listed in the app, independent of Telegram delivery); honeypot/safety gating. **[LIVE] Per-chain Telegram-alert selector**, **auto-execute (auto-buy)** with per-chain size/slippage + **armed exit defaults (TP/SL/trailing/max-hold)**, **hindsight stats** (median/best 24h & 7d), and a **[LIVE] 90-day gem track record** with a clickable won/lost drill-down.
- **Bot Wallets**: encrypted key storage per chain (two-tier, PBKDF2 600k).
- **Telegram & Discord AI** integration tabs.

### 4.2a [LIVE] Portfolio & the closed trading loop
- **Position Manager**: every buy/sell (manual, Pointer-approved, gem auto-buy, copy, exit) is server-bookkept into positions with volume-weighted entry, live unrealized/realized PnL, and auto-close.
- **Automated exits**: a 1-minute monitor prices every armed position and executes **take-profit / stop-loss / trailing-stop / max-hold** sells from the bot wallet — gated by an admin kill-switch, per-user flag, and daily trade cap; retries then alerts on failure.
- **Portfolio screen** (both apps): open positions with 30s live PnL, exit-rule editing, partial sells, closed history, and a **trade journal with CSV export**.

### 4.2b [LIVE] Paper trading mode
- Account-level toggle; the **entire loop is simulated server-side** (manual, Pointer, gem auto-buy, exits) at live prices — enforced *before* any key/chain access, so it provably moves no funds and needs no wallet. Paper and real positions/trades are fully segregated. This is the **free-tier on-ramp** (experience everything, then upgrade — a paper-profit banner prompts the switch).

### 4.2c [LIVE] Copy trading (Elite flagship)
- Follow any wallet (BSC/ETH/Base/SOL); a 2-min monitor detects its DEX buys (Moralis/Helius), **safety-checks the token**, and pushes an alert. **Auto-copy** (Elite, or paper for anyone) buys through the same guardrails as gem auto-buy with exits armed; a **wallet leaderboard** ranks followed wallets by tracked performance.

### 4.3 CEX Bot (formerly "AI Agent")
- **Signal engine**: technical analysis (EMA, RSI, MACD, Bollinger, ATR, volume), market-structure detection (swings, FVGs, order blocks), TradingView merge, fundamental scoring -> scored long/short setups with entry/SL/TP1-3/R:R.
- **Exchanges**: connect Binance, MEXC, Bybit, KuCoin (encrypted API keys); spot + futures balances.
- **Auto-execution** (optional) with **[LIVE] % of balance *or* fixed-$ per-trade sizing**; signal history; Telegram delivery (HTML) with approve buttons.
- Scheduled scans every 15 min; **[LIVE] scans spot + futures by default** and **ranks by score** so both surface in the app.
- **[LIVE] De-dup + cooldown policy**: max one active signal per symbol+timeframe, 6h rest after a TP / 18h after a stop, and an opposite-bias whipsaw guard — enforced on every generation path.
- **[LIVE] CEX bracket-exit (Binance, opt-in)**: after entry, best-effort exchange-native **TP1 + hard stop** (futures TP/STOP-market with `closePosition`; spot OCO) that **banks the full position at TP1** for a higher realized win rate; the entry always stands even if the bracket fails.
- **[LIVE] Verified track record**: every published signal is resolved against its SL/TP using exchange candles → 30/90-day win-rate + avg R-multiple (**durable records**, so the list persists), shown on the Signals screen and used as the **paywall's proof point**. **[LIVE] Full per-signal detail** on tap — called/hit timestamps + hold duration, entry/stop/targets, R, confidence, exchange, timeframe, market type, leverage. Pointer can analyze it via `get_track_record`.

### 4.4 Tracker
- **Token tab**: search by name/ticker/contract; full token card (price, MCap, volume, liquidity, 24h, **holder count**); personal **watchlist** with live auto-refresh.
- **Wallet tab**: inspect any wallet's holdings & value across chains; saved wallets.
- **Bubble Map**: holder distribution + connected-wallet clustering (whale/insider/bundling signal) via Moralis/Helius.

### 4.5 Wallet (unified portfolio)
- Multi-chain portfolio (6 chains), total USD, asset list with logos, **send/receive + QR**, tx history, single-password lock screen (**[LIVE] min length raised 6→8**), idle auto-lock, CSP-hardened, address validation.
- **[LIVE] Import/add custom tokens across chains**: paste a contract/mint in Manage wallets to track any token — **EVM (symbol+decimals auto-detected on-chain) + Solana SPL** — with per-wallet token chips and remove.

### 4.6 Prices / PnL Calculator / Token detail
- Live prices & watchlist; PnL calculator (entry/exit, fees, leverage); per-token detail pages.

### 4.7 Cross-surface & platform
- **Telegram bot**: prices, watchlist, wallet tracker, arbitrage, gem alerts (per-chain configurable), trade execution, CEX key mgmt, settings, profile.
- **Discord agent**: free-text conversational agent (same brain as Pointer) with gated trades.
- **Arbitrage scanner**: cross-DEX spread detection.
- **[LIVE] Web push notifications** (FCM, mobile PWA + webapp): per-category mutes (trades, gems, signals, alerts, tasks, copy, system), opt-in only, deep-linked taps; also fixed the previously-unregistered service worker (PWA offline cache now active).
- **[LIVE] Real price alerts** (above/below/±% on any token/coin, plan-capped) and **[LIVE] daily portfolio digest** (opt-in, Pointer-composed morning brief via push + Telegram).
- **Light/Dark theming**, PWA install, signed Android APK; **[LIVE] CI guard** (builds both apps + syntax-checks functions on every push).

### 4.8 The AI tool suite (shared by Pointer + Discord)
Balances, bot settings, recent trades, gem alerts, live gem scan, cross-chain token search, market browse, prices, **live web/news search (with cited sources)**, token safety, holder counts, bubble map, arbitrage scan, CEX/futures signals, recent signals, CEX balances, token info, full watchlist read, track/untrack tokens, **standing watch-tasks (create/list/cancel)**, **[LIVE] `get_track_record`** (verified signal + gem bot performance with per-signal timing/levels for edge analysis), gated trade proposals, and — when enabled — **Glassnode on-chain analytics (`gn_*`) via MCP**. (No Wallet/PnL access by design.)

### 4.9 [LIVE] Referral program & growth
- Server-issued referral codes, permanent signup attribution, and a reward (Pointer credits) paid on the referee's **first payment** (anti-abuse, idempotent). Real Referral screen shows the click → signup → paid funnel; admin can adjust balances.

### 4.10 [LIVE] Glassnode MCP integration (AI × on-chain data)
- The Cloud Function acts as a standards-compliant **MCP client** to `mcp.glassnode.com`, discovering its tools and bridging them into Pointer (namespaced `gn_*`, allowlisted, capped, timed-out). **Public access works with no API key** (30-day history); adding a key removes the limit. Fully **admin-configured & monitored** (enable/URL/token/allowlist + live test + usage/error counters); token is server-only and never returned to the client. Verified end-to-end against the live Glassnode server (11 tools, real data).

---

## 5. Architecture (one-paragraph summary)

Next.js web app on Firebase Hosting -> authenticated **Cloud Functions** (europe-west1) -> Firestore + on-chain RPCs + data APIs (DexScreener, GeckoTerminal, Moralis, Helius, GoPlus, Honeypot.is, RugCheck, CoinGecko, TradingView) + CEX APIs. AI inference is **outsourced** to DeepSeek/OpenAI; the agent **orchestration** runs in Cloud Functions (Pointer) or a local gateway bot (Discord). Wallet keys are encrypted (PBKDF2 600k) and only decrypted server-side for execution.

---

## 6. Proposed Features & Enhancements

Prioritized by **Impact x Effort** (a lightweight RICE view). [STAR] = highest leverage.

### 6.1 Revenue-enabling — **all shipped**
| Feature | Status |
|---|---|
| **Subscription/entitlement system** (tiers, feature gating, usage quotas) | **[LIVE]** server-enforced Free/Pro/Elite |
| **Platform trading fee** on DEX swaps (auto fee-transfer per trade) | **[LIVE]** admin % per plan + per-chain fee wallet, native skim per trade |
| **AI usage metering / credits** (Pointer & gem scans) | **[LIVE]** monthly quotas + non-expiring credit packs |
| **Billing** (crypto/USDT pay + annual) | **[LIVE]** crypto-only checkout, annual 12-for-10; Stripe removed from app |
| Exchange referral links (Binance/Bybit/KuCoin/MEXC) | **Open** — user referral shipped, exchange affiliate not yet |

### 6.2 Productivity / "make it stickier"
| Feature | Status |
|---|---|
| **Auto-trade automation**: SL/TP, trailing stop, max-hold, auto-buy | **[LIVE]** DEX exit monitor + gem auto-buy with armed exits; **[LIVE] CEX bracket-exit on Binance/Bybit/MEXC futures** (TP1 + hard stop, full or half-out-and-trail); **[LIVE] CEX exit monitor** closing trades with realized PnL |
| **CEX signal quality**: de-dup, cooldowns, opposite-bias guard, spot+futures, fixed-$ sizing | **[LIVE]** all shipped this cycle |
| **Copy-trading / wallet mirroring** | **[LIVE]** follow → alert → Elite auto-copy + leaderboard |
| **Real PnL** auto-computed | **[LIVE]** Position Manager (from executed trades) — *full on-chain-holdings link still open* |
| **Custom alert builder** + push | **[LIVE]** price alerts + FCM push |
| **Tax / CSV export** | **[LIVE]** trade-journal CSV (full tax reporting still open) |
| Backtesting for signals/strategies | **Open** |
| Pre-trade simulation (honeypot/tax/slippage preview) | **Partial** — pool liquidity + on-chain slippage shown; full tax/honeypot preview open |
| Limit orders / DCA | **Open** (routed to "soon" in the automation chooser) |

### 6.3 UX & trust
| Feature | Status |
|---|---|
| **Onboarding wizard** + empty-state coaching | **[LIVE]** both apps (honest empty states throughout) |
| **Shareable trade/PnL cards + referral program** | **[LIVE]** referral program (shareable cards still open) |
| **Native/web push** | **[LIVE]** FCM web push (native APK push still to validate) |
| **WalletConnect / hardware-wallet / external signing** | **OPEN — #1 priority** (keys remain custodial) |
| 2FA, session management, withdrawal allowlists | Partial (2FA/sessions screens exist) |
| Multi-language, accessibility pass | **Open** |
| Status/health page & better error states | **Open** |

### 6.4 AI depth (your differentiator)
- **[LIVE] Scheduled "daily brief" digests**, **[LIVE] strategy/watch-task agent** ("watch X and alert/act when Y"), **[LIVE] cited web sources**, **[LIVE] Glassnode on-chain analytics via MCP**, **[LIVE] deep-research model routing** (top-tier model on demand).
- **Still open:** cross-session Pointer memory (persistent research), chart/image upload & voice input.

---

## 7. Monetization Strategy

Crypto trading tools have **four proven revenue engines**. The winning approach combines them, led by trading fees + subscriptions.

### 7.1 Revenue options (ranked)

**A. [STAR] Platform trading fee (volume-based) - PRIMARY.**
Take a small fee on each DEX swap (and optionally CEX auto-trades) routed through the bot. This is how Trojan/BonkBot/Maestro/Banana Gun earn the bulk of their (often 7-8 figure) revenue.
- Suggested: **0.5-1.0%** per swap, tiered down by plan (Free 1.0% -> Pro 0.5% -> Elite 0.2%).
- Pros: scales with usage, no paywall friction, aligns with value. Cons: needs volume; must be transparent.

**B. [STAR] Freemium subscriptions - RECURRING BASE.**
Gate depth/automation/AI behind tiers (table below).

**C. AI credits / metered usage.**
Free daily Pointer/Discord quota; sell credit packs or include larger quotas in higher tiers. Recovers your real DeepSeek/OpenAI/data costs and creates an upsell.

**D. Affiliate / referral (passive).**
- CEX referral commissions (Binance/Bybit/KuCoin/MEXC) - you already integrate these exchanges.
- RPC/data and wallet affiliate deals.

**Secondary / later:** white-label or API licensing; one-time lifetime APK deal; optional web3 "premium pass" (NFT/token) for crypto-native upsell; performance fee on copy-trading (small % of profits).

### 7.2 Recommended packaging (tiers)

| Capability | Free | Pro (~$29/mo) | Elite (~$99/mo) |
|---|---|---|---|
| Manual DEX/CEX trade | Yes (1.0% fee) | Yes (0.5% fee) | Yes (0.2% fee) |
| Gem scans / day | 5 | Unlimited + auto-scan | Unlimited + priority |
| Pointer messages / day | 15 | 200 | Unlimited (fair-use) |
| Alerts | Basic | Custom + push | Custom + priority |
| Signals (CEX/futures) | View only | Full + Telegram | Full + auto-execute |
| Automation (SL/TP/DCA/copy-trade) | - | Limited | Full |
| Wallets / exchanges connected | 1 | 5 | Unlimited |
| Bubble maps / holder analytics | Limited | Full | Full + alerts |
| Support | Community | Priority | Concierge |

Annual discount (~2 months free) to boost LTV; crypto/USDT and card payments.

### 7.3 Unit economics to watch (PM rigor)
You have **real variable costs** - price every tier to cover them with margin:
- **AI inference** (DeepSeek cheap, OpenAI ~$0.15-0.60/M tokens), data APIs (Moralis/Helius paid tiers), RPC, Firebase (functions/Firestore reads).
- Rule of thumb: target **>=70% gross margin** per paid user after AI+data+infra. Meter AI to prevent a single Elite user from burning margin.
- North-star for trading-fee revenue = **total swap volume routed**. Drive it via free-tier trading (no paywall on the act of trading - paywall the edge).

### 7.4 Phased rollout — **Phases 1–3 delivered**
- **Phase 1 [DONE]:** Entitlements + crypto billing → Pro/Elite subscriptions + configurable trading fee. *(Exchange affiliate links still open.)*
- **Phase 2 [DONE]:** AI credits/metering; automation suite (SL/TP/trailing/max-hold + auto-buy); referral program.
- **Phase 3 [DONE]:** Copy-trading (flagship), web push. *(API/white-label + performance fees on copy-trading still open.)*
- **Phase 4 (next):** WalletConnect + security audit (unlock trust / de-risk custody); exchange affiliate; backtesting; reliability/status page; shareable cards; native APK push validation.

### 7.5 Indicative scenario (illustrative, not a forecast)
If 2,000 active traders route **$3M/mo** swap volume at a blended **0.5%** -> **$15k/mo** fee revenue; plus 150 Pro + 30 Elite subs -> **~$7.3k/mo** recurring; plus referrals. Revenue scales with volume and activation, which is why the free tier should maximize trading, not block it.

---

## 8. Go-to-Market (brief)
- **Wedge:** lead with the AI agent (Pointer) + gem scanner - your clearest differentiators - to acquire degens via Telegram/Discord/X.
- **Loops:** referral program + shareable PnL/trade cards + free Telegram alerts as top-of-funnel.
- **Trust:** publish a security page (key handling, audits), add WalletConnect to lower the custody barrier, and be transparent about fees.
- **Community:** Discord as the hub (you already have the agent there).

---

## 9. Risks, Compliance & Security (must-address)
- **Key custody is your #1 risk.** Storing encrypted private keys = high liability. Prioritize WalletConnect/external signing; treat server key storage as opt-in with clear warnings. Get a **security audit** before charging money.
- **Regulatory:** trading fees/auto-execution may trigger money-transmission/securities scrutiny depending on jurisdiction; add Terms, disclaimers ("not financial advice"), and consider geo-restrictions. Consult counsel before monetizing.
- **Reliability:** you have already hit RPC/endpoint issues - invest in redundancy + a status page; paying users expect uptime.
- **AI/financial safety:** keep trade gating; never let the agent auto-execute without explicit user consent and limits.

---

## 10. Roadmap — original 90-day plan **complete**; next 90 days below

**Done (original plan):** entitlements + quotas, crypto billing + annual, trading-fee mechanism, Pro/Elite launch, AI metering, onboarding, automation suite (SL/TP/trailing/max-hold + auto-buy), custom price alerts + web push, copy-trading + referral program.

**Next 90 days (the remaining high-leverage work):**
1. **WalletConnect / external signing + security audit** — the #1 trust and liability item; keys are still custodial. Do this before scaling spend.
2. **Reliability**: RPC/endpoint redundancy + a public status/health page (paying users now expect uptime).
3. **CEX exit management — COMPLETE**: exit monitor, trailing-runner mode, and brackets on **all three futures venues (Binance/Bybit/MEXC)** are live. Remaining: validate live with small size on each venue (the whole bracket pipeline is untested against funded accounts).
4. **Growth**: exchange affiliate links, shareable trade/PnL cards, validate native APK push.
5. **Depth**: backtesting, cross-session Pointer memory, chart-image/voice input; activate Glassnode MCP (public toggle) and lead marketing with the AI × on-chain-analytics differentiator.
6. **Compliance**: Terms/disclaimers, geo-restriction review, and counsel on the now-live trading fee + auto-execution.

---

## Top 5 things to do next (PM recommendation, updated 2026-07)
1. **WalletConnect + security audit** — now the single biggest unlock; monetization is live but custody risk caps how far you can scale.
2. **Turn on Glassnode MCP + market the AI edge** — the public toggle needs zero credentials; "AI that reads on-chain analytics" is a category-defining wedge.
3. **Reliability + status page** — you're charging money; protect the perception and the churn.
4. **Growth loops** — exchange affiliate + shareable PnL cards on top of the live referral program.
5. **Watch the numbers** — the funnel counters, signal track record, and gem hindsight stats are now live; use them to price tiers and drive the paywall. Confirm the trading-fee wallets are set in admin so fee revenue actually accrues.

# FXcrypt — Product Strategy Document
*Prepared from a senior product management lens: current state, gaps, and a path to profitability.*

---

## 1. Executive Summary

**FXcrypt** is an all-in-one crypto trading and intelligence platform that combines on-chain DEX trading, centralized-exchange (CEX) signal trading, token research/analytics, portfolio management, and an AI agent ("Pointer") — accessible across **web, PWA, Android (APK), Telegram, and Discord**.

It sits at the intersection of three hot categories:
1. **DEX trading bots** (Trojan, BonkBot, Maestro, Banana Gun)
2. **Token analytics/scanners** (DEXScreener, DexTools, Bubblemaps)
3. **AI trading copilots** (an emerging category)

The product is feature-rich and technically mature, but it is currently **pre-monetization**. The single biggest opportunity is to convert its existing trading and AI infrastructure into recurring and volume-based revenue. This document inventories what exists, proposes high-impact additions, and lays out a phased monetization plan.

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
- **Switchable models**: DeepSeek (open-source) and ChatGPT (OpenAI), selectable in-prompt.
- **19 tools** spanning the whole app; gated trade proposals (Approve/Reject).
- Runs server-side (always-on Cloud Function); excludes Wallet & PnL by design.

### 4.2 DEX Bot
- **Manual Trade**: buy/sell tokens across **BSC, ETH, SOL, Base, Polygon** (PancakeSwap, Uniswap, Jupiter, etc.), slippage/gas controls, USD-equivalent sizing.
- **Gem Scanner**: narrative search (Dog/Cat/Frog/AI), market-cap/volume/age/score/liquidity filters, **Default mode**, trend & sort that drives discovery; sources stacked (DexScreener + GeckoTerminal + DexTools); auto-scan every 5 min -> Telegram alerts; honeypot/safety gating.
- **Bot Wallets**: encrypted key storage per chain (two-tier, PBKDF2 600k).
- **Telegram & Discord AI** integration tabs.

### 4.3 CEX Bot (formerly "AI Agent")
- **Signal engine**: technical analysis (EMA, RSI, MACD, Bollinger, ATR, volume), market-structure detection (swings, FVGs, order blocks), TradingView merge, fundamental scoring -> scored long/short setups with entry/SL/TP1-3/R:R.
- **Exchanges**: connect Binance, MEXC, Bybit, KuCoin (encrypted API keys); spot + futures balances.
- **Auto-execution** (optional) with risk-% sizing; signal history; Telegram delivery with approve buttons.
- Scheduled scans every 15 min.

### 4.4 Tracker
- **Token tab**: search by name/ticker/contract; full token card (price, MCap, volume, liquidity, 24h, **holder count**); personal **watchlist** with live auto-refresh.
- **Wallet tab**: inspect any wallet's holdings & value across chains; saved wallets.
- **Bubble Map**: holder distribution + connected-wallet clustering (whale/insider/bundling signal) via Moralis/Helius.

### 4.5 Wallet (unified portfolio)
- Multi-chain portfolio (6 chains), total USD, asset list with logos, **send/receive + QR**, tx history, single-password lock screen, idle auto-lock, CSP-hardened, address validation.

### 4.6 Prices / PnL Calculator / Token detail
- Live prices & watchlist; PnL calculator (entry/exit, fees, leverage); per-token detail pages.

### 4.7 Cross-surface & platform
- **Telegram bot**: prices, watchlist, wallet tracker, arbitrage, gem alerts, trade execution, CEX key mgmt, settings, profile.
- **Discord agent**: free-text conversational agent (same brain as Pointer) with gated trades.
- **Arbitrage scanner**: cross-DEX spread detection.
- **Light/Dark theming**, PWA install, signed Android APK.

### 4.8 The 19 AI tools (shared by Pointer + Discord)
Balances, bot settings, recent trades, gem alerts, live gem scan, cross-chain token search, prices, token safety, holder counts, bubble map, arbitrage scan, CEX/futures signals, recent signals, CEX balances, token info, watchlist read, track/untrack tokens, and gated trade proposals. (No Wallet/PnL access by design.)

---

## 5. Architecture (one-paragraph summary)

Next.js web app on Firebase Hosting -> authenticated **Cloud Functions** (europe-west1) -> Firestore + on-chain RPCs + data APIs (DexScreener, GeckoTerminal, Moralis, Helius, GoPlus, Honeypot.is, RugCheck, CoinGecko, TradingView) + CEX APIs. AI inference is **outsourced** to DeepSeek/OpenAI; the agent **orchestration** runs in Cloud Functions (Pointer) or a local gateway bot (Discord). Wallet keys are encrypted (PBKDF2 600k) and only decrypted server-side for execution.

---

## 6. Proposed Features & Enhancements

Prioritized by **Impact x Effort** (a lightweight RICE view). [STAR] = highest leverage.

### 6.1 Revenue-enabling (build these to monetize)
| Feature | Why | Effort |
|---|---|---|
| [STAR] **Subscription/entitlement system** (tiers, feature gating, usage quotas) | Prerequisite for all SaaS revenue | M |
| [STAR] **Platform trading fee** on DEX swaps (auto fee-transfer per trade) | The dominant revenue model for trading bots | M |
| **AI usage metering / credits** (Pointer & Discord) | Recovers DeepSeek/OpenAI cost; upsell | S |
| **Exchange referral links** (Binance/Bybit/KuCoin/MEXC) | Passive commission on signups | S |
| **Billing** (Stripe for fiat + crypto/USDT pay) | Collect money | M |

### 6.2 Productivity / "make it stickier"
| Feature | Why |
|---|---|
| [STAR] **Auto-trade automation**: limit orders, DCA, stop-loss/take-profit, trailing stop, anti-rug auto-sell | Turns a tool into a 24/7 product; premium tier driver |
| [STAR] **Copy-trading / wallet mirroring** (watch a wallet -> auto-copy) | High-demand, viral, monetizable |
| **Real PnL** auto-computed from on-chain holdings (link Wallet to PnL) | Closes the loop; removes manual entry |
| **Custom alert builder** (price, %move, liquidity, whale buys, new pairs) + native push | Retention engine |
| **Backtesting** for signals/strategies | Trust + power users |
| **Pre-trade simulation** (honeypot/tax/slippage preview before buy) | Safety = trust |
| **Tax / CSV export & reporting** | Recurring seasonal value |

### 6.3 UX & trust
| Feature | Why |
|---|---|
| **Onboarding wizard** + guided first trade + empty-state coaching | Activation/conversion |
| [STAR] **WalletConnect / hardware-wallet / external-wallet signing** | Removes the biggest trust blocker (custody of keys) |
| **2FA, session management, withdrawal allowlists** | Security posture for paid users |
| **Native mobile push** (currently web only) | Engagement |
| **Multi-language**, accessibility pass | Reach |
| **Shareable trade/PnL cards + referral program** | Viral growth loop |
| **Status/health page & better error states** | Reliability perception |

### 6.4 AI depth (your differentiator)
- **Pointer memory** across sessions (persistent context, saved research).
- **Chart/image upload analysis**, voice input, scheduled "daily brief" digests.
- **Strategy agent**: "watch this token and alert/act when X" (autonomous monitors).
- **Per-message model routing** (cheap model for chat, strong model for analysis) to cut cost.

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

### 7.4 Phased rollout
- **Phase 1 (4-6 wks):** Entitlements + Stripe/crypto billing -> launch Pro/Elite subscriptions + trading fee + exchange referrals. (Fastest cash, uses existing features.)
- **Phase 2 (6-10 wks):** AI credits/metering; automation suite (SL/TP/DCA) as the Elite hook; referral program.
- **Phase 3 (Q2+):** Copy-trading (flagship paid feature), API/white-label, mobile push, performance fees.

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

## 10. Suggested 90-Day Roadmap
1. **Weeks 1-3:** Entitlement/quota system + billing (Stripe + USDT) + trading-fee mechanism + exchange referral links.
2. **Weeks 4-6:** Launch Pro/Elite; AI metering; onboarding wizard; security/status page.
3. **Weeks 7-10:** Automation suite (SL/TP/DCA/trailing, anti-rug auto-sell) as Elite driver; custom alerts + native push.
4. **Weeks 11-13:** Copy-trading MVP + referral program; WalletConnect integration kickoff.

---

## Top 5 things to do first (PM recommendation)
1. **Ship trading fees + subscription tiers** - you already have the features; you are leaving money on the table.
2. **Add automation (SL/TP/DCA + copy-trade)** - the single biggest retention/upsell lever.
3. **Meter AI usage** - protect margins on Pointer/Discord.
4. **WalletConnect + security audit** - unlock trust and reduce liability before scaling.
5. **Referral + shareable cards** - cheapest growth loop for this audience.

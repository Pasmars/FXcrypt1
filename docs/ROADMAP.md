# FXcrypt 10x Roadmap

*Drafted 2026-07-02 from a full codebase review of `mobile/`, `webapp/`, `shared/`, and `functions/`. Legacy root app excluded.*

## Where the product stands

Shipped and working: Pointer AI (tool-calling agent, gated trade proposals, deep research, metering + credits), multi-chain Gem Scanner with Telegram alerts and auto-buy, CEX signal generation, manual DEX trading (EVM + SOL), custodial bot wallets + non-custodial FXWallet, bubble-map holder analysis, arbitrage scan/execute, Stripe + crypto billing, and a capable admin panel with per-user usage controls.

## The 10x thesis

The app can *find* opportunities and *enter* trades, but it cannot **exit, prove, retain, or grow**:

1. **The bot buys and never sells.** There is no take-profit, stop-loss, or position monitor anywhere in `functions/`. Auto-buy without auto-exit is a liability, not a feature — users bag-hold every dip.
2. **No proof it works.** Signals carry SL/TP targets (`signal-generator.js`) but nothing resolves outcomes. No win rate, no track record → nothing to sell the paywall with.
3. **No retention loop.** Zero push notifications; the only outbound channel is Telegram. The Alerts screen renders mock data.
4. **No growth loop.** The signup form collects a referral code and the Referral screen exists, but there is no referral backend at all.

Closing these four loops turns "AI chat + scanner" into "an autonomous trading system with a public track record that recruits its own users." That's the 10x.

---

## Phase 0 — Loose ends (≈1 week)

### 0.1 Credit purchase return flow
The Stripe credit checkout redirects to `cfg.frontendUrl + '/?credits=success'` but neither app reads the param, and webapp buyers get bounced to the mobile PWA domain.

**Build:** pass the originating app's URL to `createCreditCheckout` (validated against an allowlist of the three hosting domains) and use it for `success_url`/`cancel_url`; on load, both apps read `?credits=success|cancel`, show a toast, refresh `getPointerUsage`, and strip the param.

**Acceptance criteria:**
- [ ] Buying credits from the webapp returns to the webapp; from the mobile PWA returns to the PWA.
- [ ] On `credits=success` the user sees a "Credits added" confirmation and the usage pill reflects the new balance without a manual reload.
- [ ] `success_url` host not on the allowlist → falls back to `cfg.frontendUrl` (no open redirect).

### 0.2 Webapp onboarding parity
Webapp users go login → straight into the app; mobile users get the feature intro + setup wizard.

**Acceptance criteria:**
- [ ] First-ever sign-in on the webapp shows the same onboarding slides + setup wizard as mobile (shared `onboarding.jsx`, already bundled).
- [ ] Returning users never see it again (persisted flag, per account not per device).

### 0.3 CI guard
**Acceptance criteria:**
- [ ] A push that breaks `mobile` vite build, `webapp` STATIC_EXPORT build, or `node --check` on functions fails CI before deploy.

---

## Phase 1 — Close the trading loop (≈3–4 weeks) · the single biggest value unlock

### 1.1 Position Manager + live PnL
Positions are currently implicit in `users/{uid}/trades`. Make them first-class.

**Build:** `users/{uid}/positions` derived from buys/sells (token, chain, size, avg entry, realized/unrealized PnL, source: manual|pointer|gem-auto). A Portfolio screen in both apps showing open positions with live prices (DexScreener, reuse `fx-live` patterns), total PnL, and per-position actions (sell 25/50/100%, set exits).

**Acceptance criteria:**
- [ ] Every executed buy (manual, Pointer-approved, gem auto-buy) creates/updates a position; sells reduce it and book realized PnL.
- [ ] Portfolio shows open positions with unrealized PnL updating at least every 30s while visible; closed positions move to history.
- [ ] PnL math verified against a scripted sequence of partial buys/sells (unit-tested; ±0.1% tolerance vs hand-computed).
- [ ] Works identically in mobile and webapp (shared screen module).

### 1.2 Exit automation (TP / SL / trailing stop)
**Build:** per-position exit rules `{ tp: %, sl: %, trailing: %, maxHoldHours }` stored on the position. New scheduled function `processExitMonitor` (every minute, extended timeout like `processGemScanner`) prices open positions with rules in batch, and executes sells through the existing `trader.sellToken*` path from the bot wallet. Same guardrails as auto-buy: admin kill-switch, `autoExecute` flag, daily trade cap. Fills notify via Telegram (and push once 3.1 lands).

**Acceptance criteria:**
- [ ] A position with TP +50% sells automatically within 2 minutes of the price first printing ≥ +50% on the monitored pair; same for SL and max-hold expiry.
- [ ] Trailing stop: after price runs +80% with a 20% trail, a retrace to +44% triggers the sell (peak-tracking persisted between runs, not in-memory).
- [ ] Every automated exit writes a trade doc with `source: 'exit-tp'|'exit-sl'|'exit-trail'|'exit-time'` and sends a notification with entry, exit, and realized PnL.
- [ ] Failed sell (no gas, rug, honeypot) retries with backoff ≤3 times, then marks the rule `failed` and alerts the user — never silently drops the rule, never loops infinitely.
- [ ] Admin kill-switch stops all automated exits within one scheduler tick; `dailyTradeCap` counts exits.

### 1.3 Auto-buy exit defaults
**Build:** Gem scan settings sheet gains "Take profit %, Stop loss %, Trailing %, Max hold" fields; every auto-bought gem gets those rules attached at buy time.

**Acceptance criteria:**
- [ ] With defaults TP 100 / SL 30, an auto-bought gem appears in Portfolio already armed with both rules.
- [ ] Turning auto-execute on without exit rules set shows a blocking warning ("bot will buy but never sell") requiring explicit confirmation.

### 1.4 Trade journal + export
**Acceptance criteria:**
- [ ] Every entry/exit lists timestamp, token, chain, size, price, source/reason, tx link.
- [ ] One-tap CSV export of any date range; totals reconcile with Portfolio realized PnL.

---

## Phase 2 — Prove it works (≈2–3 weeks) · trust → conversion

### 2.1 Signal outcome tracking & public track record
**Build:** scheduler resolves every published CEX signal against its SL/TP1-3 using exchange price data; stores outcome + R-multiple. Aggregates roll up to a public Track Record screen (win rate, avg RR, equity curve, per-pair stats, 30/90d windows). Surfaced in the paywall ("Signals hit TP at X% over the last 90 days").

**Acceptance criteria:**
- [ ] Every signal ends in exactly one terminal state (tp1/tp2/tp3/sl/expired) within one scheduler tick of the triggering price; no signal stays unresolved past its validity window.
- [ ] Track record screen renders from aggregates (no client-side scan of all signals) and matches a manual audit of 20 random signals.
- [ ] Paywall shows the live 90-day win rate; the number updates without a client deploy.
- [ ] Gem scanner gets the same treatment: median/best 24h & 7d performance of surfaced gems, shown on the scanner screen ("hindsight stats").

### 2.2 Paper trading mode
**Build:** account-level toggle. All execution paths (manual trade, Pointer proposals, gem auto-buy, exits) support simulated fills at live prices with configurable slippage; paper positions/trades live in parallel collections and render with a persistent "PAPER" badge. Metering still applies (it's the same AI cost).

**Acceptance criteria:**
- [ ] In paper mode no function ever touches `encryption.decrypt` / on-chain execution (enforced server-side, verified by a test that runs the full flow against a wallet with zero funds and asserts no tx attempts).
- [ ] Paper fills use the live pair price ±configured slippage; paper PnL uses the same Position Manager code path as real trades.
- [ ] Free users get paper auto-execute even where real auto-execute is Elite-gated — with an upsell prompt after their paper portfolio is up ≥20% or 10 trades.
- [ ] Switching modes never mixes paper and real positions anywhere in the UI or exports.

---

## Phase 3 — Retention loops (≈2–3 weeks)

### 3.1 Push notifications (FCM web push, both apps)
**Build:** FCM tokens per device under `users/{uid}/devices`; notification service in functions used by exits (1.2), signals, gem alerts, price alerts (3.2), Pointer tasks (3.3). Preferences screen (per-category toggles). Deep links open the relevant screen.

**Acceptance criteria:**
- [ ] Fresh install → permission prompt only after an explicit "enable notifications" action (not on first load); token registered and visible in admin user view.
- [ ] TP fill generates a push within 30s on both the installed PWA (Android) and desktop webapp; tapping it opens the position.
- [ ] Every category can be muted independently; muted categories send nothing (verified server-side, not just UI).
- [ ] Stale/invalid tokens are pruned on send failure.

### 3.2 Real price alerts
The Alerts screen currently renders mock data.

**Acceptance criteria:**
- [ ] User can create above/below/±%-move alerts on any watchlist token or CoinGecko coin; alerts fire once (or on a re-arm schedule) within one monitor tick and deliver via push + Telegram.
- [ ] Alerts screen lists live alerts with edit/delete; mock data removed.
- [ ] Free plan capped (e.g. 5 active alerts), Pro/Elite higher — caps enforced server-side via the existing `userLimits` pattern.

### 3.3 Pointer proactive tasks ("watch this and tell me")
**Build:** a `create_watch_task` tool for the Pointer agent (natural-language condition → structured task stored in Firestore); a scheduler evaluates tasks and, on trigger, runs a metered Pointer turn whose result is pushed and appended to the originating chat session.

**Acceptance criteria:**
- [ ] "Ping me if BTC breaks $150k" in chat creates a visible task (listed in Automation screen) without further user setup; task fires within one tick of the condition and the push deep-links into the chat containing Pointer's analysis.
- [ ] Task runs consume Pointer quota/credits; exhausted quota pauses tasks with a notification, never silently.
- [ ] Tasks are capped per plan and manageable (pause/delete) from the Automation screen.
- [ ] Prompt-injection safety: task conditions are structured fields, never free-text re-fed as instructions.

### 3.4 Daily portfolio digest (opt-in)
**Acceptance criteria:**
- [ ] Opted-in users receive one digest per day at their chosen hour (push and/or Telegram): portfolio PnL, open-position highlights, top watchlist movers, any signals/gems of note.
- [ ] Digest generation is one metered deep=false Pointer run; failures skip the day silently rather than erroring to the user.

---

## Phase 4 — Growth & monetization (≈3–4 weeks)

### 4.1 Real referral program
The signup field and Referral screen exist; there is no backend.

**Build:** per-user referral codes, attribution at signup, reward on the referee's *first payment* (anti-abuse): referrer gets Pointer credits or a % revenue share; admin dashboard for totals/payouts.

**Acceptance criteria:**
- [ ] Signup with a code attributes the account permanently; self-referral and duplicate-device abuse are rejected.
- [ ] Reward is granted only on the referee's first successful Stripe/crypto payment (webhook-driven) and is visible in both users' Referral screens within a minute.
- [ ] Referral screen shows real link, code, click/signup/paid counts — mock data removed.
- [ ] Admin can view and adjust referral balances (reuse `adminAddPointerCredits` pattern).

### 4.2 Smart-money copy trading (flagship Elite feature)
**Build:** users follow named wallets (seeded from bubble-map cluster data + manual add). A listener (Helius/Moralis webhooks or polling) detects the wallet's DEX buys; followers get an instant push/Telegram alert with the safety check attached, and can enable auto-copy: buy X native (clamped by `maxBuyUsd`/`dailyTradeCap`, auto-armed with Phase 1 exit rules) through the existing auto-buy rails.

**Acceptance criteria:**
- [ ] Following a wallet surfaces its new token buys as alerts within 2 minutes, each with a GoPlus/safety verdict and bubble-map concentration read.
- [ ] Auto-copy executes only when: safety check passes, admin kill-switch on, `autoExecute` flag on, caps unspent, and exit rules attached — the same invariants as gem auto-buy, verified by shared test fixtures.
- [ ] A "wallet leaderboard" ranks followed wallets by tracked 30d PnL (from their on-chain history), and is gated to Elite.
- [ ] Copy trades are labeled `source: 'copy:<wallet>'` in the journal and Portfolio.

### 4.3 Plan repackaging around the new value
**Build:** move the levers now that they exist: deep research + proactive tasks + copy trading + auto-exits as the paid spine. Annual billing (Stripe price IDs config already supports it), larger credit packs, and paywall copy driven by the live track record (2.1).

**Acceptance criteria:**
- [ ] Free: paper trading everything, 10 Pointer reqs, 5 scans, 5 alerts, no real auto-execute. Pro: real trading + exits, deep research, more of everything. Elite: copy trading, proactive tasks at scale, priority quotas. All enforced by the existing `metering.js`/`featureFlags` machinery (config change, not new code).
- [ ] Annual plans purchasable; proration and expiry handled by the existing grant/revoke paths.
- [ ] Paywall conversion is measurable: `usageDaily` gains paywall-view/checkout-start/checkout-complete counters visible in admin stats.

---

## Sequencing & dependencies

| Order | Feature | Depends on | Effort |
|---|---|---|---|
| 0.1–0.3 | Loose ends | — | days |
| 1.1 | Position Manager | — | ~1 wk |
| 1.2–1.3 | Exit automation | 1.1 | ~1.5 wk |
| 1.4 | Journal/export | 1.1 | days |
| 2.1 | Track record | — (parallel to P1) | ~1 wk |
| 2.2 | Paper trading | 1.1–1.2 | ~1 wk |
| 3.1 | Push | — | ~1 wk |
| 3.2 | Price alerts | 3.1 | days |
| 3.3 | Pointer tasks | 3.1, metering (done) | ~1 wk |
| 3.4 | Digest | 3.1, 1.1 | days |
| 4.1 | Referrals | billing (done) | ~1 wk |
| 4.2 | Copy trading | 1.1–1.3, 3.1 | ~2 wk |
| 4.3 | Repackaging | 2.1 | days |

**North-star metric:** % of weekly-active users with ≥1 automated round-trip trade (entry *and* exit executed by the system). Everything above serves it: Phase 1 makes it possible, Phase 2 makes it trusted, Phase 3 brings users back to it, Phase 4 prices and spreads it.

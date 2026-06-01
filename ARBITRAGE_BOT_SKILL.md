# Arbitrage Bot — Skill Document

## What It Does

The arbitrage bot scans multiple DEXes on **BNB Chain** and **Solana** for price discrepancies on the same token. When a token is cheaper on one DEX than another, the bot shows the opportunity and can execute a two-leg trade to capture the spread as profit.

It operates in two modes:
- **Manual** — user clicks Scan Now, reviews opportunities, clicks Execute on a specific one
- **Auto** — a Firebase Cloud Function runs every 2 minutes and self-executes any spread above the user's threshold

---

## Files Changed

| File | Change |
|------|--------|
| `functions/lib/arbitrage.js` | **New.** Core scan and execution library |
| `functions/index.js` | Added `scanArbitrage`, `executeArbitrage`, `processArbitrageQueue` exports |
| `bot.html` | Added **Arbitrage** tab button + full panel HTML |
| `bot.js` | Added all arbitrage UI logic (scan, animate, render, execute, settings) |
| `style.css` | Added ~160 lines of arbitrage component CSS |

---

## Architecture

```
┌─────────────────── Frontend (bot.js / bot.html) ──────────────────────┐
│                                                                         │
│  Arbitrage Tab                                                          │
│  ├── Chain toggles (BNB / SOL)                                         │
│  ├── Min Profit % + Max Trade Amount fields                             │
│  ├── [Scan Now] → shows animated scanning overlay → renders results    │
│  ├── Opportunity cards  [Execute] button per card                       │
│  ├── Auto-Arbitrage toggle (persisted to Firestore)                     │
│  └── Stats row: Found / Executed / Best Spread                         │
│                                                                         │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ Firebase Callable (httpsCallable)
                           ▼
┌─────────────── Cloud Functions (functions/index.js) ───────────────────┐
│                                                                         │
│  scanArbitrage        ← called by Scan Now button                       │
│  executeArbitrage     ← called by Execute button                        │
│  processArbitrageQueue ← Pub/Sub scheduled every 2 minutes (auto mode) │
│                                                                         │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ require()
                           ▼
┌──────────────── functions/lib/arbitrage.js ────────────────────────────┐
│                                                                         │
│  scanArbitrageOpportunities()                                           │
│  └── scanTokenDexScreener()  → DexScreener API per token               │
│      └── Compares price across DEXes, returns best spread              │
│                                                                         │
│  executeArbitrageOpp()                                                  │
│  ├── executeArbitrageBSC()  → ethers.js (PancakeSwap / Biswap / Ape)  │
│  └── executeArbitrageSOL()  → Jupiter API v6                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## How Scanning Works

### Price Source
The scanner uses the **DexScreener API** (`/latest/dex/tokens/{address}`) — the same API already used in the app for the token tracker. It is free, requires no API key, and returns real-time prices across all DEXes for a given token.

### Algorithm (per token)
1. Fetch all DEX pairs for the token on the target chain
2. Filter out pairs with liquidity below `minLiqUsd` (default $20,000) to avoid thin books
3. For each DEX, keep only the highest-liquidity pair (some DEXes have multiple pools)
4. Sort DEXes by USD price: `low → high`
5. Spread = `(highPrice − lowPrice) / lowPrice × 100`
6. If spread ≥ `minSpread`, return an opportunity object with buy DEX, sell DEX, all prices, and liquidities
7. All tokens are scanned in parallel via `Promise.allSettled` — a single failing token never blocks the others
8. Results sorted by spread descending so highest opportunities appear first

### Tokens Scanned

**BNB Chain** (5 tokens)
| Symbol | Contract |
|--------|----------|
| CAKE | `0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82` |
| ETH (BSC) | `0x2170Ed0880ac9A755fd29B2688956BD959F933F8` |
| BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` |
| XRP | `0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE` |
| ADA | `0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47` |

**Solana** (5 tokens)
| Symbol | Mint |
|--------|------|
| RAY | `4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R` |
| JUP | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` |
| BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` |
| WIF | `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm` |
| mSOL | `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So` |

### DEXes Recognised
DexScreener returns a `dexId` string. The `dexLabel()` function maps these to human-readable names:

```
pancakeswap   → PancakeSwap V2      raydium      → Raydium
pancakeswap_v3→ PancakeSwap V3      raydium_clmm → Raydium CLMM
biswap        → Biswap              orca         → Orca
apeswap       → ApeSwap             meteora      → Meteora
babyswap      → BabySwap            lifinity     → Lifinity
uniswap_v2    → Uniswap V2          phoenix      → Phoenix
uniswap_v3    → Uniswap V3
```

---

## How Execution Works

### BNB Chain — Two-Transaction Arbitrage

Strategy: **BNB → TOKEN** on the cheap DEX, then **TOKEN → BNB** on the expensive DEX.

Requirements:
- A BSC wallet must be saved in Settings (AES-256-GCM encrypted key stored in Firestore)
- Both `buyDex` and `sellDex` must be in the supported router map: PancakeSwap V2, Biswap, or ApeSwap

Router addresses:
| DEX | Router |
|-----|--------|
| PancakeSwap V2 | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| Biswap | `0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8` |
| ApeSwap | `0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b` |

Execution steps (inside `executeArbitrageBSC`):
1. Call `getAmountsOut` on the buy router to preview the output
2. `swapExactETHForTokens` — spend BNB, receive TOKEN (5% slippage protection)
3. Check and set `approve(sellRouter, MaxUint256)` if needed
4. `swapExactTokensForETHSupportingFeeOnTransferTokens` — sell TOKEN, receive BNB
5. Returns both tx hashes and estimated profit in BNB

If a DEX ID coming back from DexScreener is not in the router map (e.g. a smaller DEX), the card shows **"View only"** instead of an Execute button — no trade is attempted.

### Solana — Jupiter Aggregated Swap

Strategy: route SOL → TOKEN using Jupiter API v6 (best path across Raydium, Orca, Meteora, etc.).

Execution steps (inside `executeArbitrageSOL`):
1. POST to `quote-api.jup.ag/v6/quote` with `inputMint=SOL, outputMint=token, slippageBps=200`
2. POST to `quote-api.jup.ag/v6/swap` to get the serialised versioned transaction
3. Sign with the Solana keypair decoded from stored Base58 private key
4. `sendRawTransaction` + `confirmTransaction`

Note: the Solana leg is a one-way swap (SOL → TOKEN). Profit calculation is not returned for SOL because reading the post-trade SOL balance requires an additional RPC call; this is left as a future enhancement.

---

## Scanning UI — Loading Indicator

The scan button and opportunity list both animate during the network call:

**Button** — icon swaps to an inline CSS spinner (border-radius circle rotating via `arb-spin` keyframe), label changes to "Scanning…", disabled to block double-taps.

**Opportunity list area** — replaced by `showArbScanning()` which injects:
- A double-ring spinner: outer ring green, inner ring yellow, counter-rotating at different speeds
- Label: "Scanning DEXes for price gaps…"
- A staggered list of every DEX being queried — each row slides in from the left with an 0.18s offset between rows, with a pulsing green dot per row

When results arrive (or on error) the overlay is replaced by the opportunity cards or an error message, and the button resets.

---

## Opportunity Cards

Each card shows:
- **Chain badge** (BNB / SOL) + **pair name** (e.g. CAKE/USDT) + **profit badge**
- **DEX route**: `Buy: Biswap → Sell: PancakeSwap V2` (green/red coloured)
- **Price table**: price on every qualifying DEX for that token
- **Liquidity**: buy-side and sell-side USD liquidity
- **Execute button** (or "View only" if the DEX router isn't mapped)

Profit badge colour thresholds:
| Spread | Badge colour |
|--------|-------------|
| < 1% | Green (low) |
| 1–2% | Yellow (mid) |
| ≥ 2% | Red/coral (high) |

---

## Firestore Data

### User document fields added (`users/{uid}/botSettings`)
| Field | Type | Purpose |
|-------|------|---------|
| `arbEnabled` | boolean | Drives auto-arbitrage scheduler |
| `arbMinProfit` | number | Min spread % before auto-execute |
| `arbMaxAmount` | number | Max native coin per auto-arb trade |

### Trade history document (added to `users/{uid}/trades`)
| Field | Value |
|-------|-------|
| `type` | `"arbitrage"` |
| `pair` | e.g. `"CAKE/USDT"` |
| `buyDex` / `sellDex` | DEX display names |
| `spreadPercent` | e.g. `"1.452"` |
| `amountIn` | BNB or SOL spent |
| `txHashBuy` | buy-leg tx hash |
| `txHashSell` | sell-leg tx hash (BSC only) |
| `profit` | estimated profit in native coin (BSC only) |
| `source` | `"manual-arbitrage"` or `"auto-arbitrage"` |

---

## Cloud Functions

### `scanArbitrage` (httpsCallable)
- **Auth**: required
- **Input**: `{ chains: string[], minSpread: number, minLiqUsd: number }`
- **Output**: `{ opportunities: Opportunity[], scannedAt: number }`
- **Timeout**: 60 seconds (set on client side)
- **Validation**: chains filtered to `VALID_CHAINS`, spread clamped to `[0.1, 20]`, liq floor at `$1,000`

### `executeArbitrage` (httpsCallable)
- **Auth**: required
- **Input**: `{ chain, opportunity, tradeAmount }`
- **Output**: `{ txHashBuy, txHashSell, status, profit, chain }`
- **Timeout**: 120 seconds (blockchain confirmations can be slow)
- **Guards**: validates chain, checks wallet exists, decrypts key server-side

### `processArbitrageQueue` (Pub/Sub scheduled)
- **Schedule**: every 2 minutes
- **Logic**: queries all users where `botSettings.arbEnabled == true` (up to 10), scans their active chains, executes up to 3 opportunities per user per cycle that exceed `arbMinProfit`
- **Notification**: sends Telegram message if the user has a linked Telegram bot

---

## Configuration

All settings are saved to Firestore and restored on page load:

| UI Field | Firestore key | Default |
|----------|---------------|---------|
| Min Profit % | `botSettings.arbMinProfit` | 0.5 |
| Max Trade (native) | `botSettings.arbMaxAmount` | 0.01 |
| Auto-Arbitrage toggle | `botSettings.arbEnabled` | false |

The **Min Profit %** doubles as the `minSpread` for the scan — so raising it both filters the display and raises the auto-execute threshold.

---

## How to Extend

### Add more tokens to scan
Edit `SCAN_TOKENS_BSC` or `SCAN_TOKENS_SOL` arrays in `functions/lib/arbitrage.js`:
```js
{ address: '0xYourTokenAddress', symbol: 'SYMBOL' }
```
No other changes needed — the scanner picks them up automatically.

### Add more BSC DEX routers (for execution)
Add an entry to `BSC_DEX_ROUTERS` in `functions/lib/arbitrage.js`:
```js
yourDex: { name: 'Your DEX', router: '0xRouterAddress' }
```
Then add `'yourDex'` to the `canExecute` check in the `renderOpportunities` function in `bot.js`.

### Adjust the scanning overlay DEX list
Edit `ARB_SCAN_DEXES` in `bot.js` — this only controls the animated names shown during scanning and does not affect which DEXes are actually queried (that is driven by DexScreener).

### Add custom token pairs
Currently the scan covers fixed popular tokens. To let users scan arbitrary token addresses, add an input field that calls `scanArbitrage` with a custom `tokenAddresses` array parameter — the Cloud Function would need a matching code path in `scanArbitrageOpportunities`.

---

## Known Limitations

1. **BSC execution only for mapped DEXes** — if DexScreener returns an opportunity on an unmapped DEX (e.g. BabySwap), it shows as "View only". Adding that DEX's router address to `BSC_DEX_ROUTERS` fixes it.

2. **Two separate transactions on BSC** — not a flash loan. There is a window between the buy and sell legs where price can move. The 5% slippage guard limits downside but does not eliminate it.

3. **Solana profit not tracked** — `executeArbitrageSOL` returns `profit: null` because calculating the realised profit requires reading the SOL balance before and after, which needs an extra RPC call. The trade is logged but profit shows blank in history.

4. **DexScreener rate limits** — the free tier allows roughly 300 requests per minute. Scanning 10 tokens concurrently is well within limits, but very high auto-arb user counts could approach them.

5. **Auto-arb cap** — the scheduler processes a maximum of 10 users and 3 opportunities per user per 2-minute cycle to stay within Cloud Function memory and timeout limits.

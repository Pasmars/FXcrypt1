---
name: dex-gem-trading-bot
description: >
  Full blueprint for building an automated DEX trading bot that hunts profitable
  token gems on Solana and BSC chains. Use this skill whenever the user wants to
  build, extend, or debug any part of a crypto trading bot — including gem
  screening logic, on-chain data ingestion, contract safety analysis, tokenomics
  scoring, risk management, DEX execution, or monitoring. Trigger this skill for
  any request involving: trading bot architecture, token safety scanning, DEX
  automation, on-chain signal detection, BullMQ job queues for crypto, Jupiter or
  PancakeSwap integration, Jito bundles, Helius WebSocket listeners, GoPlus API
  integration, Bubblemaps wallet clustering, or automated position sizing. Also
  trigger for vibe-coding prompts that involve Web3 trading automation on SOL or
  BSC, even if the user only mentions one component of the system.
---

# DEX Gem Trading Bot — Full Build Skill

## What This Skill Covers

A production-grade automated trading bot for finding and trading token gems on
Solana and BSC DEXes. The bot screens every new token against the same criteria
a professional trader would apply manually, then executes trades with MEV
protection and disciplined risk management.

**Two runtimes**: Node.js (ingestion + execution — WebSocket-heavy) and Python
(analysis + scoring — pandas/web3.py). BullMQ bridges them over Redis.

---

## System Architecture (8 Layers)

```
[ Data Sources ]          ← push streams + REST polling APIs
      ↓
[ Ingestion & Queue ]     ← normalize, deduplicate, enqueue (BullMQ)
      ↓
[ Contract Analyzer ]     ← safety scan, 0–35 pts
      ↓
[ Market & Tokenomics ]   ← holder analysis, vol/mcap, 0–30 pts
      ↓
[ Signal & Scoring ]      ← composite 0–100 score, threshold alerts
      ↓
[ Risk Manager ]          ← position sizing, stop-loss, take-profit
      ↓
[ Execution Engine ]      ← Jupiter (SOL) / PancakeSwap (BSC) + MEV protection
      ↓
[ Monitoring & Alerts ]   ← Telegram bot, React dashboard, Grafana
        ↕
   [ Storage ]            ← PostgreSQL + TimescaleDB + Redis (all layers read/write)
```

---

## Layer 1 — Data Sources

### Access pattern split (critical design decision)

| Type | Sources | Latency | Use |
|------|---------|---------|-----|
| Push / WebSocket | Solana RPC, BSC RPC, Telegram MTProto | ~400ms | Primary new-token detection |
| Pull / REST poll | DexScreener, GoPlus, Bubblemaps | 30s–10s | Enrichment + safety analysis |

### Source 1 — Solana RPC (Helius WebSocket)

- **Why Helius over public RPC**: Public Solana RPCs throttle WebSocket
  subscriptions, drop connections, and don't pre-parse Raydium events.
- **What to subscribe to**: Raydium AMM program (`675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`)
  and Orca Whirlpool. Listen for `initialize` / `initialize2` log strings — that
  is the new liquidity pool creation event.
- **Cost**: ~$50–200/mo. QuickNode is a drop-in alternative.

```typescript
// Node.js — Solana new pool listener
import { Connection, PublicKey } from '@solana/web3.js';
const conn = new Connection('wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY');
const RAYDIUM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

conn.onLogs(RAYDIUM, async (logs) => {
  if (logs.err) return;
  if (logs.logs.some(l => l.includes('initialize2'))) {
    const tx = await conn.getParsedTransaction(logs.signature, { maxSupportedTransactionVersion: 0 });
    const pool = parseRaydiumInit(tx);
    await queue.add('analyze', { chain: 'sol', pool, ts: Date.now() }, { priority: 1 });
  }
}, 'confirmed');
```

### Source 2 — BSC RPC (Ankr WebSocket)

- Subscribe to PancakeSwap V2 factory `PairCreated` and V3 `PoolCreated` events.
- Use `ethers.WebSocketProvider` — handles reconnection automatically.
- BSC blocks every ~3s (slower than SOL but wider rug-pull analysis window).

```typescript
// Node.js — BSC new pair listener
import { ethers } from 'ethers';
const provider = new ethers.WebSocketProvider('wss://rpc.ankr.com/bsc/ws/YOUR_KEY');
const FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const abi = ['event PairCreated(address indexed t0, address indexed t1, address pair, uint)'];
const factory = new ethers.Contract(FACTORY, abi, provider);

factory.on('PairCreated', async (t0, t1, pair) => {
  const token = await resolveNonWBNB(t0, t1); // get the non-stablecoin token
  await queue.add('analyze', { chain: 'bsc', token, pair }, { priority: 1, attempts: 3 });
});
```

### Source 3 — Telegram MTProto (alpha groups)

- Use **MTProto** (not the Bot API) — the Bot API cannot read groups you haven't
  been added to as admin. Use `telethon` (Python) or `gramjs` (Node).
- Extract contract addresses from messages with regex:
  `/(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})/`
- **Burner accounts + rotating proxies** required — Telegram bans bot-like
  accounts aggressively (rapid joins, no profile photo, no message history).

```python
# Python — Telegram MTProto scraper
from telethon import TelegramClient, events
import re

ALPHA_GROUPS = ['group1', 'group2']   # usernames or IDs
ADDR_RE = re.compile(r'(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})')

client = TelegramClient('session', API_ID, API_HASH)

@client.on(events.NewMessage(chats=ALPHA_GROUPS))
async def handler(event):
    for addr in ADDR_RE.findall(event.raw_text):
        chain = 'bsc' if addr.startswith('0x') else 'sol'
        await redis.publish('social_signal', json.dumps({
            'address': addr, 'chain': chain,
            'group': event.chat.title, 'ts': event.date.timestamp()
        }))
client.start()
client.run_until_disconnected()
```

### Source 4 — DexScreener API (redundancy + enrichment)

- Poll `/latest/dex/search?q={chain}` every **30 seconds** as a redundancy net —
  catches anything missed by the WebSocket on reconnection gaps.
- Provides enrichment data you'd otherwise compute: `liquidity.usd`, `volume.h24`,
  `txns.h24.buys`, `txns.h24.sells`, `fdv`.
- Free tier: 300 req/min. No API key needed.
- **Cost optimization**: do NOT poll DexScreener for every token you've ever seen.
  Tier it — score ≥70: poll every 30s; score 50–69: every 2min; score 30–49:
  every 10min; below 30: drop from watchlist after 1h.

### Source 5 — GoPlus Safety API (contract flags)

- Most critical pull source. Single call returns ~30 boolean safety flags.
- Endpoint: `GET /api/v1/token_security/{chain_id}?contract_addresses={addr}`
- Chain IDs: BSC = `56`, Solana = `solana`.
- Free: 30 req/min. Paid (~$200/mo): 600 req/min + webhook on flag changes.

```python
async def goplus_check(address: str, chain_id: str) -> dict:
    url = f'https://api.gopluslabs.io/api/v1/token_security/{chain_id}'
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(url,
            params={'contract_addresses': address},
            headers={'Authorization': f'Bearer {GP_TOKEN}'}
        )
        data = r.json()['result'][address.lower()]
        return {
            'is_honeypot':            data.get('is_honeypot') == '1',
            'is_mintable':            data.get('is_mintable') == '1',
            'is_blacklisted':         data.get('is_blacklisted') == '1',
            'can_take_back_ownership':data.get('can_take_back_ownership') == '1',
            'owner_address':          data.get('owner_address', '').lower(),
            'buy_tax':                float(data.get('buy_tax') or 0),
            'sell_tax':               float(data.get('sell_tax') or 0),
            'lp_locked_pct':          float(data.get('lp_locked_pct') or 0),
        }
```

### Source 6 — Bubblemaps API (wallet clustering)

- Detects coordinated sniper bundles: multiple wallets funded from same source,
  holding large concentrated positions — the hallmark of a coordinated dump.
- Requires a private API key (contact bubblemaps.io sales).
- Key fields: `cluster_size`, `supply_pct` of largest cluster.
- **Rule**: `cluster_supply_pct > 0.30` = hard fail (coordinated exit risk).

### Ingestion Layer — critical engineering patterns

**Deduplication** (Redis SET NX, race-free):
```typescript
const key = `seen:${chain}:${tokenAddress}`;
const isNew = await redis.set(key, '1', 'EX', 3600, 'NX'); // 1-hour TTL
if (!isNew) return; // already processing, skip
await queue.add('analyze', payload);
```

**Heartbeat reconnection** (WebSocket connections die silently):
```typescript
let lastMessage = Date.now();
setInterval(() => {
  if (Date.now() - lastMessage > 60_000) {
    console.warn('No message in 60s — reconnecting');
    reconnect();
  }
}, 30_000);
```

---

## Layer 2 — Contract Analyzer (0–35 pts)

### Hard-fail conditions (never trade these — zero score, log and discard)

| Flag | Why |
|------|-----|
| `is_honeypot: true` | Tokens go in, BNB/SOL never comes out |
| `can_take_back_ownership: true` | Dev can reclaim control and drain LP |
| Mint function active | Dev can print unlimited supply |
| Blacklist function + dev holding >5% | Can freeze your wallet post-buy |
| Contract unverified on block explorer | Cannot audit for hidden functions |

### Scoring rubric (sum to max 35 pts)

| Check | Points | Logic |
|-------|--------|-------|
| Ownership renounced (zero address) | +10 | `owner_address == ZERO_ADDR` |
| No mint function | +8 | `is_mintable == false` |
| No blacklist function | +7 | `is_blacklisted == false` |
| LP locked ≥80% for ≥6 months | +10 | Unicrypt / Team.Finance API |
| Tax ≤5% total (buy+sell) | scoring bonus | Auto-deduct if tax >10% |

```python
async def score_contract(address: str, chain: str) -> int:
    gp   = await goplus_check(address, chain)
    lock = await lp_lock_status(address, chain)  # Unicrypt / Team.Finance

    # Hard fails — never trade
    if gp['is_honeypot'] or gp['can_take_back_ownership'] or gp['is_mintable']:
        raise HardFail(f'contract unsafe: {address}')

    score = 0
    ZERO = '0x0000000000000000000000000000000000000000'
    if gp['owner_address'] == ZERO:         score += 10
    if not gp['is_mintable']:               score += 8
    if not gp['is_blacklisted']:            score += 7
    if lock.get('ratio', 0) >= 0.80:        score += 10

    # Tax penalty
    total_tax = gp['buy_tax'] + gp['sell_tax']
    if total_tax > 0.10:                    score -= 10
    elif total_tax > 0.05:                  score -= 5

    return max(0, min(score, 35))
```

### LP lock verification (Unicrypt + Team.Finance)

```python
async def lp_lock_status(token_address: str, chain: str) -> dict:
    # Try Unicrypt first
    r = await httpx.get(f'https://api.unicrypt.network/api/v2/tokens/{token_address}')
    if r.status_code == 200:
        data = r.json()
        locked = sum(l['amount'] for l in data['locks'] if l['unlock_date'] > time.time() + 15_778_800)  # 6mo
        total  = data['total_supply_locked']
        return {'ratio': locked / total if total else 0, 'provider': 'unicrypt'}
    # Fallback: Team.Finance
    r2 = await httpx.get(f'https://api.team.finance/v1/locks?token={token_address}')
    ...
```

### ABI dangerous function scanner

Always check for these function signatures in the contract ABI:

```python
DANGEROUS_SIGS = {
    'setFee', 'updateFee', 'setTax', 'setBuyFee', 'setSellFee',   # hidden tax changes
    'blacklist', 'addBlacklist', 'setBlacklist', 'blockAddress',   # wallet blocking
    'pause', 'unpause',                                             # trading halt
    'mint', 'mintTo', 'safeMint',                                   # supply inflation
    'setMaxWallet', 'setMaxTx',                                     # limit manipulation
    'excludeFromFee', 'includeInFee',                               # fee bypass
}

def scan_abi(abi: list) -> list[str]:
    return [fn['name'] for fn in abi
            if fn.get('type') == 'function' and fn['name'] in DANGEROUS_SIGS]
```

---

## Layer 3 — Market Intelligence & Tokenomics (0–30 pts)

### Scoring rubric

| Check | Points | Logic |
|-------|--------|-------|
| Top 10 wallets hold <35% supply | +12 | Wide distribution |
| Top 10 wallets hold 35–50% | +6 | Moderate concentration |
| No Bubblemaps sniper bundle | +10 | `cluster_supply_pct < 0.20` |
| Vol/MCap ratio >15% | +5 | Healthy organic trading |
| Unique buyers 24h >200 | +3 | Real interest |
| Smart money wallet in holders | +5 (bonus) | Nansen/Cielo tags |

```python
def score_tokenomics(holders: list, bubblemaps: dict, market: dict) -> int:
    top10_pct = sum(h['pct'] for h in holders[:10])
    score = 0
    if top10_pct < 0.35:                              score += 12
    elif top10_pct < 0.50:                            score += 6
    if bubblemaps['cluster_supply_pct'] < 0.20:       score += 10
    if market['vol_mcap_ratio'] > 0.15:               score += 5
    if market['unique_buyers_24h'] > 200:             score += 3
    if any(w in SMART_MONEY_LIST for w in holders):   score += 5
    return min(score, 30)
```

**Dev wallet monitor**: poll dev wallet address every 5 minutes. If any token
moves to a known CEX hot wallet (Binance, OKX, Bybit deposit addresses), immediately
emit a `SELL_ALERT` for any open position in that token.

**Wash trading detection**: flag if `txn_count_24h` is rising but
`unique_buyer_count` is flat — bot-driven wash volume pattern.

---

## Layer 4 — Signal & Scoring Engine

### Composite scoring (0–100)

| Sub-score | Max pts | Weight |
|-----------|---------|--------|
| Contract safety | 35 | from Layer 2 |
| Liquidity health | 25 | LP size, lock ratio, LP distribution |
| Tokenomics | 20 | from Layer 3 |
| Market momentum | 10 | vol trend, buy/sell pressure |
| Social signals | 10 | Telegram mentions, smart money |

```python
def compute_signal(scores: dict) -> SignalEvent:
    total = sum(scores.values())   # all sub-scores already bounded
    if total >= 70:
        return SignalEvent(type='BUY_SIGNAL', score=total)
    elif total >= 50:
        return SignalEvent(type='WATCHLIST', score=total)
    return SignalEvent(type='DISCARD', score=total)
```

### Watchlist re-scoring

Tokens scoring 50–69 enter a watchlist. Re-score every 10 minutes. A token that
rises from 62→72 within 30 minutes (score velocity) often indicates smart money
accumulation — weight this positively when deciding position size.

---

## Layer 5 — Risk Manager

### Position sizing (fixed fractional)

| Score range | Portfolio allocation |
|-------------|---------------------|
| 90–100 | 3% |
| 80–89 | 2% |
| 70–79 | 1% |
| <70 | No trade |

**Maximum chain exposure**: 20% of total portfolio in any single chain (SOL or BSC).
Reject any trade that would breach this, even if score is high.

**Slippage pre-check**: simulate the swap via Jupiter/PCS quote API before
submitting. If `priceImpactPct > 2%`, reject the trade — thin pool, easy
manipulation.

### Stop-loss and take-profit ladder

```python
def configure_exits(entry_price: float, position_size: float):
    return {
        'stop_loss':    entry_price * 0.70,        # hard stop at -30%
        'take_profit_1': {
            'price': entry_price * 3.0,            # 3x
            'sell_pct': 0.30                       # sell 30% of position
        },
        'take_profit_2': {
            'price': entry_price * 5.0,            # 5x
            'sell_pct': 0.50                       # sell 50% of remaining
        },
        'trailing_stop': {                         # trail 20% remainder after 5x
            'activation': entry_price * 5.0,
            'trail_pct': 0.25                      # 25% trailing stop
        }
    }
```

**ATH adjustment**: once a position is 2x, move stop-loss to entry price (breakeven).
Once 3x, move stop to ATH × 0.60 (never give back more than 40% of gains from peak).

---

## Layer 6 — Execution Engine

### Solana: Jupiter + Jito

```typescript
// Always use Jupiter V6 aggregator — finds best route across all Solana DEXes
async function buyOnSolana(token: string, lamports: number): Promise<string> {
    const quote = await jup.quoteGet({
        inputMint: SOL_MINT,
        outputMint: token,
        amount: lamports,
        slippageBps: 150    // 1.5% max slippage
    });
    if (parseFloat(quote.priceImpactPct) > 2) {
        throw new Error(`Price impact ${quote.priceImpactPct}% — aborting`);
    }
    const { swapTransaction } = await jup.swapPost({ quoteResponse: quote });

    // Submit via Jito bundle — bypasses public mempool, prevents sandwich attacks
    return await jitoClient.sendBundle([swapTransaction], TIP_LAMPORTS);
    // TIP_LAMPORTS: 100_000–500_000 (0.0001–0.0005 SOL), higher = faster inclusion
}
```

### BSC: PancakeSwap V3 + Bloxroute

```typescript
async function buyOnBSC(token: string, bnbAmount: BigInt): Promise<string> {
    const router = new ethers.Contract(PANCAKE_ROUTER_V3, ROUTER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + 60;   // 60s deadline

    // Use Bloxroute private mempool to avoid sandwich bots
    const tx = await router.exactInputSingle({
        tokenIn: WBNB, tokenOut: token,
        fee: 2500,   // 0.25% pool
        recipient: wallet.address,
        deadline,
        amountIn: bnbAmount,
        amountOutMinimum: 0n,    // let slippage guard handle this
        sqrtPriceLimitX96: 0n
    });

    // Submit via Bloxroute relay — not broadcast to public mempool
    return await bloxroute.sendPrivateTransaction(tx.raw);
}
```

### Retry logic

```typescript
async function confirmWithRetry(sig: string, maxAttempts = 3): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const result = await conn.confirmTransaction(sig, 'confirmed');
            if (!result.value.err) return true;
        } catch {
            await sleep(1000 * (i + 1));   // exponential backoff
        }
    }
    throw new Error(`Failed to confirm after ${maxAttempts} attempts`);
}
```

---

## Layer 7 — Storage

### Schema

```sql
-- Core trade and signal tables
CREATE TABLE signals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_addr  TEXT NOT NULL,
    chain       TEXT NOT NULL,       -- 'sol' | 'bsc'
    score       NUMERIC(5,2),
    action      TEXT,                -- 'BUY_SIGNAL' | 'WATCHLIST' | 'DISCARD'
    sub_scores  JSONB,               -- {contract, liquidity, tokenomics, market, social}
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE trades (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id   UUID REFERENCES signals(id),
    token_addr  TEXT NOT NULL,
    chain       TEXT NOT NULL,
    side        TEXT NOT NULL,       -- 'buy' | 'sell'
    amount_usd  NUMERIC(18,6),
    price_usd   NUMERIC(18,10),
    tx_hash     TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- TimescaleDB hypertable for OHLCV (enables fast backtesting)
CREATE TABLE ohlcv (
    time        TIMESTAMPTZ NOT NULL,
    token       TEXT NOT NULL,
    chain       TEXT NOT NULL,
    open        NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC,
    volume      NUMERIC
);
SELECT create_hypertable('ohlcv', 'time');
```

### Redis key patterns

```
seen:{chain}:{address}         TTL 3600s — deduplication
score:{chain}:{address}        TTL 300s  — latest composite score (cache)
state:{chain}:{address}        TTL 600s  — analysis pipeline state
portfolio:open_positions        persistent — current holdings
portfolio:chain_exposure:{chain} persistent — per-chain allocation %
```

---

## Layer 8 — Monitoring & Alerts

### Telegram signal card format

```typescript
function formatSignalCard(signal: Signal): string {
    return [
        `*New signal — ${signal.chain.toUpperCase()}*`,
        `Token: \`${signal.symbol}\` (${signal.address.slice(0,8)}...)`,
        `Score: *${signal.score}/100*`,
        `Contract: ${signal.scores.contract}/35 | Liq: ${signal.scores.liquidity}/25`,
        `Tokenomics: ${signal.scores.tokenomics}/20 | Market: ${signal.scores.market}/10`,
        `MCap: $${fmt(signal.mcap)} | Liq: $${fmt(signal.liquidity)}`,
        `[DexScreener](https://dexscreener.com/${signal.chain}/${signal.address}) | [GoPlus](https://gopluslabs.io/token-security/${signal.chainId}/${signal.address})`
    ].join('\n');
}
```

---

## Tech Stack Reference

| Layer | Language | Key Libraries |
|-------|----------|---------------|
| Ingestion | Node.js 20 | `@solana/web3.js`, `ethers v6`, `BullMQ`, `ioredis`, `axios` |
| Contract analyzer | Python 3.11 | `web3.py`, `httpx`, `asyncio`, `pydantic` |
| Market analysis | Python 3.11 | `pandas`, `networkx`, `httpx`, `asyncio` |
| Scoring engine | Python 3.11 | `asyncio`, `redis`, `sqlalchemy` |
| Risk manager | Python 3.11 | `asyncio`, `psycopg2`, `redis` |
| Execution | Node.js 20 | `@jup-ag/core`, `ethers v6`, `jito-ts`, `@bloxroute/sdk` |
| Storage | — | PostgreSQL 16, TimescaleDB, Redis 7, Prisma ORM |
| Monitoring | Node.js + Python | `telegraf.js`, FastAPI, Grafana, Prometheus |
| Dashboard | React 18 | `react`, `recharts`, `@tanstack/react-query` |

---

## Gem Hunting Criteria (Manual Screening Rules Encoded in the Bot)

These are the trader heuristics the automated system replicates:

### Hard rules (auto-reject on any single fail)

- Honeypot detected by GoPlus or manual swap simulation
- Contract not verified on BSCScan / Solscan
- Owner can reclaim ownership (`can_take_back_ownership`)
- Active mint function
- Blacklist function + dev wallet holds >5% of supply
- LP not locked (any unlocked LP = instant rug risk)
- Top wallet holds >20% of supply (single point of control)
- Dev wallet moved tokens to CEX deposit address

### Soft scoring rules (scored, not binary)

- LP locked ratio and duration
- Token tax percentage (buy + sell combined)
- Top 10 wallets concentration
- Bubblemaps cluster size and supply percentage
- Volume/MCap ratio (organic trading health)
- Buy/sell pressure ratio (unique buyers vs sellers, 24h)
- Unique buyer count growth trend
- Smart money wallet presence

### Execution timing rules

- Never ape the initial launch spike — wait for first pullback and reaccumulation base
- Entry: price impact <2%, slippage ≤1.5%
- Exit ladder: 30% at 3x, 50% of remainder at 5x, trail final 20%
- Stop-loss: initial −30%, move to breakeven once 2x, trail from ATH after 3x
- Never exit 100% in one tx on thin pools (slippage catastrophe)
- Max single position: 3% of portfolio (score 90+)

### Tax math (often overlooked)

A 10% buy + 10% sell tax means a 25%+ gain is required just to break even.
`breakeven_multiplier = 1 / ((1 - buy_tax) * (1 - sell_tax))`

---

## Anti-Patterns (Common Bot-Killing Mistakes)

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| No WebSocket heartbeat | Silent connection death, miss all events | Reconnect if no msg in 60s |
| No Redis dedup | Double analysis + double buys | `SET NX` before every enqueue |
| Trusting GoPlus alone | Fresh tokens not yet indexed | Also simulate swap on-chain |
| Polling DexScreener for all tokens | 429 rate limit, banned | Tier by score |
| Public RPC for WebSocket | Dropped connections, throttling | Use Helius / Ankr premium |
| No Jito on Solana | Sandwich attack on every buy | Always use Jito bundles |
| Static stop-loss after moonshot | Giving back 80% of gains | Adjust to ATH after 2x |
| Over-concentration in one chain | Correlated wipeout risk | Max 20% per chain |
| Aping straight from launch | Buying the peak | Wait for first retrace |

---

## Deployment Checklist

```
Infrastructure:
  □ PostgreSQL 16 + TimescaleDB extension installed
  □ Redis 7 running (or managed Redis like Upstash)
  □ Node.js 20 + Python 3.11 environments
  □ PM2 or systemd for process management + auto-restart

API keys (required before first run):
  □ Helius API key (Solana RPC)
  □ Ankr API key (BSC RPC)
  □ Telegram API_ID + API_HASH (my.telegram.org)
  □ GoPlus API token (gopluslabs.io)
  □ Bubblemaps API key (contact sales)
  □ Jito tip account + keypair (Solana)
  □ Bloxroute API key (BSC)

Wallet setup:
  □ Dedicated trading wallet (NOT your main wallet)
  □ Wallet funded with working capital only
  □ Private key encrypted with env-var passphrase
  □ Test run with small amounts ($10 trades) before going live

Monitoring:
  □ Telegram bot token + personal chat_id for alerts
  □ Grafana dashboard for queue depth, RPC latency, error rates
  □ Alertmanager: page on queue stall >5min, RPC down >60s
```

---

## Example BullMQ Queue Architecture

```typescript
// queues.ts — central queue definitions
import { Queue, Worker } from 'bullmq';
const connection = { host: 'localhost', port: 6379 };

export const analyzeQueue = new Queue('analyze', { connection });
export const executeQueue  = new Queue('execute',  { connection });
export const alertQueue    = new Queue('alerts',   { connection });

// Workers run in separate processes
new Worker('analyze', async (job) => {
    const { chain, token } = job.data;
    const contractScore   = await runContractAnalyzer(token, chain);
    const tokenomicsScore = await runTokenomicsAnalyzer(token, chain);
    const marketScore     = await runMarketAnalyzer(token, chain);
    const signal = computeSignal({ contractScore, tokenomicsScore, marketScore });
    if (signal.type === 'BUY_SIGNAL') {
        await executeQueue.add('buy', { signal }, { priority: 1 });
    }
}, { connection, concurrency: 5 });
```

---

## Quick Reference — Chain-Specific Quirks

### Solana
- Token creation: Raydium `initialize2` + Orca `initializePool`
- MEV protection: Jito bundles (tip 100k–500k lamports)
- Slippage: Jupiter handles auto-routing, set `slippageBps: 150`
- Rug speed: seconds (fast finality means fast rugs — tighter timeouts)
- Token standard: SPL Token / Token-2022 (check for transfer hooks on Token-2022)

### BSC
- Token creation: PancakeSwap V2 `PairCreated` + V3 `PoolCreated`
- MEV protection: Bloxroute private tx relay
- Honeypot prevalence: very high — always simulate sell before buying
- Block time: ~3s (more time to analyze than Solana)
- Token standard: BEP-20 (ERC-20 compatible — use ethers.js)
- GoPlus chain_id: `56`

# Wallet Integration Skill — FXcrypt App

## What This Skill Covers

A complete blueprint for building, extending, and debugging the crypto wallet layer in
the FXcrypt Firebase PWA. Covers: creating TON / BASE wallet pages, wiring wallets into
the DEX bot trading flow, exposing wallet management through the Telegram bot, and all
the Firebase CSP / CDN pitfalls that will silently break every wallet operation.

**Trigger this skill** whenever the task involves:
- Adding or modifying wallet creation / import / display in `wallet.html` / `wallet.js`
- Adding a new chain to the DEX bot (`bot.html`, `bot.js`)
- Extending `trader.js` / `telegram.js` / `functions/index.js` with new chain support
- Updating Firebase headers (`firebase.json`) for new external APIs or CDNs
- Any `ethers.js` or `TonWeb` usage in the browser (not Cloud Functions)

---

## System Architecture — Two Wallet Storage Tiers

This is the single most important concept to understand before touching any wallet code.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TIER 1 — WALLET PAGE (wallet.html / wallet.js)                         │
│                                                                         │
│  Purpose: long-term key custody (TON + BASE)                            │
│  Encryption: PBKDF2 (100k iter, SHA-256) + AES-256-GCM (browser)       │
│  Storage: Firestore  users/{uid}  document, field  wallets.{chain}      │
│  Schema: { address, publicKey, encPrivateKey, encMnemonic, createdAt }  │
│  Never touches server — keys encrypted before leaving the browser        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  TIER 2 — DEX BOT TRADING (bot.html / bot.js / Cloud Functions)         │
│                                                                         │
│  Purpose: hot wallet for automated trading                              │
│  Encryption: AES-256-GCM (server-side, Cloud Function env var)          │
│  Storage: Firestore  users/{uid}/botSettings  document, field  wallets  │
│  Schema: { bsc, eth, sol, base, ton }  ← per-chain encrypted key blobs  │
│  Decrypted inside Cloud Functions only — never on the client             │
└─────────────────────────────────────────────────────────────────────────┘
```

**Rule**: Never mix these two storage paths. The bot settings wallets are for
automated on-chain trading. The wallet page wallets are for user custody only.
They live in different Firestore paths and use different encryption schemes.

---

## Files Changed in This Integration

| File | What Was Done |
|------|---------------|
| `wallet.html` | New. Full wallet page — chain tabs, empty states, create/import forms, wallet card, reveal/mnemonic modals |
| `wallet.js` | New. ES module — PBKDF2+AES-GCM encryption, TON + BASE wallet create/import, Firestore save/load/delete |
| `functions/lib/trader.js` | Added BASE chain RPCs + BaseSwap V2 router, `getTONBalance()`, extended `buyTokenEVM` / `sellTokenEVM` for base chain |
| `functions/index.js` | Extended `getBalances` to fetch BASE (EVM) and TON (TonCenter) balances |
| `functions/lib/telegram.js` | Full BASE + TON support: wallet keyboard, create/import/remove, gem buy callbacks, balance, status |
| `bot.html` | Added BASE + TON balance cards on dashboard, BASE wallet setup section, TON redirect section |
| `bot.js` | Extended `chainLabel`, `explorerUrl`, `refreshBalances`, `buyGem`, `renderGemCards`, `populateSettings` for base/ton |
| `style.css` | Added `.base-color`, `.ton-color`, and complete redesigned wallet section |
| `firebase.json` | Updated CSP to allow CDN scripts and new API endpoints |

---

## Critical Bug Pattern — Firebase CSP Silently Blocks CDN Scripts

**This is the #1 cause of "wallet creation errors" in this app.**

The `firebase.json` Content Security Policy controls what external scripts and APIs
the browser is allowed to load. If a CDN domain is missing from `script-src`, the
external library silently fails to load — `window.ethers` or `window.TonWeb` is
`undefined` — and every wallet operation throws an unhandled error.

### Required CSP entries for the wallet page

```json
{
  "key": "Content-Security-Policy",
  "value": "... script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdn.ethers.io https://unpkg.com https://esm.sh; ... connect-src ... https://toncenter.com https://mainnet.base.org ..."
}
```

| Domain | Needed for |
|--------|-----------|
| `https://cdn.ethers.io` | `ethers-5.7.2.umd.min.js` (BASE wallet creation) |
| `https://unpkg.com` | `tonweb@0.0.62/dist/tonweb.js` (TON wallet) |
| `https://esm.sh` | `tonweb-mnemonic` dynamic import (TON mnemonic import) |
| `https://toncenter.com` | `connect-src` — TON balance API |
| `https://mainnet.base.org` | `connect-src` — BASE chain JSON-RPC balance |

**When adding any new external library or API to the app, always update `firebase.json`
first — before writing any code that calls it.**

---

## TON Wallet — Patterns and Pitfalls

### Correct TonWeb Initialization

```javascript
// wallet.html — load tonweb as a regular UMD script (NOT a module import)
<script src="https://unpkg.com/tonweb@0.0.62/dist/tonweb.js"></script>

// wallet.js — initialize once at DOMContentLoaded
let tonweb = null;
function initTonWeb() {
  if (window.TonWeb) {
    tonweb = new TonWeb(new TonWeb.HttpProvider('https://toncenter.com/api/v2/jsonRPC'));
  }
}
document.addEventListener('DOMContentLoaded', () => { initTonWeb(); ... });
```

### Creating a TON Wallet (reliable, no external mnemonic dep)

```javascript
async function createTONWallet() {
  if (!tonweb) throw new Error('TonWeb not loaded');
  const nacl    = TonWeb.utils.nacl;          // tweetnacl bundled inside TonWeb
  const seed    = crypto.getRandomValues(new Uint8Array(32));
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet  = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const addr    = await wallet.getAddress();
  return {
    address:    addr.toString(true, true, false),  // userFriendly=true, urlSafe=true, bounceable=false
    privateKey: bytesToHex(seed),
    publicKey:  bytesToHex(keyPair.publicKey),
    mnemonic:   null,   // private key is the backup — no mnemonic dep required
  };
}
```

**Why no mnemonic on creation**: The `tonweb-mnemonic` package exports `mnemonicNew`
(not `generateMnemonic` — a bug magnet). Dynamic imports from `esm.sh` can also fail
under strict CSPs. Removing mnemonic from creation eliminates both failure modes.
The private key is a perfectly valid backup method.

### Importing a TON Wallet with Mnemonic (requires esm.sh in CSP)

```javascript
let _tonMnLib = null;
async function getTonMnLib() {
  if (_tonMnLib) return _tonMnLib;
  try {
    _tonMnLib = await import('https://esm.sh/tonweb-mnemonic'); // no version pin
    return _tonMnLib;
  } catch { return null; }
}

async function importTONWallet(input) {
  if (!tonweb) throw new Error('TonWeb not loaded');
  const nacl = TonWeb.utils.nacl;
  const trimmed = input.trim();
  let seed, mnemonic = null;

  if (trimmed.includes(' ')) {
    const words = trimmed.split(/\s+/);
    if (words.length < 12) throw new Error('Invalid input. Enter a 24-word mnemonic or hex private key.');
    const mnLib = await getTonMnLib();
    if (!mnLib) throw new Error('Mnemonic library unavailable. Use the hex private key instead.');
    const valid = mnLib.mnemonicValidate
      ? await mnLib.mnemonicValidate(words).catch(() => true)
      : true;
    if (!valid) throw new Error('Invalid TON mnemonic phrase.');
    const kp = await mnLib.mnemonicToKeyPair(words);  // correct export name
    seed = kp.secretKey.slice(0, 32);
    mnemonic = words.join(' ');
  } else {
    const raw = hexToBytes(trimmed);
    if (raw.length === 64) seed = raw.slice(0, 32);
    else if (raw.length === 32) seed = raw;
    else throw new Error('Private key must be 32 or 64 hex bytes');
  }

  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet  = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const addr    = await wallet.getAddress();
  return {
    address: addr.toString(true, true, false),
    privateKey: bytesToHex(seed),
    publicKey:  bytesToHex(keyPair.publicKey),
    mnemonic,
  };
}
```

**PITFALL**: `tonweb-mnemonic` exports are `mnemonicNew` / `mnemonicToKeyPair` /
`mnemonicValidate`. Never use `generateMnemonic` — it does not exist. The code will
silently fall through to a no-mnemonic path without throwing.

### TON Balance (client-side + server-side)

**Client-side (wallet.js):**
```javascript
async function getTONBalance(address) {
  try {
    const res  = await fetch(`https://toncenter.com/api/v2/getAddressBalance?address=${encodeURIComponent(address)}`);
    const data = await res.json();
    if (data.ok) return `${(Number(BigInt(data.result)) / 1e9).toFixed(4)} TON`;
    return '—';
  } catch { return '—'; }
}
```

**Server-side (trader.js, Cloud Functions):**
```javascript
const axios = require('axios');
async function getTONBalance(address) {
  try {
    const res = await axios.get('https://toncenter.com/api/v2/getAddressBalance', {
      params: { address }, timeout: 8000
    });
    if (res.data.ok) {
      return { native: (Number(BigInt(res.data.result)) / 1e9).toFixed(6) };
    }
    return { native: '0.000000' };
  } catch { return { native: '—' } }
}
```

### TON Limitations in Cloud Functions

`tonweb` is NOT in `functions/package.json` — do not add it without also testing the
full deploy cycle, as the package is large and has native dependency issues.

- TON balance: supported via TonCenter HTTP API (`axios` only — works fine)
- TON buy/sell/snipe: returns "not yet supported" message in Telegram
- TON wallet create/import in Telegram: redirects user to the wallet page in the app

---

## BASE Chain — Patterns and Constants

### Key Constants (trader.js)

```javascript
const BASE_RPCS = [
  'https://mainnet.base.org',
  'https://base.publicnode.com',
];
const BASESWAP_ROUTER = '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86'; // Uniswap V2 fork
const WBASE = '0x4200000000000000000000000000000000000006';           // WETH on Base L2
const BASE_CHAIN_ID = 8453;
```

### Adding a New Chain to the EVM Trading Functions

The pattern used in `buyTokenEVM` and `sellTokenEVM` is 3-way ternaries:

```javascript
const routerAddr = chain === 'bsc'  ? PANCAKESWAP_ROUTER
                 : chain === 'base' ? BASESWAP_ROUTER
                 : UNISWAP_V2_ROUTER;

const wrappedNative = chain === 'bsc'  ? WBNB
                    : chain === 'base' ? WBASE
                    : WETH;

// Error messages
const dexName = chain === 'bsc'  ? 'PancakeSwap V2'
              : chain === 'base' ? 'BaseSwap V2'
              : 'Uniswap V2';
```

**Extend this pattern for each new EVM chain** — no other structural changes to
`buyTokenEVM` / `sellTokenEVM` are needed.

### chainConfig Helper (trader.js)

```javascript
function chainConfig(chain) {
  if (chain === 'bsc')  return { chainId: 56,   rpcs: BSC_RPCS };
  if (chain === 'base') return { chainId: 8453, rpcs: BASE_RPCS };
  return { chainId: 1, rpcs: ETH_RPCS };
}
```

### BASE Balance (Cloud Functions)

```javascript
// BASE uses the same getEVMBalance function as BSC/ETH — just pass 'base' as chain
trader.getEVMBalance(wallets.base.address, 'base', settings.baseRpc)
```

### BASE in bot.js

```javascript
// Add to chainLabel lookup
const chainLabel = { bsc: 'BNB', eth: 'ETH', sol: 'SOL', base: 'ETH', ton: 'TON' }[chain] || chain;

// BASE uses ETH price for dollar value (it's an L2 — native gas = ETH)
const _nativePrice = gem.chain === 'bsc'  ? bnbPriceUsd
                   : gem.chain === 'base' ? ethPriceUsd
                   : solPriceUsd;

// buyGem — same BNB amount field as BSC
const _rawAmt = gem.chain === 'sol' ? gemBuyAmountSol : gemBuyAmountBsc;
```

---

## Client-Side Wallet Encryption Pattern (wallet.js)

```javascript
function b64enc(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64dec(s)   { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function encryptData(plaintext, password) {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const km   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key  = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { d: b64enc(ct), i: b64enc(iv), s: b64enc(salt) };
}

async function decryptData(enc, password) {
  const te  = new TextEncoder();
  const km  = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64dec(enc.s), iterations: 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(enc.i) }, key, b64dec(enc.d));
  return new TextDecoder().decode(pt);
}
```

**Firestore save pattern** (always use `setDoc` with `merge: true`):
```javascript
await setDoc(doc(db, 'users', uid), {
  wallets: {
    [chain]: { address, publicKey, encPrivateKey, encMnemonic, createdAt: Date.now() }
  }
}, { merge: true });
```

---

## ethers.js v5 Browser Patterns

The app uses **ethers v5.7.2 UMD** from `cdn.ethers.io` (NOT v6). Syntax differs from v6.

```javascript
// Create random wallet (synchronous)
const w = ethers.Wallet.createRandom();
// w.address, w.privateKey, w.mnemonic.phrase

// Import from mnemonic
const w = ethers.Wallet.fromMnemonic(phrase);

// Import from private key
const w = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);

// Get balance (v5 provider)
const provider = new ethers.providers.JsonRpcProvider('https://mainnet.base.org');
const raw      = await provider.getBalance(address);
const eth      = ethers.utils.formatEther(raw);   // NOT ethers.formatEther (that's v6)
```

**Never use v6 syntax (`ethers.formatEther`, `ethers.JsonRpcProvider`) in the browser —
the UMD bundle loaded in this app is v5.**

---

## Extending the Telegram Bot for a New Chain

When adding a new chain, update `telegram.js` in this order:

1. **`VALID_CHAINS` Set**: add the new chain string
2. **`nativeTicker(chain)` helper**: add the ticker symbol
3. **`explorerUrl(chain, txHash)`**: add the block explorer URL
4. **`walletMenuKeyboard(wallets)`**: add create/remove buttons (or redirect for non-EVM chains)
5. **`action_balance`**: add balance fetch call
6. **`action_status` / `action_boton` / `action_botoff`**: add wallet line
7. **`action_wallet_list`**: add display line
8. **`wallet_import_menu`** + import handler: add import option
9. **`/buy`, `/sell`, `/snipe`**: add validation or redirect message for unsupported chains
10. **`/price` command**: add chain to DexScreener chain ID map

### DexScreener Chain IDs (used in Telegram `/price` command)

```javascript
const dsChain = { bsc: 'bsc', eth: 'ethereum', sol: 'solana', base: 'base', ton: 'ton' }[chain];
```

---

## Wallet Page CSS — Class Reference

Key CSS classes added in the redesign (do not rename without updating wallet.html):

| Class | Purpose |
|-------|---------|
| `.wlt-page-header` | Title + subtitle section above chain tabs |
| `.wlt-chain-tabs` | Flex container for chain selector buttons |
| `.wlt-chain-tab` | Individual chain tab (`.active` for selected) |
| `.wlt-chain-label` | Column flex inside tab — holds name + sublabel |
| `.wlt-chain-name` | Bold chain name inside tab |
| `.wlt-chain-sub` | Small subtitle inside tab (hidden on very narrow mobile) |
| `.wlt-dot` | Colored circle indicator (inline `style="background:#0098EA"`) |
| `.wlt-panel` | Panel wrapper per chain — shown/hidden by JS |
| `.wlt-empty` | Empty state container (column flex, centered) |
| `.wlt-empty-badge` | Colored rounded badge (TON/BASE) in empty state |
| `.wlt-empty-title` | Bold headline in empty state |
| `.wlt-empty-text` | Descriptive text in empty state |
| `.wlt-full-btn` | 100% width button, max 340px |
| `.wlt-form-hint` | Green-left-border info hint below form |
| `.wlt-card` | Wallet card with overflow:hidden (for border-radius) |
| `.wlt-card-header` | Dark top band: chain dot + name + network name |
| `.wlt-card-chain-row` | Flex row inside header: dot + name |
| `.wlt-card-dot` | Colored circle in card header |
| `.wlt-card-chain-name` | Chain name in card header |
| `.wlt-card-network` | Network subtitle in card header |
| `.wlt-card-body` | Body below header: address + balance + pills |
| `.wlt-field-label` | Uppercase small label above address/balance |
| `.wlt-addr-row` | Address container with copy button |
| `.wlt-addr` | Monospace address text (word-break: break-all) |
| `.wlt-copy-btn` | "Copy" button inside address row |
| `.wlt-bal-section` | Balance wrapper (contains field-label + value) |
| `.wlt-bal-value` | Large green balance number |
| `.wlt-pills` | Flex wrap row of action pills |
| `.wlt-pill` | Individual action pill (Private Key / Mnemonic / etc.) |
| `.wlt-pill-danger` | Red variant (Remove wallet) |

---

## Firestore Rules

The wallet page writes to the top-level `users/{uid}` document (not a sub-collection).
The existing rules already cover this:

```
match /users/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

No rule changes are needed for wallet functionality.

---

## Deployment Sequence

Always deploy in this order to avoid version mismatches:

```bash
# 1. Update Cloud Functions + hosting together (most changes)
firebase deploy

# 2. Hosting + rules only (no function changes)
firebase deploy --only hosting,firestore:rules

# 3. Functions only (no front-end changes)
firebase deploy --only functions
```

**After updating `firebase.json` headers**: always deploy hosting. The new CSP only
takes effect on the CDN after a hosting deploy — not from a local serve.

---

## Common Mistakes to Avoid

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Missing CDN in `script-src` CSP | "TonWeb not loaded" or `ethers is not defined` toast | Add domain to `firebase.json` script-src before writing code |
| Missing API in `connect-src` CSP | Balance always shows `—`, no network error in UI | Add `toncenter.com` / `mainnet.base.org` to connect-src |
| Using `ethers v6` syntax with the v5 UMD bundle | TypeError in console | Check: `formatEther` → `ethers.utils.formatEther`, `JsonRpcProvider` → `ethers.providers.JsonRpcProvider` |
| Calling `mnLib.generateMnemonic` on `tonweb-mnemonic` | Silent fallback — wallet created with no mnemonic | Use `mnLib.mnemonicNew` (the correct export name) |
| Pinning `esm.sh/tonweb-mnemonic@0.0.5` | Import fails — package doesn't exist at that version | Use `https://esm.sh/tonweb-mnemonic` (no pin) |
| Initializing TonWeb before DOM is ready | `tonweb` remains `null` | Call `initTonWeb()` inside the `DOMContentLoaded` handler |
| Using `setDoc` without `{ merge: true }` | Saves new wallet, silently wipes the other chain's wallet | Always pass `{ merge: true }` |
| Forgetting `connect-src` when adding a new RPC | Balance fetch fails silently | Add the RPC domain to `connect-src` in firebase.json |
| Adding TON trading in Cloud Functions | Runtime crash — `tonweb` not in package.json | Return "not yet supported" message; use HTTP API for balance only |
| Reading `w.mnemonic.phrase` without null check (ethers v5) | Error on non-HD wallets | Always use `w.mnemonic ? w.mnemonic.phrase : null` |

---

## How to Add a Third Chain (e.g. Ethereum Mainnet)

Follow this checklist:

**1. trader.js**
- Add RPC array constant (`ETH_RPCS`)
- Add `chainConfig` case for `'eth'`
- `buyTokenEVM` / `sellTokenEVM`: already handles `'eth'` via the final ternary fallback

**2. functions/index.js**
- Add `getEVMBalance` call for `'eth'` chain in `getBalances`

**3. telegram.js** (10 steps listed above)

**4. bot.html**
- Add balance card (`id="balETH"`)
- Add wallet setup section (`data-chain="eth"`)

**5. bot.js**
- Extend `chainLabel`, `explorerUrl`, `refreshBalances`, `buyGem`

**6. wallet.html + wallet.js** (if adding to the wallet page)
- Add panel HTML (`id="panelEth"`)
- Add chain tab button (`data-chain="eth"`)
- Add `createEthWallet()` / `importEthWallet()` functions
- Wire event handlers in `setupEth()`

**7. style.css**
- Add `.eth-color { color: #627EEA; }` and chain-pill active styles

**8. firebase.json**
- Add any new RPC or API domain to `connect-src`

**9. Deploy**
```bash
firebase deploy
```

---

## Key Addresses Reference

| Constant | Value | Chain |
|----------|-------|-------|
| `PANCAKESWAP_ROUTER` | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | BSC |
| `BASESWAP_ROUTER` | `0x327Df1E6de05895d2ab08513aaDD9313Fe505d86` | Base |
| `UNISWAP_V2_ROUTER` | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | Ethereum |
| `WBNB` | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | BSC |
| `WBASE` (`WETH on Base`) | `0x4200000000000000000000000000000000000006` | Base |
| `WETH` | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | Ethereum |
| TonCenter JSON-RPC | `https://toncenter.com/api/v2/jsonRPC` | TON |
| TonCenter Balance | `https://toncenter.com/api/v2/getAddressBalance` | TON |
| Base mainnet RPC | `https://mainnet.base.org` | Base |
| Base chain ID | `8453` | Base |

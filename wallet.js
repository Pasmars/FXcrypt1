import { requireAuth } from './authObserver.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase.js';

/* ════════════════════════════════════════════════════════════════════════
   FXcrypt Wallet — unified multi-chain portfolio wallet
   - Client-side encryption (PBKDF2 + AES-GCM), keys never leave the device
     in plaintext. Firestore schema users/{uid}.wallets.{chain} preserved so
     the Telegram bot integration keeps working.
   - Single session unlock: one password unlocks every wallet for the session.
   ════════════════════════════════════════════════════════════════════════ */

// ─── RPC endpoints (fallback arrays) ─────────────────────────────────────────
const BASE_RPCS  = ['https://mainnet.base.org',               'https://base.publicnode.com'];
const BSC_RPCS   = ['https://bsc-dataseed.binance.org',       'https://bsc.publicnode.com'];
const ETH_RPCS   = ['https://cloudflare-eth.com',             'https://eth.llamarpc.com'];
const MATIC_RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'];
const SOL_RPC    = 'https://api.mainnet-beta.solana.com';
const TON_API    = 'https://toncenter.com/api/v2';

// Native coin logos (CoinGecko CDN — allowed by img-src https:)
const LOGO = {
  ton:  'https://assets.coingecko.com/coins/images/17980/large/ton_symbol.png',
  eth:  'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
  bnb:  'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  matic:'https://assets.coingecko.com/coins/images/4713/large/polygon.png',
  sol:  'https://assets.coingecko.com/coins/images/4128/large/solana.png',
};

// ─── Chain registry — single source of truth for every chain ──────────────────
const CHAINS = {
  ton: {
    name: 'TON', network: 'The Open Network', color: '#0098EA', symbol: 'TON',
    evm: false, cgId: 'the-open-network', logo: LOGO.ton,
    explorer: 'https://tonscan.org/address/', txExplorer: 'https://tonscan.org/tx/',
    twSlug: 'ton',
  },
  base: {
    name: 'Base', network: 'Base', color: '#0052FF', symbol: 'ETH',
    evm: true, chainId: 8453, rpcs: BASE_RPCS, cgId: 'ethereum', cgPlatform: 'base',
    logo: LOGO.eth, explorer: 'https://basescan.org/address/', txExplorer: 'https://basescan.org/tx/',
    blockscout: 'https://base.blockscout.com', twSlug: 'base',
  },
  bsc: {
    name: 'BSC', network: 'BNB Smart Chain', color: '#F0B90B', symbol: 'BNB',
    evm: true, chainId: 56, rpcs: BSC_RPCS, cgId: 'binancecoin', cgPlatform: 'binance-smart-chain',
    logo: LOGO.bnb, explorer: 'https://bscscan.com/address/', txExplorer: 'https://bscscan.com/tx/',
    blockscout: 'https://bnb.blockscout.com', twSlug: 'smartchain',
  },
  eth: {
    name: 'Ethereum', network: 'Ethereum Mainnet', color: '#627EEA', symbol: 'ETH',
    evm: true, chainId: 1, rpcs: ETH_RPCS, cgId: 'ethereum', cgPlatform: 'ethereum',
    logo: LOGO.eth, explorer: 'https://etherscan.io/address/', txExplorer: 'https://etherscan.io/tx/',
    blockscout: 'https://eth.blockscout.com', twSlug: 'ethereum',
  },
  matic: {
    name: 'Polygon', network: 'Polygon Mainnet', color: '#8247E5', symbol: 'MATIC',
    evm: true, chainId: 137, rpcs: MATIC_RPCS, cgId: 'matic-network', cgPlatform: 'polygon-pos',
    logo: LOGO.matic, explorer: 'https://polygonscan.com/address/', txExplorer: 'https://polygonscan.com/tx/',
    blockscout: 'https://polygon.blockscout.com', twSlug: 'polygon',
  },
  sol: {
    name: 'Solana', network: 'Solana Mainnet', color: '#9945FF', symbol: 'SOL',
    evm: false, cgId: 'solana', logo: LOGO.sol,
    explorer: 'https://solscan.io/account/', txExplorer: 'https://solscan.io/tx/',
    twSlug: 'solana',
  },
};
const CHAIN_ORDER = ['ton', 'base', 'bsc', 'eth', 'matic', 'sol'];

// ─── Web Crypto helpers ───────────────────────────────────────────────────────
function b64enc(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64dec(s)   { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

// Iteration counts MUST stay in sync with shared/lib/wallet-crypto.ts (the
// mobile/webapp engine): new blobs are written at 600k and carry their count in
// `it`; blobs without `it` are legacy 100k. Decrypt honors the blob's own count
// so wallets created in EITHER app open in BOTH — a hardcoded 100k here was
// failing every wallet the mobile/webapp created ("could not unlock this
// wallet with your session password" despite the correct password).
const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 100000;

async function encryptData(plaintext, password) {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const km   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key  = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { d: b64enc(ct), i: b64enc(iv), s: b64enc(salt), it: PBKDF2_ITERATIONS };
}

async function decryptData(enc, password) {
  const te  = new TextEncoder();
  const km  = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64dec(enc.s), iterations: enc.it || LEGACY_PBKDF2_ITERATIONS, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(enc.i) }, key, b64dec(enc.d));
  return new TextDecoder().decode(pt);
}

// ─── Raw JSON-RPC helper ──────────────────────────────────────────────────────
async function _jsonRpc(url, method, params, timeout = 8000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal:  ctrl.signal,
    });
    return await res.json();
  } finally { clearTimeout(t); }
}

function _decodeABIStr(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length < 128) return null;
  const len = parseInt(h.slice(64, 128), 16);
  if (!len || len > 256) return null;
  let s = '';
  for (let i = 128; i < 128 + len * 2; i += 2) {
    const c = parseInt(h.slice(i, i + 2), 16);
    if (c > 0 && c < 128) s += String.fromCharCode(c);
  }
  return s || null;
}

function bytesToHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '');
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.substr(i, 2), 16);
  return b;
}

// ─── TON ──────────────────────────────────────────────────────────────────────
let tonweb = null;
function initTonWeb() {
  if (window.TonWeb) tonweb = new TonWeb(new TonWeb.HttpProvider(`${TON_API}/jsonRPC`));
}

let _tonMnLib = null;
async function getTonMnLib() {
  if (_tonMnLib) return _tonMnLib;
  try { _tonMnLib = await import('https://esm.sh/tonweb-mnemonic'); return _tonMnLib; }
  catch { return null; }
}

async function createTONWallet() {
  if (!tonweb) throw new Error('TON library not loaded. Refresh and try again.');
  const nacl    = TonWeb.utils.nacl;
  const seed    = crypto.getRandomValues(new Uint8Array(32));
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet  = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const addr    = await wallet.getAddress();
  return { address: addr.toString(true, true, false), privateKey: bytesToHex(seed), publicKey: bytesToHex(keyPair.publicKey), mnemonic: null };
}

async function importTONWallet(input) {
  if (!tonweb) throw new Error('TON library not loaded.');
  const nacl = TonWeb.utils.nacl;
  const trimmed = input.trim();
  let seed, mnemonic = null;
  if (trimmed.includes(' ')) {
    const words = trimmed.split(/\s+/);
    if (words.length < 12) throw new Error('Enter a 24-word mnemonic or a hex private key.');
    const mnLib = await getTonMnLib();
    if (!mnLib || !mnLib.mnemonicToKeyPair) throw new Error('Mnemonic library unavailable. Use the hex private key instead.');
    const valid = mnLib.mnemonicValidate ? await mnLib.mnemonicValidate(words).catch(() => true) : true;
    if (!valid) throw new Error('Invalid TON mnemonic phrase.');
    const kp = await mnLib.mnemonicToKeyPair(words);
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
  return { address: addr.toString(true, true, false), privateKey: bytesToHex(seed), publicKey: bytesToHex(keyPair.publicKey), mnemonic };
}

async function getTonBalanceNum(address) {
  try {
    const res  = await fetch(`${TON_API}/getAddressBalance?address=${encodeURIComponent(address)}`);
    const data = await res.json();
    if (data.ok) return Number(BigInt(data.result)) / 1e9;
  } catch {}
  return null;
}

async function sendTONNative(toAddress, amountTon, privKeyHex) {
  if (!tonweb) throw new Error('TON library not loaded.');
  const nacl    = TonWeb.utils.nacl;
  const seed    = hexToBytes(privKeyHex.slice(0, 64));
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet  = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const seqno   = (await wallet.methods.seqno().call()) || 0;
  await wallet.methods.transfer({
    secretKey: keyPair.secretKey, toAddress,
    amount: TonWeb.utils.toNano(String(amountTon)), seqno, sendMode: 3,
  }).send();
}

async function getTonTxs(address) {
  try {
    const res  = await fetch(`${TON_API}/getTransactions?address=${encodeURIComponent(address)}&limit=12`);
    const data = await res.json();
    if (!data.ok) return [];
    return data.result.map(tx => {
      const inMsg  = tx.in_msg;
      const out    = (tx.out_msgs || [])[0];
      const incoming = inMsg && inMsg.source && (!out);
      const valNano  = incoming ? Number(inMsg.value || 0) : Number(out?.value || 0);
      return {
        hash: tx.transaction_id?.hash || '',
        incoming, value: valNano / 1e9, symbol: 'TON',
        ts: (tx.utime || 0) * 1000,
        counterparty: incoming ? (inMsg.source) : (out?.destination || ''),
      };
    });
  } catch { return []; }
}

// ─── EVM (Base, BSC, ETH, Polygon — ethers v5) ────────────────────────────────
function getEthers() {
  const e = window.ethers;
  if (!e) throw new Error('ethers library failed to load. Refresh the page and try again.');
  return e;
}
function createEvmWallet() {
  const e = getEthers();
  const w = e.Wallet.createRandom();
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || null };
}
function importEvmWallet(input) {
  const e = getEthers();
  const t = input.trim();
  let w;
  if (t.split(/\s+/).length > 1) w = e.Wallet.fromMnemonic(t);
  else { const key = t.startsWith('0x') ? t : '0x' + t; w = new e.Wallet(key); }
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || null };
}
async function getEvmBalanceNum(address, rpcs) {
  for (const rpc of rpcs) {
    try {
      const data = await _jsonRpc(rpc, 'eth_getBalance', [address, 'latest']);
      if (!data.result) continue;
      return Number(BigInt(data.result)) / 1e18;
    } catch {}
  }
  return null;
}
async function getEvmTokenMeta(contractAddr, rpcs) {
  let symbol = null, decimals = 18;
  for (const rpc of rpcs) {
    try {
      const [symResp, decResp] = await Promise.all([
        _jsonRpc(rpc, 'eth_call', [{ to: contractAddr, data: '0x95d89b41' }, 'latest']),
        _jsonRpc(rpc, 'eth_call', [{ to: contractAddr, data: '0x313ce567' }, 'latest']),
      ]);
      if (symResp.result && symResp.result.length > 2) symbol = _decodeABIStr(symResp.result);
      if (decResp.result && decResp.result !== '0x') {
        const d = Number(BigInt(decResp.result));
        if (d >= 0 && d <= 30) decimals = d;
      }
      if (symbol) break;
    } catch {}
  }
  return { symbol: symbol || '???', decimals };
}
async function getEvmTokenBalanceRaw(walletAddr, contractAddr, rpcs) {
  const padded = walletAddr.replace(/^0x/, '').padStart(64, '0');
  const data   = '0x70a08231' + padded;
  for (const rpc of rpcs) {
    try {
      const resp = await _jsonRpc(rpc, 'eth_call', [{ to: contractAddr, data }, 'latest']);
      if (!resp.result || resp.result === '0x') continue;
      return BigInt(resp.result);
    } catch {}
  }
  return null;
}
async function sendEvmNative(chain, to, amountEther, privKey) {
  const e = getEthers(); const cfg = CHAINS[chain]; let lastErr;
  for (const rpc of cfg.rpcs) {
    try {
      const provider = new e.providers.JsonRpcProvider(rpc);
      const signer   = new e.Wallet(privKey, provider);
      return await signer.sendTransaction({ to, value: e.utils.parseEther(String(amountEther)), gasLimit: 21000 });
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Transaction failed on all endpoints');
}
async function sendEvmToken(chain, contractAddr, to, amount, decimals, privKey) {
  const e = getEthers(); const cfg = CHAINS[chain];
  const iface = new e.utils.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
  const data  = iface.encodeFunctionData('transfer', [to, e.utils.parseUnits(String(amount), decimals)]);
  let lastErr;
  for (const rpc of cfg.rpcs) {
    try {
      const provider = new e.providers.JsonRpcProvider(rpc);
      const signer   = new e.Wallet(privKey, provider);
      return await signer.sendTransaction({ to: contractAddr, data, gasLimit: 100000 });
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Token transfer failed on all endpoints');
}
async function getEvmTxs(chain, address) {
  const cfg = CHAINS[chain];
  if (!cfg.blockscout) return null; // signal "unsupported"
  try {
    const res = await fetch(`${cfg.blockscout}/api/v2/addresses/${address}/transactions?filter=`, { headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    const lower = address.toLowerCase();
    return (data.items || []).slice(0, 12).map(it => {
      const from = (it.from?.hash || '').toLowerCase();
      const incoming = from !== lower;
      return {
        hash: it.hash,
        incoming,
        value: Number(it.value || 0) / 1e18,
        symbol: cfg.symbol,
        ts: it.timestamp ? Date.parse(it.timestamp) : 0,
        counterparty: incoming ? (it.from?.hash || '') : (it.to?.hash || ''),
      };
    });
  } catch { return []; }
}

// ─── Solana ─────────────────────────────────────────────────────────────────
const _B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { const r = n % 58n; n /= 58n; s = _B58[Number(r)] + s; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}
function b58dec(str) {
  let n = 0n;
  for (const c of str) { const i = _B58.indexOf(c); if (i < 0) throw new Error('Invalid base58 character: ' + c); n = n * 58n + BigInt(i); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  let lz = 0;
  for (const c of str) { if (c === '1') lz++; else break; }
  return new Uint8Array([...new Array(lz).fill(0), ...bytes]);
}
let _solWeb3 = null;
async function getSolWeb3() {
  if (_solWeb3) return _solWeb3;
  try { _solWeb3 = await import('https://esm.sh/@solana/web3.js@1.95.3'); return _solWeb3; }
  catch { throw new Error('Solana library failed to load. Check your connection.'); }
}
async function createSolWallet() {
  const { Keypair } = await getSolWeb3();
  const kp = Keypair.generate();
  return { address: kp.publicKey.toBase58(), privateKey: b58enc(kp.secretKey), publicKey: kp.publicKey.toBase58(), mnemonic: null };
}
async function importSolWallet(input) {
  const { Keypair } = await getSolWeb3();
  const trimmed = input.trim(); let secretKey;
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr) || arr.length !== 64) throw new Error('JSON array must contain exactly 64 bytes.');
    secretKey = Uint8Array.from(arr);
  } else if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    if (trimmed.length === 128) secretKey = hexToBytes(trimmed);
    else if (trimmed.length === 64) {
      const kp = Keypair.fromSeed(hexToBytes(trimmed));
      return { address: kp.publicKey.toBase58(), privateKey: b58enc(kp.secretKey), publicKey: kp.publicKey.toBase58(), mnemonic: null };
    } else throw new Error('Hex key must be 64 chars (seed) or 128 chars (full key).');
  } else {
    secretKey = b58dec(trimmed);
    if (secretKey.length !== 64) throw new Error('Base58 key must decode to 64 bytes.');
  }
  const kp = Keypair.fromSecretKey(secretKey);
  return { address: kp.publicKey.toBase58(), privateKey: b58enc(kp.secretKey), publicKey: kp.publicKey.toBase58(), mnemonic: null };
}
async function getSolBalanceNum(address) {
  try {
    const data = await _jsonRpc(SOL_RPC, 'getBalance', [address, { commitment: 'confirmed' }]);
    if (data.result?.value == null) return null;
    return data.result.value / 1e9;
  } catch { return null; }
}
async function sendSolNative(toAddress, amountSol, secretKeyBase58) {
  const { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await getSolWeb3();
  const fromKp = Keypair.fromSecretKey(b58dec(secretKeyBase58));
  const conn   = new Connection(SOL_RPC, 'confirmed');
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: fromKp.publicKey, toPubkey: new PublicKey(toAddress),
    lamports: Math.round(Number(amountSol) * LAMPORTS_PER_SOL),
  }));
  const sig = await conn.sendTransaction(tx, [fromKp]);
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}
async function getSolTxs(address) {
  try {
    const data = await _jsonRpc(SOL_RPC, 'getSignaturesForAddress', [address, { limit: 12 }]);
    if (!Array.isArray(data.result)) return [];
    return data.result.map(s => ({
      hash: s.signature, incoming: null, value: null, symbol: 'SOL',
      ts: (s.blockTime || 0) * 1000, counterparty: '', err: !!s.err,
    }));
  } catch { return []; }
}

// ─── Pricing (CoinGecko) ──────────────────────────────────────────────────────
let _priceCache = { native: {}, token: {}, ts: 0 };
async function fetchNativePrices() {
  const ids = [...new Set(CHAIN_ORDER.map(c => CHAINS[c].cgId))].join(',');
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    const d = await r.json();
    const out = {};
    for (const id in d) out[id] = d[id].usd;
    return out;
  } catch { return {}; }
}
async function fetchTokenPrices(platform, addrs) {
  if (!addrs.length) return {};
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${addrs.join(',')}&vs_currencies=usd`);
    const d = await r.json();
    const out = {};
    for (const a in d) out[a.toLowerCase()] = d[a].usd;
    return out;
  } catch { return {}; }
}

// ─── Token logo (TrustWallet assets, with letter fallback) ────────────────────
function tokenLogoUrl(chain, contractAddr) {
  const cfg = CHAINS[chain];
  if (!cfg?.twSlug || !contractAddr) return null;
  let addr = contractAddr;
  try { addr = getEthers().utils.getAddress(contractAddr); } catch {}
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${cfg.twSlug}/assets/${addr}/logo.png`;
}

// ─── Firestore (schema preserved for Telegram bot) ────────────────────────────
async function saveWallet(uid, chain, walletData, password) {
  const encPrivateKey = await encryptData(walletData.privateKey, password);
  const encMnemonic   = walletData.mnemonic ? await encryptData(walletData.mnemonic, password) : null;
  await setDoc(doc(db, 'users', uid), {
    wallets: { [chain]: {
      address: walletData.address, publicKey: walletData.publicKey || null,
      encPrivateKey, encMnemonic, createdAt: Date.now(),
    } }
  }, { merge: true });
}
async function saveTokens(uid, chain, tokens) {
  await updateDoc(doc(db, 'users', uid), { [`wallets.${chain}.tokens`]: tokens });
}
async function loadUserDoc(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : {};
}
async function deleteWallet(uid, chain) {
  await updateDoc(doc(db, 'users', uid), { [`wallets.${chain}`]: deleteField() });
}
async function setAuthCheck(uid, password) {
  const check = await encryptData('FXCRYPT_UNLOCK_OK', password);
  await setDoc(doc(db, 'users', uid), { walletAuth: { check } }, { merge: true });
}

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmtUsd(n) {
  if (n == null || isNaN(n)) return '$0.00';
  if (n > 0 && n < 0.01) return '<$0.01';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtAmount(n) {
  if (n == null || isNaN(n)) return '0';
  if (n === 0) return '0';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return Number(n.toFixed(4)).toString();
  return Number(n.toPrecision(4)).toString();
}
function truncAddr(a) { return a && a.length > 16 ? a.slice(0, 6) + '…' + a.slice(-4) : (a || ''); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function toast(msg, type = 'info') {
  document.querySelectorAll('.wlt-toast').forEach(el => el.remove());
  const t = document.createElement('div');
  t.className = `wlt-toast wlt-toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 3000);
}
const $ = id => document.getElementById(id);
function showModal(id) { const m = $(id); if (m) m.style.display = 'flex'; }
function hideModal(id) { const m = $(id); if (m) m.style.display = 'none'; }

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let userDoc     = {};
let wallets     = {};       // { chain: { address, encPrivateKey, encMnemonic, tokens } }
let sessionPwd  = null;     // master password held in memory for the session
let assets      = [];       // aggregated portfolio rows
let filterChain = 'all';
let ctx         = {};       // transient modal context

// ─── Session unlock ─────────────────────────────────────────────────────────
function hasAnyWallet() { return Object.keys(wallets).length > 0; }
function isProtected()  { return !!userDoc.walletAuth?.check || hasAnyWallet(); }

async function verifyPassword(password) {
  const check = userDoc.walletAuth?.check;
  if (check) {
    try { return (await decryptData(check, password)) === 'FXCRYPT_UNLOCK_OK'; }
    catch { return false; }
  }
  // Legacy wallets without an auth check: validate against the first wallet's key.
  const chains = Object.keys(wallets);
  if (chains.length) {
    try { await decryptData(wallets[chains[0]].encPrivateKey, password); }
    catch { return false; }
  }
  await setAuthCheck(currentUser.uid, password); // adopt this password going forward
  userDoc.walletAuth = { check: (await loadUserDoc(currentUser.uid)).walletAuth?.check };
  return true;
}

// ─── Lock screen ──────────────────────────────────────────────────────────────
function renderLockScreen() {
  const create = !isProtected();
  $('wltApp').style.display  = 'none';
  $('wltLock').style.display = 'flex';
  $('wltLockTitle').textContent = create ? 'Create Wallet Password' : 'Wallet Locked';
  $('wltLockSub').textContent   = create
    ? 'Set a password to encrypt your wallets. You will need it to unlock and to send funds.'
    : 'Enter your password to unlock your wallets.';
  $('wltLockConfirm').style.display = create ? '' : 'none';
  $('wltUnlockBtn').textContent = create ? 'Create & Unlock' : 'Unlock';
  $('wltLockPwd').value = '';
  $('wltLockConfirm').value = '';
  setTimeout(() => $('wltLockPwd').focus(), 80);
}

function setupLockScreen() {
  const submit = async () => {
    const create = !isProtected();
    const pwd = $('wltLockPwd').value;
    if (pwd.length < 6) return toast('Password must be at least 6 characters', 'error');
    if (create && pwd !== $('wltLockConfirm').value) return toast('Passwords do not match', 'error');
    const btn = $('wltUnlockBtn');
    btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      if (create) await setAuthCheck(currentUser.uid, pwd);
      else if (!(await verifyPassword(pwd))) { toast('Wrong password', 'error'); return; }
      userDoc = await loadUserDoc(currentUser.uid);
      sessionPwd = pwd;
      enterApp();
    } catch (e) { toast(e.message || 'Unlock failed', 'error'); }
    finally { btn.disabled = false; btn.textContent = isProtected() ? 'Unlock' : 'Create & Unlock'; }
  };
  $('wltUnlockBtn').onclick = submit;
  $('wltLockPwd').addEventListener('keydown', e => { if (e.key === 'Enter' && $('wltLockConfirm').style.display === 'none') submit(); });
  $('wltLockConfirm').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function lockWallet() {
  sessionPwd = null;
  renderLockScreen();
}

// ─── Enter app + portfolio ────────────────────────────────────────────────────
function enterApp() {
  $('wltLock').style.display = 'none';
  $('wltApp').style.display  = '';
  renderNetworkFilter();
  refreshPortfolio();
}

function renderNetworkFilter() {
  const wrap = $('wltNetFilter');
  const chips = [`<button class="wlt-chip ${filterChain === 'all' ? 'active' : ''}" data-net="all">All</button>`];
  for (const c of CHAIN_ORDER) {
    if (!wallets[c]) continue;
    const cfg = CHAINS[c];
    chips.push(`<button class="wlt-chip ${filterChain === c ? 'active' : ''}" data-net="${c}">
      <span class="wlt-chip-dot" style="background:${cfg.color}"></span>${cfg.name}</button>`);
  }
  wrap.innerHTML = chips.join('');
  wrap.querySelectorAll('.wlt-chip').forEach(b => b.onclick = () => {
    filterChain = b.dataset.net;
    renderNetworkFilter();
    renderAssets();
  });
}

async function refreshPortfolio() {
  if (!hasAnyWallet()) {
    $('wltTotal').textContent = '$0.00';
    $('wltAssets').innerHTML = `<div class="wlt-empty">
        <div class="wlt-empty-icon">👛</div>
        <p class="wlt-empty-title">No wallets yet</p>
        <p class="wlt-empty-text">Add a wallet on any network to start managing your crypto.</p>
        <button class="wlt-btn wlt-btn-primary" id="wltEmptyAdd">+ Add Wallet</button>
      </div>`;
    $('wltEmptyAdd').onclick = openManage;
    return;
  }

  $('wltAssets').innerHTML = `<div class="wlt-loading"><span class="wlt-spinner"></span>Loading balances…</div>`;
  $('wltTotal').textContent = '…';

  // 1) Build the asset skeleton from wallets
  const rows = [];
  for (const chain of CHAIN_ORDER) {
    const w = wallets[chain];
    if (!w) continue;
    const cfg = CHAINS[chain];
    rows.push({ chain, kind: 'native', symbol: cfg.symbol, name: cfg.network, address: w.address,
                contract: null, decimals: 18, color: cfg.color, logo: cfg.logo, cgId: cfg.cgId });
    for (const tok of (w.tokens || [])) {
      rows.push({ chain, kind: 'token', symbol: tok.symbol, name: cfg.name + ' token', address: w.address,
                  contract: tok.address, decimals: tok.decimals ?? 18, color: cfg.color,
                  logo: tokenLogoUrl(chain, tok.address) });
    }
  }

  // 2) Fetch prices + balances in parallel
  const nativePrices = await fetchNativePrices();
  const tokenPriceJobs = {};
  for (const chain of CHAIN_ORDER) {
    const cfg = CHAINS[chain];
    const w = wallets[chain];
    if (!cfg.evm || !w?.tokens?.length) continue;
    tokenPriceJobs[chain] = fetchTokenPrices(cfg.cgPlatform, w.tokens.map(t => t.address));
  }
  const tokenPrices = {};
  for (const chain in tokenPriceJobs) tokenPrices[chain] = await tokenPriceJobs[chain];

  await Promise.all(rows.map(async row => {
    const cfg = CHAINS[row.chain];
    if (row.kind === 'native') {
      let bal = null;
      if (row.chain === 'ton') bal = await getTonBalanceNum(row.address);
      else if (row.chain === 'sol') bal = await getSolBalanceNum(row.address);
      else bal = await getEvmBalanceNum(row.address, cfg.rpcs);
      row.balance = bal;
      row.price   = nativePrices[cfg.cgId] ?? null;
    } else {
      const raw = await getEvmTokenBalanceRaw(row.address, row.contract, cfg.rpcs);
      row.balance = raw == null ? null : Number(raw) / Math.pow(10, row.decimals);
      row.price   = tokenPrices[row.chain]?.[row.contract.toLowerCase()] ?? null;
    }
    row.value = (row.balance != null && row.price != null) ? row.balance * row.price : 0;
  }));

  assets = rows;
  const total = rows.reduce((s, r) => s + (r.value || 0), 0);
  $('wltTotal').textContent = fmtUsd(total);
  renderAssets();
}

function renderAssets() {
  const list = filterChain === 'all' ? assets : assets.filter(a => a.chain === filterChain);
  if (!list.length) { $('wltAssets').innerHTML = `<p class="wlt-token-empty">No assets on this network.</p>`; return; }
  // sort by USD value desc, natives with zero value still shown
  const sorted = [...list].sort((a, b) => (b.value || 0) - (a.value || 0));
  $('wltAssets').innerHTML = sorted.map((a, i) => {
    const idx = assets.indexOf(a);
    const letter = (a.symbol || '?')[0].toUpperCase();
    return `<button class="wlt-asset" data-idx="${idx}">
      <div class="wlt-asset-logo" style="--lc:${a.color}">
        <span class="wlt-asset-letter">${letter}</span>
        ${a.logo ? `<img src="${a.logo}" alt="" loading="lazy" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()">` : ''}
        <span class="wlt-asset-net" style="background:${a.color}"></span>
      </div>
      <div class="wlt-asset-main">
        <span class="wlt-asset-sym">${escHtml(a.symbol)}</span>
        <span class="wlt-asset-name">${escHtml(CHAINS[a.chain].name)}${a.kind === 'token' ? ' · Token' : ''}</span>
      </div>
      <div class="wlt-asset-vals">
        <span class="wlt-asset-usd">${a.value ? fmtUsd(a.value) : '—'}</span>
        <span class="wlt-asset-bal">${a.balance == null ? '—' : fmtAmount(a.balance)} ${escHtml(a.symbol)}</span>
      </div>
    </button>`;
  }).join('');
  $('wltAssets').querySelectorAll('.wlt-asset').forEach(b =>
    b.onclick = () => openAsset(parseInt(b.dataset.idx, 10)));
}

// ─── Asset detail ─────────────────────────────────────────────────────────────
function openAsset(idx) {
  const a = assets[idx];
  if (!a) return;
  ctx.asset = a;
  const cfg = CHAINS[a.chain];
  $('wltAssetSym').textContent  = a.symbol;
  $('wltAssetNet').textContent  = cfg.network + (a.kind === 'token' ? ' · Token' : '');
  $('wltAssetBal').textContent  = (a.balance == null ? '—' : fmtAmount(a.balance)) + ' ' + a.symbol;
  $('wltAssetUsd').textContent  = a.value ? fmtUsd(a.value) : '—';
  const logo = $('wltAssetLogo');
  logo.style.setProperty('--lc', a.color);
  logo.innerHTML = `<span class="wlt-asset-letter">${(a.symbol || '?')[0].toUpperCase()}</span>` +
    (a.logo ? `<img src="${a.logo}" alt="" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()">` : '');
  // native-only secret reveal buttons
  $('wltAssetSecrets').style.display = a.kind === 'native' ? '' : 'none';
  $('wltAssetMnemonic').style.display = wallets[a.chain]?.encMnemonic ? '' : 'none';
  $('wltAssetExplorer').href = cfg.explorer + a.address;
  $('wltTxList').innerHTML = `<div class="wlt-loading"><span class="wlt-spinner"></span>Loading activity…</div>`;
  showModal('wltAssetModal');
  loadTxHistory(a);
}

async function loadTxHistory(a) {
  const cfg = CHAINS[a.chain];
  let txs = null;
  if (a.chain === 'ton') txs = await getTonTxs(a.address);
  else if (a.chain === 'sol') txs = await getSolTxs(a.address);
  else txs = await getEvmTxs(a.chain, a.address);

  if (ctx.asset !== a) return; // user switched assets
  if (txs == null) {
    $('wltTxList').innerHTML = `<p class="wlt-token-empty">Activity not available for ${cfg.name}. <a class="wlt-tx-link" href="${cfg.explorer}${a.address}" target="_blank" rel="noopener">View on explorer ↗</a></p>`;
    return;
  }
  if (!txs.length) { $('wltTxList').innerHTML = `<p class="wlt-token-empty">No recent activity.</p>`; return; }
  $('wltTxList').innerHTML = txs.map(tx => {
    const dir = tx.incoming == null ? 'tx' : (tx.incoming ? 'in' : 'out');
    const sign = tx.incoming == null ? '' : (tx.incoming ? '+' : '−');
    const amt = tx.value == null ? 'View tx' : `${sign}${fmtAmount(tx.value)} ${tx.symbol}`;
    const icon = tx.incoming == null ? '↪' : (tx.incoming ? '↓' : '↑');
    return `<a class="wlt-tx" href="${cfg.txExplorer}${tx.hash}" target="_blank" rel="noopener">
        <span class="wlt-tx-icon wlt-tx-${dir}">${icon}</span>
        <span class="wlt-tx-main">
          <span class="wlt-tx-type">${tx.incoming == null ? 'Transaction' : (tx.incoming ? 'Received' : 'Sent')}${tx.err ? ' (failed)' : ''}</span>
          <span class="wlt-tx-time">${timeAgo(tx.ts)}${tx.counterparty ? ' · ' + truncAddr(tx.counterparty) : ''}</span>
        </span>
        <span class="wlt-tx-amt wlt-tx-${dir}">${amt}</span>
      </a>`;
  }).join('');
}

// ─── Send ───────────────────────────────────────────────────────────────────
function openSend(asset) {
  const a = asset || ctx.asset;
  if (!a) return;
  ctx.send = a;
  const cfg = CHAINS[a.chain];
  $('wltSendTitle').textContent = `Send ${a.symbol}`;
  $('wltSendNet').textContent   = cfg.network;
  $('wltSendSymbol').textContent = a.symbol;
  $('wltSendAvail').textContent = a.balance == null ? '' : `Available: ${fmtAmount(a.balance)} ${a.symbol}`;
  $('wltSendTo').value = '';
  $('wltSendAmount').value = '';
  $('wltSendStatus').style.display = 'none';
  showModal('wltSendModal');
}

function setupSend() {
  $('wltSendMax').onclick = () => { const a = ctx.send; if (a?.balance != null) $('wltSendAmount').value = a.balance; };
  $('wltSendClose').onclick = () => hideModal('wltSendModal');
  $('wltSendConfirm').onclick = async () => {
    const a = ctx.send; if (!a) return;
    const to = $('wltSendTo').value.trim();
    const amount = $('wltSendAmount').value.trim();
    const status = $('wltSendStatus');
    if (!to) return toast('Enter recipient address', 'error');
    if (!amount || isNaN(+amount) || +amount <= 0) return toast('Enter a valid amount', 'error');

    const btn = $('wltSendConfirm');
    btn.disabled = true; btn.textContent = 'Sending…';
    status.style.display = ''; status.className = 'wlt-send-status'; status.textContent = 'Decrypting key…';
    try {
      let privKey;
      try { privKey = await decryptData(wallets[a.chain].encPrivateKey, sessionPwd); }
      catch { throw new Error('Could not unlock this wallet with your session password.'); }

      status.textContent = 'Broadcasting transaction…';
      let txHash = '';
      if (a.chain === 'sol') txHash = await sendSolNative(to, +amount, privKey);
      else if (a.chain === 'ton') { await sendTONNative(to, +amount, privKey); txHash = ''; }
      else if (a.kind === 'token') {
        const tx = await sendEvmToken(a.chain, a.contract, to, +amount, a.decimals, privKey);
        txHash = tx.hash;
      } else {
        const tx = await sendEvmNative(a.chain, to, +amount, privKey);
        txHash = tx.hash;
      }
      status.className = 'wlt-send-status wlt-send-ok';
      const exp = CHAINS[a.chain].txExplorer;
      if (txHash) status.innerHTML = `Sent! <a href="${exp}${txHash}" target="_blank" rel="noopener" class="wlt-tx-link">View Tx ↗</a>`;
      else status.textContent = 'Transaction submitted successfully.';
      setTimeout(refreshPortfolio, 5000);
    } catch (e) {
      status.className = 'wlt-send-status wlt-send-err';
      status.textContent = e.message || 'Transaction failed';
    } finally { btn.disabled = false; btn.textContent = 'Send'; }
  };
}

// ─── Receive (with QR) ─────────────────────────────────────────────────────────
let _qrLib = null;
async function renderQR(text) {
  const box = $('wltQR');
  box.innerHTML = '';
  try {
    if (!_qrLib) _qrLib = (await import('https://esm.sh/qrcode@1.5.4')).default;
    const url = await _qrLib.toDataURL(text, { margin: 1, width: 220, color: { dark: '#0B0E11', light: '#ffffff' } });
    const img = new Image(); img.src = url; img.alt = 'Address QR'; img.width = 220; img.height = 220;
    box.appendChild(img);
  } catch {
    box.innerHTML = '<p class="wlt-token-empty">QR unavailable</p>';
  }
}
function openReceive(asset) {
  const a = asset || ctx.asset;
  if (!a) return;
  const cfg = CHAINS[a.chain];
  $('wltRecvTitle').textContent = `Receive ${cfg.symbol}`;
  $('wltRecvSub').textContent   = `Only send ${cfg.name} network assets to this address.`;
  $('wltRecvAddr').textContent  = wallets[a.chain].address;
  ctx.recvAddr = wallets[a.chain].address;
  showModal('wltReceiveModal');
  renderQR(wallets[a.chain].address);
}
function setupReceive() {
  $('wltRecvClose').onclick = () => hideModal('wltReceiveModal');
  $('wltRecvCopy').onclick = () => navigator.clipboard.writeText(ctx.recvAddr || '').then(() => toast('Address copied!', 'success'));
}

// ─── Reveal secret ─────────────────────────────────────────────────────────────
function openReveal(chain, type) {
  ctx.revealChain = chain; ctx.revealType = type;
  $('wltRevealTitle').textContent = (type === 'key' ? 'Private Key' : 'Recovery Phrase') + ' — ' + CHAINS[chain].name;
  $('wltRevealResult').style.display = 'none';
  $('wltRevealContent').textContent = '';
  $('wltRevealPwd').value = '';
  showModal('wltRevealModal');
}
function setupReveal() {
  $('wltRevealClose').onclick = () => hideModal('wltRevealModal');
  $('wltRevealConfirm').onclick = async () => {
    const pwd = $('wltRevealPwd').value;
    if (!pwd) return toast('Enter your wallet password', 'error');
    const btn = $('wltRevealConfirm'); btn.disabled = true; btn.textContent = 'Decrypting…';
    try {
      const w = wallets[ctx.revealChain];
      const encObj = ctx.revealType === 'mnemonic' ? w.encMnemonic : w.encPrivateKey;
      const plain = await decryptData(encObj, pwd);
      $('wltRevealContent').textContent = plain;
      $('wltRevealResult').style.display = '';
    } catch { toast('Wrong password', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Reveal'; }
  };
  $('wltRevealCopy').onclick = () => navigator.clipboard.writeText($('wltRevealContent').textContent).then(() => toast('Copied!', 'success'));
}

// ─── Mnemonic backup (after create) ─────────────────────────────────────────────
function showMnemonicModal(mnemonic) {
  $('wltMnGrid').innerHTML = mnemonic.split(' ').map((w, i) =>
    `<div class="wlt-mn-word"><span class="wlt-mn-num">${i + 1}</span><span class="wlt-mn-text">${escHtml(w)}</span></div>`).join('');
  showModal('wltMnemonicModal');
}

// ─── Manage wallets (add / import / remove / tokens) ─────────────────────────────
function openManage() {
  renderManage();
  showModal('wltManageModal');
}
function renderManage() {
  $('wltManageList').innerHTML = CHAIN_ORDER.map(chain => {
    const cfg = CHAINS[chain];
    const w = wallets[chain];
    const exists = !!w;
    return `<div class="wlt-manage-row">
      <div class="wlt-manage-head">
        <div class="wlt-asset-logo wlt-logo-sm" style="--lc:${cfg.color}">
          <span class="wlt-asset-letter">${cfg.symbol[0]}</span>
          <img src="${cfg.logo}" alt="" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()">
        </div>
        <div class="wlt-manage-info">
          <span class="wlt-asset-sym">${cfg.name}</span>
          <span class="wlt-asset-name">${exists ? truncAddr(w.address) : cfg.network}</span>
        </div>
        ${exists ? `<span class="wlt-badge-ok">Active</span>` : ''}
      </div>
      <div class="wlt-manage-actions">
        ${exists ? `
          ${cfg.evm ? `<button class="wlt-mini" data-act="addtoken" data-chain="${chain}">+ Token</button>` : ''}
          <button class="wlt-mini" data-act="key" data-chain="${chain}">Private Key</button>
          ${w.encMnemonic ? `<button class="wlt-mini" data-act="mnemonic" data-chain="${chain}">Phrase</button>` : ''}
          <button class="wlt-mini wlt-mini-danger" data-act="remove" data-chain="${chain}">Remove</button>
        ` : `
          <button class="wlt-mini wlt-mini-primary" data-act="create" data-chain="${chain}">Create</button>
          <button class="wlt-mini" data-act="import" data-chain="${chain}">Import</button>
        `}
      </div>
    </div>`;
  }).join('');
  $('wltManageList').querySelectorAll('[data-act]').forEach(b =>
    b.onclick = () => manageAction(b.dataset.act, b.dataset.chain));
}

async function manageAction(act, chain) {
  if (act === 'create')    return openForm(chain, 'create');
  if (act === 'import')    return openForm(chain, 'import');
  if (act === 'addtoken')  return openAddToken(chain);
  if (act === 'key')       return openReveal(chain, 'key');
  if (act === 'mnemonic')  return openReveal(chain, 'mnemonic');
  if (act === 'remove') {
    if (!confirm(`Remove ${CHAINS[chain].name} wallet? Make sure you have your private key or recovery phrase backed up — this cannot be undone.`)) return;
    try {
      await deleteWallet(currentUser.uid, chain);
      delete wallets[chain];
      renderManage(); renderNetworkFilter(); refreshPortfolio();
      toast(`${CHAINS[chain].name} wallet removed`, 'info');
    } catch (e) { toast(e.message || 'Failed to remove', 'error'); }
  }
}

// ─── Create / Import form ───────────────────────────────────────────────────────
const CREATORS  = { ton: createTONWallet, base: createEvmWallet, bsc: createEvmWallet, eth: createEvmWallet, matic: createEvmWallet, sol: createSolWallet };
const IMPORTERS = { ton: importTONWallet, base: importEvmWallet, bsc: importEvmWallet, eth: importEvmWallet, matic: importEvmWallet, sol: importSolWallet };
const IMPORT_HINT = {
  ton: '24-word mnemonic or 64-char hex private key',
  sol: 'Base58 key, 128-char hex, or [1,2,…] JSON array',
  evm: '12/24-word recovery phrase or 0x… private key',
};

function openForm(chain, mode) {
  ctx.formChain = chain; ctx.formMode = mode;
  const cfg = CHAINS[chain];
  $('wltFormTitle').textContent = (mode === 'create' ? 'Create ' : 'Import ') + cfg.name + ' Wallet';
  const isImport = mode === 'import';
  $('wltFormImportWrap').style.display = isImport ? '' : 'none';
  $('wltFormInput').value = '';
  $('wltFormInput').placeholder = isImport ? (IMPORT_HINT[cfg.evm ? 'evm' : chain]) : '';
  $('wltFormHint').textContent = isImport
    ? 'Your key is encrypted with your wallet password before being stored.'
    : 'A new wallet will be generated and encrypted with your session password.' + (cfg.evm || chain === 'ton' ? ' Back up the recovery phrase shown next.' : '');
  $('wltFormSubmit').textContent = mode === 'create' ? 'Generate Wallet' : 'Import Wallet';
  showModal('wltFormModal');
}

function setupForm() {
  $('wltFormClose').onclick = () => hideModal('wltFormModal');
  $('wltFormSubmit').onclick = async () => {
    const chain = ctx.formChain, mode = ctx.formMode;
    if (!sessionPwd) return toast('Session locked — please unlock again', 'error');
    const btn = $('wltFormSubmit'); btn.disabled = true; btn.textContent = mode === 'create' ? 'Generating…' : 'Importing…';
    try {
      let wd;
      if (mode === 'create') wd = await Promise.resolve(CREATORS[chain]());
      else {
        const input = $('wltFormInput').value;
        if (!input.trim()) throw new Error('Enter your recovery phrase or private key');
        wd = await Promise.resolve(IMPORTERS[chain](input));
      }
      await saveWallet(currentUser.uid, chain, wd, sessionPwd);
      const fresh = await loadUserDoc(currentUser.uid);
      wallets = fresh.wallets || {};
      hideModal('wltFormModal');
      renderManage(); renderNetworkFilter(); refreshPortfolio();
      toast(`${CHAINS[chain].name} wallet ${mode === 'create' ? 'created' : 'imported'}!`, 'success');
      if (mode === 'create' && wd.mnemonic) showMnemonicModal(wd.mnemonic);
    } catch (e) { toast(e.message || 'Failed', 'error'); }
    finally { btn.disabled = false; btn.textContent = mode === 'create' ? 'Generate Wallet' : 'Import Wallet'; }
  };
}

// ─── Add token ──────────────────────────────────────────────────────────────────
function openAddToken(chain) {
  ctx.tokenChain = chain;
  $('wltTokenTitle').textContent = `Add ${CHAINS[chain].name} Token`;
  $('wltTokenInput').value = '';
  showModal('wltTokenModal');
}
function setupAddToken() {
  $('wltTokenClose').onclick = () => hideModal('wltTokenModal');
  $('wltTokenConfirm').onclick = async () => {
    const chain = ctx.tokenChain;
    const addr = $('wltTokenInput').value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return toast('Enter a valid contract address (0x…)', 'error');
    const btn = $('wltTokenConfirm'); btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const cfg = CHAINS[chain];
      const tokens = [...(wallets[chain]?.tokens || [])];
      if (tokens.some(t => t.address.toLowerCase() === addr.toLowerCase())) { toast('Token already added', 'info'); return; }
      const meta = await getEvmTokenMeta(addr, cfg.rpcs);
      tokens.push({ address: addr, symbol: meta.symbol, decimals: meta.decimals });
      await saveTokens(currentUser.uid, chain, tokens);
      wallets[chain].tokens = tokens;
      hideModal('wltTokenModal');
      renderManage(); refreshPortfolio();
      toast(`${meta.symbol} added!`, 'success');
    } catch (e) { toast(e.message || 'Failed to add token', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Add Token'; }
  };
}

// ─── Wire static UI ─────────────────────────────────────────────────────────────
function setupStaticUI() {
  $('wltSendBtn').onclick = () => {
    // Send from portfolio: default to first asset with balance, else first native
    const a = assets.find(x => x.balance) || assets[0];
    if (!a) return toast('Add a wallet first', 'info');
    openSend(a);
  };
  $('wltReceiveBtn').onclick = () => {
    const a = assets[0];
    if (!a) return toast('Add a wallet first', 'info');
    openReceive(a);
  };
  $('wltManageBtn').onclick = openManage;
  $('wltLockBtn').onclick   = lockWallet;
  $('wltRefreshBtn').onclick = refreshPortfolio;
  $('wltManageClose').onclick = () => hideModal('wltManageModal');
  $('wltManageAdd') && ($('wltManageAdd').onclick = renderManage);

  // Asset modal
  $('wltAssetClose').onclick = () => hideModal('wltAssetModal');
  $('wltAssetSend').onclick    = () => { hideModal('wltAssetModal'); openSend(ctx.asset); };
  $('wltAssetReceive').onclick = () => { hideModal('wltAssetModal'); openReceive(ctx.asset); };
  $('wltAssetKey').onclick      = () => openReveal(ctx.asset.chain, 'key');
  $('wltAssetMnemonic').onclick = () => openReveal(ctx.asset.chain, 'mnemonic');

  $('wltMnDone').onclick = () => hideModal('wltMnemonicModal');

  // Close modal on backdrop click
  document.querySelectorAll('.wlt-modal-bg').forEach(bg =>
    bg.addEventListener('click', e => { if (e.target === bg) bg.style.display = 'none'; }));
}

// ─── Side menu ────────────────────────────────────────────────────────────────
function setupMenu() {
  const menuBtn = $('menuBtn'), sideMenu = $('sideMenu'), closeBtn = $('closeMenuBtn'), overlay = $('menuOverlay');
  const open  = e => { e.stopPropagation(); sideMenu.classList.add('open'); overlay?.classList.add('visible'); };
  const close = ()  => { sideMenu.classList.remove('open'); overlay?.classList.remove('visible'); };
  menuBtn.addEventListener('click', open);
  menuBtn.addEventListener('touchstart', open);
  closeBtn.addEventListener('click', close);
  closeBtn.addEventListener('touchstart', close);
  overlay?.addEventListener('click', close);
  $('sideLogoutBtn').onclick = () => signOut(auth).then(() => { window.location.href = 'login.html'; });
}

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTonWeb();
  setupLockScreen();
  setupSend();
  setupReceive();
  setupReveal();
  setupForm();
  setupAddToken();
  setupStaticUI();
  setupMenu();

  requireAuth(async user => {
    currentUser = user;
    let initials = user.email[0].toUpperCase();
    $('profileInitials').textContent = initials;
    try {
      userDoc = await loadUserDoc(user.uid);
      wallets = userDoc.wallets || {};
      if (userDoc.firstName || userDoc.lastName) {
        const f = userDoc.firstName ? userDoc.firstName[0] : '';
        const l = userDoc.lastName ? userDoc.lastName[0] : '';
        $('profileInitials').textContent = (f + l).toUpperCase();
      }
    } catch { userDoc = {}; wallets = {}; }
    renderLockScreen();
  });
});

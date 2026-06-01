import { requireAuth } from './authObserver.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from './firebase.js';

// ─── RPC constants with fallback arrays ──────────────────────────────────────
const BASE_RPCS  = ['https://mainnet.base.org',               'https://base.publicnode.com'];
const BSC_RPCS   = ['https://bsc-dataseed.binance.org',       'https://bsc.publicnode.com'];
const ETH_RPCS   = ['https://cloudflare-eth.com',             'https://eth.llamarpc.com'];
const MATIC_RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'];
const SOL_RPC    = 'https://api.mainnet-beta.solana.com';
const TON_API    = 'https://toncenter.com/api/v2';

// EVM chain metadata (used by send + token helpers)
const CHAIN_CFG = {
  base:  { rpcs: BASE_RPCS,  symbol: 'ETH',   chainId: 8453, explorer: 'https://basescan.org/tx/' },
  bsc:   { rpcs: BSC_RPCS,   symbol: 'BNB',   chainId: 56,   explorer: 'https://bscscan.com/tx/' },
  eth:   { rpcs: ETH_RPCS,   symbol: 'ETH',   chainId: 1,    explorer: 'https://etherscan.io/tx/' },
  matic: { rpcs: MATIC_RPCS, symbol: 'MATIC', chainId: 137,  explorer: 'https://polygonscan.com/tx/' },
};

// ─── Web Crypto helpers ───────────────────────────────────────────────────────

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

// ─── Direct JSON-RPC helper ───────────────────────────────────────────────────
// Using raw fetch instead of library wrappers avoids timeout silences and lets
// us try multiple fallback endpoints without library overhead.

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

// Decode ABI-encoded string return value (for ERC-20 symbol/name)
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

// ─── TON helpers ─────────────────────────────────────────────────────────────

let tonweb = null;

function initTonWeb() {
  if (window.TonWeb) {
    tonweb = new TonWeb(new TonWeb.HttpProvider(`${TON_API}/jsonRPC`));
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '');
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.substr(i, 2), 16);
  return b;
}

let _tonMnLib = null;
async function getTonMnLib() {
  if (_tonMnLib) return _tonMnLib;
  try {
    _tonMnLib = await import('https://esm.sh/tonweb-mnemonic');
    return _tonMnLib;
  } catch {
    return null;
  }
}

async function createTONWallet() {
  if (!tonweb) throw new Error('TonWeb not loaded');
  const nacl    = TonWeb.utils.nacl;
  const seed    = crypto.getRandomValues(new Uint8Array(32));
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet  = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const addr    = await wallet.getAddress();
  return {
    address:    addr.toString(true, true, false),
    privateKey: bytesToHex(seed),
    publicKey:  bytesToHex(keyPair.publicKey),
    mnemonic:   null,
  };
}

async function importTONWallet(input) {
  if (!tonweb) throw new Error('TonWeb not loaded');
  const nacl    = TonWeb.utils.nacl;
  const trimmed = input.trim();
  let seed, mnemonic = null;

  if (trimmed.includes(' ')) {
    const words  = trimmed.split(/\s+/);
    if (words.length < 12) throw new Error('Invalid input. Enter a 24-word mnemonic or a hex private key.');
    const mnLib  = await getTonMnLib();
    if (!mnLib || !mnLib.mnemonicToKeyPair) throw new Error('Mnemonic library unavailable. Please use the hex private key instead.');
    const valid  = mnLib.mnemonicValidate ? await mnLib.mnemonicValidate(words).catch(() => true) : true;
    if (!valid) throw new Error('Invalid TON mnemonic phrase.');
    const kp     = await mnLib.mnemonicToKeyPair(words);
    seed         = kp.secretKey.slice(0, 32);
    mnemonic     = words.join(' ');
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
    address:    addr.toString(true, true, false),
    privateKey: bytesToHex(seed),
    publicKey:  bytesToHex(keyPair.publicKey),
    mnemonic,
  };
}

async function getTONBalance(address) {
  try {
    const res  = await fetch(`${TON_API}/getAddressBalance?address=${encodeURIComponent(address)}`);
    const data = await res.json();
    if (data.ok) {
      const tons = Number(BigInt(data.result)) / 1e9;
      return `${tons.toFixed(4)} TON`;
    }
    return '—';
  } catch { return '—'; }
}

async function sendTONNative(toAddress, amountTon, privKeyHex) {
  if (!tonweb) throw new Error('TonWeb not loaded');
  const nacl    = TonWeb.utils.nacl;
  const seed    = hexToBytes(privKeyHex.slice(0, 64));
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet  = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const seqno   = (await wallet.methods.seqno().call()) || 0;
  await wallet.methods.transfer({
    secretKey: keyPair.secretKey,
    toAddress,
    amount:   TonWeb.utils.toNano(String(amountTon)),
    seqno,
    sendMode: 3,
  }).send();
}

// ─── EVM helpers (BASE, BSC, ETH, MATIC share ethers v5) ─────────────────────

function getEthers() {
  const e = window.ethers;
  if (!e) throw new Error('ethers library failed to load. Please refresh the page and try again.');
  return e;
}

function _createEvmWallet() {
  const e = getEthers();
  const w = e.Wallet.createRandom();
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || null };
}

function _importEvmWallet(input) {
  const e = getEthers();
  const t = input.trim();
  let w;
  if (t.split(/\s+/).length > 1) {
    w = e.Wallet.fromMnemonic(t);
  } else {
    const key = t.startsWith('0x') ? t : '0x' + t;
    w = new e.Wallet(key);
  }
  return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || null };
}

// Direct JSON-RPC balance — no library overhead, survives rate-limited RPCs
async function _getEvmBalance(address, rpcs, symbol) {
  for (const rpc of rpcs) {
    try {
      const data = await _jsonRpc(rpc, 'eth_getBalance', [address, 'latest']);
      if (!data.result) continue;
      const wei = BigInt(data.result);
      return `${(Number(wei) / 1e18).toFixed(6)} ${symbol}`;
    } catch {}
  }
  return '—';
}

// BASE
function createBaseWallet()        { return _createEvmWallet(); }
function importBaseWallet(input)   { return _importEvmWallet(input); }
async function getBaseBalance(a)   { return _getEvmBalance(a, BASE_RPCS,  'ETH'); }

// BSC
function createBscWallet()         { return _createEvmWallet(); }
function importBscWallet(input)    { return _importEvmWallet(input); }
async function getBscBalance(a)    { return _getEvmBalance(a, BSC_RPCS,   'BNB'); }

// ETH
function createEthWallet()         { return _createEvmWallet(); }
function importEthWallet(input)    { return _importEvmWallet(input); }
async function getEthBalance(a)    { return _getEvmBalance(a, ETH_RPCS,   'ETH'); }

// MATIC (Polygon)
function createMaticWallet()       { return _createEvmWallet(); }
function importMaticWallet(input)  { return _importEvmWallet(input); }
async function getMaticBalance(a)  { return _getEvmBalance(a, MATIC_RPCS, 'MATIC'); }

// ─── ERC-20 token helpers ─────────────────────────────────────────────────────

// Fetch symbol and decimals from a contract via eth_call (no ABI library)
async function getEvmTokenMeta(contractAddr, rpcs) {
  let symbol = null, decimals = 18;
  for (const rpc of rpcs) {
    try {
      const [symResp, decResp] = await Promise.all([
        _jsonRpc(rpc, 'eth_call', [{ to: contractAddr, data: '0x95d89b41' }, 'latest']), // symbol()
        _jsonRpc(rpc, 'eth_call', [{ to: contractAddr, data: '0x313ce567' }, 'latest']), // decimals()
      ]);
      if (symResp.result && symResp.result.length > 2) {
        symbol = _decodeABIStr(symResp.result);
      }
      if (decResp.result && decResp.result !== '0x') {
        const d = Number(BigInt(decResp.result));
        if (d >= 0 && d <= 30) decimals = d;
      }
      if (symbol) break;
    } catch {}
  }
  return { symbol: symbol || '???', decimals };
}

// Fetch ERC-20 balance via balanceOf(address) eth_call
async function getEvmTokenBalance(walletAddr, contractAddr, rpcs) {
  const padded = walletAddr.replace(/^0x/, '').padStart(64, '0');
  const data   = '0x70a08231' + padded; // balanceOf(address)
  for (const rpc of rpcs) {
    try {
      const resp = await _jsonRpc(rpc, 'eth_call', [{ to: contractAddr, data }, 'latest']);
      if (!resp.result || resp.result === '0x') continue;
      return BigInt(resp.result);
    } catch {}
  }
  return null;
}

// ─── EVM send helpers ─────────────────────────────────────────────────────────

async function sendEvmNative(chain, to, amountEther, privKey) {
  const e   = getEthers();
  const cfg = CHAIN_CFG[chain];
  let lastErr;
  for (const rpc of cfg.rpcs) {
    try {
      const provider = new e.providers.JsonRpcProvider(rpc);
      const signer   = new e.Wallet(privKey, provider);
      const tx = await signer.sendTransaction({
        to,
        value:    e.utils.parseEther(String(amountEther)),
        gasLimit: 21000,
      });
      return tx;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Transaction failed on all endpoints');
}

async function sendEvmToken(chain, contractAddr, to, amount, decimals, privKey) {
  const e     = getEthers();
  const cfg   = CHAIN_CFG[chain];
  const iface = new e.utils.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
  const data  = iface.encodeFunctionData('transfer', [to, e.utils.parseUnits(String(amount), decimals)]);
  let lastErr;
  for (const rpc of cfg.rpcs) {
    try {
      const provider = new e.providers.JsonRpcProvider(rpc);
      const signer   = new e.Wallet(privKey, provider);
      const tx = await signer.sendTransaction({ to: contractAddr, data, gasLimit: 100000 });
      return tx;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Token transfer failed on all endpoints');
}

// ─── Solana helpers ───────────────────────────────────────────────────────────

// Base58 encode/decode — no external dependency
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
  for (const c of str) {
    const i = _B58.indexOf(c);
    if (i < 0) throw new Error('Invalid base58 character: ' + c);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  let lz = 0;
  for (const c of str) { if (c === '1') lz++; else break; }
  return new Uint8Array([...new Array(lz).fill(0), ...bytes]);
}

let _solWeb3 = null;
async function getSolWeb3() {
  if (_solWeb3) return _solWeb3;
  try {
    _solWeb3 = await import('https://esm.sh/@solana/web3.js@1.95.3');
    return _solWeb3;
  } catch {
    throw new Error('Solana library failed to load. Check your internet connection.');
  }
}

async function createSolWallet() {
  const { Keypair } = await getSolWeb3();
  const kp = Keypair.generate();
  return {
    address:    kp.publicKey.toBase58(),
    privateKey: b58enc(kp.secretKey),
    publicKey:  kp.publicKey.toBase58(),
    mnemonic:   null,
  };
}

async function importSolWallet(input) {
  const { Keypair } = await getSolWeb3();
  const trimmed = input.trim();
  let secretKey;

  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr) || arr.length !== 64) throw new Error('JSON array must contain exactly 64 bytes.');
    secretKey = Uint8Array.from(arr);
  } else if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    if (trimmed.length === 128) {
      secretKey = hexToBytes(trimmed);
    } else if (trimmed.length === 64) {
      const seed = hexToBytes(trimmed);
      const kp   = Keypair.fromSeed(seed);
      return { address: kp.publicKey.toBase58(), privateKey: b58enc(kp.secretKey), publicKey: kp.publicKey.toBase58(), mnemonic: null };
    } else {
      throw new Error('Hex key must be 64 chars (32-byte seed) or 128 chars (64-byte full key).');
    }
  } else {
    secretKey = b58dec(trimmed);
    if (secretKey.length !== 64) throw new Error('Base58 key must decode to 64 bytes.');
  }

  const kp = Keypair.fromSecretKey(secretKey);
  return {
    address:    kp.publicKey.toBase58(),
    privateKey: b58enc(kp.secretKey),
    publicKey:  kp.publicKey.toBase58(),
    mnemonic:   null,
  };
}

// Direct Solana JSON-RPC balance — no @solana/web3.js overhead for a read op
async function getSolBalance(address) {
  try {
    const data = await _jsonRpc(SOL_RPC, 'getBalance', [address, { commitment: 'confirmed' }]);
    if (data.result?.value == null) return '—';
    return `${(data.result.value / 1e9).toFixed(6)} SOL`;
  } catch { return '—'; }
}

// SOL native send (requires @solana/web3.js for signing)
async function sendSolNative(toAddress, amountSol, secretKeyBase58) {
  const { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await getSolWeb3();
  const secretKey = b58dec(secretKeyBase58);
  const fromKp    = Keypair.fromSecretKey(secretKey);
  const conn      = new Connection(SOL_RPC, 'confirmed');
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromKp.publicKey,
      toPubkey:   new PublicKey(toAddress),
      lamports:   Math.round(Number(amountSol) * LAMPORTS_PER_SOL),
    })
  );
  const sig = await conn.sendTransaction(tx, [fromKp]);
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

async function saveWallet(uid, chain, walletData, password) {
  const encPrivateKey = await encryptData(walletData.privateKey, password);
  const encMnemonic   = walletData.mnemonic ? await encryptData(walletData.mnemonic, password) : null;
  await setDoc(doc(db, 'users', uid), {
    wallets: {
      [chain]: {
        address:      walletData.address,
        publicKey:    walletData.publicKey || null,
        encPrivateKey,
        encMnemonic,
        createdAt:    Date.now(),
      }
    }
  }, { merge: true });
}

async function saveTokens(uid, chain, tokens) {
  await updateDoc(doc(db, 'users', uid), {
    [`wallets.${chain}.tokens`]: tokens,
  });
}

async function loadWallets(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data().wallets || {}) : {};
}

async function deleteWallet(uid, chain) {
  await updateDoc(doc(db, 'users', uid), { [`wallets.${chain}`]: deleteField() });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function show(id)  { const e = document.getElementById(id); if (e) e.style.display = ''; }
function hide(id)  { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
function only(ids, activeId) { ids.forEach(id => id === activeId ? show(id) : hide(id)); }

function truncAddr(a) {
  return a && a.length > 16 ? a.slice(0, 8) + '…' + a.slice(-6) : (a || '');
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

// ─── State ────────────────────────────────────────────────────────────────────

let currentUser = null;
let wallets     = {};
let revealChain = null;
let revealType  = null;
let sendChain   = null;
let sendType    = 'native'; // 'native' | 'token'

// ─── Panel ID sets ────────────────────────────────────────────────────────────

const TON_IDS   = ['tonLoading',   'tonNoWallet',   'tonCreateForm',   'tonImportForm',   'tonWallet'];
const BASE_IDS  = ['baseLoading',  'baseNoWallet',  'baseCreateForm',  'baseImportForm',  'baseWallet'];
const BSC_IDS   = ['bscLoading',   'bscNoWallet',   'bscCreateForm',   'bscImportForm',   'bscWallet'];
const ETH_IDS   = ['ethLoading',   'ethNoWallet',   'ethCreateForm',   'ethImportForm',   'ethWallet'];
const MATIC_IDS = ['maticLoading', 'maticNoWallet', 'maticCreateForm', 'maticImportForm', 'maticWallet'];
const SOL_IDS   = ['solLoading',   'solNoWallet',   'solCreateForm',   'solImportForm',   'solWallet'];

// ─── Render helpers ───────────────────────────────────────────────────────────

function _renderChain(chain, ids, balanceFn) {
  const data = wallets[chain] || null;
  if (!data) { only(ids, `${chain}NoWallet`); return; }
  const el = document.getElementById(`${chain}Address`);
  el.textContent = truncAddr(data.address);
  el.title       = data.address;
  document.getElementById(`${chain}Balance`).textContent = '—';
  only(ids, `${chain}Wallet`);
  balanceFn(data.address);
  // Render ERC-20 token list for EVM chains
  if (CHAIN_CFG[chain]) renderTokenList(chain);
}

function renderTON()   { _renderChain('ton',   TON_IDS,   fetchTONBal); }
function renderBase()  { _renderChain('base',  BASE_IDS,  fetchBaseBal); }
function renderBsc()   { _renderChain('bsc',   BSC_IDS,   fetchBscBal); }
function renderEth()   { _renderChain('eth',   ETH_IDS,   fetchEthBal); }
function renderMatic() { _renderChain('matic', MATIC_IDS, fetchMaticBal); }
function renderSol()   { _renderChain('sol',   SOL_IDS,   fetchSolBal); }

async function fetchTONBal(address) {
  document.getElementById('tonBalance').textContent = '...';
  document.getElementById('tonBalance').textContent = await getTONBalance(address);
}
async function fetchBaseBal(address) {
  document.getElementById('baseBalance').textContent = '...';
  document.getElementById('baseBalance').textContent = await getBaseBalance(address);
}
async function fetchBscBal(address) {
  document.getElementById('bscBalance').textContent = '...';
  document.getElementById('bscBalance').textContent = await getBscBalance(address);
}
async function fetchEthBal(address) {
  document.getElementById('ethBalance').textContent = '...';
  document.getElementById('ethBalance').textContent = await getEthBalance(address);
}
async function fetchMaticBal(address) {
  document.getElementById('maticBalance').textContent = '...';
  document.getElementById('maticBalance').textContent = await getMaticBalance(address);
}
async function fetchSolBal(address) {
  document.getElementById('solBalance').textContent = '...';
  document.getElementById('solBalance').textContent = await getSolBalance(address);
}

// ─── Token list renderer (EVM chains only) ────────────────────────────────────

async function renderTokenList(chain) {
  const cfg       = CHAIN_CFG[chain];
  if (!cfg) return;
  const container = document.getElementById(`${chain}TokenList`);
  if (!container) return;
  const data   = wallets[chain];
  const tokens = data?.tokens || [];
  const addr   = data?.address;
  if (!addr) { container.innerHTML = ''; return; }

  if (tokens.length === 0) {
    container.innerHTML = '<p class="wlt-token-empty">No tokens added yet.</p>';
    return;
  }

  container.innerHTML = '<p class="wlt-token-loading">Fetching token balances…</p>';

  const rows = await Promise.all(tokens.map(async (tok, idx) => {
    let balStr = '—';
    try {
      const raw = await getEvmTokenBalance(addr, tok.address, cfg.rpcs);
      if (raw !== null) {
        const dec = tok.decimals ?? 18;
        balStr = (Number(raw) / Math.pow(10, dec)).toFixed(4);
      }
    } catch {}
    return `
      <div class="wlt-token-row">
        <div class="wlt-token-info">
          <span class="wlt-token-sym">${escHtml(tok.symbol)}</span>
          <span class="wlt-token-bal">${balStr}</span>
        </div>
        <div class="wlt-token-actions">
          <button class="wlt-pill wlt-pill-send"
            onclick="window._wltSendToken('${chain}', ${idx})">Send</button>
          <button class="wlt-pill wlt-pill-danger"
            onclick="window._wltRemoveToken('${chain}', ${idx})" title="Remove">✕</button>
        </div>
      </div>`;
  }));

  container.innerHTML = rows.join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Global helpers called by inline onclick in renderTokenList rows
window._wltSendToken = function(chain, tokIdx) {
  const tok = wallets[chain]?.tokens?.[tokIdx];
  if (!tok) return;
  openSend(chain, 'token', tok);
};

window._wltRemoveToken = async function(chain, tokIdx) {
  if (!confirm('Remove this token from your list?')) return;
  const tokens = [...(wallets[chain]?.tokens || [])];
  tokens.splice(tokIdx, 1);
  try {
    await saveTokens(currentUser.uid, chain, tokens);
    wallets[chain].tokens = tokens;
    renderTokenList(chain);
    toast('Token removed', 'info');
  } catch (e) { toast(e.message || 'Failed to remove token', 'error'); }
};

// ─── Generic chain setup factory ──────────────────────────────────────────────

function setupChain(chain, ids, createFn, importFn) {
  const C = chain.toUpperCase();

  document.getElementById(`${chain}CreateBtn`).onclick = () => only(ids, `${chain}CreateForm`);
  document.getElementById(`${chain}ImportBtn`).onclick = () => only(ids, `${chain}ImportForm`);
  document.getElementById(`${chain}CancelCreate`).onclick = () => only(ids, `${chain}NoWallet`);
  document.getElementById(`${chain}CancelImport`).onclick = () => only(ids, `${chain}NoWallet`);

  document.getElementById(`${chain}DoCreate`).onclick = async () => {
    const pwd = document.getElementById(`${chain}CreatePwd`).value;
    const cfm = document.getElementById(`${chain}CreatePwdConfirm`).value;
    if (pwd.length < 6) return toast('Password must be at least 6 characters', 'error');
    if (pwd !== cfm)    return toast('Passwords do not match', 'error');
    const btn = document.getElementById(`${chain}DoCreate`);
    btn.disabled = true; btn.textContent = 'Generating…';
    try {
      const wd = await Promise.resolve(createFn());
      await saveWallet(currentUser.uid, chain, wd, pwd);
      wallets[chain] = (await loadWallets(currentUser.uid))[chain];
      renderAll();
      toast(`${C} wallet created!`, 'success');
      if (wd.mnemonic) showMnemonicModal(wd.mnemonic);
    } catch (e) { toast(e.message, 'error'); }
    finally {
      btn.disabled = false; btn.textContent = 'Generate Wallet';
      document.getElementById(`${chain}CreatePwd`).value = '';
      document.getElementById(`${chain}CreatePwdConfirm`).value = '';
    }
  };

  document.getElementById(`${chain}DoImport`).onclick = async () => {
    const input = document.getElementById(`${chain}ImportInput`).value;
    const pwd   = document.getElementById(`${chain}ImportPwd`).value;
    if (!input.trim())  return toast('Enter mnemonic or private key', 'error');
    if (pwd.length < 6) return toast('Password must be at least 6 characters', 'error');
    const btn = document.getElementById(`${chain}DoImport`);
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const wd = await Promise.resolve(importFn(input));
      await saveWallet(currentUser.uid, chain, wd, pwd);
      wallets[chain] = (await loadWallets(currentUser.uid))[chain];
      renderAll();
      toast(`${C} wallet imported!`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally {
      btn.disabled = false; btn.textContent = 'Import';
      document.getElementById(`${chain}ImportInput`).value = '';
      document.getElementById(`${chain}ImportPwd`).value   = '';
    }
  };

  document.getElementById(`${chain}CopyAddr`).onclick = () => {
    navigator.clipboard.writeText(wallets[chain]?.address || '').then(() => toast('Address copied!', 'success'));
  };

  const refreshFn = { ton: fetchTONBal, base: fetchBaseBal, bsc: fetchBscBal, eth: fetchEthBal, matic: fetchMaticBal, sol: fetchSolBal }[chain];
  document.getElementById(`${chain}Refresh`).onclick = () => wallets[chain] && refreshFn(wallets[chain].address);
  document.getElementById(`${chain}ShowKey`).onclick  = () => openReveal(chain, 'key');

  const mnemonicBtn = document.getElementById(`${chain}ShowMnemonic`);
  if (mnemonicBtn) mnemonicBtn.onclick = () => openReveal(chain, 'mnemonic');

  document.getElementById(`${chain}Remove`).onclick = async () => {
    if (!confirm(`Remove ${C} wallet? Make sure you have a backup.`)) return;
    await deleteWallet(currentUser.uid, chain);
    wallets[chain] = null;
    renderAll();
    toast(`${C} wallet removed`, 'info');
  };

  // Send / Receive
  const sendBtn = document.getElementById(`${chain}Send`);
  if (sendBtn) sendBtn.onclick = () => wallets[chain] && openSend(chain, 'native');

  const receiveBtn = document.getElementById(`${chain}Receive`);
  if (receiveBtn) receiveBtn.onclick = () => wallets[chain] && openReceive(chain);

  // Add-token form (EVM chains only)
  const addTokenBtn = document.getElementById(`${chain}AddToken`);
  if (addTokenBtn) {
    addTokenBtn.onclick = () => {
      const form = document.getElementById(`${chain}TokenAddForm`);
      if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
    };
  }

  const tokenConfirmBtn = document.getElementById(`${chain}TokenAddConfirm`);
  if (tokenConfirmBtn) {
    tokenConfirmBtn.onclick = async () => {
      const addr = document.getElementById(`${chain}TokenContract`)?.value?.trim();
      if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        return toast('Enter a valid ERC-20 contract address (0x…)', 'error');
      }
      tokenConfirmBtn.disabled = true; tokenConfirmBtn.textContent = 'Adding…';
      try {
        const cfg    = CHAIN_CFG[chain];
        const meta   = await getEvmTokenMeta(addr, cfg.rpcs);
        const tokens = [...(wallets[chain]?.tokens || [])];
        if (tokens.some(t => t.address.toLowerCase() === addr.toLowerCase())) {
          toast('Token already in list', 'info');
          return;
        }
        tokens.push({ address: addr, symbol: meta.symbol, decimals: meta.decimals });
        await saveTokens(currentUser.uid, chain, tokens);
        wallets[chain].tokens = tokens;
        document.getElementById(`${chain}TokenContract`).value = '';
        document.getElementById(`${chain}TokenAddForm`).style.display = 'none';
        renderTokenList(chain);
        toast(`${meta.symbol} added!`, 'success');
      } catch (e) { toast(e.message || 'Failed to add token', 'error'); }
      finally { tokenConfirmBtn.disabled = false; tokenConfirmBtn.textContent = 'Add Token'; }
    };
  }

  const tokenCancelBtn = document.getElementById(`${chain}TokenAddCancel`);
  if (tokenCancelBtn) {
    tokenCancelBtn.onclick = () => {
      const form = document.getElementById(`${chain}TokenAddForm`);
      if (form) form.style.display = 'none';
      const inp = document.getElementById(`${chain}TokenContract`);
      if (inp) inp.value = '';
    };
  }
}

function renderAll() {
  renderTON();
  renderBase();
  renderBsc();
  renderEth();
  renderMatic();
  renderSol();
}

// ─── Reveal modal ─────────────────────────────────────────────────────────────

function openReveal(chain, type) {
  const data = wallets[chain];
  if (!data) return;
  if (type === 'mnemonic' && !data.encMnemonic) return toast('No mnemonic stored for this wallet', 'info');
  revealChain = chain;
  revealType  = type;
  const label = type === 'key' ? 'Private Key' : 'Mnemonic Phrase';
  document.getElementById('revealTitle').textContent = `${label} — ${chain.toUpperCase()}`;
  document.getElementById('revealPwd').value    = '';
  document.getElementById('revealResult').style.display = 'none';
  document.getElementById('revealContent').textContent  = '';
  document.getElementById('revealModal').style.display  = 'flex';
}

function setupRevealModal() {
  document.getElementById('revealClose').onclick = () => {
    document.getElementById('revealModal').style.display = 'none';
    document.getElementById('revealPwd').value = '';
    document.getElementById('revealResult').style.display = 'none';
  };

  document.getElementById('revealConfirm').onclick = async () => {
    const pwd = document.getElementById('revealPwd').value;
    if (!pwd) return toast('Enter your wallet password', 'error');
    const btn = document.getElementById('revealConfirm');
    btn.disabled = true; btn.textContent = 'Decrypting…';
    try {
      const data   = wallets[revealChain];
      const encObj = revealType === 'mnemonic' ? data.encMnemonic : data.encPrivateKey;
      const plain  = await decryptData(encObj, pwd);
      document.getElementById('revealContent').textContent   = plain;
      document.getElementById('revealResult').style.display  = '';
    } catch { toast('Wrong password', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Reveal'; }
  };

  document.getElementById('revealCopy').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('revealContent').textContent)
      .then(() => toast('Copied!', 'success'));
  };
}

// ─── Send modal ───────────────────────────────────────────────────────────────

function openSend(chain, type = 'native', tok = null) {
  sendChain = chain;
  sendType  = type;
  const isEvm = !!CHAIN_CFG[chain];
  const sym   = chain === 'ton' ? 'TON' : chain === 'sol' ? 'SOL' : CHAIN_CFG[chain]?.symbol || '';

  document.getElementById('sendModalTitle').textContent = `Send — ${chain.toUpperCase()}`;
  document.getElementById('sendSymbol').textContent     = tok ? tok.symbol : sym;
  document.getElementById('sendTo').value     = '';
  document.getElementById('sendAmount').value = '';
  document.getElementById('sendPwd').value    = '';
  document.getElementById('sendStatus').style.display = 'none';
  document.getElementById('sendStatus').textContent   = '';

  const typeRow     = document.getElementById('sendTypeRow');
  const contractRow = document.getElementById('sendContractRow');
  if (isEvm) {
    typeRow.style.display = '';
    document.getElementById('sendTypeNative').classList.toggle('active', type !== 'token');
    document.getElementById('sendTypeToken').classList.toggle('active', type === 'token');
    contractRow.style.display = type === 'token' ? '' : 'none';
    if (tok) document.getElementById('sendContract').value = tok.address;
  } else {
    typeRow.style.display     = 'none';
    contractRow.style.display = 'none';
  }

  document.getElementById('sendModal').style.display = 'flex';
}

function setupSendModal() {
  document.getElementById('sendClose').onclick = () => {
    document.getElementById('sendModal').style.display = 'none';
  };

  document.getElementById('sendTypeNative').onclick = () => {
    sendType = 'native';
    document.getElementById('sendTypeNative').classList.add('active');
    document.getElementById('sendTypeToken').classList.remove('active');
    document.getElementById('sendContractRow').style.display = 'none';
    document.getElementById('sendSymbol').textContent = CHAIN_CFG[sendChain]?.symbol || '';
  };

  document.getElementById('sendTypeToken').onclick = () => {
    sendType = 'token';
    document.getElementById('sendTypeToken').classList.add('active');
    document.getElementById('sendTypeNative').classList.remove('active');
    document.getElementById('sendContractRow').style.display = '';
    document.getElementById('sendSymbol').textContent = 'TOKEN';
  };

  document.getElementById('sendConfirm').onclick = async () => {
    const to     = document.getElementById('sendTo').value.trim();
    const amount = document.getElementById('sendAmount').value.trim();
    const pwd    = document.getElementById('sendPwd').value;
    const status = document.getElementById('sendStatus');

    if (!to)                                        return toast('Enter recipient address', 'error');
    if (!amount || isNaN(+amount) || +amount <= 0)  return toast('Enter a valid amount', 'error');
    if (!pwd)                                        return toast('Enter your wallet password', 'error');

    const btn = document.getElementById('sendConfirm');
    btn.disabled = true; btn.textContent = 'Sending…';
    status.style.display = '';
    status.className     = 'wlt-send-status';
    status.textContent   = 'Decrypting key…';

    try {
      const data    = wallets[sendChain];
      const privKey = await decryptData(data.encPrivateKey, pwd);

      status.textContent = 'Broadcasting transaction…';
      let txHash = '';

      if (sendChain === 'sol') {
        txHash = await sendSolNative(to, +amount, privKey);
      } else if (sendChain === 'ton') {
        await sendTONNative(to, +amount, privKey);
        txHash = '(submitted)';
      } else if (sendType === 'token') {
        const contract = document.getElementById('sendContract').value.trim();
        if (!contract || !/^0x[0-9a-fA-F]{40}$/.test(contract)) {
          throw new Error('Enter a valid token contract address (0x…)');
        }
        const storedTok = (data.tokens || []).find(t => t.address.toLowerCase() === contract.toLowerCase());
        const decimals  = storedTok?.decimals ?? (await getEvmTokenMeta(contract, CHAIN_CFG[sendChain].rpcs)).decimals;
        const tx = await sendEvmToken(sendChain, contract, to, +amount, decimals, privKey);
        txHash = tx.hash;
      } else {
        const tx = await sendEvmNative(sendChain, to, +amount, privKey);
        txHash = tx.hash;
      }

      status.className = 'wlt-send-status wlt-send-ok';
      const explorerBase = CHAIN_CFG[sendChain]?.explorer;
      if (explorerBase && txHash && txHash !== '(submitted)') {
        status.innerHTML = `Sent! <a href="${explorerBase}${txHash}" target="_blank" rel="noopener" class="wlt-tx-link">View Tx ↗</a>`;
      } else {
        status.textContent = 'Transaction submitted successfully.';
      }

      // Refresh balance after a short delay
      setTimeout(() => {
        const addr    = wallets[sendChain]?.address;
        const fetchFn = { ton: fetchTONBal, base: fetchBaseBal, bsc: fetchBscBal, eth: fetchEthBal, matic: fetchMaticBal, sol: fetchSolBal }[sendChain];
        if (addr && fetchFn) fetchFn(addr);
      }, 5000);
    } catch (e) {
      status.className   = 'wlt-send-status wlt-send-err';
      status.textContent = e.message || 'Transaction failed';
    } finally {
      btn.disabled = false; btn.textContent = 'Send';
    }
  };
}

// ─── Receive modal ────────────────────────────────────────────────────────────

function openReceive(chain) {
  const addr = wallets[chain]?.address;
  if (!addr) return;
  document.getElementById('receiveModalTitle').textContent = `Receive — ${chain.toUpperCase()}`;
  document.getElementById('receiveAddress').textContent    = addr;
  document.getElementById('receiveModal').style.display    = 'flex';
}

function setupReceiveModal() {
  document.getElementById('receiveClose').onclick = () => {
    document.getElementById('receiveModal').style.display = 'none';
  };
  document.getElementById('receiveCopyAddr').onclick = () => {
    const addr = document.getElementById('receiveAddress').textContent;
    navigator.clipboard.writeText(addr).then(() => toast('Address copied!', 'success'));
  };
}

// ─── Mnemonic backup modal ────────────────────────────────────────────────────

function showMnemonicModal(mnemonic) {
  const words = mnemonic.split(' ');
  document.getElementById('mnemonicGrid').innerHTML = words.map((w, i) =>
    `<div class="wlt-mn-word"><span class="wlt-mn-num">${i + 1}</span><span class="wlt-mn-text">${w}</span></div>`
  ).join('');
  document.getElementById('mnemonicModal').style.display = 'flex';
}

function setupMnemonicModal() {
  document.getElementById('mnemonicDone').onclick = () => {
    document.getElementById('mnemonicModal').style.display = 'none';
  };
}

// ─── Chain tabs ───────────────────────────────────────────────────────────────

const ALL_PANELS = ['ton', 'base', 'bsc', 'eth', 'matic', 'sol'];

function setupChainTabs() {
  document.querySelectorAll('.wlt-chain-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wlt-chain-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const chain = btn.dataset.chain;
      ALL_PANELS.forEach(c => {
        const p = document.getElementById(`panel${c.charAt(0).toUpperCase() + c.slice(1)}`);
        if (p) p.style.display = c === chain ? '' : 'none';
      });
    });
  });
}

// ─── Menu setup ───────────────────────────────────────────────────────────────

function setupMenu() {
  const menuBtn  = document.getElementById('menuBtn');
  const sideMenu = document.getElementById('sideMenu');
  const closeBtn = document.getElementById('closeMenuBtn');
  const overlay  = document.getElementById('menuOverlay');
  const open  = e => { e.stopPropagation(); sideMenu.classList.add('open'); overlay?.classList.add('visible'); };
  const close = ()  => { sideMenu.classList.remove('open'); overlay?.classList.remove('visible'); };
  menuBtn.addEventListener('click',      open);
  menuBtn.addEventListener('touchstart', open);
  closeBtn.addEventListener('click',      close);
  closeBtn.addEventListener('touchstart', close);
  overlay?.addEventListener('click',      close);
  document.getElementById('sideLogoutBtn').onclick = () =>
    signOut(auth).then(() => { window.location.href = 'login.html'; });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTonWeb();
  setupChainTabs();

  setupChain('ton',   TON_IDS,   createTONWallet,   importTONWallet);
  setupChain('base',  BASE_IDS,  createBaseWallet,  importBaseWallet);
  setupChain('bsc',   BSC_IDS,   createBscWallet,   importBscWallet);
  setupChain('eth',   ETH_IDS,   createEthWallet,   importEthWallet);
  setupChain('matic', MATIC_IDS, createMaticWallet, importMaticWallet);
  setupChain('sol',   SOL_IDS,   createSolWallet,   importSolWallet);

  setupRevealModal();
  setupMnemonicModal();
  setupSendModal();
  setupReceiveModal();
  setupMenu();

  requireAuth(async user => {
    currentUser = user;

    let initials = user.email[0].toUpperCase();
    document.getElementById('profileInitials').textContent = initials;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        if (d.firstName || d.lastName) {
          const f = d.firstName ? d.firstName[0] : '';
          const l = d.lastName  ? d.lastName[0]  : '';
          document.getElementById('profileInitials').textContent = (f + l).toUpperCase();
        }
      }
    } catch {}

    try { wallets = await loadWallets(user.uid); } catch { wallets = {}; }
    renderAll();
  });
});

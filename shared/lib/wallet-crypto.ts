// @ts-nocheck
/* eslint-disable */
// Framework-agnostic wallet engine ported verbatim from the legacy wallet.js.
// EVM via ethers v5 (window.ethers), Solana via @solana/web3.js (dynamic import),
// TON via TonWeb (window.TonWeb). AES-GCM encryption with PBKDF2.

declare global { interface Window { ethers: any; TonWeb: any; } }

export const BASE_RPCS  = ['https://mainnet.base.org', 'https://base.publicnode.com', 'https://base-rpc.publicnode.com'];
export const BSC_RPCS   = ['https://bsc-dataseed.binance.org', 'https://bsc.publicnode.com', 'https://bsc-rpc.publicnode.com'];
// Note: eth.llamarpc.com is intentionally excluded — its batched JSON-RPC
// responses break ethers v5 network auto-detection ("could not detect network"),
// which used to surface during bridge/send. Static-network providers (below)
// avoid detection, but the endpoint is still flaky, so we keep it out.
export const ETH_RPCS   = ['https://cloudflare-eth.com', 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'];
export const MATIC_RPCS = ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'];
// Robinhood Chain (Arbitrum Orbit L2, mainnet 2026-07-01). Chain id 4663, ETH
// gas. The public RPC is rate-limited but fine for wallet reads/sends.
export const RHOOD_RPCS = ['https://rpc.mainnet.chain.robinhood.com'];
export const SOL_RPCS    = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];
export const SOL_RPC    = SOL_RPCS[0]; // primary endpoint (used for sending/confirming)
export const TON_API    = 'https://toncenter.com/api/v2';

export const CHAIN_CFG: any = {
  base:  { rpcs: BASE_RPCS,  symbol: 'ETH',   chainId: 8453, explorer: 'https://basescan.org/tx/' },
  bsc:   { rpcs: BSC_RPCS,   symbol: 'BNB',   chainId: 56,   explorer: 'https://bscscan.com/tx/' },
  eth:   { rpcs: ETH_RPCS,   symbol: 'ETH',   chainId: 1,    explorer: 'https://etherscan.io/tx/' },
  matic: { rpcs: MATIC_RPCS, symbol: 'MATIC', chainId: 137,  explorer: 'https://polygonscan.com/tx/' },
  rhood: { rpcs: RHOOD_RPCS, symbol: 'ETH',   chainId: 4663, explorer: 'https://robinhoodchain.blockscout.com/tx/' }
};

// ── Web Crypto ──
function b64enc(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64dec(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

// OWASP-recommended floor for PBKDF2-HMAC-SHA256 (2023). New blobs store their
// iteration count in `it`; legacy blobs without it were written at 100k and must
// keep decrypting at 100k — so we never break existing encrypted wallets.
const PBKDF2_ITERATIONS = 600000;
const LEGACY_PBKDF2_ITERATIONS = 100000;

export async function encryptData(plaintext, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { d: b64enc(ct), i: b64enc(iv), s: b64enc(salt), it: PBKDF2_ITERATIONS };
}
export async function decryptData(enc, password) {
  const te = new TextEncoder();
  const iterations = enc.it || LEGACY_PBKDF2_ITERATIONS;
  const km = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64dec(enc.s), iterations, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(enc.i) }, key, b64dec(enc.d));
  return new TextDecoder().decode(pt);
}

// ── JSON-RPC ──
async function _jsonRpc(url, method, params, timeout = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctrl.signal });
    return await res.json();
  } finally { clearTimeout(t); }
}

// Race every RPC endpoint concurrently and resolve with the first VALID result.
// This avoids the long sequential failover (up to `timeout` per dead endpoint),
// which is the main cause of slow balance loads. Returns `undefined` if all fail.
async function _raceRpc(rpcs, method, params, opts: any = {}) {
  const timeout = opts.timeout ?? 7000;
  const valid = opts.valid || ((r: any) => r !== undefined && r !== null);
  const attempts = rpcs.map(async (url: string) => {
    const data = await _jsonRpc(url, method, params, timeout);
    if (data && data.error == null && valid(data.result)) return data.result;
    throw new Error('rpc invalid');
  });
  try { return await Promise.any(attempts); } catch { return undefined; }
}
// ── RPC proxy for browser-unreachable chains ──
// Robinhood Chain's public RPC sends CORS headers but is not reachable from many
// browsers/ISPs (network-path/Cloudflare block → "Failed to fetch"), so its
// JSON-RPC is proxied through a Cloud Function the app registers here. Only
// already-signed raw transactions and read calls are ever forwarded — private
// keys sign locally and never leave the device.
const PROXIED_CHAINS = new Set(['rhood']);
let _rpcProxy: any = null;
export function setRpcProxy(fn) { _rpcProxy = fn; } // async (chain, method, params) => full JSON-RPC body

// One JSON-RPC read for a chain: proxied when the chain requires it and a proxy
// is registered, otherwise raced across the chain's public RPCs — and when ALL
// direct RPCs fail (some ISPs block browser TLS to every public RPC host), the
// proxy is tried as a last resort on any chain. Returns the `.result` (or
// undefined on failure), matching _raceRpc.
async function chainRpc(chain, method, params, opts: any = {}) {
  const valid = opts.valid || ((r: any) => r !== undefined && r !== null);
  const viaProxy = async () => {
    if (!_rpcProxy) return undefined;
    try {
      const body = await _rpcProxy(chain, method, params);
      if (body && body.error == null && valid(body.result)) return body.result;
    } catch {}
    return undefined;
  };
  if (PROXIED_CHAINS.has(chain)) return viaProxy();
  const cfg = CHAIN_CFG[chain];
  const direct = await _raceRpc(cfg ? cfg.rpcs : [], method, params, opts);
  if (direct !== undefined) return direct;
  return viaProxy(); // direct RPCs unreachable from this browser — heal via server
}

function _decodeABIStr(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length < 128) return null;
  const len = parseInt(h.slice(64, 128), 16);
  if (!len || len > 256) return null;
  let s = '';
  for (let i = 128; i < 128 + len * 2; i += 2) { const c = parseInt(h.slice(i, i + 2), 16); if (c > 0 && c < 128) s += String.fromCharCode(c); }
  return s || null;
}

// ── TON ──
let tonweb: any = null;
export function initTonWeb() { if (typeof window !== 'undefined' && window.TonWeb) tonweb = new window.TonWeb(new window.TonWeb.HttpProvider(`${TON_API}/jsonRPC`)); }
function bytesToHex(bytes) { return Array.from(bytes).map((b: any) => b.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(hex) { const h = hex.replace(/^0x/, ''); const b = new Uint8Array(h.length / 2); for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.substr(i, 2), 16); return b; }
let _tonMnLib = null;
async function getTonMnLib() { if (_tonMnLib) return _tonMnLib; try { _tonMnLib = await import(/* webpackIgnore: true */ 'https://esm.sh/tonweb-mnemonic@1.0.1'); return _tonMnLib; } catch { return null; } }

export async function createTONWallet() {
  if (!tonweb) throw new Error('TonWeb not loaded');
  const nacl = window.TonWeb.utils.nacl;
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const addr = await wallet.getAddress();
  return { address: addr.toString(true, true, false), privateKey: bytesToHex(seed), publicKey: bytesToHex(keyPair.publicKey), mnemonic: null };
}
export async function importTONWallet(input) {
  if (!tonweb) throw new Error('TonWeb not loaded');
  const nacl = window.TonWeb.utils.nacl;
  const trimmed = input.trim();
  let seed, mnemonic = null;
  if (trimmed.includes(' ')) {
    const words = trimmed.split(/\s+/);
    if (words.length < 12) throw new Error('Invalid input. Enter a 24-word mnemonic or a hex private key.');
    const mnLib: any = await getTonMnLib();
    if (!mnLib || !mnLib.mnemonicToKeyPair) throw new Error('Mnemonic library unavailable. Please use the hex private key instead.');
    const valid = mnLib.mnemonicValidate ? await mnLib.mnemonicValidate(words).catch(() => true) : true;
    if (!valid) throw new Error('Invalid TON mnemonic phrase.');
    const kp = await mnLib.mnemonicToKeyPair(words);
    seed = kp.secretKey.slice(0, 32); mnemonic = words.join(' ');
  } else {
    const raw = hexToBytes(trimmed);
    if (raw.length === 64) seed = raw.slice(0, 32); else if (raw.length === 32) seed = raw; else throw new Error('Private key must be 32 or 64 hex bytes');
  }
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const addr = await wallet.getAddress();
  return { address: addr.toString(true, true, false), privateKey: bytesToHex(seed), publicKey: bytesToHex(keyPair.publicKey), mnemonic };
}
export async function getTONBalance(address) {
  try { const res = await fetch(`${TON_API}/getAddressBalance?address=${encodeURIComponent(address)}`); const data = await res.json(); if (data.ok) return `${(Number(BigInt(data.result)) / 1e9).toFixed(4)} TON`; return '—'; } catch { return '—'; }
}
export async function sendTONNative(toAddress, amountTon, privKeyHex) {
  if (!tonweb) throw new Error('TonWeb not loaded');
  const nacl = window.TonWeb.utils.nacl;
  const seed = hexToBytes(privKeyHex.slice(0, 64));
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  const wallet = tonweb.wallet.create({ publicKey: keyPair.publicKey });
  const seqno = (await wallet.methods.seqno().call()) || 0;
  await wallet.methods.transfer({ secretKey: keyPair.secretKey, toAddress, amount: window.TonWeb.utils.toNano(String(amountTon)), seqno, sendMode: 3 }).send();
}

// ── EVM ──
function getEthers() { const e = typeof window !== 'undefined' && window.ethers; if (!e) throw new Error('ethers library failed to load. Please refresh and try again.'); return e; }
export function createEvmWallet() { const e = getEthers(); const w = e.Wallet.createRandom(); return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || null }; }
export function importEvmWallet(input) { const e = getEthers(); const t = input.trim(); let w; if (t.split(/\s+/).length > 1) w = e.Wallet.fromMnemonic(t); else { const key = t.startsWith('0x') ? t : '0x' + t; w = new e.Wallet(key); } return { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase || null }; }
export async function getEvmBalance(address, chain) {
  const cfg = CHAIN_CFG[chain];
  const result = await chainRpc(chain, 'eth_getBalance', [address, 'latest']);
  if (result == null) return '—';
  return `${(Number(BigInt(result)) / 1e18).toFixed(6)} ${cfg.symbol}`;
}
export async function getEvmTokenMeta(contractAddr, rpcs) {
  const [symResult, decResult] = await Promise.all([
    _raceRpc(rpcs, 'eth_call', [{ to: contractAddr, data: '0x95d89b41' }, 'latest'], { valid: (r: any) => r && r.length > 2 }),
    _raceRpc(rpcs, 'eth_call', [{ to: contractAddr, data: '0x313ce567' }, 'latest'], { valid: (r: any) => r && r !== '0x' })
  ]);
  let symbol = symResult ? _decodeABIStr(symResult) : null;
  let decimals = 18;
  if (decResult) { try { const d = Number(BigInt(decResult)); if (d >= 0 && d <= 30) decimals = d; } catch {} }
  return { symbol: symbol || '???', decimals };
}
export async function getEvmTokenBalance(walletAddr, contractAddr, rpcs) {
  const padded = walletAddr.replace(/^0x/, '').padStart(64, '0');
  const data = '0x70a08231' + padded;
  const result = await _raceRpc(rpcs, 'eth_call', [{ to: contractAddr, data }, 'latest'], { valid: (r: any) => r && r !== '0x' });
  return result == null ? null : BigInt(result);
}
// Probe all endpoints in parallel and return them ordered fastest-live-first,
// so a send signs against a responsive node instead of stalling on a dead one.
async function _orderEvmRpcsByHealth(rpcs: string[]): Promise<string[]> {
  const healthy: string[] = [];
  await Promise.all(rpcs.map(async (rpc) => {
    try { const d = await _jsonRpc(rpc, 'eth_blockNumber', [], 5000); if (d && d.result) healthy.push(rpc); } catch {}
  }));
  // Preserve discovery order (fastest responders pushed first); append any unprobed as fallback.
  return [...healthy, ...rpcs.filter((r) => !healthy.includes(r))];
}
// Build a provider with an EXPLICIT static network so ethers v5 never performs
// its `eth_chainId` auto-detection — that probe is what threw "could not detect
// network" on flaky endpoints (llamarpc) and on chains ethers doesn't know
// (Robinhood, 4663). Mirrors the server-side makeProvider().
function evmStaticProvider(rpc, chainId) {
  const e = getEthers();
  return new e.providers.StaticJsonRpcProvider({ url: rpc, timeout: 20000 }, { chainId, name: 'chain-' + chainId });
}

// Sign a tx locally and broadcast it through the RPC proxy — used for chains
// the browser can never reach (Robinhood) AND as the fallback when an ISP
// blocks the browser's path to a chain's public RPCs entirely. No provider is
// attached to the signer — nonce/gas/broadcast all go through the proxy.
// Returns a tx-like object with .hash and a best-effort .wait().
async function sendViaProxy(chain, txReq, privKey) {
  const e = getEthers(); const cfg = CHAIN_CFG[chain];
  const label = (chainMeta(chain) || { label: String(chain).toUpperCase() }).label;
  const wallet = new e.Wallet(privKey);
  const from = wallet.address;
  const [nonceHex, gasHex] = await Promise.all([
    chainRpc(chain, 'eth_getTransactionCount', [from, 'pending']),
    chainRpc(chain, 'eth_gasPrice', []),
  ]);
  if (nonceHex == null || gasHex == null) throw new Error('Could not reach the ' + label + ' network — try again in a moment.');
  let gasLimit = txReq.gasLimit ? e.BigNumber.from(txReq.gasLimit) : null;
  if (!gasLimit) {
    const est = await chainRpc(chain, 'eth_estimateGas', [{ from, to: txReq.to, value: txReq.value ? e.BigNumber.from(txReq.value).toHexString() : undefined, data: txReq.data || '0x' }]).catch(() => null);
    gasLimit = est ? e.BigNumber.from(est).mul(12).div(10) : e.BigNumber.from(txReq.data && txReq.data !== '0x' ? 120000 : 21000);
  }
  const tx = { to: txReq.to, value: txReq.value || 0, data: txReq.data || '0x', nonce: parseInt(nonceHex, 16), gasPrice: e.BigNumber.from(gasHex), gasLimit, chainId: cfg.chainId };
  const raw = await wallet.signTransaction(tx);
  const body = await _rpcProxy(chain, 'eth_sendRawTransaction', [raw]);
  if (!body || body.error || !body.result) throw new Error((body && body.error && body.error.message) || ('Broadcast failed on ' + label + '.'));
  const hash = body.result;
  return { hash, wait: async () => { for (let i = 0; i < 30; i++) { const r = await chainRpc(chain, 'eth_getTransactionReceipt', [hash]); if (r) return r; await new Promise((res) => setTimeout(res, 4000)); } return null; } };
}

export async function sendEvmNative(chain, to, amountEther, privKey) {
  const e = getEthers(); const cfg = CHAIN_CFG[chain];
  const value = e.utils.parseEther(String(amountEther));
  if (PROXIED_CHAINS.has(chain) && _rpcProxy) return sendViaProxy(chain, { to, value }, privKey);
  let lastErr;
  const rpcs = await _orderEvmRpcsByHealth(cfg.rpcs);
  for (const rpc of rpcs) { try { const provider = evmStaticProvider(rpc, cfg.chainId); const signer = new e.Wallet(privKey, provider); return await signer.sendTransaction({ to, value, gasLimit: 21000 }); } catch (err) { lastErr = err; } }
  // Every direct RPC failed — some ISPs block browser TLS to public RPC hosts.
  // Sign locally and broadcast through the server proxy instead.
  if (_rpcProxy) { try { return await sendViaProxy(chain, { to, value }, privKey); } catch (err) { lastErr = err; } }
  throw lastErr || new Error('Transaction failed on all endpoints');
}
export async function sendEvmToken(chain, contractAddr, to, amount, decimals, privKey) {
  const e = getEthers(); const cfg = CHAIN_CFG[chain];
  const iface = new e.utils.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
  const data = iface.encodeFunctionData('transfer', [to, e.utils.parseUnits(String(amount), decimals)]);
  if (PROXIED_CHAINS.has(chain) && _rpcProxy) return sendViaProxy(chain, { to: contractAddr, data }, privKey);
  let lastErr;
  const rpcs = await _orderEvmRpcsByHealth(cfg.rpcs);
  for (const rpc of rpcs) { try { const provider = evmStaticProvider(rpc, cfg.chainId); const signer = new e.Wallet(privKey, provider); return await signer.sendTransaction({ to: contractAddr, data, gasLimit: 100000 }); } catch (err) { lastErr = err; } }
  if (_rpcProxy) { try { return await sendViaProxy(chain, { to: contractAddr, data }, privKey); } catch (err) { lastErr = err; } }
  throw lastErr || new Error('Token transfer failed on all endpoints');
}

// ── Bridge (Relay) — move native funds from an EVM chain onto Robinhood Chain ──
// Relay (relay.link) officially supports Robinhood Chain (4663) and quotes are
// keyless. Flow: quote → user reviews receive-amount/fees/ETA → execute signs
// the returned origin-chain transaction(s) with the local key. Deposits only;
// withdrawals (7-day challenge path) stay on the official portal.
const RELAY_API = 'https://api.relay.link';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Normalize a raw Relay /quote response into the shape the bridge UI shows.
// Shared by the server-proxied path (preferred — some ISPs break browser TLS
// to api.relay.link) and the direct-fetch fallback below.
export function normalizeRelayQuote(body, outSymbol, amountNative) {
  const steps = ((body && body.steps) || []).filter((s) => s.kind === 'transaction' && Array.isArray(s.items) && s.items.length);
  if (!steps.length) throw new Error('Bridge route unavailable for this amount right now');
  const d = (body && body.details) || {};
  return {
    steps,
    amountIn: d.currencyIn?.amountFormatted || String(amountNative),
    amountInUsd: d.currencyIn?.amountUsd || null,
    amountOut: d.currencyOut?.amountFormatted || null,
    amountOutUsd: d.currencyOut?.amountUsd || null,
    outSymbol,
    timeEstimateSec: d.timeEstimate != null ? +d.timeEstimate : null,
    totalImpactUsd: d.totalImpact?.usd || null,
    requestId: (steps[0] && steps[0].requestId) || (body && body.requestId) || null,
  };
}

export async function relayBridgeQuote({ fromChain, toChain = 'rhood', amountNative, address }) {
  const from = CHAIN_CFG[fromChain]; const to = CHAIN_CFG[toChain];
  if (!from) throw new Error('Bridging from ' + String(fromChain).toUpperCase() + ' is not supported');
  if (!to) throw new Error('Unknown destination chain');
  const e = getEthers();
  const amount = e.utils.parseEther(String(amountNative)).toString();
  const res = await fetch(`${RELAY_API}/quote`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: address, recipient: address,
      originChainId: from.chainId, destinationChainId: to.chainId,
      originCurrency: ZERO_ADDR, destinationCurrency: ZERO_ADDR,
      amount, tradeType: 'EXACT_INPUT',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || 'Bridge quote failed (' + res.status + ')');
  return normalizeRelayQuote(body, to.symbol, amountNative);
}

// Sign & broadcast the quote's origin-chain transaction(s). Returns the last
// origin tx hash; Relay fills on the destination side (usually seconds).
export async function relayBridgeExecute({ fromChain, quote, privKey }) {
  const e = getEthers(); const cfg = CHAIN_CFG[fromChain];
  if (!cfg) throw new Error('Unsupported source chain');
  const rpcs = await _orderEvmRpcsByHealth(cfg.rpcs);
  let lastHash = null;
  for (const step of quote.steps) {
    for (const item of step.items) {
      const t = item.data || {};
      if (t.chainId && +t.chainId !== cfg.chainId) throw new Error('Bridge step targets an unexpected chain — aborting');
      let lastErr;
      let sent = null;
      for (const rpc of rpcs) {
        try {
          // Static network → no ethers auto-detect (the "could not detect
          // network" source).
          const provider = evmStaticProvider(rpc, cfg.chainId);
          const signer = new e.Wallet(privKey, provider);
          sent = await signer.sendTransaction({ to: t.to, data: t.data || '0x', value: t.value ? e.BigNumber.from(t.value) : 0 });
          await sent.wait(1);
          break;
        } catch (err) { lastErr = err; }
      }
      if (!sent && _rpcProxy) {
        // Every direct RPC failed from this browser (some ISPs block browser
        // TLS to public RPC hosts wholesale). Sign locally, broadcast through
        // the server proxy — keys never leave the device.
        try {
          const px = await sendViaProxy(fromChain, { to: t.to, data: t.data || '0x', value: t.value ? e.BigNumber.from(t.value) : 0 }, privKey);
          await px.wait();
          sent = px;
        } catch (err) { lastErr = err; }
      }
      if (!sent) throw lastErr || new Error('Bridge transaction failed on all endpoints');
      lastHash = sent.hash;
    }
  }
  return { txHash: lastHash };
}

// ── Solana ──
const _B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(bytes) { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = _B58[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b !== 0) break; s = '1' + s; } return s; }
function b58dec(str) { let n = 0n; for (const c of str) { const i = _B58.indexOf(c); if (i < 0) throw new Error('Invalid base58 character: ' + c); n = n * 58n + BigInt(i); } const bytes = []; while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; } let lz = 0; for (const c of str) { if (c === '1') lz++; else break; } return new Uint8Array([...new Array(lz).fill(0), ...bytes]); }
let _solWeb3 = null;
async function getSolWeb3() { if (_solWeb3) return _solWeb3; try { _solWeb3 = await import(/* webpackIgnore: true */ 'https://esm.sh/@solana/web3.js@1.95.3'); return _solWeb3; } catch { throw new Error('Solana library failed to load. Check your connection.'); } }
export async function createSolWallet() { const { Keypair }: any = await getSolWeb3(); const kp = Keypair.generate(); return { address: kp.publicKey.toBase58(), privateKey: b58enc(kp.secretKey), publicKey: kp.publicKey.toBase58(), mnemonic: null }; }
export async function importSolWallet(input) {
  const { Keypair }: any = await getSolWeb3(); const trimmed = input.trim(); let secretKey;
  if (trimmed.startsWith('[')) { const arr = JSON.parse(trimmed); if (!Array.isArray(arr) || arr.length !== 64) throw new Error('JSON array must contain exactly 64 bytes.'); secretKey = Uint8Array.from(arr); }
  else if (/^[0-9a-fA-F]+$/.test(trimmed)) { if (trimmed.length === 128) secretKey = hexToBytes(trimmed); else if (trimmed.length === 64) { const kp = Keypair.fromSeed(hexToBytes(trimmed)); return { address: kp.publicKey.toBase58(), privateKey: b58enc(kp.secretKey), publicKey: kp.publicKey.toBase58(), mnemonic: null }; } else throw new Error('Hex key must be 64 or 128 chars.'); }
  else { secretKey = b58dec(trimmed); if (secretKey.length !== 64) throw new Error('Base58 key must decode to 64 bytes.'); }
  const kp = Keypair.fromSecretKey(secretKey);
  return { address: kp.publicKey.toBase58(), privateKey: b58enc(kp.secretKey), publicKey: kp.publicKey.toBase58(), mnemonic: null };
}
export async function getSolBalance(address) {
  const value = await _raceRpc(SOL_RPCS, 'getBalance', [address, { commitment: 'confirmed' }], { valid: (r: any) => r && r.value != null });
  if (value == null) return '—';
  return `${(value.value / 1e9).toFixed(6)} SOL`;
}
export async function sendSolNative(toAddress, amountSol, secretKeyBase58) {
  const { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL }: any = await getSolWeb3();
  const fromKp = Keypair.fromSecretKey(b58dec(secretKeyBase58));
  const lamports = Math.round(Number(amountSol) * LAMPORTS_PER_SOL);
  let lastErr;
  // Try each endpoint in turn — a fresh blockhash+tx is built per attempt, so a
  // failed (never-broadcast) attempt can safely be retried on the next node.
  for (const rpc of SOL_RPCS) {
    try {
      const conn = new Connection(rpc, 'confirmed');
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: fromKp.publicKey, toPubkey: new PublicKey(toAddress), lamports }));
      const sig = await conn.sendTransaction(tx, [fromKp]);
      await conn.confirmTransaction(sig, 'confirmed');
      return sig;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Solana transaction failed on all endpoints');
}

// ── Chain registry for the UI ──
const NATIVE_LOGO: Record<string, string> = {
  ton:   'https://assets.coingecko.com/coins/images/17980/large/ton_symbol.png',
  eth:   'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
  bnb:   'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  matic: 'https://assets.coingecko.com/coins/images/4713/large/polygon.png',
  sol:   'https://assets.coingecko.com/coins/images/4128/large/solana.png'
};
export interface ChainMeta {
  key: string; label: string; symbol: string; evm: boolean;
  coingeckoId: string; cgPlatform: string | null; dexId: string | null;
  explorer: string; txExplorer: string; addrExplorer: string;
  blockscout: string | null; twSlug: string; logo: string; color: string;
}
export const CHAINS: ChainMeta[] = [
  { key: 'eth',   label: 'Ethereum', symbol: 'ETH',   evm: true,  coingeckoId: 'ethereum',         cgPlatform: 'ethereum',           dexId: 'ethereum', explorer: 'https://etherscan.io',   txExplorer: 'https://etherscan.io/tx/',   addrExplorer: 'https://etherscan.io/address/',   blockscout: 'https://eth.blockscout.com',     twSlug: 'ethereum',   logo: NATIVE_LOGO.eth,   color: '#627EEA' },
  { key: 'bsc',   label: 'BNB Chain',symbol: 'BNB',   evm: true,  coingeckoId: 'binancecoin',      cgPlatform: 'binance-smart-chain', dexId: 'bsc',      explorer: 'https://bscscan.com',    txExplorer: 'https://bscscan.com/tx/',    addrExplorer: 'https://bscscan.com/address/',    blockscout: 'https://bnb.blockscout.com',     twSlug: 'smartchain', logo: NATIVE_LOGO.bnb,   color: '#F0B90B' },
  { key: 'sol',   label: 'Solana',   symbol: 'SOL',   evm: false, coingeckoId: 'solana',           cgPlatform: null,                 dexId: 'solana',   explorer: 'https://solscan.io',     txExplorer: 'https://solscan.io/tx/',     addrExplorer: 'https://solscan.io/account/',     blockscout: null,                             twSlug: 'solana',     logo: NATIVE_LOGO.sol,   color: '#9945FF' },
  { key: 'base',  label: 'Base',     symbol: 'ETH',   evm: true,  coingeckoId: 'ethereum',         cgPlatform: 'base',               dexId: 'base',     explorer: 'https://basescan.org',   txExplorer: 'https://basescan.org/tx/',   addrExplorer: 'https://basescan.org/address/',   blockscout: 'https://base.blockscout.com',    twSlug: 'base',       logo: NATIVE_LOGO.eth,   color: '#0052FF' },
  { key: 'matic', label: 'Polygon',  symbol: 'MATIC', evm: true,  coingeckoId: 'matic-network',    cgPlatform: 'polygon-pos',        dexId: 'polygon',  explorer: 'https://polygonscan.com',txExplorer: 'https://polygonscan.com/tx/',addrExplorer: 'https://polygonscan.com/address/',blockscout: 'https://polygon.blockscout.com', twSlug: 'polygon',    logo: NATIVE_LOGO.matic, color: '#8247E5' },
  // Robinhood Chain — Arbitrum Orbit L2 (chain id 4663, ETH gas), mainnet
  // 2026-07-01. DexScreener slug 'robinhood', CoinGecko platform 'robinhood'.
  { key: 'rhood', label: 'Robinhood', symbol: 'ETH',  evm: true,  coingeckoId: 'ethereum',         cgPlatform: 'robinhood',          dexId: 'robinhood', explorer: 'https://robinhoodchain.blockscout.com', txExplorer: 'https://robinhoodchain.blockscout.com/tx/', addrExplorer: 'https://robinhoodchain.blockscout.com/address/', blockscout: 'https://robinhoodchain.blockscout.com', twSlug: '', logo: NATIVE_LOGO.eth, color: '#C3F53C' },
  { key: 'ton',   label: 'TON',      symbol: 'TON',   evm: false, coingeckoId: 'the-open-network', cgPlatform: null,                 dexId: 'ton',      explorer: 'https://tonscan.org',    txExplorer: 'https://tonscan.org/tx/',    addrExplorer: 'https://tonscan.org/address/',    blockscout: null,                             twSlug: 'ton',        logo: NATIVE_LOGO.ton,   color: '#0098EA' }
];
export const chainMeta = (key: string) => CHAINS.find((c) => c.key === key);

// Validate a recipient address for the given chain before signing a transfer.
// Crypto sends are irreversible, so reject anything malformed up front.
export function isValidAddress(chain: string, address: string): boolean {
  const a = (address || '').trim();
  if (!a) return false;
  try {
    if (chain === 'sol') { const d = b58dec(a); return d.length === 32; }
    if (chain === 'ton') {
      const TW = typeof window !== 'undefined' && window.TonWeb;
      if (TW?.utils?.Address?.isValid) return TW.utils.Address.isValid(a);
      return /^[A-Za-z0-9_-]{48}$/.test(a); // user-friendly TON address fallback
    }
    // EVM
    const e = typeof window !== 'undefined' && window.ethers;
    if (e?.utils?.isAddress) return e.utils.isAddress(a);
    return /^0x[0-9a-fA-F]{40}$/.test(a);
  } catch { return false; }
}

// TrustWallet token logo (with checksum address), null-safe
export function tokenLogoUrl(chain: string, contract: string): string | null {
  const cfg = chainMeta(chain);
  if (!cfg?.twSlug || !contract) return null;
  let addr = contract;
  try { addr = window.ethers?.utils.getAddress(contract) || contract; } catch {}
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${cfg.twSlug}/assets/${addr}/logo.png`;
}

// ── Transaction history ──
export async function getEvmTxs(chain: string, address: string) {
  const cfg = chainMeta(chain);
  if (!cfg?.blockscout) return null;
  try {
    const res = await fetch(`${cfg.blockscout}/api/v2/addresses/${address}/transactions?filter=`, { headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    const lower = address.toLowerCase();
    return (data.items || []).slice(0, 12).map((it: any) => {
      const from = (it.from?.hash || '').toLowerCase();
      const incoming = from !== lower;
      return { hash: it.hash, incoming, value: Number(it.value || 0) / 1e18, symbol: cfg.symbol, ts: it.timestamp ? Date.parse(it.timestamp) : 0, counterparty: incoming ? it.from?.hash : it.to?.hash, err: false };
    });
  } catch { return []; }
}
export async function getSolTxs(address: string) {
  const result = await _raceRpc(SOL_RPCS, 'getSignaturesForAddress', [address, { limit: 12 }], { valid: (r: any) => Array.isArray(r) });
  if (!Array.isArray(result)) return [];
  return result.map((s: any) => ({ hash: s.signature, incoming: null, value: null, symbol: 'SOL', ts: (s.blockTime || 0) * 1000, counterparty: '', err: !!s.err }));
}
export async function getTonTxs(address: string) {
  try {
    const res = await fetch(`${TON_API}/getTransactions?address=${encodeURIComponent(address)}&limit=12`);
    const data = await res.json();
    if (!data.ok) return [];
    return data.result.map((tx: any) => {
      const inMsg = tx.in_msg, out = (tx.out_msgs || [])[0];
      const incoming = inMsg && inMsg.source && !out;
      const valNano = incoming ? Number(inMsg.value || 0) : Number(out?.value || 0);
      return { hash: tx.transaction_id?.hash || '', incoming, value: valNano / 1e9, symbol: 'TON', ts: (tx.utime || 0) * 1000, counterparty: incoming ? inMsg.source : out?.destination || '', err: false };
    });
  } catch { return []; }
}
export function getTxs(chain: string, address: string) {
  if (chain === 'ton') return getTonTxs(address);
  if (chain === 'sol') return getSolTxs(address);
  return getEvmTxs(chain, address);
}

// ── Token prices via CoinGecko (platform contract prices) ──
export async function fetchTokenPrices(platform: string, addrs: string[]) {
  if (!addrs.length || !platform) return {};
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${addrs.join(',')}&vs_currencies=usd&include_24hr_change=true`);
    const d = await r.json();
    const out: Record<string, any> = {};
    for (const a in d) out[a.toLowerCase()] = { usd: d[a].usd, change: d[a].usd_24h_change };
    return out;
  } catch { return {}; }
}

// ── Wallet password verification (single-password lock) ──
export const AUTH_PLAINTEXT = 'FXCRYPT_UNLOCK_OK';
export async function buildAuthCheck(password: string) { return encryptData(AUTH_PLAINTEXT, password); }
export async function verifyAuthCheck(check: any, password: string) {
  try { return (await decryptData(check, password)) === AUTH_PLAINTEXT; } catch { return false; }
}

export function createWallet(chain) {
  if (chain === 'ton') return createTONWallet();
  if (chain === 'sol') return createSolWallet();
  return Promise.resolve(createEvmWallet());
}
export function importWallet(chain, input) {
  if (chain === 'ton') return importTONWallet(input);
  if (chain === 'sol') return importSolWallet(input);
  return Promise.resolve(importEvmWallet(input));
}
export function getBalance(chain, address) {
  if (chain === 'ton') return getTONBalance(address);
  if (chain === 'sol') return getSolBalance(address);
  return getEvmBalance(address, chain);
}

// ── Numeric native balances (for portfolio valuation) ──
export async function getEvmBalanceNum(address: string, chain: string): Promise<number> {
  const result = await chainRpc(chain, 'eth_getBalance', [address, 'latest']);
  return result != null ? Number(BigInt(result)) / 1e18 : 0;
}
export async function getSolBalanceNum(address: string): Promise<number> {
  const value = await _raceRpc(SOL_RPCS, 'getBalance', [address, { commitment: 'confirmed' }], { valid: (r: any) => r && r.value != null });
  return value != null ? (value.value || 0) / 1e9 : 0;
}
export async function getTonBalanceNum(address: string): Promise<number> {
  try { const r = await fetch(`${TON_API}/getAddressBalance?address=${encodeURIComponent(address)}`); const d = await r.json(); return d.ok ? Number(BigInt(d.result)) / 1e9 : 0; } catch { return 0; }
}
export function getBalanceNum(chain: string, address: string): Promise<number> {
  if (chain === 'ton') return getTonBalanceNum(address);
  if (chain === 'sol') return getSolBalanceNum(address);
  return getEvmBalanceNum(address, chain);
}
export async function getTokenBalanceNum(chain: string, walletAddr: string, contract: string, decimals: number): Promise<number> {
  if (chain === 'sol') return getSplTokenBalanceNum(walletAddr, contract);
  const cfg = CHAIN_CFG[chain];
  if (!cfg) return 0; // non-EVM chains without custom-token support
  const padded = walletAddr.replace(/^0x/, '').padStart(64, '0');
  const raw = await chainRpc(chain, 'eth_call', [{ to: contract, data: '0x70a08231' + padded }, 'latest'], { valid: (r: any) => r && r !== '0x' });
  return raw != null ? Number(BigInt(raw)) / Math.pow(10, decimals) : 0;
}

// ── Solana SPL token support (metadata + balance) ──
// decimals come from on-chain supply (authoritative); symbol is best-effort from
// the Jupiter token list, so the user can still add a token that isn't listed.
export async function getSplTokenMeta(mint: string): Promise<{ symbol: string; decimals: number }> {
  let decimals = 0;
  const supply = await _raceRpc(SOL_RPCS, 'getTokenSupply', [mint], { valid: (r: any) => r && r.value && r.value.decimals != null });
  if (supply && supply.value && supply.value.decimals != null) decimals = Number(supply.value.decimals) || 0;
  if (!supply) throw new Error('Not a valid SPL token mint on Solana');
  let symbol: string | null = null;
  try {
    // Symbol only — on-chain getTokenSupply above is the authoritative source
    // for decimals; never let an external list override it.
    const r = await fetch(`https://tokens.jup.ag/token/${mint}`);
    if (r.ok) { const d = await r.json(); if (d && d.symbol) symbol = String(d.symbol).slice(0, 12); }
  } catch { /* offline / unlisted — user provides the symbol */ }
  return { symbol: symbol || '', decimals };
}
export async function getSplTokenBalanceNum(owner: string, mint: string): Promise<number> {
  const res = await _raceRpc(SOL_RPCS, 'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }], { valid: (r: any) => r && Array.isArray(r.value) });
  if (!res || !Array.isArray(res.value)) return 0;
  let total = 0;
  for (const acc of res.value) { const amt = acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount; if (typeof amt === 'number') total += amt; }
  return total;
}

// Resolve a token contract/mint to { symbol, decimals } for the add-token flow.
export async function getTokenMeta(chain: string, address: string): Promise<{ symbol: string; decimals: number }> {
  if (chain === 'sol') return getSplTokenMeta(address);
  const cfg = CHAIN_CFG[chain];
  if (!cfg) throw new Error('Custom tokens are not supported on ' + chain.toUpperCase() + ' yet');
  const meta = await getEvmTokenMeta(address, cfg.rpcs);
  if (!meta || meta.symbol === '???') { /* keep — user can still confirm */ }
  return { symbol: meta.symbol === '???' ? '' : meta.symbol, decimals: meta.decimals };
}

export const send = {
  evmNative: sendEvmNative, evmToken: sendEvmToken, sol: sendSolNative, ton: sendTONNative
};

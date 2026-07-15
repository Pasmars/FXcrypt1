// fx-wallet.js — self-custody wallet engine for the mobile app.
//
// Ports the legacy wallet.js backend into the SPA: client-side AES-GCM
// encryption (keys never leave the device), Firestore persistence of the
// encrypted blobs, a single session password, and real create/import/send/
// reveal across EVM / Solana / TON. Settings the legacy app never had
// (token visibility, address book, connected apps) get new Firestore-backed
// persistence here.
//
// Data model — users/{uid}:
//   wallets.{chain}   = { address, encPrivateKey, encMnemonic, tokens: [] }
//   walletAuth.check  = AES-GCM blob of 'FXCRYPT_UNLOCK_OK'   (password proof)
//   walletSettings    = { hiddenChains: [], hiddenTokens: [], hideSmall: bool }
//   contacts          = [{ id, name, address, chain }]
//   connectedApps     = [{ id, name, url, chain, perm }]
//
// Everything reactive emits 'fx:update' (the shell already re-renders on it).

import { db, auth, fns } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import {
  encryptData, decryptData, buildAuthCheck, verifyAuthCheck,
  createWallet, importWallet, getBalanceNum, getTokenBalanceNum,
  getTxs, fetchTokenPrices, chainMeta, isValidAddress, send as sendImpl,
  initTonWeb, CHAINS, getTokenMeta, relayBridgeQuote, relayBridgeExecute, normalizeRelayQuote,
  setRpcProxy,
} from './wallet-crypto';

// Route JSON-RPC for browser-unreachable chains (Robinhood) through the
// rpcProxy Cloud Function. Registered once at module load, before any balance
// read fires. Keys stay local — only reads and already-signed raw txs go over.
try {
  setRpcProxy((chain, method, params) =>
    httpsCallable(fns, 'rpcProxy')({ chain, method, params }).then((r) => r.data));
} catch (e) { /* proxy stays disabled → direct RPC (fine for non-proxied chains) */ }

// Chains where custom tokens are supported today (EVM read/send + Solana read).
const TOKEN_CHAINS = ['eth', 'bsc', 'base', 'matic', 'rhood', 'sol'];
// Unified EVM wallet: one key/address across every EVM network. Creating or
// importing an EVM wallet provisions the SAME account on all of these chains
// (order = primary preference when picking the source entry to unify from).
const EVM_CHAINS = ['eth', 'base', 'bsc', 'matic', 'rhood'];
const isEvmChain = (c) => EVM_CHAINS.includes(c);
// EVM contract addresses are case-insensitive (store lowercased); Solana mints
// are base58 and case-sensitive (store verbatim). Used for dedupe + lookups.
const normTokenAddr = (chain, a) => (chain === 'sol' ? String(a || '').trim() : String(a || '').trim().toLowerCase());
const MIN_PW_LEN = 8;

const CG = 'https://api.coingecko.com/api/v3';

// ── In-memory session state (never persisted) ──
let sessionPwd = null;             // master password held for the session
let userDoc = {};                  // last-loaded users/{uid} snapshot
let wallets = {};                  // chain -> { address, encPrivateKey, encMnemonic, tokens }
let settings = { hiddenChains: [], hiddenTokens: [], hideSmall: false };
let contacts = [];
let connectedApps = [];
let holdings = [];                 // computed portfolio rows
let portfolioTotal = 0;
let loaded = false;

function emit() { try { window.dispatchEvent(new CustomEvent('fx:update')); } catch (e) {} }
function uid() { return auth.currentUser && auth.currentUser.uid; }

// ── External libs (ethers v5 UMD + TonWeb) loaded on demand ──
let _libsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(el);
  });
}
// Solana web3 is dynamically imported inside wallet-crypto from esm.sh, so only
// ethers + TonWeb need a global <script>. Idempotent.
function ensureLibs() {
  if (_libsPromise) return _libsPromise;
  _libsPromise = (async () => {
    const jobs = [];
    if (!window.ethers) jobs.push(loadScript('https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.umd.min.js'));
    if (!window.TonWeb) jobs.push(loadScript('https://unpkg.com/tonweb@0.0.66/dist/tonweb.js'));
    await Promise.all(jobs);
    try { if (window.TonWeb) initTonWeb(); } catch (e) {}
  })();
  return _libsPromise;
}

// ── Load / persist ──
async function load() {
  const id = uid();
  if (!id) { loaded = false; return; }
  try {
    const snap = await getDoc(doc(db, 'users', id));
    userDoc = snap.exists() ? snap.data() : {};
  } catch (e) { userDoc = {}; }
  wallets = userDoc.wallets || {};
  const s = userDoc.walletSettings || {};
  settings = { hiddenChains: s.hiddenChains || [], hiddenTokens: s.hiddenTokens || [], hideSmall: !!s.hideSmall };
  contacts = Array.isArray(userDoc.contacts) ? userDoc.contacts : [];
  connectedApps = Array.isArray(userDoc.connectedApps) ? userDoc.connectedApps : [];
  loaded = true;
  emit();
  // One-time unification for accounts created before the unified EVM wallet,
  // then refresh the portfolio in the background (balances are slow).
  syncEvmWallets().catch(() => {}).then(() => refreshPortfolio());
}

// ── Unified EVM address migration ──
// If the user has an EVM wallet on some chains but not others, copy its entry
// to the missing EVM chains: the encrypted blobs are copied verbatim (the same
// key/address is valid on every EVM network), so no password is needed and
// chains that already hold their own key are never touched. Runs once per
// account (walletSettings.evmSynced) so a chain the user later removes on
// purpose stays removed.
async function syncEvmWallets() {
  const id = uid(); if (!id) return;
  if (userDoc.walletSettings && userDoc.walletSettings.evmSynced) return;
  const primary = EVM_CHAINS.find((c) => wallets[c] && wallets[c].address && wallets[c].encPrivateKey);
  if (!primary) return; // no EVM wallet yet — persistWallet unifies on first create/import
  const src = wallets[primary];
  const missing = EVM_CHAINS.filter((c) => !wallets[c]);
  const patch = {}; const next = { ...wallets };
  for (const c of missing) {
    const entry = { address: src.address, encPrivateKey: src.encPrivateKey, encMnemonic: src.encMnemonic || null, tokens: [] };
    patch[c] = entry; next[c] = entry;
  }
  try {
    await setDoc(doc(db, 'users', id), {
      ...(missing.length ? { wallets: patch } : {}),
      walletSettings: { evmSynced: true },
    }, { merge: true });
    userDoc.walletSettings = { ...(userDoc.walletSettings || {}), evmSynced: true };
    if (missing.length) { wallets = next; emit(); }
  } catch (e) { /* offline — retried on next load */ }
}

// ── Lock state ──
function hasAnyWallet() { return Object.keys(wallets).length > 0; }
function isProtected() { return !!(userDoc.walletAuth && userDoc.walletAuth.check) || hasAnyWallet(); }
function isLocked() { return isProtected() && !sessionPwd; }

function lock() { sessionPwd = null; emit(); }

// Verify a password against the stored auth-check (or, for legacy docs without
// one, against the first wallet's encrypted key) and adopt it for the session.
async function unlock(password) {
  if (!password) throw new Error('Enter your wallet password');
  const check = userDoc.walletAuth && userDoc.walletAuth.check;
  if (check) {
    if (!(await verifyAuthCheck(check, password))) throw new Error('Wrong password');
  } else if (hasAnyWallet()) {
    const first = wallets[Object.keys(wallets)[0]];
    try { await decryptData(first.encPrivateKey, password); }
    catch { throw new Error('Wrong password'); }
    await setAuthCheck(password); // adopt going forward
  }
  sessionPwd = password;
  emit();
  return true;
}

// First-time password (no wallets yet): just establish the auth-check.
async function setInitialPassword(password) {
  if (!password || password.length < MIN_PW_LEN) throw new Error('Use at least ' + MIN_PW_LEN + ' characters');
  await setAuthCheck(password);
  sessionPwd = password;
  emit();
  return true;
}

async function setAuthCheck(password) {
  const id = uid(); if (!id) throw new Error('Sign in required');
  const check = await buildAuthCheck(password);
  await setDoc(doc(db, 'users', id), { walletAuth: { check } }, { merge: true });
  userDoc.walletAuth = { check };
}

// ── Create / import / delete ──
async function persistWallet(chain, wd, password) {
  const id = uid(); if (!id) throw new Error('Sign in required');
  const encPrivateKey = await encryptData(wd.privateKey, password);
  const encMnemonic = wd.mnemonic ? await encryptData(wd.mnemonic, password) : null;
  // Unified EVM address: an EVM wallet is written to the requested chain AND
  // every other EVM chain that has no wallet yet — the same key controls the
  // same address on all of them. Chains that already hold a (possibly
  // different) key are never overwritten, so no funds can be orphaned.
  const targets = isEvmChain(chain)
    ? [chain, ...EVM_CHAINS.filter((c) => c !== chain && !wallets[c])]
    : [chain];
  const patch = {}; const next = { ...wallets };
  for (const c of targets) {
    const entry = { address: wd.address, encPrivateKey, encMnemonic, tokens: (wallets[c] && wallets[c].tokens) || [] };
    patch[c] = entry; next[c] = entry;
  }
  await setDoc(doc(db, 'users', id), { wallets: patch }, { merge: true });
  wallets = next;
  if (!sessionPwd) sessionPwd = password;
  emit();
}

async function createAndSave(chain, password) {
  await ensureLibs();
  const pwd = password || sessionPwd;
  if (!pwd) throw new Error('Unlock or set a password first');
  if (!(userDoc.walletAuth && userDoc.walletAuth.check)) await setAuthCheck(pwd);
  const wd = await createWallet(chain);
  await persistWallet(chain, wd, pwd);
  refreshPortfolio();
  return { address: wd.address, mnemonic: wd.mnemonic, privateKey: wd.privateKey };
}

async function importAndSave(chain, input, password) {
  await ensureLibs();
  const pwd = password || sessionPwd;
  if (!pwd) throw new Error('Unlock or set a password first');
  if (!(userDoc.walletAuth && userDoc.walletAuth.check)) await setAuthCheck(pwd);
  const wd = await importWallet(chain, input);
  await persistWallet(chain, wd, pwd);
  refreshPortfolio();
  return { address: wd.address };
}

async function removeWallet(chain) {
  const id = uid(); if (!id) throw new Error('Sign in required');
  await updateDoc(doc(db, 'users', id), { [`wallets.${chain}`]: deleteField() });
  const next = { ...wallets }; delete next[chain]; wallets = next;
  emit(); refreshPortfolio();
}

// ── Custom tokens (per chain, stored under wallets.{chain}.tokens) ──
// Detection is read-only (an RPC eth_call / getTokenSupply against the contract),
// so it needs no password and touches no keys.
async function detectToken(chain, address) {
  await ensureLibs();
  if (!TOKEN_CHAINS.includes(chain)) throw new Error('Custom tokens are not supported on ' + chain.toUpperCase() + ' yet');
  const addr = String(address || '').trim();
  if (!isValidAddress(chain, addr)) throw new Error('That is not a valid ' + chain.toUpperCase() + ' token address');
  const meta = await getTokenMeta(chain, addr).catch((e) => { throw new Error((e && e.message) || 'Could not read this token'); });
  return { address: addr, symbol: meta.symbol || '', decimals: Number.isFinite(meta.decimals) ? meta.decimals : 18 };
}

async function addToken(chain, { address, symbol, decimals } = {}) {
  const id = uid(); if (!id) throw new Error('Sign in required');
  if (!TOKEN_CHAINS.includes(chain)) throw new Error('Custom tokens are not supported on ' + chain.toUpperCase() + ' yet');
  const w = wallets[chain];
  if (!w) throw new Error('Add a ' + chain.toUpperCase() + ' wallet before importing tokens for it');
  const addr = String(address || '').trim();
  if (!isValidAddress(chain, addr)) throw new Error('Enter a valid token contract address');
  const sym = String(symbol || '').trim().slice(0, 12) || '???';
  let dec = Number(decimals); if (!Number.isFinite(dec) || dec < 0 || dec > 30) dec = 18;
  const store = chain === 'sol' ? addr : addr.toLowerCase();
  const existing = (w.tokens || []);
  if (existing.some((t) => normTokenAddr(chain, t.address) === normTokenAddr(chain, addr))) {
    throw new Error('That token is already in your ' + chain.toUpperCase() + ' wallet');
  }
  const tokens = [...existing, { address: store, symbol: sym, decimals: dec }];
  await setDoc(doc(db, 'users', id), { wallets: { [chain]: { ...w, tokens } } }, { merge: true });
  wallets = { ...wallets, [chain]: { ...w, tokens } };
  emit();
  refreshPortfolio();
  return { address: store, symbol: sym, decimals: dec };
}

async function removeToken(chain, address) {
  const id = uid(); if (!id) throw new Error('Sign in required');
  const w = wallets[chain];
  if (!w) return;
  const tokens = (w.tokens || []).filter((t) => normTokenAddr(chain, t.address) !== normTokenAddr(chain, address));
  await setDoc(doc(db, 'users', id), { wallets: { [chain]: { ...w, tokens } } }, { merge: true });
  wallets = { ...wallets, [chain]: { ...w, tokens } };
  emit();
  refreshPortfolio();
}

// ── Reveal secrets (password-gated) ──
async function reveal(chain, type, password) {
  const pwd = password || sessionPwd;
  if (!pwd) throw new Error('Unlock required');
  const w = wallets[chain];
  if (!w) throw new Error('No wallet on this chain');
  const blob = type === 'mnemonic' ? w.encMnemonic : w.encPrivateKey;
  if (!blob) throw new Error(type === 'mnemonic' ? 'No recovery phrase stored for this wallet' : 'No private key stored');
  try { return await decryptData(blob, pwd); }
  catch { throw new Error('Wrong password'); }
}

// ── Send (irreversible — validate, unlock, decrypt, broadcast) ──
async function sendAsset({ chain, to, amount, token }) {
  await ensureLibs();
  if (!sessionPwd) throw new Error('Unlock your wallet to send');
  const w = wallets[chain];
  if (!w) throw new Error('No wallet on ' + chain.toUpperCase());
  if (!isValidAddress(chain, to)) throw new Error('Invalid ' + chain.toUpperCase() + ' recipient address');
  if (!(Number(amount) > 0)) throw new Error('Enter a valid amount');
  const pk = await decryptData(w.encPrivateKey, sessionPwd).catch(async () => {
    // The session opened, but THIS key blob won't decrypt. Tell the user what
    // actually happened instead of a dead-end "could not unlock":
    //  - session stale (password changed on another device) → re-lock, re-unlock
    //  - blob encrypted under a different/older password → re-import fixes it
    const sessionStillValid = await unlockable(sessionPwd).catch(() => false);
    if (!sessionStillValid) {
      lock();
      throw new Error('Your wallet password has changed since you unlocked — unlock again with your current password.');
    }
    throw new Error('This ' + chain.toUpperCase() + ' wallet was encrypted with a different password than your current one. Re-import it (Manage wallets → Add or import) using its recovery phrase or private key, then try again.');
  });

  if (token && token.address) {
    if (chain === 'sol' || chain === 'ton') throw new Error('Token sends are supported on EVM chains only for now');
    return await sendImpl.evmToken(chain, token.address, to, amount, token.decimals ?? 18, pk);
  }
  if (chain === 'sol') return await sendImpl.sol(to, amount, pk);
  if (chain === 'ton') return await sendImpl.ton(to, amount, pk);
  return await sendImpl.evmNative(chain, to, amount, pk);
}

// ── Bridge to Robinhood Chain (Relay) ──
// Quote is read-only; execute is password-gated exactly like sendAsset. The
// destination is the user's Robinhood wallet if they added one, else the same
// address as the source wallet (same key controls it on any EVM chain — the UI
// nudges them to import the key on Robinhood afterwards so the app shows it).
function bridgeSupportedFrom() {
  return ['eth', 'base', 'bsc', 'matic'].filter((c) => wallets[c] && wallets[c].address);
}
async function bridgeQuote({ fromChain, amount }) {
  await ensureLibs();
  const w = wallets[fromChain];
  if (!w) throw new Error('No ' + String(fromChain).toUpperCase() + ' wallet to bridge from');
  if (!(Number(amount) > 0)) throw new Error('Enter a valid amount');
  const recipient = (wallets.rhood && wallets.rhood.address) || w.address;
  // Preferred: quote via our Cloud Function — some ISPs break browser TLS to
  // api.relay.link ("Failed to fetch") while server connectivity is reliable.
  // Fall back to the direct browser fetch if the callable is unavailable.
  let q;
  try {
    const amountWei = window.ethers.utils.parseEther(String(amount)).toString();
    const res = await httpsCallable(fns, 'bridgeQuote')({ fromChain, toChain: 'rhood', user: w.address, recipient, amountWei });
    q = normalizeRelayQuote(res.data, 'ETH', amount);
  } catch (e) {
    // Surface real quote problems (bad route/amount) — only fall through on
    // transport/auth-type failures where the direct call may still work.
    if (e && /route unavailable/i.test(e.message || '')) throw e;
    q = await relayBridgeQuote({ fromChain, toChain: 'rhood', amountNative: amount, address: w.address });
  }
  return { ...q, recipient, recipientIsRhoodWallet: !!(wallets.rhood && wallets.rhood.address) };
}
async function bridgeExecute({ fromChain, quote }) {
  await ensureLibs();
  if (!sessionPwd) throw new Error('Unlock your wallet to bridge');
  const w = wallets[fromChain];
  if (!w) throw new Error('No ' + String(fromChain).toUpperCase() + ' wallet to bridge from');
  const pk = await decryptData(w.encPrivateKey, sessionPwd).catch(async () => {
    const ok = await unlockable(sessionPwd).catch(() => false);
    if (!ok) { lock(); throw new Error('Your wallet password has changed since you unlocked — unlock again with your current password.'); }
    throw new Error('This ' + fromChain.toUpperCase() + ' wallet was encrypted with a different password than your current one. Re-import it to fix it.');
  });
  const res = await relayBridgeExecute({ fromChain, quote, privKey: pk });
  refreshPortfolio();
  return res;
}

// ── Change password (re-encrypt every secret + the auth check) ──
async function changePassword(oldPw, newPw) {
  const id = uid(); if (!id) throw new Error('Sign in required');
  if (!newPw || newPw.length < MIN_PW_LEN) throw new Error('New password must be at least ' + MIN_PW_LEN + ' characters');
  if (!(await unlockable(oldPw))) throw new Error('Current password is wrong');
  const nextWallets = {};
  for (const [chain, w] of Object.entries(wallets)) {
    const pk = await decryptData(w.encPrivateKey, oldPw);
    const mn = w.encMnemonic ? await decryptData(w.encMnemonic, oldPw) : null;
    nextWallets[chain] = {
      address: w.address,
      encPrivateKey: await encryptData(pk, newPw),
      encMnemonic: mn ? await encryptData(mn, newPw) : null,
      tokens: w.tokens || [],
    };
  }
  const check = await buildAuthCheck(newPw);
  await setDoc(doc(db, 'users', id), { wallets: nextWallets, walletAuth: { check } }, { merge: true });
  wallets = nextWallets; userDoc.walletAuth = { check }; sessionPwd = newPw;
  emit();
  return true;
}
async function unlockable(password) {
  const check = userDoc.walletAuth && userDoc.walletAuth.check;
  if (check) return verifyAuthCheck(check, password);
  if (hasAnyWallet()) { try { await decryptData(wallets[Object.keys(wallets)[0]].encPrivateKey, password); return true; } catch { return false; } }
  return false;
}

// ── Settings / contacts / connected apps persistence ──
async function saveSettings(patch) {
  const id = uid(); if (!id) return;
  settings = { ...settings, ...patch };
  await setDoc(doc(db, 'users', id), { walletSettings: settings }, { merge: true }).catch(() => {});
  emit();
}
function toggleHidden(listKey, value) {
  const list = new Set(settings[listKey] || []);
  if (list.has(value)) list.delete(value); else list.add(value);
  return saveSettings({ [listKey]: [...list] });
}
async function addContact({ name, address, chain }) {
  const id = uid(); if (!id) return;
  if (!name || !address) throw new Error('Enter a label and address');
  if (chain && !isValidAddress(chain, address)) throw new Error('Address is not valid for ' + chain.toUpperCase());
  const c = { id: 'p' + Date.now(), name, address, chain: chain || 'eth' };
  contacts = [...contacts, c];
  await setDoc(doc(db, 'users', id), { contacts }, { merge: true });
  emit();
}
async function removeContact(cid) {
  const id = uid(); if (!id) return;
  contacts = contacts.filter((c) => c.id !== cid);
  await setDoc(doc(db, 'users', id), { contacts }, { merge: true });
  emit();
}
async function removeConnectedApp(aid) {
  const id = uid(); if (!id) return;
  connectedApps = aid == null ? [] : connectedApps.filter((a) => a.id !== aid);
  await setDoc(doc(db, 'users', id), { connectedApps }, { merge: true });
  emit();
}

// ── Portfolio: native + token balances across all wallets, priced via CG ──
async function refreshPortfolio() {
  const chains = Object.keys(wallets);
  if (!chains.length) { holdings = []; portfolioTotal = 0; emit(); return; }
  try {
    // Native prices in one call
    const cgIds = [...new Set(chains.map((c) => (chainMeta(c) || {}).coingeckoId).filter(Boolean))];
    let px = {};
    if (cgIds.length) { try { px = await (await fetch(`${CG}/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd&include_24hr_change=true`)).json(); } catch (e) { px = {}; } }

    const rows = [];
    await Promise.all(chains.map(async (chain) => {
      const w = wallets[chain]; const meta = chainMeta(chain) || {};
      if (settings.hiddenChains.includes(chain)) return;
      const bal = await getBalanceNum(chain, w.address).catch(() => 0);
      const q = px[meta.coingeckoId] || {};
      const price = q.usd != null ? q.usd : 0;
      if (bal > 0) rows.push({
        sym: meta.symbol, name: meta.label, chain, logo: meta.color, img: meta.logo,
        amount: bal < 1 ? bal.toFixed(5) : bal.toFixed(4),
        price, value: bal * price, ch24: q.usd_24h_change != null ? +q.usd_24h_change.toFixed(2) : 0,
        native: true,
      });
      // Saved custom tokens (EVM + Solana SPL). Native-case address for the
      // price query (Solana mints are case-sensitive); lowercase for the lookup.
      const tokPlatform = meta.cgPlatform || (chain === 'sol' ? 'solana' : null);
      for (const tk of (w.tokens || [])) {
        try {
          const tb = await getTokenBalanceNum(chain, w.address, tk.address, tk.decimals ?? 18);
          if (tb <= 0) continue;
          const prices = tokPlatform ? await fetchTokenPrices(tokPlatform, [tk.address]) : {};
          const p = prices[String(tk.address).toLowerCase()] || {};
          rows.push({ sym: tk.symbol, name: tk.symbol, chain, logo: meta.color, address: tk.address, decimals: tk.decimals ?? 18, amount: tb < 1 ? tb.toFixed(5) : tb.toFixed(4), price: p.usd || 0, value: tb * (p.usd || 0), ch24: p.change != null ? +p.change.toFixed(2) : 0 });
        } catch (e) {}
      }
    }));
    holdings = rows.sort((a, b) => b.value - a.value);
    portfolioTotal = rows.reduce((a, r) => a + r.value, 0);
    emit();
  } catch (e) { /* keep last */ }
}

// Tx history for the active address on a chain
function txHistory(chain) {
  const w = wallets[chain];
  if (!w) return Promise.resolve([]);
  return getTxs(chain, w.address).catch(() => []);
}

// ── Public snapshot for the UI ──
function walletList() {
  return Object.entries(wallets).map(([chain, w]) => {
    const meta = chainMeta(chain) || {};
    return { chain, address: w.address, label: meta.label, symbol: meta.symbol, color: meta.color, hasMnemonic: !!w.encMnemonic, tokens: Array.isArray(w.tokens) ? w.tokens : [], tokensSupported: TOKEN_CHAINS.includes(chain) };
  });
}
function addresses() { const out = {}; for (const [c, w] of Object.entries(wallets)) out[c] = w.address; return out; }
function visibleHoldings() {
  return holdings.filter((h) => {
    if (settings.hiddenChains.includes(h.chain)) return false;
    if (settings.hiddenTokens.includes(h.sym)) return false;
    if (settings.hideSmall && h.value < 1) return false;
    return true;
  });
}

window.FXWallet = {
  load, ready: () => loaded,
  // state
  state: () => ({
    loaded, locked: isLocked(), protected: isProtected(), hasWallets: hasAnyWallet(),
    wallets: walletList(), addresses: addresses(),
    holdings: visibleHoldings(), allHoldings: holdings, total: portfolioTotal,
    settings, contacts, connectedApps,
  }),
  chains: CHAINS,
  evmChains: () => [...EVM_CHAINS],
  isLocked, isProtected,
  isValidAddress: (chain, addr) => isValidAddress(chain, addr),
  // session
  unlock, setInitialPassword, lock, changePassword,
  // wallets
  createAndSave, importAndSave, removeWallet, reveal,
  // custom tokens
  detectToken, addToken, removeToken, tokenChains: () => [...TOKEN_CHAINS],
  // money
  send: sendAsset, refreshPortfolio, txHistory,
  // bridge (→ Robinhood Chain via Relay)
  bridgeQuote, bridgeExecute, bridgeSupportedFrom,
  // settings
  saveSettings, toggleHidden,
  addContact, removeContact, removeConnectedApp,
  ensureLibs,
};

// Load wallet data on sign-in; wipe the in-memory session on sign-out so the
// next account never inherits a previous user's decrypted password/wallets.
onAuthStateChanged(auth, (u) => {
  if (u) { load(); }
  else { sessionPwd = null; userDoc = {}; wallets = {}; contacts = []; connectedApps = []; holdings = []; portfolioTotal = 0; loaded = false; emit(); }
});

export {};

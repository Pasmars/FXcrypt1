const { ethers } = require('ethers')
const axios = require('axios')
const https = require('https')

// ── DEX addresses ──────────────────────────────────────────────────────────
const PANCAKESWAP_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
const UNISWAP_V2_ROUTER  = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
// BaseSwap V2 — Uniswap V2 fork on Base; widest V2-compatible liquidity on Base
const BASESWAP_ROUTER    = '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86'
const WBNB  = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
const WETH  = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const WBASE = '0x4200000000000000000000000000000000000006' // WETH on Base

const ROUTER_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  // FOT variant — required for any token with a buy/sell tax (most new BSC gems)
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
]

const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
]

const HTTP_TIMEOUT = 12000
const RPC_TIMEOUT  = 12000

function withTimeout(promise, ms = RPC_TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('RPC request timed out')), ms))
  ])
}

// ── Private key validators ─────────────────────────────────────────────────
function validateEvmKey(pk) {
  const raw = pk.startsWith('0x') ? pk.slice(2) : pk
  if (!/^[0-9a-fA-F]{64}$/.test(raw))
    throw new Error('Invalid EVM private key — must be 32 bytes hex')
}

function validateSolKey(pk) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(pk))
    throw new Error('Invalid Solana private key — expected Base58 encoded keypair')
}

// Public RPCs with multiple fallbacks — tried in order until one responds
const BSC_RPCS = [
  'https://bsc-rpc.publicnode.com',     // fast + reliable (binance.org dataseeds geo-time-out for some ISPs)
  'https://bsc.meowrpc.com',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed1.ninicoin.io',
  'https://bsc.drpc.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed.binance.org',   // kept last (works from some networks/cloud)
]
const ETH_RPCS = [
  'https://ethereum.publicnode.com',
  'https://eth-mainnet.public.blastapi.io',
]
const BASE_RPCS = [
  'https://mainnet.base.org',
  'https://base.publicnode.com',
  'https://base-mainnet.public.blastapi.io',
]

// ── EVM helpers ────────────────────────────────────────────────────────────
function makeProvider(rpcUrl, chainId) {
  const network = ethers.Network.from(chainId)
  // staticNetwork skips the eth_chainId probe — avoids retry loop on rate-limited RPCs
  return new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network })
}

function chainConfig(chain) {
  if (chain === 'bsc')  return { chainId: 56,   rpcs: BSC_RPCS  }
  if (chain === 'base') return { chainId: 8453,  rpcs: BASE_RPCS }
  return                       { chainId: 1,     rpcs: ETH_RPCS  }
}

async function getWorkingProvider(chain, preferredRpc) {
  const { chainId, rpcs } = chainConfig(chain)
  const list = preferredRpc ? [preferredRpc, ...rpcs] : rpcs
  for (const rpc of list) {
    try {
      const provider = makeProvider(rpc, chainId)
      await withTimeout(provider.getBlockNumber(), 5000)
      return provider
    } catch (_) { /* try next */ }
  }
  throw new Error(`Cannot connect to ${chain.toUpperCase()} network. All RPC endpoints are unavailable.`)
}

function evmProvider(chain, rpcUrl) {
  const { chainId, rpcs } = chainConfig(chain)
  return makeProvider(rpcUrl || rpcs[0], chainId)
}


// ── EVM Buy ────────────────────────────────────────────────────────────────
async function buyTokenEVM(chain, privateKey, tokenAddress, amountNative, slippage, rpcUrl, gasMultiplier) {
  validateEvmKey(privateKey)

  const slip     = Math.min(Math.max(slippage || 5, 0.1), 50)
  // Use working provider with RPC fallback — avoids single-point failures
  const provider = await getWorkingProvider(chain, rpcUrl)
  const wallet   = new ethers.Wallet(privateKey, provider)
  const routerAddr    = chain === 'bsc'  ? PANCAKESWAP_ROUTER
                      : chain === 'base' ? BASESWAP_ROUTER
                      : UNISWAP_V2_ROUTER
  const router        = new ethers.Contract(routerAddr, ROUTER_ABI, wallet)
  const wrappedNative = chain === 'bsc'  ? WBNB
                      : chain === 'base' ? WBASE
                      : WETH
  const amountIn = ethers.parseEther(String(amountNative))
  const path     = [wrappedNative, tokenAddress]

  // Quote the expected output — if this reverts the token has no V2 liquidity pool
  let amountOutMin
  try {
    const amounts  = await router.getAmountsOut(amountIn, path)
    const slipFactor   = BigInt(Math.round((100 - slip) * 10))
    amountOutMin = amounts[1] * slipFactor / 1000n
  } catch (err) {
    const dex = chain === 'bsc' ? 'PancakeSwap V2' : chain === 'base' ? 'BaseSwap V2' : 'Uniswap V2'
    // ethers v6 puts human-readable text in shortMessage; v5 used reason
    const reason = err.reason || err.shortMessage || err.message || ''
    if (
      err.code === 'CALL_EXCEPTION' ||
      reason.includes('INSUFFICIENT_LIQUIDITY') ||
      reason.includes('INVALID_PATH') ||
      reason.includes('revert') ||
      reason.includes('execution reverted')
    ) {
      throw new Error(`No ${dex} liquidity pool found for this token. It may be listed on V3 or another DEX only.`)
    }
    throw new Error(`${dex} quote failed: ${reason || err.code || 'unknown error'}`)
  }

  const deadline = Math.floor(Date.now() / 1000) + 300
  const feeData  = await provider.getFeeData()
  const baseGasPrice     = feeData.gasPrice || 0n
  const gasMult          = BigInt(Math.round((gasMultiplier || 1.2) * 100))
  const adjustedGasPrice = baseGasPrice * gasMult / 100n

  // Use the FOT-supporting variant — works for both regular tokens AND
  // tokens with buy/sell taxes (the vast majority of new BSC gem tokens)
  const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
    amountOutMin, path, wallet.address, deadline,
    { value: amountIn, gasPrice: adjustedGasPrice, gasLimit: 500000 }
  )
  const receipt = await tx.wait()
  return { txHash: tx.hash, status: receipt.status === 1 ? 'confirmed' : 'failed', chain, tokenAddress }
}

// ── EVM Sell ───────────────────────────────────────────────────────────────
async function sellTokenEVM(chain, privateKey, tokenAddress, percentToSell, slippage, rpcUrl, gasMultiplier) {
  validateEvmKey(privateKey)

  const slip = Math.min(Math.max(slippage || 5, 0.1), 50)

  const provider      = evmProvider(chain, rpcUrl)
  const wallet        = new ethers.Wallet(privateKey, provider)
  const routerAddr    = chain === 'bsc'  ? PANCAKESWAP_ROUTER
                      : chain === 'base' ? BASESWAP_ROUTER
                      : UNISWAP_V2_ROUTER
  const router        = new ethers.Contract(routerAddr, ROUTER_ABI, wallet)
  const token         = new ethers.Contract(tokenAddress, ERC20_ABI, wallet)
  const wrappedNative = chain === 'bsc'  ? WBNB
                      : chain === 'base' ? WBASE
                      : WETH

  const balance  = await token.balanceOf(wallet.address)
  const pct      = BigInt(Math.min(100, percentToSell))
  const amountIn = balance * pct / 100n
  if (amountIn === 0n) throw new Error('No token balance to sell')

  const allowance = await token.allowance(wallet.address, routerAddr)
  if (allowance < amountIn) {
    const approveTx = await token.approve(routerAddr, ethers.MaxUint256)
    await approveTx.wait()
  }

  const path     = [tokenAddress, wrappedNative]
  const deadline = Math.floor(Date.now() / 1000) + 300

  const feeData          = await provider.getFeeData()
  const baseGasPrice     = feeData.gasPrice || 0n
  const gasMult          = BigInt(Math.round((gasMultiplier || 1.2) * 100))
  const adjustedGasPrice = baseGasPrice * gasMult / 100n

  const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
    amountIn, 0n, path, wallet.address, deadline,
    { gasPrice: adjustedGasPrice, gasLimit: 400000 }
  )
  const receipt = await tx.wait()
  return { txHash: tx.hash, status: receipt.status === 1 ? 'confirmed' : 'failed', chain, tokenAddress }
}

// ── Jupiter API helper ─────────────────────────────────────────────────────
// europe-west1 GCP Cloud Functions have a persistent EAI_AGAIN (IPv6 DNS) issue
// with external hosts. Fix: force IPv4 via a custom https.Agent.
// quote-api.jup.ag was shut down in 2025; lite.jup.ag is the current free endpoint.
const JUP_AGENT  = new https.Agent({ family: 4, keepAlive: true })
const JUP_BASES  = ['https://lite.jup.ag/v6']
const DNS_CODES  = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'])

// fn(baseUrl) must return an axios call that includes httpsAgent: JUP_AGENT
async function jupiterRequest(fn) {
  let lastErr
  for (const base of JUP_BASES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fn(base)
      } catch (err) {
        lastErr = err
        const code = err.code || (err.cause && err.cause.code) || ''
        if (!DNS_CODES.has(code)) throw err          // Non-DNS error — fail fast
        if (attempt === 0) await new Promise(r => setTimeout(r, 1500))
      }
    }
  }
  throw new Error('Solana trading is temporarily unavailable. Please try again shortly.')
}

// ── Solana Buy via Jupiter ─────────────────────────────────────────────────
async function buyTokenSOL(privateKeyBase58, tokenMint, amountSOL, slippage, rpcUrl, heliusApiKey) {
  validateSolKey(privateKeyBase58)

  const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js')
  const bs58 = require('bs58')

  const slip = Math.min(Math.max(slippage || 5, 0.1), 50)

  // Priority: user's custom RPC → Helius (backend key) → public mainnet (slow)
  const solRpc = rpcUrl
    || (heliusApiKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}` : null)
    || 'https://api.mainnet-beta.solana.com'

  const connection  = new Connection(solRpc, 'confirmed')
  const secretKey   = bs58.decode(privateKeyBase58)
  const keypair     = Keypair.fromSecretKey(secretKey)
  const SOL_MINT    = 'So11111111111111111111111111111111111111112'
  const lamports    = Math.floor(amountSOL * 1e9)
  const slippageBps = Math.round(slip * 100)

  const { data: quote } = await jupiterRequest(base =>
    axios.get(`${base}/quote`, {
      params: { inputMint: SOL_MINT, outputMint: tokenMint, amount: lamports, slippageBps },
      timeout: HTTP_TIMEOUT,
      httpsAgent: JUP_AGENT,
    })
  )
  if (!quote || quote.error) throw new Error(quote?.error || 'Jupiter could not find a route for this token')

  const { data: { swapTransaction } } = await jupiterRequest(base =>
    axios.post(`${base}/swap`, {
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }, { timeout: HTTP_TIMEOUT, httpsAgent: JUP_AGENT })
  )

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))
  tx.sign([keypair])
  const txHash = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })
  await connection.confirmTransaction(txHash, 'confirmed')

  return { txHash, status: 'confirmed', chain: 'sol', tokenAddress: tokenMint }
}

// ── Solana Sell via Jupiter ────────────────────────────────────────────────
async function sellTokenSOL(privateKeyBase58, tokenMint, percentToSell, slippage, rpcUrl, heliusApiKey) {
  validateSolKey(privateKeyBase58)

  const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js')
  const bs58 = require('bs58')

  const slip = Math.min(Math.max(slippage || 5, 0.1), 50)

  const solRpc = rpcUrl
    || (heliusApiKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}` : null)
    || 'https://api.mainnet-beta.solana.com'
  const connection  = new Connection(solRpc, 'confirmed')
  const secretKey   = bs58.decode(privateKeyBase58)
  const keypair     = Keypair.fromSecretKey(secretKey)
  const SOL_MINT    = 'So11111111111111111111111111111111111111112'
  const slippageBps = Math.round(slip * 100)

  const accounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
    mint: new PublicKey(tokenMint)
  })
  if (!accounts.value.length) throw new Error('No token balance found')

  const rawBalance = accounts.value[0].account.data.parsed.info.tokenAmount.amount
  const amountIn   = Math.floor(parseInt(rawBalance, 10) * percentToSell / 100).toString()
  if (amountIn === '0') throw new Error('No token balance to sell')

  const { data: quote } = await jupiterRequest(base =>
    axios.get(`${base}/quote`, {
      params: { inputMint: tokenMint, outputMint: SOL_MINT, amount: amountIn, slippageBps },
      timeout: HTTP_TIMEOUT,
      httpsAgent: JUP_AGENT,
    })
  )

  const { data: { swapTransaction } } = await jupiterRequest(base =>
    axios.post(`${base}/swap`, {
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
    }, { timeout: HTTP_TIMEOUT, httpsAgent: JUP_AGENT })
  )

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))
  tx.sign([keypair])
  const txHash = await connection.sendRawTransaction(tx.serialize())
  await connection.confirmTransaction(txHash, 'confirmed')

  return { txHash, status: 'confirmed', chain: 'sol', tokenAddress: tokenMint }
}

// ── Solana: sign a pre-built Jupiter transaction and submit ───────────────
// The browser fetches the Jupiter quote + swap transaction; this function
// only deserializes, signs with the user's keypair, and submits to Solana RPC.
async function signAndSubmitSolTx(privateKeyBase58, serializedTxBase64, rpcUrl, heliusApiKey) {
  validateSolKey(privateKeyBase58)

  if (typeof serializedTxBase64 !== 'string' || !serializedTxBase64)
    throw new Error('serializedTxBase64 must be a non-empty string')

  const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js')
  const bs58 = require('bs58')

  const solRpc = rpcUrl
    || (heliusApiKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}` : null)
    || 'https://api.mainnet-beta.solana.com'

  const connection = new Connection(solRpc, 'confirmed')
  const secretKey  = bs58.decode(privateKeyBase58)
  const keypair    = Keypair.fromSecretKey(secretKey)

  let tx
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(serializedTxBase64, 'base64'))
  } catch (e) {
    throw new Error('Invalid transaction — could not deserialize: ' + e.message)
  }

  tx.sign([keypair])

  // Jupiter already simulates — skip preflight for faster submission
  const txHash = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  })

  // Use blockhash-context form so confirmTransaction knows when to stop polling
  const { lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const confirmation = await connection.confirmTransaction({
    signature: txHash,
    blockhash: tx.message.recentBlockhash,
    lastValidBlockHeight,
  }, 'confirmed')

  if (confirmation.value.err)
    throw new Error('Transaction failed on-chain: ' + JSON.stringify(confirmation.value.err))

  return { txHash, status: 'confirmed', chain: 'sol' }
}

// ── Balance queries ────────────────────────────────────────────────────────
async function getEVMBalance(address, chain, rpcUrl) {
  // Try the custom RPC first (if given), then fall back across all of the
  // chain's public endpoints — applies to BSC/Base/ETH alike so one flaky
  // endpoint doesn't fail the whole balance lookup.
  const { rpcs: defaults } = chainConfig(chain)
  const list = rpcUrl ? [rpcUrl, ...defaults] : defaults
  // Race every endpoint — the first to respond wins; we only fail if ALL fail.
  // Sequential fallback could stall ~5s on each dead/geo-blocked node (e.g.
  // binance.org dataseeds time out for some ISPs), so racing is both faster and
  // far more resilient.
  try {
    const raw = await Promise.any(list.map((rpc) => withTimeout(evmProvider(chain, rpc).getBalance(address), 6000)))
    return { native: parseFloat(ethers.formatEther(raw)).toFixed(6) }
  } catch (_) {
    throw new Error(`Cannot fetch ${chain.toUpperCase()} balance — all ${list.length} RPC endpoints failed/timed out`)
  }
}

async function getSOLBalance(address, rpcUrl) {
  const { Connection, PublicKey } = require('@solana/web3.js')
  const connection = new Connection(rpcUrl || 'https://api.mainnet-beta.solana.com', 'confirmed')
  const lamports   = await withTimeout(connection.getBalance(new PublicKey(address)))
  return { native: (lamports / 1e9).toFixed(6) }
}

async function getTONBalance(address) {
  try {
    const res = await axios.get('https://toncenter.com/api/v2/getAddressBalance', {
      params: { address }, timeout: 8000
    })
    if (res.data.ok) {
      const tons = Number(BigInt(res.data.result)) / 1e9
      return { native: tons.toFixed(6) }
    }
    return { native: '0.000000' }
  } catch { return { native: '—' } }
}

// ── Token safety / price check via DexScreener ────────────────────────────
async function checkToken(tokenAddress, chain) {
  const chainMap = { bsc: 'bsc', eth: 'ethereum', sol: 'solana' }
  try {
    const { data } = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { timeout: HTTP_TIMEOUT }
    )
    const pairs = (data.pairs || []).filter(p => p.chainId === chainMap[chain])
    if (!pairs.length) return { found: false, reason: 'No liquidity pairs found' }

    const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]
    return {
      found: true,
      name:      best.baseToken.name,
      symbol:    best.baseToken.symbol,
      price:     best.priceUsd || '0',
      liquidity: best.liquidity?.usd || 0,
      volume24h: best.volume?.h24 || 0,
      pairAddress: best.pairAddress
    }
  } catch (err) {
    return { found: false, reason: err.message }
  }
}

module.exports = { buyTokenEVM, sellTokenEVM, buyTokenSOL, sellTokenSOL, signAndSubmitSolTx, getEVMBalance, getSOLBalance, getTONBalance, checkToken }

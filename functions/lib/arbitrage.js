const { ethers } = require('ethers')
const axios = require('axios')

const HTTP_TIMEOUT = 10000

// ── BSC DEX router addresses ───────────────────────────────────────────────
const BSC_DEX_ROUTERS = {
  pancakeswap:  { name: 'PancakeSwap V2', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
  biswap:       { name: 'Biswap',         router: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8' },
  apeswap:      { name: 'ApeSwap',        router: '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b' },
}

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external',
]

const ERC20_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
]

// Popular BSC tokens to scan (paired against WBNB via DexScreener)
const SCAN_TOKENS_BSC = [
  { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE' },
  { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH'  },
  { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB' },
  { address: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', symbol: 'XRP'  },
  { address: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', symbol: 'ADA'  },
]

// Popular Solana tokens to scan via DexScreener
const SCAN_TOKENS_SOL = [
  { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY'  },
  { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  symbol: 'JUP'  },
  { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK' },
  { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',  symbol: 'WIF'  },
  { address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  symbol: 'mSOL' },
]

// ── DexScreener scanner ────────────────────────────────────────────────────
async function scanTokenDexScreener(tokenAddress, chainId, minSpread, minLiqUsd) {
  const { data } = await axios.get(
    `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
    { timeout: HTTP_TIMEOUT }
  )

  const pairs = (data.pairs || []).filter(p => p.chainId === chainId)
  if (pairs.length < 2) return null

  // Best price per DEX (highest liquidity wins when a DEX has multiple pairs)
  const dexBest = new Map()
  for (const pair of pairs) {
    const price = parseFloat(pair.priceUsd || 0)
    const liq   = pair.liquidity?.usd || 0
    if (price <= 0 || liq < minLiqUsd) continue
    const existing = dexBest.get(pair.dexId)
    if (!existing || liq > existing.liq) {
      dexBest.set(pair.dexId, {
        dexId:   pair.dexId,
        dexName: dexLabel(pair.dexId, chainId),
        price,
        liq,
        pairAddress: pair.pairAddress,
        baseSymbol:  pair.baseToken?.symbol || '?',
        quoteSymbol: pair.quoteToken?.symbol || '?',
      })
    }
  }

  if (dexBest.size < 2) return null

  const sorted = Array.from(dexBest.values()).sort((a, b) => a.price - b.price)
  const low  = sorted[0]
  const high = sorted[sorted.length - 1]

  const spread = ((high.price - low.price) / low.price) * 100
  if (spread < minSpread) return null

  return {
    tokenAddress,
    pair:         `${low.baseSymbol}/${low.quoteSymbol}`,
    buyDex:       low.dexId,
    buyDexName:   low.dexName,
    sellDex:      high.dexId,
    sellDexName:  high.dexName,
    buyPrice:     low.price,
    sellPrice:    high.price,
    buyLiq:       low.liq,
    sellLiq:      high.liq,
    spreadPercent: spread.toFixed(3),
    allDexes:     sorted.map(d => ({ name: d.dexName, price: d.price, liq: d.liq })),
    timestamp:    Date.now(),
  }
}

function dexLabel(dexId, chainId) {
  const map = {
    pancakeswap: 'PancakeSwap V2', pancakeswap_v3: 'PancakeSwap V3',
    biswap: 'Biswap', apeswap: 'ApeSwap', babyswap: 'BabySwap',
    uniswap_v2: 'Uniswap V2', uniswap_v3: 'Uniswap V3',
    raydium: 'Raydium', raydium_clmm: 'Raydium CLMM',
    orca: 'Orca', meteora: 'Meteora', lifinity: 'Lifinity',
    phoenix: 'Phoenix',
  }
  return map[dexId] || dexId
}

// ── Main scan ──────────────────────────────────────────────────────────────
async function scanArbitrageOpportunities(chains, minSpread = 0.3, minLiqUsd = 20000) {
  const tasks = []

  if (chains.includes('bsc')) {
    for (const tok of SCAN_TOKENS_BSC) {
      tasks.push(
        scanTokenDexScreener(tok.address, 'bsc', minSpread, minLiqUsd)
          .then(r => r ? { ...r, chain: 'bsc' } : null)
          .catch(() => null)
      )
    }
  }

  if (chains.includes('sol')) {
    for (const tok of SCAN_TOKENS_SOL) {
      tasks.push(
        scanTokenDexScreener(tok.address, 'solana', minSpread, minLiqUsd)
          .then(r => r ? { ...r, chain: 'sol' } : null)
          .catch(() => null)
      )
    }
  }

  const results = await Promise.allSettled(tasks)
  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .sort((a, b) => parseFloat(b.spreadPercent) - parseFloat(a.spreadPercent))
}

// ── BSC arbitrage execution ────────────────────────────────────────────────
// Strategy: BNB → TOKEN on cheap DEX → TOKEN → BNB on expensive DEX.
// Requires the token's quote to be WBNB (native) on both DEXes.
async function executeArbitrageBSC(privateKey, opp, amountBNB, settings) {
  const buyRouterAddr  = BSC_DEX_ROUTERS[opp.buyDex]?.router
  const sellRouterAddr = BSC_DEX_ROUTERS[opp.sellDex]?.router

  if (!buyRouterAddr || !sellRouterAddr)
    throw new Error(`Router not found for DEX pair: ${opp.buyDex} / ${opp.sellDex}`)

  const network  = ethers.Network.from(56)
  const provider = new ethers.JsonRpcProvider(
    settings.bscRpc || 'https://bsc-dataseed.binance.org',
    network, { staticNetwork: network }
  )
  const wallet = new ethers.Wallet(privateKey, provider)

  const gasX    = BigInt(Math.round((settings.defaultGasMultiplier || 1.2) * 100))
  const feeData = await provider.getFeeData()
  const gasPrice = (feeData.gasPrice || 0n) * gasX / 100n

  const amountIn = ethers.parseEther(String(amountBNB))
  const deadline = Math.floor(Date.now() / 1000) + 300
  const path     = [WBNB, opp.tokenAddress]

  // Step 1: buy TOKEN on cheap DEX with BNB
  const buyRouter  = new ethers.Contract(buyRouterAddr, ROUTER_ABI, wallet)
  const buyAmounts = await buyRouter.getAmountsOut(amountIn, path)
  const minBuyOut  = buyAmounts[1] * 95n / 100n

  const buyTx      = await buyRouter.swapExactETHForTokens(
    minBuyOut, path, wallet.address, deadline,
    { value: amountIn, gasPrice, gasLimit: 400000 }
  )
  const buyReceipt = await buyTx.wait()
  if (buyReceipt.status !== 1) throw new Error('Buy leg failed on-chain')

  // Step 2: approve sell router, then sell TOKEN for BNB on expensive DEX
  const token    = new ethers.Contract(opp.tokenAddress, ERC20_ABI, wallet)
  const balance  = await token.balanceOf(wallet.address)
  const allowed  = await token.allowance(wallet.address, sellRouterAddr)
  if (allowed < balance) {
    const approveTx = await token.approve(sellRouterAddr, ethers.MaxUint256, { gasPrice, gasLimit: 100000 })
    await approveTx.wait()
  }

  const sellRouter  = new ethers.Contract(sellRouterAddr, ROUTER_ABI, wallet)
  const sellPath    = [opp.tokenAddress, WBNB]
  const sellAmounts = await sellRouter.getAmountsOut(balance, sellPath)
  const minSellOut  = sellAmounts[1] * 95n / 100n

  const sellTx     = await sellRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
    balance, minSellOut, sellPath, wallet.address, deadline,
    { gasPrice, gasLimit: 400000 }
  )
  const sellReceipt = await sellTx.wait()

  const bnbOut  = parseFloat(ethers.formatEther(sellAmounts[1]))
  const profit  = (bnbOut - amountBNB).toFixed(6)

  return {
    txHashBuy:  buyTx.hash,
    txHashSell: sellTx.hash,
    status:     sellReceipt.status === 1 ? 'confirmed' : 'partial',
    profit,
    chain: 'bsc',
  }
}

// ── SOL arbitrage execution ────────────────────────────────────────────────
// Uses Jupiter — sends amountSOL as input and routes via best available path.
// The spread identified during scanning means Jupiter will route through the
// profitable DEX automatically (or the user can specify the outputMint).
async function executeArbitrageSOL(privateKey, opp, amountSOL, settings) {
  const { Connection, Keypair, VersionedTransaction } = require('@solana/web3.js')
  const bs58 = require('bs58')

  const connection = new Connection(
    settings.solRpc || 'https://api.mainnet-beta.solana.com', 'confirmed'
  )
  const keypair    = Keypair.fromSecretKey(bs58.decode(privateKey))
  const SOL_MINT   = 'So11111111111111111111111111111111111111112'
  const lamports   = Math.floor(amountSOL * 1e9)
  const slipBps    = 200 // 2% slippage

  // Get best Jupiter quote for SOL → token → SOL round trip
  // We route SOL → token first using the identified cheap DEX
  const { data: quote } = await axios.get('https://quote-api.jup.ag/v6/quote', {
    params: {
      inputMint:        SOL_MINT,
      outputMint:       opp.tokenAddress,
      amount:           lamports,
      slippageBps:      slipBps,
      onlyDirectRoutes: false,
    },
    timeout: HTTP_TIMEOUT,
  })

  const { data: { swapTransaction } } = await axios.post(
    'https://quote-api.jup.ag/v6/swap',
    {
      quoteResponse:    quote,
      userPublicKey:    keypair.publicKey.toString(),
      wrapAndUnwrapSol: true,
    },
    { timeout: HTTP_TIMEOUT }
  )

  const tx     = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))
  tx.sign([keypair])
  const txHash = await connection.sendRawTransaction(tx.serialize())
  await connection.confirmTransaction(txHash, 'confirmed')

  return {
    txHashBuy:  txHash,
    txHashSell: null,
    status:     'confirmed',
    profit:     null,
    chain:      'sol',
  }
}

// ── Public execute dispatcher ──────────────────────────────────────────────
async function executeArbitrageOpp(chain, privateKey, opp, tradeAmount, settings) {
  if (chain === 'bsc') return executeArbitrageBSC(privateKey, opp, tradeAmount, settings)
  if (chain === 'sol') return executeArbitrageSOL(privateKey, opp, tradeAmount, settings)
  throw new Error(`Unsupported chain for arbitrage: ${chain}`)
}

module.exports = {
  scanArbitrageOpportunities,
  executeArbitrageOpp,
  SCAN_TOKENS_BSC,
  SCAN_TOKENS_SOL,
}

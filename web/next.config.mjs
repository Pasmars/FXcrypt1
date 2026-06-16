/** @type {import('next').NextConfig} */

// Content-Security-Policy for the wallet app. connect-src is the key control:
// even if a script is somehow injected, it cannot exfiltrate decrypted keys to
// an arbitrary host. The allowlist mirrors the production-proven legacy site
// plus the publicnode RPC endpoints and the CDNs the wallet loads.
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is required by Next.js/webpack runtime; 'unsafe-inline' by Next's bootstrap scripts.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://cdnjs.cloudflare.com https://unpkg.com https://esm.sh",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  [
    "connect-src 'self'",
    "https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net",
    "https://api.coingecko.com https://api.dexscreener.com https://api.exchangerate-api.com",
    "https://esm.sh",
    // Solana
    "https://api.mainnet-beta.solana.com https://solana-rpc.publicnode.com",
    "https://quote-api.jup.ag https://lite.jup.ag https://deep-index.moralis.io",
    "https://*.helius-rpc.com https://*.quiknode.pro https://solana-mainnet.g.alchemy.com https://*.nodereal.io",
    // CEX market data
    "https://api.binance.com https://api.mexc.com https://api.bybit.com https://api.kucoin.com",
    // EVM RPCs
    "https://toncenter.com https://mainnet.base.org https://base.publicnode.com https://base-rpc.publicnode.com",
    "https://bsc-dataseed.binance.org https://bsc.publicnode.com https://bsc-rpc.publicnode.com",
    "https://cloudflare-eth.com https://eth.llamarpc.com https://ethereum-rpc.publicnode.com",
    "https://polygon-bor-rpc.publicnode.com https://polygon-rpc.com",
    // Explorers (tx history)
    "https://eth.blockscout.com https://base.blockscout.com https://polygon.blockscout.com https://bnb.blockscout.com"
  ].join(' ')
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }]
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  }
};

export default nextConfig;

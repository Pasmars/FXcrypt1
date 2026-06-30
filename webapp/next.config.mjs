/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // the ported design modules manage their own global state
  // Every route is client-rendered (the design modules are browser-only), so the
  // app prerenders to fully static output. STATIC_EXPORT=1 emits an `out/` folder
  // for Firebase Hosting; the default (server) build is used by Firebase App Hosting.
  ...(process.env.STATIC_EXPORT ? { output: 'export', images: { unoptimized: true } } : {}),
  // The mobile design modules are plain .jsx/.js using a global `React` and
  // browser-only APIs; they only ever run client-side (loaded via the client
  // bootstrap), so no special transpile is needed here.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};

export default nextConfig;

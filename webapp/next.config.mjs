import { fileURLToPath, URL } from 'node:url';

// Shared design modules (screens/lib/data used by both mobile & webapp) live in
// ../shared, outside this Next root — resolved via the @shared alias.
const SHARED = fileURLToPath(new URL('../shared', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // the ported design modules manage their own global state
  // Every route is client-rendered (the design modules are browser-only), so the
  // app prerenders to fully static output. STATIC_EXPORT=1 emits an `out/` folder
  // for Firebase Hosting; the default (server) build is used by Firebase App Hosting.
  ...(process.env.STATIC_EXPORT ? { output: 'export', images: { unoptimized: true } } : {}),
  // The shared modules are plain .jsx/.js using a global `React` and browser-only
  // APIs; they only run client-side (via the client bootstrap). externalDir lets
  // Next import & transpile them from the sibling ../shared folder.
  experimental: { externalDir: true },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  webpack: (config) => {
    config.resolve.alias = { ...(config.resolve.alias || {}), '@shared': SHARED };
    // shared/ lives outside this app; resolve its bare deps (firebase/*) from
    // THIS app's node_modules so there's a single Firebase instance.
    config.resolve.modules = [fileURLToPath(new URL('./node_modules', import.meta.url)), 'node_modules'];
    return config;
  },
};

export default nextConfig;

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// FXcrypt mobile web app (Vite SPA). The design modules are authored as .jsx
// that share components via window globals (the original prototype pattern);
// esbuild compiles JSX natively — no Babel-in-browser needed.
// Shared code (screens/lib/data used by both mobile & webapp) lives in
// ../shared and is imported via the @shared alias.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SHARED = here('../shared');
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': SHARED,
      // shared/ sits outside this app, so its bare `firebase/*` imports must
      // resolve to THIS app's node_modules copy (single Firebase instance).
      'firebase/app': here('./node_modules/firebase/app'),
      'firebase/auth': here('./node_modules/firebase/auth'),
      'firebase/firestore': here('./node_modules/firebase/firestore'),
      'firebase/functions': here('./node_modules/firebase/functions'),
      'firebase/messaging': here('./node_modules/firebase/messaging'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split heavy deps into cacheable vendor chunks so the app shell parses
        // faster and SDK code is fetched in parallel (and re-cached only when it
        // actually changes between releases).
        manualChunks: {
          'firebase-app': ['firebase/app'],
          'firebase-auth': ['firebase/auth'],
          'firebase-firestore': ['firebase/firestore'],
          'firebase-functions': ['firebase/functions'],
          react: ['react', 'react-dom', 'react-dom/client'],
        },
      },
    },
  },
  server: {
    port: 5180,
    host: true,
    // Allow the dev server to serve the sibling ../shared folder.
    fs: { allow: [SHARED, fileURLToPath(new URL('.', import.meta.url))] },
  },
});

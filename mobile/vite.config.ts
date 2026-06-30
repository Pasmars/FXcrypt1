import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// FXcrypt mobile web app (Vite SPA). The design modules are authored as .jsx
// that share components via window globals (the original prototype pattern);
// esbuild compiles JSX natively — no Babel-in-browser needed.
export default defineConfig({
  plugins: [react()],
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
  },
});

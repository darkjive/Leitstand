import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend port — keep in sync with server/index.ts (PORT env var, default 3010)
const backendPort = process.env.PORT || '3010';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Eigener Port: 5173 kollidiert mit anderen Vite-Projekten (z. B. Zeitgeber-PWA/Service Worker)
    port: 5180,
    strictPort: true,
    proxy: {
      // Proxy API calls to backend server
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      // Proxy WebSocket connections
      '/ws': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavyweights out of the main chunk for better caching and
        // to stay under Rollup's 500 kB warning.
        manualChunks: {
          // react-dom/client + jsx-runtime must be listed explicitly — the bare
          // package ids alone leave the chunk empty and React lands in a sibling.
          react: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
          recharts: ['recharts'],
          grid: ['react-grid-layout'],
        },
      },
    },
  },
});

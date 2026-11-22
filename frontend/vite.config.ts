import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The API (and its WebSocket) lives on the backend port; the dev server proxies
// both so the browser only ever talks to one origin and the session cookie just works.
const API = process.env.AGASTYA_API ?? 'http://localhost:4040';

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // The Studio (CodeMirror, pdfmake) is large and only the editor route needs it.
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
  worker: { format: 'es' },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'], globalSetup: ['./test-support/global-setup.ts'] },
});

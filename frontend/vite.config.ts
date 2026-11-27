import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The API (and its WebSocket) lives on the backend port; the dev server proxies
// both so the browser only ever talks to one origin and the session cookie just works.
const API = process.env.AGASTYA_API ?? 'http://localhost:4040';

// The heavy verification suites; see `test.exclude` below and frontend/scripts/run-verify.mjs.
const VERIFY_HEAVY = ['src/studio/__tests__/verify/{rules,controls,editor,editor-controls,elements,brex-parity,brex-xpath}.test.ts'];

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
  test: {
    environment: 'jsdom', include: ['src/**/*.test.ts'], globalSetup: ['./test-support/global-setup.ts'],
    // QA-002: schema-validating tests take 4-5 s on an idle machine, so vitest's 5 s default turned a loaded run red. 30 s per test and per hook;
    // the verification suites set longer limits of their own.
    testTimeout: 30_000, hookTimeout: 30_000,
    // QA-019 / WP-08: the heavy verification suites (every element, control and BREX rule of 21 types x 4 issues) are a stage of their own. Run in
    // the parallel pool beside everything else they exhausted the machine and a worker process died (tinypool "onUnexpectedExit"), and they pushed
    // light tests over their limits. A bare `vitest run` is therefore the everyday suite; `npm run test:verify` (AGASTYA_VERIFY=1) runs the heavy
    // files one at a time. scripts/ci/gate.mjs runs both stages.
    exclude: ['**/node_modules/**', '**/dist/**', ...(process.env.AGASTYA_VERIFY ? [] : VERIFY_HEAVY)],
  },
});

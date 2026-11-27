import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { searchForWorkspaceRoot } from 'vite';

// WP-26: the client's own version, for the handshake with /api/version (src/lib/handshake.ts). The product version is the root package.json's
// (the server reads the same, services/version.ts), so a page and a server from the same build always agree.
const CLIENT_VERSION = String(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);

// The API (and its WebSocket) lives on the backend port; the dev server proxies
// both so the browser only ever talks to one origin and the session cookie just works.
const API = process.env.AGASTYA_API ?? 'http://localhost:4040';

// The heavy verification suites; see `test.exclude` below and frontend/scripts/run-verify.mjs.
const VERIFY_HEAVY = ['src/studio/__tests__/verify/{rules,controls,editor,editor-controls,elements,brex-parity,brex-xpath}.test.ts'];

export default defineConfig({
  base: '/',
  plugins: [react()],
  define: { __AGASTYA_CLIENT_VERSION__: JSON.stringify(CLIENT_VERSION) },
  server: {
    port: 5174,
    strictPort: true,
    // WP-16 (S1K-003 / ARC-008): the BREX value forms and the XSD-pattern translator are ONE source shared with the server
    // (backend/src/shared/); the dev server may serve that folder besides the frontend itself. A production build bundles it.
    fs: { allow: [searchForWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url))), fileURLToPath(new URL('../backend/src/shared', import.meta.url))] },
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
      // WP-18 (FE-032): these schema sets are the server's own (backend/schemas), served by the backend; 4-1 and ent stay in public/
      ...Object.fromEntries(['4-2', '5-0', '6', '7'].map((i) => [`/schemas/${i}/`, { target: API, changeOrigin: false }])),
    },
  },
  build: {
    target: 'es2022',
    // WP-18 (FE-031): low enough that a new oversize chunk shows; the budgets themselves are checked by scripts/check-bundle.mjs
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // The Studio (CodeMirror, pdfmake) is large and only the editor route needs it.
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
  worker: { format: 'es' },
  test: {
    // WP-09 (QA-016): *.test.tsx are the React component tests (src/testing/render.tsx is their harness)
    environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], globalSetup: ['./test-support/global-setup.ts'],
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

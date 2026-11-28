# Setting up a development machine

Follow this top to bottom on a fresh clone. At the end the app runs on http://localhost:4040 with a real database and the
checks pass. Windows is the main target (the PDF tools are bundled for it); commands are for Git Bash.

## 1. What you need installed

| Tool | Version | Why |
|---|---|---|
| Node.js | 24 LTS (22.13+ also works for development) | backend and frontend; the database is Node's built-in `node:sqlite` |
| Git | any recent | |
| Microsoft Edge or Chrome | any recent | browser tests (`E2E_CHANNEL=msedge` uses Edge) |

Java, Apache FOP and xsltproc are **in the repository** (`backend/vendor/tools/`); nothing else to install on Windows.
On Linux put `xsltproc`, `xmllint` and a Java 11+ runtime on the PATH (`backend/vendor/tools-linux/` links to them).

## 2. Files that are deliberately NOT in git

Get these from the project owner (they are customer material or licensed), or skip them: the app runs without them, and the tests
that need them skip themselves with a reason.

| Path | What | Without it |
|---|---|---|
| `backend/vendor/tools/fonts/arial.ttf`, `arialbd.ttf`, `ariali.ttf`, `arialbi.ttf` | Arial (licensed); copy from `C:\Windows\Fonts` if you hold the licence | PDFs fall back to Liberation Sans; the PDF regression baselines (set in Arial) skip |
| `SAMPLE PROJECTS/S1000D/`, `SAMPLE PROJECTS/JSS-0251/` | the customer's reference publications (layout: `SAMPLE PROJECTS/README.md`) | golden/reference tests skip |
| `manual format/` | the owner's stencils and formats | stencil tests skip |
| `workspace/` | the live data folder (projects + `publisher.db`) | created empty on first start (step 4) |

Optional test inputs outside the repo, passed by environment variable: `NAVAL_STENCILS` (folder of the Naval JSS stencils),
`VEKTRA_SAMPLE` (the RWI/Vektra sample folder), `RWI_ZIP` (the JSS-0251 RWI package), `GOLDEN_SAMPLE_DIR`.

## 3. Install and build

```bash
npm run install:all     # backend and frontend dependencies
npm run doctor          # checks that this machine can publish (Java, FOP, xsltproc, ...); fix anything it reports
npm run build           # backend TypeScript -> backend/dist, frontend -> frontend/dist
```

## 4. The database and first start

```bash
npm start               # http://localhost:4040, one process serves UI and API
```

* First start creates `workspace/` with an empty `publisher.db`, runs every migration in order (`backend/src/storage/`), and asks
  you in the browser to create the administrator. There is no default account.
* **To work on real data** instead, restore a platform backup the owner gives you (an `agastya-backup-*.zip`):
  `node backend/scripts/agastya-backup.js verify <archive>`, then
  `node backend/scripts/agastya-backup.js restore <archive> <new folder>`, then start with `AGASTYA_WORKSPACE_DIR=<new folder> npm start`.
  The server checks the database, takes a safety copy and runs any newer migration itself. Details: `docs/OPERATIONS.md` (Restore).
* Lost the admin password: `npm run reset-admin -- <username>`.
* Development with reload: `npm run dev:backend` (port 4040) and `npm run dev:frontend` (port 5174, proxies `/api` and `/ws`).
  After changing backend code, the tests use `backend/dist`: run `npx tsc -p .` in `backend/` first (the tests refuse a stale dist).

## 5. Check that the machine is really set up

```bash
npm run gate            # the PR gate: build, types, lint, parity, theme, security, backend tests, PDF smoke, frontend tests
```

It must end green (skips are allowed only within `scripts/ci/skip-budget.json`, each with its reason). Then open
http://localhost:4040, create the administrator (or sign in to the restored data), create a sample from **Samples**, and build its PDF.

Browser tests: `cd frontend && E2E_PORT=4121 E2E_CHANNEL=msedge npx playwright test e2e/<spec>`. Use your own port; the default
4050 is for the full suite, and two runners on one port refuse to start.

## 6. Ports used

| Port | Use |
|---|---|
| 4040 | the app (`npm start` / `npm run dev:backend`) |
| 5174 | frontend dev server |
| 4050 | the full Playwright suite (one runner at a time) |
| 4100-4199 | single specs run alongside other work (pick a free one) |

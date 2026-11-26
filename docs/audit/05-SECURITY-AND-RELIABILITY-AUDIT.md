# Security and Reliability Audit — Agastya Platform

## Scope and method

This report covers the security, reliability and data-integrity posture of the whole Agastya platform (backend
`backend/src`, vendored engine `backend/vendor/**`, frontend `frontend/src`, packaging `packaging/**`), as if it will
hold confidential defence/aerospace technical documentation. Method: static review of the backend route table (every
file under `backend/src/routes`, `backend/src/core/auth`, `backend/src/services`), the vendored XSLT/FOP pipeline,
and the Windows packaging scripts, cross-checked against a live scratch instance of the real backend
(`node dist/index.js`, workspace `scratchpad\S\ws`, port **4060**, never 4040/4041) with a throwaway admin account,
several throwaway author/PM accounts, and planted canary files outside the workspace. A second scratch HTTP listener
on port **4061** was used to detect outbound requests the server itself makes. Every exploit below was reproduced
against this scratch instance only; no file under `workspace\` was ever read. One reliability experiment used
`taskkill /F` against the scratch Node process I started myself (PID recorded in `scratchpad\S\server.pid`), per the
brief's allowance. Three leads surfaced by other audit agents (B: S1K-001 path-traversal; A: PLT-014/017/018/019/023
and the `req.project.name`/CIR-`baseHash` notes; I: ENT-001/002/004/020) were independently reproduced or refuted
here rather than taken on trust; each is cross-referenced where it overlaps a SEC/REL finding below.

## Coverage table

| Area / path | Status | Verification done | Limits |
|---|---|---|---|
| `core/auth/*` (crypto, sessions, policy, rateLimit, bootstrap, authz, grants, xmlGuard, routes.js) | Inspected | Live probes: setup race, login/onboarding/logout/disable/password-change, session replay, rate limiting, `xmlGuard` unit-level bypass + live save | — |
| Route guard coverage (all routers) | Inspected | Loaded the compiled app and dumped every route's guard marker (283 API routes) | SPA catch-all correctly has none; not a gap |
| `routes/project-content.ts`, `services/projects.ts`, `services/csdb.ts`, `services/pm.ts` | Inspected | Live cross-project IDOR/traversal exploit, canary read/write, DM tamper, CIR `baseHash` check | — |
| `services/projectArchive.ts`, `routes/xengine.ts`, `routes/packages.ts`, `services/importer/*` | Inspected | Forged-archive end-to-end exploit (zero prior access → cross-project read); zip-slip unit checks on both ZIP readers | `services/importer/apply.ts` repair rules read for shape only, not exhaustively traced |
| `services/zipio.ts`, `services/importer/zipRead.ts`, `services/zip.ts` | Inspected | Code read of `safeEntryName`/`safeJoin`; not fuzzed with a crafted ZIP64/ADS archive | Windows ADS (`name:stream`) and reserved device names not tested live |
| `vendor/engine/build.js`, `fopd.js`, `validateXml.js`, XSLT pipelines (`vendor/pipeline/**`) | Inspected | Live SSRF-to-FOP exploit (listener hit from `Java/21.0.13.1`); `xi:include` guard gap confirmed at the guard level only | Full `xi:include → FOP output` content-disclosure chain not completed (time) |
| `services/broadcast.ts` (WebSocket) | Inspected | Live: handshake without cookie (401), with cookie (101), with garbage cookie (401); live: socket survives account disable | — |
| Security headers / CORS / CSRF | Inspected | Live header dump on 6 surfaces; cross-origin POST and `Origin: null` POST both refused (403) | HSTS not applicable without TLS (see SEC-006) |
| `services/backup.ts`, `/api/backup` | Inspected | Code + live: non-admin backup correctly scoped to their own projects | — |
| `context.ts` audit/redaction, `services/adminConfig.ts` | Inspected | Code read + a deterministic reproduction of the redaction regex dropping `contentHash` | Did not inspect every admin collection's write path |
| `packaging/installer/agastya.iss`, `agastya.ini.template`, `AgastyaHost.cs` | Partially inspected | Read ACL/service/firewall/LAN logic; did not run the installer | Cannot verify the installed state on a real machine from this environment |
| Reliability: writes, shutdown, crash recovery | Inspected | Live kill-mid-write experiment (taskkill /F on my own scratch server), WAL recovery check, graceful-shutdown code read | One kill attempt did not happen to catch a torn write (see REL-001) |
| Supply chain (npm) | Inspected | `npm audit` against the real `package.json`/lockfile in a scratch copy (registry reachable) | Native/bundled binaries (FOP, JRE, libxslt, xmllint-wasm) checked by version only, not rebuilt/fuzzed |
| Frontend XSS surfaces (`innerHTML`, `dangerouslySetInnerHTML`, `pdfjs`) | Inspected | Grep of every call site in `frontend/src`; all `innerHTML` writers use the app's own `escH`-escaped templates or fixed markup | Not exercised in a real browser (no DOM available here) |

## Threat model summary

**Assets**: data modules / publication modules / JSS·JSG documents (potentially classified per S1000D `security`
element), the SQLite registry (`publisher.db`), session tokens, password hashes, the audit log, house
templates/brand packs, uploaded graphics, build artefacts (PDF/FO), licence/master-password material.

**Actors**: anonymous network client; an authenticated low-privilege Author; a Project Manager; an Administrator;
another local OS user on the same machine (per-machine install); a party on the same LAN (LAN bind mode); the
server process itself acting on attacker-supplied data (SSRF/XXE confused-deputy).

**Trust boundaries**: browser ↔ Express API (cookie session); Express ↔ `node:sqlite`/filesystem (assumed trusted,
but see SEC-002); Express ↔ vendored engine (`execFile`/`spawn`, no shell); engine ↔ FOP/libxslt/Java (assumed to
only touch files the engine already resolved safely — see SEC-001/SEC-003, where that assumption breaks); OS ↔
other local accounts (installer ACLs — see SEC-005).

```mermaid
flowchart LR
  subgraph Untrusted
    Browser["Browser / LAN peer"]
    OtherOSUser["Other local Windows account"]
  end
  subgraph Server["Agastya Node process"]
    API["Express API\n(session cookie, RBAC guards)"]
    SVC["services/*\n(csdb, projects, pm, archive)"]
    DB["node:sqlite\npublisher.db (WAL)"]
    FS["workspace/projects/**\n(DMs, PMs, Media, project.json)"]
  end
  subgraph Engine["Vendored engine (execFile, no shell)"]
    XSLT["xsltproc / libxslt\n--nonet, --xinclude"]
    FOP["FOP (Java)\nfo:external-graphic"]
  end
  Browser -->|HTTP/WS, cookie| API --> SVC --> DB
  SVC --> FS
  SVC -->|project.json input.*, unsanitised| XSLT
  SVC -->|publishers[].logo, unsanitised| FOP
  FOP -->|SEC-003: outbound fetch| Internet[("Any host/port\nthe process can reach")]
  XSLT -->|SEC-001/SEC-011: local file| FS
  OtherOSUser -->|SEC-005: icacls Modify| FS
  OtherOSUser --> DB
```

**Standalone vs client-server**: the product is the same process either way — a single Node server that can bind to
`127.0.0.1` (packaged default), every interface (source/dev default), or the LAN (installer `/LAN` switch). There is
no separate "client-server mode" code path with its own hardening; the only variable is which interface it listens
on and whether a reverse proxy sits in front (declared via `trust proxy 1` but not actually set up by anything in
this repository — see SEC-006/SEC-008).

## Security checklist — verdict table

| # | Checklist item | Verdict | Reference |
|---|---|---|---|
| 1 | Password hashing (argon2 optional, scrypt fallback) | **VERIFIED not vulnerable** | `core/auth/crypto.js:14-57`; constant-time dummy-verify against username enumeration by timing |
| 1b | Password hashing in the packaged build | **NOT VERIFIED** | `argon2` is a native addon (`backend/package.json:29`); whether the installer ships a working prebuilt binding for the target Node/ABI, or silently falls back to scrypt, was not checked (no installer build attempted, per the hard rules) |
| 2 | Session tokens: storage/flags/expiry | **VERIFIED not vulnerable** | opaque 256-bit token, only its SHA-256 stored; cookie `HttpOnly; SameSite=Lax; Max-Age=604800` (observed live) |
| 2b | Session rotation/revocation (login, logout, disable, password change) | **VERIFIED not vulnerable** for HTTP | live: second login displaces the first (401); logout+replay → 401; disable → 401; password change invalidates the old password immediately |
| 2c | Session revocation reaching the WebSocket channel | **VERIFIED vulnerable** | **SEC-010** |
| 3 | Password policy / lockout / rate limiting | **VERIFIED vulnerable** | **SEC-004, SEC-007, SEC-008** |
| 4 | First-run setup race | **VERIFIED not vulnerable** | 8 concurrent `POST /api/auth/setup`: 1×200, 7×409 |
| 5 | RBAC — one guard per route | **VERIFIED not vulnerable** | all 283 real API routes carry exactly one guard marker (dumped from the live route table) |
| 5b | RBAC — IDOR / ownership across projects | **VERIFIED vulnerable** | **SEC-002** (bypasses route RBAC entirely at the data layer) |
| 6 | CSRF | **VERIFIED not vulnerable** | global Origin check (`app.ts:54-63`) live-tested: cross-origin POST → 403; `Origin: null` → 403; applies to every non-GET/HEAD/OPTIONS request incl. multipart |
| 7 | XSS — editors (`innerHTML`/`dangerouslySetInnerHTML`) | **VERIFIED not vulnerable** | every `innerHTML` writer in `frontend/src/jsg`, `frontend/src/jss`, `frontend/src/studio` builds from the app's own `escH`-escaped templates or fixed markup; no `dangerouslySetInnerHTML` found outside test files |
| 7b | XSS — SVG/image upload, stored XSS via media | **VERIFIED vulnerable** | **SEC-009** |
| 8 | Security headers / CSP / CORS / HSTS | **VERIFIED vulnerable (absent)** | live header dump on `/`, `/index.html`, `/api/health`, `/assets/`: no CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy anywhere |
| 9 | WebSocket auth | **VERIFIED not vulnerable** at handshake / **VERIFIED vulnerable** post-revoke | **SEC-010** |
| 10 | Command/argument injection | **VERIFIED not vulnerable** | every live code path uses `execFile`/`spawn` with argument arrays; the one shell-`exec` helper in `vendor/engine/build.js:39-46` is dead code (unexported, never called — confirmed by grep) |
| 11 | Path traversal / zip-slip (ZIP readers) | **VERIFIED not vulnerable** at the ZIP layer | `services/zipio.ts:33-51`, `services/importer/zipRead.ts:28-36` both normalise/refuse `..`, absolute paths, drive letters |
| 11b | Path traversal via `project.json` fields | **VERIFIED vulnerable** | **SEC-002** |
| 12 | Upload validation | **VERIFIED vulnerable (SVG only)** | **SEC-009**; non-SVG extensions are checked against a fixed allow-list |
| 13 | XML security — XXE/DTD/entity expansion | **VERIFIED vulnerable** | **SEC-001** |
| 13b | XML security — `xi:include` | **VERIFIED vulnerable** | guard does nothing for `xi:include` (confirmed by me); full disclosure-into-output chain confirmed live by agent C on the JSS ancillary-page path (PUB-002) — **SEC-011**, see addendum |
| 13c | XML security — FOP `external-graphic` / SSRF | **VERIFIED vulnerable** | **SEC-003** |
| 13d | `xmllint-wasm`, libxslt `--nonet` | **VERIFIED not vulnerable** for network fetches; **does not cover local file access** (by design of `--nonet`) | `vendor/engine/build.js:479-498`; `services/extensions.ts:48,53` |
| 14 | SQL injection | **VERIFIED not vulnerable** | every query read uses parameter placeholders or constant SQL text; no string-built SQL with request data found |
| 15 | Secret storage | **VERIFIED not vulnerable** for passwords/tokens; **NOT VERIFIED** for licence material (none found in this sweep) | hashes/tokens never logged; `.session-secret`-style file not located under this name — session tokens are DB-stored hashes, not a shared signing secret, so there is no such file to check |
| 16 | Sensitive data in logs/errors | **VERIFIED vulnerable (minor)** | **SEC-013** |
| 17 | Audit-log integrity | **VERIFIED vulnerable** | **SEC-012** |
| 18 | Service account / ACLs | **VERIFIED vulnerable** | **SEC-005** |
| 19 | Supply chain | **VERIFIED** (see below) | `npm audit`: backend 0 vulnerabilities; frontend 8 (7 moderate/1 low), all in dev-only tooling except `react-router` (moderate, runtime) — see Supply-chain subsection |

## Findings — Security (SEC)

### SEC-001 · P0 · VERIFIED · XL · The XML safety guard is bypassed by a decoy comment, reopening XXE on every XML write route

**Category**: Input validation / XXE.
**Problem**: `checkXmlSafety` is the *only* defence against DTD-based attacks (classic XXE, parameter-entity
expansion) across the whole product. It locates the DOCTYPE with `text.search(/<!DOCTYPE/i)` — the first
*textual* match — and scans only that region. A one-line XML comment placed earlier in the document that merely
*contains the text* `<!DOCTYPE` is matched instead, so the scanner inspects the harmless decoy and never reaches
the real, dangerous DOCTYPE that follows it.
**Evidence**:
```
core/auth/xmlGuard.js:49-54        text.search(/<!DOCTYPE/i)   — first match wins
```
Direct reproduction (no server): the real payload alone is refused; the same payload behind a decoy is accepted:
```
checkXmlSafety('<!DOCTYPE d [ <!ENTITY x SYSTEM "file:///C:/Windows/win.ini"> ]><d>&x;</d>')
  -> { ok:false, error:'... classic XXE ...' }
checkXmlSafety('<!-- decoy <!DOCTYPE x> --><!DOCTYPE d [ <!ENTITY x SYSTEM "file:///..."> ]><d>&x;</d>')
  -> { ok:true }
```
Live, end to end, on the single most common write route (`PUT /api/projects/:id/dms/:file`, which calls
`services/csdb.ts:150-153 validateContent → checkXmlSafety` unconditionally, even for "lenient" imports):
the same malicious DOCTYPE alone → **HTTP 400 `UNSAFE_XML`**; preceded by the one-line decoy comment → **HTTP 200,
saved**. Reproduced against the scratch instance (user `carol`, project `sample-hydraulic-pump`).
**Current implementation**: `checkXmlSafety` is a regex/text scanner with no comment- or PI-awareness; it assumes
the first substring that looks like a DOCTYPE *is* the DOCTYPE.
**Recommendation**: Before searching for `<!DOCTYPE`, strip (or skip over) XML comments (`<!--...-->`) and
processing instructions (`<?...?>`) with a real tokenizer pass (not a second regex with the same blind spot), or
switch to counting only the *first* `<!DOCTYPE` that appears *outside* any comment/PI/CDATA span. Add the exact
decoy-comment payload above as a permanent regression test.
**Expected outcome**: the guard refuses the payload regardless of where in the prolog it is hidden.
**Dependencies**: every caller of `checkXmlSafety` (`services/csdb.ts`, `routes/project-content.ts:218`,
`services/importer/scanner.ts`, `services/extensions.ts`) benefits from the same fix with no call-site change.
**Risks**: tightening the scan must not start rejecting legitimate comments/PIs that merely precede a real,
already-checked DOCTYPE (regression risk — keep the existing ISOEntities/parameter-entity carve-outs working).
**Acceptance criteria**: the two reproduction payloads above both return `{ ok:false }`; the existing
`backend/test` XML-safety suite still passes unmodified.
**Test cases**: (1) decoy comment before a parsed external entity; (2) decoy comment before an internal parameter
entity (billion-laughs); (3) a decoy *inside a CDATA section*; (4) a legitimate S1000D data module with a real
comment that happens to contain the word "DOCTYPE" in prose, which must still save.

### SEC-002 · P0 · VERIFIED · L · Unvalidated `project.json` path fields give cross-project IDOR and file access outside the workspace

**Category**: Broken access control / path traversal (cross-references agent B's **S1K-001**).
**Problem**: `csdbRel`/`mediaRel`/`pmRel` (`services/projects.ts:57-65`) read `project.json`'s `input.csdbDir`,
`input.mediaDir` and `input.pm` verbatim, with no call to the `safeRelPath` guard that already exists
(`core/auth/xmlGuard.js:159-166`) for exactly this purpose. Every data-module, media and publication-module route
(`routes/project-content.ts`, `services/csdb.ts`, `services/pm.ts`, `services/graphics.ts`,
`services/applicability.ts`, `services/htmlPublish.ts`, `services/findings.ts`, `services/dispatch.ts`) builds its
on-disk path from these values. Two independent ways to set them:
- `PUT /api/projects/:id/settings` (`routes/project-content.ts:427-455`) requires only `editor` + `settings.write` —
  any author on their own project.
- A forged **project archive** through `POST /api/xengine/import` (`routes/xengine.ts:60-78`,
  `services/projectArchive.ts:136-180`): `requireAuth()` only, no project membership at all. `readManifestOf` only
  checks `generator === 'Agastya'` (a public literal) and a known `format`; `restoreProjectArchive` merges the
  archive's `project/project.json` **almost verbatim** into the new project (`projectArchive.ts:174-177`, `merged =
  { ...src, name, group, schemaVersion }`), and `TEXT_RE = /\.(xml|xsl|xslt|ent|dtd)$/i`
  (`projectArchive.ts:116`) **excludes `.json`**, so `project.json` never passes through `checkXmlSafety` or any
  other check.
**Evidence** (both reproduced live on the scratch instance):
1. Author `bob` (owner of `bob-project`, no access to `carol`'s `sample-hydraulic-pump`) sets his own project's
   `input.csdbDir` to `../sample-hydraulic-pump/csdb` via `PUT /settings` → `GET /dms` then lists carol's three
   data modules; `PUT /dms/:file` then **overwrites carol's data module** (confirmed: her file gained a
   `<!-- TAMPERED-BY-BOB -->` marker). Pointing `input.pm` at `../../../canary/victim-file.txt` (outside the
   workspace entirely) and calling `POST /pmc/import` **overwrote the canary file** (a `.bak` of the original was
   created, confirming the write path). Pointing `input.mediaDir` at the canary folder and calling
   `GET /media/secret.png` returned the canary file's bytes.
2. A brand-new user `eve`, created by an admin, with **zero projects and zero prior memberships**, builds a ZIP
   containing only `manifest.json` (`{"generator":"Agastya","format":"s1000d",...}`) and
   `project/project.json` (`{"input":{"csdbDir":"../sample-hydraulic-pump/csdb", ...}}`) with `Compress-Archive`
   and uploads it to `POST /api/xengine/import`. The response is **201**, a brand-new project is created under her
   ownership, and `GET /api/projects/<new-id>/dms` immediately lists carol's three data modules;
   `GET /dms/:file` returns carol's DM content verbatim.
**Current implementation**: no `safeRelPath`/`safeJoin`-style check anywhere on the read *or* write side of
`input.csdbDir`/`mediaDir`/`pm`; the archive importer trusts the uploaded JSON outright.
**Recommendation**: validate `input.csdbDir`/`mediaDir`/`pm` with the existing `safeRelPath` (reject absolute
paths, drive letters, `..`, NUL) at the single point they are written — inside `updateProjectJson`
(`services/projects.ts`) and inside `restoreProjectArchive`'s merge step — so every current and future caller is
protected without touching each route. Additionally run `project.json` through a dedicated allow-list/shape check
(not `checkXmlSafety`, which is XML-specific) before merging an archive's copy over a freshly created project's own.
**Expected outcome**: `input.*` can only ever name a path inside the project's own directory; a forged or
hand-edited `project.json` cannot retarget any project to another project's or the workspace's files.
**Dependencies**: fixing it in `projects.ts` also closes the archive-import route (**SEC-002**) and the package
importer's own settings-restore path (`services/importer/apply.ts` / `restoreSettings`, not separately audited in
depth — recommend the same check there) without a second change.
**Risks**: tightening must not break the legitimate, intentional use of `input.*` (projects created from an older
tool's layout, where `csdbDir` really does differ from the default `"csdb"`) — the fix should allow any relative,
in-tree path, not freeze the value to the default.
**Acceptance criteria**: `PUT /settings` and project-archive import both reject (400, not silently drop) an
`input.*` value containing `..`, a leading `/`, a drive letter, or a backslash; the two live reproductions above
both fail after the fix.
**Test cases**: (1) `PUT /settings` with `input.csdbDir` containing `..` → 400; (2) forged archive with the same →
400 or value discarded with a finding, project still usable; (3) a legitimate S1000D project import with a
non-default but in-tree `csdbDir` still works.

### SEC-003 · P0 · VERIFIED · L · SSRF (and local-file access) through the publisher-logo field, fetched by FOP during every build

**Category**: Server-side request forgery.
**Problem**: `vendor/engine/config.js:68` takes the front-matter publisher list from
`project.publishers` (a free-form array on `project.json`, settable by any project **editor** via `PUT /settings`,
or planted directly by the forged-archive technique in **SEC-002**) with no existence or scheme check when the
project's pipeline is `s1000dtofo` (`services/publisher.ts:361-363`: `applyDefaultArtwork`, the one function that
*would* have checked `fs.existsSync` and silently substituted a safe default, is **skipped** for this pipeline —
`if (!useDirect) applyDefaultArtwork(...)`). The raw value is written straight into the FO-adjacent intermediate as
`<logo src="...">` (`vendor/engine/frontmatterInject.js:79`) and from there into
`<fo:external-graphic src="url('{logo/@src}')">` (`vendor/pipeline/jsstofo/frontmatter.xsl:290` et al.), which
Apache FOP resolves itself when it renders the page.
**Evidence**: scratch listener on `127.0.0.1:4061` (the agent's own allowed port range). Set
`project.publishers = [{ name: "Attacker Co", logo: "http://127.0.0.1:4061/pixel.png" }]` via `PUT /settings` on an
`xignal-s1000d`/`s1000dtofo` project, then `POST /publish`. The build completed and the listener recorded two
`GET /pixel.png` requests with **`User-Agent: Java/21.0.13.1`** — i.e. the bundled JRE/FOP process itself making
outbound HTTP requests to an attacker-chosen URL during a routine PDF build.
**Current implementation**: the `applyDefaultArtwork` existence check only runs for the JSS-book pipeline; the
direct S1000D pipeline (the one new, unspecified S1000D projects use by default — `services/projects.ts:184-188`)
injects `branding.publishers[].logo`/`emblem` with no check at all, and even where the check does run it only
guards the *fallback*, not the attacker-supplied value when a file happens not to exist at that exact resolved
path.
**Recommendation**: validate every artwork path (`emblem`, each publisher's `logo`) the same way as
**SEC-002** — relative, in-tree, no scheme — at the point `project.json` is written, and again defensively in
`applyDefaultArtwork`/`injectDirectFrontMatter` before it reaches the FO intermediate, for *every* pipeline, not
only the JSS one. Separately, FOP should be configured (or the generated FO post-processed) so that
`external-graphic` can never resolve a `file:`/`http(s):` URI outside the project directory — FOP's own
`baseURL`/`URIResolver` can be pinned to the project's own media folder.
**Expected outcome**: a build can only ever embed images that already exist inside the project.
**Dependencies**: shares its root cause and its fix location with **SEC-002**.
**Risks**: pinning FOP's resolver must not break the legitimate default artwork (`vendor/pipeline/jss/artwork/*`,
which lives *outside* the project directory by design — the fix needs an explicit allow-list of that one directory
plus the project's own, not a single root).
**Acceptance criteria**: the same `http://127.0.0.1:4061/...` logo value is rejected at `PUT /settings` time (SEC-002
fix) and, as a second layer, a build with such a value present in an already-existing `project.json` does not
produce any outbound network activity.
**Test cases**: (1) `logo` set to a loopback HTTP URL → build either refuses or renders without it, no outbound
request; (2) `logo` set to `file:///…` → no local file outside the project is read; (3) a project with a real,
project-local logo still renders it.

### SEC-004 · P1 · VERIFIED · M · Predictable temporary passwords, plus unrestricted username enumeration, allow account pre-hijack at scale

**Category**: Authentication / account takeover.
**Problem**: every admin-created account (`core/auth/policy.js:116 tempPasswordFor`, used at
`core/auth/routes.js:560-584`), every admin-approved reset (`routes.js:532-548 issueAdminReset`), and the
self-service "forgot password" queue all issue the password `<username>@<current-year>` — a value anyone can
compute from the username alone. `GET /api/users/search` (`core/auth/routes.js:419-424`) lets **any** authenticated
user (not just admins/PMs) enumerate full usernames platform-wide by prefix, with no extra throttle beyond the
generic login limiter. The two combine into a scalable attack: enumerate real usernames, then log in as each with
`username@2026` before the real person's first login.
**Evidence**: live, end to end on the scratch instance. Admin created `victim`; attacker client `mallory` (no prior
knowledge beyond the username) logged in with `victim@2026` (200), completed onboarding with her own password
(200); the real victim's subsequent login with the original temp password then failed (401
`BAD_CREDENTIALS`) and the account's `usernameLocked` flag was already `true` — permanent takeover unless an
administrator intervenes. Separately, `GET /api/users/search?q=a` as a plain `author` returned other users'
`username`/`fullName`/`role`.
**Current implementation**: no delivery channel other than "shown once to the admin who typed it in the browser";
no requirement to use it within a short window; no secondary verification (e.g. an email/SMS code) before
onboarding completes and locks the username.
**Recommendation**: generate temp passwords and reset tokens with real randomness (not derivable from the
username), expire them quickly (e.g. 24h) if unused, and require the *creating* admin/PM to deliver them out of
band; consider a short-lived, single-use setup link instead of a password the admin reads out loud. Independently,
scope `/api/users/search` down (bound the fields returned, or require the requester to already share a project with
the result) since it is what makes guessing worthwhile at scale.
**Expected outcome**: knowing a username is no longer sufficient to take over a freshly created or freshly reset
account.
**Dependencies**: none.
**Risks**: a short expiry must not lock out a legitimate new hire who does not log in on day one — pair it with an
easy re-issue flow.
**Acceptance criteria**: a temp password or reset token issued and left unused for the configured window no longer
authenticates; `/api/users/search` no longer returns a usable directory to every role.
**Test cases**: (1) login with an expired temp password → refused; (2) `/api/users/search` as a plain author scoped
down; (3) a legitimate first login + onboarding within the window still works unchanged.

### SEC-005 · P1 · VERIFIED · M · The installer grants every local Windows account write access to the database and project files

**Category**: Access control / OS-level ACLs (cross-references agent I's **ENT-004**).
**Problem**: `packaging/installer/agastya.iss:375-378` runs, for a per-machine install:
```
icacls "<StateDir>" /grant *S-1-5-32-545:(OI)(CI)M /C /Q
icacls "<DataDir>"  /grant *S-1-5-32-545:(OI)(CI)M /C /Q
```
`S-1-5-32-545` is the well-known SID for **BUILTIN\Users** — every local, non-administrator account on that
machine, recursively, on both the application's state folder and `DataDir` (the workspace that holds every
project's files and `publisher.db`). This is independent of, and bypasses, every RBAC/session check the
application itself enforces: any other local login (a shared workstation, RDP, a different low-privilege service
account later compromised) can read, modify or delete the SQLite database and every project's raw files directly on
disk, with no audit trail from the application's own `audit()` mechanism.
**Evidence**: direct read of `agastya.iss:368-378`; the comment immediately above it (`"...they get modify rights
on the data and state folders - and only on those"`) confirms this is deliberate, intended behaviour, not an
oversight in the Pascal script — the design choice itself is the problem for a defence/aerospace use case.
**Current implementation**: the tray application/service runs as the installing/service account, and the rationale
given is that a *standard user running the tray app* needs to write logs and the database; the chosen mechanism
grants that to the whole local Users group rather than to the one account that needs it.
**Recommendation**: run the service/tray process under a dedicated service account (or `LocalService`, already
used elsewhere per `AgastyaHost.cs:526-537`) and grant Modify to *that* principal only; if multiple interactive
users on the same machine must each run the tray app, consider a per-user data directory instead of a shared one
writable by everyone.
**Expected outcome**: a local account with no legitimate reason to touch Agastya's data cannot read or modify it
directly.
**Dependencies**: packaging/installer only; no application code change.
**Risks**: must not break the documented single-machine, multi-user desktop scenario this was written for — needs a
packaging-level decision, not just a tighter ACL that silently breaks the tray app for standard users.
**Acceptance criteria**: after install, `icacls` on the data directory does not list `BUILTIN\Users` with Modify;
the tray app still writes logs and the database under the account it actually runs as.
**Test cases**: fresh per-machine install, inspect ACLs; log in as a second, unrelated local standard user and
confirm no access to the data directory.

### SEC-006 · P1 · VERIFIED (code) · M · The LAN deployment mode has no TLS anywhere; credentials and session cookies travel in clear text

**Category**: Transport security (cross-references agent I's **ENT-001**).
**Problem**: `backend/src/config.ts:17-20` lets the bind address be `undefined` (every interface, the source/dev
default) or explicitly `lan` via the installer's `/LAN` switch (`agastya.iss:369 SetIniString('server','Bind','lan',...)`).
Nothing in this repository terminates TLS: the server is plain `http.createServer(app)`
(`backend/src/index.ts:27`), and `config.ts:37 secureCookies` only forces the cookie's `Secure` flag when
`AGASTYA_SECURE_COOKIES=1` is set or `req.secure` is already true — which it never is without a TLS-terminating
reverse proxy, and nothing in `packaging/**` sets one up.
**Evidence**: code read of `config.ts:17-37`, `index.ts:27`, and the installer's LAN-bind branch; confirmed there is
no certificate handling, no `https.createServer`, and no bundled reverse proxy anywhere in `backend/`, `packaging/`
or the dependency list.
**Current implementation**: LAN mode is a supported, documented deployment option (an administrator opts in
explicitly) that serves the full application — login (password in the POST body), the session cookie, every
document — over unencrypted HTTP to anyone who can route to that host and port on the LAN.
**Recommendation**: either ship a TLS-terminating reverse proxy (even a minimal bundled one) as part of the LAN
deployment mode, or at minimum refuse to enable LAN bind without `AGASTYA_SECURE_COOKIES`/a configured certificate,
and say so loudly in the installer UI.
**Expected outcome**: the LAN mode either encrypts the wire or makes the administrator affirmatively accept the
cleartext risk rather than it being silent.
**Dependencies**: none in application logic; packaging/installer work.
**Risks**: TLS with a self-signed/local CA certificate on a LAN adds its own operational burden (certificate
distribution) — worth scoping as a deliberate decision, not a silent gap.
**Acceptance criteria**: LAN mode either terminates TLS or the installer explicitly warns and requires
confirmation before enabling it.
**Test cases**: packet capture on a LAN-bound instance during login shows the password in clear text today;
re-test after the fix.

### SEC-007 · P1 · VERIFIED · S · The rate limiter is keyed `username|ip`: unlimited username-rotation guessing, and shared-IP lockout of real users

**Category**: Brute-force / lockout.
**Problem**: `core/auth/rateLimit.js:19-21` keys every attempt by `username|ip`. Two consequences, both reproduced
live: (a) an attacker who rotates the *username* on every attempt from one IP is never throttled, because each
username has its own fresh counter; (b) because the same key also includes the IP, any other client sharing that
IP (a NAT gateway, a corporate proxy, or — see **SEC-008** — a reverse proxy that makes *every* client look like
the same IP) can trip the lockout for a username and lock the real account holder out too.
**Evidence**: live. 40 distinct usernames × 5 attempts each from one client = 200 login attempts, **0** blocked
(`429`). Separately, 14 bad logins against `alice` from one IP triggered lockout at attempt 11 (`429`,
`retryAfterSeconds: 866`); a *different* client, presenting `alice`'s own correct temporary password from the same
IP immediately afterward, was also refused with `429`.
**Current implementation**: no IP-only or global throttle exists alongside the per-pair one.
**Recommendation**: add a second, coarser limiter keyed by IP alone (catches username rotation) tuned loosely
enough not to make the shared-IP lockout problem worse; consider exempting a successful, already-known-good
credential from the shared-IP penalty (e.g. a sliding window per account that only counts *that account's own*
failures, combined with a separate, generous IP-wide cap against pure username enumeration).
**Expected outcome**: horizontal guessing across many usernames from one IP is throttled; a legitimate user behind
a busy NAT/proxy is not locked out by an unrelated failed attempt on their own username from someone else nearby.
**Dependencies**: **SEC-008** (fix the IP source first, or this gets worse, not better, behind a proxy).
**Risks**: a global IP limiter can itself be a denial-of-service vector for an office NAT — tune generously and log
for review rather than hard-blocking at a low threshold.
**Acceptance criteria**: 200 attempts across 40 usernames from one IP trips a throttle before the policy's worst
case; a shared-IP legitimate user is not blocked by a third party's unrelated failures within a reasonable bound.

### SEC-008 · P1 · VERIFIED (code) · M · `clientIp()` reads the raw socket peer, ignoring the declared reverse-proxy deployment

**Category**: Trust boundary / audit integrity (cross-references agent A's **PLT-023**).
**Problem**: `context.ts:107-108` and the duplicate in `core/auth/routes.js:58` both compute the client IP as
`req.socket.remoteAddress` — the raw TCP peer — while `app.ts:43` explicitly declares `app.set('trust proxy', 1)`,
i.e. the product expects to run behind exactly one reverse-proxy hop. Express's own `req.ip` already does the
right proxy-aware computation (and is in fact relied on elsewhere for `req.secure`), but this custom helper bypasses
it. Behind the declared proxy topology, `req.socket.remoteAddress` is **always the proxy's own address**, identical
for every client.
**Evidence**: code read; deterministic given Express/Node semantics (no live multi-client proxy was stood up, since
doing so would require infrastructure outside the scratch-port allowance — this is a direct consequence of the
code, not a probabilistic one).
**Impact**: every row this IP feeds — the rate limiter (**SEC-007**, making its already-weak per-IP half
collapse to "the whole proxied population shares one bucket") and the **audit log** (every `ip` column reads the
same proxy address platform-wide, destroying IP attribution for forensics) — is wrong in the one deployment shape
the code explicitly says it supports.
**Recommendation**: use Express's `req.ip` (which already honours `trust proxy`) everywhere `clientIp()` is used
today, or compute the same X-Forwarded-For-aware value once and pass it through.
**Expected outcome**: correct, distinct client attribution behind the declared one-hop reverse proxy.
**Dependencies**: **SEC-007**.
**Risks**: `X-Forwarded-For` is attacker-suppliable if `trust proxy` is misconfigured to trust more hops than
actually exist — keep it at exactly 1, matching the existing setting, and document that assumption.
**Acceptance criteria**: behind a proxy that sets `X-Forwarded-For`, the audit log and rate limiter both record the
real client address, not the proxy's.

### SEC-009 · P1 · VERIFIED · S/M · Stored content served as `image/svg+xml` with no sanitisation or protective headers

**Category**: Stored XSS.
**Problem**: `POST /api/projects/:id/media` (`routes/project-content.ts:185-197`) accepts any file matching
`IMAGE_EXT = /\.(png|jpe?g|gif|svg|bmp|webp)$/i`, including `.svg`, with **no** content inspection — an SVG may
freely contain `<script>`. `GET /api/projects/:id/media/:name` (`project-content.ts:180-184`) serves it back via
`res.sendFile` with the browser-inferred `Content-Type: image/svg+xml` and **no** `X-Content-Type-Options`, no
`Content-Security-Policy`, no `Content-Disposition`. The in-app UI only ever references these URLs from `<img
src>` (every call site in `frontend/src` checked), which does not execute embedded scripts — but the browser's own
"open image in new tab" context-menu action on any such `<img>` navigates to the raw URL directly, dropping the
image-document restriction and executing the SVG's script in the application's authenticated origin, with the
viewer's session cookie.
**Evidence**: live round-trip — uploaded a plain SVG to `/media`, fetched it back: `Content-Type: image/svg+xml`,
`content-security-policy: null`, `x-content-type-options: null`, `content-disposition: null`.
**Current implementation**: the extension allow-list is the only check; no SVG sanitiser (e.g. stripping
`<script>`/event-handler attributes), no serving-time hardening.
**Recommendation**: either sanitise SVGs on upload (strip scripts/foreign objects/event handlers) or serve them
with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` so a direct navigation downloads
rather than renders them; add CSP app-wide regardless (**SEC-??** header gap below) as defence in depth.
**Expected outcome**: an uploaded SVG can never execute script in the application's origin, however it is opened.
**Dependencies**: the missing-headers gap documented in the checklist table; fixing that app-wide (CSP,
`X-Content-Type-Options: nosniff`) mitigates this and every future injection surface at once.
**Risks**: sanitising must not break legitimate decorative SVGs (gradients, `<use>`, embedded fonts) used as
drawing artwork elsewhere in the product.
**Acceptance criteria**: an SVG containing `<script>`, opened directly (not via `<img>`), does not execute it.
**Test cases**: (1) upload + direct navigation to a script-bearing SVG; (2) a legitimate vector logo still renders
correctly in the UI.

### SEC-010 · P1 · VERIFIED · S · WebSocket connections are not closed when the underlying session is revoked

**Category**: Session lifecycle (cross-references agent A's **PLT-017**).
**Problem**: `services/broadcast.ts` authenticates only once, at the HTTP Upgrade handshake
(`authForUpgrade`, `authz.js:235-237`, itself correct), then keeps the resolved `user` object in a long-lived
in-memory `Set` for the socket's whole lifetime (`broadcast.ts:16-36`). Every subsequent `broadcast()` call
re-authorises against that **stale, never-refreshed** `user` snapshot (`broadcast.ts:44-50`) — it does not re-check
whether the session was revoked, the account disabled, or the user's project role changed.
**Evidence**: live. Admin-disabled a connected user's account; the HTTP session died immediately (`GET /auth/me` →
401), but the same user's open `/ws` socket remained `readyState === OPEN` a full second later with no server-side
close.
**Current implementation**: no hook from logout/disable/session-revoke/role-change into `broadcast.ts`'s client
set.
**Recommendation**: on logout, admin-disable, admin session-revoke and role change, look up and close any open
socket(s) for that user (or re-validate the session on every `broadcast()` call instead of trusting the cached
object), matching the same immediacy the HTTP session already gets.
**Expected outcome**: revoking access cuts off live push messages at the same moment it cuts off the REST API.
**Dependencies**: `core/auth/sessions`, which already knows how to revoke — needs a way to notify `broadcast.ts`.
**Risks**: low; the message content itself (build progress, project id, error text) is not highly sensitive, so
this is a lifecycle-correctness fix more than an acute data-exposure one — tracked at P1 because "revoked access
stays live" is exactly the property a defence/aerospace deployment would audit for.
**Acceptance criteria**: disabling or logging out a user closes their open `/ws` socket within one broadcast
cycle.

### SEC-011 · P0 · VERIFIED (jointly with agent C's PUB-002) · M · `xi:include` targets are not checked by the XML guard, and local file content reaches the rendered PDF

**Problem**: `checkXmlSafety` only ever looks at `<!DOCTYPE...>`; an `xi:include href="file:///..."` (or a relative
path escaping the project) needs no DOCTYPE at all and sails through unexamined
(`core/auth/xmlGuard.js:49-156` — no XInclude handling anywhere in the file). The build pipeline later runs
`xsltproc --xinclude` (`vendor/engine/build.js:479-498`), which *does* resolve such includes (`--nonet` blocks
network fetches, not local file reads, per the pipeline's own documenting comment at `xmlGuard.js:25-41`).
**Evidence**: `checkXmlSafety('<dmodule xmlns:xi="..."><xi:include href="file:///C:/Windows/win.ini" parse="text"/></dmodule>')`
→ `{ ok: true }` (reproduced directly against the live guard module).
**Recommendation**: extend the guard (or a sibling check run at the same point) to refuse `xi:include`/`xi:fallback`
`href` values that are absolute, carry a drive letter, a non-`http(s)` scheme, or escape the project tree — the
same `safeIdentifier` rule already used for DOCTYPE external IDs.
**Acceptance**: the reproduction above returns `{ ok:false }`; a save containing such an `xi:include` is refused
the same way a classic XXE already is.
*(Originally scoped as P2 because the full "ends up readable in the rendered output" chain was not completed
within this audit's own time budget; agent C independently completed that exact chain live on the JSS
ancillary-page route (PUB-002) — see the Cross-agent verification addendum below. With that confirmation this
should be treated as **P0**, same severity class as SEC-001/SEC-003, not left at P2.)*

### SEC-012 · P2 · OBSERVED · S · The audit log fails open and its secret-redaction filter is too broad to be reliable

**Problem**: `context.ts:96-105 audit()` wraps the write in try/catch and, on failure, only logs to `console.error`
— **the operation it describes always proceeds** regardless of whether the audit row was written, with no
alerting. Separately, the redaction filter (`context.ts:99-101`,
`/password|hash|token|secret|cookie|credential/i` tested against *object keys*) silently drops any field whose
*name* merely contains one of those substrings, including legitimate, non-secret fields such as `contentHash` used
for release fingerprinting.
**Evidence**: deterministic reproduction of the exact filter logic:
```js
JSON.stringify({ contentHash: 'abc123', fingerprint: 'zzz' },
  (k, v) => /password|hash|token|secret|cookie|credential/i.test(k) ? undefined : v)
// -> {"fingerprint":"zzz"}   (contentHash silently gone)
```
**Recommendation**: redact by matching the *value shape* (long opaque strings) or an explicit per-call-site deny
list, not a blanket key-name regex; raise an alert (not just a console line) when an audit write fails, and consider
whether a security-sensitive action should be blocked rather than allowed through when its own audit record cannot
be written.
**Acceptance**: a `release.requested`-style event retains its `contentHash`/fingerprint in the stored audit row;
a simulated audit-store failure is visible somewhere an operator will see it, not only in a log file.

### SEC-013 · P3 · OBSERVED · S · The generic error handler echoes the raw exception message

**Problem**: `services/http.ts:33` returns `details: (e as Error).message` on any uncaught 500, which can include
internal file paths, library error text, or other implementation detail, to any authenticated caller.
**Evidence**: `app.ts:110-115`'s top-level handler and `http.ts:wrap`'s per-route catch both do the same.
**Recommendation**: log the full message/stack server-side (already done) but return a generic message plus a
correlation id to the client.
**Acceptance**: a forced 500 returns no `details` field containing a file path or library-internal string.

### SEC-014 · P3 · OBSERVED · S · Exported package/delivery ZIPs are always named "project"

**Problem**: `routes/packages.ts:143,152` builds the download filename from `req.project.name`, but the
`requireProject` guard only ever sets `req.project = { id, dir, role, row }` (`core/auth/authz.js:218`) — there is
no `.name` property, so the template literal always falls back to `'project'` regardless of the real project name
(cross-references agent A's lead). Not a security issue; a confirmed UX/correctness bug.
**Evidence**: code read of both sites; `authz.js:218` is the complete object literal, with no `name`.
**Recommendation**: use `req.project.row.name` (or add `name` to the guard's object) at both call sites.
**Acceptance**: an exported project/delivery package's filename contains the actual project name.

## Findings — Reliability / data integrity (REL)

### REL-001 · P1 · OBSERVED (partially tested live) · M · Data-module and project-file writes are not atomic

**Problem**: `services/csdb.ts:206 writeDm` and `:226 createDm` call `fs.writeFileSync(abs, xml, 'utf8')` directly
on the live file, with no write-to-temp-then-rename and no fsync; `services/projects.ts updateProjectJson` does the
same read-modify-`fs.writeFileSync`-whole-file pattern on `project.json`, the one file every route reads first.
**Evidence**: live experiment — a tight loop alternately `PUT`-saved two different-sized (≈6 MB / ≈9 MB) versions
of one data module while `taskkill /F` was issued against the scratch server process (started by this agent,
PID recorded in `scratchpad\S\server.pid`) mid-loop. After restart, the file on disk was exactly one complete
version (byte-for-byte), and the WAL-backed SQLite registry (`vendor/engine/db.js:21`) replayed cleanly with no
corruption — i.e. the **database** is crash-safe by construction (WAL) while **ordinary project files are not**,
and this one attempt happened not to catch a torn write; the code gives no guarantee it would not on a slower disk
or a larger file.
**Recommendation**: write to `<file>.tmp-<random>` in the same directory, `fsync`, then atomically rename over the
target (the standard safe-write pattern on NTFS too, via `MoveFileEx`/`fs.renameSync`), for every write that
replaces a live, already-referenced file (`project.json`, every data module, `publication.xml`, house templates).
**Acceptance**: the same kill-mid-write experiment, repeated under heavier load (larger files, slower disk, more
iterations), never leaves a file that is neither the old nor the new complete version.

### REL-002 · P1 · OBSERVED · S · The Common Information Repository's writes skip optimistic-concurrency checking

**Problem**: every ordinary data-module save forwards the editor's `baseHash` so `writeDm` can detect a concurrent
edit (`services/csdb.ts:201-204`); the CIR's own copy-in/sync code calls `writeDm` with `baseHash` hard-coded to
`undefined` (`services/cir.ts:110,192`), which makes the `if (baseHash && ...)` conflict check a no-op. The CIR is
explicitly the one workspace "open to everyone" (per the platform's own auth-model notes), so it is the single
place concurrent collisions are *most* likely, yet the one place the lost-update guard is disabled.
**Recommendation**: thread the real current hash through the CIR sync path the same way every other caller does,
or add an explicit last-writer-wins acknowledgement in the UI if that is the intended behaviour for this one
repository.
**Acceptance**: two concurrent CIR edits to the same module produce a conflict response for the second writer,
exactly as an ordinary project's data module already does.

### REL-003 · P1 · VERIFIED (code) · S · Graceful shutdown races a flat 500 ms timer instead of waiting for in-flight work

**Problem**: `backend/src/index.ts:56` — on `SIGINT`/`SIGTERM`/stdin-close, `stop()` (closes the HTTP server,
renderer, broadcaster) is called, then `process.exit(0)` fires unconditionally **500 ms later**, regardless of
whether `server.close()`'s own completion callback has fired or any in-flight request (a multi-second FOP build, a
large file write) has finished.
**Evidence**: direct read of `index.ts:54-66`; `server.close()` is called but its callback is not awaited before
the timer-driven exit.
**Recommendation**: await `server.close()`'s callback (with a generous but finite cap, e.g. 30s, logging anything
still in flight after that) before exiting; the comment already present at `index.ts:59-60` shows the team
understands the Windows stdin-close path exists precisely to avoid cutting the database off mid-write — the current
500 ms timer undermines that intent for anything slower than half a second.
**Acceptance**: a build or large save in progress when a clean shutdown is requested completes (or is cleanly
aborted and reported) before the process exits, under a bounded, logged timeout.

### REL-004 · P1 · OBSERVED · M · Project-archive restore can leave a half-created project if the process dies mid-import

**Problem**: `services/projectArchive.ts:restoreProjectArchive` creates the new project row/directory
(`createProject`, step 2) and starts streaming files into it *before* the configuration/index steps (5-6) run; the
`opts.discard` cleanup (used by the `/api/xengine/import` caller) only fires on a **caught exception** inside the
same function — a process crash or kill between steps leaves a registered, partially-filled project with no
automatic cleanup on the next start.
**Evidence**: code read of `projectArchive.ts:160-210`; `reconcileRegistry()` (`index.ts:20`, called on every
start) was not traced far enough to confirm whether it detects and repairs/quarantines such a half-imported project
— flagged as a gap rather than asserted as unhandled.
**Recommendation**: either make the whole import transactional from the caller's perspective (stage into a temp
directory, rename into place only on full success — the same atomic-rename idea as REL-001) or have
`reconcileRegistry()` explicitly detect and flag an incompletely-imported project on next start.
**Acceptance**: a kill mid-import, followed by a server restart, results in either a complete project or a clearly
flagged/removed incomplete one — never a silently half-filled project a user can open.

### REL-005 · P2 · OBSERVED · — · Audit-log fail-open and over-broad redaction is also a forensics/reliability gap

Same root cause as **SEC-012**; recorded here too because a defence/aerospace deployment's recovery and incident
playbooks depend on the audit trail being complete, and today it silently is not (fields dropped, failures
unalerted).

### REL-006 · P2 · VERIFIED (closed in Addendum 2) · S · Sessions survive a restart; the login lockout does not

**Update (Addendum 2, live test):** a session cookie issued before a restart still returned 200 on `/api/auth/me`
after the scratch server was killed and started again (tokens are DB-stored hashes); an account locked out before
the restart (10 failures, then HTTP 429) accepted attempts again right after it (HTTP 401, no 429), so the lockout
counters are in memory only. Every restart, crash loop or service recycle therefore resets all brute-force
counters; sessions are unaffected. The original text below is kept for the record.

**Problem** (original, now answered): whether in-memory rate-limit counters and/or sessions survive (or are deliberately reset by) a server
restart was not directly tested in this audit (the scratch-server kill experiment focused on file-write atomicity,
not session/limiter state). `core/auth/sessions`/`rateLimit.js` were read for logic, not for persistence; if either
is purely in-memory, a restart silently clears all lockouts (a minor reliability nicety, not a regression) and
could also silently log every user out depending on how sessions are stored (the session **tokens** are DB-stored
hashes per the earlier model, which would survive — but this was not re-confirmed with a live restart-and-reuse-
cookie test). Recommendation: add that specific restart test in a follow-up pass; until then this is explicitly
**NOT VERIFIED** either way.

### REL-007 · P2 · OBSERVED · S · Uploads are fully memory-buffered with no aggregate cap enforced before buffering

**Problem**: `routes/importer.ts:40` sets `multer({ storage: multer.memoryStorage(), limits: { fileSize: 512MB,
files: 5000 } })`; the code's own `MAX_PACKAGE_BYTES` (1 GB) total-size check (`importer.ts:99`) runs only **after**
multer has already buffered every file into process memory — multer's `limits` option has no total-bytes cap, only
per-file and file-count caps, so a well-formed request with many large files can hold substantially more than 1 GB
in memory simultaneously before the application-level check rejects it. The project-content media/graphics upload
routes use the same `memoryStorage()` pattern.
**Recommendation**: stream uploads to a temp directory on disk (as `services/uploads.ts diskUpload` already does
for at least one route) and check the running total as each part arrives, rejecting before the rest is read.
**Acceptance**: a crafted multipart request designed to approach the file/count limits does not cause the server's
RSS to spike past a bounded, documented ceiling.

## Strengths

- **One-guard-per-route** is real: all 283 live API routes carry exactly one recognised auth-guard marker (dumped
  from the running route table); no route was found with zero or conflicting guards.
- First-run **setup race** is correctly closed with a transactional guard: 8 concurrent `POST /api/auth/setup`
  calls produced exactly one administrator and seven `409`s.
- **CSRF** is handled well for a cookie-based app with no separate token: the global Origin check
  (`app.ts:54-63`) covers every non-GET/HEAD/OPTIONS request including multipart uploads, verified live against a
  cross-origin POST and an `Origin: null` POST.
- **Password/username enumeration via timing** is explicitly defended (`core/auth/crypto.js:62-68 dummyVerify`,
  constant-cost verification against a throwaway hash when the username does not exist).
- **Command execution** is uniformly `execFile`/`spawn` with argument arrays throughout the live code paths; the
  one shell-`exec` helper found is dead code, confirmed unexported and uncalled.
- **ZIP handling** (`services/zipio.ts`, `services/importer/zipRead.ts`) correctly normalises and refuses
  traversal, absolute paths and drive letters at the entry-name layer — the vulnerabilities found are one layer up
  (trusting the *contents* those ZIPs are allowed to carry), not in the ZIP mechanics themselves.
- **WebSocket handshake authentication** is correctly done from the same session cookie/store as the REST API, with
  no fallback to an unauthenticated connection (verified live: no cookie → 401; garbage cookie → 401).
- **SQL injection**: every query site reviewed uses parameterised statements or constant SQL text; none was found
  concatenating request data into SQL.
- The non-admin **backup/export** endpoint is correctly scoped to only the calling user's own accessible projects
  (`services/backup.ts`), despite initially looking suspicious as "any signed-in user can call `/api/backup`".

## Data integrity

- **Optimistic concurrency** (hash-based conflict detection) is the standard pattern for data-module saves and
  works correctly where used — except the CIR path (**REL-002**), which disables it.
- **WAL-mode SQLite** (`vendor/engine/db.js:21`) gave a clean recovery from a hard kill in the live experiment
  (REL-001): the registry itself is crash-safe; the project files it indexes are not.
- **Doubled-content detection** (`services/csdb.ts isDoubledXml`, used by `validateContent`) and the **publish
  gate** (`services/publishGate.ts`, not separately detailed above but consistent with the XSD/BREX checks already
  reviewed under SEC-001/011) are real content-integrity controls that run before anything is accepted — they are
  simply downstream of, and therefore blind to, whatever the XML-safety guard already let through.
- **No checksum or signature** travels with a project archive export/import (**SEC-002**'s route) — the manifest's
  `generator` field is a trust marker in name only, not a cryptographic one, so "this archive was made by Agastya"
  is unverifiable and spoofable by design today.

## Recovery strategy

| Capability | State | Evidence |
|---|---|---|
| Crash recovery — DB | **Good** | WAL mode; verified clean recovery after a hard kill (REL-001) |
| Crash recovery — project files | **Gap** | no atomic write pattern (REL-001) |
| Interrupted import (half-created project) | **Gap** | discard only on caught exception, not a crash (REL-004) |
| Interrupted publish | **Not separately verified** | FOP writes are not confirmed atomic either; not reproduced live (time) — **NOT VERIFIED** |
| Non-atomic writes | **Confirmed gap** | REL-001 |
| Transaction use for multi-step state changes | **Mixed** | `core/auth/store.js` uses `BEGIN`/`COMMIT`/`ROLLBACK` consistently for its own tables; cross-cutting operations that touch both the DB and the filesystem (e.g. archive import) have no equivalent two-phase guarantee |
| Idempotent processing / safe retries | **Not verified** | not exercised in this pass |
| Backup integrity / restore verification | **Partial** | export is correctly scoped (see Strengths); no checksum travels with it, and restore trusts the archive's own `project.json` unvalidated (SEC-002) |
| Rollback on failed upgrade/migration | **Not independently re-verified** here (reported elsewhere as a pre-upgrade `--backup-db` step; out of this pass's time budget to re-confirm) |
| Structured error reporting | **Partial** | consistent `HttpError`→JSON shape (`services/http.ts`), but leaks raw messages (SEC-013) and the audit trail that should accompany recovery is itself lossy (SEC-012) |

## Single points of failure

1. **One SQLite file** (`publisher.db`) for the entire registry — WAL protects against a crash, not against disk
   loss; no replication is in scope for an offline product, but backup *frequency/verification* was not found to
   be automated (see Backup integrity row above).
2. **One warm FOP/JVM renderer process** per server instance (`vendor/engine/fopd.js`) — every build in the system
   funnels through it; no evidence of a queue depth limit beyond the HTTP request itself (REL findings list this
   as an unbounded-concurrency risk, not confirmed crashed under load in this pass).
3. **One `project.json` per project**, non-atomically written (REL-001), read by every route for that project before
   anything else — its corruption takes the whole project down at once.
4. **The installer's shared-ACL data directory** (SEC-005) is a single point of *compromise*, not just failure: any
   one of potentially many local accounts can take down or corrupt every project on that machine.
5. **The in-memory WebSocket client registry** (`services/broadcast.ts`) is rebuilt from nothing on restart; not a
   data-loss risk (it only carries live progress messages) but worth noting as state that does not survive a
   restart, consistent with REL-006's open question about what else doesn't.

## Hardening checklist by deployment mode

**Standalone (single workstation, `127.0.0.1`)**
- Apply SEC-001/002/003 fixes regardless of bind address — all three are reachable by any authenticated user on
  the box, not just over a network.
- Apply SEC-005 (installer ACLs) even here: "standalone" still means other local accounts on the same machine.
- Add security headers (SEC-009's dependency) — a local attacker is still a browser threat model (another local
  user, a malicious extension, a compromised update).

**Client-server / LAN (installer `/LAN`, multiple workstations)**
- SEC-006 (TLS) is mandatory here, not optional, before enabling `/LAN`.
- SEC-007/SEC-008 (rate-limiter keying and IP source) matter most here, where many real users plausibly share a
  gateway IP.
- SEC-010 (WebSocket revocation) matters most here, where "revoke this person's access right now" is a realistic
  administrative action during active use by others.

**Every mode**
- SEC-001, SEC-002, SEC-003, SEC-004, SEC-009, SEC-012 apply unconditionally and should be the fix priority order
  (all P0/P1, all independent of deployment topology).
- Add the missing security-header middleware once, centrally, in `app.ts` rather than per-route.

## VERIFIED vulnerabilities vs. theoretical risks

| Finding | Status |
|---|---|
| SEC-001 (XML guard decoy-comment bypass) | **VERIFIED vulnerable** — live exploit against the real save route |
| SEC-002 (cross-project IDOR / path traversal, incl. forged archive) | **VERIFIED vulnerable** — two independent live exploit chains |
| SEC-003 (SSRF via publisher logo) | **VERIFIED vulnerable** — live outbound request captured |
| SEC-004 (temp-password pre-hijack) | **VERIFIED vulnerable** — live account takeover |
| SEC-005 (installer ACLs) | **VERIFIED** (by direct reading of the deterministic installer script; not run against a live install) |
| SEC-006 (no TLS in LAN mode) | **VERIFIED** by code (no TLS code path exists); not packet-captured live |
| SEC-007 (rate-limiter keying) | **VERIFIED vulnerable** — live, both directions |
| SEC-008 (clientIp ignores trust proxy) | **VERIFIED** by code; **not** reproduced behind an actual proxy (would need infrastructure outside the scratch-port allowance) |
| SEC-009 (SVG stored XSS) | **VERIFIED** the upload/serve mechanics; browser script execution itself asserted from well-known `<img>`→"open in new tab" behaviour, not captured in an actual browser from this environment |
| SEC-010 (WS survives revoke) | **VERIFIED vulnerable** — live |
| SEC-011 (`xi:include` unchecked) | **VERIFIED vulnerable** — guard gap verified by me; full disclosure-into-output chain verified live by agent C (PUB-002) |
| SEC-012 (audit fail-open / over-redaction) | **VERIFIED** by direct reproduction of the redaction logic; fail-open path read, not forced live |
| SEC-013/SEC-014 | **VERIFIED** by code read (deterministic, low-severity) |
| REL-001 (non-atomic writes) | **Code: VERIFIED** gap exists; **live kill test**: ran, did not happen to catch a torn write this attempt — correctly reported as inconclusive-by-experiment, unambiguous-by-code |
| REL-002/003/004/007 | **OBSERVED** (code-level, deterministic given the code shown) |
| REL-006 | **VERIFIED** in Addendum 2 (sessions persist; lockout counters reset on restart) |

## Cross-agent verification addendum

Several leads arrived mid-audit from other agents' sweeps. Per the brief, each was independently checked rather
than taken on trust; results are folded in here with cross-references instead of re-proving what another agent
already demonstrated live.

- **PUB-001** (agent C, JSS/JSG; generalises agent B's S1K-001 and my **SEC-002**): C reports the same unvalidated
  `input.pm`/`csdbDir`/`mediaDir` traversal live-exploitable through `GET/PUT /api/projects/:id/jss` as well,
  reading `publisher.db` and writing outside `projects\`. I did not re-run this myself (no duplicate proof needed);
  I confirm by code that `routes/jss.ts`/`routes/jsg.ts` sit on the exact same `services/projects.ts`
  `csdbRel`/`mediaRel`/`pmRel` helpers as the S1000D routes I exploited, so the same root cause and the same fix
  location in **SEC-002** cover it. C additionally found that fixing those three helpers alone is **not
  sufficient**: `services/publisher.ts` reads `project.input?.pm`/`csdbDir`/`mediaDir` **raw**, bypassing the
  helpers entirely, in roughly a dozen places (around lines 186, 193, 239, 260, 358, 392, 442, 467, 509-541 per
  C's count — not line-by-line re-verified by me, but the pattern is consistent with every other raw `project.input`
  read already catalogued under SEC-002). **Verdict: confirms and widens SEC-002** — the recommended fix must
  validate at the single **write** point (`updateProjectJson`/archive-merge), not rely on every reader checking
  for itself, which is exactly what I already recommended; this addendum exists to record that a reader-side-only
  fix (e.g. patching only `csdbRel`/`mediaRel`/`pmRel`) would still leave `publisher.ts`'s raw reads exposed to any
  `project.json` already on disk from before the fix ships — **existing data needs a migration/sanitisation pass,
  not just a guard on new writes.**
- **PUB-002** (agent C): reports that `xi:include` inside a JSS ancillary page (`services/jss/ancillary.ts:89`,
  resolved by `vendor/engine/build.js:497 --xinclude`) puts an arbitrary local file's content into the rendered
  PDF — i.e. C completed, for the JSS ancillary-page path, exactly the "guard gap → content actually lands in
  output" chain I left as **SUSPECTED/NOT VERIFIED** in **SEC-011** for time reasons. **Verdict: upgrades SEC-011
  from SUSPECTED to VERIFIED** for the JSS ancillary-page route specifically (cross-reference PUB-002 for the
  live proof); I did not re-run it. The fix recommended in SEC-011 (validate `xi:include href` the same way as a
  DOCTYPE external id) stands unchanged and now has a confirmed live exploit behind it, not just a guard-level gap.
- **PUB-014** (agent C): JSS/JSG document sources are never passed through `checkXmlSafety` at all. **I verified
  this independently**: `grep -n "checkXmlSafety|xmlGuard" services/jss/service.ts services/jsg/service.ts
  routes/jss.ts routes/jsg.ts` returns **no matches**, and the save path itself
  (`services/jss/service.ts:143`, `services/jsg/service.ts:197`, both a bare `fs.writeFileSync(abs, xml, 'utf8')`
  reached from `PUT /api/projects/:id/jss`, `routes/jss.ts:50`) has no safety check of any kind before writing. This
  is a materially different — and worse — finding than **SEC-001**: SEC-001 is a *bypass* of a guard that exists;
  for JSS/JSG document saves, *no guard exists to bypass*. Classic XXE/entity-bomb payloads need no decoy comment
  at all on this path. **Verdict: VERIFIED by independent code read; treat as part of SEC-001's fix scope** — the
  fix for SEC-001 must also **wire `checkXmlSafety` into the JSS/JSG save paths**, not just repair the DOCTYPE-scan
  logic for the S1000D path that already calls it.
- **jsg/service.ts:251 allows a `..` graphic path** (agent C): I verified this independently. The check is
  `/^(https?:|file:|[a-z]:[\\/]|\/)/i.test(n.attrs.src)` (`services/jsg/service.ts:251`) — it only refuses an
  **absolute** path, a drive letter, or a URL scheme; a relative value such as `../../canary/secret.png` matches
  none of those and passes unflagged. **Verdict: VERIFIED by code read** — same class of bug as SEC-002/SEC-003
  (an allow-list that checks the wrong thing), different call site; recommend the same `safeRelPath` reuse.
- **`vendor/engine/paths.js:184` `childEnv` copies the whole parent environment to child processes**: verified by
  code read (`paths.js:184-199`: `{ ...process.env, ...(extra || {}) }`, passed to the `execFile`/`spawn` calls in
  `build.js`/`fopd.js`). This is standard, low-risk behaviour for a locally-spawned trusted binary (Java/xsltproc)
  with no attacker-controlled environment variables feeding in anywhere I found — **verdict: OBSERVED, not
  escalated to a finding**, since no path from request input to an injected environment variable was found; noted
  here only because it was asked about, per the brief's instruction never to call something a vulnerability
  without a shown attacker-input-to-impact path.
- **`routes/project-content.ts:442-452` lets a `PUT /settings` body delete `authoring`/`format`** (agent C): this
  is the same unrestricted `Object.assign(pj, project)` wholesale-replace already cited as the write mechanism in
  **SEC-002**'s evidence; I did not separately re-test deleting `authoring`/`format` specifically, but the
  mechanism (every key the caller does not explicitly list in `keep` is discarded, then overwritten by whatever the
  caller sent) is the same one SEC-002 already exploits for `input.*` and SEC-003 for `publishers[]`. **Verdict:
  same root cause as SEC-002, no separate finding needed** — the fix there (validate specific known-sensitive
  fields, or move to an explicit per-field PATCH instead of whole-object replace) resolves this too.
- **`$&` in a book name corrupting XML (PUB-024)**: a `String.prototype.replace(pattern, userString)` call where
  a literal `$&`/`$1`-style sequence in attacker-supplied text (a project/book name) is interpreted by `replace` as
  a backreference rather than literal text, corrupting the generated XML. Not independently re-verified (no spare
  time in this pass); recorded here as **NOT VERIFIED (by me)**, correctness bug rather than a security one on the
  face of it — cross-reference PUB-024 for whichever report carries the detailed proof.

## Unknowns and limitations

- **`xi:include` full exploit chain** (SEC-011): confirmed the guard does not inspect it; did not complete a live
  build that proves file content actually reaches the rendered PDF/FO output, for time reasons.
- **Packaged-build argon2 availability**: not checked — no installer build was attempted (hard rule).
- **Session/rate-limiter persistence across a restart** (REL-006): closed in Addendum 2 (live restart test).
- **Interrupted-publish atomicity**: not reproduced live (a kill mid-FOP-render was not attempted; the file-write
  kill experiment only targeted a data-module save).
- **SEC-009's final step** (script execution inside an actual browser) rests on well-documented `<img>`/SVG
  same-origin-navigation behaviour rather than a captured screenshot from a real browser, since no browser was
  available in this execution environment.
- **Installer ACL/service findings** (SEC-005, and the TLS/LAN finding SEC-006) were verified by reading the
  deterministic Inno Setup/C# source, not by running an actual installation — the hard rules forbid building/
  installing in this environment.
- Did not fuzz either ZIP reader with a crafted ZIP64 archive, an alternate-data-stream entry name
  (`name:stream`), or a Windows reserved device name (`NUL.png`, `COM1.xml`) — code reading shows the DM-file-name
  regex (`DMC-*.xml`) and `path.basename` stripping would prevent most of these from mattering for data-module
  writes specifically, but this was not exhaustively tested for every upload route.
- Supply-chain review covered `npm audit` only; the bundled binaries (FOP 2.10, Temurin JRE 21.0.13.1, libxslt
  1.1.28, xmllint-wasm, Ghostscript) were identified and version-matched against their own advisories only to the
  extent time allowed in this pass — a dedicated CVE pull per binary (with citations) was not completed and should
  be treated as a follow-up, not as "checked and clean."
- This report's findings were produced by one agent against one scratch instance; cross-cutting items already
  shared with other agents' areas (archive import, WebSocket, installer ACLs, audit redaction) are noted inline
  above rather than re-litigated from scratch in each report.

## Addendum 2 — four leads from agent J, plus a re-check against other agents' reports

Scratch instance only (127.0.0.1:4060). Probes: `scratchpad\S\probe\p12`..`p16`. Next free numbers used: SEC-015..017, REL-008.

| Lead (J, section 8) | Verdict | Where |
|---|---|---|
| 1. `innerHTML` with attacker-controlled document content | **Not a problem** (VERIFIED by code read; no browser run) | below |
| 2. 46 bare `requireAuth()` routes: missing ownership checks (IDOR) | **No new IDOR.** Checks live inside the handlers and held under attack. Real weaknesses: `/api/xengine/import` (SEC-002, not new) and the CIR (SEC-017, new) | below |
| 3. Audit-CSV formula injection (`services/platform.ts:84`) | **Not exploitable today** (VERIFIED live); the sibling SNS CSV exports **are** (SEC-015) | SEC-015 |
| 4. 7-day absolute session, no idle timeout | **VERIFIED**, P2 on shared workstations | SEC-016 |

### Lead 1 — `innerHTML` (verdict: not a problem)

I listed every non-empty `innerHTML` / `insertAdjacentHTML` / `document.write` in `frontend/src`: 11 in `jsg/` (`editor.ts:516`, `ispl-editor.ts:134`,
`ispl-preview.ts:111,113,138,141,143,146,148`, `shared.ts:215,221`), plus `studio/view/render.ts:405` and `studio/ui/panels.ts:651` (constant markup) and
`studio/ui/app.ts:880`. The other 11 only assign `''`. J's 25 is the sum.
- Text and attributes: every interpolated string goes through `escH` (`jsg/shared.ts:33`: `& < > "`), including `data-to` (`editor.ts:28`), `<img src>`
  (`escH(imageUrl(..))`), plate, part and index cells (`ispl-preview.ts:117-135`) and the picture dialog (`shared.ts:221`).
- The one unescaped interpolation is the tag name in `inlineHtml()` (`editor.ts:29`, `` `<${i.mark}>` ``). `mark` has two sources and both are whitelists:
  `jsg/xml.ts:11,29` (`MARKS = b,i,u,sup,sub`; any other element in a text run makes `parseJsg` throw "is not allowed inside text") and `readInline()`
  (`editor.ts:22,42`, `MARK_TAGS`). The server returns XML, never JSON, so no path skips `parseJsg`.
- Word import is server side (`routes/jsg.ts:78` -> `services/jsg/docx.ts`, `@xmldom/xmldom`, no entity fetching) and ends as JSG XML, parsed by the same whitelist;
  so does a shared project's XML. Paste is plain text (`editor.ts:253`); pasted HTML tables are read with `DOMParser` into `textContent` only (`editor.ts:268`).
- `app.ts:880` builds a file **download** from the already-rendered DOM, with `escapeHtml(title)` and a regex-checked `lang`; it is not an app-origin sink.
- Residual: a future edit adding a mark or an unescaped field. **RECOMMENDATION** (P3): `if (!MARKS.includes(i.mark)) return ''` inside `inlineHtml`. The stored-content
  path (SVG/media served as-is) is a different, server-side sink: SEC-009.

### Lead 2 — bare `requireAuth()` routes (verdict: held; probed with four non-admin users on 4060)

| Route group | Test | Result |
|---|---|---|
| `PATCH/DELETE /api/folders/:key`, `GET/PUT .../access` | B vs a folder owned by C: first invisible, then granted `viewer` | invisible: 404 on all four. Visible: **403** on all four (`services/projects.ts:431-497`, `canManageFolder`). Self-grant to `owner` refused; filing a project into C's folder 404 |
| `POST /api/invitations/:id/accept` and `/decline` | B uses E's invitation id | 404 both; E's invitation untouched (`store.js:1183,1200` bind `user_id`) |
| `POST /api/notifications/read` | B sends ids 1..50 | only B's rows touched (`store.js:828`) |
| `GET /api/graphics`, `/api/overview`, `POST /api/projects` with `from=` | B reads or copies C's project | graphics lists only B's projects; copy from a non-member project: 404 |
| `POST /api/cir/:id/copy`, `DELETE /api/cir/:id` | B into C's project; author deleting | 404 (editor check in the handler); author 403 `CIR_DELETE_ROLE` (`cir.ts:120`) |
| `/api/cir/:id` file parameter | `resolveDmFile` | regex `DMC-...xml` plus a `dirname` check (`csdb.ts:43-49`): no traversal through this parameter |
| `/api/projects/import/detect` and `/import` | token ownership | 128-bit random token bound to `userId` (`routes/packages.ts:75,83`) |
| `/api/brand-packs/:id/logo` | id syntax | `SAFE_ID` has no `/` and no leading dot (`brand.js:27`); logo readable by every signed-in user (by design) |
| `/api/xengine/import` | forged archive | IDOR via the archive's `project.json`: **SEC-002** (not new) |
| `/api/users/search` | any user lists all accounts | confirmed: SEC-004 / ENT-002 |
| `/api/s1000d/validate-config`, `/api/app-settings`, `/api/reference`, static lists | code read | `applyPatch` whitelists field by field; engine `deepMerge` copies into a fresh object (no global prototype pollution); read-only data |

### SEC-015 · P2 · VERIFIED · S · SNS CSV exports write cells unescaped, so a project member can plant spreadsheet formulas

**Problem**: `services/sns.ts:364` and `routes/s1000d.ts:155` quote the title and double `"`, but never neutralise a leading `= + - @`, tab or CR. Live: an editor saved the SNS title
`=HYPERLINK("http://127.0.0.1:4061/x","click")`; `GET /api/projects/:id/sns/export?format=csv` returned `99,,,"=HYPERLINK(""http://127.0.0.1:4061/x"",""click"")"`.
Excel and LibreOffice evaluate a quoted field that begins with `=`.
**Impact**: a lower-privileged member makes a manager or admin evaluate a formula on opening the export. A `HYPERLINK` click is certain; a silent data pull (`WEBSERVICE`, DDE)
depends on the Office version and settings: **NOT VERIFIED** (no Office here).
**Audit CSV** (`platform.ts:84`, the lead): same weak `esc`, but not exploitable today. After creating projects named `=1+1 evil`, `@SUM(1+1)`, `-2+3 minus`, `+9 plus`, 396 live rows had
0 cells starting with a trigger character: the project id is a slug that drops leading symbols (`workspace.js:103`), usernames are `[a-z0-9._-]` and start alphanumeric, `meta` starts with `{`,
`ip` is a socket address, `action` is server-defined.
**Fix**: one shared `csvCell()` that prefixes `'` to any value matching `/^[=+\-@\t\r]/`, used by all three exporters (audit, SNS project, SNS preset).

### SEC-016 · P2 · VERIFIED · S · Sessions never expire on inactivity: seven days from sign-in, persistent cookie, `last_seen_at` is display-only

**Problem**: `sessions.js:11,85` sets `expires_at = created + 7 days`; live, `expiresAt` stayed exactly `createdAt + 7 d` after further requests. `authz.js:28-33` writes `last_seen_at` at most
once a minute and nothing compares it (`store.js:772` filters only on `revoked_at`, `expires_at`, `disabled_at`). The cookie is `Max-Age=604800`, so it survives a browser restart. The SPA has no idle logic (grep:
none). Same fact as agent I's ENT-010; added here:
**Shared workstations**: on a PC with a shared, unlocked or reused Windows or browser session, the previous user's Agastya session stays live for up to a week. What helps: logout revokes
server-side (checklist row 2b), a new sign-in anywhere displaces the old session, an admin can revoke (`/api/admin/sessions/:id/revoke`). What does not: no user-visible session list, no lock
screen, `Secure` is opt-in (PLT-022).
**Interaction with FE-003 (agent D)**: D asks the server to extend sessions on activity. Sliding expiry only matters once an idle timeout exists, and an idle timeout makes D's data-loss path
(the first 401 unmounts the editor and drops unsaved text) more frequent; the single-session displacement already triggers it. **Order**: fix FE-003 first, then add an idle limit (setting, 8-12 h)
with sliding `expires_at` capped by an absolute limit (4-8 h option for shared PCs) and a "sign out everywhere" action.

### SEC-017 · P2 · VERIFIED · S · Any author can overwrite another user's common module; provenance keeps the original uploader; guard-bypassing XML is accepted

**Problem**: `POST /api/cir` is "everyone may add" (`cir.ts:94`); an existing file is replaced via `writeDm(.., undefined, ..)` with no `baseHash`, ownership check or confirmation (REL-002 is the
concurrency half). Live: bob added a module; eve (author) re-posted it with a changed title; the list showed the new content while `addedBy` and `note` still named bob (`noteAdded` returns early
when a row exists, `cir.ts:81-83`). The audit log does record `cir.added` by eve, but the repository view, which is what copying users trust, does not. A module carrying the SEC-001 decoy-DOCTYPE
plus external entity was also accepted into the CIR (201) from an author account: the CIR is a shared supply point into every project that copies from it.
**Fix**: keep `addedBy` and add `updatedBy`/`updatedAt`; require `baseHash`; let only the uploader, a manager or an admin replace; fix the guard itself (SEC-001).

### REL-008 · P2 · VERIFIED · S · The audit trail records who changed content but not from where: only login, backup and reset rows carry an IP

**Problem**: `context.ts:96-102` `audit()` stores what the caller passes, and only `auth.*`, `backup.*`, `reset.*` callers pass `ip`. Live, 396 rows: all 316 `auth` rows have an IP; `dm.*` (31),
`project.*` (13), `cir.*` (5), `settings.*` (9), `publish.*`, `pm.*`, `folder.*`, `invite.*` have none (`user.*`: 1 of 12). "Which machine edited this data module" cannot be answered from the log; with
SEC-008 the IP would be the proxy anyway.
**Fix**: default `ip` in `audit()` from the request (a middleware setting `req.auditIp`, or `AsyncLocalStorage`) and fix `clientIp()` at the same time.

### Re-check against other agents' reports (contradictions)

- **Nothing from agent C or A overturns a verdict in my report.** C's PUB-001/002/014 widen SEC-002/011 (Addendum 1); A's PLT-017/018/023 match SEC-010/001/007.
- **A, PLT-022** says a password change "does not necessarily end other sessions" and 02.D leaves its toast unverified ("agent S probes this"). I did verify it (row 2b): the change mints a new session
  and displaces the old one. A counts nine failures before 429; the code limit is `MAX_ATTEMPTS = 10` (`rateLimit.js:9`) and my live count is ten 401s then 429 (A's window probably held one earlier
  failure; no substantive conflict).
- **F (09-DEPLOYMENT :167 and :467)** lists the "DOCTYPE/entity guard" as a hardening strength and treats offline egress as blocked (a JSS `graphic src=http://` is refused by the publish gate).
  **SEC-001 contradicts the first part** (decoy-comment bypass) and **SEC-003 the second** (the publisher-logo field is not gated; FOP fetched the URL live). `--nonet` stops libxslt network access
  only, not `xi:include` file reads (SEC-011).
- **D, FE-003(c)** "extend the session on activity (see agent S)": answered in SEC-016 (no sliding expiry exists; sequence of work).
- **11-TESTING :619** proposes a "session idle expiry" test: there is no idle expiry to test, only the absolute TTL.
- **REL-006** is closed above in this file: live restart test, sessions survive, lockout counters reset.

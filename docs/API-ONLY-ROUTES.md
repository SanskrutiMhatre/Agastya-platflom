# API-only routes

Written 2026-11-27 for audit WP-13 (ARC-013, FE-018, decision D8). These routes are still served and still guarded (`routes-guarded.test.js`),
but **no screen of the web client calls them**. They are kept on purpose; each group says why. A route on this list is reachable by a script,
a test or a future screen with the same session and role checks as any other route.

How the list was made: the route table of the running app (`app._router.stack`, 286 routes) was compared with every URL the client builds in
`frontend/src` (helper prefixes such as `P(id)` expanded), then each candidate was checked by hand (URLs built with a ternary, for example
`lock`/`unlock` or `?download=1`, are used and are not listed). Re-run the comparison before removing anything.

**Why nothing was removed in WP-13.** The owner's decisions of 2026-11-26 removed the screens of SNS System 2, the brand packs, the CSDB
page and all applicability screens and said explicitly that the backend, the data and the API stay. Decision D19 of the roadmap also says the
dead-route list is approved together with the front-end cleanup, after the regression sign-off (WP-36). WP-13 therefore removed only client
code that nothing called (40 wrappers and `frontend/src/api/publish.ts`), and records the routes here for that later decision.

## 1. Screens removed by the owner on 2026-11-26 (backend kept by the same decision)

| Group | Routes | Still used by |
|---|---|---|
| SNS System 2 (importer numbering model) | `GET/POST /api/projects/:id/sns-rows`, `GET/PUT .../sns-rows/ordering`, `GET .../sns-rows/title`, `POST .../sns-rows/derive`, `POST .../sns-rows/import-brex`, `POST .../sns-rows/import-defaults`, `POST .../sns-rows/learn`, `PUT/DELETE .../sns-rows/:rowId`; `GET/POST /api/sns/defaults`, `POST /api/sns/defaults/merge-legacy`, `PUT/DELETE /api/sns/defaults/:rowId` | package import/export (`packageSettings`), `sns-separation`, `sns-http`, `sns-polish` tests; see `docs/SNS_SYSTEMS.md` |
| Brand packs | `GET /api/brand-packs`, `GET /api/brand-packs/:id/logo` | the house template names the pack; `brand-packs-route` test |
| Applicability tables | `GET/PUT /api/projects/:id/applicability`, `GET .../applicability/validate` | the validation run and the publication gate read the same tables; `applicability`, `applic-publish`, `applic-external` tests |
| Configuration-specific publication | `GET /api/projects/:id/publish/configurations`, `POST .../publish/configured/plan`, `POST .../publish/configured`, `GET .../publish/configured/:name` | `applic-publish` test; `docs/S1000D_REFERENCE_CONFIG.md` section 13 |
| CSDB objects (Files page) | `GET/POST /api/projects/:id/objects`, `POST .../objects/new`, `GET .../objects/:file/html`, `POST .../objects/:file/pdf`, `POST .../dml/generate`, `GET .../assets`, `GET .../findings` | the Studio still reads and saves objects (`GET/PUT .../objects/:file`); phase-17 tests |
| Packages | `GET /api/projects/:id/packages/project`, `POST .../packages/delivery`, `POST .../packages/import`, `GET .../packages/import-reports`, `GET .../packages/import-reports/:id` | e2e `zz-import-refusal`, package tests, scripts |
| HTML publication | `POST/GET /api/projects/:id/publish/html`, `GET .../publish/html/:name.zip`, `GET .../publish/html/:name/*` | decision D11 taken in WP-15 (2026-11-27, PUB-018, the audit's recommendation): HTML publication stays an **API-only, S1000D-only** feature; no screen offers it and nothing promises HTML for JSS or JSG (no engine exists for them; `POST /publish/html` on a JSS book answers `NOT_S1000D`, on a JSG document `NO_PM`, read from `services/htmlPublish.ts`, not re-run in WP-15). To be revisited if a customer asks for HTML/IETM output; `html-publish` tests |
| Lifecycle | `GET /api/projects/:id/dms/:file/lifecycle`, `GET .../lifecycle/events`, `POST .../dms/:file/working-revision`, `GET .../change-suggestions`, `POST .../change-marks`, `POST .../dms/:file/issue`, `.../obsolete`, `.../reinstate`, `.../supersede` | the release approval workflow relies on working revisions; lifecycle tests |
| CIR links | `GET /api/projects/:id/cir-links`, `POST .../cir-links/:file/update`, `DELETE .../cir-links/:file` | the only way to update or detach a CIR linked copy |
| Project extensions | `GET /api/projects/:id/extensions`, `PUT .../extensions/:profileId` | the Administrator registers profiles (`/api/admin/extensions`, used); enabling one per project is API-only |

## 2. Operational and administrator routes with no screen

| Routes | Why kept |
|---|---|
| `POST /api/admin/users/import/preview`, `POST /api/admin/users/import/commit` | bulk user import (CSV) for an administrator's script |
| `GET /api/admin/approvals`, `POST /api/admin/approvals/:id/approve`, `POST .../reject` | approval queue; the screens use `/api/approvals` and `/api/admin/releases` |
| `GET /api/admin/projects`, `GET /api/admin/projects/ownerless`, `POST /api/admin/projects/:id/adopt`, `.../reassign-owner`, `.../make-ownerless`, `.../members` | recovery of projects whose owner left (WP-06) |
| `GET/PUT /api/admin/asset-policy` | upload limits per kind of asset |
| `GET /api/admin/config` | the collection index (each collection, `/api/admin/config/:c`, has a screen) |
| `POST /api/admin/s1000d/presets/:id/import` | SNS preset import from CSV/JSON |
| `POST /api/projects/:id/invitations` | invitation by API (the screens assign directly) |
| `GET /api/document-types` | the list the New project wizard took before `formats` |
| `GET /api/projects/:id/dms/:file/history/:rev` | the text of one earlier revision (the History list itself has a screen) |
| `GET /api/projects/:id/publish/status` | build status for monitoring |
| `POST /api/projects/import`, `GET /api/projects/:id/import/report` | whole-project import and its last report |
| `POST /api/projects/:id/jssdm/import-frontmatter`, `POST .../jssdm/generate`, `GET .../jssdm/status` | Xignal front matter <-> settings conversion |
| `GET /api/jss/types`, `GET /api/jss/types/:type`, `GET /api/jss/schema`, `GET /api/jsg/types`, `GET /api/jsg/schema`, `GET /api/projects/:id/jss/import-report` | engine description for tools and tests |
| `GET /api/health`, `GET /api/version` | monitoring, the installer's checks (`scripts/verify-installer.mjs`) and the Mode B version handshake |

`GET /api/version` returns `{ product, version, apiVersion, minClientVersion, schema: { level, latest, applied, compatible }, build: { commit, builtAt, packaged } }`
(`backend/src/services/version.ts`). Raise `API_VERSION` when a route on this page is removed or changes shape.

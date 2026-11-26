# 12 - Enterprise readiness assessment

Audit team agent **I** - master-prompt sections 15 (enterprise feature gap analysis), 16 (research-derived recommendations) and 17 (measurable production-readiness gates).
Audit date 2026-11-26. **Audit only**: no repository file other than this report (and its sibling `13-INDUSTRY-RESEARCH-AND-BENCHMARKING.md`) was written.
Finding prefixes: **ENT** (enterprise/production gaps) and **RES** (research-derived recommendations). Research sources `[Sxx]` are listed in file 13, section 11.

**Scope and method.** (1) Read the auth/authorization core (`backend/src/core/auth/*.js`, `core/collab/*.js`), the Express wiring (`app.ts`, `context.ts`, `index.ts`, `config.ts`), the
release/review/waiver/backup/activity/notification/lifecycle services, the admin and team routes, the vendored licence module, the Windows installer script, the service host and the
administrator guide, then **re-checked each claim in code** (the existing docs are leads only). (2) Ran two existing test files against the compiled `backend/dist`
(`node --test test/routes-guarded.test.js test/rbac.test.js`): **8 tests, 8 pass, 0 fail** (rbac 7 + route guard 1), 10.7 s, temp workspaces only - VERIFIED; this shows the
authorization route-coverage and role rules hold for the build currently in `dist`, **not** that the product is production-reliable. (3) Ran `Get-AuthenticodeSignature` and `node --version` against
the existing `release/` artefacts (read-only). (4) Web research summarised in file 13 supplies the standards and practice the product is compared with. No server was started, port 4040/4041 and the
`workspace\` folder were not touched, and no customer material was read.

Evidence labels: VERIFIED / OBSERVED / SUSPECTED / RECOMMENDATION / NOT VERIFIED as defined in the brief.

## 1. Coverage table

| Area / path | Status | Verification done | Limits |
|---|---|---|---|
| `backend/src/core/auth/{authz,policy,sessions,crypto,rateLimit,bootstrap,masterPassword,grants,routes,store}.js` | Inspected | Full read of authz/policy/sessions/crypto/rateLimit/bootstrap/masterPassword/grants; routes.js lines 20-440, 540-1014; store.js 1-460, 610-900 | store.js 460-610 and 900-1571 only grepped (folder/release/lock helpers) |
| `core/collab/{revisions,docindex}.js` | Inspected | Full read | No live collaboration server exists to inspect |
| `app.ts`, `context.ts`, `index.ts`, `config.ts`, `services/broadcast.ts` | Inspected | Full read | - |
| `services/{release,review,publishWaivers,backup,activity,notifications,enterprises,platform,dbSnapshot}.ts` | Inspected | Full read | - |
| `services/lifecycle.ts`, `services/csdb.ts` (write/history/lock paths) | Partially inspected | Header comment + `writeDm/cut/history`; `project-content.ts` lines 60-125 and 255-365 | Rest of lifecycle logic not read (other agents) |
| `routes/{admin,team,waivers}.ts`, `routes/project-content.ts` (release/review) | Inspected | Read as listed | Other route files only grepped |
| `vendor/engine/{license,db}.js` | Inspected | Full read; grep for any caller of `license.js` (none) | - |
| `packaging/installer/agastya.iss`, `packaging/agastya.ini.template`, `docs/OPERATIONS.md`, `docs/SIGNING.md` | Inspected | Full read | Installer **not executed** |
| `packaging/host/AgastyaHost.cs` | Partially inspected | grep for service/event-log/failure actions (lines 260-262, 354-360, 477-487, 525-550, 779-803) | Not read end to end |
| `release/` artefacts | Partially inspected | Authenticode status, SHA-256, bundled `node.exe` version | Contents not diffed against `main` |
| Frontend (idle logout, a11y, aria, i18n) | Partially inspected | grep only (`aria-` 297 occurrences/53 files; `role=` 63; no `axe`; no idle timer; no i18n library) | No UI run; no manual accessibility test |
| Packaging/UX/performance/security deep dives | Not inspected | owned by other agents | Cross-references only |
| Real workspace, ports 4040/4041, customer material | Not inspected | off limits by brief | - |

## 2. Fact-check of the product against the enterprise list (requirement 2)

`Present` = a working implementation exists; `Partial` = implemented but with a gap that matters; `Absent` = nothing found by code search (searches named in the Evidence column).

| # | Capability | State | What exists (evidence) | What is missing |
|---|---|---|---|---|
| 1 | **Roles / permissions** | Present (fixed) | Global roles `admin / project_manager / author` (`core/auth/policy.js:141`); project roles `viewer < reviewer < editor < manager < owner` (`authz.js:19`); one decision point `evaluate()` (`authz.js:69-146`); folder-level grants raise a role (`authz.js:106-121`); uniform 401/404/403 (`authz.js:38-46`); role-assignment rules in one file (`core/auth/grants.js:24-43`); static route-guard test (`test/routes-guarded.test.js:11-36`, VERIFIED pass); roles are read-only in the UI (`routes/admin.ts:62-78`) | No custom roles or per-permission toggles; no per-document ACL; admin is owner-equivalent everywhere (`authz.js:106`) with no "audit-only" or "security-admin" split (AC-5, AU-9(4)) |
| 2 | **Activity / audit log** | Partial | Append-only by convention: `audit_log` table (`store.js:116-130`), `appendAudit` (`store.js:837-843`), `audit()` wrapper that strips secret-looking keys and never throws (`context.ts:96-105`); 132 distinct action names written (static count, scratch script); viewer `GET /api/admin/audit` (`routes.js:1001-1011`); CSV export last 5 000 rows (`platform.ts:83-88`); activity dashboard (`services/activity.ts`) | **No tamper evidence** (no hash chain, no signature, no triggers), **no retention/rotation**, **no forwarding**, silent on write failure, no `project_id`/`actor_id` index (index only on `at`, `action`: `store.js:128-129`), no audit policy document |
| 3 | **Sessions** | Partial | 256-bit random token, SHA-256 stored, HttpOnly + SameSite=Lax cookie, `Secure` when request is HTTPS (`sessions.js:8-37, 68-70`); new session at login/onboarding/password change (fixation-safe); single active session per user (`store.js:755-765`); admin list/revoke (`routes.js:984-999`); disabled account kills sessions (`routes.js:596`) | 7-day absolute TTL, **no idle timeout** (`sessions.js:11`; `last_seen_at` is stored but never used to expire: `authz.js:25-36`, `store.js:772-782`); expired rows never purged; no user-facing "my sessions" |
| 4 | **Review / approve / release workflow** | Present | Author requests (editor+), Project Manager of that project or administrator decides (`project-content.ts:271-278, 307-323`); request must pass the publication gate (`:289`); approval **issues** in-work modules as next issue before recording the decision (`:315-317`); approval is bound to a SHA-256 fingerprint of every source file + settings (`release.ts:36-51`) so edits after approval un-release the publication (`release.ts:96-107`); send-back with reasons and anchored review comments (`:326-351`); watermark "NOT RELEASED" until approved; notifications to approvers/requester | **No separation-of-duties**: a manager/owner/admin may request and then approve their own release (`project-content.ts:271, 277-278`, no requester check at `release.ts:155-161`); approval is a button, not an electronic signature (no re-authentication, no signed record) |
| 5 | **Waivers** | Partial | Recorded, attributed waiver to build **draft** copies without a missing BREX; never applies to release or approval (`services/publishWaivers.ts:1-9`); reason >= 10 chars; audited add/remove (`routes/waivers.ts:25, 32`) | Stored as one JSON file per project (`publishWaivers.ts:22-38`), not in DB/revisions; adding again **replaces** and removing **erases** the earlier waiver incl. its reason/author (`:50, 55-61`); audit meta records kind+subject only, not the reason (`waivers.ts:25`); any editor may waive - no approver, no expiry |
| 6 | **Backup** | Partial | Pre-migration `VACUUM INTO` snapshot (`context.ts:74`, `services/dbSnapshot.ts`); installer copies DB before an upgrade (`agastya.iss:313-325`); app "Backup" ZIP (`team.ts:131-141`, `backup.ts:29-67`); per-project archive export/import (`services/projectArchive.ts`); admin guide: back up the data folder while stopped (`OPERATIONS.md:95-98`) | App backup **omits the database content** (revisions, releases, review comments, reference data, SNS/config rows, folder grants, lifecycle events), has **no restore** path, buffers the whole ZIP in memory (`team.ts:137-140`), no schedule, no retention, no integrity manifest/hash, no restore test |
| 7 | **Licensing** | Absent (code dormant) | `vendor/engine/license.js`: Ed25519-signed key with expiry/notBefore, optional machine binding, clock-rollback guard (`license.js:61-96, 127-150`) | Not referenced anywhere in `backend/src`, `frontend/src`, `packaging` or `scripts` (grep); only `test/pm-multiref.test.js:26` asserts the file's hash; embedded `DEFAULT_PUBLIC_KEY` (`license.js:22-23`) with unknown private-key custody |
| 8 | **LDAP / AD / SSO / MFA** | Absent | Local accounts only (`store.js:88-102`); password reset is an admin-approved queue (`routes.js:384-406`) | No LDAP/Kerberos/NTLM/SAML/OIDC/TOTP code or dependency (grep over backend/frontend/packaging/scripts: only unrelated hits); no group-to-role mapping; no automatic de-provisioning |
| 9 | **Password policy** | Partial | Argon2id (64 MiB, t=3, p=4; scrypt fallback) (`crypto.js:17-47`); min 8 / max 128, ~70-entry denylist (`policy.js:9-43`); forced change on first login and after admin reset; constant-time dummy verify for unknown users (`crypto.js:62-68`); 10 attempts / 15 min per username+IP (`rateLimit.js:8-9`) | **Temporary password is `username@year`** (`policy.js:116-118`; asserted by `test/api.test.js:191`) while the comment above it describes a random scheme (`policy.js:96-107`); no history; no account lockout/notification; in-memory throttle resets on restart; no configurability |
| 10 | **Enterprises / multi-tenant** | Absent (name is misleading) | `services/enterprises.ts` checks a data module's responsible-partner/originator enterprise code and name against the administrator's CAGE lists (`enterprises.ts:1-62`) | No tenant isolation: one workspace, one `publisher.db`, global reference data (`config_items`). This is **not** a gap for a single-organisation on-prem product (see matrix, row F4) |
| 11 | **Retention policy** | Absent | Documents are never deleted, only marked `missing_at` (`docindex.js:93-97`); revisions are immutable and content-addressed (`revisions.js:41-55`) | No pruning/rotation for `audit_log`, `sessions`, `notifications`, `revisions`/`blobs`, `lifecycle_events` (grep for `DELETE FROM`: none touch them); no retention setting; DB growth unmonitored |
| 12 | **Admin diagnostics / health** | Partial | `GET /api/health` returns static `{status:'ok'}` (`app.ts:65-66`); CLI `AgastyaCtl --doctor` checks files, runtimes, port, disk, service (`OPERATIONS.md:47-54`); admin maintenance actions (reindex, check schemas, clear previews, rebuild PDFs) (`routes/admin.ts:100-134`); renderer status per project | No readiness probe (DB, disk, renderer, JRE); no admin diagnostics page; no support bundle; no DB integrity check (`integrity_check`/`quick_check`: none) |
| 13 | **Monitoring / logging** | Partial | Host rotates `agastya-server.log` (MaxFileMB/KeepFiles, `agastya.ini.template:28-31`); Application event-log entries for service start/stop/restart (`AgastyaHost.cs:260-262, 354-360, 477, 487`) | 43 raw `console.*` calls; no levels, no request/access log, no request id, no JSON logs; security events not in the Event Log; no metrics |
| 14 | **Notification system** | Present (in-app) | Per-user inbox table + API (`store.js:18-30`, `notifications.ts`, `team.ts:122-129`); events for release/review/access/account changes | No e-mail/webhook (internal SMTP relay is common on closed networks); no preferences; unread rows never purged |
| 15 | **Change tracking / revision history** | Present (strong) | Immutable SHA-256 revisions with hash re-verification on read (`revisions.js:58-74`); `cut()` on save/create/delete (`csdb.ts:182-188, 205-229`); history API (`project-content.ts:93-96`); S1000D issue/in-work files, suggested + applied change marks, supersede/obsolete with reason in `lifecycle_events` (`lifecycle.ts:1-24`); release fingerprint (`release.ts:36-51`) | Revision write failure is swallowed (`csdb.ts:182-188`, logs and continues); history listing capped at 50 (`csdb.ts:231-238`); no diff/blame UI evidence read; JSS/JSG saves not confirmed to cut revisions (**NOT VERIFIED**) |
| 16 | **Project access policies** | Present | Project membership + folder-level roles (`authz.js:99-121`); invitations accept/decline; folder owners/grants/requests (`store.js:350-378`); **approval queue for structural changes** by non-admins (`change_requests`, `store.js:414-433`); pending-project gate (`authz.js:123-138`); CIR workspace open to all signed-in users by design (`authz.js:114`) | S1000D security classification / data restrictions in the data module status (`securityClassification` used for output marking, import identity, applicability) is **not** used for access or export decisions; no per-document ACL |
| 17 | **Transport security** | Absent | Cookie `Secure` auto-set behind a TLS proxy (`app.ts:43`, `sessions.js:68-70`); `SecureCookies` ini key | **No TLS in the server** (grep for `https.createServer`, `.pfx`, `.pem`: none); OPERATIONS says "The server speaks plain HTTP" (`:80`); installer can open the firewall for LAN (`agastya.iss:381-391`) |
| 18 | **Service hardening** | Partial | Service `NT AUTHORITY\LocalService`, auto-start, restart 5 s/30 s/60 s (`AgastyaHost.cs:525-537`); loopback bind by default (`config.ts:17-20`, ini `Bind=loopback`); firewall rule limited to `private,domain` for `node.exe` | Per-machine install grants **BUILTIN\Users Modify** on data and state folders (`agastya.iss:372-378`); no service-specific ACL; no TLS |
| 19 | **Release engineering** | Partial | Silent switches, SHA256SUMS, signing scripts and documentation (`docs/SIGNING.md`), pre-upgrade DB copy | Artefacts **NotSigned** (VERIFIED); no SBOM; no SCCM/Intune detection recipe; no schema-downgrade guard (`store.js:644-674`) |
| 20 | **Accessibility / i18n** | Absent (gate) | focus-visible styles; 297 `aria-` uses; responsive e2e spec exists | No axe/automated accessibility test (frontend `package.json` devDependencies); no i18n library (English only) |

## 3. Enterprise feature gap matrix (requirement 2 classification)

Classification key. **Essential production** = a single organisation cannot safely rely on the product without it (data loss, takeover, unsupportable). **Essential enterprise** = needed when the buyer has a security policy, auditors or an IT department. **Optional advanced** = valuable for some customers, no universal need. **Future enhancement** = do not build now.
Priority numbers refer to findings in section 6.

| ID | Capability | Class | Justification (clear business/technical reason) | Today | Finding |
|---|---|---|---|---|---|
| F1 | Transport encryption off loopback | **Essential production** | Credentials and session cookies cross the LAN in clear when `Bind=lan`; SC-8 | Absent | ENT-001 |
| F2 | Non-guessable initial/reset credentials | **Essential production** | New accounts can be taken over by anyone who guesses `name@year` before the owner signs in | Partial | ENT-002 |
| F3 | Tamper-evident, retained, exportable audit trail | **Essential enterprise** | The product's value is controlled release of safety/defence documents; an auditor must trust "who approved what" (AU-9, AU-11) | Partial | ENT-003, ENT-020 |
| F4 | Multi-tenancy | **Future / not recommended** | Single organisation per install; isolation would add complexity with no buyer asking; separate installs are the isolation | Absent | - |
| F5 | Data-folder ACL limited to service + administrators | **Essential production** | Any local user can read hashes, edit the audit log or the release table by opening the files | Partial | ENT-004 |
| F6 | Directory integration (LDAPS group-to-role) | **Essential enterprise** | Manual joiner/leaver for dozens of users is an operational and audit liability (AC-2, IA-5) | Absent | ENT-005 |
| F7 | SSO (Kerberos/NTLM/OIDC) | Optional advanced | Convenience; LDAPS already removes the second password store | Absent | RES-003 |
| F8 | MFA (TOTP) | Optional advanced | Customer-policy dependent; offline-friendly; only after F6 | Absent | RES-003 |
| F9 | Complete backup + tested restore + schedule | **Essential production** | Revision history, release approvals, memberships and reference data live only in `publisher.db` | Partial | ENT-006 |
| F10 | Readiness endpoint, diagnostics page, support bundle, structured logs | **Essential production** | Air-gapped sites cannot be debugged remotely; the vendor needs reproducible evidence | Partial | ENT-007 |
| F11 | Supported bundled runtime + stable DB module | **Essential production** | Node 22 reaches end of life 2027-04-30; `node:sqlite` is experimental in 22 | Observed | ENT-008 |
| F12 | Separation of duties on release | **Essential enterprise** | AC-5; a lone manager/admin can release without a second pair of eyes | Absent | ENT-009 |
| F13 | Idle + absolute session timeout | **Essential enterprise** | Shared engineering PCs; 7-day sessions outlive any policy (AC-12, SP 800-63B-4) | Absent | ENT-010 |
| F14 | Auth hardening (lockout alert, client IP behind proxy, enumeration) | Essential enterprise | AC-7; audit IPs must identify the user's machine | Partial | ENT-011 |
| F15 | Security headers, WebSocket origin check | Essential production (cheap) | Clickjacking and MIME sniffing protections cost a few lines | Absent | ENT-012 |
| F16 | Refuse to start on a newer schema; documented rollback | **Essential production** | An older build on a newer DB corrupts silently | Absent | ENT-013 |
| F17 | Signed artefacts, SBOM, deployment kit (SCCM/Intune) | Essential enterprise | Managed endpoints block unsigned installers; procurement asks for SBOM | Partial | ENT-014 |
| F18 | Retention settings and DB growth control | Essential enterprise | AU-11 needs a defined period, not unbounded growth; dashboards query `audit_log` unindexed | Absent | ENT-015 |
| F19 | Mandatory concurrency guard + check-out lease | Essential production | A client that omits `baseHash` silently overwrites a colleague's edit | Partial | ENT-016 |
| F20 | Durable, approvable waivers | Essential enterprise | A waiver is a quality-system exception; its reason and author must survive removal | Partial | ENT-017 |
| F21 | Accessibility conformance (WCAG 2.2 AA) | Essential enterprise (contract-dependent) | Public-sector and some defence contracts require it; also general usability | Unmeasured | ENT-018 |
| F22 | Licence enforcement | Optional advanced (business-model dependent) | Only needed if the owner sells term/seat licences; module exists but is dormant | Dormant | ENT-019 |
| F23 | E-mail/webhook notifications | Optional advanced | Internal SMTP is common; in-app inbox already covers the core need | Absent | ENT-021 |
| F24 | Need-to-know access by S1000D classification | Optional advanced | Only for customers mixing classifications in one workspace; separate workspaces are simpler | Absent | ENT-022 |
| F25 | Configurable roles/permissions | Optional advanced | Fixed three-role model matches the workflow described to the owner; configurability adds test surface | Absent | ENT-023 |
| F26 | Real-time co-editing of one data module | Future enhancement | Whole-module check-out matches S1000D granularity; no source shows merges keep XML valid | Absent | RES-001 |
| F27 | PostgreSQL option / clustering / HA | Future enhancement | One host, short writes; revisit on the switch criteria in RES-002 | Absent | RES-002 |
| F28 | Cloud/SaaS, mobile clients | Future enhancement | Contradicts the offline on-prem brief | Absent | - |

## 4. Operational requirements for an enterprise offline customer

| Requirement | Standard / practice | Current | Gap / action |
|---|---|---|---|
| Unattended install, upgrade, uninstall with exit codes and logs | SCCM/Intune silent only `[S33]` | Complete switch set, `SetupLogging=yes`, data kept on uninstall (`agastya.iss:5-9, 75, 431-437`; `OPERATIONS.md:107-131`) | Detection rule and `.intunewin` recipe not provided (ENT-014) |
| Service under a least-privilege identity, automatic recovery, event-log entries | MS service-account guidance `[S33]` | LocalService + recovery actions + lifecycle events | Data-folder ACL (ENT-004); security events to Event Log (RES-004) |
| Config in a text file, no registry dependency | admin-friendly | `agastya.ini` keys for port, bind, data dir, cookies, log rotation (`agastya.ini.template`) | Add `[tls]`, `[session]`, `[audit]`, `[backup]` sections (ENT-001/010/003/006) |
| Backups: scheduled, verifiable, restorable, tested | NIST CP-9/CP-9(1), 3-2-1 `[S21][S40]` | manual | ENT-006 |
| Health, readiness, diagnostics, support bundle | liveness/readiness separation, redacted bundles `[S38][S39]` | liveness only | ENT-007 |
| Logs collected centrally without agents | Windows Event Forwarding `[S33]` | lifecycle only | RES-004 |
| Upgrade with automatic data protection and a documented rollback | NIST CP-9; installer practice | pre-upgrade DB copy; rollback = manual restore (`OPERATIONS.md:100-105`) | schema guard (ENT-013) |
| Vulnerability and supply-chain transparency | SBOM + signed artefacts `[S41][S37]` | SHA256SUMS only; unsigned | ENT-014 |
| Supported runtime for the product's support window | Node release schedule `[S30]` | Node 22.23.2 (EOL 2027-04-30) | ENT-008 |
| Capacity planning numbers (users, projects, DMs, disk growth) | - | no stated sizing; one perf run on a different Node major (`S1000D_COMPLIANCE_MATRIX.md:96-113`) | gates G-PERF-* |

## 5. Security requirements (mapped to the NIST control families, file 13 section 5.2)

| Control | Requirement | State | Finding |
|---|---|---|---|
| AC-2 / IA-5 account and authenticator management | Central identity, de-provisioning, authenticator strength | Local accounts; weak initial credential | ENT-002, ENT-005 |
| AC-3 enforcement | Single authoritative decision point, default deny | **Strong** (`authz.js`, route-guard test) | - |
| AC-5 separation of duties | Distinct requester and approver for release | Absent | ENT-009 |
| AC-6 least privilege | Service account, folder ACLs | LocalService good; Users:Modify bad | ENT-004 |
| AC-7 unsuccessful logons | Defined limit and action | 10/15 min throttle, no lock or alert | ENT-011 |
| AC-12 session termination | Idle and absolute | Absolute 7 d only | ENT-010 |
| AU-2 / AU-3 event content | Defined event list with who/what/when/where | 132 actions, IP = socket address | ENT-003, ENT-011 |
| AU-5 audit failure response | Alert on failure | Silent | ENT-003 |
| AU-9 / AU-9(3) protect + cryptographically protect audit | Tamper evidence | Absent | ENT-003 |
| AU-11 retention | Defined period | Absent | ENT-015 |
| CP-9 / CP-9(1) backup + test | Complete, tested | Partial | ENT-006 |
| SC-8 transmission protection | TLS | Absent | ENT-001 |
| SC-28 at rest | Disk encryption (OS) + ACL | ACL gap; encryption is the customer's BitLocker | ENT-004 (docs) |
| SI-2 / SA-22 flaw remediation, unsupported components | Supported runtime, SBOM | Node 22 EOL; no SBOM | ENT-008, ENT-014 |

## 6. Findings (ENT-xxx)

Priorities follow the brief (P1 = essential enterprise/production capability or deployment blocker). No P0 was found in this area: nothing here shows data corruption or a pre-authentication break
in the code I read; the highest-impact items (ENT-001, ENT-002, ENT-004) are exposure paths that need network or local-user access. Findings that depend on other agents' areas are cross-referenced, not duplicated.

### ENT-001 · P1 · VERIFIED · M · No TLS in the server: credentials and session cookies travel in clear when the product is opened to the LAN

**Category** Security / deployment (NIST SC-8).
**Problem** The installer offers a "LAN" option that binds to all interfaces and opens a Windows Firewall rule; the server itself only speaks HTTP. Passwords (login, change-password, first-run setup) and the session cookie are then readable and replayable by anyone on the same network segment. The `Secure` cookie flag is only set when a request arrives as HTTPS, which can only happen behind a proxy the customer must build themselves.
**Evidence** `backend/src/config.ts:17-20` (`AGASTYA_HOST`, loopback by default) and `:37` (`secureCookies` only from `AGASTYA_SECURE_COOKIES=1`); `backend/src/app.ts:43` (`trust proxy 1`); `backend/src/core/auth/sessions.js:68-70` (cookie `Secure` only when HTTPS is seen); `packaging/installer/agastya.iss:381-391` (firewall rule for `runtime\node.exe`, profiles private+domain, when LAN is chosen); `docs/OPERATIONS.md:80` ("The server speaks plain HTTP. On an untrusted network put a reverse proxy..."). Code search for `https.createServer`, `.pfx`, `.pem`, `tls.` in `backend/src` and `packaging`: no hits.
**Current implementation** Plain `http` server; optional customer-built reverse proxy; one ini key to mark cookies Secure.
**Recommendation** Add a `[tls]` section to `agastya.ini` (certificate and key as PEM or PFX in the state folder, passphrase from a DPAPI-protected file) and make the server listen HTTPS when it is present; auto-enable `Secure` cookies then; when `Bind` is not loopback and no certificate is configured, make `AgastyaCtl --doctor` report a **warning** and make the installer's LAN page say in one sentence that traffic is unencrypted and offer "continue without TLS". Keep the reverse-proxy route documented. Do not ship a self-signed certificate generator as the default path (it trains users to click through warnings); document issuance from the customer's internal CA (the repository already documents this for code signing: `docs/SIGNING.md:13-18`). HSTS stays off by default (intranet host names, no preload).
**Expected outcome** A LAN deployment can be completed with encrypted traffic without a second product; the loopback default keeps working with no certificate.
**Dependencies** ENT-007 (doctor), ENT-004 (key file ACL), ENT-012 (headers).
**Risks** Certificate expiry becomes an outage cause (mitigate: doctor shows days to expiry; log a warning at 30 days); customers behind a proxy must not double-terminate.
**Acceptance criteria** (1) with a test certificate the server answers on HTTPS and a plain HTTP request to the same port is refused or redirected; (2) session cookies carry `Secure`; (3) WebSocket works over `wss`; (4) `--doctor` warns for non-loopback bind without TLS; (5) loopback install unchanged.
**Test cases** Boot with a CA-signed test certificate and call login with a Node client that trusts only that CA; assert `Set-Cookie` contains `Secure`; assert plain `http.get` fails; assert `/api/health` over TLS; doctor output snapshot for the three configurations (loopback, LAN+TLS, LAN no TLS).

### ENT-002 · P1 · VERIFIED · S · Temporary passwords are `username@year`: a new or reset account can be taken over by anyone who knows the username

**Category** Security / authentication (NIST IA-5, SP 800-63B-4).
**Problem** Every admin-created, CSV-imported, forgot-password-reset and admin-reset account is given the password `<username>@<current year>`. Until the owner first signs in (and is forced to change it), anyone who can reach the login page and knows the username can sign in as that user, set a new password, and keep the account. The username is not secret: any signed-in user can list/search users (`/api/users/search`, `core/auth/routes.js:419`) and the admin screens show them. The first guess succeeds, so the 10-per-15-minutes throttle (keyed per username+IP, `rateLimit.js:19-21`) does not help, and it also does not slow a spray of one guess per account. SP 800-63B-4 requires memorised secrets issued by the verifier to be random and not derived from the account `[S22]`.
**Evidence** `backend/src/core/auth/policy.js:116-118` (`tempPasswordFor` returns `${normalizeUsername(username)}@${year}`); used at `core/auth/routes.js:533` (admin reset), `:571` (create user), `:712` (CSV import) and `backend/src/routes/team.ts:54`; asserted as intended behaviour by `backend/test/api.test.js:191` ("temporary password is username@year"); the comment above the function (`policy.js:96-107`) still describes a random-surname scheme, so documentation and code disagree.
**Current implementation** Deterministic string; `must_change_password` flag forces a change after first login (so the exposure window ends at first sign-in, but the first sign-in may be the attacker's).
**Recommendation** Generate a random temporary password from the CSPRNG (for example 4 words from a bundled word list + 2 digits, or 12 characters from an unambiguous alphabet; at least 60 bits), show it once to the administrator, store only its hash (as now), and let it expire after a window the administrator sets (default to be chosen by the owner; 72 h is a common starting point, not a standard). Update the test and delete the stale comment. Keep the forced change on first login.
**Expected outcome** No credential can be derived from public information.
**Dependencies** none.
**Risks** Administrators who relied on the predictable value to tell users by phone must now pass the shown value on; CSV import must return the generated values once in the preview/commit response (it already returns them).
**Acceptance criteria** two calls for the same username return different values; a login using `username@year` fails with the same message as a wrong password; the value is not derived from username/time; first login still forces a change; expired temporary password is refused.
**Test cases** replace the assertion at `api.test.js:191` with a format/entropy check; add a test that `priya@<year>` cannot log in after creation; add an expiry test with an injected clock.

### ENT-003 · P1 · VERIFIED · M · The audit trail is not tamper-evident, fails open, has no retention or off-box export, and is capped on export

**Category** Security / compliance (NIST AU-5, AU-9, AU-9(3), AU-11).
**Problem** The product's purpose is controlled release of technical documents; an auditor must be able to trust "who approved what and when". Today a person with file access (see ENT-004) or an administrator with a SQLite tool can edit or delete audit rows without trace; a failed audit write is swallowed (logged to the console only); there is no retention or archive policy; the CSV export is hard-limited to 5 000 rows, so the complete history cannot be exported once it exceeds that.
**Evidence** `backend/src/core/auth/store.js:116-129` (plain table, columns `id, at, actor_*, ip, action, target_*, project_id, meta`; indexes only on `at` and `action`; no hash, sequence-check or trigger); `store.js:837-852` (`appendAudit` / `listAudit`); `backend/src/context.ts:96-105` (`audit()` catches every error: "operation unaffected"); `backend/src/services/platform.ts:83-88` (`auditCsv` -> `limit: 5000`); `backend/src/core/auth/routes.js:1001-1011` (viewer, max 500 rows per call); code search for `DELETE FROM audit_log`, `VACUUM`, retention settings: none.
**Current implementation** 132 distinct action names are written (static count of `log/pLog/audit(...)` string literals and `action:` literals, scratch script `count-actions.js`); state-changing routes with no direct audit call in the handler are 26 of 153 registrations in my crude static check, and the four I traced (release decision, project/folder create/delete, admin reset) all audit through a service or factory, so I do **not** claim an audit-coverage gap - but there is also no automated test that proves coverage (see G-SEC-8).
**Recommendation** (1) Make audit integrity a property of the data: add `seq`, `prev_hash`, `row_hash` columns and compute an HMAC chain over canonical row content with a key kept outside the database (state folder, service-only ACL); add `AgastyaCtl --verify-audit` and an admin screen button; export a **checkpoint** (last seq + hash) with every backup and optionally on a schedule. (2) Make failure visible: on audit write failure write a Windows Event Log error and set a flag shown on the admin screen (AU-5); for the few critical actions (login, role/membership change, release decision, backup/restore) perform the audit write in the same SQLite transaction as the change so one cannot succeed without the other. (3) Add retention settings (default keep, archive-then-prune by age with the archive being a signed JSONL file) and an unlimited streamed export (CSV/JSONL, date range). (4) Add indexes on `project_id`, `actor_id` (the activity dashboard filters by project: `services/activity.ts:50-56`). Tail truncation is only detectable against an exported checkpoint (Schneier-Kelsey limitation `[S36]`) and an administrator holding the key can rebuild the chain: say so in the documentation and point to Event Forwarding (`RES-004`) for the off-box copy.
**Expected outcome** Editing, inserting or deleting a middle row is detected by a documented command; failures are visible; the full history is exportable; growth is controllable.
**Dependencies** ENT-004 (protects the key file), ENT-015 (retention), ENT-020 (content defects), ENT-006 (checkpoint in backup).
**Risks** Chain computation adds a write per audit event (microseconds; SQLite single-writer already serialises); key loss makes old rows unverifiable (back up the key with the checkpoint, not with the DB); migration must start the chain at a recorded genesis row rather than rewrite history.
**Acceptance criteria** a seeded test that modifies one row, deletes a middle row, and inserts a forged row is detected 3/3 by `--verify-audit`; deleting the last N rows is detected against the latest checkpoint; a forced audit write failure yields an Event Log entry and an admin-visible flag; export of 20 000 rows returns 20 000 rows; no regression in `routes-guarded` and existing audit tests.
**Test cases** unit tests for the chain; a fault-injection test that makes `appendAudit` throw for a release approval and expects either rollback of the approval (critical class) or the alert (other class); streamed export test with 20 000 inserted rows.

### ENT-004 · P1 · VERIFIED · M · A per-machine install grants BUILTIN\Users Modify on the data and state folders: any local user can bypass the application's access control

**Category** Security / deployment (NIST AC-3, AC-6).
**Problem** Authorisation lives in the application. The database (`publisher.db`, including password hashes, memberships, releases, audit log) and all project XML sit in folders that every local user may modify. On a shared engineering workstation or terminal server any interactive user can read every project, change a role, alter a release fingerprint, or edit the audit log with a generic SQLite tool, and the application cannot tell. It also makes ENT-003 impossible to rely on.
**Evidence** `packaging/installer/agastya.iss:372-378` (comment: standard users get modify rights because the tray application writes the logs and the database; two `icacls ... /grant *S-1-5-32-545:(OI)(CI)M` calls for the state and data folders under `IsAdminInstallMode`); `docs/OPERATIONS.md:137-138` (the grant is documented; the remedy offered is to change permissions after installing); service identity LocalService at `packaging/host/AgastyaHost.cs:525-537`. I did not run the installer (NOT VERIFIED at runtime; this is installer-script reading).
**Current implementation** Folders are opened to the Users group at install; tray and service share them.
**Recommendation** Default the server install to an ACL of SYSTEM + Administrators + the service identity only (`NT SERVICE\<name>` virtual account is the lowest-privilege option that can be named in an ACL, `[S33]`), and let the tray control the service through the Service Control Manager (grant start/stop on the service to the intended users with `sc sdset`, or let it call the server's API) instead of through file access. Keep the current behaviour only for the "personal" install mode (per-user, loopback). Show the choice on one installer page with a plain default; record it in the install log.
**Expected outcome** A standard user on the server machine cannot read or modify the database or project files.
**Dependencies** AgastyaHost tray design (audit area F); ENT-003.
**Risks** The tray currently writes logs and the DB itself (per the installer comment): the redesign must keep tray start/stop/open-browser working for non-admin users; a tested upgrade path must re-apply the ACL on existing installs without losing access for the service.
**Acceptance criteria** after a default silent server install `icacls <data>` and `icacls <state>` list no `BUILTIN\Users` ACE; a standard user cannot open `publisher.db`; the service starts; the tray can start/stop it for permitted users; upgrade from the previous build keeps working.
**Test cases** silent install in a clean VM, `icacls` output checked by script; run `sqlite3`/`Get-Content` as a standard user (expect access denied); service restart test; N-1 -> N upgrade test.

### ENT-005 · P1 · VERIFIED · L · No directory or SSO integration: accounts, passwords and offboarding are all local

**Category** Enterprise identity (NIST AC-2, IA-2, IA-5).
**Problem** Defence and aerospace customers run Active Directory; every account here must be created, reset and disabled by hand, there is a second password store the customer's identity team cannot see or audit, and a leaver keeps access until someone remembers to disable them. `docs/` offers no integration path.
**Evidence** Code search (backend, frontend, packaging, scripts) for `ldap`, `kerberos`, `ntlm`, `saml`, `oidc`, `totp`, `sspi`: no integration code or dependency (only unrelated matches); local user table `core/auth/store.js:88-102`; admin-approved reset queue `core/auth/routes.js:384-406`; `backend/package.json` dependencies (express, multer, ws, xmldom, xmllint-wasm; argon2 optional).
**Current implementation** Local username/password with Argon2id (strong), forced change, admin-approved forgot flow.
**Recommendation** Phase 1 only: **LDAPS bind** (works with no internet; needs only a reachable domain controller and the customer's CA certificate), with (a) a settings screen for server URL, base DN, bind account, certificate, (b) mapping of named directory groups to the existing global roles (`admin / project_manager / author`) so project membership and release authority stay in the product, (c) account created on first successful bind, disabled when removed from the groups (checked at login and by a daily job), (d) a local **break-glass** administrator that works when the DC is unreachable and is audited (the `reset-admin` console script already exists: `backend/scripts/reset-admin.js`). Use LDAPS (636) and respect channel binding/signing requirements `[S33]`. Defer Kerberos/NTLM SSO and TOTP to optional follow-ups (`RES-003`). Do not add an OIDC library until a customer names an IdP.
**Expected outcome** Domain users sign in with their directory password; leaver handling is automatic; the product no longer stores their password.
**Dependencies** ENT-001 (TLS for the product itself), ENT-010, ENT-011.
**Risks** Directory outage must not lock everyone out (break-glass + optional last-known-good group cache with a stated limit); nested groups and referrals need explicit handling; a pure-JS LDAP client dependency must be chosen, license-checked and bundled offline.
**Acceptance criteria** against a test OpenLDAP/AD-like server: valid user in a mapped group signs in; user removed from the group is refused at next login and sessions are revoked by the daily job; DC down -> local break-glass admin still works; wrong certificate -> connection refused.
**Test cases** integration tests with a throw-away LDAP server container or in-process fake; channel-binding configuration case; group-mapping unit tests; audit events for first bind and removal.

### ENT-006 · P1 · VERIFIED · M · Backup and disaster recovery are incomplete: the in-app backup omits the database, has no restore, is user-reachable and unscheduled

**Category** Reliability / data protection (NIST CP-9, CP-9(1)).
**Problem** Revision history, release approvals, memberships, folder grants, SNS/config rows, lifecycle events and the reference data live in `publisher.db`. The "Backup" button builds a ZIP of project folders, the CIR, `users.json`, `members.json` and the last 5 000 audit events - **not** those database tables - and nothing in the product can restore it. A customer who restores that ZIP after a disk failure loses revision history, release state and configuration. The operating guide says to copy the data folder while the service is stopped; the installer takes a one-off pre-upgrade copy. Nothing is scheduled and no restore has ever been tested by the product.
**Evidence** `backend/src/services/backup.ts:1-67` (contents), `backend/src/routes/team.ts:132-141` (route open to any signed-in user - project-scoped for non-admins - and buffers the entire ZIP in memory: `chunks.push` then `Buffer.concat`); `backend/src/services/projectArchive.ts` (per-project archive carries project files and review comments; grep finds no reference to `revisions`, `releases` or `lifecycle_events` - OBSERVED); `backend/src/context.ts:70-76` + `services/dbSnapshot.ts` (`VACUUM INTO` snapshot only before migration 016); `packaging/installer/agastya.iss:313-325` (pre-upgrade copy via `AgastyaCtl --backup-db`); `backend/src/index.ts` (only `sweepStaleUploads` is scheduled); `docs/OPERATIONS.md:95-98`.
**Current implementation** Three partial mechanisms (user ZIP, per-project archive, manual folder copy + installer snapshot).
**Recommendation** One administrator-level mechanism: `AgastyaCtl --backup <target>` / `--restore <file>` (and the same from the admin screen) that writes a **consistent** copy using the SQLite online backup (`node:sqlite` `backup()` exists since v22.16.0 `[S30]`, or `VACUUM INTO`) plus the workspace files, with a manifest of SHA-256 per file, the schema level and the audit checkpoint (ENT-003); restore refuses a backup from a newer schema (ENT-013), restores to a new folder or in place with the service stopped, and verifies the manifest. Add a schedule (daily by default, keep N, target path settable to a second drive/share) run by the service, and a `--doctor` line "last successful backup". Keep the user-level project archive as a *project export*, and restrict `/api/backup` to administrators (or rename it to what it is). Stream instead of buffering. Document 3-2-1 for the customer's own media `[S40]`.
**Expected outcome** A documented, tested path from "disk died" to "service running with the last night's state", with a measured restore time.
**Dependencies** ENT-003, ENT-013, ENT-004.
**Risks** Backing up a live WAL database must use the API (copying the file alone is unsafe `[S29]`); large workspaces need streaming; restore must not run over a live service.
**Acceptance criteria** backup then restore into an empty folder reproduces: every user, membership, release (with fingerprint), revision, comment, config row and the audit chain verifies; a ZIP larger than available RAM can be produced; a non-admin gets 403 on the platform backup; a scheduled backup appears in `--doctor` and in the audit log.
**Test cases** round-trip test comparing table row counts and hashes before/after; `kill -9` during a backup leaves no corrupt target; restore of an N+1 schema refused; memory ceiling test with a 1 GB workspace (`to be set after baseline measurement`, see 04-PERFORMANCE-AUDIT).

### ENT-007 · P1 · VERIFIED · M · Observability is thin for an air-gapped product: static health, unstructured logs, no support bundle, security events not in the Event Log

**Category** Operations / supportability.
**Problem** The vendor cannot see a customer system. When something fails the evidence is a console log without levels or request ids, a health endpoint that returns `ok` whether or not the database, disk or renderer works, and event-log lines for service start/stop only. Auditors and the customer's SIEM get no security events.
**Evidence** `backend/src/app.ts:65-66` (`/api/health` returns a constant); `grep console\.` in `backend/src`: 43 calls (levels absent, ad hoc prefixes like `[audit]`, `[admin]`); `packaging/host/AgastyaHost.cs:260-262, 354-360, 477, 487` (the Application log is used for lifecycle events only); `docs/OPERATIONS.md:47-54` (`--doctor` exists and is good); log rotation exists (`packaging/agastya.ini.template:28-31`); no `--support-bundle`, no metrics (grep).
**Current implementation** Liveness only; text logs rotated by size; a command-line doctor.
**Recommendation** (1) Split **liveness** (`/api/health`, unchanged) from **readiness** (`/api/ready`: DB open and `quick_check`-able, disk free above a floor, JRE/FOP present, migrations at the binary's level) `[S38]`. (2) Replace ad hoc `console.*` with a tiny logger (level, timestamp, request id, no secrets) writing one JSON line per event; add an access log line per request (method, route template, status, ms, user id). (3) `AgastyaCtl --support-bundle`: a ZIP with redacted logs, `agastya.ini` (secrets masked), doctor output, versions, migration level, free disk, last 200 audit action names without meta - and **never** the database or workspace; include a canary test that seeded secrets do not appear `[S39]`. (4) Write security events (failed logins above a threshold, role changes, release decisions, audit failure, backup result) to the Windows Application log with stable event ids, so Windows Event Forwarding can collect them without an agent `[S33]` (`RES-004`).
**Expected outcome** A customer can e-mail one file that lets support diagnose most incidents; monitoring can distinguish "process up" from "able to serve".
**Dependencies** ENT-003, ENT-006.
**Risks** Logging user ids and routes is personal data: keep it local, rotate, and keep request bodies out.
**Acceptance criteria** `/api/ready` returns 503 when the database is made unavailable or disk is below the floor, 200 otherwise; every log line parses as JSON and contains no password/cookie/token in a seeded-secret test; support bundle excludes `publisher.db` and contains the doctor report; security events appear in the Application log (checked with `Get-WinEvent`).
**Test cases** readiness fault injection; log-redaction canary; bundle content listing test; `Get-WinEvent` assertion in the install smoke test.

### ENT-008 · P1 · VERIFIED · M · The bundled runtime (Node 22) leaves security support on 2027-04-30 and its SQLite module is still experimental; performance numbers were measured on a different runtime

**Category** Supportability / supply chain (NIST SI-2, SA-22).
**Problem** The installer ships Node v22.23.2. Node 22 reaches end of life on **2027-04-30** `[S30]` - about five months from this audit - after which no security fixes exist for the runtime that every customer runs. The database layer is `node:sqlite`, documented as Stability 1.1 (active development) in Node 22 and 1.2 (release candidate) from Node 24.15.0 `[S30]`; every backend test run prints the experimental warning. The only performance baseline in the repository was taken on "Node 26.13", not on the shipped runtime, so it cannot be used as a regression baseline for what customers get.
**Evidence** `release/.../runtime/node.exe --version` -> `v22.23.2` (VERIFIED, 2026-11-26); `backend/package.json` `engines.node >=22.5`; `docs/S1000D_COMPLIANCE_MATRIX.md:96-113` (baseline "on Node 26.13, 8 CPUs"); test output `scratchpad/I/tests.out` (ExperimentalWarning for SQLite); `backend/vendor/engine/db.js:20` (`new DatabaseSync`).
**Current implementation** Runtime pinned by the packaging script to 22.x.
**Recommendation** Move the bundled runtime to the Node **24 LTS** line (maintenance to 2028-04-30 `[S30]`) after running the full backend and e2e suites and the performance baseline on it; pin the exact version in `packaging/product.json`; add a CI/preflight check that fails when the bundled Node is within 12 months of EOL (the 12-month figure is a choice, not a standard). Re-baseline performance on the shipped runtime (see 04-PERFORMANCE-AUDIT). Keep `node:sqlite`; the isolation of the DB layer in `AuthStore` is the hedge (see `RES-002`).
**Expected outcome** The shipped product is on a supported runtime for the support window; baselines refer to what customers run.
**Dependencies** test chain (audit area G) must be green on Node 24; packaging (area F).
**Risks** API differences in `node:sqlite` between 22 and 24 (the backend uses `DatabaseSync` and prepared statements only: OBSERVED); native `argon2` binary must be rebuilt for the new ABI.
**Acceptance criteria** installer contains Node 24.x LTS; full test chain passes on it; performance baseline repeated on it and stored; EOL check in the packaging script.
**Test cases** run the backend test files and e2e against the new runtime; `node --version` assertion in the install smoke test.

### ENT-009 · P2 · VERIFIED · S · No separation of duties: the person who requests a release can approve it

**Problem** `canSubmit` (editor, manager, owner) and `canApprove` (admin, or a Project Manager holding manager/owner on the project) overlap; nothing compares requester and approver, so one person can request and approve their own release (NIST AC-5). The code comment says authors never approve their own work - true for authors, not for Project Managers or administrators.
**Evidence** `backend/src/routes/project-content.ts:271-278` (`canSubmit`, `canApprove`), `:307-316` (`decide` has no requester check), `backend/src/services/release.ts:155-161` (`decideRelease` takes only `adminId`).
**Recommendation** Add a project setting "requester cannot approve own release" defaulting to **on** when the project has more than one eligible approver, with an audited administrator override reason; show the reason in the UI and in the audit event.
**Acceptance** requester == approver is refused with a clear message when the setting is on and another approver exists; the override is audited with a reason; a single-approver project still works with an audited self-approval.

### ENT-010 · P2 · VERIFIED · S · Sessions last 7 days with no idle timeout

**Problem** A session stays valid for seven days regardless of inactivity; engineering PCs are shared and left unlocked. OWASP suggests idle timeouts of 15-30 min for low-risk and 2-5 min for high-value applications and 4-8 h absolute for all-day office use `[S28]`; SP 800-63B-4 AAL2: SHOULD <= 24 h overall and <= 1 h idle `[S22]`; NIST AC-12.
**Evidence** `backend/src/core/auth/sessions.js:11` (7-day absolute TTL); `core/auth/authz.js:25-36` (`last_seen_at` touched, never compared); frontend grep for idle/inactivity logic finds nothing relevant (NOT a runtime test).
**Recommendation** Add server-side `idle_timeout` and `absolute_timeout` settings (defaults 30 min and 12 h; both configurable in the admin screen and `agastya.ini`; defaults are a recommendation derived from `[S28]` and `[S22]`, the owner should confirm), enforce them in `resolve()`, purge expired rows daily, and show a "session about to expire" notice in the UI that saves the open editor first.
**Acceptance** an authenticated request after the idle period returns 401 and the UI returns to sign-in without data loss in the editor; absolute limit enforced even with activity; `sessions` table is purged of expired rows.

### ENT-011 · P2 · VERIFIED · M · Authentication hardening gaps: throttle only, in-memory, proxy-blind, directory enumeration

**Problem / evidence** (a) Login throttling is an in-memory map keyed `username|ip`, 10 tries per 15 minutes (`core/auth/rateLimit.js:8-9, 19-21`; called with `username.toLowerCase(), ip` at `core/auth/routes.js:191`); it is lost on restart, there is no account lock or alert (AC-7), and because the key contains the username there is **no per-IP aggregate**: one source can try one password against every account without ever hitting the limit (password spraying; code reading, not exercised at runtime). (b) The client address is `req.socket.remoteAddress` (`core/auth/routes.js:58`; `context.ts:107-108`) although `trust proxy 1` is set (`app.ts:43`): behind a reverse proxy every client appears as the proxy, so per-IP throttling collapses to per-username and audit rows carry the proxy address (code VERIFIED; effect behind a proxy SUSPECTED - confirm with one proxied request). (c) `/api/users/search` answers any signed-in user with username, full name and role (`routes.js:419-424`; at most 8 results per query, a one-character prefix is enough), so the directory can be enumerated by prefix - which turns the predictable temporary password of ENT-002 into a practical attack. (d) Failed-login audit rows record the typed username even when it does not exist (`routes.js:201`, `meta: { username, reason: 'unknown-user' }`), which can capture mistyped passwords in the username field. (e) `reset-admin.js` takes the new password as a command-line argument (visible in process listings and shell history).
**Recommendation** Persist failure counters in the DB; add progressive delay and an audited, admin-visible lock after a configurable number of failures; use `req.ip` (honouring `trust proxy`) for the client address; restrict user search to members of the caller's projects/folders (plus admins); do not store typed usernames of unknown accounts (store a hash prefix or the length); let `reset-admin` prompt for the password or read it from stdin.
**Acceptance** counters survive restart; the sixth wrong password in a window produces an audit event and an admin notification; behind a proxy the audit IP is the client's; a non-admin cannot enumerate users outside their projects.

### ENT-012 · P2 · VERIFIED · S · No security headers on the application; WebSocket upgrade does not check Origin

**Problem / evidence** Security headers (CSP, nosniff, frame protection) are set only on two package-preview routes (`backend/src/routes/packages.ts:195-196, 212`); the SPA and the API send none (`app.ts:100-107`, static serve). Cross-origin **writes** are refused (`app.ts:55-63`), which is good, but the WebSocket upgrade authenticates by cookie only (`services/broadcast.ts:22-30`): `SameSite=Lax` blocks cross-site use, while a page on another port of the same host is "same site" (SUSPECTED, low impact: the socket carries notifications/updates).
**Recommendation** One middleware setting `Content-Security-Policy` (`default-src 'self'`, no inline script after checking the SPA and the two embedded editors with `Content-Security-Policy-Report-Only` first), `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'` (the preview routes can stay their own policy), `Referrer-Policy: no-referrer`, and an Origin check on `/ws` mirroring the HTTP rule `[S28]`. The CSP doubles as the proof that nothing loads from the internet (gate G-OFF-2).
**Acceptance** `curl -I` on `/`, `/api/health` and a static asset shows the headers; the app works with zero CSP violations in the console on the main routes; a WebSocket upgrade with a foreign `Origin` is refused.

### ENT-013 · P2 · VERIFIED · S · The database has no "schema newer than this program" guard, so downgrades corrupt silently

**Problem / evidence** `AuthStore.migrate()` applies the migrations it knows that are not in `schema_migrations`; it never compares the stored list with the program's list (`backend/src/core/auth/store.js:644-674`). Running an older build against a database touched by a newer one (a rollback after a failed upgrade, or restoring a newer backup) proceeds with tables and columns the old code does not understand. The only automatic snapshot is before migration 016 (`context.ts:70-76`); the installer takes a pre-upgrade copy, and the guide says rollback is manual (`OPERATIONS.md:100-105`).
**Recommendation** On start, refuse (clear message, exit code, Event Log entry) when `schema_migrations` contains a name the program does not know; take a snapshot before **every** upgrade that applies at least one migration (reusing `dbSnapshot.ts`), keep the last N; document the rollback as "restore snapshot + older build".
**Acceptance** starting an older build on a newer database exits with a specific error and leaves the DB untouched; an upgrade that applies migrations leaves a dated snapshot; restore of that snapshot with the old build succeeds.

### ENT-014 · P2 · VERIFIED · M · Release artefacts are unsigned and unlisted: no signature, no SBOM, no deployment-tool detection kit

**Problem / evidence** `Get-AuthenticodeSignature` reports **NotSigned** for `Agastya-Platform-2.0.0-win-x64-Setup.exe`, `AgastyaCtl.exe` and `AgastyaPlatform.exe` in `release/` (VERIFIED, 2026-11-26); `Setup.exe` SHA-256 `959ebb23...5dee77` equals `SHA256SUMS.txt` (VERIFIED); `scripts/package-windows.mjs:321-327` writes only the checksum list; no SBOM (grep for `sbom`, `cyclonedx`: none); `docs/SIGNING.md` documents signing as off by default with an internal CA recommended and signatures not timestamped by default. The installer has a complete silent switch set (`agastya.iss`, `OPERATIONS.md:107-127`) but no documented SCCM detection rule or Intune `.intunewin` recipe; GPO software installation needs MSI `[S33]`. The `release/` folder is dated 2026-11-22 and predates the 2026-11-23..26 merges (stale relative to `main`, per project memory).
**Recommendation** (1) Sign the three binaries and the installer with the customer's or the vendor's internal-CA code-signing certificate and an RFC 3161 timestamp; document trust distribution by GPO/Intune (`SIGNING.md` already outlines it). (2) Produce a CycloneDX SBOM from the lockfiles plus the bundled runtime/JRE/FOP versions and sign it with a detached key-based signature verifiable offline `[S41]`. (3) Publish a one-page deployment kit: detection rule (Uninstall registry key + `AgastyaCtl.exe` file version), the silent command lines, exit codes, `.intunewin` build command. (4) Rebuild `release/` from `main` before any customer hand-over. (5) MSI only if a customer requires GPO software installation.
**Acceptance** `Get-AuthenticodeSignature` -> Valid with a timestamp on all four files; SBOM lists every shipped component with versions and verifies with the published public key; the deployment kit is exercised once in SCCM/Intune test (NOT VERIFIED today).

### ENT-015 · P2 · VERIFIED · M · No retention or compaction for audit, sessions, notifications and revisions

**Problem / evidence** No code removes rows from `audit_log`, `sessions` (expired rows stay), `notifications` (read rows stay), `lifecycle_events`, or old `revisions`/`blobs` (grep for `DELETE FROM` finds none for these); `audit_log` has indexes only on `at` and `action` (`store.js:128-129`) while `services/activity.ts:50-56` filters by `project_id` and the admin viewer by actor, so cost grows with the table. AU-11 expects a defined retention period; growth is otherwise unbounded and unmonitored. Revision content is immutable and content-addressed (a strength) but never pruned (`core/collab/revisions.js:41-55`).
**Recommendation** Admin settings: audit retention (default: keep, with archive-then-prune option, see ENT-003), session purge (daily), notification purge (read items older than 90 days - a suggestion), revision retention left at "keep" with a visible size gauge; add `project_id` and `actor_id` indexes. Report table sizes in `--doctor`.
**Acceptance** purge jobs run and are audited; query plans for the activity feed use an index; `--doctor` prints row counts and DB size.

### ENT-016 · P2 · VERIFIED · M · Concurrency guard is optional and the "lock" is an owner freeze, not a check-out

**Problem / evidence** The server only checks for a concurrent change when the client sends `baseHash` (`backend/src/services/csdb.ts:200-203`: `if (baseHash && baseHash !== currentHash)`); the Studio does send it and handles `EDIT_CONFLICT` (`frontend/src/lib/studioSession.ts:283,299`), but any other client (import API, scripts, other editors) overwrites silently. The document lock freezes a module for everyone except owners/admins (`csdb.ts:141, 194, 236`; `project-content.ts:105-119`) - useful for "released, do not touch", not a way for two authors to claim different modules. The revision write after a save swallows errors (`csdb.ts:182-188`), so a failed revision cut still reports success.
**Recommendation** Make `baseHash` **mandatory** for updates of existing modules (clients that have no hash must read first); add per-user **check-out with a lease** (default 60 minutes, renewed by the editor, admin/owner break with audit) shown in the file tree; fail the save (or at least return a warning flag) when the revision write fails. Do not add CRDT/OT (`RES-001`).
**Acceptance** a save without `baseHash` for an existing module is rejected; two editors cannot hold the same lease; a lease expires and can be broken with an audit entry; a forced revision-write failure surfaces to the caller.

### ENT-017 · P2 · VERIFIED · S · Waivers lose their history and reasons

**Problem / evidence** A waiver lets a draft build proceed without a BREX it cannot satisfy. Waivers are kept in a per-project JSON file; adding the same waiver again **replaces** it and removing it **erases** the reason and author (`backend/src/services/publishWaivers.ts:22-38, 50, 55-61`); the audit event for add/remove records the kind and subject but not the reason (`backend/src/routes/waivers.ts:25, 32`); any editor can add one. A quality system needs to know who accepted which deviation and why, after the fact.
**Recommendation** Store waivers as append-only rows (add/remove events with reason, actor, time) in the DB, include the reason in the audit event, optionally require manager approval for waivers and an expiry date; waivers never apply to release (already true: `publishWaivers.ts:1-9`).
**Acceptance** after add -> remove -> add again the history shows three events with reasons; the audit event contains the reason text; a waiver past its expiry no longer applies.

### ENT-018 · P2 · SUSPECTED · M · Accessibility conformance is unmeasured; there is no automated gate

**Problem / evidence** The frontend uses `aria-` attributes (297 occurrences in 53 files) and `role=` (63), focus-visible styles and responsive e2e specs, but has no axe/automated accessibility test (frontend `package.json` has none; no `axe` string in `frontend/e2e`) and no manual conformance record; the three framework-free editors (Studio, JSS, JSG) hold custom widgets where automated scans are weakest. WCAG 2.2 AA is the current W3C Recommendation; whether the owner's customers require it is NOT VERIFIED (file 13, section 6). What would confirm the suspicion: an axe run on the main routes and a keyboard-only pass of the five core tasks.
**Recommendation** Add `@axe-core/playwright` scans to the existing Playwright e2e for the main routes (sign-in, workspace, project, Studio, Publish, Admin) with a zero serious/critical budget, then a one-time manual pass (keyboard, screen reader, 200 % zoom, reflow, target size 24 px) recorded in `docs/`. Results feed gate G-UX-1..4.
**Acceptance** CI-style run reports zero serious/critical axe violations on listed routes; manual checklist stored and dated.

### ENT-019 · P3 · VERIFIED · S · The licence module is dormant and its public key custody is unknown

**Problem / evidence** `backend/vendor/engine/license.js` implements an Ed25519-signed key with `notBefore`/`expiry`, optional machine binding (hostname + platform + arch + first MAC, `:43-53`) and a clock-rollback guard (`:127-150`), and embeds a `DEFAULT_PUBLIC_KEY` (`:22-23`). No code in `backend/src`, `frontend/src`, `packaging` or `scripts` calls it; the only reference is a test asserting the file's hash (`backend/test/pm-multiref.test.js:26`). Whether the product is to be licensed is a business decision (outside the audit); who holds the matching private key is unknown (NOT VERIFIED).
**Recommendation** Decide the commercial model first. If licensing is wanted: keep the signed licence **file** in the data folder, no mandatory hardware binding (fingerprints break on cloned VMs/NIC changes), expiry puts the product in read-only/export-only mode, never lock customers out of their own data (`RES-008`). If not: delete or document the file as unused so reviewers do not assume enforcement.
**Acceptance** a written decision; either the wiring + tests or the removal.

### ENT-020 · P2 · VERIFIED · S · The audit redactor removes the release fingerprint from `release.requested` events

**Problem / evidence** `audit()` strips any metadata key matching `/password|hash|token|secret|cookie|credential/i` (`backend/src/context.ts:99-101`). The release request logs `{ scheduledAt, contentHash }` (`backend/src/services/release.ts:140-147`, `routes/project-content.ts:293`), so the key `contentHash` is dropped: replaying the redactor on that object yields `{"scheduledAt":"x"}` (VERIFIED by running the same regex). The fingerprint the approver signs off is therefore absent from the audit event of the request, and the approval event (`:319`) records only the release id - the audit trail cannot show *which content* was approved without cross-reading the `releases` table.
**Recommendation** Narrow the redactor to exact secret key names (`password`, `newPassword`, `token`, `secret`, `cookie`) and add `contentHash` (renamed `fingerprint`) to the request and approval events; add a unit test over the real call sites.
**Acceptance** the audit rows for request and approval both contain the fingerprint; the redactor still removes the five secret names (test).

### ENT-021 · P3 · OBSERVED · S · Notifications are in-app only

**Problem / evidence** The inbox is a table + API (`services/notifications.ts`, `routes/team.ts:122-129`); no e-mail or webhook sender exists. On closed networks an internal SMTP relay is common, but the in-app inbox covers the core need (approver sees the pending release).
**Recommendation** Optional: an SMTP relay setting (host, port, from) with a per-user opt-in; off by default; no external services.
**Acceptance** with a local test SMTP sink a release request produces one message to the approver; with the setting empty nothing is sent.

### ENT-022 · P3 · OBSERVED · M · S1000D security classification and data restrictions do not influence access or export

**Problem / evidence** Classification/restriction fields in the data-module status are used for output marking, import identity and applicability, not for access decisions (code search for use of `dataRestrictions` and classification in authorisation paths: none). A customer mixing classifications in one workspace has no need-to-know control beyond project membership.
**Recommendation** Optional and customer-driven: a per-project "maximum classification" and an export warning when a package contains modules above the recipient/profile level. Separate workspaces remain the simpler isolation.
**Acceptance** an export containing a module above the project's maximum classification is blocked or requires an audited override.

### ENT-023 · P3 · OBSERVED · M · Roles are fixed in code

**Problem / evidence** The three global roles and five project roles cannot be customised; `routes/admin.ts:62-78` presents them read-only. QuILS advertises configurable rights `[S11]`. The fixed model matches the documented workflow and is covered by `rbac.test.js` and the route guard test; configurability multiplies test surface.
**Recommendation** Do not build; revisit only if two customers ask for different release authority. A middle path is an "auditor" (read-only, audit + all projects) global role, which removes the need to give auditors administrator rights (AU-9(4)).
**Acceptance** n/a (optional).

## 7. Research-derived recommendations (RES-xxx)

These are design choices and options that come from the industry research in file 13; the defects they relate to are the ENT findings. Priorities follow the brief; every item names the problem it solves and the evidence. **Mandatory** versus **optional** is stated per item.

### RES-001 · P2 · RECOMMENDATION · M · Concurrency model: mandatory hash guard + per-user check-out lease; do not adopt CRDT/OT

**Problem solved** Silent overwrite by clients that omit `baseHash`, and no way for an author to claim a module (ENT-016). **Evidence** Competitor practice: Windchill/Arbortext use check-out/check-in `[S02]`; Oxygen Web Author uses real-time shared sessions with documented limits (one saving owner, no multi-server load balancing) `[S05]`; no source found showing CRDT/OT merges preserve XSD/BREX validity (file 13 section 8). A data module is validated as a whole, partitions of work are by module, release is bound to a whole-file SHA-256 (`release.ts:36-51`).
**Recommendation (mandatory part)** Server requires `baseHash` for updates of existing modules; add a lease-based check-out (default 60 min, renewable, admin/owner break, audited). **Optional/future** Real-time co-editing limited to free-text leaf elements, only if users ask; would need a single-node WebSocket room service (the code comment `app.ts:70` records that no rooms exist today).
**Acceptance** see ENT-016.

### RES-002 · P2 · RECOMMENDATION · S · Keep SQLite; write down the switch criteria; harden how it is opened

**Problem solved** Uncertainty about "when do we need PostgreSQL" and a latent contention risk. **Evidence** sqlite.org: low writer concurrency on one host is the intended case; WAL needs one host and a local filesystem `[S29]`; the product is one process on one host with short writes; `PRAGMA journal_mode = WAL` is the only pragma set (`backend/vendor/engine/db.js:22`); no `busy_timeout`, no `integrity_check`/`quick_check` anywhere (grep) and the Node default for `timeout` is 0 `[S30]`; SQL is spread over services (51 `dbh()` call sites plus direct `store.db.prepare` in `activity.ts`, `sns`, `s1000dRef`, `projectConfig`, `bootReference`), so a port would not be mechanical.
**Recommendation** (1) Do **not** migrate to PostgreSQL now. (2) Write the criteria that would trigger it into `docs/`: more than one server process or host; sustained concurrent writers producing `SQLITE_BUSY` in the access log; a customer requirement for point-in-time recovery `[S31]`; database above a size the backup window cannot meet (value to be set after baseline measurement, 04-PERFORMANCE-AUDIT). (3) Set `busy_timeout` (to be set after baseline measurement; a few seconds is typical), leave `synchronous` at its default until the crash test (G-REL-2) justifies a change, and run `PRAGMA quick_check` at start-up and from `--doctor`. (4) Keep new SQL inside `AuthStore`/`store` methods so a future port has one surface.
**Acceptance** documented criteria; `--doctor` reports `quick_check`; a two-process contention test (service + `AgastyaCtl --backup-db`) shows no failed operation.

### RES-003 · P3 · RECOMMENDATION · L · Identity roadmap beyond LDAPS (optional, customer-driven)

**Problem solved** Remaining sign-in friction after ENT-005. **Evidence** `node-expose-sspi` offers Windows SSPI middleware (Kerberos/NTLM; needs a domain service identity and an SPN) `[S35]`; gMSA exists for service identity but needs a domain `[S33]`; TOTP is offline-capable. **Recommendation** Start Windows-integrated sign-in only after a customer requires "no password prompt" and accepts a domain-joined service identity; start TOTP only if the customer's policy requires MFA and has no IdP; start OIDC/SAML only when a named on-prem IdP exists. Each should be an optional module so the loopback single-user install gains no dependency.
**Acceptance** each module has its own on/off switch, a break-glass local admin, and no effect when off.

### RES-004 · P2 · RECOMMENDATION · M · Off-box audit: Windows Event Log events with stable ids + signed checkpoints

**Problem solved** AU-9(2): audit copies on a different system; the customer SIEM needs a feed (ENT-003, ENT-007). **Evidence** Windows Event Forwarding is agentless, source-initiated, intranet-only `[S33]`; the host already writes lifecycle events (`AgastyaHost.cs:260-262, 354-360`). **Recommendation** Emit a small, documented set of events (failed-login burst, account lock, role/membership change, release request/decision, backup/restore result, audit write failure, audit verification failure) to the Application log under a dedicated source with fixed event ids; publish the id list in `OPERATIONS.md`; optionally ship a WEF subscription XML. Checkpoints (last audit sequence + hash) are written with every backup.
**Acceptance** `Get-WinEvent` returns the events in the install smoke test; ids are documented and stable across versions.

### RES-005 · P2 · RECOMMENDATION · M · Air-gapped release engineering: sign, timestamp, SBOM, verify offline

**Problem solved** Managed endpoints and procurement reject unsigned installers and ask for component lists (ENT-014). **Evidence** Private-CA signing is outside the CA/B Forum public-trust rules `[S37]`; `docs/SIGNING.md:13-18, 41, 63-65` already describes internal CA, GPO/Intune trust distribution and RFC 3161 timestamping; CycloneDX SBOM + key-based detached signature verifies with a public key only `[S41]`; `SHA256SUMS.txt` exists (`scripts/package-windows.mjs:321-327`).
**Recommendation** Make `scripts/package-windows.mjs` (or a sibling) emit `SBOM.cdx.json` (lockfile packages + bundled Node, JRE, FOP, libxslt, XSD sets with versions), sign `SHA256SUMS.txt` and the SBOM with a detached signature, and ship a 20-line offline `verify-release.ps1` that checks hashes, signature and Authenticode status. Pin all bundled runtime versions in `packaging/product.json` and print them in `--doctor`. Put the schema level and Node version in the release notes.
**Acceptance** the verify script passes on a clean machine with no network; a modified installer byte fails it.

### RES-006 · P2 · RECOMMENDATION · M · Support bundle and readiness design (what goes in, what must never)

**Problem solved** Remote supportability with no connectivity (ENT-007). **Evidence** Practice across Harness/Cloudera/Anaconda: default redaction, custom rules, review step, tests for secrets `[S39]`; liveness/readiness separation `[S38]`. **Recommendation** Allow-list, not block-list: the bundle contains only named files (version/product.json, `agastya.ini` with secret keys masked, rotated logs after redaction, doctor report, migration list, table row counts, disk and service state, last 200 audit **action names** with timestamps and no meta). It never contains `publisher.db`, workspace files, cookies, password hashes or tokens. `/api/ready` returns a small JSON of named checks (db, disk, renderer, migrations) with pass/fail only.
**Acceptance** canary test: seed a password, a token and a project name in the workspace and logs, produce the bundle, `grep` finds none of the canary strings except the project name where the ini mentions it (documented).

### RES-007 · P2 · RECOMMENDATION · M · Accessibility test approach for a hand-built UI

**Problem solved** WCAG 2.2 AA is unmeasured (ENT-018). **Evidence** WCAG 2.2 criteria `[S26]`; automated scans cover only part and manual testing is required `[S27]`; the three framework-free editors (Studio, JSS, JSG) contain custom widgets. **Recommendation** Three layers: (1) `@axe-core/playwright` zero-serious budget on ten named routes in the existing e2e run; (2) a manual checklist (keyboard-only, focus not obscured 2.4.11, target size 2.5.8, dragging alternatives 2.5.7, accessible authentication 3.3.8 for the login page, reflow at 320 px, 200 % zoom) executed once per release candidate on the five core tasks and recorded; (3) one screen-reader pass (NVDA is free and offline) on sign-in, workspace and the Studio tree. Write findings into the e2e backlog; do not claim conformance without (2) and (3).
**Acceptance** see G-UX-1..4.

### RES-008 · P3 · RECOMMENDATION · M · If licensing is required: offline signed licence file, soft failure, no mandatory hardware binding

**Problem solved** ENT-019. **Evidence** Offline licensing options and their limits `[S34]` (immutable embedded data; no clock-rollback coverage); Oxygen uses a licence server with manual offline activation `[S09]`; `license.js` already has Ed25519 verification, expiry, a rollback guard and optional machine binding (`license.js:43-96, 127-150`). **Recommendation** Reuse `license.js` unchanged in design: licence file in the data folder (term, edition, seats, optional machine id); expiry produces a banner, then **read-only + export-only** after a grace period - never data lock-out; machine binding only on request, with a documented re-issue procedure; private key held offline by the vendor with a written custody procedure. If no commercial licensing is planned, remove the module (ENT-019).

### RES-009 · P2 · RECOMMENDATION · S · Align password and session defaults to SP 800-63B-4 and OWASP

**Problem solved** The current minimum of 8 characters with a short denylist is the NIST floor for **multi-factor** use; a password-only product should meet the single-factor rule. **Evidence** SP 800-63B-4: single-factor passwords >= 15 characters, no composition rules, no forced rotation, blocklist required, <= 100 consecutive failures `[S22]`; current policy `core/auth/policy.js:22-43` (min 8, max 128, ~70-word denylist); Argon2id parameters are appropriate (`crypto.js:17-47`). **Recommendation** Make the minimum configurable with default 15 while no second factor exists (8 when MFA is enabled), keep no composition rules, extend the blocklist with context words (username, full name, product and company names), keep no forced rotation, and set session defaults as in ENT-010. The numbers are a policy choice for the owner; the source supports the direction.
**Acceptance** a 14-character password is refused by default, a 15-character passphrase accepted; context words refused; documented in `OPERATIONS.md`.

### RES-010 · P3 · RECOMMENDATION · S · Optional internal SMTP relay notifications (ENT-021)

Only when a customer asks; off by default, no external services, per-user opt-in; test with a local SMTP sink.

### RES-011 · P2 · RECOMMENDATION · M · One release-readiness script that runs the static gates

**Problem solved** Gates drift unless something runs them. **Evidence** the product already has a static route-guard test that enforces authorization coverage (`backend/test/routes-guarded.test.js`, 8/8 pass with rbac). **Recommendation** A single `scripts/readiness-check` (read-only) that runs: route-guard + new audit-coverage static test (G-SEC-5), ACL check on an installed copy (G-SEC-6), Authenticode status (G-SEC-11), SBOM presence/verify (RES-005), Node EOL margin (G-SEC-11), CSP report-only/violations from an e2e run (G-OFF-2), doctor on a clean install (G-DEP-6). Output a dated table in `docs/` for the release record.
**Acceptance** the script exits non-zero on any failed gate and prints the gate ids.

### RES-012 · P3 · RECOMMENDATION · M · MSI only on demand

GPO Software Installation distributes MSI only `[S33]`; SCCM and Intune already work with the silent EXE. Build an MSI (WiX) only when a named customer requires GPO distribution; until then publish the detection rule and `.intunewin` recipe (ENT-014).

## 8. Production-readiness gates (master prompt section 17)

**How targets were chosen.** (a) A target comes from a cited standard or practice, or (b) from the product's own stated nature (offline-first, one-click install, a release workflow that must be trustworthy), or (c) is labelled **"to be set after baseline measurement (see 04-PERFORMANCE-AUDIT)"** with the rule that fixes how it will be set. For gates that test chance events (crashes, races) I use the standard "rule of three": 0 failures in *n* independent trials gives a 95 % upper bound of about 3/*n* on the failure probability, so n = 100 supports a claim of "below about 3 %" and n = 30 only "below about 10 %"; I state n in each gate rather than "no failures observed". "Today" = status at this audit: **FAIL** (measured/verified shortfall), **PASS** (verified), **UNMEASURED** (no evidence either way), **NOT VERIFIED**.

### 8.1 Security (G-SEC)

| ID | Criterion and measurement | Target | Why this target suits Agastya | Basis | Today |
|---|---|---|---|---|---|
| G-SEC-1 | Every listener bound to a non-loopback address serves TLS only. Measure: `Get-NetTCPConnection -State Listen` + plain HTTP request to each port | 100 % of non-loopback listeners; 0 plain-HTTP responses | A LAN option exists and carries passwords and session cookies | NIST SC-8 `[S21]` | FAIL (ENT-001) |
| G-SEC-2 | Initial/reset credentials are not derivable. Measure: create 200 accounts and 20 resets, compare against `username@year` and each other | 0 matches; >= 60 bits of entropy (design choice, no standard states a number) | The username is public inside the product (user search), so a derivable secret is a takeover path | SP 800-63B-4 (verifier-issued secrets random) `[S22]` | FAIL (ENT-002) |
| G-SEC-3 | Server-side session limits. Measure: injected clock; request after idle period and after absolute period | Idle default 30 min, absolute default 12 h, both configurable; 401 in 100 % of cases past the limit (n = 20 timing points) | Shared engineering PCs; a release approver's session is a high-value session | OWASP Session Mgmt `[S28]`; AAL2 `[S22]`; AC-12 | FAIL (ENT-010; 7 d, no idle) |
| G-SEC-4 | Audit integrity. Measure: seeded tamper tests on a copy: edit one row, delete a middle row, insert a forged row, delete the last 10 rows; run `--verify-audit` | 3/3 in-chain classes detected; tail truncation detected against the latest checkpoint | The audit log is the evidence for "who released what"; detection beats prevention against a local administrator | AU-9(3), Schneier-Kelsey `[S36]` | FAIL (no mechanism, ENT-003) |
| G-SEC-5 | Audit coverage. Measure: a static test (like `routes-guarded`) that lists every state-changing route and requires an audit action or an allow-list entry with a reason | 0 unclassified routes (today: 26 of 153 handlers show no direct audit call in my crude scan; 4 traced ones audit indirectly) | A new route added without audit is invisible to the auditor; the existing authorization test shows the team can enforce this style of rule | AU-2 | UNMEASURED |
| G-SEC-6 | Data and state folder ACLs on a default server install. Measure: `icacls` on both folders | No `BUILTIN\Users` ACE; only SYSTEM, Administrators, service identity | Authorization lives in the application; file access bypasses it | AC-3/AC-6; `agastya.iss:372-378` | FAIL (ENT-004) |
| G-SEC-7 | Secrets never in logs, support bundle or audit meta. Measure: run login, reset, CSV import, backup, support bundle with canary secrets; grep all outputs | 0 occurrences | Logs travel by e-mail/USB to the vendor | `[S39]` | UNMEASURED |
| G-SEC-8 | Security headers and CSP. Measure: header check on `/`, a static asset, an API route; browser console on ten main routes | Headers present on 100 % of sampled responses; 0 CSP violations | Cheap hardening; also proves no external resource loads (G-OFF-2) | OWASP headers `[S28]` | FAIL (ENT-012) |
| G-SEC-9 | Brute-force controls. Measure: (a) 11 wrong passwords for one account, (b) one guess against each of 200 accounts from one IP | (a) 11th refused and audited; (b) throttled by a per-IP aggregate after a configured threshold (value to be chosen by the owner; 100 consecutive failures is the NIST ceiling per authenticator) | Passwords are the only authenticator; spraying is the realistic attack | AC-7; SP 800-63B-4 `[S22]` | FAIL for (b), PASS for (a) by code reading (ENT-011) |
| G-SEC-10 | Authorization route coverage and role rules. Measure: `node --test test/routes-guarded.test.js test/rbac.test.js` | 100 % pass | The one control that already has a static guard; it must never regress | AC-3 | **PASS** (VERIFIED 8/8 on current `dist`, 2026-11-26) |
| G-SEC-11 | Supply chain at the release candidate. Measure: `Get-AuthenticodeSignature` on installer + 2 executables; SBOM verify; bundled Node EOL date | All Valid with timestamp; SBOM verifies offline; bundled Node >= 12 months before EOL on the release date (12 months is a choice, not a standard) | Managed endpoints and procurement; a security-support gap is a customer finding | CA/B scope `[S37]`, `[S30]`, `[S41]` | FAIL (NotSigned, no SBOM, Node 22 EOL 2027-04-30; ENT-008, ENT-014) |
| G-SEC-12 | Known-vulnerability scan of shipped production dependencies at the release candidate | 0 high/critical without a recorded waiver | Standard release hygiene; offline-capable if the advisory database is imported | (practice) | NOT VERIFIED (not run: `npm audit` forbidden by brief; owned by area S) |

### 8.2 Reliability (G-REL)

| ID | Criterion and measurement | Target | Why this target suits Agastya | Basis | Today |
|---|---|---|---|---|---|
| G-REL-1 | Backup/restore round trip on a populated scratch workspace: compare row counts + hashes of every table, every project file, audit chain verification | 100 % equal; **RPO** = backup interval (default daily); **RTO** to be set after the first measured restore drill | Revision history and release state live only in the DB; the claim "recoverable" must be measured, not assumed | CP-9, CP-9(1) `[S21]` | FAIL (ENT-006: DB not in backup, no restore) |
| G-REL-2 | Crash safety: kill the server hard at random points during save, release approve, import, backup; then start and run `quick_check` + a workspace consistency check | n = 100 kill points, 0 corrupt databases, 0 half-written releases (95 % bound about 3 %) | SQLite WAL is crash-safe by design but this product also writes files beside the DB (two-store writes); the combination is what needs proof | rule of three; `[S29]` | UNMEASURED |
| G-REL-3 | Upgrade/downgrade matrix: N-2 -> N and N-1 -> N with data intact; older build on newer DB | 100 % of 6 data states (empty, sample, large, with releases, with waivers, with in-flight release); old build refuses newer DB with a clear message | Customers will roll back; silent corruption is unacceptable | ENT-013 | FAIL for the refusal part |
| G-REL-4 | Concurrent saves: 2, 5, 10 simulated clients saving the same and different modules, 1 000 saves each case | 0 silent overwrites: every conflicting save is rejected or serialised; every accepted save has a revision | A lost update is data loss for a document that may be safety-relevant | ENT-016 | FAIL for clients omitting `baseHash` |
| G-REL-5 | Disk-full and read-only volume behaviour (small VHD / quota) | Clear error to the user; no DB corruption (`quick_check` ok); service stays up; recovery after space is freed with no manual repair (n = 10 trials, 0 failures: a smoke level only, 95 % bound about 30 %) | Workspaces and PDF builds are large; disks do fill | CP-9 | UNMEASURED |
| G-REL-6 | Service recovery after process kill | First restart attempt at the configured 5 s (`AgastyaHost.cs:525-537`); ready again within a limit to be set after baseline measurement (see 04-PERFORMANCE-AUDIT) | The product runs unattended as a service | `sc failure` config | UNMEASURED |
| G-REL-7 | 24-hour soak with a scripted workflow (edit, validate, publish, backup) at the supported concurrency | 0 crashes; memory growth and handle count within limits to be set after baseline measurement | Leaks show only over time; the JVM-based PDF step is the likely contributor | (practice) | UNMEASURED |
| G-REL-8 | Audit write failure behaviour (fault injection) | Visible alert for every failure; critical actions are not recorded as successful without their audit row | Fail-open audit hides evidence loss | AU-5 | FAIL (ENT-003) |
| G-REL-9 | Database health checks | `quick_check` ok at start and after each test in the G-REL matrix; `--doctor` reports it | Cheap early warning | RES-002 | FAIL (no check exists) |

### 8.3 Performance (G-PERF) - measured by agent H; this file defines the rule, not the numbers

*Where the numbers are (added when agent H's report arrived).* `04-PERFORMANCE-AUDIT.md` gives the baseline on the audit host (section 3), the benchmark suite B1-B13 with datasets D0-D7 and fail thresholds (section 6) and 18 proposed targets T1-T18 (section 8). Those figures were taken on Node 22 on a shared host whose CPU times varied up to 2x, so shapes and ratios are reliable and absolute times are indicative; the numbers that fix G-PERF-1 to G-PERF-3 must be re-taken on a quiet reference machine with the runtime chosen in WP-13 (see `14-PRIORITIZED-IMPLEMENTATION-ROADMAP.md`). Status today for the gates below: G-PERF-1 and G-PERF-2 FAIL against the proposed targets for validation, gate, save-at-scale and backup (PERF-001, PERF-005, PERF-006); G-PERF-3 not yet applicable (no baseline is stored in the repository, and the audit's own build measurements are single samples); G-PERF-4 needs the owner's decision (D3, D15).

| ID | Criterion | Target | Why |
|---|---|---|---|
| G-PERF-1 | Interactive operations (open project, open a data module, save, validate one module, search) | p95 latency per operation **to be set after baseline measurement (see 04-PERFORMANCE-AUDIT)** | Numbers must come from the shipped runtime and a defined reference machine |
| G-PERF-2 | Batch operations (import 500 DM + 1 000 ICN; validate project; HTML and PDF publication; backup; restore) | Time and peak RSS **to be set after baseline measurement**. Repository's own figures (3.9 s, 3.7 s, 20.4 s, 73.2 s, 448 MB peak, `S1000D_COMPLIANCE_MATRIX.md:96-113`) were taken on Node 26.13 and are **NOT VERIFIED** for the shipped Node 22 | The shipped runtime is not the measured one (ENT-008) |
| G-PERF-3 | Regression rule | A release candidate may not exceed the baseline by more than the run-to-run variation measured over >= 5 baseline runs (the variation, not an invented percentage) | Avoids both false alarms and silent drift |
| G-PERF-4 | Supported scale (users, projects, modules per project, workspace size) | **Owner decision**, then test at 2x the stated figure; the figure is the sizing statement customers need | One SQLite writer and one Node process bound the design; the stated scale must be tested, not inferred `[S29]` |

### 8.4 Offline operation (G-OFF)

| ID | Criterion and measurement | Target | Why this target suits Agastya | Basis | Today |
|---|---|---|---|---|---|
| G-OFF-1 | Zero outbound connections from product processes (node, java, AgastyaCtl, AgastyaPlatform) during install, start, a scripted full workflow and uninstall, with outbound firewall block + connection audit log | 0 attempted outbound connections | Offline-first is the product promise; the check is binary | product brief | NOT VERIFIED (not run; static scan of dependency telemetry belongs to area F/S) |
| G-OFF-2 | No external resources in the UI. Measure: CSP `default-src 'self'` report-only across ten routes; search built `frontend/dist` for `http(s)://` hosts other than XML namespaces | 0 violations; 0 foreign hosts | Fonts/CDNs sneak in through libraries | OWASP CSP `[S28]` | UNMEASURED |
| G-OFF-3 | Clean-machine install with no network and no prerequisites | 100 % on each supported OS image (list to be defined by the owner; the wizard bundles runtime, JRE, FOP) | Customer networks are isolated | product brief | NOT VERIFIED (installer not executed here) |
| G-OFF-4 | All features work with the network adapter disabled, including PDF publication, validation against bundled XSD sets, help | 100 % of the scripted workflow | Same | product brief | UNMEASURED |

### 8.5 Deployment (G-DEP)

| ID | Criterion and measurement | Target | Why this target suits Agastya | Basis | Today |
|---|---|---|---|---|---|
| G-DEP-1 | Silent install, upgrade, repair, uninstall on clean VMs; exit codes; install log | 100 % of scenarios (per-machine and per-user x install/upgrade/uninstall/uninstall-keep-data), exit code 0, log written, data kept on uninstall by default | SCCM/Intune need silent, deterministic installs `[S33]` | `agastya.iss:5-9` | UNMEASURED (switch set exists) |
| G-DEP-2 | One-click goal: number of mandatory decisions in the default install | <= 1 (derived from the owner's one-click objective in the audit brief; the wizard today has a data-folder page and a port page with defaults - count to be recorded) | The owner's stated product goal | brief | UNMEASURED |
| G-DEP-3 | Detection rule and uninstall completeness (SCCM/Intune test) | Rule reports installed/not-installed correctly in both states; uninstall removes service, firewall rule, shortcuts | Managed deployment depends on it | `[S33]` | FAIL (no rule published, ENT-014) |
| G-DEP-4 | Doctor sensitivity | Healthy install exit 0; each of 8 seeded faults (missing runtime, JRE, port in use, low disk, read-only data dir, stopped service, bad ini, expired TLS cert) detected, exit != 0 | The doctor is the supportability backbone | `OPERATIONS.md:47-54` | UNMEASURED |
| G-DEP-5 | Upgrade safety | Snapshot taken before every upgrade that migrates; rollback procedure tested end to end once per release | Rollback is manual today | ENT-013 | PARTIAL (installer copy exists) |
| G-DEP-6 | Time to first sign-in on a reference VM | to be set after baseline measurement | One-click claim needs a number | - | UNMEASURED |

### 8.6 UI/UX (G-UX)

| ID | Criterion and measurement | Target | Why this target suits Agastya | Basis | Today |
|---|---|---|---|---|---|
| G-UX-1 | Automated accessibility scan on ten named routes (sign-in, workspace, project, Studio, JSS editor, JSG editor, Publish, Release, Admin, Settings) | 0 serious/critical axe violations | A browser-delivered app falls directly under WCAG 2.2; scans are cheap in the existing e2e | WCAG 2.2 `[S26]`, `[S27]` | UNMEASURED (no tool wired, ENT-018) |
| G-UX-2 | Keyboard-only completion of five core tasks: sign in, create project, create and edit a data module, validate, request and approve a release | 5/5 tasks with no mouse and no focus trap | Core engineering tools are used for long sessions; required by WCAG 2.1.1/2.4.7 | WCAG 2.2 | UNMEASURED |
| G-UX-3 | Visual criteria on tokens and key screens: text contrast 4.5:1 (3:1 for large text and UI components), target size >= 24 x 24 CSS px, reflow at 320 px, 200 % zoom without loss | 100 % of checked elements | These are testable thresholds written in WCAG 1.4.3, 1.4.10, 1.4.11, 2.5.8 | WCAG 2.2 `[S26]` | UNMEASURED (design-system agent E2 measures contrast) |
| G-UX-4 | Manual screen-reader pass on three routes | 0 blockers | Automated scans miss custom widgets | `[S27]` | UNMEASURED |
| G-UX-5 | Session expiry or save failure never loses typed content | 0 lost edits in 20 fault-injected cases (95 % bound about 15 %; raise n to 100 for a bound near 3 %) | Authors write for hours; ENT-010 adds a timeout, which makes this gate necessary | ENT-010 | UNMEASURED |
| G-UX-6 | First-use task success (new author creates and validates a first data module without help) | to be set after baseline measurement with the first usability round (>= 5 users) | Task success is the product-level UX measure; no benchmark exists for this tool class | - | UNMEASURED |

### 8.7 Quality (G-Q)

| ID | Criterion and measurement | Target | Why this target suits Agastya | Basis | Today |
|---|---|---|---|---|---|
| G-Q-1 | Full backend + frontend + e2e chain on the **release candidate with the shipped Node version** | 100 % pass; every skip has a recorded reason | The owner paused chain tests (`S1000D_COMPLIANCE_MATRIX.md:92`); a release is not claimable without one full run | brief | UNMEASURED (I ran 2 files only: 8/8) |
| G-Q-2 | Every closed P0/P1 audit finding has a regression test that names its ID | 100 % | Prevents the same defect returning; cheap to check by grep | - | n/a |
| G-Q-3 | Type check and build | `tsc --noEmit` 0 errors in backend and frontend; build output reproducible from a clean checkout | Basic hygiene; also a precondition for the Node 24 move | - | UNMEASURED |
| G-Q-4 | Golden/isolation outputs for S1000D, JSS, JSG | Unchanged unless re-baselined with a recorded reason | Output fidelity is the product's value | existing tests | UNMEASURED |
| G-Q-5 | Test stability | 3 consecutive full runs with no test passing only on retry | Flaky tests hide real regressions; 3 runs is a smoke check, not a statistical claim (the 95 % bound on a per-run flake rate with n = 3 is close to 100 %); for "below about 10 %" run the suspect subset 30 times | rule of three | UNMEASURED |
| G-Q-6 | Readiness script exits 0 (RES-011) | 100 % of gates G-SEC-5/6/11, G-OFF-2, G-DEP-4 automated | One command makes the gate table repeatable | RES-011 | n/a |

## 9. Suggested order of work (effort-ordered, mandatory first)

| Step | Items | Why first | Effort |
|---|---|---|---|
| 1 | ENT-002, ENT-020, ENT-012, ENT-013 | Small, no design risk, close takeover/evidence/downgrade gaps | S each |
| 2 | ENT-004 (+ tray control), ENT-001 | Removes the local bypass and the clear-text path; prerequisite for trusting ENT-003 | M each |
| 3 | ENT-006 (backup/restore), ENT-003 (audit chain) | Core data protection and evidence | M each |
| 4 | ENT-008 (Node 24), ENT-014 (signing, SBOM), RES-011 | Release can be handed to a customer | M each |
| 5 | ENT-007, ENT-010, ENT-011, ENT-009, ENT-016, ENT-017, ENT-015 | Operability and workflow integrity | S-M each |
| 6 | ENT-005 (LDAPS) | Largest item; needs ENT-001 first | L |
| 7 | ENT-018 (a11y gate) in parallel from step 1 | Needs only test wiring first | M |
| Optional | ENT-019, 021, 022, 023, RES-003, 008, 010, 012 | Only with a named customer need | - |

## 10. Strengths (not findings)

* **One authorization decision point with a static coverage test.** `evaluate()` (`core/auth/authz.js:69-146`) is used by every route; `routes-guarded.test.js` fails the build if any `/api` route is neither guarded nor on an explicit public list (VERIFIED: 8/8 pass; public set exactly `GET /api/auth/setup`, `GET /api/health`, `POST /api/auth/forgot`, `POST /api/auth/login`, `POST /api/auth/setup`).
* Uniform **404 for non-members** (no existence leak); admin override is explicit.
* **Argon2id** (64 MiB, t=3, p=4) with scrypt fallback and a constant-time dummy verify for unknown users (`crypto.js:17-68`).
* **Session tokens** are 256-bit random, stored only as SHA-256, HttpOnly + SameSite=Lax cookie; rotation on login, password change and onboarding; single active session; admin session list/revoke.
* **First-run setup is race-safe** (transaction) and the legacy master password is disabled (`masterPassword.js`).
* **Release is bound to a content fingerprint** (`release.ts:36-51`): any edit after approval un-releases the publication; approval issues in-work modules as the next S1000D issue; publication gate before request and approval (`project-content.ts:289, 309`).
* **Content-addressed revisions** with hash re-verification on read (`core/collab/revisions.js:41-74`); **S1000D lifecycle** with issue/in-work files, change marks and a `lifecycle_events` table (`services/lifecycle.ts:1-24`).
* **Transactional migrations** with rollback and a foreign-key check (`store.js:644-674`) and a pre-migration snapshot for the risky one.
* **Installer**: complete silent switch set, service with recovery actions, pre-upgrade DB copy, data kept on uninstall, firewall rule scoped to private/domain profiles, loopback default bind; `AgastyaCtl --doctor`; signing guidance and internal-CA plan documented (`SIGNING.md`).
* **Offline by design**: no telemetry or licence call-outs found in the code paths read (a full outbound-traffic test is G-OFF-1, not yet run).
* **Optimistic concurrency** in the editor (`baseHash` + `EDIT_CONFLICT` handling, `studioSession.ts:283,299`) and a cross-origin write guard (`app.ts:55-63`).

## 11. Unknowns and limitations

* **Nothing here was run against a live system beyond two existing test files** (8/8 pass), file-signature and `node --version` checks on `release/`, and small regex/static-scan scripts in my scratch folder. No server, installer, browser or load test was run; findings labelled VERIFIED rest on unambiguous code reading or those checks, as the label definitions allow. Where only the effect (not the code) is uncertain, the text says SUSPECTED.
* **Static audit-coverage scan is a proxy.** My script (`count-actions.js`, `audit-cover.js` in the scratch folder) matches route registrations against `log/pLog/aLog/audit` calls inside the handler text; it flags 26 of 153 state-changing registrations. I traced four; the rest (validation previews, mark-as-read, factory-built handlers such as `decide`) were not all traced, so no audit-coverage defect is claimed. The 132-action figure is a count of distinct string literals, not of events exercised.
* **Installer behaviour is read from the script**, not executed (ACLs, firewall rule, service creation). `release/` is dated 2026-11-22 and is older than the current `main`.
* **Windows service and tray behaviour** (`AgastyaHost.cs`) was read only in the parts that set the service account, recovery actions and Event Log entries; the tray's file-write needs (the reason for ENT-004) are taken from the installer comment.
* **Frontend accessibility, idle handling and i18n** were checked by search only; no UI was run.
* **Competitor capabilities** are vendor statements (file 13); no competitor product was run; RWS Contenta, Inmedius/Aptly and Astoria-for-S1000D could not be verified.
* **Standards text**: NIST 800-53 read from a reproduction site, ISO 27001 and IEC 62443 from secondary summaries; S1000D contains no CSDB access-control requirements that I could source. Confirm originals before quoting in a compliance document.
* **Customer requirements unknown**: whether customers require WCAG conformance, MFA, LDAP, FIPS algorithms, or specific retention periods is **not known**; the classification of ENT-005/ENT-018 as essential enterprise assumes a defence/aerospace customer with a security policy and an IT department (the product's stated market), and should be re-weighed by the owner against real customer requirements.
* **Performance and scale** numbers are deliberately absent (agent H); the repository's own baseline is on a different Node major.
* **Dependency vulnerabilities** and **outbound traffic** were not scanned (areas S and F).

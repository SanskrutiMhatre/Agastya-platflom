# 13 - Industry research and benchmarking

Audit team agent **I** - research for master-prompt sections 15 and 16 (feeds `12-ENTERPRISE-READINESS.md`, which holds the ENT/RES findings and the readiness gates).
Audit date 2026-11-26. Audit only: nothing in the product was changed.

**Scope and method.** Web research (WebSearch standard/extended + WebFetch of primary pages) on enterprise technical-publication and S1000D tooling, enterprise offline deployment
patterns, identity for isolated networks, audit/access standards, accessibility, database choice, collaborative editing, backup/DR, observability and air-gapped release
engineering. Each claim below carries a source id `[Sxx]`, resolved in the full list in section 11. Where only a search-result snippet was available (the page itself was not
read), the source list says `snippet`; where a page was read in full for the point used it says `read`. Where the only source is a secondary reproduction (e.g. a compliance
blog quoting ISO) it says `secondary`. Nothing here is copied from a proprietary implementation: competitor facts are the vendors' own public statements, summarised in my words,
and **no competitor product was run**, so every "capability" below is a vendor claim, not a measured fact. The product facts compared against come from the code reading in
`12-ENTERPRISE-READINESS.md` (cited there with `path:line`). The web tool returns summaries produced by a small model; I treated anything that looked unusual as unconfirmed
and say so.

Labels used in this file (in addition to the brief's evidence labels):

| Tag | Meaning |
|---|---|
| `[STD]` | published standard / specification text |
| `[PRAC]` | widely used engineering practice documented by a vendor, project or standards body (not a normative requirement) |
| `[COMP]` | competitor or comparable-product feature as the vendor describes it |
| `[OPT]` | optional idea, no clear requirement behind it |
| `[REC]` | my recommendation for Agastya (the numbered RES items live in `12-ENTERPRISE-READINESS.md`) |

## 1. Coverage table

| Area | Status | Verification done | Limits |
|---|---|---|---|
| PTC Arbortext Editor / Publishing Engine / Windchill S1000D module | Partially inspected | 3 PTC help-center pages located by search (snippets), 1 support article | Product pages are version-specific; no admin/security documentation read; Arbortext licensing not checked |
| Oxygen XML Editor / Author / Web Author | Inspected | Concurrent-editing page and S1000D blog **read**; on-prem, confidentiality and licence-server pages by snippet | No product run; Web Author S1000D availability per build not confirmed |
| RWS Tridion Docs / Contenta S1000D | Partially inspected | Search snippets only; the Contenta S1000D page fetched empty twice | Contenta feature list **NOT VERIFIED** (page unreadable); Tridion Docs S1000D support not found (it is described as DITA-based) |
| Adobe FrameMaker (+ AEM Guides) | Partially inspected | Adobe help page and community thread via search | Built-in S1000D dates from FrameMaker 10 / issue 4.0; current plug-in status unverified |
| Hensoldt QuILS, Contiem notusCSDB, Boeing Spectrum, NavIETM, UltraCSDB, CSDB/AI | Partially inspected | QuILS page **read**; others snippet only | No pricing, no deployment details beyond what the vendor page states |
| Quanos SCHEMA ST4, Astoria, Author-it | Partially inspected | Snippets and aggregator listings | No evidence found that any of the three authors S1000D; Astoria S1000D support **NOT VERIFIED**; Inmedius/Aptly: **no usable result** (NOT VERIFIED) |
| DITA-OT, s1kd-tools (open source) | Inspected | DITA-OT docs by snippet; s1kd-tools repo page **read** | Tool-by-tool capability list of s1kd-tools not read |
| Windows service identity, gMSA, GPO/SCCM/Intune distribution, MSI vs EXE | Inspected | Microsoft Learn pages **read** (service accounts, gMSA, Intune Win32); GPO/SCCM by search | MSI-vs-EXE recommendation is my synthesis |
| Offline licensing | Inspected | Keygen docs **read**; Oxygen licence server by snippet | No FlexNet/Arbortext licence documentation read |
| LDAPS / Kerberos / NTLM / SSO for isolated networks | Partially inspected | Microsoft LDAP channel-binding KB **read**; Node SSPI/Kerberos packages by search | Maintenance status of the npm packages not verified; no AD FS/Keycloak primary page read |
| NIST SP 800-53 (AU, AC, IA, SC, CP), 800-63B-4, 800-171 | Inspected | 800-63B-4 **read** (first 100 k chars of 289 k); 800-53 control text **read** via a reproduction site (csf.tools); 800-171 by snippet | 800-53 text is from a reproduction, not nist.gov; 800-171 Rev 3 vs Rev 2 CMMC status unresolved (sources conflict) |
| ISO/IEC 27001:2022 Annex A | Partially inspected | Compliance-blog summaries only (`secondary`) | Standard text is paywalled; 5.15 and 8.32 not covered by any result |
| IEC 62443 | Partially inspected | INCIBE summary (`secondary`) | Applicability to a documentation tool is my inference |
| S1000D / ASD / AIA guidance on CSDB access control and change tracking | Partially inspected | Spec text **not obtainable**: searches returned vendor and secondary pages only | No normative statement on CSDB roles/audit/access was found, so none is asserted (see 5.3) |
| WCAG 2.2 / WCAG2ICT / EN 301 549 | Inspected | W3C pages **read**; EN 301 549 by secondary summaries | Section 508 WCAG version not confirmed |
| SQLite vs PostgreSQL, WAL, node:sqlite | Inspected | sqlite.org and Node docs **read** | Product-specific load not measured here (see `04-PERFORMANCE-AUDIT`) |
| Collaborative editing (locking vs OT/CRDT) | Partially inspected | Oxygen page **read**, Yjs home **read**, 2 arXiv hits by snippet | **No source found on schema-validity of CRDT/OT merges for XML** - stated as a gap, not guessed |
| Backup/DR, observability, air-gapped release engineering | Inspected | NIST CP-9, CISA, PostgreSQL docs **read**; support-bundle and SBOM practice by search | CISA primary page not read (snippet) |

## 2. Landscape: enterprise technical-publication and S1000D platforms

`[COMP]` throughout. "Offline/air-gap" is my reading of the deployment model the vendor states; none was tested.

| Product (vendor) | What it is | S1000D | Deployment model | Collaboration / change control | Governance / security as the vendor states it | Offline / air-gap suitability | Src |
|---|---|---|---|---|---|---|---|
| **Arbortext Editor + Publishing Engine + Windchill Service Information Manager S1000D module** (PTC) | Thick-client structured editor; server-side publishing engine; PLM-backed CSDB | S1000D module adds S1000D features to Editor and enables S1000D publishing in Publishing Engine; issue 4.2 support documented | **Thick client + PLM server** (Windchill, Tomcat, JVM for publishing); S1000D menu appears only when connected to a Windchill server | **Check-out / check-in** of data modules (and dependent objects); validation on check-in of BREX; edit session starts with a check-out prompt | Windchill workflow/lifecycle states and ACLs (not read in detail) | On-prem possible; heavy footprint (PLM + Tomcat + Publishing Engine + versions matrix 5.4-8.3 / Windchill 9.1-13.1) | S01 S02 S03 S19 |
| **Oxygen XML Editor / Author / Web Author** (Syncro Soft) | Thick-client XML editor; Web Author = browser editor served by an on-prem server | Editor 28.1: dedicated framework for **issues 4.0/4.1/4.2**; DM/PM templates; schema-guided editing; BREX converted to Schematron; Web Author S1000D editing reported (release notes, via aggregator) | Desktop (floating licence server, HTTP) and **on-premise** Web Author ("distributed only on-premise"; files edited are held in server memory) | Web Author: **real-time shared editing over WebSockets**; only the session starter can save; does **not** work behind a multi-server load balancer; Git/WebDAV connectors | Framework-level validation; no CSDB of its own (relies on connectors/CMS) | Good: desktop and on-prem server; manual licence activation procedure exists for an offline licence server | S05 S06 S07 S08 S09 |
| **Contenta S1000D / Contenta Cloud S1000D, Tridion Docs** (RWS) | Contenta = S1000D CSDB + publishing + IETP; Tridion Docs = DITA-based CCMS | Contenta: yes (cloud, private cloud or on-prem per the vendor); Tridion Docs: no S1000D claim found | Contenta: public cloud, private cloud, **on-premises**; Tridion Docs core: on-prem or RWS cloud | CCMS check-out/workflow (not read) | RWS states ISO 27001 and SOC 2 Type 2 for its **cloud** operations | On-prem Contenta plausible; feature list **NOT VERIFIED** (page unreadable) | S10 |
| **QuILS CSDB / Author / HTML Publisher / Retrieval** (Hensoldt) | S1000D CSDB, CSDB client for data-module editing, publisher, viewer | Up to S1000D 6.0 (vendor) | Client-server CSDB with an authoring client (inferred; the vendor page states no model); web-based Retrieval viewer | Process-driven data creation: DMRL, IPRF/CF, FBT via DDN | "Granular rights and roles" configurable to the organisation's workflow; built-in BREX validation; QA checks and reports | HTML Publisher creates standalone **IETP-X** packages viewable without installing software (good for field/offline delivery) | S11 |
| **notusCSDB** (Contiem) | Commercial CSDB | Yes | Integrates with Eclipse-based authoring environments and other S1000D authoring tools | n/a (not read) | n/a | n/a | S12 |
| **Spectrum S1000D software** (Boeing) | Browser-based editor + Arbortext plug-in + publishing | Yes ("full S1000D schema compliance") | Brochure only | n/a | n/a | n/a | S18 |
| **FrameMaker (+ AEM Guides)** (Adobe) | Structured authoring desktop tool; AEM Guides is a cloud-centric CCMS | Built-in support dates from **FrameMaker 10 / issue 4.0**; practitioners recommend the Mekon/Contiem plug-in for current work | Desktop (+ cloud CCMS) | n/a | n/a | Desktop usable offline; AEM Guides S1000D fit unverified | S14 |
| **SCHEMA ST4** (Quanos), **Astoria** (RWS/GlobalLink family), **Author-it** | DITA/XML or proprietary CCMS | **No evidence found** that any of the three authors S1000D | ST4: cloud, ISO 27001, German servers; Astoria: On-Demand cloud and **On-Premise**; Author-it: cloud | n/a | n/a | Astoria On-Premise only | S15 S16 |
| **DITA-OT** (open source) | Publishing pipeline toolkit (Ant/XSLT/Java), plug-in architecture, `dita` CLI, JSON logs, project files with multiple deliverables | DITA only (not S1000D) | Command line / CI | none (it is a pipeline) | none | **Excellent**: fully local | S17 |
| **s1kd-tools** (open source, GPL-3.0) | Small command-line tools for S1000D data (validate, authoring helpers, publication); can sit beside Git/SVN as a minimal CSDB | Primarily issue 7; compatible with 6, 5.0, 4.x; SGML not planned | Command line | Delegated to Git/SVN | none | **Excellent** | S13 |

**Gaps in the table (honest):** no Inmedius/Aptly data; no pricing; no performance or usability comparison; RWS Contenta features unverified; nothing from S1000D steering-committee sources.

### 2.1 What the comparison says about Agastya's positioning

(Agastya facts below are from `12-ENTERPRISE-READINESS.md` unless a path is given.)

* **Architecture class.** The established S1000D stacks are thick-client + server products (Arbortext + Windchill, QuILS Author + CSDB) or desktop editor + external CMS (Oxygen). Agastya is a **single-process on-prem web application with a built-in editor, CSDB-like project store, validation, publishing (PDF/HTML) and release workflow** in one Windows installer. That is the lightest deployment among the products compared: no PLM, no Tomcat, no separate licence server. It is also the least proven in governance depth (see below).
* **What competitors visibly offer that Agastya lacks:** directory/SSO integration (not documented by the vendors read, but implied by enterprise PLM/CMS deployment - **NOT VERIFIED**), configurable rights and roles per organisation (QuILS states it; Agastya's roles are fixed in code: `backend/src/routes/admin.ts:62`), process-driven data creation lists (DMRL/IPRF/DDN - Agastya generates DML/DDN as outputs, not as a workflow driver), a standalone IETP viewer package (QuILS HTML Publisher). Agastya's static HTML publication (`docs/S1000D_COMPLIANCE_MATRIX.md:79`) covers part of the last point.
* **What Agastya has that the open-source stacks lack:** an integrated authoring UI, project-level role model, release workflow bound to a content fingerprint (`backend/src/services/release.ts:36-51`), PDF generation with bundled FOP and JRE, and a one-installer Windows distribution. DITA-OT and s1kd-tools are pipelines/tool-kits, not authoring or governance products.
* **Collaboration model.** Arbortext/Windchill = check-out/check-in `[S02]`; Oxygen Web Author = real-time shared session with explicit limits `[S05]`; QuILS = process-driven with rights (no collaboration detail). Agastya = per-data-module optimistic hash check plus owner lock, no real-time rooms (`backend/src/app.ts:70`, `backend/src/services/csdb.ts:200-203`). Section 8 explains why that is the right base for S1000D data modules.
* **Delivery to the field.** QuILS ships standalone IETP-X packages `[S11]`; Agastya's delivery package + HTML publication are the comparable output (compliance matrix row 12).

## 3. Which items are standards, which are practice, which are optional

| # | Topic | Standards `[STD]` | Proven practice `[PRAC]` | Optional ideas `[OPT]` |
|---|---|---|---|---|
| 1 | Audit and access control | NIST SP 800-53 Rev 5 AU-2/AU-5/AU-9/AU-11, AC-5/AC-7/AC-12, IA-5; SP 800-63B-4; ISO 27001:2022 A.8.15/A.8.5 (secondary) | Hash-chained logs (Schneier-Kelsey) with external anchoring | Per-document need-to-know ACLs keyed to S1000D security classification |
| 2 | Transport | NIST SC-8 | TLS-terminating reverse proxy or native TLS with an internal CA | HSTS preload (not meaningful on an intranet name) |
| 3 | Identity | NIST SP 800-63B-4 | LDAPS with channel binding; Kerberos/SPNEGO via Windows SSPI; on-prem OIDC/SAML IdP | TOTP MFA |
| 4 | Accessibility | WCAG 2.2 (W3C Rec), WCAG2ICT (W3C Note), EN 301 549 v4.1.1 (secondary) | axe automated scan + manual keyboard/AT checks | Full VPAT |
| 5 | Database | none | SQLite for single host with short write transactions; PostgreSQL for multi-writer/server-class load | Dual-engine support |
| 6 | Collaboration | none | Check-out/check-in (PLM class); real-time shared session (web editors) | CRDT-backed co-editing of whole documents |
| 7 | Backup/DR | NIST CP-9, CP-9(1) | SQLite backup API; 3-2-1; periodic restore tests | Immutable offline copy |
| 8 | Observability | none | Liveness vs readiness separation; structured logs; redacted support bundle; Windows Event Forwarding | Prometheus-style metrics endpoint |
| 9 | Release engineering | CA/B Forum code-signing BR apply to **public** certificates only | Internal CA + RFC 3161 timestamp; checksums; SBOM + key-based detached signature | SLSA provenance attestation |
| 10 | Licensing | none | Ed25519-signed licence files with embedded term, no hard hardware binding | Challenge-response activation |

## 4. Deployment, distribution and service hardening (enterprise offline)

### 4.1 Installer format: MSI vs EXE `[PRAC]`
* Group Policy Software Installation distributes **Windows Installer (MSI) packages only**; EXE installers need a startup/logon script workaround and there is no installation reporting `[S33: Microsoft Learn training module, search snippet]`.
* Configuration Manager (SCCM) deploys EXE, MSI, App-V and appx with **detection methods**; for MSI the detection is normally the ProductCode, for EXE a file/registry/script rule `[S33, search]`.
* Intune deploys EXE/MSI as **Win32 apps** packaged to `.intunewin` by the Win32 Content Prep Tool, with detection rules and requirement rules; it **does not support interactive installs** (silent only), app size limit 30 GB `[S33, read]`.
* `[REC]` Agastya ships an Inno Setup EXE with a complete silent-install switch set (`packaging/installer/agastya.iss:5-9`, `docs/OPERATIONS.md:107-127`), which satisfies SCCM and Intune. It does **not** satisfy GPO Software Installation. Producing an MSI is worth doing only if a customer's tooling forces GPO; the cheaper path is a documented detection rule (Uninstall registry key for the AppId GUID + file version of `AgastyaCtl.exe`) and a scripted `.intunewin` recipe.

### 4.2 Windows service identity `[PRAC]`
* A service runs in the context of a chosen account; the SCM does not manage the password of ordinary user accounts; special accounts are LocalService, NetworkService, LocalSystem `[S33, read]`.
* Group managed service accounts (gMSA) give automatic password management and SPN management but need a domain, Kerberos AES encryption types and Windows Server 2012+ `[S33, read]`; they only matter if the service must authenticate to other domain resources.
* `[REC]` Agastya registers `NT AUTHORITY\LocalService` (`packaging/host/AgastyaHost.cs:525-537`), the least-privileged built-in choice, with restart actions (5 s/30 s/60 s) and Application event-log lifecycle entries. For a single-machine server this is appropriate. A **virtual service account** (`NT SERVICE\<name>`) would additionally let the data folder be ACL'd to that one identity; that is what closes the Users:Modify grant described in `ENT-004`. gMSA is only needed if a future LDAP/Kerberos integration requires the service to hold a domain identity.

### 4.3 Event forwarding in isolated networks `[PRAC]`
* Windows Event Forwarding in **source-initiated** mode sends events to a collector over WinRM (5985/5986) using Group Policy to point sources at the collector; it needs only internal connectivity `[S33, search]`.
* `[REC]` Writing security-relevant application events (failed logons, role changes, release decisions) to the Windows Application log lets a customer's existing SIEM/WEF pipeline collect them with no product-specific agent. Today only host lifecycle events are written (`AgastyaHost.cs:260-262, 354-360, 477, 487`).

### 4.4 Offline licensing `[PRAC]`
* Offline licence models: signed licence files (Ed25519 or RSA-2048 certificate over a snapshot of licence data), signed or encrypted keys carrying entitlements; Ed25519 recommended, ECDSA P-256 for FIPS contexts `[S34, read]`.
* Trade-offs stated by the source: embedded data is **immutable** (changing a binding or renewing needs a new key), expiry dates "may not be the best choice for a renewable key", and the page does **not** cover revocation, key management or clock rollback `[S34, read]`.
* Oxygen's desktop licensing uses an HTTP floating-licence server with a documented manual activation procedure for an offline server, and returns a licence to the pool if the connection is lost or after 2 h idle `[S09, snippet]`.
* Hardware binding trade-off (my analysis, from how `license.js` derives its fingerprint): fingerprints built from hostname + OS + arch + first MAC (`backend/vendor/engine/license.js:43-53`) change when a VM is cloned, a NIC is replaced or the host is renamed; for a product installed on managed VMs this causes support load, so binding should be optional and re-issuable.
* `[REC]` If commercial licensing is needed: reuse the existing Ed25519 design, ship a *licence file in the data folder* (term, edition, seat count), degrade to **read-only/export-only** at expiry (never lock customers out of their own data), no hardware binding by default. See `ENT-019` and `RES-008`.

## 5. Identity, audit and access-control standards

### 5.1 Identity on isolated networks
* **LDAP signing / channel binding.** Domain controllers can be set to require LDAP signing and channel binding; a plain simple bind on port 389 can be rejected, and LDAPS (636) simple binds should support channel binding `[S33: Microsoft KB, read]`. `[REC]` Any LDAP client Agastya adds must default to **LDAPS** and validate the server certificate against the customer's internal CA.
* **Windows-integrated sign-on.** On Node, `node-expose-sspi` exposes Windows SSPI (NTLM, Kerberos) with Express middleware, needs the server to run as a domain user with an SPN for Kerberos and falls back to NTLM outside a domain; `node-krb5`/`node-kerberos` need native build toolchains `[S35, search; maintenance status not verified]`. For a bundled-Node Windows product this is the lowest-friction route to "no password for domain users" but it is Windows-only and ties the service to a domain identity (see 4.2).
* **On-prem IdP (OIDC/SAML).** A customer-hosted IdP (AD FS, Keycloak) works with no internet because every endpoint is intranet; I found no primary page to cite, so this is `[OPT]`.
* **Passwords.** NIST SP 800-63B-4: single-factor passwords at least **15** characters, with multi-factor allowing **8**; **no** composition rules; **no** forced periodic rotation; verifiers **shall** check against a blocklist; at most **100** consecutive failures per authenticator before it is disabled (agencies may set lower) `[S22, read]`. Session limits (AAL2: overall SHOULD <= 24 h, inactivity SHOULD <= 1 h; AAL3: overall SHALL <= 12 h, inactivity SHOULD <= 15 min; AAL1: overall <= 30 days, inactivity optional) `[S22, read]`.
* **Sessions (OWASP).** Idle timeout 2-5 min high-value / 15-30 min low-risk; absolute timeout 4-8 h for an office worker's all-day use; regenerate the session id on privilege change; enforce server-side; show active sessions to the user `[S28, read]`.
* **Implication.** Agastya's Argon2id parameters, 8-char minimum and denylist match the NIST *multi-factor* floor but not the single-factor 15-char rule; its 7-day absolute session with no idle timeout is outside every cited recommendation (`ENT-010`).

### 5.2 NIST SP 800-53 Rev 5 controls that matter for a defence/aerospace publication system `[STD]`
(Control text quoted from a reproduction site, `secondary`; verify against nist.gov before citing in a compliance document.)

| Control | Requirement (paraphrase) | Why it bites here |
|---|---|---|
| AU-2 | Define the event types to log, justify them, review periodically | Agastya writes 132 distinct audit action names (file 12, section 2, row 2) but has no stated audit policy |
| AU-5 | Alert designated roles on audit-logging failure; take defined actions | `audit()` swallows write failures (`backend/src/context.ts:102-104`) - there is no alert |
| AU-9 / AU-9(3) | Protect audit information from unauthorized access, modification and deletion; **cryptographic protection of audit information integrity** (High baseline) | audit table is a plain table; no chain or signature (`store.js:116-130`) |
| AU-9(2) | Store audit records on a physically separate system (High) | no export/forwarding |
| AU-11 | Retain audit records for an organisation-defined period | no retention setting; no purge; CSV export caps at 5 000 rows (`platform.ts:83-88`) |
| AC-5 | Separation of duties; dual authorization examples include "requested by one person, reviewed by a second" | release request and approval can be the same person (`ENT-009`) |
| AC-7 | Limit consecutive invalid logons per time period; lock or delay | in-memory 10 per 15 min per username+IP (`rateLimit.js:8-9`); no lock, no admin notification |
| AC-12 | Automatically terminate a session after organisation-defined conditions | 7-day absolute TTL, no idle trigger (`sessions.js:11`) |
| SC-8 / SC-8(1) | Protect confidentiality and integrity of transmitted information; cryptographic mechanisms | HTTP only (`ENT-001`) |
| SC-28 / SC-28(1) | Protect information at rest; cryptographic protection (Moderate and above) | database and projects are plaintext files; OS-level (BitLocker) is the realistic answer, not application encryption |
| CP-9 / CP-9(1) | Back up user-level and system-level information, protect backups, **periodically test** backups | `ENT-006` |

* **NIST SP 800-171 (CUI).** Rev 3 restructures the families (14 -> 17) and expands audit and accountability; **sources conflict** on whether CMMC Level 2 currently uses Rev 2 or Rev 3, so I do not assert which applies `[S23, snippet]`. A defence supplier handling CUI would be assessed against the control families above either way.
* **ISO/IEC 27001:2022 Annex A** `[secondary]`: 8.15 Logging (produce, store, protect and analyse logs), 8.5 Secure authentication (replaces 2013 A.9.4.2), 8.13 Information backup. No result covered 5.15 (Access control) or 8.32 (Change management); I do not assert their content.
* **IEC 62443** `[secondary]`: written for industrial automation and control systems; the 4-2 component requirements cover embedded devices, network devices, host devices and **software applications** with target security levels set by a system-level risk assessment, and conformance is generally contractual. A documentation publisher is **not** an IACS component unless it is installed inside an OT network (my inference, not verified). Treat 62443 as **not applicable by default**; borrow nothing from it that NIST 800-53 does not already cover.

### 5.3 What S1000D / ASD / AIA say about CSDB access control and change tracking
* **Sourced:** the S1000D data-module status section carries security classification, responsible partner company and originator, applicability, QA status, **data restrictions** (export control, distribution) and the **reason for update** (secondary guides: `[S20]`). The CSDB is described functionally and tool-agnostically; **the specification does not define CSDB functionality** (`[S20]`, s-series.org snippet).
* **Not found:** any normative text on CSDB user roles, audit trails or access control. Vendor pages (QuILS, notusCSDB, CSDB/AI, UltraCSDB) claim role-based access and audit trails, but those are product claims, not requirements.
* **Implication:** the audit/access requirements for an S1000D CSDB come from the **customer's security policy and the standards above**, not from S1000D. Agastya's implementation of S1000D-native change tracking (issue/in-work files, change marks, RFU attributes, `lifecycle_events`) is a strength independent of that gap (`backend/src/services/lifecycle.ts:1-24`).

### 5.4 Tamper-evident audit logs `[PRAC]`
* Schneier-Kelsey (1999): each entry is hashed with the previous hash and MAC'd with a key derived from the previous key by a one-way function; compromise after the fact cannot undetectably alter earlier entries (forward integrity). Known limitations: **truncation of tail entries**, delayed detection, O(n) verification with the private-key variant `[S36, snippet/summary]`.
* `[REC]` A simple HMAC hash-chain over the existing `audit_log` rows, a key kept outside the database, and **periodic exported checkpoints** (last id + last hash, written to a separate file/printed report) closes the practical threats here (a local user editing the DB, rows deleted from the tail). It does not defend against an administrator with the key and full control; that needs AU-9(2) off-box storage (event forwarding, 4.3).

## 6. Accessibility: WCAG 2.2 AA for desktop web applications `[STD]`
* WCAG 2.2 adds nine success criteria and removes 4.1.1 Parsing; the **AA** additions are 2.4.11 Focus Not Obscured (Minimum), 2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum), 3.3.8 Accessible Authentication (Minimum); Level A additions are 3.2.6 Consistent Help and 3.3.7 Redundant Entry `[S26, read]`.
* **Applicability.** WCAG2ICT (a W3C *Note*, informative) explains how WCAG applies to non-web documents and software and says it does not cover web technologies; Agastya is delivered as a **web application inside a browser**, so WCAG 2.2 applies **directly** (the `non-web` reinterpretation is not needed). `[S26, read]`
* **Regulatory pointer.** EN 301 549 v4.1.1 points its web, document and software clauses to WCAG 2.2 AA, but until the European Commission cites v4.1.1 the legally presumed baseline remains v3.2.1 (WCAG 2.1) `[S26 secondary]`. For a defence customer outside the EU/US public-procurement scope the requirement is usually contractual; **NOT VERIFIED** for the owner's customers.
* **Testing practice.** Playwright documents `@axe-core/playwright` scans (violations asserted empty) and states that many issues need **manual** testing and users with disabilities `[S27, read]`. `[REC]` Gate: zero serious/critical axe violations on the main routes plus a manual keyboard-only run of the five core tasks; the frameworkless editors (S1000D Studio, JSS, JSG) need their own manual pass because custom widgets are where automated scans are weakest.

## 7. Database: SQLite vs PostgreSQL for this product

| Criterion | SQLite (current, `node:sqlite`) | PostgreSQL |
|---|---|---|
| Fit statement (sqlite.org) | "For device-local storage with low writer concurrency and less than a terabyte of content, SQLite is almost always a better solution"; client/server wins for many network clients, write-intensive or multi-server sites, very large data `[S29, read]` | Server-class concurrency, roles, PITR |
| Writers | One writer at a time, writers queue; transactions normally milliseconds `[S29]` | MVCC multi-writer |
| Network access | WAL needs all processes on the **same host**, no network filesystem; file locking over network shares is "buggy in many implementations" and can corrupt `[S29 WAL, read]` | Network native |
| Backup | Never copy `.db` alone in WAL mode; use backup API/`.backup` or checkpoint + copy `.db`, `-wal`, `-shm` together `[S29 WAL, read]` | pg_basebackup + WAL archive gives **point-in-time recovery**; base backup need not be consistent; more admin effort `[S31, read]` |
| Packaging in this product | Zero extra service; file lives in the workspace; Node-built-in | Extra Windows service, installer, upgrades, credentials, backups to own |
| Runtime maturity | `node:sqlite` is **Stability 1.1 (active development)** in Node 22 and **1.2 (release candidate)** from Node 24.15.0 `[S30, read]` | Mature |
| Node 22 support window | ends **2027-04-30**; Node 24 LTS maintenance until 2028-04-30 `[S30, read]` | n/a |

**Verdict `[REC]`.** The product's server is one process on one host, workloads are short writes, and the file tree (not the DB) holds the content, so **SQLite remains the right engine** for the single-machine and small-team server. The engine switch criteria should be written down: more than one server process/host, or sustained concurrent writers causing `SQLITE_BUSY` (the code opens the DB with the default `timeout` of 0: Node docs `[S30]`, `vendor/engine/db.js:20`), or a customer requirement for point-in-time recovery. The real risk is not SQLite itself but the **bundled runtime**: Node v22.23.2 ships in the installer (`release/.../runtime/node.exe --version` = v22.23.2, VERIFIED) and the experimental module warning appears in every test run. Moving the bundled runtime to Node 24 LTS (SQLite release candidate, support to 2028-04-30) is the cheaper, nearer fix than a PostgreSQL migration (`ENT-008`). A PostgreSQL port would be work: ~51 `dbh()` call sites plus direct `store.db.prepare` use in five service files bypass the `AuthStore` class (`grep` result), so SQL is not yet behind one interface.

## 8. Collaborative editing of structured XML: locking vs OT/CRDT

* **Competitor practice.** PLM-class S1000D tooling uses **check-out/check-in** of data modules (Windchill + Arbortext; check-out prompt on edit, check-in to save, BREX validation at check-in) `[S02]`. Oxygen Web Author uses **real-time shared editing** over WebSockets with a session owner who alone can save and a documented incompatibility with multi-server load balancing `[S05]`.
* **CRDT/OT facts available.** Yjs is a network-agnostic CRDT library with shared types (Map, Array, etc.), no central authority, editor bindings (ProseMirror, CodeMirror, ...) and persistence providers `[S32, read]`. OT needs a central serialising server; CRDTs converge without transformation, support offline editing, but accumulate tombstones and are more complex `[S32, snippet]`. XML-specific CRDT/OT papers exist (trees, attributes, undo) `[S32, snippet]`.
* **Gap.** No source found says a CRDT or OT merge of **concurrent structural XML edits preserves validity against an XSD/BREX**; one general warning notes JSON CRDTs can merge into states an application considers invalid `[S32, snippet]`. I therefore do not claim either approach is safe for schema-constrained data.
* **Why check-out + optimistic hash guard fits an S1000D data module (my reasoning from the product's nature, `[REC]`).** (1) A data module is one XML document validated as a whole against an XSD plus BREX business rules at save and at publication gate; a merge result that is not valid is a correctness failure, not a display glitch. (2) Authors work on distinct data modules (S1000D partitions content into modules by design), so contention on the *same* module is rare and a whole-module lock loses little. (3) Release approval is bound to a SHA-256 fingerprint of the exact files (`release.ts:36-51`); whole-file saves keep that audit trail exact, whereas a merged stream makes "who changed what" harder to attribute. (4) The server already does whole-file writes with optional `baseHash` (`csdb.ts:200-203`) and an owner-only lock (`project-content.ts:105-119`). Gaps to close are small (make the hash mandatory, per-user check-out with expiry) - see `ENT-016` / `RES-001`. Real-time co-editing of one data module is `[OPT]`/future and, if ever built, should be scoped to *free-text* leaf elements, not tree structure.

## 9. Backup, DR, observability, release engineering for on-prem/air-gapped products

### 9.1 Backup and DR `[STD]/[PRAC]`
* NIST CP-9: back up user-level data, system-level state (applications, licences), and documentation; keep backups confidential and intact (hashes/signatures help); CP-9(1): **periodically test** backups for reliability and integrity `[S21, read]`.
* CISA lists the **3-2-1** rule (three copies, two media types, one off-site) among core backup steps; restore testing is recommended `[S40, snippet]`. The exact CISA wording and any NIST endorsement of 3-2-1 were not confirmed.
* SQLite: use the backup API/`VACUUM INTO`, or checkpoint and copy `.db` + `-wal` + `-shm` together `[S29 WAL, read]`; `node:sqlite` exposes `backup()` since v22.16.0 `[S30, read]`.
* `[REC]` For Agastya the defendable target is **RPO = time since last scheduled backup** (default daily), **RTO measured, not promised** (to be set after the first restore drill, see `12`, gate G-REL-1).

### 9.2 Observability for an on-prem product `[PRAC]`
* Liveness vs readiness: liveness should not depend on external dependencies; readiness may check them; keep probes cheap `[S38]` (Kubernetes semantics used as a reference for the pattern, not because Agastya uses Kubernetes).
* Support bundles are a common practice for on-prem products (Harness, Cloudera, Anaconda, ClickHouse private); the consistent pattern is **default redaction + custom rules + review + tests that secrets are excluded** `[S39, search]`.
* `[REC]` A single `AgastyaCtl --support-bundle` producing a ZIP of redacted logs, `agastya.ini`, `--doctor` output, version/migration level, free disk and service state - **excluding** the database and workspace - lets a vendor support an air-gapped site by e-mail/USB. See `RES-006`.

### 9.3 Release engineering for air-gapped customers `[PRAC]`
* CA/B Forum code-signing baseline requires keys in hardware modules from June 2023 and applies to **publicly trusted** certificates only; a private PKI is out of its scope `[S37, snippet]`. An internal CA plus Group Policy/Intune trust distribution is the practical route (the repository already documents it: `docs/SIGNING.md:13-18, 41`).
* A signature without a timestamp stops verifying when the certificate expires; RFC 3161 timestamping needs a TSA reachable on the customer network (documented in `docs/SIGNING.md:63-65`).
* SBOM practice for offline delivery: CycloneDX SBOM + a **key-based** (not keyless) detached signature, verifiable with only a public key `[S41, secondary snippet]`; I found no source tying this to NIST SSDF (SP 800-218) and do not assert the mapping.
* **Product evidence (VERIFIED, `Get-AuthenticodeSignature`, 2026-11-26):** `Agastya-Platform-2.0.0-win-x64-Setup.exe`, `AgastyaCtl.exe` and `AgastyaPlatform.exe` in `release/` are **NotSigned**; `Setup.exe` SHA-256 equals `SHA256SUMS.txt` (`959ebb23...5dee77`). Release dated 2026-11-22, i.e. before the 2026-11-23..26 merges recorded in project memory (stale relative to `main`).

### 9.4 HTTP hardening for a locally-served web app `[PRAC]`
OWASP recommends `Content-Security-Policy` (no inline script), `X-Content-Type-Options: nosniff`, `frame-ancestors`/`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, COOP/CORP; HSTS only after careful review `[S28, read]`. Agastya sets CSP/nosniff only on two package-preview routes (`backend/src/routes/packages.ts:195-196, 212`) - see `ENT-012`.

## 10. Technology comparison tables

### 10.1 Identity options for an isolated network
| Option | Works with no internet | Effort in this stack | Pros | Cons | Recommendation |
|---|---|---|---|---|---|
| Local accounts (today) | yes | done | no dependency | manual joiner/leaver; temp-password window; no central policy | keep as break-glass |
| LDAPS bind + group-to-role mapping | yes (needs DC reachable) | M | central password/lockout/disable; uses customer's CA; pure JS client possible | must handle channel binding, referrals, nested groups; DC outage = no login (cache policy) | **first step** (`RES-003`) |
| Windows-integrated (Negotiate/NTLM via SSPI) | yes (domain) | M-L | no password for domain users | Windows-only native addon; service needs domain identity + SPN; browser must trust the site (intranet zone); NTLM fallback is weak | optional second step |
| On-prem OIDC/SAML IdP (AD FS, Keycloak) | yes | L | standard; MFA at IdP | extra component for customer; library choice; no primary source read | `[OPT]` |
| TOTP MFA (RFC 6238) | yes | M | offline-friendly second factor | enrolment and recovery UX | `[OPT]` |

### 10.2 Concurrency models for data modules
| Model | Keeps XML valid | Fits S1000D DM granularity | Complexity | Offline | Verdict |
|---|---|---|---|---|---|
| Optimistic hash guard (mandatory) | yes - whole-file write | yes | low | n/a | **adopt** (already partly there) |
| Per-user check-out with lease + admin break | yes | yes | low-medium | n/a | **adopt** |
| Real-time shared editing (Oxygen-style) | needs server-side validity guard | partially | high; WebSocket server; single-node constraint (Oxygen) | n/a | `[OPT]` |
| CRDT (Yjs) over XML tree | **unproven** (no source) | poor for tree-constrained data | high; tombstone growth | good | not recommended |

### 10.3 Installer/distribution formats
| Format | GPO | SCCM | Intune | Silent | Notes |
|---|---|---|---|---|---|
| Inno Setup EXE (today) | script only | yes + custom detection | yes (`.intunewin`) | yes | complete switch set today |
| MSI (WiX) | **native** | yes (ProductCode detection) | yes | yes | extra build tooling; needed only for GPO sites |
| MSIX | no | yes | yes | yes | needs signing trust chain and Windows 10+; not evaluated further |
| Portable ZIP | no | file copy | file copy | n/a | exists; no service registration |

### 10.4 Service accounts
| Account | Network identity | Fit |
|---|---|---|
| LocalService (today) | none (anonymous on network) | good for stand-alone server; cannot reach network shares |
| `NT SERVICE\<name>` virtual account | machine account on network | good: lets ACL be limited to one identity |
| NetworkService | machine account | similar to virtual account, shared by other services |
| gMSA | domain identity, auto password | only if the service must authenticate to domain resources (LDAP/Kerberos) |
| LocalSystem | full | avoid |

## 11. Full source list

`read` = page content retrieved and read for the point used; `snippet` = search-result summary only; `secondary` = not the issuing body.

| ID | Title | URL | What was taken | Mode |
|---|---|---|---|---|
| S01 | PTC Windchill Help Center - Client Installation (S1000D module) | https://support.ptc.com/help/windchill/whc/whc_en/Windchill_Help_Center/WCInstall_s1000d_installation_client_manual.html | S1000D module adds features to Arbortext Editor and enables S1000D in Publishing Engine; needs Windchill server connection, Tomcat, JVM memory | snippet |
| S02 | PTC Windchill - s1000d solution editor check-in/out | https://support.ptc.com/help/wnc/r11.1.2.0/en/Windchill_Help_Center/s1000d_solution_editor_checkin_out.html | Edit starts with check-out prompt; check-in saves/closes; BREX validated at check-in | snippet |
| S03 | PTC article CS169100 | https://www.ptc.com/en/support/article/CS169100 | Version matrix: Publishing Engine 5.4-8.3, Windchill PDMLink 9.1-13.1 | snippet |
| S04 | What's New With Arbortext for S1000D (2011, historical) | https://support.ptc.com/products/arbortext/s1000d/whats-new.htm | not used except to note it is dated | snippet |
| S05 | Oxygen Web Author - Concurrent Editing (28.1) | https://www.oxygenxml.com/doc/versions/28.1.0/ug-webauthor/topics/webauthor-concurrent-editing.html | Real-time shared editing, WebSockets, session owner saves, no multi-server load balancing, XML-source mode makes doc read-only | read |
| S06 | Oxygen blog - S1000D 4.x built-in support | https://blog.oxygenxml.com/topics/s1000d_4_x_built_in_support.html | Framework for issues 4.0/4.1/4.2, DM/PM templates, XSD-guided editing, BREX->Schematron; no CSDB/publishing described | read |
| S07 | Oxygen XML Web Author On-Premise | https://www.oxygenxml.com/xml_web_author/on_premise.html | Production use is on-premise; online demo for evaluation only | snippet |
| S08 | Oxygen Web Author - confidential data handling | https://www.oxygenxml.com/doc/versions/24.0.0/ug-waCustom/topics/wa-confidential-data-handling.html | Distributed only on-premise; files held in server memory | snippet |
| S09 | Oxygen - floating licence server docs | https://www.oxygenxml.com/doc/versions/27.1/ug-license-server/topics/release-floating-license.html | HTTP licence server, manual activation for offline servers, release on disconnect / 2 h idle | snippet |
| S10 | RWS Contenta S1000D / Tridion Docs / Contenta Cloud S1000D | https://www.rws.com/s1000D ; https://www.rws.com/tridion-docs ; https://www.rws.com/about/news/2024/rws-launches-contenta-cloud-s1000d | Contenta deploys public/private cloud or on-prem; Tridion Docs is DITA-based, on-prem or cloud; RWS cloud ISO 27001/SOC 2 | snippet (page fetch empty) |
| S11 | Hensoldt QuILS - S1000D authoring and viewing | https://www.hensoldt.net/products/quils-s1000d-authoring-and-viewing-solutions | S1000D <= 6.0; CSDB + Author client; rights/roles; DMRL/IPRF/DDN processes; BREX; HTML Publisher IETP-X | read |
| S12 | Contiem notusCSDB | https://contiem.com/software/notuscsdb/ | Commercial CSDB; integrates with Eclipse-based authoring | snippet |
| S13 | kibook/s1kd-tools | https://github.com/kibook/s1kd-tools | GPL-3.0, issue 7 primary with 6/5.0/4.x compatibility, no SGML, usable beside Git/SVN | read |
| S14 | Adobe FrameMaker 10 and S1000D; Adobe Community thread | https://help.adobe.com/en_US/framemaker/s1000d/WS9ad62b8fb4f8a997-1d8392ca12e0a8ffdb9-7fff.html ; https://community.adobe.com/t5/framemaker-discussions/framemaker-and-1000d-is-this-facility-still-usable/td-p/15245469 | Built-in support = FM10/issue 4.0; practitioners recommend Mekon/Contiem plug-in | snippet |
| S15 | Quanos SCHEMA ST4 | https://quanos.com/en/products/schema-st4 | Cloud CCMS, ISO 27001; no S1000D evidence | snippet |
| S16 | Astoria vs Author-it (aggregator) | https://www.sourceforge.net/software/compare/Astoria-vs-Author-it/ | Astoria On-Demand/On-Premise; Author-it cloud | secondary snippet |
| S17 | DITA Open Toolkit docs | https://www.dita-ot.org/dev/index.html ; https://dita-ot.org/faq | Ant/XSLT pipeline, plug-ins, `dita` CLI, JSON logging, multi-deliverable projects | snippet |
| S18 | Boeing Spectrum S1000D brochure | https://services.boeing.com/bgsmedias/sys_master/pdf/hca/h5d/9062241009694/boeing-spectrum-s1000d-publishing-software-brochure/boeing-spectrum-s1000d-publishing-software-brochure.pdf | Browser-based editor + Arbortext plug-in | snippet |
| S19 | PTC white paper - Future of S1000D authoring | https://community.ptc.com/sejnu66972/attachments/sejnu66972/Arbortext/13380/1/3340_S1000D_WP_FutureOfAuthoring_GB.pdf | A complete solution = authoring + CSDB + publishing + IETP viewer | snippet |
| S20 | S-Series about S1000D; S1000D implementation guide | https://s-series.org/s1000d/about-s1000d ; https://instrktiv.com/en/s1000d/ | CSDB functionality not defined by the spec; status carries classification, restrictions, reason for update | snippet / secondary |
| S21 | NIST SP 800-53 Rev 5 + control pages (AU-2, AU-5, AU-9, AU-11, AC-5, AC-7, AC-12, SC-8, SC-28, CP-9) | https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final ; https://csf.tools/reference/nist-sp-800-53/r5/au/au-9/ (and sibling control pages) | Control statements as paraphrased in section 5.2 | read (reproduction site) |
| S22 | NIST SP 800-63B-4 | https://pages.nist.gov/800-63-4/sp800-63b.html | Password length, no composition/rotation, blocklist, 100-attempt cap, AAL session timeouts | read (first 100 k of 289 k chars) |
| S23 | NIST SP 800-171 Rev 3 | https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-171r3.pdf | 14->17 families; CMMC revision status conflicting | snippet |
| S24 | ISO 27001:2022 Annex A 8.15 / 8.5 (isms.online) | https://www.isms.online/iso-27001/annex-a-2022/8-15-logging/ ; https://www.isms.online/iso-27001/annex-a-2022/8-5-secure-authentication-2022/ | Logging and secure-authentication control intent | secondary snippet |
| S25 | IEC 62443-4-2 overview (INCIBE) | https://www.incibe.es/en/incibe-cert/blog/iec-62443-4-2-need-secure-components | Component classes; SL-T; contractual use | secondary snippet |
| S26 | WCAG2ICT (W3C Note); WCAG 2.2 what's new; EN 301 549 v4.1.1 notes | https://www.w3.org/TR/wcag2ict-22/ ; https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ ; https://nda.ie/news/en301549-published ; https://www.browserstack.com/blog/what-en-301-549-v4-1-1-means-for-your-accessibility-strategy/ | New SC list; applicability to software; EN 301 549 v4.1.1 -> WCAG 2.2 AA; v3.2.1 still the presumed legal baseline | read (W3C) / secondary (EN) |
| S27 | Playwright - Accessibility testing | https://playwright.dev/docs/accessibility-testing | axe scans; manual testing still required | read |
| S28 | OWASP Session Management and HTTP Headers cheat sheets | https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html ; https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html | Timeout ranges; cookie flags; header set | read |
| S29 | SQLite: Appropriate Uses; Write-Ahead Logging | https://www.sqlite.org/whentouse.html ; https://www.sqlite.org/wal.html | Concurrency, network FS, size limits; WAL same-host rule, copying rules | read |
| S30 | Node.js docs node:sqlite (v22, v24); Node release schedule | https://nodejs.org/docs/latest-v22.x/api/sqlite.html ; https://nodejs.org/docs/latest-v24.x/api/sqlite.html ; https://raw.githubusercontent.com/nodejs/Release/main/schedule.json | Stability 1.1 (22) / 1.2 RC (24.15.0); timeout default 0; backup() since 22.16; EOL dates | read |
| S31 | PostgreSQL docs - Continuous Archiving and PITR | https://www.postgresql.org/docs/current/continuous-archiving.html | Base backup + WAL archive -> PITR | read |
| S32 | Yjs docs; Real Differences between OT and CRDT; XML collaborative editing | https://docs.yjs.dev/ ; https://arxiv.org/pdf/1905.01518 ; https://arxiv.org/pdf/1010.3615 | CRDT properties; OT vs CRDT trade-offs; XML-specific work exists; nothing on schema validity | read (Yjs) / snippet |
| S33 | Microsoft Learn: Service User Accounts; gMSA overview; Intune Win32 app management; LDAP signing/channel binding KB; GPO/SCCM training modules; Windows Event Forwarding | https://learn.microsoft.com/en-us/windows/win32/services/service-user-accounts ; https://learn.microsoft.com/en-us/windows-server/security/group-managed-service-accounts/group-managed-service-accounts-overview ; https://learn.microsoft.com/en-us/mem/intune/apps/apps-win32-app-management ; https://support.microsoft.com/en-us/topic/2020-ldap-channel-binding-and-ldap-signing-requirements-for-windows-ef185fb8-00f7-167d-744c-f299a66fc00a ; https://learn.microsoft.com/en-us/training/modules/deploy-applications/6-deploy-applications-group-policy ; https://learn.microsoft.com/en-us/windows/win32/wec/setting-up-a-source-initiated-subscription | Service accounts; gMSA; Intune packaging/silent; LDAP signing and channel binding; GPO = MSI only; WEF | read (first four) / snippet (GPO, WEF) |
| S34 | Keygen - Offline licenses | https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/ | Signed licence files/keys, Ed25519/RSA, immutable embedded data, no clock-rollback guidance | read |
| S35 | node-expose-sspi; node-krb5 | https://www.npmjs.com/package/node-expose-sspi ; https://github.com/adaltas/node-krb5 | Windows SSPI middleware (NTLM/Kerberos, SPN, domain); native Kerberos binding | snippet |
| S36 | Schneier and Kelsey - Secure Audit Logs to Support Computer Forensics | https://www.schneier.com/academic/archives/1999/05/secure_audit_logs_to.html | Hash-chain + key evolution; limitations | snippet |
| S37 | CA/Browser Forum Code Signing Baseline Requirements | https://cabforum.org/working-groups/code-signing/requirements/ | Hardware key requirement (2023), public-trust scope only | snippet |
| S38 | Kubernetes - liveness, readiness and startup probes | https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/ | Probe semantics used as a pattern reference | read |
| S39 | Support-bundle practice: Harness, Cloudera, Anaconda | https://developer.harness.io/self-managed-enterprise-edition/troubleshooting-and-resources/support-bundle-utility ; https://docs.cloudera.com/cloudera-manager/7.0.3/monitoring-and-diagnostics/topics/cm-redaction-of-sensitive-information-diagnostic-bundles.html ; https://anaconda.com/docs/anaconda-platform/self-hosted/latest/admin/advanced/support-bundle | Default redaction, custom rules, review, tests | snippet |
| S40 | CISA - Back Up Your Business Data | https://www.cisa.gov/back-business-data | 3-2-1 rule; restore testing | snippet |
| S41 | TRUSCA SBOM signature verification (cosign key-based); CycloneDX guide | https://trustedoss.github.io/trusca/docs/reference/sbom-signature-verification ; https://cyclonedx.org/guides/sbom | Key-based signing for air-gapped; SBOM + public key bundle | secondary snippet |

## 12. Unknowns and limitations

* **No competitor product was run.** All capability statements are vendor claims. Feature parity conclusions are therefore *directional*, not measured.
* **RWS Contenta**, **Inmedius/Aptly**, **Astoria S1000D support**: not verifiable from retrievable pages.
* **S1000D specification text** (Chapters on CSDB/data management) could not be retrieved; no S1000D-mandated access-control or audit rule is asserted.
* **NIST 800-53 text** was read from a reproduction site; **ISO 27001 and IEC 62443** only from secondary summaries; confirm against the originals before quoting in a compliance document.
* **WCAG applicability to the owner's customers** (contract vs regulation) is unknown.
* **Node 24 `node:sqlite` RC** applies "as of v24.15.0" per the Node docs; I did not test the product on Node 24.
* **Performance and scale** claims in this file are limited to cited documentation; measured baselines belong to `04-PERFORMANCE-AUDIT`. The repository's own timings (`docs/S1000D_COMPLIANCE_MATRIX.md:96-113`) were taken "on Node 26.13" while the shipped runtime is v22.23.2, so they are **NOT VERIFIED** for the shipped build.
* The web-fetch tool summarises pages with a small model; one fetch (Microsoft Intune) returned the page front-matter verbatim. I used only statements that matched the page text.

# Bundled components: versions, support and patch cadence

Written 2026-11-27 for audit WP-13 (ENT-008, DEP-005, DEP-018, ARC-009). The installer carries its own runtimes so that an air-gapped site
needs nothing else; that also means nobody else patches them. This page is the record of what ships, until when it is supported, and how a
fix reaches an installed site. The advisory facts are those of the audit (`docs/audit/09-DEPLOYMENT-ARCHITECTURE.md`, DEP-005, sources S4,
S14, S15); re-check them at each patch window.

## 1. What ships

| Component | Version | Where it is pinned / found | Upstream support | Status 2026-11-27 |
|---|---|---|---|---|
| Node.js (64-bit, Windows) | **24.22.3** (LTS line 24) | `packaging/product.json` `runtime.node` (+ SHA-256 of the official zip); `scripts/package-windows.mjs` refuses another major, an older build, or one with fewer than `minSupportMonths` (12) months of support left | end of life **2028-04-30** | supported. Zip downloaded and its SHA-256 checked against the pin (`e612af99...7d9f`); the installer has **not** been rebuilt with it yet (release work) |
| Eclipse Temurin JRE | **21.0.13.1+2** (LTS 21) | `backend/vendor/tools/jre` (`release` file) | Temurin 21 is maintained into 2029 or later | current |
| Apache FOP | **2.10** | `backend/vendor/tools/fop-2.10` | FOP 2.12 released 2026-10-20 | **inside advisory ranges**: two FOP advisories list "through 2.11.0" (temporary files readable by other local users; unsafe deserialisation when hyphenation patterns are loaded). Neither is reachable by a remote user of this product (FOP runs locally on content the server generated, the hyphenation files are the bundled ones), but they are open |
| Apache Batik | **1.18** | `fop-2.10/fop/lib/batik-*-1.18.jar` | Batik 1.20 | **inside advisory ranges**: SSRF/XXE/DoS fixes "through 1.19.0". SVG reaches Batik from author uploads, so this is the more relevant of the two |
| libxslt / libxml2 / libexslt | **1.1.28 / 2.9.3 / 0.8.17**, 32-bit (`win32-x86`) | `backend/vendor/tools/libxslt-1.1.28-win32-x86` (`xsltproc --version`: libxml 20903, libxslt 10128, libexslt 817) | upstream no longer maintains these lines; no current win32 build is published | **unpatched, 2013 era** (ARC-009) |

`node:sqlite` on Node 24: `backend/test/wp13-sqlite-contract.test.js` checks the behaviour the code relies on (the pragmas the server sets incl. WAL,
prepared statements (`changes`, `lastInsertRowid`, plain rows), foreign keys with cascade, commit and rollback, large BLOB round trip,
`VACUUM INTO` as the online backup, a second connection under WAL waiting for the write lock). It passes on Node 24.22.3 and on Node 22.23.2 (2026-11-27). `node:sqlite` stays behind the storage seam (WP-10),
so a change of driver stays local.

## 2. Decision: Node 22 -> Node 24 LTS (D1)

Node 22 leaves security support on 2027-04-30, less than the 12 months a release must have left (gate G-SEC-11b). The product moves to the
Node 24 LTS line, pinned to an exact build in `packaging/product.json`. Development checkouts may still run Node 22.13 or later
(`backend/package.json` engines `^24.11.0 || ^22.13.0`); the shipped runtime is 24. Still to do (not done in WP-13): rebuild the installer
with `--node` pointing at the pinned build, run the full backend suite, the e2e suite and the gate on it, and re-take the performance
baseline (B1-B13) on Node 24 on the reference machine.

## 3. Patch cadence

* **Quarterly window** (January, April, July, October; first two weeks): for each row above, look up the newest patch of the pinned line
  and the vendor advisories. Record the outcome in the release notes, also when nothing changes.
* **Node**: take the newest patch of the LTS line every window (update `runtime.node`, `nodeZipSha256`, `nodeSource`); move to the next LTS
  line when fewer than 12 months of support would be left at the next window. `node scripts/ci/readiness.mjs` (G-SEC-11b) fails when that
  happens.
* **JRE**: take the Temurin 21 quarterly update (published in Jan/Apr/Jul/Oct, aligned with the window).
* **FOP / Batik**: upgrade only behind the golden-PDF and PDF-regression gate (WP-08, WP-33, WP-15): FOP 2.12 and Batik 1.20 are the next
  step; the upgrade must give byte-identical or reviewed output on the golden set.
* **libxslt / libxml2**: no patch exists for the 32-bit 1.1.28 line. Recorded decision: keep it until one of the two replacements is proven
  equivalent on the golden set - (a) an in-house 64-bit build of a current libxslt 1.1.4x / libxml2 2.1x, or (b) XSLT in the JVM (JDK XSLTC or
  Saxon-HE); the stylesheets use EXSLT, so equivalence must be shown by tests first. Until then the input to xsltproc is only XML the server
  has parsed and guarded (WP-02 XML guard), which limits exposure.
* **Out-of-band**: an advisory that is reachable from an author's upload or over the network is patched in the next Offline Update, not at the
  next window.
* **Every release**: an SBOM (WP-24: `scripts/release/sbom.mjs`, CycloneDX 1.5, written by the packager from the shipped bytes into
  `release/Agastya-Platform-<v>-win-x64-SBOM.cdx.json` and into the product as `SBOM.cdx.json`; the components npm does not describe come from
  `packaging/bundled-components.json`, which must change with this table) and the versions above in `release/BUILD-INFO.json`; `GET /api/version` reports the product version,
  API level and database schema level of the running server.

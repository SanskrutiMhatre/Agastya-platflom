# Bundled default BREX data modules

The official S1000D default business rules, one per issue the platform supports. They are byte-for-byte the copies the Studio bundles
(`frontend/public/brex/`), so the browser and the server judge a module by the same rules.

| File | Issue | Rules (structureObjectRule) |
|---|---|---|
| `DMC-S1000D-F-04-10-0301-00A-022A-D_001-00_EN-US.XML` | 4.2 | 260 |
| `DMC-S1000D-G-04-10-0301-00A-022A-D_001-00_EN-US.XML` | 5.0 | 264 |
| `DMC-S1000D-H-04-10-0301-00A-022A-D_001-00_EN-US.XML` | 6 | 269 |
| `DMC-S1000D-J-04-10-0301-00A-022A-D_001-00_EN-US.XML` | 7 | 274 |

`S1000D-default-4.2.xml` is the older copy of the 4.2 rules the server used before per-issue defaults; it is no longer read.

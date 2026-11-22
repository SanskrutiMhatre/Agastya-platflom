# Optional templates (not seeded)

Everything under `templates/` is copied into a new workspace on first start. What is here is **not**: it is third-party
material that must be installed on purpose, by someone who may use it.

## `brand/lnt-xignal`

The logo and company line of the Xignal S1000D reference publication RDR-1671Y-00039-00 (L&T), extracted from that PDF.
It is used by the golden-master test and by the L&T project; it is not part of the product's default seed because the
right to redistribute another organisation's logo is not established.

Install it into a workspace by copying the folder:

    <workspace>/templates/brand/lnt-xignal/   <-  templates-optional/brand/lnt-xignal/

then choose it in the project's Settings (Brand pack) or set `"brandPack": "lnt-xignal"` in `project.json`.
The shipped Xignal house template uses the `neutral` pack, which prints no logo and no company line, so a build
never carries a mark nobody chose.

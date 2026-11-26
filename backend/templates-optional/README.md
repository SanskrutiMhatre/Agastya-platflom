# Optional templates (not seeded)

Everything under `templates/` is copied into a new workspace on first start. Anything placed here is **not**: it is
material that must be installed on purpose.

There is nothing here at the moment. The L&T / Xignal brand pack (`lnt-xignal`: the logo and the company line
"L&T Precision Engineering and Systems") used to live here; on 2026-11-26 the owner asked for those logos to be the
default of every S1000D project, so it moved to `templates/brand/lnt-xignal/` and the shipped `xignal-s1000d` house
template names it (`"brandPack": "lnt-xignal"`). Another organisation's pack is a folder with a `brand.json` and a logo,
placed in `<workspace>/templates/brand/<id>/` and named in the project's `project.json` (`"brandPack": "<id>"`).

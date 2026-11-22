# vim-s1000d.json.gz

Tag dictionaries (allowed children and attribute values per element) for S1000D 4.2, 5.0, 6 and 7, one per schema.

- **Source:** `github.com/Pratham1910/vim-s1000d-omnicomplete`, `vim/autoload/xml/` (a fork of `kibook/vim-s1000d-omnicomplete`).
  The URL first given for this task (`Pratham1910/xml-validator/.../vim/autoload/xml`) returned 404; this repository has the same path and content type.
- **How it was made:** by the repository's `xsd2omni.xsl` from the official XSDs. The fork ships no LICENSE file; only element/attribute names and values (facts from the public XSDs) are kept here.
- **Use:** an independent cross-check of our compiled grammars. It has NO ordering or occurrence information and omits namespaced (`dc:`, `rdf:`, `xlink:`) elements, so the official XSD stays the authority.
- **Rebuild:** `node scripts/import-vim-dicts.mjs <folder with S1000D_<issue>_<schema>.vim>`.

# infocodes.json

- `dmtypes`: information code -> schema, from the reference `s1kd-newdm/dmtypes.txt` (`github.com/Pratham1910/s1kd-tools`).
- `evidence`: for each schema, which information codes the REAL data modules in this workspace use (counted from the Editor fixtures and samples,
  the Agastya V1 workspace, the JSS Publisher examples and the v2 samples). Used to check the wizard's default info codes rather than trust them.

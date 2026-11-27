'use strict';
// WP-33: compare two FO files produced by xsltproc, allowing only a renaming of generate-id() values.
//
// libxslt 1.1.28 builds generate-id() from the node's memory address ("idm" + a number, or "id" + a number), so two runs of the
// SAME stylesheet on the SAME input already give different ids whenever the allocation pattern differs (a different stylesheet
// size is enough). Each generated id is therefore replaced by a canonical name in order of first appearance in its own file. Two
// files that are equal after that are equal up to a one-to-one renaming of generated ids: every id and every reference to it
// sits in the same place, so every link resolves to the same element. Authored ids are never renamed (the pattern requires the
// generated form, which an S1000D id like "fig-0001" or "ID_EXAMPLE-..." does not have).

const fs = require('fs');

const GEN_ID = /\bid(m?)(\d{5,})\b/g;

function canonical(text) {
  const map = new Map();
  return text.replace(GEN_ID, (m) => {
    if (!map.has(m)) map.set(m, `GID${map.size + 1}`);
    return map.get(m);
  });
}

/** { identical, equivalent, firstDiff } for two FO texts or files. */
function compareFo(a, b) {
  const ta = fs.existsSync(a) ? fs.readFileSync(a, 'utf8') : a;
  const tb = fs.existsSync(b) ? fs.readFileSync(b, 'utf8') : b;
  if (ta === tb) return { identical: true, equivalent: true, firstDiff: null };
  const ca = canonical(ta); const cb = canonical(tb);
  if (ca === cb) return { identical: false, equivalent: true, firstDiff: null };
  let i = 0; while (i < ca.length && ca[i] === cb[i]) i++;
  return { identical: false, equivalent: false, firstDiff: { at: i, a: ca.slice(Math.max(0, i - 200), i + 200), b: cb.slice(Math.max(0, i - 200), i + 200) } };
}

module.exports = { compareFo, canonical };

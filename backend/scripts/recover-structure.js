#!/usr/bin/env node
'use strict';
// =============================================================================
// recover-structure: rebuild the publication structure of a Xignal book from its PDF.
//
//   node scripts/recover-structure.js <book.pdf> <dmDir> <outDir>
//
// Xignal exports the master publication module and every data module, but not the annexure publication
// modules the master points at. The printed book opens with a generated "Table of contents" listing every
// module in order; this reads that list (offline, with the pdfjs-dist the frontend already ships), cuts it at
// the "Annexure 'X' - ..." divider modules and writes one S1000D 4.2 PMC per publication into <outDir>,
// plus recovered-structure.json (what was found, what is unknown, which modules are reused).
//
// The result is marked `reconstructed`: a reading of a printed document, to be checked by a person.
// Nothing is modified in <dmDir>; the PDF is read once and never written. Needs a compiled backend (npm run build).
// =============================================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// A 200+ MB PDF is held in memory while it is read: ask for room unless the caller already did.
if (!process.env.AGASTYA_RECOVER_CHILD && !process.execArgv.some((a) => a.startsWith('--max-old-space-size'))) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=6144', __filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, AGASTYA_RECOVER_CHILD: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

const [pdf, dmDir, outDir] = process.argv.slice(2);
if (!pdf || !dmDir || !outDir) {
  console.error('usage: node scripts/recover-structure.js <book.pdf> <dmDir> <outDir>');
  process.exit(2);
}
if (!fs.existsSync(pdf)) { console.error(`PDF not found: ${pdf}`); process.exit(2); }
if (!fs.existsSync(dmDir) || !fs.statSync(dmDir).isDirectory()) { console.error(`Data module folder not found: ${dmDir}`); process.exit(2); }

const dist = path.join(__dirname, '..', 'dist', 'services', 'importer');
if (!fs.existsSync(path.join(dist, 'index.js'))) { console.error('The backend is not compiled. Run "npm run build" in backend/ first.'); process.exit(2); }
const { recoverStructureFromPdf, inventoryFromEntries, hintsFromEntries } = require(path.join(dist, 'index.js'));

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.xml$/i.test(e.name) && /^(DMC|PMC)-/i.test(e.name)) yield p;
  }
}

(async () => {
  const entries = [...walk(dmDir)].map((p) => ({ name: path.relative(dmDir, p).replace(/\\/g, '/'), bytes: fs.readFileSync(p) }));
  if (!entries.some((e) => /^DMC-/i.test(path.basename(e.name)))) { console.error(`No DMC-*.xml files in ${dmDir}`); process.exit(2); }
  const inventory = inventoryFromEntries(entries);
  console.log(`${inventory.length} data modules read from ${dmDir}`);

  const t0 = Date.now();
  // The folder usually also holds the master publication module: its pmRef entries give the annexures' own titles and issues.
  const hints = hintsFromEntries(entries);
  const result = await recoverStructureFromPdf(pdf, inventory, { hints });
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of result.pmcFiles) fs.writeFileSync(path.join(outDir, f.name), f.xml, 'utf8');
  const { pmcFiles, ...summary } = result;
  fs.writeFileSync(path.join(outDir, 'recovered-structure.json'), JSON.stringify({ ...summary, pmcFiles: pmcFiles.map((f) => ({ name: f.name, role: f.role, pmCode: f.pmCode })) }, null, 2), 'utf8');

  console.log(`table of contents: pages ${result.source.tocPages[0]}-${result.source.tocPages[result.source.tocPages.length - 1]} of ${result.source.pages}; ${result.rows} rows, ${result.distinct} distinct modules (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const p of result.publications) {
    console.log(`  ${p.role === 'master' ? 'master  ' : 'annexure'} ${p.pmCodeKey.padEnd(22)} ${String(p.rows.length).padStart(3)} modules${p.occurrences > 1 ? ` (printed ${p.occurrences}x)` : ''}  ${p.title}`);
  }
  if (result.unknownCodes.length) console.log(`  ${result.unknownCodes.length} listed code(s) match no data module file: ${result.unknownCodes.slice(0, 5).join(', ')}${result.unknownCodes.length > 5 ? ', ...' : ''}`);
  if (result.unusedModules.length) console.log(`  ${result.unusedModules.length} data module(s) are in no publication of the book`);
  console.log(`  ${result.reusedModules.length} module(s) are used in more than one publication`);
  for (const w of result.warnings) console.log(`  note: ${w}`);
  console.log(`wrote ${result.pmcFiles.length} publication modules + recovered-structure.json to ${outDir}`);
  console.log('These are RECONSTRUCTED: read from a printed table of contents. Verify before relying on them.');
})().catch((e) => { console.error(`recover-structure failed: ${e.message}`); if (process.env.AGASTYA_DEBUG) console.error(e.stack); process.exit(1); });

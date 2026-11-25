#!/usr/bin/env node
'use strict';
// Builds the bundled JSG User Handbook sample (backend/samples/jsg-uhb) from the filled Word handbook (manual format/JSG_FORMAT/JSG_UHB_Format.docx):
// the document is imported with the real importer, and its pictures are made smaller (at most 1100 px on a side; opaque PNG photographs become JPEG) so the sample is a
// few megabytes instead of 126. Needs ImageMagick (`magick`). Run after `npm run build`:   node scripts/make-jsg-sample.js [path-to-the.docx]
const fs = require('node:fs'); const path = require('node:path'); const { spawnSync } = require('node:child_process');
const { importDocx } = require('../dist/services/jsg/docx');
const { importIsplDocx } = require('../dist/services/jsg/docx-ispl');

// node scripts/make-jsg-sample.js [uhb|ispl] [path-to-the.docx]
const kind = process.argv[2] === 'ispl' ? 'ispl' : 'uhb';
const given = process.argv.slice(2).find((a) => /\.docx$/i.test(a));
const docx = given || path.resolve(__dirname, '..', '..', 'manual format', 'JSG_FORMAT', kind === 'ispl' ? 'JSG_ISPL_Format.docx' : 'JSG_UHB_Format.docx');
const out = path.resolve(__dirname, '..', 'samples', kind === 'ispl' ? 'jsg-ispl' : 'jsg-uhb');
const importer = kind === 'ispl' ? importIsplDocx : importDocx;
const magick = (args) => spawnSync('magick', args, { encoding: 'utf8' });

(async () => {
  if (!fs.existsSync(docx)) { console.error(`Not found: ${docx}`); process.exit(1); }
  if (magick(['-version']).status !== 0) { console.error('ImageMagick (magick) is required to shrink the pictures.'); process.exit(1); }
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const work = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jsg-sample-'));
  const r = await importer(docx, { projectDir: work });
  let xml = r.xml; let before = 0; let after = 0; const media = path.join(out, 'Media'); fs.mkdirSync(media);
  for (const rel of r.media) {
    const src = path.join(work, rel); const name = path.basename(rel); const size = fs.statSync(src).size; before += size;
    const opaque = /true/i.test(magick([src + '[0]', '-format', '%[opaque]', 'info:']).stdout);
    const isTiff = /\.tiff?$/i.test(name);                                              // uncompressed TIFFs are most of the weight: they become PNG (or JPEG when large)
    const toJpeg = /\.(png|tiff?)$/i.test(name) && size > 200 * 1024;                 // renderings on a transparent background are flattened onto the white page
    const target = toJpeg ? name.replace(/\.(png|tiff?)$/i, '.jpg') : isTiff ? name.replace(/\.tiff?$/i, '.png') : name;
    const args = [src + '[0]', '-resize', kind === 'ispl' ? '1800x1800>' : '1100x1100>', '-strip', ...(toJpeg ? ['-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-quality', '78'] : /\.(png|tiff?)$/i.test(name) ? ['-define', 'png:compression-level=9'] : []), path.join(media, target)];
    const res = magick(args); if (res.status !== 0) { fs.copyFileSync(src, path.join(media, name)); after += size; continue; }
    if (target !== name) xml = xml.split(`Media/${name}"`).join(`Media/${target}"`);
    after += fs.statSync(path.join(media, target)).size;
  }
  fs.writeFileSync(path.join(out, 'jsg-document.xml'), xml);
  fs.writeFileSync(path.join(out, 'README.md'), `# JSG ${kind === 'ispl' ? 'Illustrated Spare Parts List' : 'User Handbook'} sample\n\nThe filled document \`${path.basename(docx)}\` imported by \`scripts/make-jsg-sample.js\` with the Word importer (\`src/services/jsg/${kind === 'ispl' ? 'docx-ispl' : 'docx'}.ts\`), pictures reduced to at most 1100 px.\nIt belongs to the customer who supplied the stencil and is shipped only as a test document. Regenerate it with \`node scripts/make-jsg-sample.js ${kind}\`.\n\n${JSON.stringify(r.report, null, 2)}\n`);
  console.log(`${r.media.length} pictures, ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB; sample written to ${out}`);
  console.log(JSON.stringify({ chapters: r.report.chapters, sections: r.report.sections, clauses: r.report.clauses, tables: r.report.tables, figures: r.report.figures, skipped: r.report.skipped.length }));
  fs.rmSync(work, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });

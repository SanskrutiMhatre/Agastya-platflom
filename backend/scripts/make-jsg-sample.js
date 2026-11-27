#!/usr/bin/env node
'use strict';
// Builds the bundled JSG samples (backend/samples/jsg-uhb and jsg-ispl) from DUMMY DATA: an invented "Demo Equipment DE-100", invented numbers and drawn placeholder pictures.
// Nothing in them comes from a real document. Needs ImageMagick (`magick`) for the pictures.   Run:  node scripts/make-jsg-sample.js
const fs = require('node:fs'); const path = require('node:path'); const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', 'samples');
const EQ = 'Demo Equipment DE-100';
const DUMMY = 'This is dummy text used only to show how the document looks.';
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

function picture(dir, name, label) {
  const args = ['-size', '1000x620', 'xc:white', '-fill', 'none', '-stroke', '#33475b', '-strokewidth', '4',
    '-draw', 'rectangle 20,20 980,600', '-draw', 'roundrectangle 150,210 520,430 24,24', '-draw', 'circle 335,320 335,250', '-draw', 'rectangle 520,285 760,355', '-draw', 'line 760,320 900,320', '-draw', 'line 335,430 335,520', '-draw', 'line 220,520 450,520',
    '-stroke', 'none', '-fill', '#33475b', '-pointsize', '46', '-gravity', 'north', '-annotate', '+0+60', 'DUMMY PICTURE', '-pointsize', '32', '-annotate', '+0+130', label, path.join(dir, name)];
  const r = spawnSync('magick', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ImageMagick failed: ${r.stderr}`);
  return `Media/${name}`;
}

const text = (t) => `<text>${t}</text>`;
const para = (t, a = '') => `<para${a}>${t}</para>`;
const list = (type, items, a = '') => `<list type="${type}"${a}>${items.map((i) => `<item>${text(i)}</item>`).join('')}</list>`;
const table = (title, widths, head, rows) => {
  const row = (c) => `<row>${c.map((x) => `<cell>${x === '' ? '' : text(x)}</cell>`).join('')}</row>`;
  return `<table${title ? ` title="${title}"` : ''} widths="${widths}"><head>${row(head)}</head><body>${rows.map(row).join('')}</body></table>`;
};

function uhb() {
  const dir = path.join(ROOT, 'jsg-uhb'); const media = path.join(dir, 'Media'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(media, { recursive: true });
  let pics = 0; const fig = (title) => { pics += 1; return `<figure title="${title}"><graphic src="${picture(media, `dummy-${pics}.png`, title)}" width="130mm"/></figure>`; };
  const items = (name, lines) => `    <${name}>${lines.map((l) => `<item>${l}</item>`).join('')}</${name}>`;
  const meta = `  <meta>\n    <docNo>DUMMY/UH/001</docNo>\n    <title>USER HANDBOOK</title>\n    <subtitle>(DUMMY DATA)</subtitle>\n    <projectName>DEMO EQUIPMENT DE-100</projectName>\n    <atNo>DUMMY/AT/0001</atNo>\n    <dated>01 Jan 2026</dated>\n    <nsn>00/0000-00-000-0000</nsn>\n    <supplier><line>DUMMY SUPPLIER LIMITED,</line><line>DUMMY CITY 000000</line></supplier>\n    <issuedBy><line>DUMMY ISSUING AUTHORITY</line><line>DUMMY DIRECTORATE</line></issuedBy>\n    <issueDate>JANUARY, 2026</issueDate>\n    <equipmentLife>10 YEARS (DUMMY VALUE)</equipmentLife>\n    <classification>RESTRICTED</classification>\n  </meta>`;
  const front = ['    <certificate>Certified that this document no. {docNo} contains {total} pages which have been serially numbered from (i) to ({frontLast}) as ancillary pages and from 1 to {mainLast} as main content.</certificate>',
    `    <associated intro="${EQ} has the following associated handbooks:">${range(5).map((n) => `<doc title="Dummy associated handbook ${n}" docNo="DUMMY/HB/00${n}" remark="Dummy"/>`).join('')}</associated>`,
    '    <amendments minRows="20"><row no="1" page="3" para="1.1" required="Dummy amendment" authority="Dummy Authority" date="01 Feb 2026" by="Dummy Name"/></amendments>',
    items('warning', ['SWITCH OFF the dummy equipment before any dummy servicing.', 'Keep clear of the dummy equipment while it is moving.', 'Use only dummy spares of the stated dummy part numbers.', 'Wear the protective clothing named in this dummy handbook.']),
    '    <demolition><para>THE DEMOLITION OF THIS DUMMY EQUIPMENT WILL BE CARRIED OUT ONLY ON THE ORDER OF THE DUMMY AUTHORITY.</para></demolition>',
    `    <abbreviations minRows="15">${[['DE', 'Demo Equipment'], ['DCU', 'Dummy Control Unit'], ['DPU', 'Dummy Power Unit'], ['DSU', 'Dummy Sensor Unit'], ['DOC', 'Dummy Operating Cycle'], ['DMP', 'Dummy Maintenance Procedure'], ['DSP', 'Dummy Spare Part']].map(([s, l]) => `<abbr short="${s}" long="${l}"/>`).join('')}</abbreviations>`,
    `    <preface>${[`This handbook describes the ${EQ}. All names, numbers and values in it are dummy data.`, 'It is meant for trying the editor, the ancillary pages and the PDF.', 'Send dummy comments to the dummy issuing authority.'].map((t) => para(t)).join('')}</preface>`,
    items('dos', ['Read this dummy handbook before use.', 'Check the dummy indicators before starting.', 'Record every dummy defect.', 'Keep the dummy equipment clean.']),
    items('donts', ['Do not remove any dummy guard.', 'Do not exceed the dummy rating.', 'Do not store the dummy equipment in the open.']),
    items('important', ['All values in this handbook are dummy values.', 'The pictures are drawn placeholders.']),
    `    <photos>${range(2).map((n) => `<graphic src="${picture(media, `dummy-photo-${n}.png`, `System photo ${n}`)}" width="120mm" label="Dummy view ${n} of the equipment"/>`).join('')}</photos>`].join('\n');
  const section = (title, kids, extra = '') => `    <section title="${title}">${para(`${DUMMY} It belongs to the section on ${title.toLowerCase()} of the ${EQ}.`)}${extra}${kids.map(([t, body]) => `\n      <clause title="${t}">${body}</clause>`).join('')}\n    </section>`;
  const body = (topic, n) => [
    para(`${DUMMY} This paragraph is about ${topic.toLowerCase()}.`) + list('alpha', [`Dummy point one about ${topic.toLowerCase()}.`, `Dummy point two about ${topic.toLowerCase()}.`, `Dummy point three about ${topic.toLowerCase()}.`]),
    para(`Dummy data for ${topic.toLowerCase()} is given in the table below.`) + table(`Dummy data - ${topic} ${n}`, '1 4 3 2', ['Sl. No.', 'Parameter', 'Value', 'Unit'], range(5).map((k) => [String(k), `Dummy parameter ${k}`, String(k * 10), 'units'])),
    para(`${topic} is shown in the figure below.`) + fig(`${topic} (dummy view ${n})`),
    `<note><para>${DUMMY}</para></note><warning><para>Dummy warning: this sentence is sample data only.</para></warning>` + list('step', ['Carry out dummy step one.', 'Carry out dummy step two.', 'Confirm that the dummy indicator is on.']),
  ];
  const chapters = [['GENERAL DESCRIPTION', ['Introduction', 'Technical Data', 'Main Assemblies']], ['PREPARATION FOR USE', ['Unpacking', 'Installation', 'Checks Before Use']], ['OPERATING INSTRUCTIONS', ['Controls and Indicators', 'Starting', 'Stopping']], ['USER MAINTENANCE', ['Daily Servicing', 'Weekly Servicing', 'Fault Finding']], ['STORAGE AND TRANSPORT', ['Short Term Storage', 'Long Term Storage', 'Transport']]];
  const chaptersXml = chapters.map(([title, sections]) => `  <chapter title="${title}">\n${sections.map((s) => section(s, body(s, 1).map((b, i) => [`${['General', 'Dummy Data', 'Illustration', 'Procedure'][i]} - ${s}`, b]))).join('\n')}\n  </chapter>`).join('\n');
  const apps = `  <appendices>\n    <appendix label="A" title="Dummy List of Tools">${table('Dummy tools', '1 5 2 2', ['Sl. No.', 'Tool', 'Part No.', 'Qty'], range(8).map((k) => [String(k), `Dummy tool ${k}`, `DT-00${k}`, '1']))}</appendix>\n    <appendix label="B" title="Dummy List of Spares">${table('Dummy spares', '1 5 2 2', ['Sl. No.', 'Spare', 'Part No.', 'Qty'], range(8).map((k) => [String(k), `Dummy spare ${k}`, `DS-00${k}`, '2']))}</appendix>\n  </appendices>`;
  fs.writeFileSync(path.join(dir, 'jsg-document.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<jsgdoc version="1.0" type="uhb">\n${meta}\n  <front>\n${front}\n  </front>\n${chaptersXml}\n${apps}\n</jsgdoc>\n`);
  return pics + 2;
}

function ispl() {
  const dir = path.join(ROOT, 'jsg-ispl'); const media = path.join(dir, 'Media'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(media, { recursive: true });
  let pics = 0; const pic = (label) => { pics += 1; return picture(media, `dummy-${pics}.png`, label); };
  const letters = ['A', 'B', 'C', 'D'];
  const plates = [{ ref: 'I', title: 'General Assembly', divider: true, set: true, caption: 'GENERAL ASSY OF DEMO EQUIPMENT DE-100' },
    ...letters.map((l) => ({ ref: `I-${l}`, title: `Dummy System ${l}`, set: true })),
    ...letters.flatMap((l) => range(3).map((n) => ({ ref: `I-${l}/${n}`, title: `Dummy Assembly ${l}${n}`, set: false })))];
  const platesXml = plates.map((p, i) => {
    const parts = range(6).map((n) => `        <part item="${String(n).padStart(2, '0')}" plateRef="${p.ref}/${n}" provide="${n % 2 ? 'P' : ''}" nsn="00/0000-00-000-${String(i * 10 + n).padStart(4, '0')}" designation="DUMMY PART ${i + 1}-${n}" qty="${n}"${p.set ? ` qtySet="${n + 1}"` : ''} drg="DUMMY-DRG-${i + 1}${n}" firmPart="DFP-${i + 1}${n}" price="${n * 100}"/>`).join('\n');
    return `    <plate id="p${i + 1}" ref="${p.ref}" title="${p.title}"${p.divider ? ' divider="true"' : ''}${p.set ? ' setColumn="true"' : ''}${p.caption ? ` caption="${p.caption}"` : ''}>\n      <view caption="${p.title.toUpperCase()} (DUMMY VIEW 1)">\n        <graphic src="${pic(`PLATE ${p.ref}`)}"/>\n${parts}\n        <note><b>Note:</b> Above mentioned quantity is for one ${p.title}. Dummy data.</note>\n      </view>\n    </plate>`;
  }).join('\n');
  const preface = ['This Illustrated Spare Parts List (ISPL) is a dummy document made to show how a spare parts list looks.', 'All part numbers, quantities and prices in it are dummy data.', 'When demanding spare parts, following particulars must be quoted:'];
  const front = ['    <certificate>Certified that this document no. <b>{docNo}</b> contains {total} pages which have been serially numbered from (i) to (xiv) as ancillary pages and from 1 to {mainLast} as main content.</certificate>',
    `    <preface>${preface.map((t) => para(t)).join('')}<list type="alpha" indent="3"><item>${text('Dummy catalogue section.')}</item><item>${text('Dummy part number or NSN.')}</item><item>${text('Designation of the dummy equipment.')}</item></list>${para('Queries relating to this dummy ISPL are for the dummy issuing authority.')}</preface>`,
    '    <amendments minRows="20"/>',
    `    <abbreviations>${[['DE', 'Demo Equipment'], ['DSP', 'Dummy Spare Part'], ['DRG', 'Drawing'], ['NSN', 'Dummy Stock Number']].map(([s, l]) => `<abbr short="${s}" long="${l}"/>`).join('')}</abbreviations>`,
    `    <supplied equipment="${EQ}"/>`].join('\n');
  const appTitles = ['LIST OF CARRIED SPARES', 'LIST OF STANDARD ACCESSORIES', 'LIST OF CARRIED TOOL', 'LIST OF SPECIAL MAINTENANCE TOOL', 'RECOMMENDED LIST OF SPARES', 'LIST OF SUPPLIERS FOR PROPRIETARY ITEMS', 'NUMERICAL INDEX OF PARTS'];
  const apps = appTitles.map((t, i) => `    <appendix label="${String.fromCharCode(65 + i)}" title="${t}" orientation="landscape">${para(`Dummy ${t.toLowerCase()} for the ${EQ}.`)}${table('', '1 2 5 1 3', ['Sl. No.', 'Part No.', 'Designation', 'Qty', 'Remark'], range(6).map((k) => [String(k), `DFP-${i + 1}${k}`, `Dummy item ${i + 1}-${k}`, String(k), 'Dummy']))}</appendix>`).join('\n');
  const meta = `  <meta>\n    <docNo>DUMMY/IL/001</docNo>\n    <title>ILLUSTRATED SPARE PARTS LIST (ISPL)</title>\n    <projectName>DEMO EQUIPMENT DE-100</projectName>\n    <atNo>DUMMY/AT/0001</atNo>\n    <dated>01 Jan 2026</dated>\n    <nsn>00/0000-00-000-0000</nsn>\n    <supplier><line>DUMMY SUPPLIER LIMITED,</line><line>DUMMY CITY 000000</line></supplier>\n    <issuedBy><line>DUMMY ISSUING AUTHORITY</line><line>DUMMY DIRECTORATE</line></issuedBy>\n    <issueDate>JANUARY, 2026</issueDate>\n    <equipmentLife>10 YEARS (DUMMY VALUE)</equipmentLife>\n    <qtyUnit>for 1 unit</qtyUnit>\n    <classification>RESTRICTED</classification>\n  </meta>`;
  fs.writeFileSync(path.join(dir, 'jsg-document.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<jsgdoc version="1.0" type="ispl">\n${meta}\n  <front>\n${front}\n  </front>\n  <plates>\n${platesXml}\n  </plates>\n  <appendices>\n${apps}\n  </appendices>\n</jsgdoc>\n`);
  return pics;
}

for (const [name, make] of [['jsg-uhb', uhb], ['jsg-ispl', ispl]]) {
  const n = make();
  fs.writeFileSync(path.join(ROOT, name, 'README.md'), `# JSG sample (dummy data)\n\nAn invented "${EQ}": every name, number, value and picture is dummy data. Regenerate with \`node scripts/make-jsg-sample.js\` (needs ImageMagick).\n`);
  console.log(`${name}: ${n} pictures`);
}

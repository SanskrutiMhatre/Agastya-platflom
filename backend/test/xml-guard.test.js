'use strict';
// WP-02 (audit SEC-001, SEC-011, PLT-018, PUB-002): the write-time XML guard. Every payload below was either reproduced
// by the audit (the decoy comment, xi:include of a local file) or is a known variant of it; each must be refused. The
// legitimate S1000D constructs at the end must keep passing. Pure unit test: no server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { checkXmlSafety, safeArtworkRef } = require('../src/core/auth/xmlGuard');

const XXE = '<!DOCTYPE d [ <!ENTITY x SYSTEM "file:///C:/Windows/win.ini"> ]><d>&x;</d>';
const XI = 'http://www.w3.org/2001/XInclude';
const REFUSED = {
  'classic XXE': XXE,
  'the audit decoy: a comment holding a DOCTYPE before the real one (SEC-001)': `<!-- decoy <!DOCTYPE x> -->${XXE}`,
  'decoy in a processing instruction': `<?pi <!DOCTYPE x> ?>${XXE}`,
  'decoy after the XML declaration': `<?xml version="1.0"?>\n<!-- <!DOCTYPE a [ ]> -->\n${XXE}`,
  'two DOCTYPEs': `<!DOCTYPE a>${XXE}`,
  'a DOCTYPE after the root element starts': `<d/>${XXE}`,
  'XXE with a comment inside the subset hiding a ">"': '<!DOCTYPE d [ <!-- > --> <!ENTITY x SYSTEM "file:///etc/passwd"> ]><d>&x;</d>',
  'XXE whose identifier carries ">"': '<!DOCTYPE d [ <!ENTITY x SYSTEM "file:///a>b"> ]><d>&x;</d>',
  'XXE through a relative path that climbs out': '<!DOCTYPE d [ <!ENTITY x SYSTEM "../../secret.txt"> ]><d>&x;</d>',
  'XXE through a character-referenced scheme': '<!DOCTYPE d [ <!ENTITY x SYSTEM "&#x66;ile:///etc/passwd" NDATA png> ]><d/>',
  'parameter entity to a local file': '<!DOCTYPE d [ <!ENTITY % p SYSTEM "file:///etc/passwd"> %p; ]><d/>',
  'internal parameter entity': '<!DOCTYPE d [ <!ENTITY % p "<!ENTITY x SYSTEM \'file:///etc/passwd\'>"> %p; ]><d/>',
  'undeclared parameter entity reference': '<!DOCTYPE d [ %p; ]><d/>',
  'billion laughs (nested internal entities)': `<!DOCTYPE d [ <!ENTITY a "lol"> <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"> <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"> ]><d>&c;</d>`,
  'nesting through a character reference to "&"': '<!DOCTYPE d [ <!ENTITY a "x"> <!ENTITY b "&#38;a;&#38;a;"> ]><d>&b;</d>',
  'markup inside an internal entity': `<!DOCTYPE d [ <!ENTITY m "&#60;xi:include xmlns:xi='${XI}' href='file:///etc/passwd' parse='text'/>"> ]><d>&m;</d>`,
  'conditional section in the internal subset': '<!DOCTYPE d [ <![INCLUDE[ <!ENTITY x SYSTEM "file:///etc/passwd"> ]]> ]><d/>',
  'DOCTYPE external subset at an absolute path': '<!DOCTYPE d SYSTEM "C:/secrets/x.dtd"><d/>',
  'DOCTYPE external subset on a UNC share': '<!DOCTYPE d SYSTEM "\\\\server\\share\\x.dtd"><d/>',
  'xi:include of a local file (SEC-011)': `<dmodule xmlns:xi="${XI}"><xi:include href="file:///C:/Windows/win.ini" parse="text"/></dmodule>`,
  'xi:include with an absolute path': `<d xmlns:xi="${XI}"><xi:include href="/etc/passwd" parse="text"/></d>`,
  'xi:include climbing out': `<d xmlns:xi="${XI}"><xi:include href="../../other-project/csdb/DMC-X.xml"/></d>`,
  'xi:include with a drive path': `<d xmlns:xi="${XI}"><xi:include href="C:\\Windows\\win.ini" parse="text"/></d>`,
  'xi:include with another prefix': `<d xmlns:q="${XI}"><q:include href="file:///etc/passwd" parse="text"/></d>`,
  'xi:include in the default namespace': `<d><include xmlns="${XI}" href="file:///etc/passwd" parse="text"/></d>`,
  'xi:include with a character-referenced namespace': '<d xmlns:xi="http://www.w3.org/2001/XInclud&#101;"><xi:include href="file:///etc/passwd" parse="text"/></d>',
  'xi:include with a character-referenced href': `<d xmlns:xi="${XI}"><xi:include href="&#102;ile:///etc/passwd" parse="text"/></d>`,
  'xi:include bound through a DTD default attribute': `<!DOCTYPE d [ <!ATTLIST d xmlns:xi CDATA #FIXED "${XI}"> ]><d><xi:include href="file:///etc/passwd" parse="text"/></d>`,
  'the 2003 XInclude namespace': '<d xmlns:xi="http://www.w3.org/2003/XInclude"><xi:include href="file:///etc/passwd"/></d>',
  'xi:include re-based by xml:base': `<d xmlns:xi="${XI}"><xi:include xml:base="file:///C:/" href="Windows/win.ini" parse="text"/></d>`,
  'xml:base to a drive': '<d xml:base="C:/Windows/"><e/></d>',
  'UTF-16 declared': '<?xml version="1.0" encoding="UTF-16"?><d/>',
  'UTF-7 declared': '<?xml version="1.0" encoding="UTF-7"?><d/>',
  'NUL characters (UTF-16 bytes read as UTF-8)': '<\0d\0/\0>\0',
  'an external entity set (.ent) with a parsed external entity': '<!ENTITY secret SYSTEM "file:///C:/Windows/win.ini">',
  'a DTD with a conditional section hiding an XXE': '<!ENTITY % on "INCLUDE"><![%on;[ <!ENTITY secret SYSTEM "file:///etc/passwd"> ]]>',
  'a DTD with a local parameter entity': '<!ENTITY % x SYSTEM "C:/x.ent"> %x;',
};

test('every attack payload is refused', () => {
  for (const [name, xml] of Object.entries(REFUSED)) {
    const r = checkXmlSafety(xml);
    assert.equal(r.ok, false, `${name} must be refused`);
    assert.match(r.error, /^XML refused: /, name);
  }
});

const S1000D = `<?xml version="1.0" encoding="UTF-8"?>
<!-- generated by an authoring tool: <!DOCTYPE inside a comment is just text -->
<!DOCTYPE dmodule [
<!ENTITY % ISOEntities PUBLIC "ISO 8879-1986//ENTITIES ISO Character Entities 20030531//EN//XML" "http://www.s1000d.org/S1000D_4-2/ent/ISOEntities">
%ISOEntities;
<!NOTATION png SYSTEM "png">
<!ENTITY ICN-S1000DBIKE-AAA-D000000-0-U8025-00536-A-04-1 SYSTEM "ICN-S1000DBIKE-AAA-D000000-0-U8025-00536-A-04-1.png" NDATA png>
<!ENTITY company "Smith &amp; Sons &#169; 2026">
]>
<dmodule xmlns:dc="http://www.purl.org/dc/elements/1.1/"><content><description><para>See <![CDATA[<!DOCTYPE> in text]]> &company;</para>
<figure><graphic infoEntityIdent="ICN-S1000DBIKE-AAA-D000000-0-U8025-00536-A-04-1"/></figure></description></content></dmodule>`;

test('legitimate content passes: S1000D prolog with ISO entities, NDATA graphics, notations, plain internal entities, CDATA and comments', () => {
  assert.deepEqual(checkXmlSafety(S1000D), { ok: true });
  assert.deepEqual(checkXmlSafety('<dmodule/>'), { ok: true });
  assert.deepEqual(checkXmlSafety('\uFEFF<?xml version="1.0" encoding="iso-8859-1"?><d/>'), { ok: true });
  assert.deepEqual(checkXmlSafety('<!DOCTYPE dmodule SYSTEM "http://www.s1000d.org/S1000D_4-1/xml_schema_flat/descript.xsd"><dmodule/>'), { ok: true });
  assert.deepEqual(checkXmlSafety(`<d xmlns:xi="${XI}"><xi:include href="parts/chapter-1.xml"/><xi:include href=""/></d>`), { ok: true }, 'a relative include inside the project is allowed');
  assert.deepEqual(checkXmlSafety(`<d><para>The XInclude namespace is ${XI}.</para></d>`), { ok: true }, 'mentioning the address is not binding it');
  assert.deepEqual(checkXmlSafety('<!ENTITY aacute "&#x00E1;"> <!ENTITY % yesorno "(0|1)"> <!ELEMENT x (#PCDATA)>'), { ok: true }, 'an entity set and a DTD with internal parameter entities');
});

test('every XML, DTD and entity file shipped in the repository passes', () => {
  const root = path.resolve(__dirname, '..', '..'); let n = 0; const bad = [];
  const skip = /node_modules|[\\/]vendor[\\/]tools[\\/]|[\\/]\.git[\\/]|[\\/]release[\\/]|[\\/]dist[\\/]|[\\/]workspace[\\/]|test-results|verification-results/;
  const walk = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (skip.test(p)) continue; if (e.isDirectory()) walk(p); else if (/\.(xml|dtd|ent)$/i.test(e.name) && fs.statSync(p).size < 30e6) {
    n++; const r = checkXmlSafety(fs.readFileSync(p, 'utf8')); if (!r.ok && !/[\\/]fixtures[\\/].*(evil|xxe|unsafe)/i.test(p)) bad.push(`${path.relative(root, p)}: ${r.error}`); } } };
  walk(root);
  assert.ok(n > 500, `scanned ${n} files`);
  assert.deepEqual(bad, []);
});

test('artwork references: a relative path inside the project or a data: image; never a URL, a drive, a UNC path or ".." (SEC-003)', () => {
  for (const ok of ['', 'Media/logo.png', 'brand/emblem.svg', 'data:image/png;base64,iVBORw0KGgo=']) assert.equal(safeArtworkRef(ok), true, ok);
  for (const no of ['http://127.0.0.1:4061/pixel.png', 'https://example.com/x.png', 'file:///C:/x.png', 'C:\\x.png', '\\\\server\\share\\x.png', '/abs/x.png', '../other/x.png', 'jar:file:x!/y', 'data:text/html;base64,PGh0bWw+']) assert.equal(safeArtworkRef(no), false, no);
});

'use strict';
// Builders for the importer tests: small, valid S1000D data modules, publication modules and zips.
// Everything is made in memory - the tests never copy a sample module or PDF into the repository.

const zlib = require('zlib');

/** `TST-A-10-20-00-00A-040A-D` -> the dmCode attributes (the canonical DMC string's own layout). */
function codeAttrs(dmc) {
  const [model, sd, sys, subsub, assy, dis, info, loc] = dmc.split('-');
  return {
    modelIdentCode: model, systemDiffCode: sd, systemCode: sys,
    subSystemCode: subsub.slice(0, 1), subSubSystemCode: subsub.slice(1),
    assyCode: assy, disassyCode: dis.slice(0, 2), disassyCodeVariant: dis.slice(2),
    infoCode: info.slice(0, 3), infoCodeVariant: info.slice(3), itemLocationCode: loc,
  };
}
const attrString = (a) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const BREX_BY_ISSUE = { '4-2': 'F', '5-0': 'G', '6': 'H' };

/**
 * A data module. Options: dmc, tech, info, lang ('en-IN'), issue ('4-2'), brex (letter or full DMC), issueNo, inWork,
 * entities [{name, target}], body (inner XML of <content>), enterprise, bodyPm ({modelIdentCode,pmIssuer,pmNumber,pmVolume}).
 */
function dm(o) {
  const attrs = codeAttrs(o.dmc);
  const [lang, country] = (o.lang || 'en-IN').split('-');
  const issue = o.issue || '4-2';
  const brexLetter = o.brex === undefined ? BREX_BY_ISSUE[issue] : o.brex;
  const brexCode = brexLetter && brexLetter.includes('-') ? brexLetter : `S1000D-${brexLetter}-04-10-0301-00A-022A-D`;
  const brexAttrs = codeAttrs(brexCode);
  const ents = (o.entities || []).map((e) => `<!ENTITY ${e.name} SYSTEM "${e.target}" NDATA png>`).join('\n');
  const doctype = ents ? `<!DOCTYPE dmodule [\n<!NOTATION png SYSTEM "png">\n${ents}\n]>\n` : '';
  const ent = o.enterprise || 'TST01';
  const bodyPm = o.bodyPm ? `<para>Publication <pmCode ${attrString(o.bodyPm)}/></para>` : '';
  const brexBlock = brexLetter === null ? '' : `<brexDmRef><dmRef><dmRefIdent><dmCode ${attrString(brexAttrs)}/></dmRefIdent></dmRef></brexDmRef>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
${doctype}<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_${issue}/xml_schema_flat/descript.xsd">
  <identAndStatusSection>
    <dmAddress>
      <dmIdent>
        <dmCode ${attrString(attrs)}/>
        <language languageIsoCode="${lang}" countryIsoCode="${country}"/>
        <issueInfo issueNumber="${o.issueNo || '001'}" inWork="${o.inWork || '00'}"/>
      </dmIdent>
      <dmAddressItems>
        <issueDate year="2026" month="10" day="06"/>
        <dmTitle><techName>${esc(o.tech || 'Technical')}</techName><infoName>${esc(o.info || 'Information')}</infoName></dmTitle>
      </dmAddressItems>
    </dmAddress>
    <dmStatus issueType="new">
      <security securityClassification="01"/>
      <responsiblePartnerCompany enterpriseCode="${ent}"><enterpriseName>Test Co</enterpriseName></responsiblePartnerCompany>
      <originator enterpriseCode="${ent}"><enterpriseName>Test Co</enterpriseName></originator>
      ${brexBlock}
    </dmStatus>
  </identAndStatusSection>
  <content>
    <description>
      <levelledPara><title>${esc(o.tech || 'Technical')}</title><para>Body text.</para>${bodyPm}${o.body || ''}</levelledPara>
    </description>
  </content>
</dmodule>
`;
}

/** The DM file name the importer expects. */
const dmFile = (dmc, issueNo = '001', inWork = '00', lang = 'EN-IN') => `DMC-${dmc}_${issueNo}-${inWork}_${lang}.xml`;

/** A table with `cols` declared and rows of `cells` entries (rows may differ). */
function table(cols, rowCells, { colspecs = null, id = 'tbl-1' } = {}) {
  const specs = colspecs === null ? Array.from({ length: cols }, (_, i) => `<colspec colname="c${i + 1}" colwidth="1*"/>`).join('') : colspecs;
  const rows = rowCells.map((n) => `<row>${Array.from({ length: n }, (_, i) => `<entry>c${i + 1}</entry>`).join('')}</row>`).join('');
  return `<table id="${id}"><title>T</title><tgroup cols="${cols}">${specs}<tbody>${rows}</tbody></tgroup></table>`;
}

/** A publication module. entries: dmc string | {folder, children} | {pmRef:{...pmCode}, title}. */
function pmc(o) {
  const c = o.code || { modelIdentCode: 'TST', pmIssuer: '00001', pmNumber: '00001', pmVolume: '00' };
  const lang = (o.lang || 'en-IN').split('-');
  const entry = (e) => {
    if (typeof e === 'string') return `<pmEntry><dmRef><dmRefIdent><dmCode ${attrString(codeAttrs(e))}/></dmRefIdent></dmRef></pmEntry>`;
    if (e.dm) return `<pmEntry><dmRef><dmRefIdent><dmCode ${attrString(codeAttrs(e.dm))}/>${e.issue ? `<issueInfo issueNumber="${e.issue[0]}" inWork="${e.issue[1]}"/>` : ''}${e.lang ? `<language languageIsoCode="${e.lang[0]}" countryIsoCode="${e.lang[1]}"/>` : ''}</dmRefIdent><dmRefAddressItems><dmTitle><techName>${esc(e.tech || '')}</techName><infoName>${esc(e.info || '')}</infoName></dmTitle></dmRefAddressItems></dmRef></pmEntry>`;
    if (e.pmRef) return `<pmEntry><pmEntryTitle>${esc(e.title || '')}</pmEntryTitle><pmRef><pmRefIdent><pmCode ${attrString(e.pmRef)}/><issueInfo issueNumber="000" inWork="01"/></pmRefIdent></pmRef></pmEntry>`;
    return `<pmEntry><pmEntryTitle>${esc(e.folder)}</pmEntryTitle>${(e.children || []).map(entry).join('')}</pmEntry>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_${o.issue || '4-2'}/xml_schema_flat/pm.xsd">
  <identAndStatusSection>
    <pmAddress>
      <pmIdent>
        <pmCode ${attrString(c)}/>
        <language languageIsoCode="${lang[0]}" countryIsoCode="${lang[1]}"/>
        <issueInfo issueNumber="${o.issueNo || '001'}" inWork="00"/>
      </pmIdent>
      <pmAddressItems><issueDate year="2026" month="10" day="06"/><pmTitle>${esc(o.title || 'Test publication')}</pmTitle></pmAddressItems>
    </pmAddress>
    <pmStatus issueType="new">
      <security securityClassification="01"/>
      <responsiblePartnerCompany enterpriseCode="TST01"><enterpriseName>Test Co</enterpriseName></responsiblePartnerCompany>
      <originator enterpriseCode="TST01"><enterpriseName>Test Co</enterpriseName></originator>
    </pmStatus>
  </identAndStatusSection>
  <content>${(o.entries || []).map(entry).join('')}</content>
</pm>
`;
}

/** A zip with stored entries (no compression) - enough for the importer's reader, and tiny. */
function makeZip(files, { deflate = false, claimSize = null } = {}) {
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.bytes);
    const body = deflate ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(claimSize ?? raw.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(claimSize ?? raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

module.exports = { codeAttrs, dm, dmFile, table, pmc, makeZip };

// Packages for the import specs, made at test time from the sample modules in public/samples (nothing is stored in the repository):
// the three sample data modules, a publication that places two of them, and no graphic - so the scan finds a missing graphic to repair and a module
// no publication places. Also a stored-entry zip writer, because the dialog accepts a .zip.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'samples');
export const DESC = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
export const FAULT = 'DMC-S1KSTUDIO-A-29-10-00-00A-421A-A_001-00_EN-US.XML';
export const PROC = 'DMC-S1KSTUDIO-A-29-10-00-00A-520A-A_001-00_EN-US.XML';
export const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
export const PMC_NAME = 'PMC-S1KSTUDIO-S1K01-00001-00_001-00_EN-US.xml';
/** The module the publication below leaves out: it lands in the unassigned pool. */
export const UNPLACED = { file: FAULT, dmc: 'S1KSTUDIO-A-29-10-00-00A-421A-A' };

export interface PkgFile { name: string; bytes: Buffer }

const attrs = (o: Record<string, string>): string => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
/** `S1KSTUDIO-A-29-10-00-00A-040A-D` -> the dmCode attributes. */
function codeAttrs(dmc: string): Record<string, string> {
  const [model, sd, sys, subsub, assy, dis, info, loc] = dmc.split('-');
  return {
    modelIdentCode: model, systemDiffCode: sd, systemCode: sys, subSystemCode: subsub.slice(0, 1), subSubSystemCode: subsub.slice(1), assyCode: assy,
    disassyCode: dis.slice(0, 2), disassyCodeVariant: dis.slice(2), infoCode: info.slice(0, 3), infoCodeVariant: info.slice(3), itemLocationCode: loc,
  };
}

/** A publication module with chapters: `chapters` = [title, [dmc, ...]]. */
export function pmcXml(title: string, chapters: Array<[string, string[]]>): string {
  const entry = (dmc: string) => `<pmEntry><dmRef><dmRefIdent><dmCode ${attrs(codeAttrs(dmc))}/></dmRefIdent></dmRef></pmEntry>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/pm.xsd">
  <identAndStatusSection>
    <pmAddress>
      <pmIdent>
        <pmCode modelIdentCode="S1KSTUDIO" pmIssuer="S1K01" pmNumber="00001" pmVolume="00"/>
        <language languageIsoCode="en" countryIsoCode="US"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </pmIdent>
      <pmAddressItems><issueDate year="2026" month="10" day="06"/><pmTitle>${title}</pmTitle></pmAddressItems>
    </pmAddress>
    <pmStatus issueType="new">
      <security securityClassification="01"/>
      <responsiblePartnerCompany enterpriseCode="S1K01"><enterpriseName>Sample Studio Co</enterpriseName></responsiblePartnerCompany>
      <originator enterpriseCode="S1K01"><enterpriseName>Sample Studio Co</enterpriseName></originator>
    </pmStatus>
  </identAndStatusSection>
  <content>${chapters.map(([t, dmcs]) => `<pmEntry><pmEntryTitle>${t}</pmEntryTitle>${dmcs.map(entry).join('')}</pmEntry>`).join('')}</content>
</pm>
`;
}

/** The small package: three sample modules, a publication that places two of them (Description, Procedures), no graphic. */
export function samplePackage(): PkgFile[] {
  const read = (n: string): PkgFile => ({ name: n, bytes: fs.readFileSync(path.join(SAMPLES, n)) });
  return [
    read(DESC), read(PROC), read(FAULT),
    { name: PMC_NAME, bytes: Buffer.from(pmcXml('Imported pump manual', [['Description', ['S1KSTUDIO-A-29-10-00-00A-040A-D']], ['Procedures', ['S1KSTUDIO-A-29-10-00-00A-520A-A']]])) },
  ];
}

/** A zip with stored (uncompressed) entries: enough for the importer's reader, and tiny. */
export function zip(files: PkgFile[]): Buffer {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = zlib.crc32(f.bytes);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(f.bytes.length, 18); lh.writeUInt32LE(f.bytes.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, f.bytes);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(f.bytes.length, 20); ch.writeUInt32LE(f.bytes.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + f.bytes.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** A 1x1 PNG, for graphics that only need to exist. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

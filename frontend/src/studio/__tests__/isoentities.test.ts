// A module that declares the ISO character entities from the publisher's website must validate offline:
// no "Attempt to load network entity" warning, and &deg; & co. must be defined.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateXsd, type XmllintRunner, type SchemaLoader } from '../validation/xsd';

const PUB = path.resolve(__dirname, '../../../public');
const SAMPLE = fs.readFileSync(path.join(PUB, 'samples', 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML'), 'utf8');

// Same contract as the browser worker: input files appear side by side in one directory, then xmllint runs there.
const runner: XmllintRunner = async (run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsd-ent-'));
  for (const f of run.inputFiles) fs.writeFileSync(path.join(dir, f.fileName), f.contents);
  const r = spawnSync('xmllint', run.args, { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
};
const loader: SchemaLoader = async (issue, file) => {
  try { return fs.readFileSync(path.join(PUB, 'schemas', issue, file), 'utf8'); } catch { return null; }
};

const withEntities = (url: string, body = '&deg; &plusmn;') =>
  SAMPLE.replace('<!DOCTYPE dmodule [', `<!DOCTYPE dmodule [\n  <!ENTITY % ISOEntities PUBLIC "ISO 8879-1986//ENTITIES ISO Character Entities 20030531//EN//XML" "${url}">\n  %ISOEntities;`)
    .replace(/<title>[^<]*<\/title>/, `<title>T ${body}</title>`);

describe('ISO character entities declared from the website', () => {
  for (const url of ['http://www.s1000d.org/S1000D_4-2/ent/ISOEntities', 'http://www.s1000d.org/S1000D_5-0/ent/xml/ISOEntities']) {
    it(`validates offline: ${url}`, async () => {
      const r = await validateXsd(withEntities(url), '5-0', 'descript', loader, runner);
      const text = r.issues.map((i) => i.message).join('\n');
      expect(text).not.toMatch(/network entity|ISOEntities|Entity '(deg|plusmn)'/i);
      expect(r.valid, text).toBe(true);
    });
  }
  it('keeps line numbers (only the URL text changes)', async () => {
    const xml = withEntities('http://www.s1000d.org/S1000D_4-2/ent/ISOEntities').replace('<dmAddress>', '<dmAddress><bogus/>');
    const r = await validateXsd(xml, '5-0', 'descript', loader, runner);
    const line = xml.split('\n').findIndex((l) => l.includes('<bogus/>')) + 1;
    expect(r.issues.find((i) => /bogus/.test(i.message))?.line).toBe(line);
  });
  it('an undefined entity is still reported (the files are not a blanket pass)', async () => {
    const r = await validateXsd(withEntities('http://www.s1000d.org/S1000D_4-2/ent/ISOEntities', '&nosuchentity;'), '5-0', 'descript', loader, runner);
    // libxml2 reports an undefined entity as a warning when a DTD subset exists; it must still be reported
    expect(r.issues.map((i) => i.message).join('\n')).toMatch(/Entity 'nosuchentity' not defined/);
  });
});

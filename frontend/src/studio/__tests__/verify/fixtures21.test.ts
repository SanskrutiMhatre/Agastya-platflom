// WRITE_FIXTURES=1 npx vitest run src/studio/__tests__/verify/fixtures21.test.ts
// Writes the realistic module of every wizard type, for every wizard issue, to e2e/fixtures/dm21/<issue>/ (unique module codes: the
// assembly code is the type's position in the wizard), plus the figure they reference. The browser suite imports these.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES, defaultNewDmOptions } from '../../core/templates';
import { ISSUES, TYPES, richDm, PUB, ICN } from './lib';

describe.skipIf(!process.env.WRITE_FIXTURES)('write the 21 x 4 realistic modules for the browser suite', () => {
  it('writes them', () => {
    const root = path.resolve(__dirname, '../../../../e2e/fixtures/dm21');
    for (const issue of ISSUES) {
      const dir = path.join(root, issue);
      fs.rmSync(dir, { recursive: true, force: true });          // no stale files from an earlier layout
      fs.mkdirSync(dir, { recursive: true });
      const manifest: Record<string, string> = {};   // type -> file name: tests must use this, NOT the sort order of the files
      for (const [i, type] of TYPES.entries()) {
        // the BREX data module must keep assembly 00 (official BREX rule BREX-S1-00144); every other module takes its position in the wizard
        const assy = type === 'brex' ? '00' : String(i + 1).padStart(2, '0');
        const o = defaultNewDmOptions(type, issue);
        const c = { ...o.code, assyCode: assy };
        const name = `DMC-${c.modelIdentCode}-${c.systemDiffCode}-${c.systemCode}-${c.subSystemCode}${c.subSubSystemCode}-${c.assyCode}-${c.disassyCode}${c.disassyCodeVariant}-${c.infoCode}${c.infoCodeVariant}-${c.itemLocationCode}_001-00_EN-US.XML`;
        fs.writeFileSync(path.join(dir, name), richDm(type, issue, assy));
        manifest[type] = name;
      }
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
    }
    fs.copyFileSync(path.join(PUB, 'samples', ICN + '.svg'), path.join(root, ICN + '.svg'));
    expect(TEMPLATES.length).toBe(21);
  });
});

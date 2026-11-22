import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { refusalHint, refusalReasons } from './importRefusal';

const refused = (report: unknown) => new ApiError(422, 'The package was not imported, so no project was created.', 'IMPORT_REFUSED', { report } as Record<string, unknown>);
const notRegistered = (code: string) => `Responsible partner company: the enterprise code “${code}” is not registered.`;

describe('why a package import was refused', () => {
  it('groups the files refused for the same reason, most files first, with a few names', () => {
    const items = [
      ...Array.from({ length: 21 }, (_, i) => ({ path: `csdb/DMC-EXAMPLE-A-00-00-${String(i).padStart(2, '0')}-00A-040A-D_001-00_EN-US.XML`, status: 'rejected', message: notRegistered('00000') })),
      { path: 'csdb/DMC-OTHER.XML', status: 'rejected', message: 'The file is not well-formed XML.' },
      { path: 'Media/x.svg', status: 'accepted', message: 'ok' },
    ];
    const r = refusalReasons(refused({ items, notes: [] }));
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ message: notRegistered('00000'), count: 21 });
    expect(r[0].files).toEqual(['DMC-EXAMPLE-A-00-00-00-00A-040A-D_001-00_EN-US.XML', 'DMC-EXAMPLE-A-00-00-01-00A-040A-D_001-00_EN-US.XML', 'DMC-EXAMPLE-A-00-00-02-00A-040A-D_001-00_EN-US.XML']);
    expect(r[1]).toMatchObject({ message: 'The file is not well-formed XML.', count: 1, files: ['DMC-OTHER.XML'] });
  });

  it('falls back to the package-level problems, and says nothing for any other error', () => {
    expect(refusalReasons(refused({ items: [], notes: ['The package has no data modules.'] }))).toEqual([{ message: 'The package has no data modules.', count: 1, files: [] }]);
    expect(refusalReasons(refused({ items: [], notes: [], manifest: { present: true, checked: 3, mismatches: ['a.xml'] } }))[0].message).toMatch(/manifest does not match.*a\.xml/);
    expect(refusalReasons(new Error('Failed to fetch'))).toEqual([]);
    expect(refusalReasons(new ApiError(410, 'That upload has expired.', 'UPLOAD_EXPIRED'))).toEqual([]);
    expect(refusalReasons(new ApiError(422, 'x', 'IMPORT_REFUSED'))).toEqual([]);
  });

  it('points an author at the Administrator lists only when the reason is an unregistered enterprise', () => {
    expect(refusalHint([{ message: notRegistered('00000'), count: 21, files: [] }])).toMatch(/RPC CAGE codes and Originator CAGE codes/);
    expect(refusalHint([{ message: 'The file is not well-formed XML.', count: 1, files: [] }])).toBeNull();
  });
});

// WP-34: the JSS/JSG shortcut registry must describe exactly the keys the editors' handlers compare. A key added to a handler without a
// registry entry, or an entry left behind after its key was removed, fails here, and so cannot slip past the parity baseline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EDITOR_SHORTCUTS, baseKey } from './editorShortcuts';
import { handlerKeys } from '../../scripts/parity/scan.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['jss/editor.ts', 'jss/dom.ts', 'jsg/editor.ts', 'jsg/shared.ts', 'jsg/ispl-editor.ts', 'editors/host/useHostKeys.ts', 'editors/host/CommandPalette.tsx', 'editors/host/FindBar.tsx'];

describe('JSS and JSG shortcut registry', () => {
  it('ids are unique and every entry names a file the test checks', () => {
    const ids = EDITOR_SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of EDITOR_SHORTCUTS) { expect(FILES).toContain(s.file); expect(s.keys.length).toBeGreaterThan(0); expect(s.action).not.toBe(''); }
  });

  for (const file of FILES) {
    it(`${file}: the keys its handlers compare are the keys the registry lists for it`, () => {
      const scanned = new Set(handlerKeys(fs.readFileSync(path.join(SRC, file), 'utf8')).map((k) => k.toLowerCase()));
      const listed = new Set(EDITOR_SHORTCUTS.filter((s) => s.file === file).flatMap((s) => s.keys.map(baseKey)));
      expect([...listed].sort()).toEqual([...scanned].sort());
    });
  }
});

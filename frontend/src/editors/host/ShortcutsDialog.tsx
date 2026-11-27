// WP-21 (06 section 7.7): one dialog with every key of the JSS or JSG editor page (the S1000D Studio shows its own registry in its F1 dialog).
// The list comes from lib/editorShortcuts.ts, which a test holds to the key handlers, so the dialog cannot drift from what the keys do.

import { Modal } from '../../components/ui';
import '../../styles/pages/editor-host.css';   // WP-35: loads with the editor chunks
import { shortcutsFor, type EditorShortcut } from '../../lib/editorShortcuts';

const label = (k: string): string => k.replace(/Mod\+/g, 'Ctrl+').replace(/Arrow(Up|Down|Left|Right)/g, (_, d: string) => ({ Up: '↑', Down: '↓', Left: '←', Right: '→' })[d] ?? d);

export function ShortcutsDialog({ editor, onClose }: { editor: 'jss' | 'jsg' | 'jsg-ispl'; onClose: () => void }) {
  const all = shortcutsFor(editor);
  const groups: Array<[string, EditorShortcut[]]> = [
    ['On the whole page', all.filter((s) => s.editor === 'host')],
    [editor === 'jss' ? 'In the JSS editor' : editor === 'jsg' ? 'In the JSG editor' : 'In the parts list editor', all.filter((s) => s.editor !== 'host')],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={640}>
      <div className="v2-shortcuts" data-testid="shortcuts-dialog">
        {groups.map(([title, list]) => list.length ? (
          <section key={title}>
            <h3 className="v2-shortcuts-h">{title}</h3>
            <table className="v2-table v2-shortcuts-t">
              <thead><tr><th scope="col">Keys</th><th scope="col">What it does</th><th scope="col">Where</th></tr></thead>
              <tbody>{list.map((s) => <tr key={s.id}><td>{s.keys.map((k) => <kbd key={k} className="v2-kbd">{label(k)}</kbd>)}</td><td>{s.action}</td><td className="v2-hint">{s.where}</td></tr>)}</tbody>
            </table>
          </section>
        ) : null)}
      </div>
    </Modal>
  );
}

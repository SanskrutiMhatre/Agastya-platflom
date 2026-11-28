// "Add from the common repository": pick data modules from the platform-wide CIR and copy them into this
// project. The project then owns its copies; a module the project already has is shown but not selectable.

import { useMemo, useState } from 'react';
import { cirApi } from '../api';
import { Callout, EmptyState, Loading, Modal, Pill, errText, useAsync } from './ui';
import { Icon } from './Icon';
import '../styles/pages/project-pages.css';   // UI consistency pass: the dialog's list and footer (it opens in the editor, where no project page has loaded the sheet)
import { useUi } from '../store/ui';

export function CirPicker({ projectId, existing, onClose, onAdded }: { projectId: string; existing: Set<string>; onClose: () => void; onAdded: () => void }) {
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => cirApi.list(), []);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const rows = useMemo(() => (list.data?.modules ?? []).filter((m) => !q || `${m.file} ${m.title ?? ''} ${m.infoName ?? ''} ${m.kind ?? ''} ${m.note ?? ''}`.toLowerCase().includes(q.toLowerCase())), [list.data, q]);
  const toggle = (file: string) => setChosen((c) => { const n = new Set(c); if (n.has(file)) n.delete(file); else n.add(file); return n; });

  const add = async () => {
    setBusy(true); setProblems([]);
    const failed: string[] = []; let done = 0;
    for (const file of chosen) {
      try { await cirApi.copy(file, projectId); done++; } catch (e) { failed.push(`${file}: ${errText(e)}`); }
    }
    if (done) { toast(`Added ${done} data module${done === 1 ? '' : 's'} from the repository`, 'success'); onAdded(); }
    if (failed.length) { setProblems(failed); setChosen(new Set(failed.map((f) => f.split(':')[0]))); setBusy(false); }
    else onClose();
  };

  return (
    <Modal title="Add from the common repository" onClose={onClose} width={680}
      buttons={<><span className="faint pp-dlg-count">{chosen.size} chosen</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || chosen.size === 0} aria-busy={busy || undefined} onClick={add} data-testid="cir-pick-add"><Icon name="plus" size={16} />Add {chosen.size || ''} to this project</button></>}>
      <div className="pp-form">
        <input className="input search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter common data modules" />
        {list.loading && !list.data ? <Loading /> : list.error ? <Callout tone="danger" title="The repository could not be read">{list.error}</Callout> : rows.length === 0 ? <EmptyState icon="library" title={q ? 'No module matches' : 'The repository is empty'} /> : (
          <div className="table-wrap pp-scroll-box pp-dlg-list">
            <table className="table"><tbody>
              {rows.map((m) => {
                const have = existing.has(m.file);
                return (
                  <tr key={m.id} className={have ? 'pp-have' : undefined} data-testid="cir-pick-row" data-file={m.file} aria-selected={chosen.has(m.file)} onClick={() => { if (!have) toggle(m.file); }}>
                    <td className="pp-tick"><input type="checkbox" disabled={have} checked={chosen.has(m.file)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(m.file)} aria-label={`Select ${m.file}`} /></td>
                    <td><strong>{m.title || m.file}</strong><div className="faint trunc" title={m.file}>{m.dmc ?? m.file}{m.infoName ? ` · ${m.infoName}` : ''}</div></td>
                    <td className="num"><Pill>{m.kind ?? 'Common module'}</Pill>{have ? <span className="faint"> already here</span> : null}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
        )}
        {problems.length ? <Callout tone="danger" title="Not every module was added"><ul className="pp-list">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Callout> : null}
      </div>
    </Modal>
  );
}

// "Add from the common repository": pick data modules from the platform-wide CIR and copy them into this
// project. The project then owns its copies; a module the project already has is shown but not selectable.

import { useMemo, useState } from 'react';
import { cirApi } from '../api';
import { Alert, Badge, Empty, Loading, Modal, errText, useAsync } from './ui';
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
    <Modal title="Add from the common repository" onClose={onClose} width={640}
      buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || chosen.size === 0} onClick={add} data-testid="cir-pick-add">Add {chosen.size || ''} to this project</button></>}>
      <div className="v2-stack">
        <input className="v2-input" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter common data modules" />
        {list.loading && !list.data ? <Loading /> : list.error ? <Alert tone="bad">{list.error}</Alert> : rows.length === 0 ? <Empty title={q ? 'No module matches' : 'The repository is empty'} /> : (
          <div style={{ maxHeight: '48vh', overflow: 'auto' }}>
            {rows.map((m) => {
              const have = existing.has(m.file);
              return (
                <label key={m.id} className="v2-row" style={{ gap: 10, padding: '6px 4px', borderBottom: '1px solid var(--border)', opacity: have ? .55 : 1 }} data-testid="cir-pick-row" data-file={m.file}>
                  <input type="checkbox" disabled={have} checked={chosen.has(m.file)} onChange={() => toggle(m.file)} aria-label={`Select ${m.file}`} />
                  <span style={{ flex: 1, minWidth: 0 }}><b>{m.title || m.file}</b><div className="v2-hint v2-trunc" title={m.file}>{m.dmc ?? m.file}{m.infoName ? ` · ${m.infoName}` : ''}</div></span>
                  <Badge>{m.kind ?? 'Common module'}</Badge>
                  {have ? <span className="v2-hint">already here</span> : null}
                </label>
              );
            })}
          </div>
        )}
        {problems.length ? <Alert tone="bad"><ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert> : null}
      </div>
    </Modal>
  );
}

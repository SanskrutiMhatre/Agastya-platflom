// Shown on every page of an S1000D project whose data modules name a BREX (business rules) data module that the project does not hold. Without it the
// manual cannot be published. One click creates it: it names the official S1000D default rules as its parent and adds no rules of its own.

import { useEffect, useState } from 'react';
import { contentApi } from '../api';
import { Alert, errText } from './ui';
import { useUi } from '../store/ui';

export function MissingBrex({ projectId, canCreate }: { projectId: string; canCreate: boolean }) {
  const toast = useUi((s) => s.toast);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => contentApi.missingBrex(projectId).then((r) => { if (live) setMissing(r.missing); }).catch(() => { if (live) setMissing([]); });
    void load();
    const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, [projectId]);
  if (!missing.length) return null;
  const create = async () => {
    setBusy(true);
    try { const r = await contentApi.createBrex(projectId); toast(`Created ${r.created.join(', ')}`, 'success'); setMissing([]); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <div style={{ padding: '10px 16px 0' }} data-testid="missing-brex">
      <Alert tone="warn">
        <b>The manual cannot be published yet: its business rules (BREX) file is missing.</b> Every data module says it follows <span className="v2-mono">{missing.join(', ')}</span>, and the project does not have it.
        {canCreate
          ? <> You can create it here. It uses the official S1000D default rules and adds no rules of its own; you can add your own later. <button className="btn btn-sm btn-primary" style={{ marginLeft: 8 }} disabled={busy} onClick={() => void create()} data-testid="create-brex">Create the BREX</button></>
          : <> Ask an editor of this project to create it, or import the original file.</>}
      </Alert>
    </div>
  );
}

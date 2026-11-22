import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspaceApi } from '../api';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { errText } from './ui';

/** Creates the ready-made sample project (three data modules, a figure, a three-chapter publication) and opens it. */
export function SampleButton({ folder, onCreated }: { folder?: string; onCreated?: () => void }) {
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn" disabled={busy} data-testid="create-sample" title="Create a ready-made project to try the platform" onClick={async () => {
      setBusy(true);
      try { const p = await workspaceApi.createSample(folder); toast(`Created "${p.name}"`, 'success'); onCreated?.(); nav(`/projects/${p.id}`); }
      catch (e) { toast(errText(e), 'error'); setBusy(false); }
    }}><Icon name="layers" />{busy ? 'Creating…' : 'Sample project'}</button>
  );
}

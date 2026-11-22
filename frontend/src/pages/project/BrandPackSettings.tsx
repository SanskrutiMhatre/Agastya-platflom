// Project settings, "Brand pack": which logo and company line the page furniture of this project's PDF uses.
//
// A brand pack is a folder in the workspace's templates/brand folder (brand.json + a logo file). The project stores its choice as `brandPack`
// in project.json; empty means "use the template's default". The server replaces the whole project object on save, so a save re-reads the project
// and changes only that one field. The logo needs the session cookie, so it is shown with an <img> pointing at the relative URL.

import { useState } from 'react';
import { brandApi, type BrandPack } from '../../api/brand';
import { settingsApi } from '../../api/settings';
import { Alert, Field, Loading, Spinner, errText, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { BRAND_PRECEDENCE, chosenPack, isMissingPack, packSummary, templatePackId, withBrandPack } from '../../lib/brandPack';
import { canChooseBrandPack } from '../../lib/roles';
import { useUi } from '../../store/ui';

function Preview({ pack, caption }: { pack: BrandPack | undefined; caption: string }) {
  return (
    <div className="v2-stack" style={{ gap: 6 }} data-testid="brand-preview">
      <div className="v2-brandprev" aria-label="Preview of the logo and company line">
        {pack?.hasLogo ? <img src={brandApi.logoUrl(pack.id)} alt={`Logo of ${pack.name}`} data-testid="brand-logo" /> : <span className="v2-hint" style={{ color: '#5c6575' }} data-testid="brand-nologo">No logo</span>}
        <strong data-testid="brand-company">{pack?.company || ''}</strong>
        {pack && !pack.company ? <span className="v2-hint" style={{ color: '#5c6575' }}>No company line</span> : null}
      </div>
      <span className="v2-hint">{caption}</span>
    </div>
  );
}

export function BrandPackSettings() {
  const { id, role } = useProject();
  const toast = useUi((s) => s.toast);
  const packs = useAsync(() => brandApi.list(), []);
  const settings = useAsync(() => settingsApi.get(id), [id]);
  const [pick, setPick] = useState<string | null>(null);            // null = untouched: show what is saved
  const [busy, setBusy] = useState(false);
  const may = canChooseBrandPack(role);

  if ((packs.loading && !packs.data) || (settings.loading && !settings.data)) return <Loading />;
  if (packs.error || settings.error || !packs.data || !settings.data) return <Alert tone="bad">{packs.error || settings.error || 'Could not read the brand packs.'}</Alert>;

  const list = packs.data;
  const saved = chosenPack(settings.data.project);
  const value = pick ?? saved;
  const dirty = value !== saved;
  const byId = new Map(list.map((p) => [p.id, p]));
  const fromTemplate = templatePackId(settings.data.house);
  const shown = value ? byId.get(value) : byId.get(fromTemplate);
  const caption = value
    ? (shown ? `This project builds with ${packSummary(shown)}.` : 'This pack is not installed in this workspace: builds run without its logo and company line.')
    : fromTemplate
      ? (shown ? `Template default: the template “${settings.data.templateRef}” uses the pack “${fromTemplate}” (${packSummary(shown)}).` : `Template default: the template names the pack “${fromTemplate}”, which is not installed here.`)
      : `Template default: the template “${settings.data.templateRef}” names no brand pack, so a pack adds no logo or company line.`;

  const save = async () => {
    setBusy(true);
    try {
      const fresh = await settingsApi.get(id);                         // the server replaces the whole project: start from what is there now
      await settingsApi.save(id, { project: withBrandPack((fresh.project ?? {}) as Record<string, unknown>, value) });
      toast(value ? `Brand pack “${byId.get(value)?.name ?? value}” saved` : 'Brand pack set to the template default', 'success');
      setPick(null); settings.reload();
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="v2-stack" style={{ maxWidth: 700 }} data-testid="brand-settings">
      {!may ? <Alert tone="warn">You have {role} access: only an editor, manager or owner can change the brand pack.</Alert> : null}
      {saved && isMissingPack(saved, list) ? <Alert tone="warn"><span data-testid="brand-missing">The saved brand pack “{saved}” is not installed in this workspace. Builds run without its logo and company line until it is installed or another pack is chosen.</span></Alert> : null}
      <div className="v2-card v2-card-pad v2-stack">
        <h3 style={{ margin: 0 }}>Brand pack</h3>
        <p className="v2-sub" style={{ margin: 0 }}>The logo and the company line printed in the page furniture of this project&rsquo;s PDF (the header logo and the company margin mark). Only publications that use the Xignal page layout print them.</p>
        <Field label="Brand pack">
          <select className="v2-select" value={value} disabled={!may || busy} onChange={(e) => setPick(e.target.value)} data-testid="brand-select">
            <option value="">Template default{fromTemplate && byId.get(fromTemplate) ? ` (${byId.get(fromTemplate)!.name})` : ''}</option>
            {list.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            {value && isMissingPack(value, list) ? <option value={value}>{value} (not installed)</option> : null}
          </select>
        </Field>
        <Preview pack={shown} caption={caption} />
        {may ? <div className="v2-row"><button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()} data-testid="brand-save">{busy ? <Spinner /> : null}Save brand pack</button>{dirty ? <span className="v2-hint">Not saved yet.</span> : null}</div> : null}
      </div>

      <div className="v2-card v2-card-pad v2-stack" style={{ gap: 8 }} data-testid="brand-help">
        <h3 style={{ margin: 0 }}>Where each item of the page furniture comes from</h3>
        <p className="v2-hint" style={{ margin: 0 }}>For every item the build uses the first of these that has a value, so the pack is only a fallback behind what you fill in yourself:</p>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{BRAND_PRECEDENCE.map((line) => <li key={line}>{line}</li>)}</ol>
        <h3 style={{ margin: '8px 0 0' }}>Adding a brand pack</h3>
        <p style={{ margin: 0 }}>Copy the pack&rsquo;s folder (it holds <span className="v2-mono">brand.json</span> and the logo) into the workspace&rsquo;s <span className="v2-mono">templates/brand</span> folder, so that it becomes <span className="v2-mono">templates/brand/&lt;pack&gt;/</span>. Reload this page and it is offered above. Nothing can be installed from this screen.</p>
      </div>
    </div>
  );
}

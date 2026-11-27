// Ancillary pages: the pages before the body of a JSS document (title pages, notices, foreword, record of changes, lists ...).
//
// Left: every page the document's stencil has, in the order they print, each with a checkbox that says whether it is printed.
// Right: the page that is selected. Its words are edited as plain text fields (the tags are never shown or touched); the XML view is there for the person
// who needs to change a page's structure. A page edited here is kept when Settings change; "Give back to Settings" undoes that.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ancillaryApi, type AncillaryPage } from '../../api/jss';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, ConfirmModal, Loading, Spinner, errText, useAsync } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { parsePage } from '../../lib/ancillaryXml';
import { useUi } from '../../store/ui';
import { useLeaveGuard } from '../../lib/leaveGuard';

type Mode = 'text' | 'xml';

export function AncillaryPage() {
  const { id, role } = useProject();
  const toast = useUi((s) => s.toast);
  const writable = canWrite(role);
  const list = useAsync(() => ancillaryApi.list(id), [id]);
  const [pages, setPages] = useState<AncillaryPage[]>([]);
  const [sel, setSel] = useState('');
  useEffect(() => { if (list.data) { setPages(list.data); setSel((s) => (s && list.data!.some((p) => p.id === s) ? s : (list.data!.find((p) => p.file)?.id ?? list.data![0]?.id ?? ''))); } }, [list.data]);

  // the page being edited
  const [xml, setXml] = useState('');                    // as saved
  const [draft, setDraft] = useState('');                // as edited (XML view)
  const [values, setValues] = useState<Record<number, string>>({});
  const [mode, setMode] = useState<Mode>('text');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);
  const page = pages.find((p) => p.id === sel);

  // `draft` is the page's XML as it stands; the text fields are edits laid over it until the person saves or switches to the XML view.
  const parsed = useMemo(() => parsePage(draft), [draft]);
  const textDirty = !!parsed && Object.entries(values).some(([i, v]) => parsed.fields[Number(i)]?.value !== v);
  const current = textDirty && parsed ? parsed.withValues(values) : draft;
  const dirty = !!page?.file && (draft !== xml || textDirty);

  const load = useCallback(async (pageId: string) => {
    setError(''); setValues({}); setDraft(''); setXml('');
    const p = pages.find((x) => x.id === pageId); if (!p?.file) return;
    setLoading(true);
    try { const r = await ancillaryApi.read(id, pageId); setXml(r.xml); setDraft(r.xml); }
    catch (e) { setError(errText(e)); } finally { setLoading(false); }
  }, [id, pages]);
  useEffect(() => { if (sel) void load(sel); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sel, pages.length]);

  // FE-012 / GAP-001: switching to another page with unsaved changes asks in the platform's own dialog, not the browser's
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const choose = (next: string) => {
    if (next === sel) return;
    if (dirty) { setSwitchTo(next); return; }
    setSel(next);
  };

  const patch = async (p: AncillaryPage, change: { enabled?: boolean; title?: string }, said: string) => {
    const before = pages;
    setPages((all) => all.map((x) => (x.id === p.id ? { ...x, ...(change.enabled !== undefined ? { enabled: change.enabled } : {}), ...(change.title !== undefined ? { customTitle: change.title } : {}) } : x)));
    try { setPages(await ancillaryApi.choose(id, [{ id: p.id, ...change }])); toast(said, 'success'); }
    catch (e) { setPages(before); toast(errText(e), 'error'); }
  };

  const save = async (): Promise<boolean> => {
    if (!page) return false;
    setBusy(true); setError('');
    try {
      const saved = await ancillaryApi.save(id, page.id, current);
      setPages((all) => all.map((x) => (x.id === saved.id ? saved : x)));
      setXml(current); setDraft(current); setValues({});
      toast(`${page.label} saved. It is printed the next time you generate the PDF.`, 'success');
      return true;
    } catch (e) { setError(errText(e)); return false; } finally { setBusy(false); }
  };
  // GAP-001: leaving the page (rail, link, Back, closing the tab) with unsaved changes asks first
  const guard = useLeaveGuard(dirty, { what: 'changes to this ancillary page', save });

  const reset = async () => {
    if (!page) return;
    setResetting(false); setBusy(true); setError('');
    try {
      const r = await ancillaryApi.reset(id, page.id);
      setPages((all) => all.map((x) => (x.id === r.page.id ? r.page : x)));
      setXml(r.xml); setDraft(r.xml); setValues({});
      toast(`${page.label} is back to what Settings say.`, 'success');
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const printed = pages.filter((p) => p.enabled).length;

  return (
    <div className="v2-page">
      {guard}
      {switchTo ? <ConfirmModal title="Leave this page without saving?" danger confirmLabel="Discard my changes" body={<p>You have unsaved changes to {page?.label ?? 'this page'}. They are lost if you open another page now.</p>} onClose={() => setSwitchTo(null)} onConfirm={() => { const n = switchTo; setSwitchTo(null); setSel(n); }} /> : null}
      <PageHeader icon="file" title="Ancillary pages"
        sub="The pages before the body: choose which are printed, and edit what they say. Changes appear the next time you generate the PDF."
        stats={[{ label: 'Printed', value: `${printed} of ${pages.length}` }, { label: 'Edited by hand', value: pages.filter((p) => p.edited).length, tone: pages.some((p) => p.edited) ? 'accent' : undefined }]} />
      {!writable ? <Alert tone="warn">You have {role} access to this project: you can read these pages, but changes cannot be saved.</Alert> : null}
      {list.error ? <Alert tone="bad">{list.error}</Alert> : null}
      {list.loading && !list.data ? <Loading /> : null}

      <div className="v2-anc" data-testid="ancillary">
        <div className="v2-card v2-anc-list" role="list" aria-label="Ancillary pages">
          <div className="v2-card-head"><span>Pages, in print order</span></div>
          {pages.map((p, i) => (
            <div key={p.id} role="listitem" className={`v2-anc-row ${p.id === sel ? 'sel' : ''} ${p.enabled ? '' : 'off'}`} data-testid="anc-row" data-page={p.id}>
              <input type="checkbox" checked={p.enabled} disabled={!writable || p.required} aria-label={`Print ${p.label}`} data-testid="anc-print"
                title={p.required ? 'This page is always printed' : p.enabled ? 'Printed: untick to leave it out' : 'Not printed: tick to include it'}
                onChange={(e) => void patch(p, { enabled: e.target.checked }, `${p.label} ${e.target.checked ? 'will be printed' : 'is left out'}`)} />
              <button type="button" className="v2-anc-name" onClick={() => choose(p.id)} aria-current={p.id === sel}>
                <span className="n">{i + 1}</span>
                <span className="t">{p.customTitle || p.label}</span>
                {p.edited ? <Badge tone="accent" title="Changed by hand here: Settings no longer rewrite it">edited</Badge> : null}
                {p.required ? <Badge title="Always printed">always</Badge> : null}
                {!p.file ? <Badge title="Made automatically from the document">automatic</Badge> : null}
              </button>
            </div>
          ))}
        </div>

        <div className="v2-card v2-anc-edit">
          {!page ? <div className="v2-card-pad v2-hint">Choose a page.</div> : (
            <>
              <div className="v2-card-head" style={{ flexWrap: 'wrap' }}>
                <strong>{page.label}</strong>
                {page.edited ? <Badge tone="accent">edited by hand</Badge> : null}
                {!page.enabled ? <Badge tone="warn">not printed</Badge> : null}
                <span className="spacer" />
                {page.file ? (
                  <div className="v2-seg" role="group" aria-label="How to edit">
                    <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')} aria-pressed={mode === 'text'}>Text</button>
                    <button className={mode === 'xml' ? 'on' : ''} onClick={() => { if (mode === 'text') { setDraft(current); setValues({}); } setMode('xml'); }} aria-pressed={mode === 'xml'} title="The page's XML, for changing its structure">XML</button>
                  </div>
                ) : null}
              </div>
              <div className="v2-card-pad v2-stack">
                {error ? <Alert tone="bad">{error}</Alert> : null}

                {page.title !== null ? (
                  <label className="v2-anc-field"><span>Heading printed on the page</span>
                    <input className="v2-input" defaultValue={page.customTitle} key={`${page.id}:${page.customTitle}`} placeholder={page.title ?? ''} disabled={!writable} data-testid="anc-heading"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== page.customTitle) void patch(page, { title: v }, v ? 'Heading changed' : 'Heading back to the stencil\'s'); }} />
                    <small className="v2-hint">Leave empty to print the stencil's heading, “{page.title}”.</small>
                  </label>
                ) : null}

                {!page.file ? (
                  <p className="v2-hint" style={{ margin: 0 }}><Icon name="info" size={13} /> This page is made automatically from the document (the lists of contents, figures and tables), so it has no text to edit. Use the checkbox to print it or leave it out.</p>
                ) : loading ? <Loading /> : mode === 'text' ? (
                  parsed && parsed.fields.length ? (
                    <div className="v2-stack" data-testid="anc-fields">
                      {parsed.fields.map((f) => {
                        const v = values[f.index] ?? f.value;
                        return (
                          <label key={f.index} className="v2-anc-field"><span>{f.label}</span>
                            {f.multiline || v.length > 70
                              ? <textarea className="v2-input" rows={Math.min(8, Math.max(3, Math.ceil(v.length / 70)))} value={v} disabled={!writable} onChange={(e) => setValues((x) => ({ ...x, [f.index]: e.target.value }))} data-testid="anc-field" />
                              : <input className="v2-input" value={v} disabled={!writable} onChange={(e) => setValues((x) => ({ ...x, [f.index]: e.target.value }))} data-testid="anc-field" />}
                          </label>
                        );
                      })}
                    </div>
                  ) : <p className="v2-hint" style={{ margin: 0 }}>{parsed ? 'This page has no text of its own: it is a form or table filled in by hand after printing. Use the XML view to change its layout.' : 'The page is not well-formed XML; fix it in the XML view.'}</p>
                ) : (
                  <textarea className="v2-input v2-mono" rows={22} spellCheck={false} value={draft} disabled={!writable} onChange={(e) => setDraft(e.target.value)} aria-label="The page's XML" data-testid="anc-xml" style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                )}

                {page.file ? (
                  <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" disabled={!writable || !dirty || busy} onClick={() => void save()} data-testid="anc-save">{busy ? <Spinner /> : <Icon name="check" size={14} />}Save page</button>
                    <button className="btn" disabled={!dirty || busy} onClick={() => { setValues({}); setDraft(xml); setError(''); }}>Undo my changes</button>
                    <span className="spacer" />
                    {page.edited ? <button className="btn" disabled={!writable || busy} onClick={() => setResetting(true)} title="Throw away the changes made here and print what Settings say" data-testid="anc-reset"><Icon name="undo" size={14} />Give back to Settings</button> : null}
                  </div>
                ) : null}
                {page.file && page.edited ? <p className="v2-hint" style={{ margin: 0 }}>This page was edited by hand, so changes to the same page in <strong>Settings</strong> do not show up in the PDF until you give it back.</p> : null}
              </div>
            </>
          )}
        </div>
      </div>

      {resetting && page ? (
        <ConfirmModal title="Give this page back to Settings?" danger confirmLabel="Give back" onClose={() => setResetting(false)} onConfirm={() => reset()}
          body={<p style={{ marginTop: 0 }}>The changes you made to <strong>{page.label}</strong> are thrown away, and the page is written again from Settings.</p>} />
      ) : null}
    </div>
  );
}

// =============================================================================
// PublishSettings — the configuration behind a published book.
//
// Two layers, and which one a field belongs to is shown rather than hidden:
//
//   House template — page size, fonts, default front-matter wording. SHARED by
//     every project that references it, so a change here moves other books too.
//   Project        — this publication's own title, book name, overrides.
//
// The engine merges them at build time (project over house). Before this screen
// existed, both were editable only by hand-editing project.json and
// *.house.json on disk.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { settingsApi, type CataloguePage, type SettingsPayload } from '../../../api/settings';
import { useNavStore } from '../../../store/navStore';
import { getPath, withPath } from '../../../lib/configPath';

type Tab = 'Publication' | 'Front matter' | 'Layout' | 'Branding';
const TABS: Tab[] = ['Publication', 'Front matter', 'Layout', 'Branding'];

/**
 * The stamp printed on every page.
 *
 * This is the literal TEXT the stylesheet stamps, not an S1000D numeric code —
 * `security.classification` is emitted verbatim, so storing "02" here puts the
 * characters "02" in the corner of every page rather than "RESTRICTED". The
 * numeric code lives on each data module's own <security> element.
 */
const SECURITY: [string, string][] = [
  ['UNCLASSIFIED', 'Unclassified'],
  ['RESTRICTED', 'Restricted'],
  ['CONFIDENTIAL', 'Confidential'],
  ['SECRET', 'Secret'],
  ['TOP SECRET', 'Top secret'],
];

// ── Small field primitives ─────────────────────────────────────────────────

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--x-text-muted)' }}>
    {children}
  </span>
);

interface FieldProps {
  label: string;
  value: any;
  onChange: (v: any) => void;
  textarea?: boolean;
  options?: [string, string][];
  hint?: string;
  disabled?: boolean;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, textarea, options, hint, disabled }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <Label>{label}</Label>
    {options ? (
      <select className="x-select" value={value ?? ''} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    ) : textarea ? (
      <textarea
        className="x-input"
        style={{ minHeight: 88, resize: 'vertical', fontFamily: 'inherit' }}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    ) : (
      <input className="x-input" value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)} />
    )}
    {hint && <span style={{ fontSize: 11, color: 'var(--x-text-muted)' }}>{hint}</span>}
  </label>
);

const Group: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="x-card x-card--pad" style={{ marginBottom: 'var(--x-s4)' }}>
    <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{title}</h4>
    {hint && <p style={{ fontSize: 12, color: 'var(--x-text-muted)', margin: '4px 0 12px' }}>{hint}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginTop: hint ? 0 : 12 }}>
      {children}
    </div>
  </div>
);

/** Editor for a string[] — postal address lines, cautions, and the like. */
const LineList: React.FC<{ value: any; onChange: (v: string[]) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => {
  const arr: string[] = Array.isArray(value) ? value : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {arr.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input
            className="x-input"
            style={{ flex: 1 }}
            value={v}
            placeholder={placeholder}
            onChange={e => onChange(arr.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button className="x-btn" onClick={() => onChange(arr.filter((_, j) => j !== i))} title="Remove">✕</button>
        </div>
      ))}
      <button className="x-btn" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...arr, ''])}>+ Add line</button>
    </div>
  );
};

/** Preview + pick-from-Media + upload. Value is a stored `Media/x.png` path. */
const MediaPicker: React.FC<{
  label: string;
  value: any;
  media: string[];
  projectId: string;
  onChange: (v: string) => void;
  onUploaded: () => void;
}> = ({ label, value, media, projectId, onChange, onUploaded }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const missing = !!value && !media.includes(value);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await settingsApi.upload(projectId, f);
      onChange(r.path);
      onUploaded();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
      <Label>{label}</Label>
      {value && !missing ? (
        <img
          src={settingsApi.mediaUrl(projectId, value)}
          alt=""
          style={{ width: 72, height: 72, objectFit: 'contain', border: '1px solid var(--x-line)', borderRadius: 6, background: '#fff', padding: 4, alignSelf: 'center' }}
        />
      ) : (
        <div style={{
          width: 72, height: 72, display: 'grid', placeItems: 'center', alignSelf: 'center',
          border: '1px dashed var(--x-line)', borderRadius: 6, fontSize: 10,
          color: missing ? 'var(--x-error)' : 'var(--x-text-faint)', textAlign: 'center', padding: 4,
        }}>{missing ? 'missing' : 'none'}</div>
      )}

      <select className="x-select" value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="">— none —</option>
        {/* A value pointing at a file that is not in Media/ renders as nothing
            at all in the PDF, with no error — so keep it visible and flagged
            rather than silently dropping it from the list. */}
        {missing && <option value={value}>{value.replace('Media/', '')} (missing)</option>}
        {media.map(m => <option key={m} value={m}>{m.replace('Media/', '')}</option>)}
      </select>

      <button className="x-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : 'Upload…'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={upload} />
      {err && <span style={{ fontSize: 11, color: 'var(--x-error)' }}>{err}</span>}
    </div>
  );
};

// ── Screen ─────────────────────────────────────────────────────────────────

export const PublishSettings: React.FC = () => {
  const { activeProjectId } = useNavStore();

  const [data, setData] = useState<SettingsPayload | null>(null);
  const [house, setHouse] = useState<any>({});
  const [project, setProject] = useState<any>({});
  const [media, setMedia] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('Publication');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const loadMedia = useCallback(async () => {
    if (!activeProjectId) return;
    try { setMedia(await settingsApi.media(activeProjectId)); } catch { setMedia([]); }
  }, [activeProjectId]);

  const load = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const d = await settingsApi.get(activeProjectId);
      setData(d);
      setHouse(d.house ?? {});
      setProject(d.project ?? {});
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => { load(); loadMedia(); }, [load, loadMedia]);

  const setP = (path: string, v: unknown) => { setProject((p: any) => withPath(p, path, v)); setDirty(true); setNote(null); };

  /**
   * Save the project's publisher list, or clear it back to the template's.
   *
   * Storing an empty array is not the same as storing nothing: the build treats
   * a project list as a complete replacement for the template's, so `[]` blanks
   * the publishers entirely — and the joint title page then renders an empty
   * table row, which FOP rejects and the build produces no PDF at all. Removing
   * the last publisher therefore means "use the template's", which is also the
   * only reading that lets you undo an override.
   */
  const setPublishers = (list: any[]) => {
    setProject((p: any) => {
      const next = structuredClone(p ?? {});
      if (list.length === 0) delete next.publishers;
      else next.publishers = list;
      return next;
    });
    setDirty(true);
    setNote(null);
  };

  /** The list being edited: the project's override, else the template's. */
  const publishers: any[] = getPath<any[]>(project, 'publishers')
    ?? getPath<any[]>(house, 'branding.publishers')
    ?? [];
  const setH = (path: string, v: unknown) => { setHouse((h: any) => withPath(h, path, v)); setDirty(true); setNote(null); };

  const save = async () => {
    if (!activeProjectId) return;
    setSaving(true);
    setError(null);
    try {
      await settingsApi.save(activeProjectId, { house, project });
      setDirty(false);
      setNote('Saved. The next build will use these settings.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Front-matter page preferences are stored as an array of { id, enabled,
  // title }. A page absent from the array is on by default, so the editor has
  // to merge the saved list over the catalogue rather than read it directly.
  const pages = useMemo(() => {
    const saved: any[] = Array.isArray(project?.frontMatter?.pages) ? project.frontMatter.pages : [];
    const byId = new Map(saved.map(p => [p.id, p]));
    return (data?.frontMatterCatalogue ?? []).map((c: CataloguePage) => ({
      ...c,
      enabled: c.required ? true : byId.get(c.id)?.enabled !== false,
      customTitle: byId.get(c.id)?.title ?? '',
    }));
  }, [data, project]);

  const setPage = (id: string, patch: { enabled?: boolean; title?: string }) => {
    const saved: any[] = Array.isArray(project?.frontMatter?.pages) ? [...project.frontMatter.pages] : [];
    const i = saved.findIndex(p => p.id === id);
    const merged = { id, ...(i >= 0 ? saved[i] : {}), ...patch };
    if (i >= 0) saved[i] = merged; else saved.push(merged);
    setP('frontMatter.pages', saved);
  };

  if (!activeProjectId) {
    return <div className="x-page"><p className="x-page__sub">Select a project first.</p></div>;
  }

  return (
    <div className="x-page">
      <div className="x-page__head">
        <div className="x-page__title">
          <h1 className="x-display x-display--lg" style={{ margin: 0 }}>Publishing settings</h1>
          <p className="x-page__sub">
            Front matter, page layout and branding for the published book.
            {data && <> Template: <strong>{data.templateRef}</strong>.</>}
          </p>
        </div>
        <button className="x-btn" onClick={load} disabled={loading}>Reload</button>
        <button className="x-btn x-btn--primary" onClick={save} disabled={saving || !dirty || !data}>
          {saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
        </button>
      </div>

      {(error || note) && (
        <div className="x-card x-card--pad" style={{
          marginBottom: 'var(--x-s4)',
          borderColor: error ? 'var(--x-error-line)' : 'var(--x-ok-line)',
          background: error ? 'var(--x-error-bg)' : 'var(--x-ok-bg)',
        }}>
          <div style={{ fontSize: 12.5, color: error ? 'var(--x-error)' : 'var(--x-ok)' }}>{error ?? note}</div>
        </div>
      )}

      {loading ? (
        <div className="x-card x-card--pad" style={{ textAlign: 'center', color: 'var(--x-text-muted)' }}>Loading…</div>
      ) : !data ? (
        <div className="x-card x-card--pad" style={{ textAlign: 'center', color: 'var(--x-text-muted)' }}>
          No settings for this project.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--x-s4)', borderBottom: '1px solid var(--x-line)', overflowX: 'auto' }}>
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="x-btn"
                style={{
                  flex: 'none', whiteSpace: 'nowrap',
                  border: 'none', borderRadius: 0, background: 'none',
                  borderBottom: '2px solid',
                  borderBottomColor: tab === t ? 'var(--x-accent)' : 'transparent',
                  fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? 'var(--x-accent)' : 'var(--x-text-muted)',
                }}
              >{t}</button>
            ))}
          </div>

          {tab === 'Publication' && (
            <>
              <Group title="Publication" hint="Appears on the title pages and in page headers. Stored on this project.">
                <Field label="Book name"      value={getPath(project, 'publication.bookName')}      onChange={v => setP('publication.bookName', v)} />
                <Field label="System name"    value={getPath(project, 'publication.systemName')}    onChange={v => setP('publication.systemName', v)} />
                <Field label="Publication no" value={getPath(project, 'publication.publicationNo')} onChange={v => setP('publication.publicationNo', v)} />
                <Field label="INBR no"        value={getPath(project, 'publication.inbrNo')}        onChange={v => setP('publication.inbrNo', v)} />
                <Field label="NSN"            value={getPath(project, 'publication.nsn')}           onChange={v => setP('publication.nsn', v)} />
                <Field label="Contract no"    value={getPath(project, 'publication.contractNo')}    onChange={v => setP('publication.contractNo', v)} />
                <Field label="Project code"   value={getPath(project, 'publication.projectCode')}   onChange={v => setP('publication.projectCode', v)} />
                <Field label="Document no"    value={getPath(project, 'publication.ltDocumentNo')}  onChange={v => setP('publication.ltDocumentNo', v)} />
                <Field label="Code no (cover)" value={getPath(project, 'frontMatter.codeNo')}       onChange={v => setP('frontMatter.codeNo', v)} disabled={project?.pipeline === 's1000dtofo'} hint={project?.pipeline === 's1000dtofo' ? 'JSS book engine only' : undefined} />
                <Field label="Rev no (cover)"  value={getPath(project, 'frontMatter.revNo')}        onChange={v => setP('frontMatter.revNo', v)} disabled={project?.pipeline === 's1000dtofo'} hint={project?.pipeline === 's1000dtofo' ? 'JSS book engine only' : undefined} />
                <Field label="Month"          value={getPath(project, 'publication.month')}         onChange={v => setP('publication.month', v)} />
                <Field label="Year"           value={getPath(project, 'publication.year')}          onChange={v => setP('publication.year', v)} />
                <Field
                  label="Security classification"
                  value={getPath(project, 'publication.securityClassification') ?? 'RESTRICTED'}
                  onChange={v => setP('publication.securityClassification', v)}
                  options={SECURITY}
                  hint="Stamped verbatim on every page."
                />
              </Group>

              <Group title="Output">
                <Field
                  label="Image compression"
                  value={getPath(project, 'output.compression') ?? 0}
                  onChange={v => setP('output.compression', Number(v) || 0)}
                  hint="0-100. 0 leaves artwork untouched."
                />
              </Group>
            </>
          )}

          {tab === 'Front matter' && (
            <>
              <div className="x-card" style={{ marginBottom: 'var(--x-s4)', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--x-line)' }}>
                  <strong style={{ fontSize: 13 }}>Pages</strong>
                  <div style={{ fontSize: 12, color: 'var(--x-text-muted)', marginTop: 2 }}>
                    Which pages appear before the content, and in this order.
                  </div>
                </div>
                <table className="x-table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>On</th>
                      <th>Page</th>
                      <th style={{ width: '38%' }}>Title override</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map(p => (
                      <tr key={p.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={p.enabled}
                            disabled={p.required}
                            title={p.required ? 'This page is always included' : undefined}
                            onChange={e => setPage(p.id, { enabled: e.target.checked })}
                            style={{ accentColor: 'var(--x-accent)' }}
                          />
                        </td>
                        <td>
                          {p.label}
                          {p.required && <span className="x-pill x-pill--neutral" style={{ marginLeft: 6, fontSize: 10 }}>always on</span>}
                        </td>
                        <td>
                          <input
                            className="x-input"
                            style={{ width: '100%' }}
                            placeholder={p.title ?? '(no heading)'}
                            value={p.customTitle}
                            onChange={e => setPage(p.id, { title: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Group title="Proprietary notice" hint="Project-specific wording, overlaid on the template default.">
                <Field label="Applicability" textarea value={getPath(project, 'frontMatter.proprietary.applicability')} onChange={v => setP('frontMatter.proprietary.applicability', v)} />
                <Field label="Notice text"   textarea value={getPath(project, 'frontMatter.proprietary.text')}          onChange={v => setP('frontMatter.proprietary.text', v)} />
              </Group>

              <Group title="Foreword (template default)" hint="Shared by every project using this template.">
                <Field label="Text"  textarea value={getPath(house, 'frontMatterDefaults.foreword.text')}  onChange={v => setH('frontMatterDefaults.foreword.text', v)} />
                <Field label="Email"          value={getPath(house, 'frontMatterDefaults.foreword.email')} onChange={v => setH('frontMatterDefaults.foreword.email', v)} />
                <div style={{ gridColumn: '1 / -1' }}>
                  <Label>Postal address</Label>
                  <LineList value={getPath(house, 'frontMatterDefaults.foreword.postalAddress')} onChange={v => setH('frontMatterDefaults.foreword.postalAddress', v)} />
                </div>
              </Group>
            </>
          )}

          {tab === 'Layout' && (
            <>
              <div className="x-card x-card--pad" style={{ marginBottom: 'var(--x-s4)', background: 'var(--x-surface)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--x-text-muted)' }}>
                  These belong to the <strong>{data.templateRef}</strong> template and affect every
                  publication that uses it — not just this one.
                </div>
              </div>

              <Group title="Page">
                <Field label="Width"          value={getPath(house, 'layout.page.width')}          onChange={v => setH('layout.page.width', v)} />
                <Field label="Height"         value={getPath(house, 'layout.page.height')}         onChange={v => setH('layout.page.height', v)} />
                <Field label="Margin top"     value={getPath(house, 'layout.page.marginTop')}      onChange={v => setH('layout.page.marginTop', v)} />
                <Field label="Margin bottom"  value={getPath(house, 'layout.page.marginBottom')}   onChange={v => setH('layout.page.marginBottom', v)} />
                <Field label="Margin inner"   value={getPath(house, 'layout.page.marginInner')}    onChange={v => setH('layout.page.marginInner', v)} />
                <Field label="Margin outer"   value={getPath(house, 'layout.page.marginOuter')}    onChange={v => setH('layout.page.marginOuter', v)} />
                <Field label="Header extent"  value={getPath(house, 'layout.page.headerExtent')}   onChange={v => setH('layout.page.headerExtent', v)} />
                <Field label="Footer extent"  value={getPath(house, 'layout.page.footerExtent')}   onChange={v => setH('layout.page.footerExtent', v)} />
              </Group>

              <Group title="Fonts">
                <Field label="Family"            value={getPath(house, 'layout.fonts.family')}           onChange={v => setH('layout.fonts.family', v)} />
                <Field label="Body size"         value={getPath(house, 'layout.fonts.bodySize')}         onChange={v => setH('layout.fonts.bodySize', v)} />
                <Field label="Line height"       value={getPath(house, 'layout.fonts.lineHeight')}       onChange={v => setH('layout.fonts.lineHeight', Number(v) || v)} />
                <Field label="Header/footer"     value={getPath(house, 'layout.fonts.headerFooterSize')} onChange={v => setH('layout.fonts.headerFooterSize', v)} />
                <Field label="Table size"        value={getPath(house, 'layout.fonts.tableSize')}        onChange={v => setH('layout.fonts.tableSize', v)} />
                <Field label="Chapter title"     value={getPath(house, 'layout.chapterTitleSize')}       onChange={v => setH('layout.chapterTitleSize', v)} />
              </Group>

              {/*
                The security classification marking — "Restricted", "Secret".

                It used to follow "Header/footer" above and nothing else, so
                making the marking larger enlarged the folio and running head
                with it. Every field here is optional: left blank, the
                stylesheet default applies and the page renders exactly as it
                did before these existed.
              */}
              <Group title="Security marking">
                <Field label="Font size"   value={getPath(house, 'layout.classification.size')}         onChange={v => setH('layout.classification.size', v)}         hint="e.g. 12pt — blank follows header/footer" />
                <Field label="Font family" value={getPath(house, 'layout.classification.family')}       onChange={v => setH('layout.classification.family', v)}       hint="blank inherits the body font" />
                <Field label="Weight"      value={getPath(house, 'layout.classification.weight')}       onChange={v => setH('layout.classification.weight', v)}       hint="bold" />
                <Field label="Colour"      value={getPath(house, 'layout.classification.color')}        onChange={v => setH('layout.classification.color', v)}        hint="e.g. #B00020" />
                <Field label="Margin top"    value={getPath(house, 'layout.classification.marginTop')}    onChange={v => setH('layout.classification.marginTop', v)}    hint="e.g. 2mm" />
                <Field label="Margin bottom" value={getPath(house, 'layout.classification.marginBottom')} onChange={v => setH('layout.classification.marginBottom', v)} hint="e.g. 2mm" />
                <Field label="Margin left"   value={getPath(house, 'layout.classification.marginLeft')}   onChange={v => setH('layout.classification.marginLeft', v)}   hint="e.g. 0mm" />
                <Field label="Margin right"  value={getPath(house, 'layout.classification.marginRight')}  onChange={v => setH('layout.classification.marginRight', v)}  hint="e.g. 0mm" />
              </Group>

              <Group title="Paragraphs and figures">
                <Field label="Space after"        value={getPath(house, 'layout.paragraph.spaceAfter')}      onChange={v => setH('layout.paragraph.spaceAfter', v)} />
                <Field label="First-line indent"  value={getPath(house, 'layout.paragraph.firstLineIndent')} onChange={v => setH('layout.paragraph.firstLineIndent', v)} />
                <Field label="Figure caption gap" value={getPath(house, 'layout.figures.captionGap')}        onChange={v => setH('layout.figures.captionGap', v)} />
                <Field
                  label="Blank versos"
                  value={String(getPath(house, 'layout.blankVersos') ?? true)}
                  onChange={v => setH('layout.blankVersos', v === 'true')}
                  options={[['true', 'Yes — chapters start recto'], ['false', 'No']]}
                />
              </Group>
            </>
          )}

          {tab === 'Branding' && (
            <>
              <Group title="Emblem" hint="Shown on the title pages. Stored on the template.">
                <MediaPicker
                  label="Emblem"
                  value={getPath(house, 'branding.emblem')}
                  media={media}
                  projectId={activeProjectId}
                  onChange={v => setH('branding.emblem', v)}
                  onUploaded={loadMedia}
                />
                <MediaPicker
                  label="System image"
                  value={getPath(house, 'frontMatterDefaults.systemImage')}
                  media={media}
                  projectId={activeProjectId}
                  onChange={v => setH('frontMatterDefaults.systemImage', v)}
                  onUploaded={loadMedia}
                />
                <MediaPicker
                  label="First-aid image"
                  value={getPath(house, 'frontMatterDefaults.firstAidImage')}
                  media={media}
                  projectId={activeProjectId}
                  onChange={v => setH('frontMatterDefaults.firstAidImage', v)}
                  onUploaded={loadMedia}
                />
              </Group>

              <div className="x-card x-card--pad">
                <h4 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>Publishers</h4>
                <p style={{ fontSize: 12, color: 'var(--x-text-muted)', margin: '0 0 12px' }}>
                  Named on the "jointly prepared &amp; published by" title page. A project list
                  replaces the template's entirely — a joint title page is all-or-nothing.
                </p>
                {publishers.map((pub: any, i: number) => (
                  <div key={i} className="x-card x-card--pad" style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, display: 'grid', gap: 10 }}>
                        <Field
                          label={`Publisher ${i + 1} name`}
                          value={pub.name}
                          onChange={v => {
                            const list = [...publishers];
                            list[i] = { ...list[i], name: v };
                            setPublishers(list);
                          }}
                        />
                        <div>
                          <Label>Address lines</Label>
                          <LineList
                            value={pub.addressLines}
                            onChange={v => {
                              const list = [...publishers];
                              list[i] = { ...list[i], addressLines: v };
                              setPublishers(list);
                            }}
                          />
                        </div>
                      </div>
                      <MediaPicker
                        label="Logo"
                        value={pub.logo}
                        media={media}
                        projectId={activeProjectId}
                        onChange={v => {
                          const list = [...publishers];
                          list[i] = { ...list[i], logo: v };
                          setPublishers(list);
                        }}
                        onUploaded={loadMedia}
                      />
                      <button
                        className="x-btn"
                        onClick={() => {
                          const list = publishers.filter((_, j) => j !== i);
                          setPublishers(list);
                        }}
                      >Remove</button>
                    </div>
                  </div>
                ))}
                <button
                  className="x-btn"
                  onClick={() => {
                    const list = [...publishers];
                    setPublishers([...publishers, { name: '', addressLines: [], logo: '' }]);
                  }}
                >+ Add publisher</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

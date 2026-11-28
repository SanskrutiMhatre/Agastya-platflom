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
import { Icon } from '../../../components/Icon';
import { Callout, EmptyState, Loading, Pill } from '../../../components/ui';

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
  <span className="pp-flabel">{children}</span>
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
  <label className="field">
    <Label>{label}</Label>
    {options ? (
      <select className="select" value={value ?? ''} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    ) : textarea ? (
      <textarea
        className="input pp-area"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    ) : (
      <input className="input" value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)} />
    )}
    {hint && <span className="hint">{hint}</span>}
  </label>
);

const Group: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="card pp-group">
    <div className="card-head"><div><h3>{title}</h3>{hint && <p className="pp-detail-sub">{hint}</p>}</div></div>
    <div className="card-body pp-fields">
      {children}
    </div>
  </section>
);

/** Editor for a string[] — postal address lines, cautions, and the like. */
const LineList: React.FC<{ value: any; onChange: (v: string[]) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => {
  const arr: string[] = Array.isArray(value) ? value : [];
  return (
    <div className="pp-lines">
      {arr.map((v, i) => (
        <div key={i} className="pp-line">
          <input
            className="input"
            value={v}
            placeholder={placeholder}
            onChange={e => onChange(arr.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button type="button" className="icon-btn" onClick={() => onChange(arr.filter((_, j) => j !== i))} title="Remove" aria-label="Remove"><Icon name="close" size={14} /></button>
        </div>
      ))}
      <button type="button" className="btn sm pp-self-start" onClick={() => onChange([...arr, ''])}><Icon name="plus" size={14} />Add line</button>
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
    <div className="pp-media">
      <Label>{label}</Label>
      {value && !missing ? (
        <img
          src={settingsApi.mediaUrl(projectId, value)}
          alt=""
          className="pp-media-img"
        />
      ) : (
        <div className={`pp-media-img empty${missing ? ' missing' : ''}`}>{missing ? 'missing' : 'none'}</div>
      )}

      <select className="select" value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="">— none —</option>
        {/* A value pointing at a file that is not in Media/ renders as nothing
            at all in the PDF, with no error — so keep it visible and flagged
            rather than silently dropping it from the list. */}
        {missing && <option value={value}>{value.replace('Media/', '')} (missing)</option>}
        {media.map(m => <option key={m} value={m}>{m.replace('Media/', '')}</option>)}
      </select>

      <button type="button" className="btn sm" onClick={() => fileRef.current?.click()} disabled={busy} aria-busy={busy || undefined}>
        <Icon name="upload" size={14} />{busy ? 'Uploading…' : 'Upload…'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={upload} />
      {err && <span className="v2-error" role="alert">{err}</span>}
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
      // WP-11: the save names the version of the settings that was loaded; the answer carries the new one for the next save
      const r = await settingsApi.save(activeProjectId, { house, project, baseHash: data?.version ?? '' });
      setData((d) => (d ? { ...d, version: r.version } : d));
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
    return <EmptyState icon="settings" title="Select a project first" />;
  }

  return (
    <div className="pp-publish">
      {/* the section head inside the Settings tab: title and purpose on the left, Reload and Save on the right (the mockup page head, one level down) */}
      <div className="pp-sec-head">
        <div>
          <h2>Publishing settings</h2>
          <p>
            Front matter, page layout and branding for the published book.
            {data && <> Template: <strong>{data.templateRef}</strong>.</>}
          </p>
        </div>
        <div className="pp-actions">
          <button type="button" className="btn" onClick={load} disabled={loading}><Icon name="refresh" size={16} />Reload</button>
          <button type="button" className="btn primary" onClick={save} disabled={saving || !dirty || !data} aria-busy={saving || undefined}>
            <Icon name="save" size={16} />{saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
          </button>
        </div>
      </div>

      {(error || note) && (
        <div className="pp-gap"><Callout tone={error ? 'danger' : 'success'}>{error ?? note}</Callout></div>
      )}

      {loading ? (
        <div className="card"><Loading /></div>
      ) : !data ? (
        <div className="card"><EmptyState icon="settings" title="No settings for this project" /></div>
      ) : (
        <>
          {/* the parts of the publishing settings: the mockup's chips (as the S1000D configuration's sections) */}
          <div className="chips pp-subtabs pp-gap" role="group" aria-label="Publishing settings sections">
            {TABS.map(t => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`chip${tab === t ? ' on' : ''}`} aria-pressed={tab === t}>{t}</button>
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
              {/* WP-07 (DEP-027, PERF-019): "Image compression" is not offered. It needs Ghostscript, which is not shipped, so the setting
                  did nothing; the build still honours output.compression where an administrator provides Ghostscript (JSS_GS). */}
            </>
          )}

          {tab === 'Front matter' && (
            <>
              <section className="card pp-group">
                <div className="card-head"><div><h3>Pages</h3><p className="pp-detail-sub">Which pages appear before the content, and in this order.</p></div></div>
                <div className="table-wrap"><table className="table">
                  <thead>
                    <tr>
                      <th className="pp-tick">On</th>
                      <th>Page</th>
                      <th className="pp-title-col">Title override</th>
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
                            aria-label={`Include ${p.label}`}
                          />
                        </td>
                        <td>
                          {p.label}
                          {p.required && <> <Pill>always on</Pill></>}
                        </td>
                        <td>
                          <input
                            className="input"
                            aria-label={`Title override for ${p.label}`}
                            placeholder={p.title ?? '(no heading)'}
                            value={p.customTitle}
                            onChange={e => setPage(p.id, { title: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </section>

              <Group title="Proprietary notice" hint="Project-specific wording, overlaid on the template default.">
                <Field label="Applicability" textarea value={getPath(project, 'frontMatter.proprietary.applicability')} onChange={v => setP('frontMatter.proprietary.applicability', v)} />
                <Field label="Notice text"   textarea value={getPath(project, 'frontMatter.proprietary.text')}          onChange={v => setP('frontMatter.proprietary.text', v)} />
              </Group>

              <Group title="Foreword (template default)" hint="Shared by every project using this template.">
                <Field label="Text"  textarea value={getPath(house, 'frontMatterDefaults.foreword.text')}  onChange={v => setH('frontMatterDefaults.foreword.text', v)} />
                <Field label="Email"          value={getPath(house, 'frontMatterDefaults.foreword.email')} onChange={v => setH('frontMatterDefaults.foreword.email', v)} />
                <div className="field pp-span">
                  <Label>Postal address</Label>
                  <LineList value={getPath(house, 'frontMatterDefaults.foreword.postalAddress')} onChange={v => setH('frontMatterDefaults.foreword.postalAddress', v)} />
                </div>
              </Group>
            </>
          )}

          {tab === 'Layout' && (
            <>
              <div className="pp-gap"><Callout tone="warning">
                  These belong to the <strong>{data.templateRef}</strong> template and affect every
                  publication that uses it — not just this one.
              </Callout></div>

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
                {/* lint-colors-ignore: an example value in the hint of a print-colour field */}
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

              <section className="card pp-group">
                <div className="card-head"><div><h3>Publishers</h3><p className="pp-detail-sub">
                  Named on the "jointly prepared &amp; published by" title page. A project list
                  replaces the template's entirely — a joint title page is all-or-nothing.
                </p></div></div>
                <div className="card-body pp-form">
                {publishers.map((pub: any, i: number) => (
                  <div key={i} className="pp-publisher">
                    <div className="pp-publisher-row">
                      <div className="pp-publisher-main">
                        <Field
                          label={`Publisher ${i + 1} name`}
                          value={pub.name}
                          onChange={v => {
                            const list = [...publishers];
                            list[i] = { ...list[i], name: v };
                            setPublishers(list);
                          }}
                        />
                        <div className="field">
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
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          const list = publishers.filter((_, j) => j !== i);
                          setPublishers(list);
                        }}
                      ><Icon name="trash" size={14} />Remove</button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn sm pp-self-start"
                  onClick={() => {
                    setPublishers([...publishers, { name: '', addressLines: [], logo: '' }]);
                  }}
                ><Icon name="plus" size={14} />Add publisher</button>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
};

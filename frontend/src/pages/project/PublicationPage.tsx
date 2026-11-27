// Publication: arrange data modules into chapters and build the final manual.
//
// The tree logic (where a dropped chapter or module lands, without ever losing or duplicating one)
// is Agastya V1's pmcTree, reused and unit-tested; this screen is its interface: chapter cards with
// module rows and status, a searchable pool of modules not yet placed, drag-and-drop (with up/down
// buttons for keyboard users), and one clear place to save and build.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentApi, type DmSummary } from '../../api';
import { onlyRuleBreaks } from '../../lib/ruleBreaks';
import { confirmDialog } from '../../lib/dialogs';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { PublishRefusal } from '../../components/PublishRefusal';
import { Alert, Badge, Empty, Loading, PromptModal, Spinner, ago, errText, useAsync } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { useLeaveGuard } from '../../lib/leaveGuard';
import { useProgress } from '../../lib/progress';
import { countOf, dropTarget, getAt, insertAt, moveTo, removeAt, shiftBy, updateAt, type DropWhere, type Path, type PmEntry } from '../../lib/pmcTree';
import { pmcApi, poolToEntry } from '../../api/pmc';
import { refusalOf, type Refusal } from '../../lib/waivers';
import { PublishWaivers } from './PublishWaivers';
import { useUi } from '../../store/ui';
import { MoreRows, useProgressive } from '../../components/windowing';

const keyOf = (p: Path) => p.join('.');
const pathOf = (k: string) => k.split('.').map(Number);
const baseName = (href: string) => href.replace(/\\/g, '/').replace(/^.*\//, '').toLowerCase();
const dmcFrom = (a: Record<string, string> = {}) =>
  [a.modelIdentCode, a.systemDiffCode, a.systemCode, `${a.subSystemCode ?? ''}${a.subSubSystemCode ?? ''}`, a.assyCode, `${a.disassyCode ?? ''}${a.disassyCodeVariant ?? ''}`, `${a.infoCode ?? ''}${a.infoCodeVariant ?? ''}`, a.itemLocationCode].map((x) => x ?? '').join('-');

interface Described { title: string; sub: string; code: string; issue: string; found: boolean; file?: string }

function describe(e: PmEntry, byFile: Map<string, DmSummary>, byCode: Map<string, DmSummary>): Described {
  if (e.type === 'include') {
    const hit = byFile.get(baseName(e.href ?? ''));
    return hit ? { title: e.title || hit.techName || hit.file, sub: hit.infoName, code: hit.dmc, issue: `${hit.issueNumber}-${hit.inWork}`, found: true, file: hit.file }
      : { title: e.title || e.href || 'Missing module', sub: e.href ?? '', code: '', issue: '', found: false };
  }
  if (e.type === 'dm') {
    const code = dmcFrom((e as { dmCode?: Record<string, string> }).dmCode);
    const hit = byCode.get(code);
    return { title: e.title || (e as { techName?: string }).techName || hit?.techName || code, sub: (e as { infoName?: string }).infoName ?? hit?.infoName ?? '', code, issue: hit ? `${hit.issueNumber}-${hit.inWork}` : '', found: !!hit, file: hit?.file };
  }
  return { title: e.title || 'Annexure', sub: 'Another publication', code: '', issue: '', found: true };
}

interface DragState { from: string | null; pool: DmSummary | null; over: string | null; where: DropWhere | null }

export function PublicationPage() {
  const { id, role, can, summary, reload } = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const progress = useProgress(id);
  const data = useAsync(async () => ({ pm: await contentApi.pmc(id), dms: await contentApi.dms(id) }), [id]);
  const writable = canWrite(can);

  const [entries, setEntries] = useState<PmEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [undo, setUndo] = useState<PmEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'save' | 'build' | null>(null);
  const [rename, setRename] = useState<{ key: string; title: string } | null>(null);
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);   // the server's publish gate said no: what it found, and (for a missing BREX) the waiver
  const [waiverTick, setWaiverTick] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (data.data) { setEntries(data.data.pm.entries as PmEntry[]); setDirty(false); setUndo(null); } }, [data.data]);

  const dms = data.data?.dms ?? [];
  const byFile = useMemo(() => new Map(dms.map((d) => [d.file.toLowerCase(), d])), [dms]);
  const byCode = useMemo(() => new Map(dms.map((d) => [d.dmc, d])), [dms]);

  const placed = useMemo(() => {
    const files = new Set<string>();
    (function walk(list: PmEntry[]) { for (const e of list) { if (e.type === 'folder') walk(e.children ?? []); else { const d = describe(e, byFile, byCode); if (d.file) files.add(d.file); } } })(entries);
    return files;
  }, [entries, byFile, byCode]);
  const pool = useMemo(() => dms.filter((d) => !placed.has(d.file)).filter((d) => !q || `${d.techName} ${d.infoName} ${d.dmc} ${d.file}`.toLowerCase().includes(q.toLowerCase())), [dms, placed, q]);
  const poolDrawn = useProgressive(pool.length, q);       // WP-18 (FE-030): a large pool draws its first rows, more on scroll
  const counts = useMemo(() => countOf(entries), [entries]);
  const missing = useMemo(() => { let n = 0; (function walk(list: PmEntry[]) { for (const e of list) { if (e.type === 'folder') walk(e.children ?? []); else if (!describe(e, byFile, byCode).found) n++; } })(entries); return n; }, [entries, byFile, byCode]);

  const apply = useCallback((next: PmEntry[]) => { setUndo(entries); setEntries(next); setDirty(true); setError(''); }, [entries]);

  // ── editing ──────────────────────────────────────────────────────────────
  const addChapter = (title: string) => apply(insertAt(entries, [], entries.length, { type: 'folder', title, children: [] }));
  const target = (): { parentPath: Path; index: number } => {
    const sel = selected ? pathOf(selected) : null;
    const node = sel ? getAt(entries, sel) : undefined;
    return node?.type === 'folder' ? { parentPath: sel!, index: (node.children ?? []).length } : { parentPath: [], index: entries.length };
  };
  const addModule = (d: DmSummary) => {
    if (entries.length === 0) { setError('Add a chapter first, then place data modules in it.'); return; }
    const { parentPath, index } = target();
    apply(insertAt(entries, parentPath, index, poolToEntry({ file: d.file, techName: d.techName, infoName: d.infoName, dmCode: d.dmCodeAttrs, identExtension: d.identExtension, issueInfo: d.issueInfoAttrs, language: d.languageAttrs })));
  };
  const remove = (k: string) => { apply(removeAt(entries, pathOf(k)).entries); if (selected === k) setSelected(null); };
  const shift = (k: string, delta: -1 | 1) => { const next = shiftBy(entries, pathOf(k), delta); if (next !== entries) apply(next); };
  const onDrop = (key: string, where: DropWhere) => {
    if (!drag) return;
    const to = pathOf(key);
    const { parentPath, index } = dropTarget(entries, to, where);
    if (drag.pool) apply(insertAt(entries, parentPath, index, poolToEntry({ file: drag.pool.file, techName: drag.pool.techName, infoName: drag.pool.infoName, dmCode: drag.pool.dmCodeAttrs, identExtension: drag.pool.identExtension, issueInfo: drag.pool.issueInfoAttrs, language: drag.pool.languageAttrs })));
    else if (drag.from) { const next = moveTo(entries, pathOf(drag.from), parentPath, index); if (next !== entries) apply(next); }
    setDrag(null);
  };
  const zone = (ev: DragEvent, isFolder: boolean): DropWhere => {
    const r = ev.currentTarget.getBoundingClientRect(); const y = (ev.clientY - r.top) / r.height;
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : isFolder ? 'inside' : 'after';
  };

  const save = async (): Promise<boolean> => {
    setBusy('save'); setError('');
    try {
      const allowEmpty = counts.total === 0 && await confirmDialog({ title: 'Save an empty publication?', message: 'This saves a publication with no content. Continue?', confirmLabel: 'Save' });
      const r = await pmcApi.save(id, { meta: data.data!.pm.meta, entries }, allowEmpty, data.data!.pm.hash ?? 'new');      // WP-11: the version this screen loaded
      setDirty(false); setUndo(null);
      toast(`Saved: ${r.counts.dms} data module${r.counts.dms === 1 ? '' : 's'} in ${r.counts.folders} chapter${r.counts.folders === 1 ? '' : 's'}`, 'success');
      data.reload(); reload();
      return true;
    } catch (e) { setError(errText(e)); return false; } finally { setBusy(null); }
  };
  const [rulesOnly, setRulesOnly] = useState(false);
  const build = async (allowRuleBreaks = false) => {
    if (dirty && !(await save())) return;
    setBusy('build'); progress.clear(); setError(''); setRulesOnly(false); setRefusal(null);
    try { const r = await contentApi.build(id, undefined, allowRuleBreaks); toast(`Publication built in ${((r.totalMs ?? 0) / 1000).toFixed(1)} s${r.ruleBreaks?.length ? `, with ${r.ruleBreaks.length} business rule break${r.ruleBreaks.length === 1 ? '' : 's'} not fixed` : ''}`, 'success'); reload(); }
    catch (e) {
      // only broken business rules: the author may generate anyway. Any other gate refusal: list the findings, and offer the waiver for a missing BREX.
      const only = onlyRuleBreaks(e);
      const r = only ? null : refusalOf(e);
      if (r) setRefusal(r); else { setError(errText(e)); setRulesOnly(only); }
    } finally { setBusy(null); }
  };
  const importPm = async (file: File | undefined) => {
    if (!file) return;
    if (!(await confirmDialog({ title: 'Replace the publication?', message: `Replace this project's publication with "${file.name}"? The current one is kept as publication.xml.bak.`, confirmLabel: 'Replace', danger: true }))) { if (importRef.current) importRef.current.value = ''; return; }
    try { const r = await pmcApi.import(id, file); toast(`Imported ${r.counts.dms} modules in ${r.counts.folders} chapters${r.missingModules.length ? `; ${r.missingModules.length} not in this project` : ''}`, r.missingModules.length ? 'info' : 'success'); data.reload(); reload(); }
    catch (e) { setError(errText(e)); }
    if (importRef.current) importRef.current.value = '';
  };

  const guard = useLeaveGuard(dirty, { what: 'changes to the publication', save });

  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <div className="v2-page"><Alert tone="bad">{data.error || 'Could not read the publication.'}</Alert></div>;

  // ── render ───────────────────────────────────────────────────────────────
  const renderEntry = (e: PmEntry, path: Path, depth: number, number: string) => {
    const k = keyOf(path);
    const hint = drag?.over === k ? drag.where : null;
    if (e.type === 'folder') {
      const kids = e.children ?? [];
      const mods = countOf(kids).dms;
      return (
        <section key={k} className={`v2-chapter ${selected === k ? 'sel' : ''} ${hint === 'inside' ? 'drop-inside' : ''} ${hint === 'before' ? 'drop-before' : ''} ${hint === 'after' ? 'drop-after' : ''}`}
          style={depth ? { marginLeft: 18 } : undefined} data-testid="chapter" aria-label={`Chapter ${e.title}`}
          onDragOver={(ev) => { if (!drag || !writable) return; ev.preventDefault(); ev.stopPropagation(); const where = zone(ev, true); if (drag.over !== k || drag.where !== where) setDrag({ ...drag, over: k, where }); }}
          onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); onDrop(k, zone(ev, true)); }}>
          <header className="v2-chapter-head" draggable={writable} onClick={() => setSelected(selected === k ? null : k)}
            onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'move'; setDrag({ from: k, pool: null, over: null, where: null }); }} onDragEnd={() => setDrag(null)}>
            {writable ? <span className="v2-grip" aria-hidden="true">⋮⋮</span> : null}
            <span className="v2-chapter-no">{number}</span>
            <h3>{e.title || '(untitled chapter)'}</h3>
            <Badge>{mods} module{mods === 1 ? '' : 's'}</Badge>
            <span className="spacer" />
            {writable ? <>
              <button className="icon-btn" aria-label={`Move ${e.title} up`} title="Move up" onClick={(ev) => { ev.stopPropagation(); shift(k, -1); }}><Icon name="up" size={14} /></button>
              <button className="icon-btn" aria-label={`Move ${e.title} down`} title="Move down" onClick={(ev) => { ev.stopPropagation(); shift(k, 1); }}><Icon name="down" size={14} /></button>
              <button className="icon-btn" aria-label={`Rename ${e.title}`} title="Rename" onClick={(ev) => { ev.stopPropagation(); setRename({ key: k, title: e.title || '' }); }}><Icon name="edit" size={14} /></button>
              <button className="icon-btn" aria-label={`Remove ${e.title}`} title="Remove chapter (its modules return to the list)" onClick={(ev) => { ev.stopPropagation(); remove(k); }}><Icon name="trash" size={14} /></button>
            </> : null}
          </header>
          <div className="v2-chapter-body">
            {kids.length === 0 ? <div className="v2-chapter-empty">{writable ? 'Drop data modules here, or select this chapter and press Add on a module.' : 'No data modules in this chapter.'}</div> : kids.map((c, i) => renderEntry(c, [...path, i], depth + 1, `${number}.${i + 1}`))}
          </div>
        </section>
      );
    }
    const d = describe(e, byFile, byCode);
    return (
      <div key={k} className={`v2-mod ${!d.found ? 'missing' : ''} ${hint === 'before' ? 'drop-before' : ''} ${hint === 'after' ? 'drop-after' : ''}`} data-testid="pub-module" draggable={writable}
        onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'move'; ev.stopPropagation(); setDrag({ from: k, pool: null, over: null, where: null }); }} onDragEnd={() => setDrag(null)}
        onDragOver={(ev) => { if (!drag || !writable) return; ev.preventDefault(); ev.stopPropagation(); const where = zone(ev, false); if (drag.over !== k || drag.where !== where) setDrag({ ...drag, over: k, where }); }}
        onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); onDrop(k, zone(ev, false)); }}>
        {writable ? <span className="v2-grip" aria-hidden="true">⋮⋮</span> : null}
        <span className="v2-mod-no">{number}</span>
        <div className="v2-mod-main">
          <div className="v2-mod-title">{d.title}{!d.found ? <Badge tone="bad">not in project</Badge> : null}</div>
          <div className="v2-hint v2-trunc">{d.sub}</div>
        </div>
        <span className="v2-mono v2-mod-code">{d.code}</span>
        {d.issue ? <Badge>{d.issue}</Badge> : null}
        <span className="v2-mod-actions">
          {d.file ? <button className="icon-btn" aria-label={`Open ${d.title} in the editor`} title="Open in editor" onClick={() => nav(`../editor?file=${encodeURIComponent(d.file!)}`)}><Icon name="editor" size={14} /></button> : null}
          {writable ? <>
            <button className="icon-btn" aria-label={`Move ${d.title} up`} title="Move up" onClick={() => shift(k, -1)}><Icon name="up" size={14} /></button>
            <button className="icon-btn" aria-label={`Move ${d.title} down`} title="Move down" onClick={() => shift(k, 1)}><Icon name="down" size={14} /></button>
            <button className="icon-btn" aria-label={`Remove ${d.title} from the publication`} title="Remove from the publication" onClick={() => remove(k)}><Icon name="close" size={14} /></button>
          </> : null}
        </span>
      </div>
    );
  };

  const built = summary.build;
  return (
    <div className="v2-page">
      <PageHeader icon="book" title="Publication" sub={data.data.pm.meta?.pmTitle ? `“${data.data.pm.meta.pmTitle}”: arrange the chapters, then build the manual.` : 'Arrange data modules into chapters, then build the manual.'}
        actions={<>
          {writable ? <>
            <button className="btn" onClick={() => setNaming(true)} data-testid="add-chapter"><Icon name="plus" />Add chapter</button>
            <button className="btn" onClick={() => undo && (setEntries(undo), setUndo(null), setDirty(true))} disabled={!undo}>Undo</button>
          </> : null}
          <button className="btn btn-primary" onClick={() => void build(false)} disabled={busy !== null || !writable} data-testid="build-publication">{busy === 'build' ? <Spinner /> : <Icon name="rocket" />}Build publication</button>
        </>}
        stats={[
          { label: 'Chapters', value: counts.folders },
          { label: 'In the publication', value: counts.dms, tone: 'accent' },
          { label: 'Not placed', value: dms.length - placed.size, tone: dms.length - placed.size ? 'warn' : undefined },
          { label: 'Missing', value: missing, tone: missing ? 'bad' : undefined },
          { label: 'Last build', value: built ? ago(built.builtAt) : 'never', tone: built ? 'ok' : undefined },
        ]} />

      {dirty ? (
        <div className="v2-savebar" role="status" data-testid="unsaved-bar">
          <span><Icon name="alert" size={15} /> You have unsaved changes to the publication.</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => data.reload()}>Discard</button>
          <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy !== null} data-testid="save-publication">{busy === 'save' ? <Spinner /> : null}Save changes</button>
        </div>
      ) : null}
      {error ? <div style={{ marginBottom: 12 }}><Alert tone="bad">{error}</Alert>{rulesOnly ? <p className="v2-hint" style={{ margin: '6px 0 0' }}>Only business rules (BREX) are broken. You can still generate the PDF to look at it; it stays stamped NOT RELEASED and cannot be approved until the rules are met. <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => void build(true)} data-testid="generate-anyway">Generate anyway</button></p> : null}</div> : null}
      {refusal ? <div style={{ marginBottom: 12 }}><PublishRefusal refusal={refusal} projectId={id} can={can} mode="draft" onDismiss={() => setRefusal(null)} onRecorded={() => { setWaiverTick((t) => t + 1); void build(); }} /></div> : null}
      {missing > 0 ? <div style={{ marginBottom: 12 }}><Alert tone="warn"><strong>{missing} entr{missing === 1 ? 'y points' : 'ies point'} at data modules this project does not have</strong> — nothing is published for {missing === 1 ? 'it' : 'them'} until you import the module or remove the entry.</Alert></div> : null}
      {!writable ? <div style={{ marginBottom: 12 }}><Alert tone="warn">You have {role} access: you can look at the publication, but only editors, managers and owners can change or build it.</Alert></div> : null}

      <div className="v2-pub-grid">
        <div className="v2-pub-main" data-testid="pub-tree">
          {entries.length === 0 ? (
            <div className="v2-card"><Empty title="The publication is empty">{writable ? <>Add a chapter, then place data modules in it from the list on the right.<div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => setNaming(true)}><Icon name="plus" />Add the first chapter</button></div></> : 'Nothing has been placed in it yet.'}</Empty></div>
          ) : entries.map((e, i) => renderEntry(e, [i], 0, String(i + 1)))}
          {writable && entries.length > 0 ? <button className="v2-add-chapter" onClick={() => setNaming(true)}><Icon name="plus" size={15} />Add chapter</button> : null}
        </div>

        <aside className="v2-pub-side">
          <div className="v2-card" data-testid="pub-pool">
            <div className="v2-card-head"><span>Data modules not placed <Badge tone={dms.length - placed.size ? 'warn' : undefined}>{dms.length - placed.size}</Badge></span></div>
            <div style={{ padding: '10px 12px 4px' }}><input className="v2-input" placeholder="Search data modules…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search data modules not placed" /></div>
            {writable ? <div className="v2-hint" style={{ padding: '2px 14px 8px' }}>Adding to: <strong>{selected && getAt(entries, pathOf(selected))?.type === 'folder' ? (getAt(entries, pathOf(selected)) as { title: string }).title : 'select a chapter first'}</strong></div> : null}
            <div className="v2-pool">
              {pool.length === 0 ? <div className="v2-hint" style={{ padding: 14 }}>{dms.length - placed.size === 0 ? 'Every data module is in the publication.' : 'No data module matches.'}</div> : pool.slice(0, poolDrawn.limit).map((d) => (
                <div key={d.file} className="v2-pool-item" draggable={writable} data-testid="pool-item" onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'copy'; setDrag({ from: null, pool: d, over: null, where: null }); }} onDragEnd={() => setDrag(null)}>
                  <div style={{ minWidth: 0, flex: 1 }}><div className="v2-mod-title">{d.techName || d.file}</div><div className="v2-hint v2-trunc">{d.infoName}</div><div className="v2-mono v2-hint">{d.dmc}</div></div>
                  {writable ? <button className="btn btn-sm" onClick={() => addModule(d)} aria-label={`Add ${d.techName || d.file} to the selected chapter`}><Icon name="plus" size={13} />Add</button> : null}
                </div>
              ))}
              <MoreRows shown={poolDrawn.limit} total={pool.length} onMore={poolDrawn.more} onAll={poolDrawn.all} />
            </div>
          </div>

          <div className="v2-card v2-card-pad v2-stack">
            <strong>Output</strong>
            <div className="v2-hint">{built ? <>Last built {ago(built.builtAt)} · {(built.size / 1048576).toFixed(1)} MB</> : 'Not built yet.'}</div>
            <div className="v2-row wrap">
              {built ? <a className="btn btn-sm" href={contentApi.pdfUrl(id, true)}><Icon name="download" size={13} />Download PDF</a> : null}
              <button className="btn btn-sm" onClick={() => nav('../editor')}><Icon name="editor" size={13} />View in editor</button>
              <a className="btn btn-sm" href={pmcApi.exportUrl(id, 'pdf')}>Export PM</a>
              {writable ? <button className="btn btn-sm" onClick={() => importRef.current?.click()}><Icon name="upload" size={13} />Import PM…</button> : null}
              <input ref={importRef} type="file" accept=".xml,.XML" hidden onChange={(e) => void importPm(e.target.files?.[0])} />
            </div>
            {busy === 'build' && progress.lines.length ? <div className="v2-log" style={{ borderRadius: 8, border: '1px solid var(--border)' }}>{progress.lines.slice(-5).map((l, i) => <div key={i}>{l}</div>)}</div> : null}
          </div>
        </aside>
      </div>

      <PublishWaivers projectId={id} can={can} refreshKey={waiverTick} />
      {guard}

      {naming ? <PromptModal title="New chapter" label="Chapter title" confirmLabel="Add chapter" onClose={() => setNaming(false)} onSubmit={async (t) => { addChapter(t); }} /> : null}
      {rename ? <PromptModal title="Rename" label="Title" initial={rename.title} onClose={() => setRename(null)} onSubmit={async (t) => { apply(updateAt(entries, pathOf(rename.key), (x) => ({ ...x, title: t }) as PmEntry)); }} /> : null}
    </div>
  );
}

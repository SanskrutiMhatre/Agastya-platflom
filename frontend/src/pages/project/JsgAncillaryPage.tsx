// Ancillary pages of a JSG User Handbook: the pages before the body, in the order the filled handbook prints them.
//
// Left: a checklist - each page has a checkbox that says whether it is printed (the page's content stays in the file when it is switched off).
// Right: the selected page's content: the cover details, the certificate sentence, the associated handbooks, the amendments table, the warning lines, the demolition notice, the first-aid steps,
// the abbreviations, the preface, the do's and don'ts, the important points, and the system photos. Contents and the two lists are made from the document, so they only have a checkbox.
// Everything is saved into the handbook's XML (front matter), so the editor, the PDF and this page always agree.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { graphicsApi } from '../../api';
import { ApiError } from '../../api/client';
import { jsgApi } from '../../api/jsg';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Loading, Spinner, errText } from '../../components/ui';
import { canBuild, canWrite, useProject } from '../../layouts/ProjectShell';
import { newPara, text, type Front, type Inline, type JsgDoc, type Para } from '../../jsg/model';
import { coverCard } from '../../jsg/shared';
import { JsgParseError, parseJsg, serializeJsg } from '../../jsg/xml';
import { useUi } from '../../store/ui';
import { useLeaveGuard } from '../../lib/leaveGuard';
import { confirmDialog } from '../../lib/dialogs';

type Kind = 'always' | 'optional' | 'auto';
interface PageDef { id: string; label: string; kind: Kind; hint: string }

/** In print order (the filled handbook's). `cover` is not switched off; contents and the two lists are made from the document. */
const PAGES: PageDef[] = [
  { id: 'cover', label: 'Cover', kind: 'always', hint: 'The first page: document number, title, project, supplier, issuing authority, date and equipment life.' },
  { id: 'certificate', label: 'Certificate', kind: 'optional', hint: 'The sentence certifying the page count, then a signature block. {docNo}, {total}, {frontLast} and {mainLast} are filled in by the build.' },
  { id: 'associated', label: 'Associated handbooks', kind: 'optional', hint: 'The handbooks that belong with this one. A document number left empty joins the one above it.' },
  { id: 'amendments', label: 'Amendments', kind: 'always', hint: 'The table of amendments; empty rows are printed up to the number you set.' },
  { id: 'warning', label: 'Warning', kind: 'always', hint: 'Numbered warnings, printed in red.' },
  { id: 'demolition', label: 'Demolition of equipment', kind: 'always', hint: 'The demolition notice, printed in red. Leave it empty to print the stencil\'s sentence.' },
  { id: 'firstAid', label: 'First aid (electrical shock)', kind: 'always', hint: 'The steps on the first first-aid page. Leave it empty to print the stencil\'s two steps. The second first-aid page is the standard one.' },
  { id: 'abbreviations', label: 'Abbreviations', kind: 'always', hint: 'The abbreviations used; empty numbered rows are printed up to the number you set (the stencil has 37).' },
  { id: 'preface', label: 'Preface', kind: 'optional', hint: 'Numbered paragraphs.' },
  { id: 'dos', label: 'Do’s', kind: 'optional', hint: 'Numbered lines.' },
  { id: 'donts', label: 'Don’ts', kind: 'optional', hint: 'Numbered lines.' },
  { id: 'important', label: 'Important points', kind: 'optional', hint: 'Numbered lines.' },
  { id: 'photos', label: 'System photos', kind: 'optional', hint: 'Pictures of the system, each with a caption under it.' },
  { id: 'contents', label: 'Contents', kind: 'auto', hint: 'Made from the chapters and sections.' },
  { id: 'listOfFigures', label: 'List of figures', kind: 'auto', hint: 'Made from the captioned figures.' },
  { id: 'listOfTables', label: 'List of tables', kind: 'auto', hint: 'Made from the captioned tables.' },
];
/** The Illustrated Spare Parts List's ancillary pages, in the order the filled list prints them (each is followed by a blank verso). The contents is made from the plates and appendices. */
const PAGES_ISPL: PageDef[] = [
  { id: 'cover', label: 'Cover', kind: 'always', hint: 'The first page: document number, title, equipment, NSN, A/T or S/O number, date, supplier, issuing authority and equipment life.' },
  { id: 'certificate', label: 'Certificate', kind: 'optional', hint: 'The sentence certifying the page count, then the Date / Name / Designation / Group block. {docNo}, {total} and {mainLast} are filled in by the build.' },
  { id: 'preface', label: 'Preface', kind: 'optional', hint: 'Numbered paragraphs, lettered lists and continuation paragraphs. The stencil\u2019s standard wording is the starting text.' },
  { id: 'amendments', label: 'Amendments', kind: 'always', hint: 'The table of amendments; empty rows are printed up to the number you set (the stencil has 20).' },
  { id: 'abbreviations', label: 'Abbreviations', kind: 'always', hint: 'The abbreviations used, numbered in the order given.' },
  { id: 'supplied', label: 'List of equipment already supplied against AT/SO', kind: 'always', hint: 'Equipment of the same kind supplied before. With no rows the table prints one row reading "Nil", as the stencil does.' },
  { id: 'contents', label: 'Contents', kind: 'auto', hint: 'Made from the plates and appendices: one row each, with its page numbers.' },
];
const pagesFor = (type: string): PageDef[] => (type === 'ispl' ? PAGES_ISPL : PAGES);
const CERT_DEFAULT = 'Certified that this document no. {docNo} contains {total} pages which have been serially numbered from (i) to ({frontLast}) as ancillary pages and from 1 to {mainLast} as main content.';
const CERT_DEFAULT_ISPL = 'Certified that this document no. {docNo} contains {total} pages which have been serially numbered from (i) to (___) as ancillary pages and from 1 to {mainLast} as main content.';
const HAS_KEY: Record<string, keyof Front['has'] | null> = { certificate: 'certificate', associated: 'associated', amendments: null, warning: null, demolition: null, firstAid: null, abbreviations: null, preface: 'preface', dos: 'dos', donts: 'donts', important: 'important', photos: 'photos', contents: null, listOfFigures: null, listOfTables: null, cover: null, supplied: 'supplied' };

/** The text of some inline runs, with a line break as a new line. Marks are dropped (the text is kept; bold and italic come back only when the text is not edited). */
const toText = (runs: Inline[]): string => runs.map((r) => (r.t === 'text' ? r.text : r.t === 'br' ? '\n' : r.t === 'xref' ? toText(r.children) : toText(r.children))).join('');
/** The runs for edited text: unchanged text keeps its original runs (and so its bold and italic). */
const fromText = (s: string, original?: Inline[]): Inline[] => {
  if (original && toText(original) === s) return original;
  const out: Inline[] = []; s.split('\n').forEach((line, i) => { if (i) out.push({ t: 'br' }); if (line) out.push(...text(line)); });
  return out;
};

export function JsgAncillaryPage() {
  const { id, role, can } = useProject();
  const toast = useUi((s) => s.toast);
  const writable = canWrite(can);
  const [doc, setDoc] = useState<JsgDoc | null>(null);
  const [docType, setDocType] = useState<'uhb' | 'ispl'>('uhb');
  const list = pagesFor(docType);
  const [hash, setHash] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(0);                       // the document is edited in place; this redraws
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [sel, setSel] = useState('cover');
  const [pictures, setPictures] = useState<Array<{ src: string; name: string; url: string }>>([]);

  const load = useCallback(async () => {
    setError(''); setStale(false);
    try {
      const d = await jsgApi.read(id);
      if (d.docType !== 'uhb' && d.docType !== 'ispl') { setError('This project is not a JSG User Handbook or Illustrated Spare Parts List.'); return; }
      setDocType(d.docType); setDoc(parseJsg(d.xml)); setHash(d.hash); setDirty(false);
    } catch (e) { setError(e instanceof JsgParseError ? `The document cannot be opened here: ${e.message}` : errText(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void graphicsApi.list(id).then((l) => setPictures(l.map((g) => ({ src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) })))).catch(() => undefined); }, [id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const touch = useCallback(() => { setDirty(true); setTick((t) => t + 1); }, []);
  const front = doc?.front;
  const printed = (p: PageDef): boolean => {
    if (!front) return false;
    if (p.id === 'cover') return true;
    const k = HAS_KEY[p.id]; const present = k ? front.has[k] : true;
    return present && !front.omit.includes(p.id);
  };
  /** Switch a page on or off. A page that has no content yet gets some when it is switched on; a page switched off keeps its content. */
  const setPrinted = (p: PageDef, on: boolean): void => {
    if (!front) return;
    const f = front; const omit = new Set(f.omit);
    if (on) {
      omit.delete(p.id);
      const k = HAS_KEY[p.id];
      if (k && !f.has[k]) {
        f.has[k] = true;
        if (p.id === 'certificate') f.certificate = text(docType === 'ispl' ? CERT_DEFAULT_ISPL : CERT_DEFAULT);
        if (p.id === 'supplied' && !f.supplied) f.supplied = { equipment: '', rows: [] };
        if (p.id === 'preface') f.preface = [newPara('')];
        if (p.id === 'dos') f.dos = [[], [], [], [], []];
        if (p.id === 'donts') f.donts = [[], [], [], [], []];
        if (p.id === 'important') f.important = [[], [], [], [], []];
      }
    } else omit.add(p.id);
    f.omit = [...omit]; touch();
  };

  const save = async (): Promise<boolean> => {
    if (!doc || !writable) return true;
    setSaving(true);
    try {
      const out = await jsgApi.save(id, serializeJsg(doc), hash);
      setHash(out.hash); setDirty(false);
      toast(out.report.errors ? `Saved as a draft: ${out.report.errors} error${out.report.errors === 1 ? '' : 's'} to fix before a PDF can be built.` : 'Ancillary pages saved.', out.report.errors ? 'info' : 'success');
      return true;
    } catch (e) { if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') setStale(true); else toast(errText(e), 'error'); return false; }
    finally { setSaving(false); }
  };
  const preview = async (): Promise<void> => {
    if (!(await save())) return;
    setBuilding(true);
    try { const b = await jsgApi.build(id); toast(`PDF built in ${(b.totalMs / 1000).toFixed(1)} s.`, 'success'); window.open(`${jsgApi.pdfUrl(id)}?t=${Date.now()}`, '_blank', 'noopener'); }
    catch (e) { toast(errText(e), 'error'); } finally { setBuilding(false); }
  };

  const page = list.find((p) => p.id === sel) ?? list[0];
  const counts = useMemo(() => ({ on: list.filter(printed).length, off: list.filter((p) => !printed(p)).length }), [front, tick, list]);       // eslint-disable-line react-hooks/exhaustive-deps

  // GAP-001: a rail click, a link or Back with unsaved front matter asks first (the browser's own question for closing the tab is asked above)
  const guard = useLeaveGuard(dirty, { what: 'changes to the ancillary pages', save, unload: false });

  if (error) return <div className="v2-page"><Alert tone="bad">{error}</Alert></div>;
  if (!doc || !front) return <div className="v2-page"><Loading label="Opening the document…" /></div>;

  return (
    <div className="v2-page">
      {guard}
      <PageHeader icon="file" title="Ancillary pages"
        sub={`The pages before the ${docType === 'ispl' ? 'plates' : 'chapters'}, in the order of the filled ${docType === 'ispl' ? 'list' : 'handbook'}: tick the ones to print, and edit what each says. Save, then build the PDF to see them.`}
        actions={writable ? <>
          <button className="btn" disabled={building || saving || !canBuild(can)} onClick={() => void preview()} data-testid="jsg-anc-preview" title="Save, build the PDF and open it in a new tab">{building ? <Spinner /> : <Icon name="pdf" size={14} />}Save and preview PDF</button>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()} data-testid="jsg-anc-save">{saving ? <Spinner /> : <Icon name="check" size={14} />}Save{dirty ? ' changes' : ''}</button>
        </> : undefined}
        stats={[{ label: 'Printed', value: `${counts.on} of ${list.length}` }, { label: 'Left out', value: counts.off, tone: counts.off ? 'warn' : undefined }]} />
      {!writable ? <Alert tone="warn">You have {role} access to this project: you can read these pages, but changes cannot be saved.</Alert> : null}
      {stale ? <Alert tone="warn">Someone else saved this handbook after you opened it, so your save was refused. <button className="btn btn-sm" onClick={async () => { if (!dirty || await confirmDialog({ title: 'Reload the saved handbook?', message: 'Your unsaved changes will be lost.', confirmLabel: 'Reload', danger: true })) void load(); }}>Reload the saved handbook</button></Alert> : null}

      <div className="v2-anc" data-testid="jsg-ancillary">
        <div className="v2-card v2-anc-list" role="list" aria-label="Ancillary pages">
          <div className="v2-card-head"><span>Checklist, in print order</span>{dirty ? <Badge tone="warn">unsaved</Badge> : null}</div>
          {list.map((p, i) => {
            const on = printed(p); const empty = p.kind === 'optional' && !HAS_KEY[p.id] ? false : p.kind === 'optional' && !front.has[HAS_KEY[p.id] as keyof Front['has']];
            return (
              <div key={p.id} role="listitem" className={`v2-anc-row ${p.id === sel ? 'sel' : ''} ${on ? '' : 'off'}`} data-testid="jsg-anc-row" data-page={p.id}>
                <input type="checkbox" checked={on} disabled={!writable || p.id === 'cover'} aria-label={`Print ${p.label}`} data-testid="jsg-anc-print"
                  title={p.id === 'cover' ? 'The cover is always printed' : on ? 'Printed: untick to leave it out (its content is kept)' : empty ? 'This page is not in the handbook yet: tick to add it' : 'Not printed: tick to include it'}
                  onChange={(e) => setPrinted(p, e.target.checked)} />
                <button type="button" className="v2-anc-name" onClick={() => setSel(p.id)} aria-current={p.id === sel}>
                  <span className="n">{i + 1}</span><span className="t">{p.label}</span>
                  {p.kind === 'auto' ? <Badge title="Made from the document">automatic</Badge> : null}
                  {empty ? <Badge title="Not in this handbook yet">not added</Badge> : null}
                </button>
              </div>
            );
          })}
        </div>

        <div className="v2-card v2-anc-edit">
          <div className="v2-card-head" style={{ flexWrap: 'wrap' }}><strong>{page.label}</strong>{!printed(page) ? <Badge tone="warn">not printed</Badge> : null}</div>
          <div className="v2-card-pad v2-stack" data-testid="jsg-anc-editor">
            <p className="v2-hint" style={{ margin: 0 }}>{page.hint}</p>
            <PageEditor ispl={docType === 'ispl'} page={page} doc={doc} front={front} writable={writable} touch={touch} pictures={pictures} tick={tick} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── the editors ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface EditorProps { ispl: boolean; page: PageDef; doc: JsgDoc; front: Front; writable: boolean; touch: () => void; pictures: Array<{ src: string; name: string; url: string }>; tick: number }

function PageEditor({ ispl, page, doc, front, writable, touch, pictures }: EditorProps) {
  const ro = !writable;
  switch (page.id) {
    case 'cover': return <CoverEditor doc={doc} ro={ro} touch={touch} skip={ispl ? ['subtitle'] : ['qtyUnit']} />;
    case 'certificate': return front.has.certificate ? (
      <Field label="Certificate sentence">
        <textarea className="v2-input" rows={5} disabled={ro} value={toText(front.certificate ?? [])} data-testid="jsg-anc-certificate"
          onChange={(e) => { front.certificate = fromText(e.target.value, front.certificate ?? undefined); touch(); }} />
        <small className="v2-hint">Placeholders: <code>{'{docNo}'}</code> the document number, <code>{'{total}'}</code> the pages printed, <code>{'{frontLast}'}</code> the last ancillary page number, <code>{'{mainLast}'}</code> the last main page number.</small>
      </Field>) : <NotAdded />;
    case 'associated': return front.has.associated ? (
      <>
        <Field label="Sentence above the table"><input className="v2-input" disabled={ro} value={front.associatedIntro} onChange={(e) => { front.associatedIntro = e.target.value; touch(); }} placeholder="e.g. Modular Bridge System has following associated handbooks:" /></Field>
        <RowsEditor rows={front.associated} cols={[{ key: 'title', label: 'Document title', wide: true }, { key: 'docNo', label: 'Document No.' }, { key: 'remark', label: 'Remark' }]} blank={() => ({ title: '', docNo: '', remark: '' })} ro={ro} touch={touch} noun="handbook" />
      </>) : <NotAdded />;
    case 'amendments': if (ispl) return (
      <>
        <Field label="Rows printed (blank rows fill the table up to this many)"><input className="v2-input" type="number" min={0} max={60} style={{ maxWidth: 120 }} disabled={ro} value={front.amendmentsMinRows} onChange={(e) => { front.amendmentsMinRows = Math.max(0, Math.min(60, Number(e.target.value) || 0)); front.has.amendments = true; touch(); }} /></Field>
        <RowsEditor rows={front.amendments} cols={[{ key: 'no', label: 'Amendment No.' }, { key: 'authority', label: 'Authority', wide: true }, { key: 'date', label: 'Date of Amendment' }, { key: 'by', label: 'By Whom Amended' }]}
          blank={() => ({ no: '', page: '', para: '', required: '', authority: '', date: '', by: '' })} ro={ro} touch={() => { front.has.amendments = true; touch(); }} noun="amendment" />
      </>);
      return (
      <>
        <Field label="Rows printed (blank rows fill the table up to this many)"><input className="v2-input" type="number" min={0} max={60} style={{ maxWidth: 120 }} disabled={ro} value={front.amendmentsMinRows} onChange={(e) => { front.amendmentsMinRows = Math.max(0, Math.min(60, Number(e.target.value) || 0)); front.has.amendments = true; touch(); }} /></Field>
        <RowsEditor rows={front.amendments} cols={[{ key: 'no', label: 'S. No.' }, { key: 'page', label: 'Page No.' }, { key: 'para', label: 'Para ref.' }, { key: 'required', label: 'Amendment required', wide: true }, { key: 'authority', label: 'Authority with Ref. No. & date' }]}
          blank={() => ({ no: '', page: '', para: '', required: '', authority: '', date: '', by: '' })} ro={ro} touch={() => { front.has.amendments = true; touch(); }} noun="amendment" />
      </>);
    case 'warning': return <LinesEditor lines={front.warning} ro={ro} touch={() => { front.has.warning = true; touch(); }} noun="warning" />;
    case 'demolition': return <ParasEditor paras={front.demolition} ro={ro} touch={() => { front.has.demolition = true; touch(); }} noun="paragraph" empty="The stencil's sentence is printed: THE DEMOLITION OF THE EQUIPMENT WILL BE HELD ONLY ON THE ORDER OF THE COMMANDING OFFICER." />;
    case 'firstAid': return <LinesEditor lines={front.firstAid} ro={ro} touch={() => { front.has.firstAid = true; touch(); }} noun="step" multiline empty="The stencil's two steps are printed." />;
    case 'supplied': return (
      <>
        <Field label="Name of the equipment"><input className="v2-input" disabled={ro} value={front.supplied?.equipment ?? ''} placeholder="e.g. 100 Meter Infantry Foot Bridge Floating" onChange={(e) => { if (!front.supplied) front.supplied = { equipment: '', rows: [] }; front.supplied.equipment = e.target.value; front.has.supplied = true; touch(); }} /></Field>
        <RowsEditor rows={front.supplied?.rows ?? []} cols={[{ key: 'no', label: 'S. No.' }, { key: 'dcan', label: 'DCAN No. / NSN' }, { key: 'name', label: 'Name of Item', wide: true }, { key: 'order', label: 'Supply Order Details' }]}
          blank={() => ({ no: '', dcan: '', name: '', order: '' })} ro={ro} touch={() => { if (!front.supplied) front.supplied = { equipment: '', rows: [] }; front.has.supplied = true; touch(); }} noun="row" />
      </>);
    case 'abbreviations': return ispl ? (
      <RowsEditor rows={front.abbreviations} cols={[{ key: 'short', label: 'Abbreviation' }, { key: 'long', label: 'For', wide: true }]} blank={() => ({ short: '', long: '' })} ro={ro} touch={() => { front.has.abbreviations = true; touch(); }} noun="abbreviation" />
    ) : (
      <>
        <Field label="Numbered rows printed (empty rows fill the table up to this many)"><input className="v2-input" type="number" min={0} max={200} style={{ maxWidth: 120 }} disabled={ro} value={front.abbreviationsMinRows} onChange={(e) => { front.abbreviationsMinRows = Math.max(0, Math.min(200, Number(e.target.value) || 0)); front.has.abbreviations = true; touch(); }} /></Field>
        <RowsEditor rows={front.abbreviations} cols={[{ key: 'short', label: 'Abbreviation' }, { key: 'long', label: 'For', wide: true }]} blank={() => ({ short: '', long: '' })} ro={ro} touch={() => { front.has.abbreviations = true; touch(); }} noun="abbreviation" numbered />
      </>);
    case 'preface': if (ispl) return front.has.preface ? <IsplPreface front={front} ro={ro} touch={touch} /> : <NotAdded />;
      return front.has.preface ? <ParasEditor paras={front.preface.filter((p): p is Para => p.k === 'para')} all={front.preface} ro={ro} touch={touch} noun="paragraph" numbered /> : <NotAdded />;
    case 'dos': return front.has.dos ? <LinesEditor lines={front.dos} ro={ro} touch={touch} noun="line" /> : <NotAdded />;
    case 'donts': return front.has.donts ? <LinesEditor lines={front.donts} ro={ro} touch={touch} noun="line" /> : <NotAdded />;
    case 'important': return front.has.important ? <LinesEditor lines={front.important} ro={ro} touch={touch} noun="point" /> : <NotAdded />;
    case 'photos': return front.has.photos ? <PhotosEditor front={front} pictures={pictures} ro={ro} touch={touch} /> : <NotAdded />;
    default: return <p className="v2-hint" style={{ margin: 0 }}><Icon name="info" size={13} /> This page is made automatically from the document, so it has nothing to edit. Use the checkbox to print it or leave it out.</p>;
  }
}

/** The ISPL preface: numbered paragraphs (indent 2), continuation paragraphs (indent 3, no number) and lettered lists, each item one text. */
function IsplPreface({ front, ro, touch }: { front: Front; ro: boolean; touch: () => void }) {
  const blocks = front.preface; let n = 0;
  return (
    <div className="v2-stack" data-testid="jsg-anc-preface">
      {blocks.map((b, i) => {
        if (b.k === 'list') {
          return (
            <div key={i} className="v2-stack" style={{ marginLeft: 24, gap: 6 }}>
              {b.items.map((it, k) => {
                const first = it.parts[0] && (it.parts[0].k === 'text' || it.parts[0].k === 'para') ? it.parts[0] : null;
                return (
                  <div key={k} className="v2-row" style={{ alignItems: 'flex-start', gap: 8 }}>
                    <span className="v2-hint" style={{ width: 22, paddingTop: 7, flex: 'none' }}>({String.fromCharCode(97 + k)})</span>
                    <textarea className="v2-input" rows={2} style={{ flex: 1 }} disabled={ro} value={first ? toText(first.inline) : ''} aria-label={`List item ${k + 1}`}
                      onChange={(e) => { if (first) first.inline = fromText(e.target.value, first.inline); else it.parts.unshift({ k: 'text', inline: fromText(e.target.value) }); touch(); }} />
                    {!ro ? <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => { b.items.splice(k, 1); touch(); }}><Icon name="trash" size={13} /></button> : null}
                  </div>
                );
              })}
              {!ro ? <div className="v2-row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => { b.items.push({ parts: [{ k: 'text', inline: [] }] }); touch(); }}><Icon name="plus" size={13} />Add item</button>
                <button type="button" className="btn btn-sm" onClick={() => { blocks.splice(i, 1); touch(); }}><Icon name="trash" size={13} />Remove list</button>
              </div> : null}
            </div>
          );
        }
        if (b.k !== 'para') return null;
        const numbered = b.indent === 2; if (numbered) n++;
        return (
          <div key={i} className="v2-row" style={{ alignItems: 'flex-start', gap: 8 }}>
            <span className="v2-hint" style={{ width: 22, paddingTop: 7, flex: 'none' }}>{numbered ? `${n}.` : '•'}</span>
            <textarea className="v2-input" rows={Math.min(8, Math.max(2, Math.ceil(toText(b.inline).length / 80)))} style={{ flex: 1, height: 'auto' }} disabled={ro} value={toText(b.inline)} aria-label={`Preface paragraph ${i + 1}`}
              onChange={(e) => { b.inline = fromText(e.target.value, b.inline); touch(); }} />
            {!ro ? <span className="v2-row" style={{ gap: 2, flex: 'none' }}>
              <button type="button" className="icon-btn" aria-label={numbered ? 'Make a continuation paragraph' : 'Make a numbered paragraph'} title={numbered ? 'Continuation paragraph (no number)' : 'Numbered paragraph'} onClick={() => { b.indent = numbered ? 3 : 2; touch(); }}>{numbered ? '→' : '←'}</button>
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => { blocks.splice(i, 1); touch(); }}><Icon name="trash" size={13} /></button>
            </span> : null}
          </div>
        );
      })}
      {!ro ? <div className="v2-row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => { blocks.push(newPara('')); touch(); }}><Icon name="plus" size={13} />Add paragraph</button>
        <button type="button" className="btn btn-sm" onClick={() => { blocks.push({ k: 'list', type: 'alpha', indent: 3, items: [{ parts: [{ k: 'text', inline: [] }] }] }); touch(); }}><Icon name="plus" size={13} />Add (a) list</button>
      </div> : null}
    </div>
  );
}

const NotAdded = () => <p className="v2-hint" style={{ margin: 0 }}>This page is not in the handbook yet. Tick its box in the checklist to add it.</p>;
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="v2-anc-field"><span>{label}</span>{children}</label>; }

/** The cover details: the editor's own cover card (one input per field, the supplier and issuer lines), mounted here so it is the same control in both places. */
function CoverEditor({ doc, ro, touch, skip }: { doc: JsgDoc; ro: boolean; touch: () => void; skip: string[] }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = host.current; if (!el) return; el.innerHTML = ''; const card = coverCard(el, doc, ro, touch, skip); card.style.margin = '0'; card.style.border = '0'; card.style.background = 'transparent'; card.style.padding = '0'; return () => { el.innerHTML = ''; }; }, [doc, ro, touch]);
  // WP-07 (UX-018): the editor's cover card styled as platform fields (label above a full-width input, two columns where there is room)
  return <div ref={host} className="v2-jsg-cover" data-testid="jsg-anc-cover" />;
}

function Buttons({ i, n, move, remove, ro }: { i: number; n: number; move: (from: number, to: number) => void; remove: (i: number) => void; ro: boolean }) {
  if (ro) return null;
  return (
    <span className="v2-row" style={{ gap: 2, flex: 'none' }}>
      <button type="button" className="icon-btn" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="up" size={13} /></button>
      <button type="button" className="icon-btn" aria-label="Move down" title="Move down" disabled={i === n - 1} onClick={() => move(i, i + 1)}><Icon name="down" size={13} /></button>
      <button type="button" className="icon-btn" aria-label="Remove" title="Remove" onClick={() => remove(i)}><Icon name="trash" size={13} /></button>
    </span>
  );
}
const mover = <T,>(arr: T[], touch: () => void) => (from: number, to: number): void => { if (to < 0 || to >= arr.length) return; const [x] = arr.splice(from, 1); arr.splice(to, 0, x); touch(); };

/** Numbered lines of inline text (warnings, do's, steps ...). */
function LinesEditor({ lines, ro, touch, noun, multiline, empty }: { lines: Inline[][]; ro: boolean; touch: () => void; noun: string; multiline?: boolean; empty?: string }) {
  return (
    <div className="v2-stack" data-testid="jsg-anc-lines">
      {!lines.length && empty ? <p className="v2-hint" style={{ margin: 0 }}>{empty}</p> : null}
      {lines.map((l, i) => (
        <div key={i} className="v2-row" style={{ alignItems: 'flex-start', gap: 8 }}>
          <span className="v2-hint" style={{ width: 22, paddingTop: 7, flex: 'none' }}>{i + 1}.</span>
          {multiline
            ? <textarea className="v2-input" rows={2} style={{ flex: 1 }} disabled={ro} value={toText(l)} aria-label={`${noun} ${i + 1}`} onChange={(e) => { lines[i] = fromText(e.target.value, l); touch(); }} />
            : <input className="v2-input" style={{ flex: 1 }} disabled={ro} value={toText(l)} aria-label={`${noun} ${i + 1}`} onChange={(e) => { lines[i] = fromText(e.target.value, l); touch(); }} />}
          <Buttons i={i} n={lines.length} move={mover(lines, touch)} remove={(k) => { lines.splice(k, 1); touch(); }} ro={ro} />
        </div>
      ))}
      {!ro ? <div><button type="button" className="btn btn-sm" onClick={() => { lines.push([]); touch(); }}><Icon name="plus" size={13} />Add {noun}</button></div> : null}
    </div>
  );
}

/** Paragraphs (the preface, the demolition notice). `all` is the full list when `paras` is only its paragraphs. */
function ParasEditor({ paras, all, ro, touch, noun, numbered, empty }: { paras: Para[]; all?: unknown[]; ro: boolean; touch: () => void; noun: string; numbered?: boolean; empty?: string }) {
  const list = (all ?? paras) as Array<Para | { k: string }>;
  return (
    <div className="v2-stack" data-testid="jsg-anc-paras">
      {!paras.length && empty ? <p className="v2-hint" style={{ margin: 0 }}>{empty}</p> : null}
      {paras.map((p, i) => (
        <div key={i} className="v2-row" style={{ alignItems: 'flex-start', gap: 8 }}>
          {numbered ? <span className="v2-hint" style={{ width: 22, paddingTop: 7, flex: 'none' }}>{i + 1}.</span> : null}
          <textarea className="v2-input" rows={Math.min(8, Math.max(2, Math.ceil(toText(p.inline).length / 80)))} style={{ flex: 1, height: 'auto' }} disabled={ro} value={toText(p.inline)} aria-label={`${noun} ${i + 1}`} onChange={(e) => { p.inline = fromText(e.target.value, p.inline); touch(); }} />
          <Buttons i={i} n={paras.length} move={(from, to) => { const a = list.indexOf(paras[from]); const b = list.indexOf(paras[to]); if (a < 0 || b < 0) return; [list[a], list[b]] = [list[b], list[a]]; touch(); }} remove={(k) => { const at = list.indexOf(paras[k]); if (at >= 0) list.splice(at, 1); touch(); }} ro={ro} />
        </div>
      ))}
      {!ro ? <div><button type="button" className="btn btn-sm" onClick={() => { list.push(newPara('')); touch(); }}><Icon name="plus" size={13} />Add {noun}</button></div> : null}
    </div>
  );
}

/** A table of text cells (associated handbooks, amendments, abbreviations). */
function RowsEditor<R extends Record<string, string>>({ rows, cols, blank, ro, touch, noun, numbered }: { rows: R[]; cols: Array<{ key: string; label: string; wide?: boolean }>; blank: () => R; ro: boolean; touch: () => void; noun: string; numbered?: boolean }) {
  return (
    <div className="v2-stack" data-testid="jsg-anc-rows">
      <div style={{ overflowX: 'auto' }}>
        <table className="x-table" style={{ minWidth: 520 }}>
          <thead><tr>{numbered ? <th style={{ width: 36 }}>#</th> : <th style={{ width: 36 }}>#</th>}{cols.map((c) => <th key={c.key} style={c.wide ? { width: '45%' } : undefined}>{c.label}</th>)}{ro ? null : <th style={{ width: 96 }} />}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="v2-hint">{i + 1}</td>
                {cols.map((c) => <td key={c.key}><input className="v2-input" style={{ width: '100%' }} disabled={ro} value={r[c.key] ?? ''} aria-label={`${c.label}, row ${i + 1}`} onChange={(e) => { (r as Record<string, string>)[c.key] = e.target.value; touch(); }} /></td>)}
                {ro ? null : <td><Buttons i={i} n={rows.length} move={mover(rows, touch)} remove={(k) => { rows.splice(k, 1); touch(); }} ro={ro} /></td>}
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={cols.length + 2} className="v2-hint">No {noun} yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {!ro ? <div><button type="button" className="btn btn-sm" onClick={() => { rows.push(blank()); touch(); }}><Icon name="plus" size={13} />Add {noun}</button></div> : null}
    </div>
  );
}

/** The system photos: a picture of the project and the caption printed under it. */
function PhotosEditor({ front, pictures, ro, touch }: { front: Front; pictures: Array<{ src: string; name: string; url: string }>; ro: boolean; touch: () => void }) {
  const photos = front.photos;
  return (
    <div className="v2-stack" data-testid="jsg-anc-photos">
      {!photos.length ? <p className="v2-hint" style={{ margin: 0 }}>No pictures yet: the page prints "SYSTEM PHOTOS" only.</p> : null}
      {photos.map((g, i) => (
        <div key={i} className="v2-row" style={{ alignItems: 'flex-start', gap: 10 }}>
          <img src={pictures.find((p) => p.src === g.src)?.url ?? ''} alt="" style={{ width: 96, height: 64, objectFit: 'contain', background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 4, flex: 'none' }} />
          <div className="v2-stack" style={{ flex: 1, gap: 6 }}>
            <select className="v2-input" disabled={ro} value={g.src} aria-label={`Picture ${i + 1}`} onChange={(e) => { g.src = e.target.value; touch(); }}>
              {!pictures.some((p) => p.src === g.src) ? <option value={g.src}>{g.src} (not in this project)</option> : null}
              {pictures.map((p) => <option key={p.src} value={p.src}>{p.name}</option>)}
            </select>
            <input className="v2-input" disabled={ro} value={g.label ?? ''} placeholder="Caption printed under the picture" aria-label={`Caption ${i + 1}`} onChange={(e) => { g.label = e.target.value; touch(); }} />
          </div>
          <Buttons i={i} n={photos.length} move={mover(photos, touch)} remove={(k) => { photos.splice(k, 1); touch(); }} ro={ro} />
        </div>
      ))}
      {!ro ? <div><button type="button" className="btn btn-sm" disabled={!pictures.length} title={pictures.length ? '' : 'Add pictures to the project first (Graphics)'} onClick={() => { photos.push({ src: pictures[0].src, label: '' }); touch(); }}><Icon name="plus" size={13} />Add picture</button></div> : null}
    </div>
  );
}

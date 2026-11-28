// The editor page of a JSG document project: the JSG editor (src/jsg, independent of the JSS editor and of the S1000D Studio) beside the PDF the server builds from it.
//
// The document is one XML file, the project's source of truth. Saving writes that XML as the editor produces it; Generate saves, then asks the JSG engine on the server to
// build the PDF from the saved file (XML -> XSL-FO -> PDF), so what is shown is what the server renders, never a browser approximation.
//
// WP-21: the page is an adapter of the editor host (src/editors/host), like the JSS page: the host owns the header, save state, saving and refused
// saves, drafts, the leave guard, the layout, the palette, the shortcuts and focus mode. The JSG editors keep their own find bar (Ctrl+F, Ctrl+H).
//
// Phase 3 (P3-1): the document is edited live with everyone who has it open (src/collab/jsg.ts, docs/phase3/collab-jsg.md). The page joins the
// document's room once it is loaded and builds the editor from what the room holds; changes are saved continuously (Saved / Syncing… / Offline -
// changes kept locally), Save writes the file now and records a revision, a check-out is a lock ("Locked by"), comments pin to live words.
// When the room cannot be joined (no live service, an old server) the page edits and saves by version as before.

import { useEffect, useReducer, useRef, useState } from 'react';
import { graphicsApi } from '../../api';
import { jsgApi, type JsgDocument } from '../../api/jsg';
import { Icon } from '../../components/Icon';
import { ConvertButton, ExportProjectButton, useSectionCode } from '../../components/DocCodes';
import { Alert, ConfirmModal, Spinner, errText } from '../../components/ui';
import { useSession } from '../../store/session';
import type { LiveRoom } from '../../collab/client';
import type { JsgLive } from '../../collab/jsg';
import { canBuild, useProject } from '../../layouts/ProjectShell';
import { JsgEditor } from '../../jsg/editor';
import { IsplEditor } from '../../jsg/ispl-editor';
import { META_FIELDS, type JsgDoc } from '../../jsg/model';
import type { ElementInfo } from '../../editors/host/DocEditorShell';
import { QuickPreview } from '../../editors/host/ChromeControls';

/** what the Properties panel reads from the editor on show (the parts-list editor has no inspect(): the panel then says where the caret is) */
type Readable = { getDoc(): JsgDoc; inspect?: () => ElementInfo | null };
import type { GraphicInfo, JsgEditorLike } from '../../jsg/shared';
import { JsgParseError, parseJsg, serializeJsg } from '../../jsg/xml';
import { useUi } from '../../store/ui';
import { DocEditorShell } from '../../editors/host/DocEditorShell';
import { DocPdfPane } from '../../editors/host/DocPdfPane';
import { useDocEditor, type DocAdapter } from '../../editors/host/useDocEditor';
import { useEditorLayout } from '../../editors/host/useEditorLayout';

type LiveMod = typeof import('../../collab/jsg');
/** the live binding, loaded with the first live document (it brings Yjs) */
const liveModule = (): Promise<LiveMod> => import('../../collab/jsg');

const ADAPTER: DocAdapter<JsgDocument> = {
  kind: 'jsg',
  read: (id) => jsgApi.read(id),
  save: (id, xml, hash) => jsgApi.save(id, xml, hash),
  validate: (id, xml) => jsgApi.validate(id, xml),
  build: (id) => jsgApi.build(id),
  preview: (id) => jsgApi.preview(id),
  pdfUrl: (id, download) => jsgApi.pdfUrl(id, download),
  builtNote: (out) => `Built in ${((out.totalMs ?? 0) / 1000).toFixed(1)} s by the JSG engine`,
  findingsWhere: 'listed in the outline',
  parse: (xml) => { parseJsg(xml); },
  normalize: (xml) => serializeJsg(parseJsg(xml)),
  reloadProject: false,
};

export function JsgEditorPage() {
  const ctx = useProject(); const { id, can, summary } = ctx;
  const toast = useUi((s) => s.toast);
  const layout = useEditorLayout({ format: 'jsg', split: [30, 80, 58] });
  const host = useDocEditor(ctx, ADAPTER, layout);
  const { loaded, setLoaded, writable, dirty, saving, checking, building, savedAt, previewing } = host;
  const hostRef = useRef<HTMLDivElement>(null);
  const [importing, setImporting] = useState(false);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const wordInput = useRef<HTMLInputElement>(null);
  // PUB-023: autosave is on unless the author switched it off
  const [autosave, setAutosave] = useState(() => { try { return localStorage.getItem('agastya.jsg.autosave') !== '0'; } catch { return true; } });

  // Phase 3: the live room of the document (null: not joined yet, or edited by version); tried once per document
  const [live, setLiveRoom] = useState<{ room: LiveRoom; mod: LiveMod } | null>(null);
  const [liveTried, setLiveTried] = useState(false);
  const [roomWritable, setRoomWritable] = useState(false);
  const binding = useRef<JsgLive | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const hasLoaded = !!loaded;
  useEffect(() => {
    if (!hasLoaded || liveTried) return;
    let gone = false;
    const me = useSession.getState().user;
    void (async () => {
      let room: LiveRoom | null = null; let mod: LiveMod | null = null;
      if (me) {
        mod = await liveModule().catch(() => null);
        if (mod) {
          try { room = await mod.joinJsgRoom(id, { id: me.id, name: me.fullName || me.username }); }
          catch (e) { const code = (e as { code?: string }).code; if (code && !['DISABLED', 'NOT_SUPPORTED', 'TIMEOUT', 'BUSY'].includes(code)) console.warn('[live] not opened live:', code, (e as Error).message); room = null; }
        }
      }
      if (gone) { room?.close(false); return; }
      if (room && mod) { setRoomWritable(!!room.state?.writable); setLiveRoom({ room, mod }); }
      setLiveTried(true);
    })();
    return () => { gone = true; };
  }, [id, hasLoaded, liveTried]);
  const writableNow = live ? writable && roomWritable : writable;

  // FE-006 / PUB-023: the draft kept on this computer goes back into the editor (the editor is built again from it, and counts as unsaved)
  const recovered = useRef(false);
  const recover = () => {
    const d = host.draft.found; if (!d || !loaded) return;
    let draftDoc: JsgDoc;
    try { draftDoc = parseJsg(d.xml); } catch (e) { toast(`The draft cannot be opened: ${errText(e)}`, 'error'); return; }
    if (binding.current) { host.draft.dismiss(); binding.current.adopt(draftDoc); toast('Your unsaved changes are back and shared with the others in this document.', 'info'); return; }
    host.draft.dismiss(); recovered.current = true; setLoaded({ ...loaded, xml: d.xml });
    toast('Your unsaved changes are back. Save to keep them.', 'info');
  };

  // mount the editor once the document is here
  useEffect(() => {
    if (!loaded || !hostRef.current || !liveTried) return;
    let doc: JsgDoc;
    try { doc = live ? live.mod.modelOfRoom(live.room) : parseJsg(loaded.xml); }
    catch (e) { host.setError(e instanceof JsgParseError ? `The editor cannot open this document: ${e.message}` : errText(e)); return; }
    const Editor = doc.type === 'ispl' ? IsplEditor : JsgEditor;          // two document types, two editors; the page, the save and the PDF are the same
    const editor = new Editor(hostRef.current, {
      doc, readOnly: !writableNow,
      host: {
        graphics: async (): Promise<GraphicInfo[]> => (await graphicsApi.list(id)).map((g) => ({ src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) })),
        uploadGraphic: async (file: File): Promise<GraphicInfo> => {
          const out = await graphicsApi.upload(id, [file], 'symbol');
          const name = out.added[0]; const g = out.graphics.find((x) => x.name === name) ?? out.graphics[0];
          return { src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) };
        },
        imageUrl: (s) => graphicsApi.url(id, s.split('/').pop() ?? s),
        onDirty: (d) => { if (!binding.current) host.setDirty(d); },
        onSaveRequested: () => { void host.save(); },
        onCheckRequested: () => { void host.check(); },
        notify: (m, kind) => toast(m, kind === 'error' ? 'error' : 'info'),
      },
    });
    host.editorRef.current = editor; editor.setFindings(loaded.report.findings);
    let bound: JsgLive | null = null;
    const me = useSession.getState().user;
    if (live && me) {
      // live: the editor is bound to the room; the save state, "unsaved" and Save are the room's
      const room = live.room;
      const follow = () => { host.setLive(room.status); host.setDirty(room.unacknowledged > 0); bump(); };
      bound = new live.mod.JsgLive(editor, room, { id: me.id, name: me.fullName || me.username }, {
        changed: follow,
        toast: (m, kind) => toast(m, kind === 'warning' ? 'info' : kind),
        writable: (w) => setRoomWritable(w),
      });
      binding.current = bound;
      host.liveRef.current = { flush: (revision) => room.flush(revision) };
      follow();
    } else if (recovered.current) { recovered.current = false; editor.markDirty(); } else host.setDirty(editor.isDirty());
    return () => {
      if (bound) { bound.close(); binding.current = null; host.liveRef.current = null; }
      editor.destroy(); host.editorRef.current = null;
    };
    // the editor is built once per loaded document (and again when this person's right to change the live document changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, id, writableNow, live, liveTried]);
  // leaving the page (or the project) leaves the room; its unacknowledged changes stay in this browser for the next visit
  useEffect(() => {
    if (!live) return;
    return () => { live.room.close(); host.setLive(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  const roomState = live?.room.state ?? null;
  const lockBanner = live && roomState && !roomState.writable && roomState.reason
    ? <Alert tone="warn"><span data-testid="collab-lock" role="status">{roomState.reason}</span></Alert> : null;

  // the sections' document codes beside their headings, when the author has switched them on (on the Publication page; a User Handbook; a parts list has no sections of this kind)
  const sectionCode = useSectionCode(id, savedAt);
  // the editor is built again when the room is joined or the right to change it changes (the mount effect's deps): it gets the codes again then
  useEffect(() => { (host.editorRef.current as JsgEditorLike | null)?.setSectionBadge?.(loaded?.docType === 'uhb' ? sectionCode : undefined); }, [sectionCode, loaded, host.editorRef, live, liveTried, writableNow]);

  // Auto-save: a minute after the last change, when the author has asked for it. A save that fails (someone else saved, or the document is broken) is not repeated by it.
  useEffect(() => { try { localStorage.setItem('agastya.jsg.autosave', autosave ? '1' : '0'); } catch { /* private mode */ } }, [autosave]);
  useEffect(() => {
    if (live || !autosave || !dirty || !writable || saving) return;     // a live document is saved continuously
    const t = setTimeout(() => { void host.save(); }, 60_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave, dirty, writable, saving, savedAt, live]);

  /** Replace the handbook with a Word file written in the JSG styles (asked first in the platform's dialog, GAP-002). */
  const importWord = async (file: File) => {
    setImporting(true);
    try {
      const r = await jsgApi.importDocx(id, file);
      toast(`Imported ${r.import.chapters} chapters, ${r.import.sections} sections, ${r.import.tables} tables and ${r.pictures} pictures from Word${r.import.skipped.length ? ` (${r.import.skipped.length} item${r.import.skipped.length === 1 ? '' : 's'} could not be imported)` : ''}.`, 'success');
      if (r.report.errors) toast(`The imported handbook has ${r.report.errors} error${r.report.errors === 1 ? '' : 's'} to fix before a PDF can be built.`, 'info');
      await host.load(); ctx.reload();
    } catch (e) { toast(errText(e), 'error'); } finally { setImporting(false); }
  };

  // the last built PDF, if there is one, is shown at first
  useEffect(() => {
    let live = true;
    void fetch(jsgApi.pdfUrl(id), { method: 'HEAD', credentials: 'same-origin' }).then((r) => { if (live && r.ok) host.setSrc(`${jsgApi.pdfUrl(id)}?t=${Date.now()}`); }).catch(() => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (<>
    <DocEditorShell kind="jsg" projectId={id} can={can} role={ctx.role} shortcuts={loaded && parseKind(loaded.xml) === 'ispl' ? 'jsg-ispl' : 'jsg'} layout={layout} title={summary.project.name} hostRef={hostRef} loaded={!!loaded} find={false} readOnly={!writableNow}
      crumb={loaded ? <span className="v2-badge accent" title={`JSG document type ${loaded.docType}, from the stencil ${loaded.stencil}`}>JSG · {loaded.label}</span> : null}
      saveState={host.saveState} guard={host.guard} banners={<>{lockBanner}{host.banners(recover)}</>}
      live={!!live} commentsFile={live ? live.mod.JSG_COMMENTS_FILE : undefined}
      pinning={live ? { anchor: () => binding.current?.commentAnchor() ?? null, reveal: (_f, a) => binding.current?.reveal(a) ?? false } : undefined}
      docName={loaded?.label ?? undefined} findings={host.findings}
      inspect={() => (host.editorRef.current as Readable | null)?.inspect?.() ?? null}
      identity={() => { const m = (host.editorRef.current as Readable | null)?.getDoc().meta ?? {}; return META_FIELDS.filter((f) => m[f.key]).map((f) => [f.label, m[f.key]] as [string, string]); }}
      meta={loaded ? [['Type', `JSG · ${loaded.label}`], ['Type code', <span className="mono">{loaded.docType}</span>], ['Stencil', <span className="mono">{loaded.stencil}</span>], ['Auto-save', live ? 'Live: every change is saved' : writable ? (autosave ? 'On' : 'Off') : 'Not available']] : []}
      section={loaded ? <span>JSG</span> : undefined}
      topActions={<>
        <button className="btn" onClick={() => void host.check()} disabled={!loaded || checking} data-testid="jsg-check" title="Check the document for problems without saving or building">{checking ? <Spinner /> : <Icon name="shield" size={16} className="ico" />}Check</button>
        <QuickPreview onRun={() => void host.preview()} busy={previewing} disabled={!canBuild(can) || building || !loaded} testId="jsg-quick-preview" autoTestId="jsg-preview-auto" auto={host.autoPreview} setAuto={host.setAutoPreview}
          title={!canBuild(can) ? 'Reviewers, editors and owners can preview the PDF' : 'Save, then render this document as a draft PDF beside the editor (not the document build: nothing is released or recorded)'} />
        <button className="btn primary" onClick={() => void host.generate()} disabled={!canBuild(can) || building || previewing || !loaded} data-testid="jsg-generate" title={!canBuild(can) ? 'Reviewers, editors and owners can build the PDF' : 'Save, then build the document as a PDF'}>{building ? <Spinner /> : <Icon name="play" size={16} className="ico" />}{building ? 'Building…' : 'Generate PDF'}</button>
      </>}
      actions={<>
        {loaded?.docType === 'uhb' && writableNow ? <>
          <input ref={wordInput} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden data-testid="jsg-word-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setWordFile(f); }} />
          <button className="btn btn-sm" onClick={() => wordInput.current?.click()} disabled={importing || saving || building} data-testid="jsg-import-word" title="Replace this handbook with a Word file written in the JSG styles (Section, Heading 1-5, L2-L5 paragraphs, Caption ...)">{importing ? <Spinner /> : <Icon name="upload" size={12} />}Import Word…</button>
        </> : null}
        {writable ? <label className="v2-row v2-edautosave" title="Save by itself a minute after the last change"><input type="checkbox" checked={autosave} disabled={!!live} onChange={(e) => setAutosave(e.target.checked)} data-testid="jsg-autosave" />Auto-save</label> : null}
        <button className="btn btn-sm" onClick={() => void host.save()} disabled={!writable || (!dirty && !live) || saving} data-testid="jsg-save" title={!writable ? 'You have read-only access' : live ? 'Every change is saved as you type; Save writes the file now and records a version in the history (Ctrl+S)' : !dirty ? 'Nothing to save' : 'Save the document (Ctrl+S)'}>{saving ? <Spinner /> : <Icon name="check" size={12} />}Save</button>
        {loaded?.docType === 'uhb' ? <ConvertButton id={id} from="jsg" name={summary.project.name} dirty={dirty} saveFirst={host.save} /> : null}
        <ExportProjectButton id={id} dirty={dirty} saveFirst={host.save} />
      </>}
      pdf={<DocPdfPane kind="jsg" src={host.src} downloadHref={jsgApi.pdfUrl(id, true)} downloadName={`${summary.project.name}.pdf`} builtBy="the JSG engine" what="the document"
        note={host.note} building={building} progressLines={host.progress.lines} shown={host.shown} projectId={id} />} />
    {wordFile ? <ConfirmModal title="Replace this handbook?" danger confirmLabel="Replace with the Word file"
      body={<p>Replace this handbook with “{wordFile.name}”? The whole document and its front matter are replaced by what the Word file contains (its pictures are added to the project). The handbook as it is now is kept in the project folder as jsg-document.before-import.bak.</p>}
      onClose={() => setWordFile(null)} onConfirm={() => { const f = wordFile; setWordFile(null); void importWord(f); }} /> : null}
  </>);
}

/** The document type the XML declares (`<jsgdoc type="...">`), without parsing the whole document. */
const parseKind = (xml: string): string => /<jsgdoc\b[^>]*\btype="([^"]+)"/.exec(xml)?.[1] ?? '';

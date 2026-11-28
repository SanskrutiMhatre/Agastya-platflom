// The editor page of a JSS document project: the JSS editor (src/jss, independent of the S1000D Studio) beside the PDF the server builds from it.
//
// The document is one XML file, the project's source of truth. Saving writes that XML as the editor produces it; Generate saves, then asks the server to
// build the PDF from the saved file through the JSS pipeline (XML -> XSL-FO -> PDF), so what is shown is what the server renders, never a browser approximation.
//
// WP-21: the page is an adapter of the editor host (src/editors/host): the host owns the header, save state, saving and refused saves, drafts,
// the leave guard, the layout, the palette, the shortcuts, the find bar and focus mode; this page says how to build the JSS editor and what its
// header offers.

import { useEffect, useMemo, useRef, useState } from 'react';
import { contentApi, graphicsApi } from '../../api';
import { jssApi, type JssDocument } from '../../api/jss';
import { Icon } from '../../components/Icon';
import { Alert, Spinner, errText } from '../../components/ui';
import { canBuild, useProject } from '../../layouts/ProjectShell';
import { JssEditor, type GraphicInfo } from '../../jss/editor';
import { META_FIELDS, type JssDoc } from '../../jss/model';
import { QuickPreview } from '../../editors/host/ChromeControls';
import { JssParseError, parseJss, serializeJss } from '../../jss/xml';
import { PackagePanel } from '../../jss/PackagePanel';
import { ConvertButton, ExportProjectButton, useSectionCode } from '../../components/DocCodes';
import { useUi } from '../../store/ui';
import { DocEditorShell } from '../../editors/host/DocEditorShell';
import { DocPdfPane } from '../../editors/host/DocPdfPane';
import { useDocEditor, type DocAdapter } from '../../editors/host/useDocEditor';
import { useEditorLayout } from '../../editors/host/useEditorLayout';
import { useSession } from '../../store/session';
// Phase 3 (P3-1): the live binding (and Yjs) loads with the first live JSS document, not with this page
import type { LiveJss } from '../../jss/live';
const liveModule = () => import('../../jss/live');
/** The JSS document in review comments (its room's kind and name). */
const COMMENT_FILE = 'jss/book';

const ADAPTER: DocAdapter<JssDocument> = {
  kind: 'jss',
  read: (id) => jssApi.read(id),
  save: (id, xml, hash) => jssApi.save(id, xml, hash),
  validate: (id, xml) => jssApi.validate(id, xml),
  build: (id) => contentApi.build(id),
  preview: (id) => jssApi.preview(id),
  pdfUrl: (id, download) => contentApi.pdfUrl(id, download),
  builtNote: (out) => `Built in ${((out.totalMs ?? 0) / 1000).toFixed(1)} s${out.releaseLabel ? ` · ${out.releaseLabel}` : ' · stamped NOT RELEASED'}`,
  findingsWhere: 'listed below the page',
  parse: (xml) => { parseJss(xml); },
  normalize: (xml) => serializeJss(parseJss(xml)),
  reloadProject: true,
};

export function JssEditorPage() {
  const ctx = useProject(); const { id, can, summary } = ctx;
  const toast = useUi((s) => s.toast);
  const layout = useEditorLayout({ format: 'jss', split: [30, 80, 58] });
  const host = useDocEditor(ctx, ADAPTER, layout);
  const { loaded, writable, dirty, saving, checking, building, previewing } = host;
  const hostRef = useRef<HTMLDivElement>(null);
  const me = useSession((s) => s.user);
  // Phase 3 (P3-1): the document is edited live by default (several authors at once, saved continuously); the classic save by version
  // stays for a server with live editing off and for a document the room cannot open (docs/phase3/collab-jss.md)
  const liveRef = useRef<LiveJss | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [lock, setLock] = useState<string | null>(null);

  // mount the editor once the document is here
  useEffect(() => {
    if (!loaded || !hostRef.current) return;
    const mount = hostRef.current;
    let cancelled = false; let editor: JssEditor | null = null; let live: LiveJss | null = null; let checkTimer = 0;
    const user = me ? { id: me.id, name: me.fullName || me.username } : null;
    const build = (doc: JssDoc, readOnly: boolean): JssEditor => new JssEditor(mount, {
      doc, maxDepth: loaded.maxDepth, readOnly,
      chapterRule: loaded.chapterRule, sectionsFixed: loaded.sectionsFixed, tableTemplates: loaded.tableTemplates, chapterStarter: loaded.chapterStarter,
      host: {
        graphics: async (): Promise<GraphicInfo[]> => (await graphicsApi.list(id)).map((g) => ({ src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) })),
        uploadGraphic: async (file: File): Promise<GraphicInfo> => {
          const out = await graphicsApi.upload(id, [file], 'symbol');
          const name = out.added[0]; const g = out.graphics.find((x) => x.name === name) ?? out.graphics[0];
          return { src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) };
        },
        imageUrl: (s) => graphicsApi.url(id, s.split('/').pop() ?? s),
        // live: "unsaved" is what the server has not acknowledged yet (the room says), not the editor's flag
        onDirty: (d) => host.setDirty(live ? live.unacknowledged > 0 : d),
        onChange: (at) => live?.local(at),
        onSaveRequested: () => { void host.save(); },
        onCheckRequested: () => { void host.check(); },
        notify: (m, kind) => toast(m, kind === 'error' ? 'error' : 'info'),
      },
    });
    const classic = () => {
      let doc;
      try { doc = parseJss(loaded.xml); }
      catch (e) {
        host.setError(e instanceof JssParseError
          ? (/root element is <pm>/.test(e.message)
            ? 'This project holds an imported package, not an editable document. Press "Import project" above and choose the project .zip again to turn it into an editable document.'
            : `The editor cannot open this document: ${e.message}`)
          : errText(e));
        return;
      }
      editor = build(doc, !writable);
      host.editorRef.current = editor; host.setDirty(editor.isDirty()); editor.setFindings(loaded.report.findings);          // a freshly loaded document has nothing unsaved
    };
    void (async () => {
      let room: Awaited<ReturnType<Awaited<ReturnType<typeof liveModule>>['joinJss']>> | null = null;
      const mod = user ? await liveModule().catch(() => null) : null;
      if (mod && user) {
        try { room = await mod.joinJss(id, user); }
        catch (e) { const code = (e as { code?: string }).code; if (code && !['DISABLED', 'NOT_SUPPORTED', 'TIMEOUT', 'BUSY'].includes(code)) console.warn('[live] JSS not opened live:', code, (e as Error).message); room = null; }
      }
      if (cancelled) { room?.close(); return; }
      if (!room || !mod || !user) { classic(); return; }
      const opened = room;
      const refresh = () => {
        const l = liveRef.current; if (!l || l !== live) return;
        host.setLive(l.status); host.setDirty(l.unacknowledged > 0);
        setLock(l.state && !l.state.writable ? (l.state.reason ?? 'You cannot change this document now.') : null);
      };
      try {
        live = new mod.LiveJss(opened, user, {
          changed: refresh,
          toast: (m, kind) => toast(m, kind === 'error' ? 'error' : 'info'),
          // validation runs on the merged text, on its debounce; it never blocks typing (contract section 3, item 7)
          edited: () => { window.clearTimeout(checkTimer); checkTimer = window.setTimeout(() => { const ed = editor; if (!ed || cancelled) return; ADAPTER.validate(id, ed.getXml()).then((r) => { if (!cancelled) host.applyFindings(r.findings); }, () => undefined); }, 2500); },
        });
      } catch (e) { opened.close(false); console.warn('[live] JSS not opened live:', (e as Error).message); classic(); return; }
      liveRef.current = live;
      editor = build(live.model, !live.writable);
      live.attach(editor);
      host.editorRef.current = editor; host.liveRef.current = { flush: (revision) => opened.flush(revision) };
      editor.setFindings(loaded.report.findings);
      setIsLive(true); refresh();
    })();
    return () => {
      cancelled = true; window.clearTimeout(checkTimer);
      if (live) live.close();
      editor?.destroy(); host.editorRef.current = null;
      if (liveRef.current === live) { liveRef.current = null; host.liveRef.current = null; host.setLive(null); setIsLive(false); setLock(null); }
    };
    // the editor is built once per loaded document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, id, writable]);

  // Phase 3: comments pinned to the selected words of the live document, and shown again from the panel
  const pinning = useMemo(() => ({
    anchor: () => { const a = liveRef.current?.selectionAnchor(); return a ? { file: COMMENT_FILE, anchor: a } : null; },
    reveal: (_file: string, anchor: { y?: { start: string; end: string } }) => !!anchor.y && !!liveRef.current?.reveal(anchor.y),
  }), []);

  // the sections' document codes beside their headings, when the author has switched them on (on the Publication page); the codes themselves are not listed here
  const sectionCode = useSectionCode(id, host.savedAt);
  useEffect(() => { (host.editorRef.current as JssEditor | null)?.setSectionBadge(sectionCode); }, [sectionCode, loaded, host.editorRef]);

  // the last built PDF is shown at first
  useEffect(() => { if (!host.src && summary.build) host.setSrc(`${contentApi.pdfUrl(id)}?t=${new Date(summary.build.builtAt).getTime()}`); /* eslint-disable-next-line */ }, [id]);

  // PUB-023 / FE-006: the draft kept on this computer goes back into the editor
  const recover = () => {
    const d = host.draft.found; const ed = host.editorRef.current as JssEditor | null; if (!d || !ed) return;
    try { ed.restoreDocument(parseJss(d.xml)); host.draft.dismiss(); toast('Your unsaved changes are back. Save to keep them.', 'info'); }
    catch (e) { toast(`The draft cannot be opened: ${errText(e)}`, 'error'); }
  };

  return (
    <DocEditorShell kind="jss" shortcuts="jss" projectId={id} can={can} role={ctx.role} layout={layout} title={summary.project.name} hostRef={hostRef} loaded={!!loaded} find readOnly={!writable}
      crumb={loaded ? <span className="v2-badge accent" title={`Document type ${loaded.docType}, from the stencil ${loaded.stencil}`}>{loaded.label}</span> : null}
      saveState={host.saveState} guard={host.guard} live={isLive} pinning={isLive ? pinning : undefined} commentsFile={isLive ? COMMENT_FILE : undefined}
      banners={<>{lock ? <Alert tone="warn"><span data-testid="collab-lock" role="status">{lock}</span></Alert> : null}{host.banners(recover)}</>}
      docName={loaded?.label ?? undefined} findings={host.findings}
      inspect={() => (host.editorRef.current as JssEditor | null)?.inspect() ?? null}
      identity={() => { const m = (host.editorRef.current as JssEditor | null)?.getDoc().meta ?? {}; return META_FIELDS.filter((f) => m[f.key]).map((f) => [f.label, m[f.key]] as [string, string]); }}
      meta={loaded ? [['Type', loaded.label], ['Type code', <span className="mono">{loaded.docType}</span>], ['Stencil', <span className="mono">{loaded.stencil}</span>], ['Heading depth', String(loaded.maxDepth)]] : []}
      section={loaded ? <span>JSS</span> : undefined}
      topActions={<>
        <button className="btn" onClick={() => void host.check()} disabled={!loaded || checking} data-testid="jss-check" title="Check the document for problems without saving or building">{checking ? <Spinner /> : <Icon name="shield" size={16} className="ico" />}Check</button>
        <QuickPreview onRun={() => void host.preview()} busy={previewing} disabled={!canBuild(can) || building || !loaded} testId="jss-quick-preview" autoTestId="jss-preview-auto" auto={host.autoPreview} setAuto={host.setAutoPreview}
          title={!canBuild(can) ? 'Reviewers, editors and owners can preview the PDF' : 'Save, then render this document as a draft PDF beside the editor (not the publication: nothing is released or recorded)'} />
        <button className="btn primary" onClick={() => void host.generate()} disabled={!canBuild(can) || building || previewing || !loaded} data-testid="jss-generate" title={!canBuild(can) ? 'Reviewers, editors and owners can build the PDF' : 'Save, then build the whole publication as a PDF'}>{building ? <Spinner /> : <Icon name="play" size={16} className="ico" />}{building ? 'Building…' : 'Generate PDF'}</button>
      </>}
      actions={<>
        <button className="btn btn-sm" onClick={() => void host.save()} disabled={!writable || saving || (isLive ? !!lock : !dirty)} data-testid="jss-save" title={!writable ? 'You have read-only access' : isLive ? (lock ?? 'Your changes are saved as you type; Save writes the file now and records a version in the history (Ctrl+S)') : !dirty ? 'Nothing to save' : 'Save the document (Ctrl+S)'}>{saving ? <Spinner /> : <Icon name="check" size={12} />}Save</button>
        <PackagePanel id={id} writable={writable} dirty={dirty} saveFirst={host.save} onImported={() => { host.setDirty(false); void host.load(); ctx.reload(); }} />
        <ConvertButton id={id} from="jss" name={summary.project.name} dirty={dirty} saveFirst={host.save} />
        {/* WP-07 (UX-019): two different exports, so two names; WP-22 folds them into the Document menu */}
        <ExportProjectButton id={id} dirty={dirty} saveFirst={host.save} label="Export project" />
      </>}
      pdf={<DocPdfPane kind="jss" src={host.src} downloadHref={contentApi.pdfUrl(id, true)} downloadName={`${summary.project.name}.pdf`} builtBy="the server" what="the publication"
        note={host.note} building={building} progressLines={host.progress.lines} shown={host.shown} projectId={id} />} />
  );
}

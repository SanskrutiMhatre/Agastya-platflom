// The editor page of a JSS document project: the JSS editor (src/jss, independent of the S1000D Studio) beside the PDF the server builds from it.
//
// The document is one XML file, the project's source of truth. Saving writes that XML as the editor produces it; Generate saves, then asks the server to
// build the PDF from the saved file through the JSS pipeline (XML -> XSL-FO -> PDF), so what is shown is what the server renders, never a browser approximation.
//
// WP-21: the page is an adapter of the editor host (src/editors/host): the host owns the header, save state, saving and refused saves, drafts,
// the leave guard, the layout, the palette, the shortcuts, the find bar and focus mode; this page says how to build the JSS editor and what its
// header offers.

import { useEffect, useRef } from 'react';
import { contentApi, graphicsApi } from '../../api';
import { jssApi, type JssDocument } from '../../api/jss';
import { Icon } from '../../components/Icon';
import { Spinner, errText } from '../../components/ui';
import { canBuild, useProject } from '../../layouts/ProjectShell';
import { JssEditor, type GraphicInfo } from '../../jss/editor';
import { META_FIELDS } from '../../jss/model';
import { QuickPreview } from '../../editors/host/ChromeControls';
import { JssParseError, parseJss, serializeJss } from '../../jss/xml';
import { PackagePanel } from '../../jss/PackagePanel';
import { ConvertButton, ExportProjectButton, useSectionCode } from '../../components/DocCodes';
import { useUi } from '../../store/ui';
import { DocEditorShell } from '../../editors/host/DocEditorShell';
import { DocPdfPane } from '../../editors/host/DocPdfPane';
import { useDocEditor, type DocAdapter } from '../../editors/host/useDocEditor';
import { useEditorLayout } from '../../editors/host/useEditorLayout';

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

  // mount the editor once the document is here
  useEffect(() => {
    if (!loaded || !hostRef.current) return;
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
    const editor = new JssEditor(hostRef.current, {
      doc, maxDepth: loaded.maxDepth, readOnly: !writable,
      chapterRule: loaded.chapterRule, sectionsFixed: loaded.sectionsFixed, tableTemplates: loaded.tableTemplates, chapterStarter: loaded.chapterStarter,
      host: {
        graphics: async (): Promise<GraphicInfo[]> => (await graphicsApi.list(id)).map((g) => ({ src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) })),
        uploadGraphic: async (file: File): Promise<GraphicInfo> => {
          const out = await graphicsApi.upload(id, [file], 'symbol');
          const name = out.added[0]; const g = out.graphics.find((x) => x.name === name) ?? out.graphics[0];
          return { src: `${g.dir === 'csdb' ? 'csdb' : 'Media'}/${g.name}`, name: g.name, url: graphicsApi.url(id, g.name) };
        },
        imageUrl: (s) => graphicsApi.url(id, s.split('/').pop() ?? s),
        onDirty: host.setDirty,
        onSaveRequested: () => { void host.save(); },
        onCheckRequested: () => { void host.check(); },
        notify: (m, kind) => toast(m, kind === 'error' ? 'error' : 'info'),
      },
    });
    host.editorRef.current = editor; host.setDirty(editor.isDirty()); editor.setFindings(loaded.report.findings);          // a freshly loaded document has nothing unsaved
    return () => { editor.destroy(); host.editorRef.current = null; };
    // the editor is built once per loaded document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, id, writable]);

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
      saveState={host.saveState} guard={host.guard} banners={host.banners(recover)}
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
        <button className="btn btn-sm" onClick={() => void host.save()} disabled={!writable || !dirty || saving} data-testid="jss-save" title={!writable ? 'You have read-only access' : !dirty ? 'Nothing to save' : 'Save the document (Ctrl+S)'}>{saving ? <Spinner /> : <Icon name="check" size={12} />}Save</button>
        <PackagePanel id={id} writable={writable} dirty={dirty} saveFirst={host.save} onImported={() => { host.setDirty(false); void host.load(); ctx.reload(); }} />
        <ConvertButton id={id} from="jss" name={summary.project.name} dirty={dirty} saveFirst={host.save} />
        {/* WP-07 (UX-019): two different exports, so two names; WP-22 folds them into the Document menu */}
        <ExportProjectButton id={id} dirty={dirty} saveFirst={host.save} label="Export project" />
      </>}
      pdf={<DocPdfPane kind="jss" src={host.src} downloadHref={contentApi.pdfUrl(id, true)} downloadName={`${summary.project.name}.pdf`} builtBy="the server" what="the publication"
        note={host.note} building={building} progressLines={host.progress.lines} shown={host.shown} projectId={id} />} />
  );
}

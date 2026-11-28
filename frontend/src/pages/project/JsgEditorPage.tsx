// The editor page of a JSG document project: the JSG editor (src/jsg, independent of the JSS editor and of the S1000D Studio) beside the PDF the server builds from it.
//
// The document is one XML file, the project's source of truth. Saving writes that XML as the editor produces it; Generate saves, then asks the JSG engine on the server to
// build the PDF from the saved file (XML -> XSL-FO -> PDF), so what is shown is what the server renders, never a browser approximation.
//
// WP-21: the page is an adapter of the editor host (src/editors/host), like the JSS page: the host owns the header, save state, saving and refused
// saves, drafts, the leave guard, the layout, the palette, the shortcuts and focus mode. The JSG editors keep their own find bar (Ctrl+F, Ctrl+H).

import { useEffect, useRef, useState } from 'react';
import { graphicsApi } from '../../api';
import { jsgApi, type JsgDocument } from '../../api/jsg';
import { Icon } from '../../components/Icon';
import { ConvertButton, ExportProjectButton, useSectionCode } from '../../components/DocCodes';
import { ConfirmModal, Spinner, errText } from '../../components/ui';
import { canBuild, useProject } from '../../layouts/ProjectShell';
import { JsgEditor } from '../../jsg/editor';
import { IsplEditor } from '../../jsg/ispl-editor';
import type { GraphicInfo, JsgEditorLike } from '../../jsg/shared';
import { JsgParseError, parseJsg, serializeJsg } from '../../jsg/xml';
import { useUi } from '../../store/ui';
import { DocEditorShell } from '../../editors/host/DocEditorShell';
import { DocPdfPane } from '../../editors/host/DocPdfPane';
import { useDocEditor, type DocAdapter } from '../../editors/host/useDocEditor';
import { useEditorLayout } from '../../editors/host/useEditorLayout';

const ADAPTER: DocAdapter<JsgDocument> = {
  kind: 'jsg',
  read: (id) => jsgApi.read(id),
  save: (id, xml, hash) => jsgApi.save(id, xml, hash),
  validate: (id, xml) => jsgApi.validate(id, xml),
  build: (id) => jsgApi.build(id),
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
  const { loaded, setLoaded, writable, dirty, saving, checking, building, savedAt } = host;
  const hostRef = useRef<HTMLDivElement>(null);
  const [importing, setImporting] = useState(false);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const wordInput = useRef<HTMLInputElement>(null);
  // PUB-023: autosave is on unless the author switched it off
  const [autosave, setAutosave] = useState(() => { try { return localStorage.getItem('agastya.jsg.autosave') !== '0'; } catch { return true; } });

  // FE-006 / PUB-023: the draft kept on this computer goes back into the editor (the editor is built again from it, and counts as unsaved)
  const recovered = useRef(false);
  const recover = () => {
    const d = host.draft.found; if (!d || !loaded) return;
    try { parseJsg(d.xml); } catch (e) { toast(`The draft cannot be opened: ${errText(e)}`, 'error'); return; }
    host.draft.dismiss(); recovered.current = true; setLoaded({ ...loaded, xml: d.xml });
    toast('Your unsaved changes are back. Save to keep them.', 'info');
  };

  // mount the editor once the document is here
  useEffect(() => {
    if (!loaded || !hostRef.current) return;
    let doc;
    try { doc = parseJsg(loaded.xml); }
    catch (e) { host.setError(e instanceof JsgParseError ? `The editor cannot open this document: ${e.message}` : errText(e)); return; }
    const Editor = doc.type === 'ispl' ? IsplEditor : JsgEditor;          // two document types, two editors; the page, the save and the PDF are the same
    const editor = new Editor(hostRef.current, {
      doc, readOnly: !writable,
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
    host.editorRef.current = editor; editor.setFindings(loaded.report.findings);
    if (recovered.current) { recovered.current = false; editor.markDirty(); } else host.setDirty(editor.isDirty());
    return () => { editor.destroy(); host.editorRef.current = null; };
    // the editor is built once per loaded document
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, id, writable]);

  // the sections' document codes beside their headings, when the author has switched them on (on the Publication page; a User Handbook; a parts list has no sections of this kind)
  const sectionCode = useSectionCode(id, savedAt);
  useEffect(() => { (host.editorRef.current as JsgEditorLike | null)?.setSectionBadge?.(loaded?.docType === 'uhb' ? sectionCode : undefined); }, [sectionCode, loaded, host.editorRef]);

  // Auto-save: a minute after the last change, when the author has asked for it. A save that fails (someone else saved, or the document is broken) is not repeated by it.
  useEffect(() => { try { localStorage.setItem('agastya.jsg.autosave', autosave ? '1' : '0'); } catch { /* private mode */ } }, [autosave]);
  useEffect(() => {
    if (!autosave || !dirty || !writable || saving) return;
    const t = setTimeout(() => { void host.save(); }, 60_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosave, dirty, writable, saving, savedAt]);

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
    <DocEditorShell kind="jsg" projectId={id} can={can} role={ctx.role} shortcuts={loaded && parseKind(loaded.xml) === 'ispl' ? 'jsg-ispl' : 'jsg'} layout={layout} title={summary.project.name} hostRef={hostRef} loaded={!!loaded} find={false} readOnly={!writable}
      crumb={loaded ? <span className="v2-badge accent" title={`JSG document type ${loaded.docType}, from the stencil ${loaded.stencil}`}>JSG · {loaded.label}</span> : null}
      saveState={host.saveState} guard={host.guard} banners={host.banners(recover)}
      docName={loaded?.label ?? undefined} findings={host.findings}
      meta={loaded ? [['Type', `JSG · ${loaded.label}`], ['Type code', <span className="mono">{loaded.docType}</span>], ['Stencil', <span className="mono">{loaded.stencil}</span>], ['Auto-save', writable ? (autosave ? 'On' : 'Off') : 'Not available']] : []}
      section={loaded ? <span>JSG</span> : undefined}
      topActions={<>
        <button className="btn" onClick={() => void host.check()} disabled={!loaded || checking} data-testid="jsg-check" title="Check the document for problems without saving or building">{checking ? <Spinner /> : <Icon name="shield" size={16} className="ico" />}Check</button>
        <button className="btn primary" onClick={() => void host.generate()} disabled={!canBuild(can) || building || !loaded} data-testid="jsg-generate" title={!canBuild(can) ? 'Reviewers, editors and owners can build the PDF' : 'Save, then build the document as a PDF'}>{building ? <Spinner /> : <Icon name="play" size={16} className="ico" />}{building ? 'Building…' : 'Generate PDF'}</button>
      </>}
      actions={<>
        {loaded?.docType === 'uhb' && writable ? <>
          <input ref={wordInput} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden data-testid="jsg-word-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setWordFile(f); }} />
          <button className="btn btn-sm" onClick={() => wordInput.current?.click()} disabled={importing || saving || building} data-testid="jsg-import-word" title="Replace this handbook with a Word file written in the JSG styles (Section, Heading 1-5, L2-L5 paragraphs, Caption ...)">{importing ? <Spinner /> : <Icon name="upload" size={12} />}Import Word…</button>
        </> : null}
        {writable ? <label className="v2-row v2-edautosave" title="Save by itself a minute after the last change"><input type="checkbox" checked={autosave} onChange={(e) => setAutosave(e.target.checked)} data-testid="jsg-autosave" />Auto-save</label> : null}
        <button className="btn btn-sm" onClick={() => void host.save()} disabled={!writable || !dirty || saving} data-testid="jsg-save" title={!writable ? 'You have read-only access' : !dirty ? 'Nothing to save' : 'Save the document (Ctrl+S)'}>{saving ? <Spinner /> : <Icon name="check" size={12} />}Save</button>
        {loaded?.docType === 'uhb' ? <ConvertButton id={id} from="jsg" name={summary.project.name} dirty={dirty} saveFirst={host.save} /> : null}
        <ExportProjectButton id={id} dirty={dirty} saveFirst={host.save} />
      </>}
      pdf={<DocPdfPane kind="jsg" src={host.src} downloadHref={jsgApi.pdfUrl(id, true)} downloadName={`${summary.project.name}.pdf`} builtBy="the JSG engine" what="the document"
        note={host.note} building={building} progressLines={host.progress.lines} />} />
    {wordFile ? <ConfirmModal title="Replace this handbook?" danger confirmLabel="Replace with the Word file"
      body={<p>Replace this handbook with “{wordFile.name}”? The whole document and its front matter are replaced by what the Word file contains (its pictures are added to the project). The handbook as it is now is kept in the project folder as jsg-document.before-import.bak.</p>}
      onClose={() => setWordFile(null)} onConfirm={() => { const f = wordFile; setWordFile(null); void importWord(f); }} /> : null}
  </>);
}

/** The document type the XML declares (`<jsgdoc type="...">`), without parsing the whole document. */
const parseKind = (xml: string): string => /<jsgdoc\b[^>]*\btype="([^"]+)"/.exec(xml)?.[1] ?? '';

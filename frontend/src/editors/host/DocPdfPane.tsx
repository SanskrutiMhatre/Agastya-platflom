// WP-21 (UX-003 stage 4): the PDF side of the JSS and JSG editor pages (it was written twice). The S1000D page has its own (pages/project/editor/
// PdfPane.tsx: Quick preview of one data module, Generate of the publication, pop-out windows).
//
// UI redesign, second pass: the pane shows either the PDF Generate built (the publication) or a Quick preview (a draft the server rendered from the
// saved document, held in the browser); the bar says which, and Download saves the one on show. The commands are in the top bar.

import { Icon } from '../../components/Icon';
import { DOC_IDS } from './testIds';
import { LazyPdfViewer } from '../../components/pdf/LazyPdfViewer';
import { usePaneAnnotations } from '../../components/pdfreview/usePaneAnnotations';

export interface DocPdfPaneProps {
  kind: 'jss' | 'jsg';
  src: string | null;
  downloadHref: string;
  downloadName: string;
  /** "the server", "the JSG engine" */
  builtBy: string;
  /** "the publication", "the document" */
  what: string;
  note: string;
  building: boolean;
  progressLines: string[];
  /** which PDF is on show: the one Generate built, or a Quick preview */
  shown?: 'build' | 'preview' | null;
  /** Phase 3 (P3-4): the project, for the PDF review threads shown read-only on the generated PDF */
  projectId?: string;
}

export function DocPdfPane({ kind, src, downloadHref, downloadName, builtBy, what, note, building, progressLines, shown, projectId }: DocPdfPaneProps) {
  const draft = !!src && shown === 'preview';
  const review = usePaneAnnotations(projectId ?? '', projectId ? (kind === 'jsg' ? 'jsg-output.pdf' : 'jss-output.pdf') : null, !!src && !draft);
  return <>
    <div className="v2-pdfbar" data-testid="pdf-showing" data-showing={src ? (draft ? 'preview' : 'build') : 'none'}>
      {src ? <span className={`badge ${draft ? 'warning' : 'accent'}`}>{draft ? 'Quick preview (draft)' : 'Generated PDF'}</span> : null}
      <span className="v2-hint">{src ? (draft ? `Rendered by ${builtBy} from the saved document; not ${what}` : `The PDF built by ${builtBy} from the saved document`) : `Press Quick preview for a draft, or Generate PDF to build ${what}`}</span>
      <span className="spacer" />
      {review.badge}
      {src ? <a className="btn btn-sm" href={draft ? src : downloadHref} download={draft ? downloadName.replace(/\.pdf$/i, ' (preview).pdf') : undefined} {...DOC_IDS[kind].download}>Download</a> : null}
    </div>
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }} data-testid="pdf-pane">
      <LazyPdfViewer autoFit src={src} downloadName={downloadName} pageOverlay={review.overlay}
        placeholder={<div className="v2-center"><div className="v2-empty v2-empty-steps">
          <Icon name="pdf" size={30} />
          <h3>No PDF yet</h3>
          <ol>
            <li>Write in the editor on the left. <strong>Ctrl+S</strong> saves.</li>
            <li>Press <strong>Check</strong> to find problems early.</li>
            <li>Press <strong>Quick preview</strong> to see the saved document as a draft PDF here.</li>
            <li>Press <strong>Generate PDF</strong> to save and build {kind === 'jss' ? 'the whole publication' : 'the document'}.</li>
          </ol>
        </div></div>} />
    </div>
    {note || (building && progressLines.length) ? <div className="v2-log" aria-live="polite" {...DOC_IDS[kind].note}>{building ? progressLines.slice(-4).map((l, i) => <div key={i}>{l}</div>) : <div>{note}</div>}</div> : null}
  </>;
}

// WP-21 (UX-003 stage 4): the PDF side of the JSS and JSG editor pages (it was written twice). The S1000D page has its own (pages/project/editor/
// PdfPane.tsx: Quick preview of one data module, Generate of the publication, pop-out windows).

import { Icon } from '../../components/Icon';
import { LazyPdfViewer } from '../../components/pdf/LazyPdfViewer';

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
}

export function DocPdfPane({ kind, src, downloadHref, downloadName, builtBy, what, note, building, progressLines }: DocPdfPaneProps) {
  return <>
    <div className="v2-pdfbar">
      <span className="v2-hint">{src ? `The PDF built by ${builtBy} from the saved document` : `Press Generate PDF to build ${what}`}</span>
      <span className="spacer" />
      {src ? <a className="btn btn-sm" href={downloadHref} data-testid={`${kind}-download`}>Download</a> : null}
    </div>
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }} data-testid="pdf-pane">
      <LazyPdfViewer autoFit src={src} downloadName={downloadName}
        placeholder={<div className="v2-center"><div className="v2-empty v2-empty-steps">
          <Icon name="pdf" size={30} />
          <h3>No PDF yet</h3>
          <ol>
            <li>Write in the editor on the left. <strong>Ctrl+S</strong> saves.</li>
            <li>Press <strong>Check</strong> to find problems early.</li>
            <li>Press <strong>Generate PDF</strong> to save and build {kind === 'jss' ? 'the whole publication' : 'the document'} here.</li>
          </ol>
        </div></div>} />
    </div>
    {note || (building && progressLines.length) ? <div className="v2-log" aria-live="polite" data-testid={`${kind}-note`}>{building ? progressLines.slice(-4).map((l, i) => <div key={i}>{l}</div>) : <div>{note}</div>}</div> : null}
  </>;
}

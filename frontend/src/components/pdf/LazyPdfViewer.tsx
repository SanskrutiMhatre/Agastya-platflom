// =============================================================================
// LazyPdfViewer — the pdf.js viewer, loaded on demand.
//
// pdf.js is around 400 kB minified. Importing it directly put all of that in
// the entry chunk, so every author paid for it on first paint whether or not
// they ever opened a preview. Behind a dynamic import it becomes its own chunk,
// fetched the first time a preview is actually shown.
//
// Use this everywhere instead of importing PdfJsViewer directly.
// =============================================================================

import React, { Suspense, lazy } from 'react';
import type { PdfJsViewerProps } from './PdfJsViewer';

const Viewer = lazy(() =>
  import('./PdfJsViewer').then(m => ({ default: m.PdfJsViewer })),
);

const Loading: React.FC = () => (
  <div style={{
    height: '100%', display: 'grid', placeItems: 'center',
    background: '#3a3a3e', color: 'rgba(255,255,255,.7)', fontSize: 13,
  }}>
    Loading viewer…
  </div>
);

export const LazyPdfViewer: React.FC<PdfJsViewerProps> = props => (
  <Suspense fallback={<Loading />}>
    <Viewer {...props} />
  </Suspense>
);

export default LazyPdfViewer;

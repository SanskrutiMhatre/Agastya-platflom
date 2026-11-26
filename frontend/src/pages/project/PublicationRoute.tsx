// The Publication tab of a project: the S1000D publication module screen for an S1000D project, the document-codes screen for a JSS or JSG document project (its chapters are
// the document's own, so there is no publication module to arrange). The two share only this decision.

import { Suspense, lazy } from 'react';
import { Loading } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { PublicationPage } from './PublicationPage';

const DocPublication = lazy(() => import('./DocPublicationPage').then((m) => ({ default: m.DocPublicationPage })));

export function PublicationRoute() {
  const { summary } = useProject();
  const document = summary.project.authoring === 'jss-xml' || summary.project.format === 'jsg';
  return document ? <Suspense fallback={<Loading />}><DocPublication /></Suspense> : <PublicationPage />;
}

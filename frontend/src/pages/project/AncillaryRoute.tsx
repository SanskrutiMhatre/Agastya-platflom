// The Ancillary pages tab of a project: the JSG User Handbook's own page (its front matter is part of its one XML document), the JSS page for a JSS document.

import { Suspense, lazy } from 'react';
import { Loading } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';

const JssAncillary = lazy(() => import('./AncillaryPage').then((m) => ({ default: m.AncillaryPage })));
const JsgAncillary = lazy(() => import('./JsgAncillaryPage').then((m) => ({ default: m.JsgAncillaryPage })));

export function AncillaryRoute() {
  const { summary } = useProject();
  return <Suspense fallback={<Loading />}>{summary.project.format === 'jsg' ? <JsgAncillary /> : <JssAncillary />}</Suspense>;
}

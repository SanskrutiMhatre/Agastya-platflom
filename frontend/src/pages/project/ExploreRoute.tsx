// The Explore tab of a project: the S1000D publication tree for an S1000D project, the document hierarchy with its codes for a JSS or JSG document project.

import { Suspense, lazy } from 'react';
import { Loading } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { ExplorePage } from './ExplorePage';

const DocExplore = lazy(() => import('./DocExplorePage').then((m) => ({ default: m.DocExplorePage })));

export function ExploreRoute() {
  const { summary } = useProject();
  const document = summary.project.authoring === 'jss-xml' || summary.project.format === 'jsg';
  return document ? <Suspense fallback={<Loading />}><DocExplore /></Suspense> : <ExplorePage />;
}

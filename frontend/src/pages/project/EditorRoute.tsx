// The Editor tab of a project opens the editor that fits what the project is: the JSS editor for a JSS document project (its source is one JSS XML file),
// the S1000D Studio for everything else. The two share nothing but this decision.

import { Suspense, lazy } from 'react';
import { Loading } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { loadStudioStyles } from '../../studio/styles/load';

// Both are large and only this route needs them. The Studio's own stylesheets come with it (WP-18, FE-020): the editor
// renders once they are in, so it never shows unstyled.
const StudioEditor = lazy(() => Promise.all([import('./EditorPage'), loadStudioStyles()]).then(([m]) => ({ default: m.EditorPage })));
const JssEditor = lazy(() => import('./JssEditorPage').then((m) => ({ default: m.JssEditorPage })));
const JsgEditor = lazy(() => import('./JsgEditorPage').then((m) => ({ default: m.JsgEditorPage })));

export function EditorRoute() {
  const { summary } = useProject();
  const jss = summary.project.authoring === 'jss-xml';
  const jsg = summary.project.format === 'jsg';          // a JSG document has its own editor and its own engine (src/jsg): the other two editors never see it
  return <Suspense fallback={<Loading label="Loading the editor…" />}>{jsg ? <JsgEditor /> : jss ? <JssEditor /> : <StudioEditor />}</Suspense>;
}

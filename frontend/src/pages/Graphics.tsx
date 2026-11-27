// Graphics Management on the main dashboard: the graphics of every project the person can open,
// grouped by project. Adding and deleting happens in each project's own Graphics page.

import { useNavigate } from 'react-router-dom';
import { graphicsApi } from '../api';
import { GraphicsView } from '../components/GraphicsView';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Alert, Empty, Loading, useAsync } from '../components/ui';

export function GraphicsPage() {
  const nav = useNavigate();
  const all = useAsync(() => graphicsApi.all(), []);
  const projects = all.data ?? [];
  const icns = projects.reduce((n, p) => n + p.graphics.filter((g) => g.kind === 'icn').length, 0);
  const symbols = projects.reduce((n, p) => n + p.graphics.filter((g) => g.kind === 'symbol').length, 0);

  return (
    <div className="v2-page">
      <PageHeader icon="image" title="Graphics management" sub="ICN artwork and symbols across your projects. Open a project's Graphics to add or delete."
        stats={[{ label: 'Projects', value: projects.length }, { label: 'ICNs', value: icns }, { label: 'Symbols', value: symbols }]} />
      {all.error ? <Alert tone="bad">{all.error}</Alert> : null}
      {all.loading && !all.data ? <Loading /> : projects.length === 0 ? <Empty title="No projects yet">Graphics belong to projects. Create or open a project first.</Empty> : projects.map((p) => (
        <section key={p.id} className="v2-card v2-card-pad" aria-label={`Graphics of ${p.name}`} data-testid="graphics-project">
          <div className="v2-gfx-project-head">
            <h3 title={p.name}>{p.name}</h3>
            <button className="btn btn-sm" onClick={() => nav(`/projects/${p.id}/graphics`)}><Icon name="external" size={13} />Manage in project</button>
          </div>
          <GraphicsView projectId={p.id} graphics={p.graphics} empty="No graphics in this project." />
        </section>
      ))}
    </div>
  );
}

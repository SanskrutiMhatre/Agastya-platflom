// Graphics Management on the main dashboard: the graphics of every project the person can open,
// grouped by project. Adding and deleting happens in each project's own Graphics page.

import { useNavigate } from 'react-router-dom';
import { graphicsApi } from '../api';
import { GraphicsView } from '../components/GraphicsView';
import { Icon } from '../components/Icon';
import { Alert, Empty, Loading, useAsync } from '../components/ui';
import '../styles/pages/admin.css';   // UI redesign screen 6: the administration look of the global pages
import { AdmHead, StatTile } from './adminParts';

export function GraphicsPage() {
  const nav = useNavigate();
  const all = useAsync(() => graphicsApi.all(), []);
  const projects = all.data ?? [];
  const icns = projects.reduce((n, p) => n + p.graphics.filter((g) => g.kind === 'icn').length, 0);
  const symbols = projects.reduce((n, p) => n + p.graphics.filter((g) => g.kind === 'symbol').length, 0);

  return (
    <div className="v2-page adm">
      <AdmHead icon="image" title="Graphics management" sub="ICN artwork and symbols across your projects. Open a project's Graphics to add or delete." />
      <section className="hh" aria-label="Graphics at a glance" data-testid="graphics-stats">
        <StatTile label="Projects" value={projects.length} line="with graphics you can open" />
        <StatTile label="ICNs" value={icns} line="information control numbers" tone={icns ? 'info' : undefined} />
        <StatTile label="Symbols" value={symbols} line="reusable symbols" tone={symbols ? 'info' : undefined} />
      </section>
      {all.error ? <Alert tone="bad">{all.error}</Alert> : null}
      {all.loading && !all.data ? <Loading /> : projects.length === 0 ? <Empty title="No projects yet">Graphics belong to projects. Create or open a project first.</Empty> : projects.map((p) => (
        <section key={p.id} className="card mb4" aria-label={`Graphics of ${p.name}`} data-testid="graphics-project">
          <div className="card-head v2-gfx-project-head">
            <h3 title={p.name}><Icon name="folder" />{p.name} <span className="count">{p.graphics.length}</span></h3>
            <button className="btn btn-sm" onClick={() => nav(`/projects/${p.id}/graphics`)}><Icon name="external" size={13} />Manage in project</button>
          </div>
          <div className="card-body"><GraphicsView projectId={p.id} graphics={p.graphics} empty="No graphics in this project." /></div>
        </section>
      ))}
    </div>
  );
}

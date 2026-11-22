// Project settings, "SNS": the project's Standard Numbering System.
//
// A tab of Project settings (like the Brand pack), because the SNS is part of how the project is set up and the people who change it are the people who
// can change the project's settings. Deriving the publication structure is one of its sections, with a link to it from the Publication page.
//
//   Rows      the SNS as an editable hierarchy, with its validation
//   Import    from the project's BREX data modules, or from the organisation defaults (preview first)
//   Learn     proposals from the data modules, accepted one by one
//   Derive    the publication structure the SNS implies (preview first)
//   Ordering  how modules inside a node are ordered
//
// Anyone who can see the project reads all of it; an editor, manager or owner changes it.

import { useMemo } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { projectRowsApi, snsApi } from '../../../api/sns';
import { SnsRowsEditor } from '../../../components/SnsRows';
import { Alert, Loading, useAsync } from '../../../components/ui';
import { useProject } from '../../../layouts/ProjectShell';
import { canEditSns } from '../../../lib/roles';
import { SnsDeriveTab } from './SnsDeriveTab';
import { SnsImportTab } from './SnsImportTab';
import { SnsLearnTab } from './SnsLearnTab';
import { SnsOrderingTab } from './SnsOrderingTab';

export function SnsSettings() {
  const { id, role } = useProject();
  const data = useAsync(() => snsApi.get(id), [id]);
  const rowsApi = useMemo(() => projectRowsApi(id), [id]);
  const may = canEditSns(role);

  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <Alert tone="bad">{data.error || 'Could not read the SNS.'}</Alert>;
  const d = data.data;
  const sections = [
    { to: 'rows', label: `Rows (${d.rows.length})` }, { to: 'import', label: 'Import' }, { to: 'learn', label: 'Learn from modules' },
    { to: 'derive', label: 'Derive structure' }, { to: 'ordering', label: 'Ordering' },
  ];
  return (
    <div className="v2-stack" data-testid="sns-settings">
      <p className="v2-sub" style={{ margin: 0 }}>
        The Standard Numbering System names the systems, sub-systems and assemblies that the data module codes spell out. It titles the chapters when the publication structure is derived from the data modules.
      </p>
      {!may ? <Alert tone="warn"><span data-testid="sns-readonly">You have {role} access: you can read the SNS, but only an editor, manager or owner can change it.</span></Alert> : null}
      <nav className="v2-subtabs" aria-label="SNS sections">
        {sections.map((s) => <NavLink key={s.to} to={s.to} className={({ isActive }) => `v2-subtab ${isActive ? 'active' : ''}`} data-testid={`sns-nav-${s.to}`}>{s.label}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={<Navigate to="rows" replace />} />
        <Route path="rows" element={<SnsRowsEditor data={d} api={rowsApi} canWrite={may} reload={data.reload} testid="sns" noun="SNS" />} />
        <Route path="import" element={<SnsImportTab projectId={id} may={may} onApplied={data.reload} />} />
        <Route path="learn" element={<SnsLearnTab projectId={id} may={may} onApplied={data.reload} />} />
        <Route path="derive" element={<SnsDeriveTab projectId={id} may={may} />} />
        <Route path="ordering" element={<SnsOrderingTab projectId={id} may={may} />} />
        <Route path="*" element={<Navigate to="rows" replace />} />
      </Routes>
    </div>
  );
}

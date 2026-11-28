// The scan report of the package importer, laid out so that a 700-file package reads on one screen:
// a verdict and the counts first, then collapsible sections (what will be repaired, what cannot be, graphics, publications,
// unassigned modules, files). Long lists show their first rows and a "Show all" button; nothing renders 700 rows unasked.

import { useId, useMemo, useState } from 'react';
import type { ImportFinding, ImportRule, RepairRuleId, ScanResult } from '../../../api/importer';
import { Alert, Badge, fmtSize } from '../../../components/ui';
import { CappedList, Section } from '../../../components/lists';
import { baseName, blockingFindings, bucketFindings, countTiles, filterBy, findingLabel, flavourLabel, plural, poolReason, repairRows, type FindingGroup } from '../../../lib/importPackage';

const TONE = { error: 'bad', warning: 'warn', info: undefined } as const;

function Groups({ groups, testid }: { groups: FindingGroup[]; testid: string }) {
  return (
    <div className="v2-stack" style={{ gap: 10 }} data-testid={testid}>
      {groups.map((g) => (
        <div key={`${g.severity}-${g.id}-${g.repairable}`} data-testid="finding-group" data-id={g.id}>
          <div className="v2-row wrap" style={{ gap: 6 }}>
            <Badge tone={TONE[g.severity]}>{g.severity}</Badge>
            <strong>{findingLabel(g.id)}</strong>
            {g.count > 1 ? <Badge title={`${g.count} findings`}>{g.count}</Badge> : null}
            {g.repairable ? <Badge tone="ok">repaired by the import</Badge> : null}
          </div>
          <CappedList items={g.items} initial={g.count > 1 ? 3 : 1} page={50} noun="findings"
            render={(f: ImportFinding) => <>{f.file ? <span className="v2-mono" title={f.file}>{baseName(f.file)}</span> : null}<span style={{ flex: 1, minWidth: 0 }}>{f.message}</span></>} />
        </div>
      ))}
    </div>
  );
}

export function ImportReportView({ scan, repairs, onToggle, locked }: { scan: ScanResult; repairs: RepairRuleId[]; onToggle: (id: RepairRuleId, on: boolean) => void; locked: boolean }) {
  const r = scan.report;
  const buckets = useMemo(() => bucketFindings(r.findings), [r.findings]);
  const blocking = useMemo(() => blockingFindings(r.findings), [r.findings]);
  const rows = useMemo(() => repairRows(scan.rules, r.repairPlan), [scan.rules, r.repairPlan]);
  const [q, setQ] = useState('');
  const filesId = useId();
  const files = useMemo(() => filterBy(r.files, q, (f) => `${f.path} ${f.kind} ${f.dmc ?? ''}`), [r.files, q]);
  const tiles = countTiles(r.counts);
  const repairable = rows.reduce((n, x) => n + (repairs.includes(x.id) ? x.items : 0), 0);

  return (
    <div className="v2-stack" data-testid="import-report">
      <div className="card card-body pp-form">
        <div className="v2-row wrap" style={{ gap: 8 }}>
          <strong data-testid="report-flavour">{flavourLabel(r.flavour.id)}</strong>
          <span className="v2-hint" title={r.flavour.evidence.join('\n')}>{Math.round(r.flavour.confidence * 100)}% sure{r.flavour.evidence[0] ? `: ${r.flavour.evidence[0]}` : ''}</span>
          <span className="spacer" />
          <Badge tone={r.summary.errors ? 'bad' : 'ok'}>{plural(r.summary.errors, 'error')}</Badge>
          <Badge tone={r.summary.warnings ? 'warn' : 'ok'}>{plural(r.summary.warnings, 'warning')}</Badge>
          <Badge tone={r.summary.repairable ? 'accent' : undefined}>{r.summary.repairable} repairable</Badge>
        </div>
        <div className="v2-tiles">
          <div className="v2-tile" data-testid="tile-files"><b>{r.counts.files}</b><span>files, {fmtSize(r.counts.bytes)}</span></div>
          {tiles.map((t) => <div key={t.key} className="v2-tile" data-testid={`tile-${t.key}`}><b>{t.value}</b><span>{t.label}</span></div>)}
        </div>
        {Object.keys(r.models).length ? <div className="v2-hint">Models: {Object.entries(r.models).map(([m, n]) => `${m} (${n})`).join(', ')}. Languages: {Object.entries(r.languages).map(([l, n]) => `${l} (${n})`).join(', ') || 'none found'}.</div> : null}
      </div>

      {r.counts.dms === 0 ? <Alert tone="bad"><strong>The package holds no S1000D data modules.</strong> There is nothing to import. Check that you chose the package itself and not a folder above or beside it.</Alert>
        : blocking.length ? <Alert tone="bad"><strong>{plural(blocking.length, 'problem')} the importer cannot repair.</strong> The import will probably be refused until {blocking.length === 1 ? 'it is' : 'they are'} fixed in the source package: see &ldquo;Cannot be repaired&rdquo; below.</Alert>
          : r.summary.errors + r.summary.warnings === 0 ? <Alert tone="ok"><strong>Nothing to repair.</strong> The package can be imported as it is.</Alert>
            : <Alert tone="ok"><strong>No problem that stops the import.</strong> {repairable ? `${plural(repairable, 'change')} will be made by the repairs below; the original of every changed file is kept.` : 'Warnings are listed below.'}</Alert>}

      <Section title="Repairs the import will make" count={repairable} tone={repairable ? 'accent' : undefined} defaultOpen testid="sec-repairs">
        <p className="v2-hint" style={{ marginTop: 0 }}>Repairs change copies of the files while they are written into the project. The original bytes of every changed file are kept with the change log. Untick a repair to leave that defect as it is.</p>
        <div className="v2-stack" style={{ gap: 10 }}>
          {rows.map((x: ImportRule & { items: number; files: number }) => {
            const on = repairs.includes(x.id);
            const why = buckets.repaired.filter((g) => g.rule === x.id);
            return (
              <div key={x.id} data-testid="repair-rule" data-rule={x.id}>
                <label className="v2-row" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <input type="checkbox" checked={on} disabled={locked} onChange={(e) => onToggle(x.id, e.target.checked)} data-testid={`rule-${x.id}`} style={{ marginTop: 3 }} />
                  <span style={{ minWidth: 0 }}>
                    <strong>{x.title}</strong>{' '}
                    <Badge tone={x.items ? 'accent' : undefined}>{x.items ? `${plural(x.items, 'change')} in ${plural(x.files, 'file')}` : 'nothing to do'}</Badge>
                    {!x.defaultOn ? <> <Badge>off by default</Badge></> : null}
                    <span className="v2-hint" style={{ display: 'block' }}>{x.description}</span>
                  </span>
                </label>
                {why.length && on ? <div style={{ margin: '6px 0 0 24px' }}><Groups groups={why} testid={`why-${x.id}`} /></div> : null}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Cannot be repaired: needs a person" count={buckets.reportOnly.length} tone={buckets.reportOnly.some((g) => g.severity === 'error') ? 'bad' : buckets.reportOnly.length ? 'warn' : 'ok'} defaultOpen={buckets.reportOnly.length > 0} testid="sec-unrepaired">
        {buckets.reportOnly.length ? <>
          <p className="v2-hint" style={{ marginTop: 0 }}>The importer only reports these. Errors here usually refuse the import (a file that is not well-formed XML, an unsafe entity, the same module twice); warnings are imported as they are.</p>
          <Groups groups={buckets.reportOnly} testid="unrepaired-groups" />
        </> : <span className="v2-hint">Nothing.</span>}
      </Section>

      {buckets.info.length ? <Section title="Notes" count={buckets.info.length} testid="sec-notes"><Groups groups={buckets.info} testid="info-groups" /></Section> : null}

      <Section title="Graphics" count={`${r.graphics.present} of ${r.graphics.declared} present`} tone={r.graphics.missing.length ? 'warn' : 'ok'} defaultOpen={r.graphics.missing.length > 0} testid="sec-graphics">
        <p style={{ marginTop: 0 }}>Declared by the modules: {r.graphics.declared}. Shipped in the package: {r.graphics.present}. {r.graphics.missing.length ? <><strong>{r.graphics.missing.length} missing</strong>: a labelled placeholder image is written for each when the placeholder repair is on, and it is flagged in the change log.</> : 'None missing.'}</p>
        {r.graphics.missing.length ? <CappedList items={r.graphics.missing} noun="missing graphics" testid="missing-graphics"
          render={(m) => <><span className="v2-mono">{m.icn}</span><span className="v2-hint">used by {plural(m.declaredIn.length, 'module')}</span></>} /> : null}
        {r.graphics.unusedFiles.length ? <>
          <h4 style={{ margin: '12px 0 4px' }}>Graphics no module uses ({r.graphics.unusedFiles.length})</h4>
          <CappedList items={r.graphics.unusedFiles} noun="files" render={(p: string) => <span className="v2-mono" title={p}>{baseName(p)}</span>} />
        </> : null}
      </Section>

      <Section title="Publications and structure" count={r.publications.length} testid="sec-publications">
        {r.publications.length ? <CappedList items={r.publications} noun="publications" render={(p) => <>
          <strong>{p.title || baseName(p.file)}</strong><span className="v2-mono">{p.pmCode}</span>
          <span className="v2-hint">{plural(p.entries, 'module')}</span>
          {p.placeholder ? <Badge tone="warn">template header</Badge> : null}{p.reconstructed ? <Badge>reconstructed</Badge> : null}
        </>} /> : <p style={{ marginTop: 0 }}>The package has no publication module. One is built from the data modules when the repair is on.</p>}
        {r.subPublications.length ? <>
          <h4 style={{ margin: '12px 0 4px' }}>Sub-publications ({r.subPublications.length})</h4>
          <CappedList items={r.subPublications} noun="sub-publications" render={(s) => <>
            <strong>{s.entryTitle || s.pmTitle}</strong><span className="v2-mono">{s.pmCode}</span>
            <Badge tone={s.status === 'nested' ? 'ok' : 'warn'}>{s.status === 'nested' ? 'included' : s.status === 'anchor-only' ? 'title page only' : 'not found'}</Badge>
          </>} />
        </> : null}
        {r.missingModules.length ? <>
          <h4 style={{ margin: '12px 0 4px' }}>Named by a publication but not in the package ({r.missingModules.length})</h4>
          <CappedList items={r.missingModules} noun="modules" initial={10} render={(m) => <><span className="v2-mono">{m.dmc}</span><span className="v2-hint">{m.title}{m.generatedFrontMatter ? ' (front matter the publisher generates)' : ''}</span></>} />
        </> : null}
        {r.reusedDms.length ? <p className="v2-hint">{plural(r.reusedDms.length, 'module')} used in more than one place of the publication.</p> : null}
      </Section>

      <Section title="Modules no publication places" count={r.unassigned.length} tone={r.unassigned.length ? 'warn' : 'ok'} defaultOpen={r.unassigned.length > 0 && r.unassigned.length <= 12} testid="sec-unassigned">
        {r.unassigned.length ? <>
          <p style={{ marginTop: 0 }}>These are never dropped and never published by themselves. After the import they wait in the unassigned list, and you add them to the publication yourself.</p>
          <CappedList items={r.unassigned} noun="modules" testid="report-unassigned" render={(p) => <>
            <strong>{p.techName || baseName(p.file)}</strong><span>{p.infoName}</span><span className="v2-mono">{p.dmc}</span><span className="v2-hint">{poolReason(p.reason)}</span>
          </>} />
        </> : <span className="v2-hint">Every module is placed by a publication.</span>}
      </Section>

      <Section title="Files" count={r.files.length} testid="sec-files">
        <div className="v2-row" style={{ marginBottom: 6 }}>
          <label htmlFor={filesId} className="v2-sr">Filter files</label>
          <input id={filesId} className="v2-input" style={{ height: 28 }} placeholder="Filter by name, kind or code…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="v2-hint" style={{ whiteSpace: 'nowrap' }}>{files.length === r.files.length ? `${r.files.length} files` : `${files.length} of ${r.files.length}`}</span>
        </div>
        <CappedList items={files} initial={30} page={200} noun="files" testid="report-files" empty={<span className="v2-hint">No file matches.</span>}
          render={(f) => <><Badge tone={f.kind === 'ignored' || f.kind === 'other' ? undefined : 'accent'}>{f.kind}</Badge><span className="v2-mono" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.path}</span><span className="v2-hint">{fmtSize(f.size)}</span></>} />
      </Section>
    </div>
  );
}

// What an applied import did: what was written, what was changed on the way in (the change log, by repair and then by file),
// what was left alone, and what still needs a person. A change log of hundreds of edits reads as a handful of lines with lists behind them.

import { useMemo } from 'react';
import type { ApplyResult, ImportRule } from '../../../api/importer';
import { Alert, Badge } from '../../../components/ui';
import { CappedList, Section } from '../../../components/lists';
import { baseName, groupChangeLog, plural, truncate } from '../../../lib/importPackage';

const KIND = { edit: 'changed', add: 'created', note: 'noted' } as const;

/** `unassigned` is the live count of modules the project's publication does not place (asked of the server after the import), not the package's own view of it. */
export function ImportResultView({ result, rules, unassigned }: { result: ApplyResult; rules: ImportRule[]; unassigned: number | null }) {
  const groups = useMemo(() => groupChangeLog(result.changeLog, rules), [result.changeLog, rules]);
  const made = result.changeLog.filter((c) => c.kind !== 'note').length;
  const i = result.imported;
  const pub = result.publication;
  const pubText = pub.mode === 'replaced'
    ? `Written${pub.counts ? `: ${plural(pub.counts.dms, 'module')} in ${plural(pub.counts.folders, 'chapter')}` : ''}${pub.reconstructed === 'full' ? ' (built from the data modules)' : pub.reconstructed === 'metadata' ? ' (header rebuilt)' : ''}${pub.backup ? `; the earlier one is kept as ${pub.backup}` : ''}`
    : pub.mode === 'kept' ? 'The project’s own publication was kept' : 'The package had no publication';

  return (
    <div className="v2-stack" data-testid="import-result">
      <Alert tone="ok">
        <strong data-testid="result-headline">Imported {plural(i.dms.length + i.overwritten.length, 'data module')}{i.media.length ? ` and ${plural(i.media.length, 'graphic')}` : ''}.</strong>{' '}
        {made ? `${plural(made, 'repair')} ${made === 1 ? 'was' : 'were'} made on the way in.` : 'Nothing had to be repaired.'}
      </Alert>

      <div className="v2-tiles">
        <div className="v2-tile" data-testid="res-new"><b>{i.dms.length}</b><span>data modules added</span></div>
        {i.overwritten.length ? <div className="v2-tile" data-testid="res-replaced"><b>{i.overwritten.length}</b><span>replaced</span></div> : null}
        <div className="v2-tile" data-testid="res-media"><b>{i.media.length}</b><span>graphics written</span></div>
        <div className="v2-tile" data-testid="res-changes"><b>{made}</b><span>repairs made</span></div>
        <div className="v2-tile" data-testid="res-placeholders"><b>{result.placeholders.length}</b><span>placeholder graphics</span></div>
        <div className="v2-tile" data-testid="res-pool"><b>{unassigned ?? '…'}</b><span>not in the publication</span></div>
      </div>
      <div className="v2-hint" data-testid="result-publication">Publication: {pubText}.</div>

      {result.placeholders.length ? (
        <Alert tone="warn"><strong>{plural(result.placeholders.length, 'graphic')} {result.placeholders.length === 1 ? 'was' : 'were'} not in the package.</strong> A labelled placeholder image stands in {result.placeholders.length === 1 ? 'for it' : 'for each'}; replace {result.placeholders.length === 1 ? 'it' : 'them'} with the real artwork on the Graphics page.</Alert>
      ) : null}
      {result.withProblems.length ? (
        <Alert tone="warn"><strong>{plural(result.withProblems.length, 'imported module')} {result.withProblems.length === 1 ? 'has' : 'have'} problems with its enterprise or content checks</strong> and will fail validation until fixed:
          <div style={{ marginTop: 6 }}><CappedList items={result.withProblems} initial={5} page={50} noun="modules" testid="result-problems" render={(p) => <><span className="v2-mono">{p.file}</span><span>{p.problem}</span></>} /></div>
        </Alert>
      ) : null}

      <Section title="Change log" count={result.changeLog.length} tone={made ? 'accent' : undefined} defaultOpen={groups.length > 0 && groups.length <= 6} testid="sec-changelog">
        {groups.length === 0 ? <span className="v2-hint">No file was changed.</span> : (
          <div className="v2-stack" style={{ gap: 8 }}>
            <p className="v2-hint" style={{ margin: 0 }}>The original bytes of every changed file are kept in <span className="v2-mono">{result.originals}</span> in the project folder, with this log.</p>
            {groups.map((g) => (
              <Section key={g.rule} title={g.title} count={`${g.total} in ${plural(g.files.length, 'file')}`} tone={g.synthetic ? 'warn' : 'accent'} testid="changelog-rule">
                <p className="v2-hint" style={{ marginTop: 0 }}>{[g.edits ? `${plural(g.edits, 'edit')}` : '', g.adds ? `${plural(g.adds, 'file')} created` : '', g.notes ? `${plural(g.notes, 'note')} (a decision, no file changed)` : '', g.synthetic ? `${g.synthetic} made up by the importer rather than corrected` : ''].filter(Boolean).join(' · ')}</p>
                <CappedList items={g.files} initial={8} page={50} noun="files" render={(f) => (
                  <details style={{ width: '100%' }}>
                    <summary style={{ cursor: 'pointer' }}><span className="v2-mono" title={f.file}>{baseName(f.file)}</span> <span className="v2-hint">{plural(f.entries.length, 'change')}</span></summary>
                    <div style={{ marginTop: 4 }}>
                      <CappedList items={f.entries} initial={5} page={50} noun="changes" render={(c) => (
                        <div style={{ width: '100%' }}>
                          <div className="v2-row wrap" style={{ gap: 6 }}><Badge tone={c.synthetic ? 'warn' : undefined}>{KIND[c.kind]}{c.synthetic ? ', made up' : ''}</Badge>{c.where ? <span className="v2-hint">{c.where}</span> : null}{c.line ? <span className="v2-hint">line {c.line}</span> : null}</div>
                          {c.before ? <div className="v2-diff before" title="Before">{truncate(c.before, 400)}</div> : null}
                          {c.after ? <div className="v2-diff after" title="After">{truncate(c.after, 400)}</div> : null}
                        </div>
                      )} />
                    </div>
                  </details>
                )} />
              </Section>
            ))}
          </div>
        )}
      </Section>

      <Section title="Files written" count={i.dms.length + i.overwritten.length + i.media.length} testid="sec-written">
        {i.dms.length ? <><h4 style={{ margin: '0 0 4px' }}>Data modules added ({i.dms.length})</h4><CappedList items={i.dms} noun="modules" testid="written-dms" render={(n: string) => <span className="v2-mono">{n}</span>} /></> : null}
        {i.overwritten.length ? <><h4 style={{ margin: '10px 0 4px' }}>Data modules replaced ({i.overwritten.length})</h4><CappedList items={i.overwritten} noun="modules" render={(n: string) => <span className="v2-mono">{n}</span>} /></> : null}
        {i.media.length ? <><h4 style={{ margin: '10px 0 4px' }}>Graphics written ({i.media.length})</h4><CappedList items={i.media} noun="graphics" initial={10} render={(n: string) => <span className="v2-mono">{n}</span>} /></> : null}
        {i.mediaKept.length ? <><h4 style={{ margin: '10px 0 4px' }}>Graphics left as they were ({i.mediaKept.length})</h4><p className="v2-hint" style={{ margin: '0 0 4px' }}>The project already had a different file of that name; a placeholder never replaces a real image.</p><CappedList items={i.mediaKept} noun="graphics" initial={10} render={(n: string) => <span className="v2-mono">{n}</span>} /></> : null}
        {i.skipped.length ? <><h4 style={{ margin: '10px 0 4px' }}>Files not imported ({i.skipped.length})</h4><p className="v2-hint" style={{ margin: '0 0 4px' }}>Not data modules or graphics (publication modules are read for their structure, not stored as files).</p><CappedList items={i.skipped} noun="files" initial={10} render={(n: string) => <span className="v2-mono" title={n}>{baseName(n)}</span>} /></> : null}
      </Section>

    </div>
  );
}

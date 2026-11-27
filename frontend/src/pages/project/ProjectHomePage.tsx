// WP-22 (UX-007, 06 sections 6.4 and 6.5): the Project Home. One screen answers "what is the state of this manual and what is next", for
// the three formats, with an action on every card:
//
//   Continue   the data module this person last had open (S1000D), or the document (JSS, JSG): one click into the editor
//   Check      the last check's errors and warnings and how many the team marked reviewed; Run check (S1000D) or Check in the editor
//   Review     the review state, the round and the open comments; Submit for review / decide on the Release page
//   Build      the last PDF built; Build a draft on the Publication page
//
// "Needs attention" lists what waits for this person (open comments, errors, a release waiting for a decision, modules not placed), each a
// link to the place it is fixed. It reuses what the project already reports (the summary, the activity of the last week for those who may
// see it); no number here is computed differently from the page it links to.
//
// Decision (WP-22, recorded in the implementation log): opening a project still lands in the Editor, the owner's standing rule (the 00-platform
// suite guards it); the Project Home is the first item of the rail, one click away, and the switcher (Ctrl+K) opens it by name.

import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { contentApi, teamApi } from '../../api';
import { Icon, type IconName } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { formatLabel } from '../../components/project';
import { Badge, Spinner, ago, errText, fmtDate, fmtSize, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { actionLabel, isFeedNoise } from '../../lib/activity';
import { lastDoc } from '../../lib/continueDoc';
import { countLabel } from '../../lib/problems';
import { PROJECT_LABEL, may } from '../../lib/roles';
import { useUi } from '../../store/ui';

const REVIEW_WORDS: Record<string, string> = { draft: 'Not submitted', in_review: 'Waiting for the Project Manager', changes_requested: 'Changes requested', approved: 'Approved and released' };

function HomeCard({ icon, title, testId, children, action }: { icon: IconName; title: string; testId: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="v2-card v2-home-card" data-testid={testId} aria-labelledby={`${testId}-h`}>
      <div className="v2-home-card-head"><span className="v2-home-ic"><Icon name={icon} size={16} /></span><h2 id={`${testId}-h`}>{title}</h2></div>
      <div className="v2-home-card-body">{children}</div>
      {action ? <div className="v2-home-card-act">{action}</div> : null}
    </section>
  );
}

export function ProjectHomePage() {
  const { id, summary, role, can, reload } = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [checking, setChecking] = useState(false);
  const p = summary.project;
  const s1000d = (p.format ?? 's1000d') === 's1000d';
  const v = summary.validation;
  const rv = summary.review;
  const rel = summary.release;
  const cont = s1000d ? lastDoc(id) : null;
  const activity = useAsync(() => (may(can, 'activity.read') ? teamApi.projectActivity(id, 7) : Promise.resolve(null)), [id]);

  const runCheck = async () => {
    setChecking(true);
    try { const r = await contentApi.validate(id, {}); reload(); toast(r.summary.error ? `${r.summary.error} error${r.summary.error === 1 ? '' : 's'} found` : 'No errors found', r.summary.error ? 'error' : 'success'); }
    catch (e) { toast(errText(e), 'error'); } finally { setChecking(false); }
  };

  // what waits for this person, each with the place it is fixed
  const attention: Array<{ text: string; to: string; testId: string }> = [];
  if (rv && rv.open) attention.push({ text: `${rv.open} open review comment${rv.open === 1 ? '' : 's'}`, to: 'editor', testId: 'attn-comments' });
  if (rv?.state === 'changes_requested') attention.push({ text: 'The Project Manager sent the manual back: make the changes, then resubmit', to: 'release', testId: 'attn-changes' });
  if (rel?.pending && may(can, 'release.decide')) attention.push({ text: 'A release request is waiting for your decision', to: 'release', testId: 'attn-decide' });
  if (s1000d && v && v.error) attention.push({ text: `${countLabel({ error: v.error, warn: v.warn })} in the last check`, to: 'validation', testId: 'attn-errors' });
  const t = summary.publication?.totals;
  if (s1000d && t && t.unplaced) attention.push({ text: `${t.unplaced} data module${t.unplaced === 1 ? ' is' : 's are'} not in the publication`, to: 'publication', testId: 'attn-unplaced' });
  if (s1000d && t && t.missing) attention.push({ text: `${t.missing} publication entr${t.missing === 1 ? 'y names a module' : 'ies name modules'} the project does not have`, to: 'publication', testId: 'attn-missing' });
  if (rel?.stale) attention.push({ text: 'The content changed since the last release', to: 'release', testId: 'attn-stale' });

  const feed = (activity.data?.feed ?? []).filter((e) => !isFeedNoise(e.action)).slice(0, 8);

  return (
    <div className="v2-page" data-testid="project-home">
      <PageHeader icon="home" title={p.name}
        sub={<>{formatLabel(p)} · you are {PROJECT_LABEL[role].toLowerCase()} · {summary.members} member{summary.members === 1 ? '' : 's'}</>}
        actions={<button className="btn btn-primary" onClick={() => nav(cont ? `../editor?file=${encodeURIComponent(cont.file)}` : '../editor')} data-testid="home-open-editor"><Icon name="editor" />Open editor</button>} />

      <div className="v2-grid cols-4" style={{ marginBottom: 16 }}>
        <HomeCard icon="editor" title="Continue" testId="home-continue"
          action={<Link className="btn btn-sm" to={cont ? `../editor?file=${encodeURIComponent(cont.file)}` : '../editor'} data-testid="home-continue-open">{cont ? 'Continue' : 'Open the editor'}</Link>}>
          {cont ? <><div className="v2-trunc" title={cont.file}><b>{cont.title}</b></div><div className="v2-hint">opened {ago(cont.at)}</div></>
            : s1000d ? <div className="v2-hint">{summary.dataModules.total} data module{summary.dataModules.total === 1 ? '' : 's'}. Pick one in the editor.</div>
            : <div className="v2-hint">The whole document opens in the editor.</div>}
        </HomeCard>

        <HomeCard icon="shield" title="Check" testId="home-check"
          action={s1000d
            ? <span className="v2-row" style={{ gap: 6 }}>
                {may(can, 'validate.run') ? <button className="btn btn-sm" onClick={() => void runCheck()} disabled={checking} data-testid="home-run-check">{checking ? <Spinner /> : <Icon name="play" size={12} />}Run check</button> : null}
                <Link className="btn btn-sm" to="../validation" data-testid="home-open-check">Findings</Link>
              </span>
            : <Link className="btn btn-sm" to="../editor" data-testid="home-open-check">Check in the editor</Link>}>
          {s1000d ? (v ? <>
            <div><b data-testid="home-check-counts">{countLabel({ error: v.error, warn: v.warn }) || 'No errors or warnings'}</b></div>
            <div className="v2-hint">run {ago(v.ranAt)}{summary.problems?.reviewed ? ` · ${summary.problems.reviewed} marked reviewed` : ''}</div>
          </> : <div className="v2-hint" data-testid="home-check-counts">Not checked yet.</div>)
            : <div className="v2-hint" data-testid="home-check-counts">The document is checked in the editor (Check), and before every build.</div>}
        </HomeCard>

        <HomeCard icon="rocket" title="Review" testId="home-review"
          action={<Link className="btn btn-sm" to="../release" data-testid="home-open-review">{rv?.state === 'draft' && may(can, 'release.submit') ? 'Submit for review' : rel?.pending && may(can, 'release.decide') ? 'Decide' : 'Review and release'}</Link>}>
          <div><b data-testid="home-review-state">{rv ? REVIEW_WORDS[rv.state] ?? rv.state : '—'}</b></div>
          <div className="v2-hint">{rv ? `${rv.open} open comment${rv.open === 1 ? '' : 's'}${rv.round ? ` · round ${rv.round}` : ''}` : ''}{rel?.released && rel.number ? ` · release ${rel.number}` : ''}</div>
        </HomeCard>

        <HomeCard icon="book" title="Build" testId="home-build"
          action={<Link className="btn btn-sm" to="../publication" data-testid="home-open-build">{may(can, 'publish.build') ? 'Build a draft' : 'Publication'}</Link>}>
          {summary.build ? <><div><b data-testid="home-build-when" title={fmtDate(summary.build.builtAt)}>Built {ago(summary.build.builtAt)}</b></div><div className="v2-hint">{fmtSize(summary.build.size)}</div></>
            : <div><b data-testid="home-build-when">Never built</b></div>}
        </HomeCard>
      </div>

      <div className="v2-grid cols-2" style={{ alignItems: 'start' }}>
        <section className="v2-card" aria-labelledby="home-attn-h" data-testid="home-attention">
          <div className="v2-card-head"><h2 id="home-attn-h" className="v2-card-title">Needs attention</h2>{attention.length ? <Badge tone="warn">{attention.length}</Badge> : null}</div>
          {attention.length ? <ul className="v2-home-list">
            {attention.map((a) => <li key={a.testId}><Link to={`../${a.to}`} data-testid={a.testId}>{a.text}</Link></li>)}
          </ul> : <p className="v2-hint" style={{ padding: '10px 16px', margin: 0 }}>Nothing is waiting for you here.</p>}
        </section>
        {may(can, 'activity.read') ? (
          <section className="v2-card" aria-labelledby="home-act-h" data-testid="home-activity">
            <div className="v2-card-head"><h2 id="home-act-h" className="v2-card-title">This week</h2><Link className="v2-hint" to="../settings/activity">All activity</Link></div>
            {feed.length ? <ul className="v2-home-list">
              {feed.map((e) => <li key={e.id}><span className="v2-trunc">{e.actor ?? 'Someone'}: {actionLabel(e.action)}</span><span className="v2-hint" title={fmtDate(e.at)}>{ago(e.at)}</span></li>)}
            </ul> : <p className="v2-hint" style={{ padding: '10px 16px', margin: 0 }}>{activity.loading ? 'Loading…' : 'No activity in the last seven days.'}</p>}
          </section>
        ) : null}
      </div>
    </div>
  );
}

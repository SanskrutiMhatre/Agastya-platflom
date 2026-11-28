// WP-22 (UX-007, 06 sections 6.4 and 6.5): the Project Home. One screen answers "what is the state of this manual and what is next", for
// the three formats. UI redesign screen 2 (2026-11-28): laid out as the owner-approved mockup docs/audit/mockups/project.html: a header with
// the project's badges, the publish gate alert, the readiness strip, the areas of work, the status by chapter, the timeline and the team.
// The four readiness cells are the WP-22 cards, each keeping its action:
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
import { formatLabel } from '../../components/project';
import { Spinner, ago, errText, fmtDate, fmtSize, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { projectRailItems } from '../../layouts/projectRail';
import { actionLabel, isFeedNoise } from '../../lib/activity';
import { lastDoc } from '../../lib/continueDoc';
import { initials } from '../../lib/presence';
import { countLabel } from '../../lib/problems';
import { PROJECT_LABEL, may } from '../../lib/roles';
import { useUi } from '../../store/ui';
import '../../styles/pages/home.css';   // WP-35 second pass: the Home styles (and WorkingNow's title) load with this chunk
import { useSession } from '../../store/session';
import { WorkingNow } from '../../components/WorkingNow';
import { HomeChapters } from './HomeChapters';

const REVIEW_WORDS: Record<string, string> = { draft: 'Not submitted', in_review: 'Waiting for the Project Manager', changes_requested: 'Changes requested', approved: 'Approved and released' };
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/** One cell of the readiness strip (a WP-22 card): label, the big value, a line under it, and its action. */
function ReadyCell({ icon, title, testId, big, children, action }: { icon: IconName; title: string; testId: string; big: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="home-ready-cell" data-testid={testId} aria-labelledby={`${testId}-h`}>
      <h2 className="lab" id={`${testId}-h`}><Icon name={icon} size={14} />{title}</h2>
      <div className="big">{big}</div>
      <div className="home-ready-sub">{children}</div>
      {action ? <div className="home-ready-act">{action}</div> : null}
    </section>
  );
}

const TILE_TEXT: Record<string, string> = {
  Editor: 'Write and edit the content with live checks.',
  Explore: 'The chapters and the modules in them.',
  Publication: 'Arrange the chapters and build the PDF.',
  Graphics: 'The illustrations this project uses.',
  'Ancillary pages': 'Cover, front matter and the other pages around the content.',
  Validation: 'Schema, BREX and link checks.',
  Release: 'Submit for approval, watermark, release log.',
};
const FEED_TONE = (a: string): string => (/publish|build/i.test(a) ? 'success' : /valid|check/i.test(a) ? 'info' : /release|approv/i.test(a) ? 'accent' : '');

export function ProjectHomePage() {
  const { id, summary, role, can, reload } = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const me = useSession((s) => s.user);
  const [checking, setChecking] = useState(false);
  const p = summary.project;
  const s1000d = (p.format ?? 's1000d') === 's1000d';
  const v = summary.validation;
  const rv = summary.review;
  const rel = summary.release;
  const t = summary.publication?.totals;
  const cont = s1000d ? lastDoc(id) : null;
  const editorTo = cont ? `../editor?file=${encodeURIComponent(cont.file)}` : '../editor';
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
  if (s1000d && t && t.unplaced) attention.push({ text: `${t.unplaced} data module${t.unplaced === 1 ? ' is' : 's are'} not in the publication`, to: 'publication', testId: 'attn-unplaced' });
  if (s1000d && t && t.missing) attention.push({ text: `${t.missing} publication entr${t.missing === 1 ? 'y names a module' : 'ies name modules'} the project does not have`, to: 'publication', testId: 'attn-missing' });
  if (rel?.stale) attention.push({ text: 'The content changed since the last release', to: 'release', testId: 'attn-stale' });

  const feed = (activity.data?.feed ?? []).filter((e) => !isFeedNoise(e.action)).slice(0, 8);
  const team = activity.data?.projects.find((x) => x.id === id)?.members ?? activity.data?.projects[0]?.members ?? [];

  // the release badge of the header
  const relBadge = rel?.pending ? { tone: 'warning', text: 'Release waiting for a decision' }
    : rel?.released && rel.stale ? { tone: 'warning', text: `Changed since release ${rel.number ?? ''}`.trim() }
    : rel?.released ? { tone: 'success', text: `Released${rel.number ? ` ${rel.number}` : ''}` }
    : { tone: 'warning', text: 'Not released' };

  // the publish gate: a release (and an approval) re-runs the checks; errors refuse it. The alert shows what the last check found.
  const gate = !s1000d
    ? { tone: 'info', icon: 'info' as IconName, head: 'Publish gate.', text: 'The document is checked in the editor (Check), and again before every build.' }
    : !v ? { tone: 'info', icon: 'info' as IconName, head: 'Publish gate: not checked yet.', text: 'Run a check to see whether a release can be built.' }
    : v.error ? { tone: 'danger', icon: 'alert' as IconName, head: 'Publish gate: blocked.', text: `The last check found ${plural(v.error, 'error')}: they must be fixed before a release can be built.` }
    : { tone: 'success', icon: 'ok' as IconName, head: 'Publish gate: clear.', text: `The last check found no errors${v.warn ? ` (${plural(v.warn, 'warning')})` : ''}.` };

  const tiles = projectRailItems(id, summary).filter((i) => !/\/(home|settings)$/.test(i.to));
  const tileStat = (label: string): ReactNode => {
    switch (label) {
      case 'Editor': return s1000d ? <span>{plural(summary.dataModules.total, 'data module')}</span> : <span>One document</span>;
      case 'Explore': return summary.publication ? <><span>{plural(summary.publication.chapters, 'chapter')}</span>{t?.unplaced ? <span className="badge warning">{t.unplaced} not placed</span> : null}</> : null;
      case 'Publication': return summary.build ? <span className="badge success">Built {ago(summary.build.builtAt)}</span> : <span className="badge">Never built</span>;
      case 'Validation': return v ? (v.error || v.warn ? <>{v.error ? <span className="badge danger">{plural(v.error, 'error')}</span> : null}{v.warn ? <span>{plural(v.warn, 'warning')}</span> : null}</> : <span className="badge success">Clean</span>) : <span className="badge">Not checked</span>;
      case 'Release': return <><span className="badge">{rv ? REVIEW_WORDS[rv.state] ?? rv.state : relBadge.text}</span>{rel?.released && rel.number ? <span>release {rel.number}</span> : null}</>;
      default: return null;
    }
  };

  return (
    <div className="v2-page v2-home" data-testid="project-home">
      <div className="home-head">
        <div className="home-head-text">
          <h1>{p.name}</h1>
          <div className="meta">
            <span className="badge accent">{formatLabel(p)}</span>
            <span className={`badge ${relBadge.tone}`} data-testid="home-release-badge">{relBadge.text}</span>
            <span>You are {PROJECT_LABEL[role].toLowerCase()}</span><span aria-hidden="true">·</span>
            <span>{plural(summary.members, 'member')}</span>
            {p.owners?.length ? <><span aria-hidden="true">·</span><span>Owner {p.owners.join(', ')}</span></> : null}
            <span aria-hidden="true">·</span><span title={fmtDate(p.updatedAt)}>Updated {ago(p.updatedAt)}</span>
          </div>
        </div>
        <div className="home-row">
          <button className="btn primary btn-primary" onClick={() => nav(editorTo)} data-testid="home-open-editor"><Icon name="editor" />Open editor</button>
        </div>
      </div>

      <div className={`alert ${gate.tone}`} role={gate.tone === 'danger' ? 'alert' : 'status'} data-testid="home-gate">
        <span className="ico"><Icon name={gate.icon} /></span>
        <div className="grow"><strong>{gate.head}</strong> {gate.text}{s1000d && v ? <> <Link to="../validation">Open the report</Link></> : null}</div>
      </div>

      <section className="card v2-card home-ready" aria-label="Publication readiness">
        <ReadyCell icon="editor" title="Continue" testId="home-continue"
          big={cont ? <span className="home-trunc" title={cont.file}>{cont.title}</span>
            : s1000d && t ? <>{t.placed} <span className="home-of">/ {t.dms} in the publication</span></>
            : s1000d ? <>{summary.dataModules.total} <span className="home-of">data module{summary.dataModules.total === 1 ? '' : 's'}</span></>
            : <span className="home-of-big">The document</span>}
          action={<Link className="btn sm btn-sm" to={editorTo} data-testid="home-continue-open">{cont ? 'Continue' : 'Open the editor'}</Link>}>
          {cont ? <span className="faint">opened {ago(cont.at)}</span>
            : s1000d && t ? <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={t.dms} aria-valuenow={t.placed} aria-label="Data modules in the publication"><i className="success" style={{ width: `${t.dms ? (t.placed / t.dms) * 100 : 0}%` }} /></div>
            : s1000d ? <span className="faint">Pick one in the editor.</span>
            : <span className="faint">The whole document opens in the editor.</span>}
        </ReadyCell>

        <ReadyCell icon="shield" title="Check" testId="home-check"
          big={s1000d && v ? (v.error ? <span className="home-bad">{v.error} <span className="home-of">error{v.error === 1 ? '' : 's'}</span></span> : <span className="home-good">No errors</span>)
            : <span className="home-of-big">{s1000d ? 'Not checked' : 'In the editor'}</span>}
          action={s1000d
            ? <>
                {may(can, 'validate.run') ? <button className="btn sm btn-sm" onClick={() => void runCheck()} disabled={checking} aria-busy={checking || undefined} data-testid="home-run-check">{checking ? <Spinner /> : <Icon name="play" size={12} />}Run check</button> : null}
                <Link className="btn sm btn-sm" to="../validation" data-testid="home-open-check">Findings</Link>
              </>
            : <Link className="btn sm btn-sm" to="../editor" data-testid="home-open-check">Check in the editor</Link>}>
          {s1000d ? (v ? <>
            <div><b data-testid="home-check-counts">{countLabel({ error: v.error, warn: v.warn }) || 'No errors or warnings'}</b></div>
            <div className="faint">run {ago(v.ranAt)}{summary.problems?.reviewed ? ` · ${summary.problems.reviewed} marked reviewed` : ''}</div>
          </> : <div className="faint" data-testid="home-check-counts">Not checked yet.</div>)
            : <div className="faint" data-testid="home-check-counts">The document is checked in the editor (Check), and before every build.</div>}
        </ReadyCell>

        <ReadyCell icon="stamp" title="Review" testId="home-review"
          big={<span className="home-of-big" data-testid="home-review-state">{rv ? REVIEW_WORDS[rv.state] ?? rv.state : '—'}</span>}
          action={<Link className="btn sm btn-sm" to="../release" data-testid="home-open-review">{rv?.state === 'draft' && may(can, 'release.submit') ? 'Submit for review' : rel?.pending && may(can, 'release.decide') ? 'Decide' : 'Review and release'}</Link>}>
          <span className="faint">{rv ? `${rv.open} open comment${rv.open === 1 ? '' : 's'}${rv.round ? ` · round ${rv.round}` : ''}` : ''}{rel?.released && rel.number ? ` · release ${rel.number}` : ''}</span>
        </ReadyCell>

        <ReadyCell icon="book" title="Last build" testId="home-build"
          big={summary.build ? <span className="home-of-big" data-testid="home-build-when" title={fmtDate(summary.build.builtAt)}>Built {ago(summary.build.builtAt)}</span>
            : <span className="home-of-big" data-testid="home-build-when">Never built</span>}
          action={<Link className="btn sm btn-sm" to="../publication" data-testid="home-open-build">{may(can, 'publish.build') ? 'Build a draft' : 'Publication'}</Link>}>
          {summary.build ? <span className="faint">{fmtSize(summary.build.size)}</span> : null}
        </ReadyCell>
      </section>

      <section className="home-tiles" aria-label="Areas of work">
        {tiles.map((i) => (
          <Link key={i.to} className="card v2-card link home-tile" to={i.to} data-testid={`home-tile-${i.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <span className="home-tile-ic"><Icon name={i.icon} size={18} /></span>
            <div><h3>{i.label === 'Release' ? 'Review and release' : i.label}</h3><p className="faint">{TILE_TEXT[i.label] ?? ''}</p></div>
            {tileStat(i.label) ? <div className="home-tile-stat">{tileStat(i.label)}</div> : null}
          </Link>
        ))}
      </section>

      <div className="home-cols">
        <div className="home-stack">
          <section className="card v2-card" aria-labelledby="home-attn-h" data-testid="home-attention">
            <div className="card-head"><h3 id="home-attn-h"><Icon name="warn" />Needs attention</h3>{attention.length ? <span className="badge warning">{attention.length}</span> : null}</div>
            {attention.length ? <ul className="home-list">
              {attention.map((a) => <li key={a.testId}><Link to={`../${a.to}`} data-testid={a.testId}>{a.text}</Link></li>)}
            </ul> : <p className="faint home-pad">Nothing is waiting for you here.</p>}
          </section>
          {s1000d && p.type !== 'CIR' ? <HomeChapters id={id} checked={!!v} /> : null}
        </div>
        <aside className="home-stack">
          {may(can, 'activity.read') ? (
            <section className="card v2-card" aria-labelledby="home-act-h" data-testid="home-activity">
              <div className="card-head"><h3 id="home-act-h"><Icon name="history" />This week</h3><Link to="../settings/activity">All activity</Link></div>
              {feed.length ? <ul className="home-tl">
                {feed.map((e) => <li key={e.id}><span className={`dot ${FEED_TONE(e.action)}`} /><div className="home-trunc"><strong>{actionLabel(e.action)}</strong> by {e.actor ?? 'someone'}<div className="faint" title={fmtDate(e.at)}>{ago(e.at)}</div></div></li>)}
              </ul> : <p className="faint home-pad">{activity.loading ? 'Loading…' : 'No activity in the last seven days.'}</p>}
            </section>
          ) : null}
          {may(can, 'activity.read') && team.length ? (
            <section className="card v2-card" aria-labelledby="home-members-h" data-testid="home-members">
              <div className="card-head"><h3 id="home-members-h"><Icon name="users" />Team</h3>
                {may(can, 'members.invite') ? <Link className="btn sm btn-sm" to="../settings/team" data-testid="home-invite"><Icon name="plus" size={12} />Invite</Link> : <Link to="../settings/team">All</Link>}</div>
              <ul className="home-team">
                {team.map((m) => (
                  <li key={m.userId}><span className="avatar" aria-hidden="true">{initials(m.fullName || m.username)}</span>
                    <div className="grow home-trunc"><div className="home-name">{m.fullName || m.username}</div><div className="faint">{m.edits ? `${plural(m.edits, 'edit')} this week` : 'No edits this week'}{m.lastActiveAt ? ` · active ${ago(m.lastActiveAt)}` : ''}</div></div>
                    <span className={`badge ${m.role === 'manager' || m.role === 'owner' ? 'info' : ''}`}>{PROJECT_LABEL[m.role]}</span></li>
                ))}
              </ul>
            </section>
          ) : null}
          <WorkingNow projectId={id} format={p.format ?? 's1000d'} canBreak={role === 'owner' || role === 'manager' || me?.role === 'admin'} />
        </aside>
      </div>
    </div>
  );
}

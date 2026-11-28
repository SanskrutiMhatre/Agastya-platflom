// WP-22 (UX-007, 06 sections 6.4 and 6.5): the Project Home. One screen answers "what is the state of this manual and what is next", for
// the three formats. UI redesign screen 2 (2026-11-28, second pass "exactly like the mockup"): the owner-approved mockup
// docs/audit/mockups/project.html, element for element: the header with the project's badges and Export, the publish gate alert, the
// readiness strip (four cells), the six areas of work, the status by chapter, the timeline and the team. Real data only: where the mockup
// draws a figure the platform does not record, the closest real figure is in its place (see the comments at each one).
//
// The four readiness cells are the WP-22 cards, each keeping its action (a small link on the cell's label row):
//
//   Modules complete / Continue   the data module this person last had open (S1000D), or the document (JSS, JSG): one click into the editor
//   Validation / Check            the last check's errors by source and the waived ones; Run check is the gate alert's button, the report its link
//   Review                        the review state, the round and the open comments; Submit for review / decide on the Release page
//   Last build                    the last PDF built, its pages and size; Build a draft on the Publication page
//
// "Needs attention" (what waits for this person: open comments, a release waiting for a decision, modules not placed ...) is a line of
// links in the gate alert, each to the place it is fixed. No number here is computed differently from the page it links to.
//
// Decision (WP-22, recorded in the implementation log): opening a project still lands in the Editor, the owner's standing rule (the 00-platform
// suite guards it); the Project Home is the first item of the rail, one click away, and the switcher (Ctrl+K) opens it by name.

import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { contentApi, graphicsApi, problemsApi, teamApi, type DmSummary, type Explore, type GlobalRole, type ProblemRow, type ProjectRole } from '../../api';
import { Icon, type IconName } from '../../components/Icon';
import { formatLabel } from '../../components/project';
import { ExportProjectButton } from '../../components/DocCodes';
import { ago, errText, fmtDate, fmtSize, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { projectRailItems } from '../../layouts/projectRail';
import { actionLabel, isFeedNoise } from '../../lib/activity';
import { lastDoc } from '../../lib/continueDoc';
import { initials } from '../../lib/presence';
import { GLOBAL_LABEL, may } from '../../lib/roles';
import { useUi } from '../../store/ui';
import '../../styles/pages/home.css';   // WP-35 second pass: the Home styles load with this chunk
import { useSession } from '../../store/session';
import { WorkingNow } from '../../components/WorkingNow';
import { HomeChapters } from './HomeChapters';

const REVIEW_WORDS: Record<string, string> = { draft: 'Not submitted', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved' };
const ROLE_WORD: Record<ProjectRole, string> = { owner: 'Owner', manager: 'Project manager', editor: 'Editor', reviewer: 'Reviewer', viewer: 'Viewer' };
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const Sep = () => <span aria-hidden="true">·</span>;

/**
 * One cell of the readiness strip (a WP-22 card): the label, the big value, a line under it, as the mockup draws it. The whole cell is the
 * card's action (a link, its verb in the tooltip and the accessible name), so the strip shows exactly what the mockup shows.
 */
function ReadyCell({ icon, title, testId, big, children, to, act, linkProps }: { icon: IconName; title: string; testId: string; big: ReactNode; children?: ReactNode; to: string; act: string; linkProps?: { 'data-testid': string } }) {
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-h`}>
      <Link className="cell" to={to} title={act} {...linkProps}>
        <span className="sr">{act}: </span>
        <div className="lab"><Icon name={icon} size={14} /><h2 id={`${testId}-h`}>{title}</h2></div>
        <div className="big">{big}</div>
        {children}
      </Link>
    </section>
  );
}

const TILE_TEXT: Record<string, string> = {
  Editor: 'Write and edit data modules with live validation.',
  Explore: 'Chapters, data modules and cross-references.',
  Publication: 'Arrange chapters and build the PDF.',
  Graphics: 'ICN library used by this project.',
  'Ancillary pages': 'Cover, front matter and the pages around the content.',
  Validation: 'XSD, BREX and link checks.',
  Release: 'Submit for approval, watermark, release log.',
};
const TILE_TEXT_DOC: Record<string, string> = { Editor: 'Write and edit the document with live checks.', Explore: 'The chapters of the document and their codes.', Graphics: 'The pictures this document uses.' };

/** The timeline's title for an audit action ("Publication built"); one without a title here is worded from the shared sentence. */
const TL_TITLE: Record<string, string> = {
  'publish.built': 'Publication built', 'jsg.built': 'Publication built', 'validation.run': 'Validation run', 'project.created': 'Project created',
  'project.imported': 'Project imported', 'project.exported': 'Project exported', 'dm.saved': 'Data module saved', 'dm.created': 'Data module created',
  'dm.deleted': 'Data module deleted', 'dm.imported': 'Data modules imported', 'package.imported': 'Package imported', 'pm.saved': 'Publication changed',
  'member.assigned': 'Member added', 'member.added': 'Member added', 'member.removed': 'Member removed', 'member.role_changed': 'Member role changed',
  'release.requested': 'Release requested', 'release.approved': 'Release approved', 'release.rejected': 'Release refused', 'release.issued': 'Release issued',
  'review.comment': 'Review comment', 'review.changes_requested': 'Changes requested', 'jss.saved': 'Document saved', 'jsg.saved': 'Document saved',
  'graphics.added': 'Graphic added', 'media.uploaded': 'Graphic uploaded', 'settings.saved': 'Settings changed', 'watermark.updated': 'Watermark changed',
};
const tlTitle = (a: string): string => TL_TITLE[a] ?? (() => { const s = actionLabel(a).replace(/\s+(of|in|to|into|for|from)$/, ''); return s.charAt(0).toUpperCase() + s.slice(1); })();
const TL_MANY: Record<string, string> = {
  'dm.saved': 'data modules saved', 'dm.created': 'data modules created', 'dm.deleted': 'data modules deleted', 'member.assigned': 'members added', 'member.added': 'members added',
  'graphics.added': 'graphics added', 'media.uploaded': 'graphics uploaded', 'review.comment': 'review comments', 'jss.saved': 'saves of the document', 'jsg.saved': 'saves of the document',
};
const tlTitleN = (a: string, n: number): string => (n === 1 ? tlTitle(a) : TL_MANY[a] ? `${n} ${TL_MANY[a]}` : `${tlTitle(a)} (${n} times)`);
const metaOf =(m: unknown): Record<string, unknown> => (m && typeof m === 'object' ? m as Record<string, unknown> : {});

interface Detail { ex: Explore | null; problems: ProblemRow[]; waived: number; dms: DmSummary[]; graphics: number | null }

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
  // the team's edits "this month" and the timeline: the project's activity of the last 30 days (for those who may see it)
  const activity = useAsync(() => (may(can, 'activity.read') ? teamApi.projectActivity(id, 30) : Promise.resolve(null)), [id, summary.build?.builtAt, v?.ranAt]);
  // S1000D: the chapters (Explore), the findings of the last check (Validation), the modules and the graphics, read once for the strip,
  // the tiles and the status by chapter; a part that fails is left out, not shown as zero
  const detail = useAsync<Detail | null>(async () => {
    if (!s1000d) return null;
    const [ex, pr, dms, gr] = await Promise.all([
      contentApi.explore(id).catch(() => null), problemsApi.list(id).catch(() => null), contentApi.dms(id).catch(() => [] as DmSummary[]), graphicsApi.list(id).catch(() => null),
    ]);
    return { ex, problems: pr?.problems ?? [], waived: pr?.summary.waived ?? 0, dms, graphics: gr ? gr.length : null };
  }, [id, v?.ranAt]);
  const d = detail.data;

  const runCheck = async () => {
    setChecking(true);
    try { const r = await contentApi.validate(id, {}); reload(); detail.reload(); toast(r.summary.error ? `${r.summary.error} error${r.summary.error === 1 ? '' : 's'} found` : 'No errors found', r.summary.error ? 'error' : 'success'); }
    catch (e) { toast(errText(e), 'error'); } finally { setChecking(false); }
  };

  // the findings of the last check that still count (a waived one does not, as on the Validation page)
  const open = (d?.problems ?? []).filter((x) => x.state !== 'waived');
  const errorsBy = (src: string[]): number => open.filter((x) => x.severity === 'error' && src.includes(x.source)).length;
  const errFiles = new Set(open.filter((x) => x.severity === 'error').map((x) => x.file.split(/[\\/]/).pop()));

  // what waits for this person, each with the place it is fixed (shown in the gate alert)
  const attention: Array<{ text: string; to: string; testId: string }> = [];
  if (rv && rv.open) attention.push({ text: `${rv.open} open review comment${rv.open === 1 ? '' : 's'}`, to: 'editor', testId: 'attn-comments' });
  if (rv?.state === 'changes_requested') attention.push({ text: 'The Project Manager sent the manual back: make the changes, then resubmit', to: 'release', testId: 'attn-changes' });
  if (rel?.pending && may(can, 'release.decide')) attention.push({ text: 'A release request is waiting for your decision', to: 'release', testId: 'attn-decide' });
  if (s1000d && t && t.unplaced) attention.push({ text: `${t.unplaced} data module${t.unplaced === 1 ? ' is' : 's are'} not in the publication`, to: 'publication', testId: 'attn-unplaced' });
  if (s1000d && t && t.missing) attention.push({ text: `${t.missing} publication entr${t.missing === 1 ? 'y names a module' : 'ies name modules'} the project does not have`, to: 'publication', testId: 'attn-missing' });
  if (rel?.stale) attention.push({ text: 'The content changed since the last release', to: 'release', testId: 'attn-stale' });

  const members = activity.data?.projects.find((x) => x.id === id)?.members ?? activity.data?.projects[0]?.members ?? [];
  const nameOf = (u: string | null): string => (u ? members.find((m) => m.username === u)?.fullName || u : 'someone');
  // the newest build in the timeline is the PDF on disk: its line shows the page count, as the mockup does
  const lastBuildEvent = (activity.data?.feed ?? []).find((x) => /^(publish|jsg)\.built$/.test(x.action))?.id;
  // the timeline: the last four events; a run of the same action by the same person is one line with its count ("3 data modules created")
  const feed: Array<NonNullable<typeof activity.data>['feed'][number] & { n: number }> = [];
  for (const e of (activity.data?.feed ?? []).filter((x) => !isFeedNoise(x.action))) {
    const last = feed[feed.length - 1];
    if (last && last.action === e.action && last.actor === e.actor && e.action !== 'validation.run' && !/\.built$/.test(e.action)) last.n++;
    else if (feed.length < 4) feed.push({ ...e, n: 1 }); else break;
  }

  // the release badge of the header
  const relBadge = rel?.pending ? { tone: 'warning', text: 'Release waiting for a decision' }
    : rel?.released && rel.stale ? { tone: 'warning', text: `Changed since release ${rel.number ?? ''}`.trim() }
    : rel?.released ? { tone: 'success', text: `Released${rel.number ? ` ${rel.number}` : ''}` }
    : { tone: 'warning', text: 'Not released' };

  // the publish gate: a release (and an approval) re-runs the checks; errors refuse it. The alert shows what the last check found.
  const gate = !s1000d
    ? { tone: 'info', icon: 'info' as IconName, head: 'Publish gate.', text: 'The document is checked in the editor (Check), and again before every build.' }
    : !v ? { tone: 'info', icon: 'info' as IconName, head: 'Publish gate: not checked yet.', text: 'Run a check to see whether a release can be built.' }
    : v.error ? { tone: 'danger', icon: 'xcircle' as IconName, head: 'Publish gate: blocked.', text: `${plural(v.error, 'validation error')} must be fixed before a release can be built.` }
    : { tone: 'success', icon: 'ok' as IconName, head: 'Publish gate: clear.', text: `The last check found no errors${v.warn ? ` (${plural(v.warn, 'warning')})` : ''}; a release can be built.` };
  const alertTone = gate.tone !== 'danger' && attention.length ? 'warning' : gate.tone;
  const alertIcon: IconName = alertTone === 'warning' ? 'warn' : gate.icon;

  // the readiness strip, S1000D: "complete" = in the publication and without errors in the last check
  const total = d?.dms.length ?? summary.dataModules.total;
  const placedFiles = new Set<string>();
  const walk = (ns: Explore['tree']) => { for (const n of ns) { if (n.kind === 'dm') placedFiles.add(n.file.split(/[\\/]/).pop() ?? n.file); else if (n.kind === 'chapter') walk(n.children); } };
  if (d?.ex) walk(d.ex.tree);
  const complete = d?.ex ? [...placedFiles].filter((f) => !errFiles.has(f)).length : (t?.placed ?? 0);
  const inWork = (d?.dms ?? []).filter((x) => x.inWork && x.inWork !== '00').length;
  const missingGraphics = errorsBy(['graphics', 'icn']);

  const tiles = projectRailItems(id, summary).filter((i) => !/\/(home|settings)$/.test(i.to));
  const tileStat = (label: string): ReactNode => {
    switch (label) {
      // mockup "42 drafts · 3 open tabs": the modules in work (not yet an issue) and the modules of the project
      case 'Editor': return s1000d ? <><span className={`badge${inWork ? ' warning' : ''}`}>{inWork} in work</span><span>{plural(total, 'data module')}</span></> : <span>One document</span>;
      // mockup "12 chapters · 0 orphan modules": the publication's chapters and the modules not placed in it
      case 'Explore': return summary.publication ? <><span>{plural(summary.publication.chapters, 'chapter')}</span>{s1000d ? <><Sep /><span>{t?.unplaced ?? 0} not placed</span></> : null}</> : null;
      case 'Publication': return summary.build ? <span className="badge success">Built {ago(summary.build.builtAt)}</span> : <span className="badge">Never built</span>;
      // mockup "86 graphics · 2 missing": the graphics of the project and the ones the last check found missing
      case 'Graphics': return d && d.graphics !== null ? <><span>{plural(d.graphics, 'graphic')}</span>{v ? <span className={`badge ${missingGraphics ? 'danger' : 'success'}`}>{missingGraphics} missing</span> : null}</> : null;
      case 'Validation': return v ? <><span className={`badge ${v.error ? 'danger' : 'success'}`}>{plural(v.error, 'error')}</span><span>{plural(v.warn, 'warning')}</span></> : <span className="badge">Not checked</span>;
      case 'Release': return <><span className="badge">{rv ? REVIEW_WORDS[rv.state] ?? rv.state : relBadge.text}</span>{rel?.released && rel.number ? <span>release {rel.number}</span> : null}</>;
      default: return null;
    }
  };

  const reviewAction = rv?.state === 'draft' && may(can, 'release.submit') ? 'Submit for review' : rel?.pending && may(can, 'release.decide') ? 'Decide' : 'Review and release';
  const buildFacts = summary.build ? [summary.build.pages ? plural(summary.build.pages, 'page') : null, fmtSize(summary.build.size)].filter(Boolean).join(' · ') : 'Build a draft on the Publication page';

  // the timeline card: in the right column beside the chapters (S1000D), in the left one where there is no chapters card (JSS, JSG)
  const timeline = may(can, 'activity.read') ? (
    <section className="card" aria-labelledby="home-act-h" data-testid="home-activity">
      <div className="card-head"><h3 id="home-act-h"><Icon name="history" />Timeline</h3><Link to="../settings/activity">All</Link></div>
      {feed.length ? <ul className="tl">
        {feed.map((e) => {
          const m = metaOf(e.meta);
          const tone = /^(publish|jsg)\.built$/.test(e.action) ? 'success' : e.action === 'validation.run' ? (Number(m.error) > 0 ? 'danger' : 'success') : /^(dm|package|pm|jss|jsg|graphics|media)\./.test(e.action) ? 'accent' : /^release\./.test(e.action) ? 'info' : '';
          const extra = e.action === 'validation.run' && typeof m.error === 'number' ? <> - {plural(m.error, 'error')}</> : null;
          const facts = [ago(e.at), e.id === lastBuildEvent && summary.build?.pages ? plural(summary.build.pages, 'page') : null, typeof m.ms === 'number' ? `${(m.ms / 1000).toFixed(m.ms < 10000 ? 1 : 0)} s` : null, typeof m.role === 'string' ? ROLE_WORD[m.role as ProjectRole] ?? m.role : null].filter(Boolean).join(' · ');
          return <li key={e.id}><span className={`dot ${tone}`} /><div className="trunc"><strong>{tlTitleN(e.action, e.n)}</strong>{extra} by {nameOf(e.actor)}<div className="faint" title={fmtDate(e.at)}>{facts}</div></div></li>;
        })}
      </ul> : <p className="faint pad">{activity.loading ? 'Loading…' : 'No activity in the last 30 days.'}</p>}
    </section>
  ) : null;

  return (
    <div className="v2-page v2-home" data-testid="project-home">
      <div className="proj-head">
        <div>
          <h1>{p.name}</h1>
          <div className="meta">
            <span className="badge accent">{s1000d && summary.s1000d ? `S1000D Issue ${summary.s1000d.issue}` : formatLabel(p)}</span>
            <span className={`badge ${relBadge.tone}`} data-testid="home-release-badge">{relBadge.text}</span>
            {s1000d && summary.s1000d?.mic ? <><span className="mono">MIC {summary.s1000d.mic}</span><Sep /></> : null}
            {p.owners?.length ? <><span>Owner {p.owners.join(', ')}</span><Sep /></> : null}
            <span title={fmtDate(p.updatedAt)}>Updated {ago(p.updatedAt)}</span>
          </div>
        </div>
        <div className="row">
          <ExportProjectButton id={id} small={false} label="Export project" />
          <button className="btn primary" onClick={() => nav(editorTo)} data-testid="home-open-editor"><Icon name="editor" />Open editor</button>
        </div>
      </div>

      <div className={`alert ${alertTone}`} role={gate.tone === 'danger' ? 'alert' : 'status'} data-testid="home-gate">
        <Icon name={alertIcon} className="ico" />
        <div className="grow">
          <strong>{gate.head}</strong> {gate.text}{' '}
          {s1000d ? <Link to="../validation" data-testid="home-open-check">{v ? 'Open the report' : 'Open the Validation page'}</Link> : <Link to="../editor" data-testid="home-open-check">Check in the editor</Link>}
          {attention.length ? (
            <span className="attn" data-testid="home-attention">
              <span className="sr">Needs attention: </span>
              {attention.map((a) => <span key={a.testId}><Sep /><Link to={`../${a.to}`} data-testid={a.testId}>{a.text}</Link></span>)}
            </span>
          ) : null}
        </div>
        {s1000d && may(can, 'validate.run') ? <button className="btn sm" onClick={() => void runCheck()} disabled={checking} aria-busy={checking || undefined} data-testid="home-run-check">Run check</button> : null}
      </div>

      <section className="card ready" aria-label="Publication readiness">
        {s1000d ? (
          <ReadyCell icon="fileCheck" title="Modules complete" testId="home-continue"
            to={editorTo} linkProps={{ 'data-testid': 'home-continue-open' }} act={cont ? `Continue with ${cont.title} (opened ${ago(cont.at)})` : 'Open the editor'}
            big={<span title="In the publication and without errors in the last check">{complete} <span className="faint of">/ {total}</span></span>}>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={complete} aria-label="Modules complete"><i className="success" style={{ width: `${total ? (complete / total) * 100 : 0}%` }} /></div>
          </ReadyCell>
        ) : (
          <ReadyCell icon="editor" title="Continue" testId="home-continue"
            to={editorTo} linkProps={{ 'data-testid': 'home-continue-open' }} act="Open the editor"
            big="The document">
            <div className="faint">The whole document opens in the editor.</div>
          </ReadyCell>
        )}

        <ReadyCell icon="shield" title={s1000d ? 'Validation' : 'Check'} testId="home-check"
          to={s1000d ? '../validation' : '../editor'} act={s1000d ? 'Open the validation report' : 'Check in the editor'}
          big={s1000d && v ? <span className={v.error ? 'bad' : 'good'}>{v.error} <span className="muted of">{v.error === 1 ? 'error' : 'errors'}</span></span>
            : s1000d ? 'Not checked' : 'In the editor'}>
          {s1000d ? (v ? <div className="faint" data-testid="home-check-counts" title={`run ${ago(v.ranAt)}`}>
            {d ? <>{errorsBy(['xsd'])} XSD <Sep /> {errorsBy(['brex'])} BREX{errorsBy(['xml', 'graphics', 'ids', 'icn', 'pm', 'applic']) ? <> <Sep /> {errorsBy(['xml', 'graphics', 'ids', 'icn', 'pm', 'applic'])} other</> : null} <Sep /> {d.waived} waived</> : `${plural(v.warn, 'warning')}`}
            {summary.problems?.reviewed ? <> <Sep /> {summary.problems.reviewed} reviewed</> : null}
          </div> : <div className="faint" data-testid="home-check-counts">Run a check to see the findings.</div>)
            : <div className="faint" data-testid="home-check-counts">Checked in the editor, and before every build.</div>}
        </ReadyCell>

        <ReadyCell icon="stamp" title="Review" testId="home-review"
          to="../release" linkProps={{ 'data-testid': 'home-open-review' }} act={reviewAction}
          big={<span data-testid="home-review-state">{rv ? REVIEW_WORDS[rv.state] ?? rv.state : '—'}</span>}>
          <div className="faint">{rv?.state === 'draft' ? (v?.error ? 'Submit when validation is clean' : `${plural(rv.open, 'open comment')} · ready to submit`)
            : rv ? `${plural(rv.open, 'open comment')}${rv.round ? ` · round ${rv.round}` : ''}` : ''}{rel?.released && rel.number ? ` · release ${rel.number}` : ''}</div>
        </ReadyCell>

        <ReadyCell icon="book" title="Last build" testId="home-build"
          to="../publication" linkProps={{ 'data-testid': 'home-open-build' }} act={may(can, 'publish.build') ? 'Build a draft on the Publication page' : 'Open the Publication page'}
          big={<span data-testid="home-build-when" title={summary.build ? fmtDate(summary.build.builtAt) : undefined}>{summary.build ? ago(summary.build.builtAt) : 'Never built'}</span>}>
          <div className="faint">{buildFacts}</div>
        </ReadyCell>
      </section>

      <section className="tiles" aria-label="Areas of work">
        {tiles.map((i) => (
          <Link key={i.to} className="card link tile" to={i.to} data-testid={`home-tile-${i.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <span className="tile-ic"><Icon name={i.icon} size={20} /></span>
            <div><h3>{i.label === 'Release' ? 'Review and release' : i.label}</h3><p className="muted">{(!s1000d && TILE_TEXT_DOC[i.label]) || TILE_TEXT[i.label] || ''}</p></div>
            {tileStat(i.label) ? <div className="tile-stat">{tileStat(i.label)}</div> : null}
          </Link>
        ))}
      </section>

      <div className="cols">
        <div className="stack">
          {s1000d && p.type !== 'CIR' ? <HomeChapters checked={!!v} data={d} error={detail.error} /> : timeline}
        </div>
        <aside className="stack">
          {s1000d && p.type !== 'CIR' ? timeline : null}
          <section className="card" aria-labelledby="home-members-h" data-testid="home-members">
            <div className="card-head"><h3 id="home-members-h"><Icon name="users" />Team</h3>
              {may(can, 'members.invite') ? <Link className="btn sm" to="../settings/team" data-testid="home-invite"><Icon name="plus" size={14} />Invite</Link> : <Link to="../settings/team">All</Link>}</div>
            {may(can, 'activity.read') && members.length ? (
              <ul className="team">
                {members.map((m) => (
                  <li key={m.userId}><span className="avatar" aria-hidden="true">{initials(m.fullName || m.username)}</span>
                    <div className="grow trunc"><div className="name">{m.fullName || m.username}</div><div className="faint" title={m.lastActiveAt ? `active ${ago(m.lastActiveAt)}` : undefined}>{ROLE_WORD[m.role]} · edits {m.edits} this month</div></div>
                    <span className={`badge${m.globalRole === 'project_manager' || m.globalRole === 'admin' ? ' info' : ''}`}>{GLOBAL_LABEL[m.globalRole as GlobalRole] ?? m.globalRole}</span></li>
                ))}
              </ul>
            ) : null}
            <WorkingNow projectId={id} format={p.format ?? 's1000d'} canBreak={role === 'owner' || role === 'manager' || me?.role === 'admin'} />
          </section>
        </aside>
      </div>
    </div>
  );
}

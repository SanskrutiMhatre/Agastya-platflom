// Project building blocks shared by Overview, Workspace and Projects.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ISSUE_OPTIONS, issueLabel, referenceApi, s1000dApi, workspaceApi, type FormatInfo, type NewProjectConfig, type PackageDetection, type ProjectCard, type ProjectRole } from '../api';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { Badge, ConfirmModal, Field, Modal, ago, errText, Alert, useAsync } from './ui';
import { refusalHint, refusalReasons, type RefusalReason } from './importRefusal';
import { xengineApi, type ConvertResult } from '../api/xengine';
import { FindingsList } from './DocCodes';
import { FORMAT_NAME, SOURCE_CHOICES, detectionSentence, guessedSource, sourceProblem, targetProblem, type SourceFormat } from './importSource';

const ROLE_TONE: Record<ProjectRole, 'accent' | 'ok' | 'warn' | undefined> = { owner: 'accent', manager: 'accent', editor: 'ok', reviewer: 'warn', viewer: undefined };
/** WP-22 (UX-024): the model code of the last S1000D project made in this browser, offered in the wizard */
const LAST_MIC = 'agastya.wizard.lastMic';
export const RoleBadge = ({ role }: { role: ProjectRole }) => <Badge tone={ROLE_TONE[role]}>{role === 'manager' ? 'project manager' : role}</Badge>;

/** What a card says about the project's format: S1000D, or JSS Land - User Handbook. Never the name of an engine. */
export const formatLabel = (p: Pick<ProjectCard, 'format' | 'domain' | 'manualType'>): string => (p.format === 's1000d' ? 'S1000D' : [p.format.toUpperCase(), p.domain ? p.domain[0].toUpperCase() + p.domain.slice(1) : '', p.manualType === 'uhb' ? 'User Handbook' : p.manualType ?? ''].filter(Boolean).join(' '));

export function ProjectCardView({ p, onOpen }: { p: ProjectCard; onOpen?: () => void }) {
  const nav = useNavigate();
  const open = () => { void workspaceApi.open(p.id).catch(() => undefined); onOpen?.(); nav(`/projects/${p.id}`); };
  return (
    <div className="v2-card v2-pcard" role="link" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }} aria-label={`Open project ${p.name}`} data-testid="project-card">
      <div className="v2-row v2-spread">
        <h3 className="v2-trunc">{p.name}</h3>
        <RoleBadge role={p.role} />
      </div>
      <div className="v2-row wrap">
        <Badge>{p.dmCount} data module{p.dmCount === 1 ? '' : 's'}</Badge>
        {p.hasPdf ? <Badge tone="ok"><Icon name="pdf" size={11} />PDF built</Badge> : null}
        <Badge>{formatLabel(p)}</Badge>
        {p.missingSince ? <Badge tone="bad" title={`The project folder was not found when the server started (${new Date(p.missingSince).toLocaleString()}). Nothing was deleted: restore the folder, or an administrator deletes the project.`}>Folder missing</Badge> : null}
      </div>
      <div className="v2-hint">{p.folder ? `in ${p.folder} · ` : ''}opened {ago(p.lastOpened ?? p.updatedAt)}{p.owners.length ? ` · owner ${p.owners[0]}` : ''}</div>
    </div>
  );
}

type StepId = 'start' | 'project' | 'model' | 'codes' | 'review' | 'import';
const TITLES: Record<StepId, string> = { start: 'How to start', project: 'Project', model: 'Model and identity', codes: 'Codes and structure', review: 'Review', import: 'Import a package' };

export function CreateProjectModal({ folders, defaultFolder = '', startWith, onClose, onCreated }: { folders: string[]; defaultFolder?: string; /** 'import': open on "Import a package" (the Projects page's Import package button) */ startWith?: 'import'; onClose: () => void; onCreated: (p: ProjectCard) => void }) {
  const toast = useUi((s) => s.toast);
  const nav = useNavigate();
  const [way, setWay] = useState<'create' | 'import' | null>(startWith === 'import' ? 'import' : null);
  const [stepId, setStepId] = useState<StepId>(startWith === 'import' ? 'import' : 'start');
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(defaultFolder);
  const [fmt, setFmt] = useState<'s1000d' | 'jss' | 'jsg'>('s1000d');
  const [domain, setDomain] = useState('');
  const [manualType, setManualType] = useState('');
  const [mic, setMic] = useState('');
  const [lastMic] = useState(() => { try { return localStorage.getItem(LAST_MIC) ?? ''; } catch { return ''; } });
  const [issue, setIssue] = useState('4-2');
  const [language, setLanguage] = useState('en');
  const [country, setCountry] = useState('IN');
  const [rpc, setRpc] = useState({ code: '', name: '' });
  const [org, setOrg] = useState({ code: '', name: '' });
  const [security, setSecurity] = useState('01');
  const [brexMode, setBrexMode] = useState<'default' | 'project'>('default');
  const [brexDmc, setBrexDmc] = useState('');
  const [codeMode, setCodeMode] = useState<'all' | 'selected'>('all');
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [codeQ, setCodeQ] = useState('');
  const [preset, setPreset] = useState('');
  const [snsEnforced, setSnsEnforced] = useState(true);
  const [types, setTypes] = useState<Set<string> | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [found, setFound] = useState<PackageDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  // An import is asked about in two steps: what the file IS (the server's guess, which the person confirms or corrects), then what it is to BECOME (the manual type below).
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<SourceFormat | ''>('');
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<ConvertResult | null>(null);   // a conversion's result: the new project and what could not be carried over
  const formats = useAsync(() => workspaceApi.formats(), []);
  const ref = useAsync(() => referenceApi.get(), []);
  const presets = useAsync(() => s1000dApi.presets(), []);
  const catalogue = useAsync(() => s1000dApi.catalogue(issue, 'infoCode'), [issue]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [refusal, setRefusal] = useState<RefusalReason[]>([]);   // why the server refused the package (grouped), shown under the error

  // the SNS an Administrator built for this model code is offered as soon as the code is known (the author can still choose another or none)
  const [presetTouched, setPresetTouched] = useState(false);
  const modelPreset = (presets.data ?? []).find((p) => p.model && p.model === mic.trim().toUpperCase());
  useEffect(() => { if (stepId === 'codes' && modelPreset && !presetTouched && !preset) setPreset(modelPreset.id); }, [stepId, modelPreset, presetTouched, preset]);
  const fi: FormatInfo | undefined = formats.data?.find((f) => f.id === fmt);
  const dom = fi?.domains.find((d) => d.id === domain);
  const dmTypes = ref.data?.dmTypes ?? [];
  const allTypes = types ?? new Set(dmTypes.map((t) => t.schema));
  const recommended = useMemo(() => new Set(dmTypes.map((t) => t.infoCode ?? '').filter(Boolean)), [dmTypes]);
  const shown = useMemo(() => (catalogue.data?.codes ?? []).filter((c) => !codeQ || `${c.code} ${c.title}`.toLowerCase().includes(codeQ.toLowerCase())), [catalogue.data, codeQ]);

  /** The steps of the chosen way: a document format has no S1000D identity or codes; an import has one step. */
  const order = (): StepId[] => (way === 'import' ? ['start', 'import'] : fmt === 's1000d' ? ['start', 'project', 'model', 'codes', 'review'] : ['start', 'project', 'review']);
  const pos = order().indexOf(stepId);
  const last = pos === order().length - 1;
  const pickFormat = (f: 's1000d' | 'jss' | 'jsg') => { setFmt(f); setDomain(''); setManualType(''); };

  const config = (): NewProjectConfig => ({
    mic: mic.trim().toUpperCase(), issue, language: language.trim().toLowerCase(), country: country.trim().toUpperCase(), security,
    responsiblePartner: { code: rpc.code.trim().toUpperCase(), name: rpc.name.trim() }, originator: { code: org.code.trim().toUpperCase(), name: org.name.trim() },
    brex: { mode: brexMode, dmc: brexMode === 'project' ? brexDmc.trim() : null },
    codeMode, ...(codeMode === 'selected' ? { enabledCodes: [...codes] } : {}), snsEnforced,
    ...(preset ? { snsPreset: preset } : {}), ...(types && types.size !== dmTypes.length ? { dmTypes: [...types] } : {}),
  });
  const formatProblem = (): string => {
    if (fmt === 's1000d') return '';
    if (!fi?.domains.length) return '';
    if (!domain) return `Choose Land or Naval for the ${fi.label} manual.`;
    if (!manualType) return 'Choose the type of manual.';
    if (!dom?.manualTypes.find((m) => m.id === manualType)?.ready) return 'That manual type is not available yet.';
    return '';
  };
  const problem = (s: StepId): string => {
    if (s === 'project') { if (!name.trim()) return 'Enter a project name.'; return formatProblem(); }
    if (s === 'model') {
      if (!/^[A-Za-z0-9]{2,14}$/.test(mic.trim())) return 'The model code is 2 to 14 letters or digits.';
      if (!/^[A-Za-z0-9]{5}$/.test(rpc.code.trim())) return 'The responsible partner company code is 5 letters or digits.';
      if (!rpc.name.trim()) return 'Enter the responsible partner company name.';
      if (org.code.trim() && (!/^[A-Za-z0-9]{5}$/.test(org.code.trim()) || !org.name.trim())) return 'The originator needs a 5-character code and a name, or leave both empty.';
      if (brexMode === 'project' && !brexDmc.trim()) return 'Enter the project BREX data module code.';
    }
    if (s === 'codes' && codeMode === 'selected' && !codes.size) return 'Choose at least one information code, or offer every code.';
    if (s === 'import') {
      if (!found || !file) return 'Choose a package (.zip) or a document (.xml).';
      const sp = sourceProblem(file.name, source, found); if (sp) return sp;
      if (!confirmed) return 'Confirm what this file is.';
      if (!name.trim()) return 'Enter a project name.';
      const tp = targetProblem(source as SourceFormat, fmt, manualType, found); if (tp) return tp;
      return found.archive ? '' : formatProblem();
    }
    return '';
  };
  const next = async () => {
    const p = problem(stepId); if (p) { setErr(p); return; }
    setErr('');
    if (stepId === 'codes') { try { const r = await s1000dApi.validateConfig(config()); setNotes(r.notes); } catch (e) { setErr(errText(e)); return; } }
    setStepId(order()[pos + 1]);
  };
  const back = () => { setErr(''); setStepId(order()[pos - 1]); };
  const choose = (w: 'create' | 'import') => { setWay(w); setStepId(w === 'import' ? 'import' : 'project'); };

  const submit = async () => {
    const p = problem(stepId === 'import' ? 'import' : 'project'); if (p) { setErr(p); return; }
    setBusy(true); setErr(''); setRefusal([]);
    try {
      if (way === 'import') {
        // one importer for every pair of formats (services/xengine): S1000D into S1000D is the platform's current package importer, the others convert. The result lists what was repaired, set aside or could not be carried over, so it is shown before the project is opened
        setDone(await xengineApi.importAs(file!, source as SourceFormat, fmt, name.trim(), { folder: folder.trim(), ...(fmt !== 's1000d' ? { domain, manualType } : {}) }));
        setBusy(false); return;
      }
      const card: ProjectCard = await workspaceApi.createProject({ name: name.trim(), folder: folder.trim(), format: fmt, ...(fmt === 's1000d' ? { s1000d: config() } : { domain, manualType }) });
      if (fmt === 's1000d' && mic.trim()) { try { localStorage.setItem(LAST_MIC, mic.trim().toUpperCase()); } catch { /* private mode */ } }
      toast(`Created "${card.name}"`, 'success');
      onCreated(card); onClose();
    } catch (e) {
      // a refused package: the reasons are in the response, and the author needs to read them (this used to say "the report says why" with no report to read)
      const why = refusalReasons(e);
      setRefusal(why); setErr(why.length ? 'The package was not imported, so no project was created.' : errText(e)); setBusy(false);
    }
  };
  const chosenFile = async (f: File | undefined) => {
    if (!f) return; setErr(''); setRefusal([]); setFound(null); setDetecting(true); setFile(f); setSource(''); setConfirmed(false);
    try { const d = await workspaceApi.detectPackage(f); setFound(d); setSource(guessedSource(d)); if (d.archive) { setFmt(d.archive.format); setDomain(d.archive.domain ?? ''); setManualType(d.archive.manualType ?? ''); } if (!name.trim()) setName(f.name.replace(/(\.jsspub)?\.(zip|xml)$/i, '')); }   // a guess only: nothing is chosen for the person, and the target is left as it was
    catch (e) { setErr(errText(e)); setFile(null); } finally { setDetecting(false); }
  };
  /** Leaving the result of a conversion: the lists behind the dialog learn of the new project. */
  const leave = () => { if (done) onCreated(done.project); onClose(); };
  // WP-23 (UX-004): Escape, the close button or a click beside the dialog no longer throw away a wizard that holds input; they ask first.
  // The Cancel button is the explicit way out and closes at once (decision recorded in the implementation log).
  const [askDiscard, setAskDiscard] = useState(false);
  const holdsInput = !done && (!!name.trim() || !!file || !!mic.trim() || !!rpc.code.trim() || !!org.code.trim());
  const requestClose = () => { if (holdsInput) setAskDiscard(true); else onClose(); };

  const rpcPick = (list: Array<{ cage: string; name: string }> | undefined, v: { code: string; name: string }, set: (x: { code: string; name: string }) => void, optional: boolean) =>
    list?.length ? (
      <select className="v2-select" value={v.code} onChange={(e) => set({ code: e.target.value, name: list.find((x) => x.cage === e.target.value)?.name ?? '' })}>
        <option value="">{optional ? '(same as the responsible partner)' : '(choose)'}</option>{list.map((x) => <option key={x.cage} value={x.cage}>{x.cage} – {x.name}</option>)}
      </select>
    ) : <div><div className="v2-grid cols-2"><input className="v2-input v2-mono" maxLength={5} placeholder="CAGE code, e.g. K0378" value={v.code} onChange={(e) => set({ ...v, code: e.target.value })} aria-label="Enterprise code" title="The enterprise's CAGE code: exactly 5 capital letters or digits" /><input className="v2-input" placeholder="Name, e.g. Agastya Systems" value={v.name} onChange={(e) => set({ ...v, name: e.target.value })} aria-label="Enterprise name" /></div>
      <div className="v2-hint" style={{ marginTop: 4 }}>The CAGE code: exactly 5 capital letters or digits, for example K0378.</div></div>;

  /** Format, then (for JSS / JSG) domain and manual type: the three questions that decide the project's kind. Nothing about engines. */
  const formatPicker = (
    <>
      <Field label={way === 'import' ? 'Import it as' : 'Manual type'} hint={way === 'import' ? 'The kind of project to make from the file. Choose a different kind from the file\'s own to convert it.' : 'What kind of publication this project makes.'}>
        <div className="v2-row wrap" role="radiogroup" aria-label="Format">
          {(formats.data ?? []).map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={fmt === f.id} disabled={!f.ready && f.id !== 'jss'} data-testid={`wiz-format-${f.id}`} className={`btn ${fmt === f.id ? 'btn-primary' : ''}`} title={f.ready ? f.description : `${f.description} Coming soon.`} onClick={() => pickFormat(f.id)}>{f.label}{f.ready ? '' : ' (coming soon)'}</button>
          ))}
        </div>
      </Field>
      {fi && fi.domains.length ? (
        <div className="v2-grid cols-2">
          <Field label="Domain"><select className="v2-select" value={domain} onChange={(e) => { setDomain(e.target.value); setManualType(''); }} data-testid="wiz-domain"><option value="">(choose)</option>{fi.domains.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Field>
          <Field label="Type of manual"><select className="v2-select" value={manualType} disabled={!dom} onChange={(e) => setManualType(e.target.value)} data-testid="wiz-manual-type"><option value="">(choose)</option>{(dom?.manualTypes ?? []).map((m) => <option key={m.id} value={m.id} disabled={!m.ready} title={m.ready ? m.note : m.notReady}>{m.label}{m.ready ? (m.note ? ' (draft outline)' : '') : ' - coming soon'}</option>)}</select>{(dom?.manualTypes ?? []).find((m) => m.id === manualType)?.note ? <small className="v2-hint">{(dom?.manualTypes ?? []).find((m) => m.id === manualType)?.note}</small> : null}</Field>
        </div>
      ) : null}
    </>
  );
  const nameAndFolder = (
    <>
      <Field label="Project name" hint="Shown on the project card and on the book's title page."><input className="v2-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="wiz-name" /></Field>
      <Field label="Workspace folder" hint="Folders group projects in the Workspace. Type a new name to create one.">
        <input className="v2-input" list="v2-folders" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="(no folder)" />
        <datalist id="v2-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
      </Field>
    </>
  );

  return (<>
    <Modal title={done ? 'Import finished' : `New project — ${TITLES[stepId]}${order().length > 2 ? ` (${pos + 1} of ${order().length})` : ''}`} onClose={done ? leave : requestClose} width={680} buttons={done ? <>
      <button className="btn" onClick={leave} data-testid="wiz-done-close">Close</button>
      <button className="btn btn-primary" onClick={() => { leave(); nav(`/projects/${done.project.id}`); }} data-testid="wiz-done-open">Open “{done.project.name}”</button>
    </> : <>
      <button className="btn" onClick={onClose}>Cancel</button>
      {pos > 0 ? <button className="btn" onClick={back} data-testid="wiz-back">Back</button> : null}
      {stepId === 'start' ? null : last ? <button className="btn btn-primary" disabled={busy || detecting || (way === 'import' && !confirmed)} onClick={submit} data-testid="wiz-create">{busy ? 'Working…' : way === 'import' ? 'Import and create project' : 'Create project'}</button> : <button className="btn btn-primary" onClick={() => void next()} data-testid="wiz-next">Next</button>}
    </>}>
      <div className="v2-stack" data-testid={`wiz-step-${stepId}`}>
        {stepId === 'start' ? (
          <div className="v2-grid cols-2">
            <button type="button" className="v2-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => choose('create')} data-testid="wiz-start-create"><h3 style={{ marginTop: 0 }}>Create a new project</h3><p className="v2-hint" style={{ margin: 0 }}>Start empty and write the manual here.</p></button>
            <button type="button" className="v2-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => choose('import')} data-testid="wiz-start-import"><h3 style={{ marginTop: 0 }}>Import a package (.zip)</h3><p className="v2-hint" style={{ margin: 0 }}>Bring in an existing manual. Its model code, issue and structure are read from the package, so nothing can disagree later.</p></button>
          </div>
        ) : null}
        {stepId === 'project' ? (<>{nameAndFolder}{formatPicker}</>) : null}
        {done ? (<>
          <p data-testid="wiz-done">A new {FORMAT_NAME[done.to]} project, <b>{done.project.name}</b>, was made from {FORMAT_NAME[done.from]} content: {done.restored ? `restored from a project archive (${done.restored.files} file${done.restored.files === 1 ? '' : 's'}${done.restored.comments ? `, ${done.restored.comments} review comment${done.restored.comments === 1 ? '' : 's'}` : ''})` : null}{done.restored ? null : <>{done.counts.sections} {done.to === 's1000d' ? 'data module' : 'section'}{done.counts.sections === 1 ? '' : 's'}{done.counts.pictures ? `, ${done.counts.pictures} ${done.to === 's1000d' ? 'graphic' : 'picture'}${done.counts.pictures === 1 ? '' : 's'}` : ''}</>}.</p>
          <div data-testid="import-as-findings"><FindingsList list={done.findings} /></div>
        </>) : null}
        {!done && stepId === 'import' ? (<>
          <Field label="Package or document" hint="A .zip of data modules, graphics and the publication module (the older publishing tool's export too), or one JSS or JSG document (.xml)."><input type="file" accept=".zip,.xml,application/zip,text/xml" onChange={(e) => void chosenFile(e.target.files?.[0])} data-testid="wiz-import-file" /></Field>
          {detecting ? <p className="v2-hint">Looking at the file…</p> : null}
          {found && file ? (() => {
            const why = source ? sourceProblem(file.name, source, found) : '';
            const guess = guessedSource(found);
            return (
              <div className="v2-card" data-testid="wiz-source" style={{ padding: '10px 14px' }}>
                <b>What is this file?</b>
                <p style={{ margin: '4px 0 8px' }} data-testid="wiz-detected">{guess ? 'The first look found: ' : 'The first look could not tell. '}{detectionSentence(found)} <span className="v2-muted">That is only a guess: check it, and choose again if it is wrong.</span></p>
                <div className="v2-row wrap" role="radiogroup" aria-label="This file is">
                  {SOURCE_CHOICES.map((c) => (
                    <button key={c.id} type="button" role="radio" aria-checked={source === c.id} className={`btn ${source === c.id ? 'btn-primary' : ''}`} title={c.hint} data-testid={`wiz-source-${c.id}`}
                      onClick={() => { setSource(c.id); setConfirmed(false); setErr(''); }}>{c.label}{guess === c.id ? ' (detected)' : ''}</button>
                  ))}
                </div>
                {why ? <div style={{ marginTop: 8 }}><Alert tone="bad"><span data-testid="wiz-source-problem">{why}</span></Alert></div> : null}
                {source && !why ? (confirmed
                  ? <p className="v2-hint" style={{ margin: '8px 0 0' }} data-testid="wiz-source-confirmed">Confirmed: this is {source === 's1000d' ? 'an' : 'a'} {FORMAT_NAME[source]} {source === 's1000d' ? 'package' : 'document'}. Choose another button above if that is wrong.</p>
                  : <div style={{ marginTop: 8 }}><button type="button" className="btn btn-primary" data-testid="wiz-source-confirm" onClick={() => { setConfirmed(true); setErr(''); }}>Yes, this is {source === 's1000d' ? 'an' : 'a'} {FORMAT_NAME[source]} {source === 's1000d' ? 'package' : 'document'}</button></div>) : null}
              </div>
            );
          })() : null}
          {found && file && confirmed && source ? (<>
            {nameAndFolder}{formatPicker}
            {targetProblem(source, fmt, manualType, found) ? <Alert tone="warn">{targetProblem(source, fmt, manualType, found)}</Alert> : null}
            <p className="v2-hint" style={{ margin: 0 }}>{source === fmt
              ? `This imports the ${FORMAT_NAME[source]} package as a new ${FORMAT_NAME[fmt]} project. Whatever the importer repaired, set aside or could not accept is listed afterwards. The Administrator's enterprise lists are checked and reported; they are not a reason to refuse the package.`
              : `This makes a new ${FORMAT_NAME[fmt]} project from the ${FORMAT_NAME[source]} content. Whatever the new format cannot hold is listed afterwards. The document codes in the file are kept.`}</p>
          </>) : null}
        </>) : null}
        {stepId === 'model' ? (<>
          <div className="v2-grid cols-2">
            {/* WP-22 (UX-024): each code field shows an example and its rule before input, and the model code last used here */}
            <Field label="Model code" hint="The first part of every data module code: 1 to 14 capital letters or digits, for example HYDRP. A Project Manager can change it later, even after data modules exist."><input className="v2-input v2-mono" maxLength={14} autoFocus value={mic} onChange={(e) => setMic(e.target.value)} placeholder="e.g. HYDRP" data-testid="wiz-mic" /></Field>
            <div>{lastMic && !mic ? <button type="button" className="btn btn-sm" style={{ marginTop: 22 }} onClick={() => setMic(lastMic)} data-testid="wiz-mic-last" title="Use the model code of the last project made here">Use {lastMic} (last used)</button> : null}</div>
            <Field label="Language"><input className="v2-input" maxLength={3} value={language} onChange={(e) => setLanguage(e.target.value)} /></Field>
            <Field label="Country"><input className="v2-input" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
          </div>
          <Field label="Responsible partner company">{rpcPick(ref.data?.rpc, rpc, setRpc, false)}</Field>
          <details open={false}><summary>Advanced</summary>
            <div className="v2-stack" style={{ marginTop: 8 }}>
              <div className="v2-grid cols-2">
                <Field label="S1000D issue" hint="Locked once the project has data modules."><select className="v2-select" value={issue} onChange={(e) => { setIssue(e.target.value); setCodes(new Set()); }} data-testid="wiz-issue">{ISSUE_OPTIONS.map((i) => <option key={i.key} value={i.key}>Issue {i.label}</option>)}</select></Field>
                <Field label="Default security classification"><select className="v2-select" value={security} onChange={(e) => setSecurity(e.target.value)}>{(ref.data?.security ?? [{ code: '01', name: 'Unclassified' }]).map((s) => <option key={s.code} value={s.code}>{s.code} – {s.name}</option>)}</select></Field>
              </div>
              <Field label="Originator" hint="Only when it is not the responsible partner company.">{rpcPick(ref.data?.originators, org, setOrg, true)}</Field>
              <Field label="Business rules (BREX)" hint="The official default BREX of the issue unless the project has its own."><select className="v2-select" value={brexMode} onChange={(e) => setBrexMode(e.target.value as 'default' | 'project')}><option value="default">Default BREX of Issue {issueLabel(issue)}</option><option value="project">This project's own BREX</option></select></Field>
              {brexMode === 'project' ? <Field label="Project BREX data module code" hint="e.g. MYPROJ-A-00-00-00-00A-022A-D"><input className="v2-input v2-mono" value={brexDmc} onChange={(e) => setBrexDmc(e.target.value)} /></Field> : null}
            </div>
          </details>
        </>) : null}
        {stepId === 'codes' ? (<>
          <Field label="Information codes">
            <div className="v2-stack" style={{ gap: 6 }}>
              <label className="v2-row" style={{ gap: 6 }}><input type="radio" checked={codeMode === 'all'} onChange={() => setCodeMode('all')} />Offer every code ({catalogue.data?.codes.length ?? '…'} codes) — recommended</label>
              <label className="v2-row" style={{ gap: 6 }}><input type="radio" checked={codeMode === 'selected'} onChange={() => setCodeMode('selected')} data-testid="wiz-codes-selected" />Only the codes I choose ({codes.size} chosen)</label>
            </div>
          </Field>
          {codeMode === 'selected' ? (<>
            <div className="v2-row wrap"><input className="v2-input" style={{ maxWidth: 240 }} placeholder="Filter…" value={codeQ} onChange={(e) => setCodeQ(e.target.value)} aria-label="Filter information codes" />
              <button className="btn btn-sm" onClick={() => setCodes(new Set([...codes, ...[...recommended].filter((c) => catalogue.data?.codes.some((x) => x.code === c))]))}>Add the 21 types' default codes</button></div>
            <div className="v2-card" style={{ maxHeight: 220, overflow: 'auto' }}><table className="v2-table"><tbody>{shown.map((c) => (
              <tr key={c.code}><td style={{ width: 34 }}><input type="checkbox" aria-label={`Offer ${c.code}`} checked={codes.has(c.code)} onChange={(e) => { const n = new Set(codes); if (e.target.checked) n.add(c.code); else n.delete(c.code); setCodes(n); }} /></td><td className="v2-mono" style={{ width: 60 }}>{c.code}</td><td>{c.title}</td></tr>))}</tbody></table></div>
          </>) : null}
          <Field label="Standard numbering (SNS)" hint="Optional starting point. The entries are copied: the project's SNS is its own from then on.">
            <select className="v2-select" value={preset} onChange={(e) => { setPresetTouched(true); setPreset(e.target.value); }} data-testid="wiz-preset"><option value="">Start empty (add systems later)</option>{(presets.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.systems} systems)</option>)}</select>
          </Field>
          {modelPreset && preset === modelPreset.id ? <Alert tone="ok">The numbering built for model <b>{modelPreset.model}</b> is loaded: new data module codes follow its systems, subsystems and assemblies.</Alert> : null}
          {preset ? <p className="v2-hint" style={{ margin: 0 }}>{presets.data?.find((p) => p.id === preset)?.limitation}</p> : null}
          <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={snsEnforced} onChange={(e) => setSnsEnforced(e.target.checked)} />New data modules must use codes from the project's SNS (once it has entries)</label>
          <details><summary>Data module types offered ({allTypes.size} of {dmTypes.length})</summary>
            <div className="v2-grid cols-2" style={{ marginTop: 6 }}>{dmTypes.map((t) => <label key={t.schema} className="v2-row" style={{ gap: 4 }}><input type="checkbox" checked={allTypes.has(t.schema)} onChange={(e) => { const n = new Set(allTypes); if (e.target.checked) n.add(t.schema); else n.delete(t.schema); setTypes(n); }} />{t.name}</label>)}</div></details>
        </>) : null}
        {stepId === 'review' ? (<div className="v2-stack" data-testid="wiz-review">
          <p className="v2-sub" style={{ margin: 0 }}>Review before creating.{fmt === 's1000d' ? ' The model code and the S1000D issue lock once the project has data modules; a Project Manager can still change the model code afterwards.' : ''}</p>
          <table className="v2-table"><tbody>
            <tr><td>Project</td><td><b>{name}</b>{folder ? ` · in ${folder}` : ''}</td></tr>
            <tr><td>Manual type</td><td>{fmt === 's1000d' ? 'S1000D' : `${fi?.label ?? fmt.toUpperCase()} · ${dom?.label ?? ''} · ${dom?.manualTypes.find((m) => m.id === manualType)?.label ?? ''}`}</td></tr>
            {fmt === 's1000d' ? (<>
              <tr><td>Model code</td><td className="v2-mono">{mic.toUpperCase()}</td></tr>
              <tr><td>S1000D issue</td><td>{issueLabel(issue)} · BREX: {brexMode === 'default' ? 'official default' : brexDmc}</td></tr>
              <tr><td>Language / country</td><td>{language}-{country.toUpperCase()}</td></tr>
              <tr><td>Responsible partner</td><td>{rpc.code.toUpperCase()} – {rpc.name}{org.code ? ` · originator ${org.code.toUpperCase()} – ${org.name}` : ''}</td></tr>
              <tr><td>Information codes</td><td>{codeMode === 'all' ? 'every code' : `${codes.size} chosen`}</td></tr>
              <tr><td>SNS</td><td>{preset ? presets.data?.find((p) => p.id === preset)?.name : 'empty'}{snsEnforced ? ' · enforced for new data modules' : ' · not enforced'}</td></tr>
              <tr><td>Data module types</td><td>{allTypes.size} of {dmTypes.length}</td></tr>
            </>) : null}
          </tbody></table>
          {notes.length && fmt === 's1000d' ? <Alert tone="ok"><ul style={{ margin: 0, paddingLeft: 18 }}>{notes.map((n) => <li key={n}>{n}</li>)}</ul></Alert> : null}
        </div>) : null}
        {err ? <Alert tone="bad">{err}</Alert> : null}
        {refusal.length ? (
          <div className="v2-card" data-testid="wiz-import-reasons" style={{ marginTop: 8, padding: '10px 14px' }}>
            <b>Why it was not imported</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {refusal.slice(0, 6).map((r) => (
                <li key={r.message}>{r.message}{r.count > 1 ? ` (${r.count} files, for example ${r.files.join(', ')})` : r.files.length ? ` (${r.files[0]})` : ''}</li>
              ))}
            </ul>
            {refusal.length > 6 ? <div className="v2-muted">…and {refusal.length - 6} other reason{refusal.length - 6 === 1 ? '' : 's'}.</div> : null}
            {refusalHint(refusal) ? <p className="v2-muted" style={{ margin: '8px 0 0' }}>{refusalHint(refusal)}</p> : null}
          </div>
        ) : null}
      </div>
    </Modal>
    {askDiscard ? <ConfirmModal title="Discard the new project?" body="What you entered in this wizard is lost." confirmLabel="Discard" danger
      onConfirm={() => { setAskDiscard(false); onClose(); }} onClose={() => setAskDiscard(false)} /> : null}
  </>);
}

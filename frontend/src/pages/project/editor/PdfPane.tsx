// The right-hand panel of the editor, laid out like JSS Publisher's: a PDF view
// with two buttons.
//
//   Quick preview  the data module you are editing, on its own - fast, for proofing a page
//   Generate       the whole publication, built by the server (what the final manual is)
//
// Both are rendered by the server from the saved file, exactly as the final PDF prints them; "Refresh on save" re-renders the preview after each save.
// Release, watermark and publication settings are not here.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { contentApi } from '../../../api';
import { onlyRuleBreaks } from '../../../lib/ruleBreaks';
import { ApiError } from '../../../api/client';
import { Icon } from '../../../components/Icon';
import { LazyPdfViewer } from '../../../components/pdf/LazyPdfViewer';
import { PublishRefusal } from '../../../components/PublishRefusal';
import { Spinner, ago, errText } from '../../../components/ui';
import { canBuild, type ProjectCtx } from '../../../layouts/ProjectShell';
import { useProgress } from '../../../lib/progress';
import { studio, useStudio } from '../../../lib/studioSession';
import { channelFor, openPopout, type Mode, type ToEditor, type ToPopout } from '../../../lib/previewBus';
import { refusalOf, type Refusal } from '../../../lib/waivers';

/**
 * `onlyRules`: the build failed only because modules break business rules, so the author may choose to generate anyway.
 * `refusal` is set when the server's publish gate refused (HTTP 422) for any other reason: its findings are listed, and a missing BREX can be waived for drafts.
 * `mode` is what to repeat afterwards.
 */
interface Problem { message: string; hint?: string; file?: string; line?: number; onlyRules?: boolean; refusal?: Refusal; mode?: Mode }

/**
 * WP-21: while the pane is closed (the editor is shown alone, the default of a new session) Quick preview and Generate are drawn into `slot`, a
 * place in the editor's header, so they stay one click away; pressing one there opens the pane (`onReveal`) to show the result. They are drawn
 * in one place at a time, with the same names and test ids.
 */
export function PdfPane({ ctx, savedTick, onOpenAt, onPopped, slot = null, onReveal }: { ctx: ProjectCtx; savedTick: number; onOpenAt: (file: string, line?: number) => void; onPopped?: (both: boolean) => void; slot?: HTMLElement | null; onReveal?: () => void }) {
  const { id, role, can, summary } = ctx;
  const active = useStudio((s) => s.docs.find((d) => d.active));
  const progress = useProgress(id);
  const [auto, setAuto] = useState(() => localStorage.getItem('agastya.pdf.auto') !== '0');
  const [src, setSrc] = useState<string | null>(null);
  const [shown, setShown] = useState('');
  const [busy, setBusy] = useState<'quick' | 'build' | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [note, setNote] = useState('');
  const blobUrl = useRef<string | null>(null);
  const run = useRef(0);
  const mayBuild = canBuild(can);

  // Pop-out windows: while one is open for a mode, that mode's results go to it instead of this pane.
  const [popped, setPopped] = useState<Record<Mode, boolean>>({ quick: false, build: false });
  const poppedRef = useRef(popped);
  const chan = useRef<BroadcastChannel | null>(null);
  const send = (m: ToPopout) => chan.current?.postMessage(m);
  const setPop = (mode: Mode, on: boolean) => { poppedRef.current = { ...poppedRef.current, [mode]: on }; setPopped(poppedRef.current); onPopped?.(poppedRef.current.quick && poppedRef.current.build); };
  const handlers = useRef<{ quick: () => void; build: () => void }>({ quick: () => undefined, build: () => undefined });
  useEffect(() => {
    const ch = channelFor(id);
    chan.current = ch;
    ch.onmessage = (e: MessageEvent<ToEditor>) => {
      const m = e.data;
      if (m.t === 'hello') { setPop(m.mode, true); ch.postMessage({ t: 'editor-here' } satisfies ToPopout); }
      else if (m.t === 'bye') setPop(m.mode, false);
      else if (m.t === 'run') handlers.current[m.mode]();
    };
    return () => { ch.close(); chan.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const pop = (mode: Mode) => { if (!openPopout(id, mode)) setProblem({ message: 'The browser blocked the new window. Allow pop-ups for this site and try again.' }); };

  const setBlob = (blob: Blob) => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = URL.createObjectURL(blob);
    setSrc(blobUrl.current);
  };
  useEffect(() => () => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); }, []);
  useEffect(() => { localStorage.setItem('agastya.pdf.auto', auto ? '1' : '0'); }, [auto]);

  const fail = (mine: number, e: unknown, mode: Mode) => {
    if (mine !== run.current) return;
    const b = e instanceof ApiError ? (e.body as { hint?: string; file?: string; line?: number } | undefined) : undefined;
    const onlyRules = onlyRuleBreaks(e);
    // a refusal that is only broken business rules keeps the "Generate anyway" choice; every other refusal gets the findings list (and the waiver for a missing BREX)
    setProblem({ message: errText(e), hint: b?.hint, file: b?.file, line: b?.line, onlyRules, refusal: onlyRules ? undefined : refusalOf(e) ?? undefined, mode });
    for (const mode of ['quick', 'build'] as Mode[]) if (poppedRef.current[mode]) send({ t: 'problem', mode, message: errText(e), hint: b?.hint });
  };

  const quick = useCallback(async () => {
    const mine = ++run.current;
    setBusy('quick'); setProblem(null); setNote('');
    if (poppedRef.current.quick) send({ t: 'busy', mode: 'quick', on: true });
    try {
      if (!active) throw new Error('Open a data module first, then press Quick preview.');
      if (!mayBuild) throw new Error('Reviewers, editors and owners can preview a data module.');
      if (!(await studio.saveActive()) || !studio.activeFile) throw new Error('Save the data module first (Ctrl+S): the server renders the saved file.');
      const t0 = performance.now();
      const blob = await contentApi.previewDmPdf(id, studio.activeFile);
      if (mine !== run.current) return;
      const label = `Quick preview · ${studio.activeFile}`;
      const note = `Rendered by the server in ${((performance.now() - t0) / 1000).toFixed(1)} s — exactly as the final PDF will print it.`;
      if (poppedRef.current.quick) send({ t: 'result', mode: 'quick', src: blob, label, note });
      else { setBlob(blob); setShown(label); setNote(note); }
    } catch (e) { fail(mine, e, 'quick'); } finally { if (mine === run.current) setBusy(null); }
  }, [active, id, mayBuild]);

  const generate = useCallback(async (allowRuleBreaks = false) => {
    const mine = ++run.current;
    setBusy('build'); setProblem(null); setNote(''); progress.clear();
    if (poppedRef.current.build) send({ t: 'busy', mode: 'build', on: true });
    try {
      if (!mayBuild) throw new Error('Reviewers, editors and owners can build the publication.');
      await studio.saveActive();
      const out = await contentApi.build(id, undefined, allowRuleBreaks);
      if (mine !== run.current) return;
      const url = `${contentApi.pdfUrl(id)}?t=${Date.now()}`;
      const note = `Built in ${((out.totalMs ?? 0) / 1000).toFixed(1)} s${out.releaseLabel ? ` · ${out.releaseLabel}` : ' · stamped NOT RELEASED'}${out.ruleBreaks?.length ? ` · ${out.ruleBreaks.length} business rule break${out.ruleBreaks.length === 1 ? '' : 's'} NOT fixed` : ''}`;
      if (poppedRef.current.build) send({ t: 'result', mode: 'build', src: url, label: 'Publication', note });
      else { setSrc(url); setShown('Publication'); setNote(note); }
      ctx.reload();
    } catch (e) { fail(mine, e, 'build'); } finally { if (mine === run.current) setBusy(null); }
  }, [id, mayBuild, progress, ctx]);

  handlers.current = { quick: () => void quick(), build: () => void generate(false) };

  // First view: show the last built publication if there is one.
  useEffect(() => {
    if (!src && summary.build) { setSrc(`${contentApi.pdfUrl(id)}?t=${new Date(summary.build.builtAt).getTime()}`); setShown(`Publication · built ${ago(summary.build.builtAt)}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Refresh the quick preview after a save, while the author is proofing one.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (auto && active && shown.startsWith('Quick preview')) void quick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTick]);

  const quickBtn = <button className="btn btn-sm btn-primary" onClick={() => { onReveal?.(); void quick(); }} disabled={busy !== null || !active} data-testid="quick-preview-btn" title="Preview the data module you are editing">
    {busy === 'quick' ? <Spinner /> : <Icon name="play" size={12} />}Quick preview
  </button>;
  const generateBtn = summary.project.type === 'CIR' ? null : <button className="btn btn-sm" onClick={() => { onReveal?.(); void generate(); }} disabled={busy !== null} data-testid="generate-btn" title="Build the whole publication">
    {busy === 'build' ? <Spinner /> : <Icon name="rocket" size={12} />}Generate
  </button>;
  return (
    <>
      {slot ? createPortal(<>{quickBtn}{generateBtn}</>, slot) : null}
      <div className="v2-pdfbar" role="toolbar" aria-label="PDF controls">
        <span className="v2-btngroup">
          {slot ? null : quickBtn}
          <button className={`btn btn-sm btn-primary ${popped.quick ? 'is-on' : ''}`} onClick={() => pop('quick')} title="Open Quick preview in its own window" aria-label="Open Quick preview in a separate window" data-testid="popout-quick"><Icon name="external" size={12} /></button>
        </span>
        {summary.project.type === 'CIR' ? null : <span className="v2-btngroup">
          {slot ? null : generateBtn}
          <button className={`btn btn-sm ${popped.build ? 'is-on' : ''}`} onClick={() => pop('build')} title="Open Generate in its own window" aria-label="Open Generate in a separate window" data-testid="popout-build"><Icon name="external" size={12} /></button>
        </span>}
        <span className="spacer" />
        <label className="v2-row" style={{ fontSize: 12, gap: 4 }} title="Re-render the Quick preview every time you save"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Refresh on save</label>
        {summary.build && summary.project.type !== 'CIR' ? <a className="btn btn-sm" href={contentApi.pdfUrl(id, true)} title="Download the last built publication"><Icon name="download" size={12} />PDF</a> : null}
      </div>
      {problem?.refusal ? (
        <div style={{ margin: 8 }}><PublishRefusal refusal={problem.refusal} projectId={id} can={can} mode="draft" onDismiss={() => setProblem(null)}
          onRecorded={() => { const again = problem.mode ?? 'build'; setProblem(null); handlers.current[again](); }} /></div>
      ) : problem ? (
        <div className="v2-alert bad" style={{ margin: 8 }}>
          <strong>{problem.message}</strong>
          {problem.hint ? <div style={{ marginTop: 4 }}>{problem.hint}</div> : null}
          {problem.onlyRules ? <div style={{ marginTop: 6 }}>Only business rules (BREX) are broken; the data is otherwise valid. You can still generate the PDF to look at it. It stays stamped NOT RELEASED, and it cannot be approved for release until the rules are met.<div style={{ marginTop: 6 }}><button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => void generate(true)} data-testid="generate-anyway">Generate anyway</button></div></div> : null}
          {problem.file && /\.xml$/i.test(problem.file) ? <div style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => onOpenAt(problem.file!.split('/').pop()!, problem.line)}>Open {problem.file.split('/').pop()}{problem.line ? ` at line ${problem.line}` : ''}</button></div> : null}
        </div>
      ) : null}
      {popped.quick || popped.build ? <div className="v2-hint" style={{ padding: '4px 10px' }} data-testid="popped-note">{popped.quick && popped.build ? 'Quick preview and Generate are open in their own windows.' : popped.quick ? 'Quick preview is open in its own window.' : 'Generate is open in its own window.'}</div> : null}
      {shown ? <div className="v2-hint v2-trunc" style={{ padding: '4px 10px' }} title={shown} data-testid="pdf-shown">{shown}</div> : null}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }} data-testid="pdf-pane">
        <LazyPdfViewer autoFit src={src} downloadName={`${summary.project.name}.pdf`}
          placeholder={<div className="v2-center"><div className="v2-empty v2-empty-steps">
            <Icon name="pdf" size={30} />
            <h3>No PDF yet</h3>
            <ol>
              <li>{active ? <>Press <strong>Quick preview</strong> to proof <em>{active.title}</em>.</> : <>Open a data module from the list on the left.</>}</li>
              {summary.project.type === 'CIR' ? null : <li>Press <strong>Generate</strong> to build the whole publication.</li>}
              <li>Tip: <strong>Ctrl+S</strong> saves, and with “Refresh on save” the preview updates itself.</li>
            </ol>
          </div></div>} />
      </div>
      {note || (busy === 'build' && progress.lines.length) ? (
        <div className="v2-log" aria-live="polite">{busy === 'build' ? progress.lines.slice(-4).map((l, i) => <div key={i}>{l}</div>) : <div>{note}</div>}</div>
      ) : null}
    </>
  );
}

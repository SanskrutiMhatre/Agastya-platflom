// A pop-out window for Quick preview or Generate. It shows what the editor sends it and asks the
// editor to run again when its button is pressed. Generate does not need the editor's text, so
// when no editor answers it builds the publication itself.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { contentApi } from '../api';
import { Icon } from '../components/Icon';
import { LazyPdfViewer } from '../components/pdf/LazyPdfViewer';
import { ThemeToggle } from '../components/ThemeToggle';
import { Callout, Spinner, errText } from '../components/ui';
import { channelFor, type Mode, type ToEditor, type ToPopout } from '../lib/previewBus';
import '../styles/pages/preview.css';   // WP-35 second pass: the pop-out window's styles load with its chunk

export function PreviewWindow() {
  const { id = '', mode: raw = 'quick' } = useParams();
  const mode: Mode = raw === 'build' ? 'build' : 'quick';
  const title = mode === 'quick' ? 'Quick preview' : 'Generate';
  const [src, setSrc] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [editor, setEditor] = useState(false);
  const chan = useRef<BroadcastChannel | null>(null);
  const blobUrl = useRef<string | null>(null);

  useEffect(() => {
    document.title = `${title} - Agastya`;
    const ch = channelFor(id);
    chan.current = ch;
    ch.onmessage = (e: MessageEvent<ToPopout>) => {
      const m = e.data;
      if (m.t === 'editor-here') setEditor(true);
      else if (m.t === 'busy' && m.mode === mode) { setBusy(m.on); if (m.on) setProblem(''); }
      else if (m.t === 'problem' && m.mode === mode) { setProblem(m.message + (m.hint ? ` ${m.hint}` : '')); setBusy(false); }
      else if (m.t === 'result' && m.mode === mode) {
        if (blobUrl.current) { URL.revokeObjectURL(blobUrl.current); blobUrl.current = null; }
        if (typeof m.src === 'string') setSrc(m.src); else { blobUrl.current = URL.createObjectURL(m.src); setSrc(blobUrl.current); }
        setLabel(m.label); setNote(m.note); setProblem(''); setBusy(false);
      }
    };
    const hello: ToEditor = { t: 'hello', mode };
    ch.postMessage(hello);
    const bye = () => ch.postMessage({ t: 'bye', mode } satisfies ToEditor);
    window.addEventListener('pagehide', bye);
    // The last build is a good first thing to show in a Generate window.
    if (mode === 'build') setSrc(`${contentApi.pdfUrl(id)}?t=${Date.now()}`);
    return () => { window.removeEventListener('pagehide', bye); bye(); ch.close(); if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); };
  }, [id, mode, title]);

  const run = async () => {
    if (editor || mode === 'quick') { setBusy(true); chan.current?.postMessage({ t: 'run', mode } satisfies ToEditor); return; }
    setBusy(true); setProblem('');
    try { const out = await contentApi.build(id); setSrc(`${contentApi.pdfUrl(id)}?t=${Date.now()}`); setLabel('Publication'); setNote(`Built in ${((out.totalMs ?? 0) / 1000).toFixed(1)} s`); }
    catch (e) { setProblem(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="v2-popout">
      <header className="v2-popout-bar">
        {/* global UI pass: the top bars' brand mark, the mockup alerts (icon first) without inline styles */}
        <span className="brand-mark v2-popout-mark" aria-hidden="true"><Icon name="book" size={16} /></span><strong>{title}</strong>
        <button className="btn sm primary" onClick={() => void run()} disabled={busy} data-testid="popout-run">
          {busy ? <Spinner /> : <Icon name={mode === 'quick' ? 'play' : 'rocket'} size={12} />}{mode === 'quick' ? 'Refresh preview' : 'Generate'}
        </button>
        <span className="v2-hint v2-trunc grow">{label}{note ? ` · ${note}` : ''}</span>
        <ThemeToggle />
      </header>
      {mode === 'quick' && !editor ? <div className="v2-popout-note"><Callout tone="warning">Keep the editor open in the main window: it provides the text to preview.</Callout></div> : null}
      {problem ? <div className="v2-popout-note"><Callout tone="danger">{problem}</Callout></div> : null}
      <div className="v2-popout-pdf" data-testid="popout-pdf">
        <LazyPdfViewer autoFit compact={false} src={src} downloadName={`${mode === 'quick' ? 'preview' : 'publication'}.pdf`}
          placeholder={<div className="v2-center"><div style={{ textAlign: 'center', padding: 16 }}><Icon name="pdf" size={30} /><p>{mode === 'quick' ? 'Use Quick preview in the editor, or Refresh preview here.' : 'Press Generate to build the publication.'}</p></div></div>} />
      </div>
    </div>
  );
}

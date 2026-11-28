// UI redesign screen 5 (mockup docs/audit/mockups/validation.html): the source excerpt of the selected finding. The lines are the
// module's own text, read from the server (contentApi.readDm) at the line the check reported; nothing is made up. Tokens are drawn as
// React text (never as HTML), with the syntax colour tokens of the design system.

import { useEffect, useState } from 'react';
import { contentApi } from '../../api';

export type XmlTok = { k: 't' | 'a' | 'v' | 'b' | 'c' | 'x'; s: string };

/** Splits one line of XML into tag, attribute, value, bracket, comment and text tokens (one line at a time: a comment that spans lines is text). */
export function tokenizeXmlLine(line: string): XmlTok[] {
  const out: XmlTok[] = [];
  const push = (k: XmlTok['k'], s: string) => { if (s) out.push({ k, s }); };
  let i = 0; let inTag = false;
  while (i < line.length) {
    const rest = line.slice(i);
    if (!inTag) {
      const c = /^<!--[\s\S]*?(-->|$)/.exec(rest);
      if (c) { push('c', c[0]); i += c[0].length; continue; }
      const t = /^(<\/?|<\?|<!)([\w:.-]*)/.exec(rest);
      if (t) { push('b', t[1]); push('t', t[2]); i += t[0].length; inTag = true; continue; }
      const n = rest.indexOf('<');
      const txt = n < 0 ? rest : rest.slice(0, n || 1);
      push('x', txt); i += txt.length; continue;
    }
    const end = /^(\/?>|\?>)/.exec(rest);
    if (end) { push('b', end[0]); i += end[0].length; inTag = false; continue; }
    const v = /^("[^"]*"?|'[^']*'?)/.exec(rest);
    if (v) { push('v', v[0]); i += v[0].length; continue; }
    const a = /^[\w:.-]+/.exec(rest);
    if (a) { push('a', a[0]); i += a[0].length; continue; }
    push('x', rest[0]); i += 1;
  }
  return out;
}

/** The lines around `line` (1-based), with their numbers. */
export function excerpt(text: string, line: number, around = 2): Array<{ n: number; s: string }> {
  const lines = text.split(/\r?\n/);
  const at = Math.min(Math.max(1, line), lines.length);
  const from = Math.max(1, at - around); const to = Math.min(lines.length, at + around);
  const out: Array<{ n: number; s: string }> = [];
  for (let n = from; n <= to; n++) out.push({ n, s: lines[n - 1] });
  return out;
}

export function SourceExcerpt({ projectId, file, line }: { projectId: string; file: string; line: number }) {
  const [state, setState] = useState<{ key: string; text: string | null; failed: boolean }>({ key: '', text: null, failed: false });
  const key = `${projectId}|${file}`;
  useEffect(() => {
    let live = true;
    contentApi.readDm(projectId, file).then((r) => { if (live) setState({ key, text: r.xml, failed: false }); })
      .catch(() => { if (live) setState({ key, text: null, failed: true }); });
    return () => { live = false; };
  }, [projectId, file, key]);
  if (state.key !== key) return <p className="faint val-src-note">Reading the source…</p>;
  if (state.failed || state.text == null) return <p className="faint val-src-note">The source of this module could not be read.</p>;
  return (
    <pre className="src val-src" aria-label="Source excerpt" data-testid="issue-source">
      {excerpt(state.text, line).map(({ n, s }) => {
        const toks = tokenizeXmlLine(s).map((t, i) => (t.k === 'x' ? <span key={i}>{t.s}</span> : <span key={i} className={t.k}>{t.s}</span>));
        // the reported line is a block of its own (the mockup's highlight); the other lines end in a line break
        return n === line ? <span key={n} className="hit"><span className="ln">{n}</span>{toks}</span> : <span key={n}><span className="ln">{n}</span>{toks}{'\n'}</span>;
      })}
    </pre>
  );
}

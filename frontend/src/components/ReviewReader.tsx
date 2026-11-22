// A data module laid out to be read, where the Project Manager clicks a paragraph, step or title to comment on exactly that place, and the author
// sees every comment under the words it is about. A comment keeps the element's position and the words it was made on; if the author later edits
// or moves that element, the comment is listed under "Moved or changed" instead of silently pointing at the wrong text.

import { useEffect, useMemo, useState } from 'react';
import { contentApi, type ReviewAnchor, type ReviewComment } from '../api';
import { Badge, Empty, Loading, ago, errText, useAsync } from './ui';
import { Icon } from './Icon';

const HEADINGS = new Set(['title', 'techName', 'infoName', 'shortName']);
const SKIP = new Set(['identAndStatusSection', 'dmAddress', 'dmStatus']);

const snippet = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);
const own = (el: Element) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
const kids = (el: Element) => Array.from(el.children);

function find(root: Element, path: string): Element | null {
  let el: Element | undefined = root;
  for (const i of path.split('/').filter(Boolean)) { el = el?.children[Number(i)]; if (!el) return null; }
  return el ?? null;
}

export function ReviewReader({ projectId, file, comments, canComment, canResolve, onChanged }: {
  projectId: string; file: string; comments: ReviewComment[]; canComment: boolean; canResolve: boolean; onChanged: () => void;
}) {
  const doc = useAsync(() => contentApi.readDm(projectId, file), [projectId, file]);
  const [pick, setPick] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setPick(null); setText(''); setErr(''); }, [file]);

  const root = useMemo(() => {
    if (!doc.data) return null;
    const d = new DOMParser().parseFromString(doc.data.xml, 'application/xml');
    return d.querySelector('parsererror') ? null : d.documentElement;
  }, [doc.data]);

  const mine = comments.filter((c) => c.dmFile === file);
  const byPath = new Map<string, ReviewComment[]>();
  const orphans: ReviewComment[] = [];
  const general = mine.filter((c) => !c.anchor);
  for (const c of mine) {
    if (!c.anchor) continue;
    const el = root ? find(root, c.anchor.path) : null;
    // the place still holds the same words (or the comment had none to compare): it is shown there
    if (el && el.tagName === c.anchor.tag && (!c.anchor.text || snippet(el.textContent ?? '').startsWith(c.anchor.text.slice(0, 40)))) byPath.set(c.anchor.path, [...(byPath.get(c.anchor.path) ?? []), c]);
    else orphans.push(c);
  }

  const send = async (path: string, el: Element) => {
    setBusy(true); setErr('');
    try {
      const anchor: ReviewAnchor = { path, tag: el.tagName, text: snippet(el.textContent ?? '') };
      await contentApi.addComment(projectId, text, file, anchor);
      setText(''); setPick(null); onChanged();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const thread = (list: ReviewComment[]) => list.map((c) => (
    <div key={c.id} className={`v2-rv ${c.resolved ? 'done' : ''}`} data-testid="pinned-comment" style={{ marginTop: 6 }}>
      <div className="v2-rv-head"><b>{c.byName ?? c.by ?? 'Someone'}</b><span className="v2-hint">{ago(c.at)}</span>
        {canResolve ? <label className="v2-row" style={{ marginLeft: 'auto', gap: 6 }}><input type="checkbox" checked={c.resolved} onChange={(e) => void contentApi.resolveComment(projectId, c.id, e.target.checked).then(onChanged)} aria-label="Mark as done" />Done</label> : c.resolved ? <Badge tone="ok">Done</Badge> : null}
      </div>
      <p className="v2-rv-body">{c.body}</p>
    </div>
  ));

  const walk = (el: Element, path: string, depth: number): JSX.Element | null => {
    if (SKIP.has(el.tagName)) return null;
    const here = byPath.get(path) ?? [];
    const leaf = own(el) || kids(el).length === 0;
    if (!leaf) {
      return <div key={path} style={{ marginLeft: depth > 1 ? 14 : 0, borderLeft: depth > 1 ? '2px solid var(--border)' : undefined, paddingLeft: depth > 1 ? 10 : 0, marginTop: 6 }}>
        <div className="v2-hint v2-mono" style={{ fontSize: 11 }}>{el.tagName}</div>
        {here.length ? thread(here) : null}
        {kids(el).map((k, i) => walk(k, `${path}/${i}`.replace(/^\//, ''), depth + 1))}
      </div>;
    }
    const sel = pick === path;
    const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!words && !here.length) return null;
    return (
      <div key={path} style={{ marginTop: 6 }} data-testid="reader-block" data-path={path}>
        <div role={canComment ? 'button' : undefined} tabIndex={canComment ? 0 : undefined}
          onClick={() => canComment && setPick(sel ? null : path)} onKeyDown={(e) => { if (canComment && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPick(sel ? null : path); } }}
          title={canComment ? 'Click to comment on this' : undefined}
          style={{ padding: '4px 8px', borderRadius: 6, cursor: canComment ? 'pointer' : 'default', background: sel ? 'var(--accent-soft, rgba(80,120,255,.12))' : here.length ? 'rgba(255,170,0,.12)' : undefined, fontWeight: HEADINGS.has(el.tagName) ? 700 : 400, fontSize: HEADINGS.has(el.tagName) ? '1.05em' : undefined }}>
          <span className="v2-hint v2-mono" style={{ fontSize: 11, marginRight: 8 }}>{el.tagName}</span>{words}
          {here.length ? <Badge tone="warn" title="Comments here"> {here.filter((c) => !c.resolved).length || '✓'}</Badge> : null}
        </div>
        {here.length ? thread(here) : null}
        {sel ? (
          <form className="v2-stack" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(path, el); }}>
            <textarea className="v2-textarea" rows={2} maxLength={4000} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Your comment on this…" aria-label="Comment on this place" data-testid="pin-text" />
            {err ? <span className="v2-hint" style={{ color: 'var(--danger, #c33)' }}>{err}</span> : null}
            <div className="v2-row"><button className="btn btn-sm btn-primary" disabled={busy || !text.trim()} data-testid="pin-add"><Icon name="comment" size={13} />Comment here</button><button type="button" className="btn btn-sm" onClick={() => setPick(null)}>Cancel</button></div>
          </form>
        ) : null}
      </div>
    );
  };

  if (doc.loading && !doc.data) return <Loading />;
  if (!root) return <Empty title="This data module cannot be shown" />;
  const content = Array.from(root.children).findIndex((c) => c.tagName === 'content');
  const start = content >= 0 ? root.children[content] : root;
  const startPath = content >= 0 ? String(content) : '';
  return (
    <div className="v2-stack" data-testid="review-reader">
      {canComment ? <p className="v2-hint" style={{ margin: 0 }}>Click a title, paragraph or step to comment on it. Comments stay with that place, and the author sees them there.</p> : null}
      {general.length ? <div><b>About the whole data module</b>{thread(general)}</div> : null}
      {orphans.length ? <div className="v2-card v2-card-pad" data-testid="moved-comments"><b>Moved or changed</b><p className="v2-hint" style={{ margin: '2px 0' }}>These were made on text that is no longer where it was.</p>
        {orphans.map((c) => <div key={c.id}><p className="v2-hint" style={{ margin: '6px 0 0' }}>On “{c.anchor?.text}”</p>{thread([c])}</div>)}</div> : null}
      {walk(start, startPath, 0)}
    </div>
  );
}

// Two small building blocks for screens that must stay readable when a list has hundreds of rows:
//   Section     a titled block the reader opens and shuts (a button with aria-expanded, so it works from the keyboard)
//   CappedList  shows the first rows and a "Show more" / "Show all" button; the rest is not rendered until asked for
// The counting is in lib/importPackage.ts (cap, showMore) and is unit-tested there.

import { useState, type ReactNode } from 'react';
import { cap, showMore } from '../lib/importPackage';
import { Icon } from './Icon';

export function Section({ title, count, tone, defaultOpen = false, testid, children }: {
  title: string; count?: number | string; tone?: 'ok' | 'warn' | 'bad' | 'accent'; defaultOpen?: boolean; testid?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="v2-sec" data-testid={testid} data-open={open ? '1' : '0'}>
      <button type="button" className="v2-sec-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'down' : 'right'} size={14} />
        <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
        {count !== undefined ? <span className={`v2-badge ${tone ?? ''}`}>{count}</span> : null}
      </button>
      {open ? <div className="v2-sec-body">{children}</div> : null}
    </section>
  );
}

/** `noun` names the rows in the buttons ("Show 25 more files"). Rows are rendered by `render` inside a plain list. */
export function CappedList<T>({ items, render, initial = 25, page = 100, noun = 'items', testid, empty }: {
  items: readonly T[]; render: (item: T, index: number) => ReactNode; initial?: number; page?: number; noun?: string; testid?: string; empty?: ReactNode;
}) {
  const [shown, setShown] = useState(initial);
  if (items.length === 0) return <>{empty ?? null}</>;
  const view = cap(items, shown);
  const step = Math.min(page, view.hidden);
  return (
    <div data-testid={testid}>
      <ul className="v2-list">{view.items.map((it, i) => <li key={i}>{render(it, i)}</li>)}</ul>
      {view.hidden > 0 ? (
        <div className="v2-row wrap" style={{ marginTop: 6 }}>
          <span className="v2-hint">Showing {view.items.length} of {items.length} {noun}.</span>
          {step < view.hidden ? <button type="button" className="btn btn-sm" onClick={() => setShown(showMore(shown, items.length, page))}>Show {step} more</button> : null}
          <button type="button" className="btn btn-sm" onClick={() => setShown(items.length)} data-testid={testid ? `${testid}-all` : undefined}>Show all {items.length}</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The "Showing 100 of 4,200 rows" line with its buttons, for a table or tree whose rows the caller slices itself (`cap` from lib/importPackage.ts).
 * `shown` is the number of rows currently rendered; `onShown` receives the new number.
 */
export function ShowMore({ shown, total, page = 100, noun = 'rows', testid, onShown }: { shown: number; total: number; page?: number; noun?: string; testid?: string; onShown: (n: number) => void }) {
  const hidden = Math.max(0, total - shown);
  if (hidden === 0) return null;
  const step = Math.min(page, hidden);
  return (
    <div className="v2-row wrap" style={{ marginTop: 6 }} data-testid={testid}>
      <span className="v2-hint">Showing {Math.min(shown, total)} of {total} {noun}.</span>
      {step < hidden ? <button type="button" className="btn btn-sm" onClick={() => onShown(showMore(shown, total, page))} data-testid={testid ? `${testid}-more` : undefined}>Show {step} more</button> : null}
      <button type="button" className="btn btn-sm" onClick={() => onShown(total)} data-testid={testid ? `${testid}-all` : undefined}>Show all {total}</button>
    </div>
  );
}

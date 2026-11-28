import type { ReactNode } from 'react';
import type { IconName } from './Icon';
import { useHeadingLevel } from './a11y';
import '../styles/pages/project-pages.css';   // UI consistency pass: the project pages' shared look (page head, stat strip, two columns) loads with them

export interface Stat { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'accent' }

/**
 * The top of a project screen, drawn as the owner-approved mockups' page head (docs/audit/mockups/validation.html, project.html):
 * the title and one line of purpose on the left, the actions on the right, and the at-a-glance figures below as a row of stat cards.
 * `icon` is kept for callers; the mockup head has no icon tile.
 */
export function PageHeader({ title, sub, actions, stats }: { icon?: IconName; title: string; sub?: ReactNode; actions?: ReactNode; stats?: Stat[] }) {
  // WP-23 (UX-005): the page title is the h1 of a project page; under the main shell, whose top bar holds the h1, it is an h2
  const H = useHeadingLevel() === 1 ? 'h1' : 'h2';
  return (
    <>
      <header className="page-head pp-head">
        <div className="pp-head-text"><H>{title}</H>{sub ? <p>{sub}</p> : null}</div>
        {actions ? <div className="row wrap pp-head-actions">{actions}</div> : null}
      </header>
      {stats?.length ? (
        <dl className="pp-stats">
          {stats.map((s) => <div key={s.label} className={`card stat pp-stat${s.tone ? ` ${s.tone}` : ''}`}><dt className="l">{s.label}</dt><dd className="v">{s.value}</dd></div>)}
        </dl>
      ) : null}
    </>
  );
}

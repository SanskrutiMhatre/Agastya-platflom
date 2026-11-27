import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useHeadingLevel } from './a11y';

export interface Stat { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'accent' }

/** The top of every project screen: an icon tile, a title and one-line purpose, actions on the right, and at-a-glance figures below. */
export function PageHeader({ icon, title, sub, actions, stats }: { icon: IconName; title: string; sub?: ReactNode; actions?: ReactNode; stats?: Stat[] }) {
  // WP-23 (UX-005): the page title is the h1 of a project page; under the main shell, whose top bar holds the h1, it is an h2
  const H = useHeadingLevel() === 1 ? 'h1' : 'h2';
  return (
    <header className="v2-ph">
      <div className="v2-ph-main">
        <span className="v2-ph-icon"><Icon name={icon} size={22} /></span>
        <div className="v2-ph-text"><H>{title}</H>{sub ? <p>{sub}</p> : null}</div>
        {actions ? <div className="v2-ph-actions">{actions}</div> : null}
      </div>
      {stats?.length ? (
        <dl className="v2-ph-stats">
          {stats.map((s) => <div key={s.label} className={`v2-stat ${s.tone ?? ''}`}><dd>{s.value}</dd><dt>{s.label}</dt></div>)}
        </dl>
      ) : null}
    </header>
  );
}

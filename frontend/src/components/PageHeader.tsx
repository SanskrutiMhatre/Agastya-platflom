import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface Stat { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'accent' }

/** The top of every project screen: an icon tile, a title and one-line purpose, actions on the right, and at-a-glance figures below. */
export function PageHeader({ icon, title, sub, actions, stats }: { icon: IconName; title: string; sub?: ReactNode; actions?: ReactNode; stats?: Stat[] }) {
  return (
    <header className="v2-ph">
      <div className="v2-ph-main">
        <span className="v2-ph-icon"><Icon name={icon} size={22} /></span>
        <div className="v2-ph-text"><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
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

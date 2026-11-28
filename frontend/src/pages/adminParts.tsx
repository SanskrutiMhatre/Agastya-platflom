// UI redesign screen 6 (owner approved mockups 2026-11-28, docs/audit/mockups/admin.html): the two pieces the administration look adds to
// the design system's own (components/ui.tsx: StatTile, Progress, initialsOf). Used by the global pages (Administrator, Settings, Backup,
// Notifications, Activity, CIR, Graphics).

import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { useHeadingLevel } from '../components/a11y';
import { Progress, type Tone } from '../components/ui';

/** The mockup page head: title and one line of purpose on the left, actions on the right. Under the main shell the title is an h2. */
export function AdmHead({ title, sub, actions, icon }: { title: string; sub?: ReactNode; actions?: ReactNode; icon?: IconName }) {
  const H = useHeadingLevel() === 1 ? 'h1' : 'h2';
  return (
    <div className="page-head">
      <div><H>{icon ? <Icon name={icon} size={20} className="adm-head-icon" /> : null}{title}</H>{sub ? <p>{sub}</p> : null}</div>
      {actions ? <div className="row wrap">{actions}</div> : null}
    </div>
  );
}

type Status = Exclude<Tone, 'accent'> | undefined;

/** The admin mockup's health tile: a status dot with its label first, then the value and one line (the shared StatTile puts the value first). */
export function HealthTile({ label, value, line, tone, testId, children }: { label: string; value: ReactNode; line?: ReactNode; tone?: Status; testId?: string; children?: ReactNode }) {
  return (
    <div className="card stat" data-testid={testId}>
      <div className="row"><span className={`dot${tone ? ` ${tone}` : ''}`} aria-hidden="true" /><span className="faint">{label}</span></div>
      <div className="v">{value}</div>
      {line ? <div className="l">{line}</div> : null}
      {children}
    </div>
  );
}

/** A meter: the shared Progress, coloured by how full it is unless a tone is given (the mockup's 82 % = warning). */
export function Meter({ value, max, label, tone }: { value: number; max: number; label: string; tone?: Status }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return <Progress value={value} max={max} label={label} tone={tone ?? (pct >= 90 ? 'danger' : pct >= 80 ? 'warning' : undefined)} />;
}

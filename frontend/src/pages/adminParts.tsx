// UI redesign screen 6 (owner approved mockups 2026-11-28, docs/audit/mockups/admin.html): the small building blocks the administration
// look shares across the global pages (Administrator, Settings, Backup, Notifications, Activity, CIR, Graphics). The classes are the
// mockup's; styles/pages/admin.css carries them scoped to `.adm` until the shared design system does.

import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { useHeadingLevel } from '../components/a11y';

/** The page head of the mockup: title and one line of purpose on the left, actions on the right. Under the main shell the title is an h2. */
export function AdmHead({ title, sub, actions, icon }: { title: string; sub?: ReactNode; actions?: ReactNode; icon?: IconName }) {
  const H = useHeadingLevel() === 1 ? 'h1' : 'h2';
  return (
    <div className="page-head">
      <div><H>{icon ? <Icon name={icon} size={20} className="adm-head-icon" /> : null}{title}</H>{sub ? <p>{sub}</p> : null}</div>
      {actions ? <div className="row wrap">{actions}</div> : null}
    </div>
  );
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | undefined;

/** A stat tile: a status dot and label, the value, and one line under it. */
export function StatTile({ label, value, line, tone, testId, children }: { label: string; value: ReactNode; line?: ReactNode; tone?: Tone; testId?: string; children?: ReactNode }) {
  return (
    <div className="card stat" data-testid={testId}>
      <div className="row"><span className={`dot ${tone ?? ''}`} aria-hidden="true" /><span className="faint">{label}</span></div>
      <div className="v">{value}</div>
      {line ? <div className="l">{line}</div> : null}
      {children}
    </div>
  );
}

/** A meter (mockup .progress): `value` of `max`, coloured by how full it is unless a tone is given. */
export function Meter({ value, max, label, tone }: { value: number; max: number; label: string; tone?: Tone }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const t = tone ?? (pct >= 90 ? 'danger' : pct >= 80 ? 'warning' : undefined);
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <i className={t ?? ''} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The two letters of a person's avatar. */
export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

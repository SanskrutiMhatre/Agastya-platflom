// UI redesign screen 6 (owner approved mockups 2026-11-28, docs/audit/mockups/admin.html): the pieces the administration look adds to
// the design system's own (components/ui.tsx: StatTile, Progress, initialsOf). Used by the global pages (Administrator, Settings, Backup,
// Notifications, Activity, CIR, Graphics).

import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { tablistKeys, useHeadingLevel } from '../components/a11y';
import { Progress, type Tone } from '../components/ui';

/** The mockup page head: title and one line of purpose on the left, actions on the right. Under the main shell the title is an h2. */
export function AdmHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  const H = useHeadingLevel() === 1 ? 'h1' : 'h2';
  return (
    <div className="page-head">
      <div><H>{title}</H>{sub ? <p>{sub}</p> : null}</div>
      {actions ? <div className="row wrap">{actions}</div> : null}
    </div>
  );
}

/** The mockup's tab row (`.tabs` / `.tab`, the selected one underlined) where each tab is an address. `match` decides the selected tab
 *  (default: the address starts with the tab's). Arrow keys move between the tabs. */
export function TabLinks({ label, tabs }: { label: string; tabs: Array<{ to: string; label: ReactNode; match?: (path: string) => boolean; testId?: string }> }) {
  const { pathname } = useLocation();
  return (
    <div className="tabs adm-tabs" role="tablist" aria-label={label} onKeyDown={tablistKeys}>
      {tabs.map((t) => {
        const on = t.match ? t.match(pathname) : pathname === t.to || pathname.startsWith(`${t.to}/`);
        return <Link key={t.to} to={t.to} role="tab" aria-selected={on} className="tab" data-testid={t.testId}>{t.label}</Link>;
      })}
    </div>
  );
}

/** The sections inside one tab, as a row of chips (the selected one filled). A navigation landmark named for the page. */
export function SubNav({ label, items, more }: { label: string; items: Array<[string, string]>; more?: Array<[string, string]> }) {
  return (
    <nav className="chips adm-sub" aria-label={label}>
      {items.map(([to, text]) => <NavLink key={to} to={to} className="chip">{text}</NavLink>)}
      {more?.length ? <span className="adm-sub-sep" aria-hidden="true" /> : null}
      {more?.map(([to, text]) => <NavLink key={to} to={to} className="chip">{text}</NavLink>)}
    </nav>
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

/** Bytes for people: "18.4 GB", "296.3 KB". */
export const bytes = (n: number): string => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
};

/** "6 d 14 h", "3 h 12 min", "4 min" (the Service tile's uptime). */
export const duration = (seconds: number): string => {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${Math.max(m, 0)} min`;
};

// The items of the project rail, by project kind. A pure function (WP-34): ProjectShell renders it, and the parity baseline
// (src/parity/parity-dump.test.ts) calls it for every kind, so an item that disappears from one kind's rail is a recorded difference.

import type { Summary } from '../api';
import type { IconName } from '../components/Icon';

export interface RailItem { to: string; label: string; icon: IconName; badge?: { text: string; tone: 'bad' | 'warn' | 'ok' } | null }

export type RailSummary = { project: Pick<Summary['project'], 'type' | 'authoring' | 'format'>; validation: Summary['validation']; release: Summary['release'] };

export function projectRailItems(id: string, summary: RailSummary): RailItem[] {
  const v = summary.validation;
  const rel = summary.release;
  const isCir = summary.project.type === 'CIR';
  const jssDoc = summary.project.authoring === 'jss-xml';                      // a JSS document: its Explore and Publication pages show the document's chapters with their codes (DocExplorePage, DocPublicationPage)
  const jsg = summary.project.format === 'jsg';                                // a JSG document is one XML file too: the same two pages, no S1000D tools
  const s1000d = (summary.project.format ?? 's1000d') === 's1000d';           // validation (schemas, BREX) belongs to S1000D only
  return isCir ? [
    { to: `/projects/${id}/editor`, label: 'Editor', icon: 'editor' },
    { to: `/projects/${id}/graphics`, label: 'Graphics', icon: 'image' },
  ] : [
    // WP-22 (UX-007): the Project Home ("what is the state of this manual and what is next"), first; opening a project still lands in the Editor
    { to: `/projects/${id}/home`, label: 'Home', icon: 'home' },
    { to: `/projects/${id}/editor`, label: 'Editor', icon: 'editor' },
    { to: `/projects/${id}/explore`, label: 'Explore', icon: 'explore' },
    { to: `/projects/${id}/publication`, label: 'Publication', icon: 'book' },
    { to: `/projects/${id}/graphics`, label: 'Graphics', icon: 'image' },
    ...(jssDoc || jsg ? [{ to: `/projects/${id}/ancillary`, label: 'Ancillary pages', icon: 'file' as const }] : []),
    ...(s1000d ? [
      { to: `/projects/${id}/validation`, label: 'Validation', icon: 'shield' as const, badge: v && v.error > 0 ? { text: String(v.error), tone: 'bad' as const } : null },
    ] : []),
    { to: `/projects/${id}/release`, label: 'Release', icon: 'rocket', badge: rel?.pending ? { text: '!', tone: 'warn' } : rel?.released ? { text: `R${rel.number}`, tone: 'ok' } : null },
    { to: `/projects/${id}/settings`, label: 'Settings', icon: 'settings' },
  ];
}

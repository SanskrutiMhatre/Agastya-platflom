// The brand-pack choice of a project, as logic only (the picker is in pages/project/BrandPackSettings.tsx).
//
// The server REPLACES the whole `project` object on save, so a change always starts from the project that was read and changes one field.

import type { BrandPack } from '../api/brand';

/** The order the build resolves each piece of page furniture (backend/vendor/engine/brand.js). The brand pack is only the third source. */
export const BRAND_PRECEDENCE: readonly string[] = [
  'Settings that are filled in (the layout marks and header of the house template or of this project)',
  "The publication's own comments (directives written into the publication module)",
  'The brand pack chosen here',
  'Values derived from the data (issue and in-work number, the build date)',
  'Otherwise the item is left out, and the build log says so',
];

export const TEMPLATE_DEFAULT = '';

/** The project's saved choice; empty = the template's default. */
export const chosenPack = (project: { brandPack?: unknown } | null | undefined): string => (typeof project?.brandPack === 'string' ? project.brandPack : TEMPLATE_DEFAULT);

/** A copy of the project with only `brandPack` changed. An empty choice removes the field, so the template's default applies again. */
export function withBrandPack<T extends Record<string, unknown>>(project: T, id: string): T {
  const next: Record<string, unknown> = { ...project };
  if (id) next.brandPack = id; else delete next.brandPack;
  return next as T;
}

/** A saved choice that is no longer installed: the build then runs without the logo and company line (and says so in its log). */
export const isMissingPack = (id: string, packs: readonly BrandPack[]): boolean => !!id && !packs.some((p) => p.id === id);

/** What the template itself uses, when it names a pack; the picker says so next to "Template default". */
export const templatePackId = (house: { brandPack?: unknown } | null | undefined): string => (typeof house?.brandPack === 'string' ? house.brandPack : '');

export function packSummary(pack: BrandPack | undefined): string {
  if (!pack) return '';
  return [pack.hasLogo ? 'logo' : 'no logo', pack.company ? `company line "${pack.company}"` : 'no company line'].join(', ');
}

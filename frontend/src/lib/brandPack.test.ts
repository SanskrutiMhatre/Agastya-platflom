import { describe, expect, it } from 'vitest';
import type { BrandPack } from '../api/brand';
import { BRAND_PRECEDENCE, chosenPack, isMissingPack, packSummary, templatePackId, withBrandPack } from './brandPack';
import { canAssignModules, canChooseBrandPack, canImportPackage, canRecordWaiver } from './roles';
import type { ProjectRole } from '../api';

const packs: BrandPack[] = [{ id: 'neutral', name: 'Neutral', company: '', hasLogo: false }, { id: 'lnt', name: 'L&T', company: 'L&T Precision', hasLogo: true }];

describe('the project\'s brand-pack choice', () => {
  it('reads the saved choice; nothing saved is the template default', () => {
    expect(chosenPack({ brandPack: 'lnt' })).toBe('lnt');
    expect(chosenPack({})).toBe('');
    expect(chosenPack(null)).toBe('');
    expect(chosenPack({ brandPack: 5 })).toBe('');
  });

  it('changes only that field, on a copy, because the server replaces the whole project', () => {
    const project = { name: 'Pump', group: 'Naval', input: { pm: 'publication.xml' }, frontMatter: { pages: [1, 2] }, brandPack: 'neutral' };
    const before = JSON.stringify(project);
    const next = withBrandPack(project, 'lnt');
    expect(next).toEqual({ ...project, brandPack: 'lnt' });
    expect(JSON.stringify(project)).toBe(before);
    expect(next.frontMatter).toBe(project.frontMatter);        // the rest is carried over, not rebuilt
  });

  it('an empty choice removes the field so the template\'s default applies again', () => {
    const next = withBrandPack({ name: 'Pump', brandPack: 'lnt' } as Record<string, unknown>, '');
    expect('brandPack' in next).toBe(false);
    expect(next.name).toBe('Pump');
  });

  it('notices a saved pack that is no longer installed', () => {
    expect(isMissingPack('gone', packs)).toBe(true);
    expect(isMissingPack('lnt', packs)).toBe(false);
    expect(isMissingPack('', packs)).toBe(false);
  });

  it('reads the pack a template names and summarises a pack in a few words', () => {
    expect(templatePackId({ brandPack: 'neutral' })).toBe('neutral');
    expect(templatePackId({})).toBe('');
    expect(packSummary(packs[1])).toBe('logo, company line "L&T Precision"');
    expect(packSummary(packs[0])).toBe('no logo, no company line');
    expect(packSummary(undefined)).toBe('');
  });

  it('states the precedence in the order the build uses it', () => {
    expect(BRAND_PRECEDENCE).toHaveLength(5);
    expect(BRAND_PRECEDENCE[0]).toMatch(/^Settings that are filled in/);
    expect(BRAND_PRECEDENCE[1]).toMatch(/publication's own comments/);
    expect(BRAND_PRECEDENCE[2]).toMatch(/brand pack/);
    expect(BRAND_PRECEDENCE[3]).toMatch(/derived/i);
    expect(BRAND_PRECEDENCE[4]).toMatch(/left out/);
  });
});

describe('who sees the import, waiver and brand-pack actions', () => {
  const all: ProjectRole[] = ['viewer', 'reviewer', 'editor', 'manager', 'owner'];
  it('an editor, manager or owner may; a reviewer or viewer may not', () => {
    for (const fn of [canImportPackage, canAssignModules, canRecordWaiver, canChooseBrandPack]) {
      expect(all.filter((r) => fn(r))).toEqual(['editor', 'manager', 'owner']);
    }
  });
});

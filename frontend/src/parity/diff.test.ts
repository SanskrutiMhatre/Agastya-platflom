// WP-34: the parity diff fails on a removal that has no explanation row and on nothing else.
import { describe, expect, it } from 'vitest';
import { diffSurface, loadExplanations, EXPLANATIONS_FILE } from '../../scripts/parity/diff.mjs';
import { scanRoutes } from '../../scripts/parity/scan.mjs';

const baseline = { categories: { commands: [{ key: 'file.save' }, { key: 'file.exportHtml' }], routes: [{ key: '/overview' }] } };

describe('parity diff', () => {
  it('a removed item without an explanation is unexplained', () => {
    const d = diffSurface(baseline, { commands: [{ key: 'file.save' }] }, []);
    expect(d.unexplained).toEqual([{ category: 'commands', key: 'file.exportHtml' }]);
  });

  it('a removed item with an explanation row passes, and the row is reported with it', () => {
    const row = { category: 'commands', key: 'file.exportHtml', reason: 'merged into the Export menu', newHome: 'File > Export > HTML' };
    const d = diffSurface(baseline, { commands: [{ key: 'file.save' }] }, [row]);
    expect(d.unexplained).toEqual([]);
    expect(d.removed[0].explanation).toEqual(row);
  });

  it('an explanation for another category does not count', () => {
    const d = diffSurface(baseline, { commands: [{ key: 'file.save' }] }, [{ category: 'routes', key: 'file.exportHtml', reason: 'wrong category row', newHome: 'x' }]);
    expect(d.unexplained).toHaveLength(1);
  });

  it('additions never fail; a category not given is not compared', () => {
    const d = diffSurface(baseline, { commands: [{ key: 'file.save' }, { key: 'file.exportHtml' }, { key: 'file.new2' }] }, []);
    expect(d.unexplained).toEqual([]);
    expect(d.added).toEqual([{ category: 'commands', key: 'file.new2' }]);
  });

  it('the committed explanations file is well formed', () => {
    expect(loadExplanations(EXPLANATIONS_FILE).problems).toEqual([]);
  });

  it('the route scan sees permission conditions and redirects of removed screens', () => {
    const keys = scanRoutes().map((r) => r.key);
    expect(keys).toContain('/activity [if canMonitor(user)]');
    expect(keys).toContain('/projects/:id/csdb -> ../editor');
    expect(keys).toContain('/administrator/country-codes');                     // expanded from REFERENCE.map
    expect(keys).not.toContain('/projects/:id/csdb');
  });
});

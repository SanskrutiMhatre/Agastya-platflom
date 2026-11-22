// applicRefId authoring in the editor: adding an <applic> definition to a data module (and pointing an element at it) through the real editor,
// in all four issues, leaves the module XSD-valid, in the right place, with ONE undo step. (The picker UI is driven by e2e/s1000d-config.spec.ts.)
import { describe, it, expect } from 'vitest';
import { ISSUES, richDm, xsdValidate } from './lib';
import { bootApp } from './harness';
import type { DmCodeParts } from '../../core/s1000d';

const ACT: DmCodeParts = { modelIdentCode: 'EXAMPLE', systemDiffCode: 'A', systemCode: '00', subSystemCode: '0', subSubSystemCode: '0', assyCode: '00', disassyCode: '00', disassyCodeVariant: 'A', infoCode: '00W', infoCodeVariant: 'A', itemLocationCode: 'D' };
const APPLIC = '<applic><displayText><simplePara>Version: Mk1</simplePara></displayText><assert applicPropertyIdent="version" applicPropertyType="prodattr" applicPropertyValues="Mk1"/></applic>';
const names = (el: Element) => Array.from(el.children).map((c) => c.nodeName);

describe('editor: applicability definitions and applicRefId', () => {
  for (const issue of ISSUES) {
    it(`Issue ${issue}: a definition is added once, referenced, valid, and undone in one step`, async () => {
      const app = bootApp();
      const ed = (await app.openText(richDm('descript', issue), 'dm.xml', null))!;
      const para = Array.from(ed.doc.xml.getElementsByTagName('para'))[0];
      const before = ed.doc.toString();

      const id = ed.addApplicDefinition(APPLIC, para, ACT);
      expect(id).toMatch(/^appl/);
      const xml = ed.doc.xml;
      const content = xml.getElementsByTagName('content')[0];
      expect(names(content)[0]).toBe('referencedApplicGroup');                          // first in <content> (no <refs> in this module)
      const defs = Array.from(xml.getElementsByTagName('referencedApplicGroup')[0].children);
      expect(defs.map((d) => d.getAttribute('id'))).toEqual([id]);
      expect(para.getAttribute('applicRefId')).toBe(id);
      const status = xml.getElementsByTagName('dmStatus')[0];
      const order = names(status);
      expect(order.indexOf('applicCrossRefTableRef')).toBeGreaterThan(order.indexOf('originator'));
      expect(order.indexOf('applicCrossRefTableRef')).toBeLessThan(order.indexOf('applic'));   // XSD order: ... originator, applicCrossRefTableRef, applic ...

      const r = await xsdValidate(ed.doc.toString(), issue, 'descript');
      expect(r.errors.map((e) => `${e.el}: ${e.msg}`)).toEqual([]);

      // a second definition goes in the same group, with its own id; the ACT reference is not duplicated
      const id2 = ed.addApplicDefinition(APPLIC.replace('Mk1', 'Mk2'), null, ACT);
      expect(id2).not.toBe(id);
      expect(xml.getElementsByTagName('referencedApplicGroup')).toHaveLength(1);
      expect(xml.getElementsByTagName('applicCrossRefTableRef')).toHaveLength(1);
      expect((await xsdValidate(ed.doc.toString(), issue, 'descript')).errors).toEqual([]);

      // undo is one step per definition and restores the module exactly
      expect(ed.doc.undo()).toBe(true);
      expect(xml.getElementsByTagName('applic')).toHaveLength(2);                       // the dmStatus applic + the first definition
      expect(ed.doc.undo()).toBe(true);
      expect(ed.doc.toString()).toBe(before);
    }, 120_000);
  }

  it('refuses nonsense and leaves the document alone', async () => {
    const app = bootApp();
    const ed = (await app.openText(richDm('descript', '5-0'), 'dm.xml', null))!;
    const before = ed.doc.toString();
    expect(ed.addApplicDefinition('<para>not an applic</para>', null, null)).toBeNull();
    expect(ed.doc.toString()).toBe(before);
  });
});

// The Properties pane row for applicRefId (platform only): a list of THIS module's definitions, described by what they assert; standalone keeps a text box.
import { AttributesPanel } from '../../ui/panels';

describe('Properties pane: applicRefId', () => {
  const panelFor = async (platform: boolean) => {
    const app = bootApp();
    if (platform) (app as unknown as { host: unknown }).host = { projectRefs: () => null, reference: () => null, changed: () => undefined, isDark: () => false, beforeNew: async () => undefined };
    const ed = (await app.openText(richDm('descript', '5-0'), 'dm.xml', null))!;
    const para = Array.from(ed.doc.xml.getElementsByTagName('para'))[0];
    ed.addApplicDefinition(APPLIC, null, null);
    ed.selectElement(para);
    const panel = new AttributesPanel(app);
    panel.setEditor(ed);
    return { panel, ed, para };
  };

  it('on the platform it is a dropdown of the definitions with their meaning, and choosing one sets the attribute', async () => {
    const { panel, ed, para } = await panelFor(true);
    const sel = panel.el.querySelector<HTMLSelectElement>('select[data-attr="applicRefId"]')!;
    expect(sel, 'a dropdown, not a text box').toBeTruthy();
    const labels = Array.from(sel.options).map((o) => o.textContent);
    expect(labels[0]).toBe('(not set)');
    expect(labels[1]).toMatch(/^appl\S* – Version: Mk1$/);
    expect(panel.el.querySelector('[data-testid="applic-new"]'), 'a way to create a new definition').toBeTruthy();
    sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change'));
    expect(para.getAttribute('applicRefId')).toBe(sel.options[1].value);
    expect(ed.doc.toString()).toContain(`applicRefId="${sel.options[1].value}"`);
  });

  it('standalone Studio is unchanged: a text box with the ids as suggestions', async () => {
    const { panel } = await panelFor(false);
    const inp = panel.el.querySelector('[data-attr="applicRefId"]')!;
    expect(inp.tagName).toBe('INPUT');
    expect(panel.el.querySelector('[data-testid="applic-new"]')).toBeNull();
  });
});

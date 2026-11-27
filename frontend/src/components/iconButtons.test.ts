// WP-35 (UID-003): architecture rule "every icon-only button has an accessible name AND a tooltip".
// An icon-only button is a JSX <button> whose children carry no letter or digit: only <Icon/>, a glyph (×, ‹, ›, +, ☰) or nothing
// textual. Such a button must carry both `aria-label` (or `aria-labelledby`) for assistive technology and `title` for the tooltip
// (the browser shows it on hover; components/FocusTooltip.tsx shows it on keyboard focus). The shared `IconButton` in ui.tsx does both.
// The framework-free editors (Studio, JSS, JSG) build their buttons with DOM calls the parser cannot see; the runtime rule
// `icon-button-tooltip` of e2e/visual/a11y-audit.ts checks those on the rendered editors.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
});

const ICON_TAGS = new Set(['Icon']);
const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(s);

/** Whether a JSX child can render readable text (anything the parser cannot prove to be an icon or a glyph counts as text). */
function textual(c: ts.Node): boolean {
  if (ts.isJsxText(c)) return hasWord(c.text);
  if (ts.isJsxExpression(c)) return c.expression ? exprText(c.expression) : false;
  if (ts.isJsxElement(c)) return ICON_TAGS.has(c.openingElement.tagName.getText()) ? false : c.children.some(textual);
  if (ts.isJsxSelfClosingElement(c)) return !ICON_TAGS.has(c.tagName.getText());
  return true;
}
function exprText(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return exprText(e.expression);
  if (ts.isConditionalExpression(e)) return exprText(e.whenTrue) || exprText(e.whenFalse);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return exprText(e.right);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return hasWord(e.text);
  if (ts.isJsxSelfClosingElement(e) || ts.isJsxElement(e) || ts.isJsxFragment(e)) return ts.isJsxFragment(e) ? e.children.some(textual) : textual(e);
  if (e.kind === ts.SyntaxKind.NullKeyword) return false;
  return true;
}

export function iconButtonsWithoutTip(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'button' && !n.children.some(textual)) {
      const props = n.openingElement.attributes.properties;
      const names = new Set(props.map((a) => (ts.isJsxAttribute(a) ? a.name.getText() : '...')));
      const spread = names.has('...');
      const named = names.has('aria-label') || names.has('aria-labelledby');
      const tip = names.has('title');
      if (!spread && (!named || !tip)) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
        out.push(`${line + 1}: ${!named ? 'no aria-label' : ''}${!named && !tip ? ', ' : ''}${!tip ? 'no title (tooltip)' : ''}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('icon-only buttons have a name and a tooltip (UID-003)', () => {
  it('finds none without both in src', () => {
    const found = files(SRC).flatMap((f) => iconButtonsWithoutTip(f, readFileSync(f, 'utf8')).map((h) => `${relative(SRC, f)}:${h}`));
    expect(found).toEqual([]);
  });
  it('the rule is not vacuous', () => {
    const bad = [
      '<button onClick={go}><Icon name="trash" /></button>',
      '<button aria-label="Close" onClick={go}><Icon name="close" /></button>',
      '<button title="Next" onClick={go}>›</button>',
      '<button onClick={go}>{open ? <Icon name="up" /> : <Icon name="down" />}</button>',
      '<button onClick={go}>{"×"}</button>',
    ];
    for (const b of bad) expect(iconButtonsWithoutTip('x.tsx', `const a = ${b};`), b).toHaveLength(1);
    const good = [
      '<button aria-label="Close" title="Close" onClick={go}><Icon name="close" /></button>',
      '<button onClick={go}><Icon name="plus" /> New project</button>',
      '<button onClick={go}>{label}</button>',
      '<button onClick={go}>Fit</button>',
      '<IconButton label="Close" icon="close" onClick={go} />',
    ];
    for (const g of good) expect(iconButtonsWithoutTip('x.tsx', `const a = ${g};`), g).toEqual([]);
  });
});

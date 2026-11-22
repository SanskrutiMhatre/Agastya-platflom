/**
 * Table rule/padding layouts, registered with pdfmake *by name*.
 *
 * A pdfmake table normally carries its layout as an object of functions. Those cannot cross a `postMessage`, and the
 * document is laid out in a Web Worker, so every table names one of the layouts below instead and the worker registers
 * them once (`pdfMake.addTableLayouts(TABLE_LAYOUTS)`). The functions take the table node as their second argument, so
 * a layout does not depend on a particular table's size.
 *
 * Name: `cals:<frame>:<colsep><rowsep>[:list]` for a CALS table (frame `all|top|bottom|topbot|sides|none`, column and row
 * separators 1/0, `list` for the borderless front-matter lists), `box` for the placeholder of an image that is not linked.
 */
import { TABLE } from './pdf-theme';

export interface TableLook {
  frame: string;
  colsep: boolean;
  rowsep: boolean;
}

interface TableNodeLike {
  table: { body: unknown[]; widths?: unknown[] };
}

export interface NamedLayout {
  hLineWidth(i: number, node: TableNodeLike): number;
  vLineWidth(i: number, node: TableNodeLike): number;
  hLineColor(): string;
  vLineColor(): string;
  paddingLeft(): number;
  paddingRight(): number;
  paddingTop(): number;
  paddingBottom(i: number): number;
}

const FRAMES = ['all', 'top', 'bottom', 'topbot', 'sides', 'none'];

export function layoutName(look: TableLook, borderless: boolean): string {
  const frame = FRAMES.includes(look.frame) ? look.frame : 'none';
  return `cals:${frame}:${look.colsep ? 1 : 0}${look.rowsep ? 1 : 0}${borderless ? ':list' : ''}`;
}

function build(frame: string, colsep: boolean, rowsep: boolean, borderless: boolean): NamedLayout {
  const w = borderless ? 0 : TABLE.border;
  const topOn = frame === 'all' || frame === 'top' || frame === 'topbot';
  const botOn = frame === 'all' || frame === 'bottom' || frame === 'topbot';
  const sideOn = frame === 'all' || frame === 'sides';
  return {
    hLineWidth: (i, node) => (i === 0 ? (topOn ? w : 0) : i === node.table.body.length ? (botOn ? w : 0) : rowsep ? w : 0),
    vLineWidth: (i, node) => (i === 0 || i === (node.table.widths?.length ?? 0) ? (sideOn ? w : 0) : colsep ? w : 0),
    hLineColor: () => TABLE.borderColor,
    vLineColor: () => TABLE.borderColor,
    paddingLeft: () => (borderless ? 0 : TABLE.padX),
    paddingRight: () => (borderless ? 0 : TABLE.padX),
    // front-matter lists (borderless): 22.4 pt single-line rows, and 0.6 pt more under the header row
    paddingTop: () => (borderless ? TABLE.listPadY : TABLE.padY),
    paddingBottom: (i) => (borderless ? TABLE.listPadY + (i === 0 ? TABLE.listHeadExtra : 0) : TABLE.padY),
  };
}

/** Every layout a table can name. */
export const TABLE_LAYOUTS: Record<string, unknown> = (() => {
  const all: Record<string, unknown> = {
    box: { hLineWidth: () => 0.75, vLineWidth: () => 0.75, hLineColor: () => '#999999', vLineColor: () => '#999999' },
  };
  for (const frame of FRAMES) {
    for (const colsep of [false, true]) {
      for (const rowsep of [false, true]) {
        for (const borderless of [false, true]) all[layoutName({ frame, colsep, rowsep }, borderless)] = build(frame, colsep, rowsep, borderless);
      }
    }
  }
  return all;
})();

/** Width of the vertical rule `i` of a table with `cols` columns, for sizing columns before the table exists. */
export function vRuleWidth(look: TableLook, borderless: boolean, cols: number, i: number): number {
  return (TABLE_LAYOUTS[layoutName(look, borderless)] as NamedLayout).vLineWidth(i, { table: { body: [], widths: new Array(cols) } });
}

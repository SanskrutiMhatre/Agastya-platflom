/**
 * Schema grammar + content-model engine.
 *
 * Grammars are compiled from the official S1000D XSDs by scripts/build-grammar.mjs.
 * Content models are evaluated with Brzozowski derivatives over hash-consed
 * regular expressions. Two matching modes exist:
 *  - strict:  the child sequence must be a word of the content model language.
 *  - relaxed: the child sequence must be a *subsequence* of some word of the
 *             language (every particle treated as optional). This answers
 *             "can X be inserted here without making the structure
 *             irreparable", which is what structured-editing UIs need while a
 *             document is still incomplete.
 */

export interface JsonParticle { k: 'e' | 's' | 'c' | 'g' | 'a'; n?: string; a?: JsonParticle[]; m?: number; x?: number }
export interface JsonAttr { n: string; t: string; r?: 1; d?: string; f?: string }
export interface JsonType { mixed: 0 | 1; text?: 1; vt?: string; c: JsonParticle | null; a: JsonAttr[] }
export interface JsonSimple { b: string; e?: string[]; p?: string[]; list?: boolean; open?: boolean; minInclusive?: string; maxInclusive?: string; minLength?: string; maxLength?: string; length?: string }
export interface GrammarJson {
  issue: string;
  schema: string;
  root: string | null;
  elements: Record<string, string>;
  types: Record<string, JsonType>;
  groups: Record<string, JsonParticle>;
  simple: Record<string, JsonSimple>;
}

export interface AttrInfo {
  name: string;
  required: boolean;
  default?: string;
  fixed?: string;
  base: string;
  enumValues?: string[];
  openEnum?: boolean;
  patterns?: string[];
  list?: boolean;
  facets: Partial<Record<'minInclusive' | 'maxInclusive' | 'minLength' | 'maxLength' | 'length', string>>;
}

// ---------------------------------------------------------------- regex nodes
type Kind = 'eps' | 'nil' | 'el' | 'any' | 'seq' | 'alt' | 'rep';
export interface RNode {
  id: number;
  t: Kind;
  n?: string;
  a?: RNode[];
  p?: RNode;
  min?: number;
  max?: number;
  nullable: boolean;
}

class RegexFactory {
  private intern = new Map<string, RNode>();
  private nextId = 1;
  readonly eps: RNode;
  readonly nil: RNode;
  private dmemo = new Map<string, RNode>();

  constructor() {
    this.eps = this.mk('ε', { t: 'eps', nullable: true });
    this.nil = this.mk('∅', { t: 'nil', nullable: false });
  }

  private mk(key: string, n: Omit<RNode, 'id'>): RNode {
    let r = this.intern.get(key);
    if (!r) {
      r = { ...n, id: this.nextId++ } as RNode;
      this.intern.set(key, r);
    }
    return r;
  }

  el(name: string): RNode { return this.mk('e:' + name, { t: 'el', n: name, nullable: false }); }
  any(): RNode { return this.mk('*', { t: 'any', nullable: false }); }

  seq(parts: RNode[]): RNode {
    const flat: RNode[] = [];
    for (const p of parts) {
      if (p.t === 'nil') return this.nil;
      if (p.t === 'eps') continue;
      if (p.t === 'seq') flat.push(...p.a!);
      else flat.push(p);
    }
    if (flat.length === 0) return this.eps;
    if (flat.length === 1) return flat[0];
    return this.mk('s(' + flat.map((p) => p.id).join(',') + ')', { t: 'seq', a: flat, nullable: flat.every((p) => p.nullable) });
  }

  alt(parts: RNode[]): RNode {
    const flat: RNode[] = [];
    const seen = new Set<number>();
    const add = (p: RNode) => {
      if (p.t === 'nil' || seen.has(p.id)) return;
      seen.add(p.id);
      flat.push(p);
    };
    for (const p of parts) {
      if (p.t === 'alt') p.a!.forEach(add);
      else add(p);
    }
    if (flat.length === 0) return this.nil;
    if (flat.length === 1) return flat[0];
    const key = 'a(' + flat.map((p) => p.id).sort((x, y) => x - y).join(',') + ')';
    return this.mk(key, { t: 'alt', a: flat, nullable: flat.some((p) => p.nullable) });
  }

  rep(p: RNode, min: number, max: number): RNode {
    if (min === 1 && max === 1) return p;
    if (max === 0) return this.eps;
    if (p.t === 'eps') return this.eps;
    if (p.t === 'nil') return min === 0 ? this.eps : this.nil;
    return this.mk(`r(${p.id},${min},${max})`, { t: 'rep', p, min, max, nullable: min === 0 || p.nullable });
  }

  /** Derivative of r with respect to element symbol `sym`. */
  deriv(r: RNode, sym: string, relaxed: boolean): RNode {
    const key = (relaxed ? 'R' : 'S') + r.id + '|' + sym;
    const hit = this.dmemo.get(key);
    if (hit) return hit;
    let out: RNode;
    switch (r.t) {
      case 'eps':
      case 'nil':
        out = this.nil;
        break;
      case 'el':
        out = r.n === sym ? this.eps : this.nil;
        break;
      case 'any':
        out = this.eps;
        break;
      case 'seq': {
        const [h, ...t] = r.a!;
        const rest = this.seq(t);
        let res = this.seq([this.deriv(h, sym, relaxed), rest]);
        if (relaxed || h.nullable) res = this.alt([res, this.deriv(rest, sym, relaxed)]);
        out = res;
        break;
      }
      case 'alt':
        out = this.alt(r.a!.map((p) => this.deriv(p, sym, relaxed)));
        break;
      case 'rep': {
        const max = r.max!;
        const next = this.rep(r.p!, relaxed ? 0 : Math.max(0, r.min! - 1), max < 0 ? -1 : max - 1);
        out = this.seq([this.deriv(r.p!, sym, relaxed), next]);
        break;
      }
    }
    if (this.dmemo.size > 200000) this.dmemo.clear();
    this.dmemo.set(key, out);
    return out;
  }

  first(r: RNode, acc: Set<string>, relaxed: boolean, wild: { any: boolean }): void {
    switch (r.t) {
      case 'el': acc.add(r.n!); break;
      case 'any': wild.any = true; break;
      case 'seq':
        for (const p of r.a!) {
          this.first(p, acc, relaxed, wild);
          if (!relaxed && !p.nullable) break;
        }
        break;
      case 'alt': r.a!.forEach((p) => this.first(p, acc, relaxed, wild)); break;
      case 'rep': this.first(r.p!, acc, relaxed, wild); break;
    }
  }

  /** Shortest word accepted by r (used to build minimal valid skeletons). Ties prefer `prefer` names. */
  shortest(r: RNode, depth = 0, prefer: string[] = PREFERRED): string[] {
    if (depth > 40) return [];
    switch (r.t) {
      case 'eps':
      case 'nil':
      case 'any':
        return [];
      case 'el':
        return [r.n!];
      case 'seq':
        return r.a!.flatMap((p) => this.shortest(p, depth + 1, prefer));
      case 'alt': {
        if (r.nullable) return [];
        let best: string[] | null = null;
        const rank = (w: string[]) => {
          let m = prefer.length;
          for (const n of w) {
            const i = prefer.indexOf(n);
            if (i >= 0 && i < m) m = i;
          }
          return m;
        };
        for (const p of r.a!) {
          const s = this.shortest(p, depth + 1, prefer);
          if (best === null || s.length < best.length || (s.length === best.length && rank(s) < rank(best))) best = s;
        }
        return best ?? [];
      }
      case 'rep': {
        const one = this.shortest(r.p!, depth + 1, prefer);
        const out: string[] = [];
        for (let i = 0; i < Math.min(r.min!, 10); i++) out.push(...one);
        return out;
      }
    }
  }
}

/** Preferred elements when several minimal contents are possible (e.g. listItem: note|para -> para). */
const PREFERRED = ['para', 'warningAndCautionPara', 'notePara', 'simplePara', 'listItem', 'entry', 'row', 'tbody', 'graphic', 'title', 'applic', 'displayText'];

export interface ElementInfo {
  name: string;
  mixed: boolean;
  textOnly: boolean;
  empty: boolean;
  model: RNode | null;
  attrs: AttrInfo[];
  valueType?: AttrInfo;
}

export class Grammar {
  readonly issue: string;
  readonly schema: string;
  readonly root: string | null;
  private f = new RegexFactory();
  private json: GrammarJson;
  private groupCache = new Map<string, RNode>();
  private infoCache = new Map<string, ElementInfo>();
  private candCache = new Map<string, string[]>();
  private parentsIndex: Map<string, string[]> | null = null;

  constructor(json: GrammarJson) {
    this.json = json;
    this.issue = json.issue;
    this.schema = json.schema;
    this.root = json.root;
  }

  get elementNames(): string[] { return Object.keys(this.json.elements); }
  has(name: string): boolean { return name in this.json.elements; }

  private compile(p: JsonParticle): RNode {
    let r: RNode;
    switch (p.k) {
      case 'e': r = this.f.el(p.n!); break;
      case 'a': r = this.f.any(); break;
      case 's': r = this.f.seq(p.a!.map((c) => this.compile(c))); break;
      case 'c': r = this.f.alt(p.a!.map((c) => this.compile(c))); break;
      case 'g': {
        let g = this.groupCache.get(p.n!);
        if (!g) {
          const gj = this.json.groups[p.n!];
          g = gj ? this.compile(gj) : this.f.eps;
          this.groupCache.set(p.n!, g);
        }
        r = g;
        break;
      }
    }
    return this.f.rep(r, p.m ?? 1, p.x ?? 1);
  }

  attrInfo(a: JsonAttr): AttrInfo {
    const st = this.json.simple[a.t] ?? { b: 'string' };
    const facets: AttrInfo['facets'] = {};
    for (const k of ['minInclusive', 'maxInclusive', 'minLength', 'maxLength', 'length'] as const) if (st[k] != null) facets[k] = st[k];
    return {
      name: a.n,
      required: !!a.r,
      default: a.d,
      fixed: a.f,
      base: st.b,
      enumValues: st.e,
      openEnum: st.open,
      patterns: st.p,
      list: st.list,
      facets,
    };
  }

  info(name: string): ElementInfo | null {
    const cached = this.infoCache.get(name);
    if (cached) return cached;
    const tk = this.json.elements[name];
    if (tk == null) return null;
    const t = this.json.types[tk];
    if (!t) return null;
    const model = t.c ? this.compile(t.c) : null;
    const info: ElementInfo = {
      name,
      mixed: !!t.mixed,
      textOnly: !!t.text,
      empty: !t.mixed && !t.text && (!model || model.t === 'eps'),
      model,
      attrs: t.a.map((a) => this.attrInfo(a)),
    };
    if (t.vt) info.valueType = this.attrInfo({ n: '#value', t: t.vt });
    this.infoCache.set(name, info);
    return info;
  }

  /** Element may contain character data (mixed content or simple content). */
  allowsText(name: string): boolean {
    const i = this.info(name);
    return !!i && (i.mixed || i.textOnly);
  }

  isMixed(name: string): boolean { return !!this.info(name)?.mixed; }

  attributes(name: string): AttrInfo[] { return this.info(name)?.attrs ?? []; }

  attribute(name: string, attr: string): AttrInfo | undefined {
    return this.attributes(name).find((a) => a.name === attr);
  }

  /** All element names that can appear anywhere as children of `name`. */
  childCandidates(name: string): string[] {
    const hit = this.candCache.get(name);
    if (hit) return hit;
    const info = this.info(name);
    const acc = new Set<string>();
    const wild = { any: false };
    const walk = (r: RNode, seen: Set<number>) => {
      if (seen.has(r.id)) return;
      seen.add(r.id);
      if (r.t === 'el') acc.add(r.n!);
      else if (r.t === 'any') wild.any = true;
      r.a?.forEach((c) => walk(c, seen));
      if (r.p) walk(r.p, seen);
    };
    if (info?.model) walk(info.model, new Set());
    const out = [...acc];
    this.candCache.set(name, out);
    return out;
  }

  /** Elements whose content model can contain `child`. */
  parentsOf(child: string): string[] {
    if (!this.parentsIndex) {
      this.parentsIndex = new Map();
      for (const p of this.elementNames) {
        for (const c of this.childCandidates(p)) {
          let l = this.parentsIndex.get(c);
          if (!l) this.parentsIndex.set(c, (l = []));
          l.push(p);
        }
      }
    }
    return this.parentsIndex.get(child) ?? [];
  }

  private derive(r: RNode, word: string[], relaxed: boolean): RNode {
    for (const s of word) {
      r = this.f.deriv(r, s, relaxed);
      if (r.t === 'nil') break;
    }
    return r;
  }

  /** Strict validity of a complete child element sequence. */
  isValidContent(parent: string, children: string[]): boolean {
    const info = this.info(parent);
    if (!info) return true;
    if (!info.model) return children.length === 0;
    return this.derive(info.model, children, false).nullable;
  }

  /** Index of the first child that breaks the content model (strict prefix), or -1. */
  firstInvalidChild(parent: string, children: string[]): number {
    const info = this.info(parent);
    if (!info) return -1;
    if (!info.model) return children.length ? 0 : -1;
    let r = info.model;
    for (let i = 0; i < children.length; i++) {
      r = this.f.deriv(r, children[i], false);
      if (r.t === 'nil') return i;
    }
    return -1;
  }

  /** Relaxed membership: sequence can still be completed to a valid one by adding elements. */
  isRepairable(parent: string, children: string[]): boolean {
    const info = this.info(parent);
    if (!info) return true;
    if (!info.model) return children.length === 0;
    return this.derive(info.model, children, true).t !== 'nil';
  }

  canInsert(parent: string, children: string[], index: number, name: string): boolean {
    const info = this.info(parent);
    if (!info) return false;
    if (!info.model) return false;
    const seq = children.slice(0, index).concat(name, children.slice(index));
    return this.derive(info.model, seq, true).t !== 'nil';
  }

  /** Elements that may be inserted at `index` among `children` of `parent`. */
  allowedAt(parent: string, children: string[], index: number): string[] {
    const info = this.info(parent);
    if (!info?.model) return [];
    const prefix = this.derive(info.model, children.slice(0, index), true);
    if (prefix.t === 'nil') {
      // Existing content already broken: fall back to anything the parent can contain.
      return this.childCandidates(parent);
    }
    const suffix = children.slice(index);
    const out: string[] = [];
    for (const c of this.childCandidates(parent)) {
      const d = this.f.deriv(prefix, c, true);
      if (d.t === 'nil') continue;
      if (this.derive(d, suffix, true).t !== 'nil') out.push(c);
    }
    return out;
  }

  /** Elements that may legally come next after a (strict) prefix. */
  expectedNext(parent: string, prefix: string[]): string[] {
    const info = this.info(parent);
    if (!info?.model) return [];
    const d = this.derive(info.model, prefix, false);
    const acc = new Set<string>();
    const wild = { any: false };
    this.f.first(d, acc, false, wild);
    return [...acc];
  }

  /** Can the strict prefix be completed (by appending only)? */
  prefixOk(parent: string, prefix: string[]): boolean {
    const info = this.info(parent);
    if (!info?.model) return prefix.length === 0;
    return this.derive(info.model, prefix, false).t !== 'nil';
  }

  /** Minimal required child sequence of an element (shortest valid content). */
  requiredChildren(name: string): string[] {
    const info = this.info(name);
    if (!info?.model) return [];
    return this.f.shortest(info.model);
  }

  /** Elements that must be appended after `children` to make the content valid (if repairable by appending). */
  missingAtEnd(parent: string, children: string[]): string[] | null {
    const info = this.info(parent);
    if (!info?.model) return null;
    const d = this.derive(info.model, children, false);
    if (d.t === 'nil') return null;
    return d.nullable ? [] : this.f.shortest(d);
  }
}

// ---------------------------------------------------------------- loading
const cache = new Map<string, Promise<Grammar>>();
let grammarBase = '/grammar';

export function setGrammarBase(base: string) { grammarBase = base.replace(/\/$/, ''); }

export function loadGrammar(issue: string, schema: string): Promise<Grammar> {
  const key = issue + '/' + schema;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`${grammarBase}/${issue}/${schema}.json`).then(async (r) => {
      if (!r.ok) throw new Error(`Grammar not available for S1000D issue ${issue}, schema ${schema}`);
      return new Grammar((await r.json()) as GrammarJson);
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export function grammarFromJson(json: GrammarJson): Grammar { return new Grammar(json); }

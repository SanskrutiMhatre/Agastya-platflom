// The page furniture S1000D publications carry in the reference publications, supplied to the S1000D engine as stylesheet parameters:
//   - the SIDE TEXT: rotated text in the left margin of every page - "This is a draft copy of Issue 000-01" / "Printed <date time>" while the publication is
//     not released, and the publisher's name always;
//   - the default HEADER LOGO, when the publication names none of its own.
// Both are on by default and can be switched off or changed in the project's settings. They are passed only to the direct S1000D engine (the stylesheets
// headers_footers.xsl / frontmatter-shared.xsl; see "vendor exception no. 6" in docs/S1000D_COMPLETE_IMPLEMENTATION.md).

import fs from 'fs';
import path from 'path';
import { readProjectJson, pmRel } from './projects';
import { getConfig } from './projectConfig';

export interface SideTextSettings { enabled?: boolean; publisher?: string; draftNote?: boolean }
export const DEFAULT_LOGO_FILE = '_header-logo.png';
const LOGO_SOURCE = path.resolve(__dirname, '..', '..', 'assets', 'default-header-logo.png');

/** MODEL-ISSUER-NUMBER-VOLUME, the publication module's own code as the reference publications print it in the header. */
export function publicationCode(projectId: string, root: string): string {
  try {
    const xml = fs.readFileSync(path.join(root, pmRel(readProjectJson(projectId))), 'utf8').slice(0, 20000);
    const m = /<pmCode\b([^>]*)\/?>/.exec(xml); if (!m) return '';
    const g = (k: string) => new RegExp(`${k}\\s*=\\s*"([^"]*)"`).exec(m[1])?.[1] ?? '';
    return [g('modelIdentCode'), g('pmIssuer'), g('pmNumber'), g('pmVolume')].filter(Boolean).join('-');
  } catch { return ''; }
}

/** Add `extra` to `base`; a name `base` already has with a value is the project's own choice and stays, one with an empty value is filled. */
export function mergeParams(base: Array<[string, string]>, extra: Array<[string, string]>): Array<[string, string]> {
  const out = base.map(([n, v]) => [n, v] as [string, string]);
  for (const [n, v] of extra) { const i = out.findIndex(([x]) => x === n); if (i < 0) out.push([n, v]); else if (!out[i][1].trim()) out[i][1] = v; }
  return out;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const stamp = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "000-01" from the publication module's own issue info, or '' when it has none. */
function pmIssue(projectId: string, root: string): string {
  try {
    const xml = fs.readFileSync(path.join(root, pmRel(readProjectJson(projectId))), 'utf8').slice(0, 20000);
    const m = /<pmIdent>[\s\S]*?<issueInfo\b([^>]*)\/?>/.exec(xml); if (!m) return '';
    const g = (k: string) => new RegExp(`${k}\\s*=\\s*"([^"]*)"`).exec(m[1])?.[1] ?? '';
    return g('issueNumber') && g('inWork') ? `${g('issueNumber')}-${g('inWork')}` : '';
  } catch { return ''; }
}

/** The publisher's name: the setting, else the project's responsible partner company, else the publication module's. */
function publisherName(projectId: string, root: string, s: SideTextSettings): string {
  if (s.publisher !== undefined && s.publisher.trim()) return s.publisher.trim();
  try { const n = getConfig(projectId).responsiblePartner?.name; if (n) return n; } catch { /* no configuration */ }
  try {
    const xml = fs.readFileSync(path.join(root, pmRel(readProjectJson(projectId))), 'utf8').slice(0, 20000);
    return /<responsiblePartnerCompany\b[^>]*>\s*<enterpriseName>([^<]*)<\/enterpriseName>/.exec(xml)?.[1]?.trim() ?? '';
  } catch { return ''; }
}

/**
 * Stylesheet parameters for one build. `released`: the publication has an approved release (no draft note). Writes the default logo into the build directory
 * (a build artefact, like _watermark.svg) when it is used. Returns nothing at all for a project that switched the side text off and has its own logo.
 */
export function furnitureParams(projectId: string, opts: { released: boolean; dir: string; now?: Date }): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const pj = readProjectJson(projectId); const s: SideTextSettings = pj.sideText ?? {};
  const code = publicationCode(projectId, opts.dir); if (code) out.push(['header.publication.text', code]);
  if (s.enabled !== false) {
    const issue = pmIssue(projectId, opts.dir);
    const draft = !opts.released && s.draftNote !== false && issue ? `This is a draft copy of Issue ${issue}|Printed ${stamp(opts.now ?? new Date())}` : '';
    const pub = publisherName(projectId, opts.dir, s);
    if (draft) out.push(['side.text.1', draft]);
    if (pub) out.push(['side.text.2', pub]);
  }
  if (pj.headerLogo !== false && fs.existsSync(LOGO_SOURCE)) {
    try { fs.copyFileSync(LOGO_SOURCE, path.join(opts.dir, DEFAULT_LOGO_FILE)); out.push(['header.logo.uri', DEFAULT_LOGO_FILE]); } catch { /* no logo this time */ }
  }
  return out;
}

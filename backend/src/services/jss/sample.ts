// A ready-made JSS sample (Land or Naval User Handbook): the type's own starting document with DUMMY DATA under every heading (paragraphs, lists, tables, pictures and the three
// notices), about an invented "Demo Equipment DE-100", so a person can try the editor, the ancillary pages and the PDF.

import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { projectDirFor, workspace, workspaceDir } from '../../context';
import * as P from '../projects';
import { readSource, writeSource } from './service';

export type JssSampleDomain = 'land' | 'naval';
const SAMPLES: Record<JssSampleDomain, { type: string; name: string; platform: string }> = {
  land: { type: 'uhb', name: 'Sample - JSS Land User Handbook (Dummy Data)', platform: 'vehicle-mounted' },
  naval: { type: 'naval-uhb', name: 'Sample - JSS Naval User Handbook (Dummy Data)', platform: 'shipborne' },
};

const para = (t: string): string => `<para>${t}</para>`;
const list = (type: string, items: string[]): string => `<list type="${type}">${items.map((i) => `<item>${i}</item>`).join('')}</list>`;
const table = (title: string, widths: string, head: string[], rows: string[][]): string => {
  const row = (c: string[]): string => `<row>${c.map((x) => `<cell>${x}</cell>`).join('')}</row>`;
  return `<table widths="${widths}"><title>${title}</title><thead>${row(head)}</thead><tbody>${rows.map(row).join('')}</tbody></table>`;
};
const notice = (kind: 'note' | 'warning' | 'caution', t: string): string => `<${kind}><para>${t}</para></${kind}>`;

const EQ = 'Demo Equipment DE-100';
const figure = (title: string): string => `<figure><title>${title} (dummy picture)</title><graphic src="Media/sample-figure.png" width="90mm"/></figure>`;

/** Dummy content for the section titled `heading`; the kinds rotate so that every sort of content appears. */
function dummyFor(heading: string, n: number, platform: string): string {
  const intro = para(`This is dummy text for the section "${heading}" of the ${platform} ${EQ}. All names, numbers and values are dummy data.`);
  switch (n % 6) {
    case 0: return intro + list('alpha', ['Dummy point one.', 'Dummy point two.', 'Dummy point three.']);
    case 1: return intro + table(`Dummy Data ${n + 1}`, '10* 45* 25* 20*', ['Sl. No.', 'Parameter', 'Value', 'Unit'], [['1', 'Dummy parameter 1', '10', 'units'], ['2', 'Dummy parameter 2', '20', 'units'], ['3', 'Dummy parameter 3', '30', 'units']]);
    case 2: return intro + list('number', ['Carry out dummy step one.', 'Carry out dummy step two.', 'Check the <b>DUMMY</b> indicator.']) + notice('note', 'This is a dummy note.');
    case 3: return intro + figure(`Dummy view ${n + 1}`);
    case 4: return notice('warning', 'Dummy warning: this sentence is sample data only.') + intro + list('roman', ['Dummy item one.', 'Dummy item two.']);
    default: return notice('caution', 'Dummy caution: this sentence is sample data only.') + intro + table(`Dummy Items ${n + 1}`, '10* 55* 15* 20*', ['Sl. No.', 'Item', 'Qty', 'Remarks'], [['1', 'Dummy item A', '1', 'Dummy'], ['2', 'Dummy item B', '2', 'Dummy']]);
  }
}

export async function createJssSampleProject(user: P.User, folder?: string, domain: JssSampleDomain = 'land'): Promise<P.ProjectCard> {
  const s = SAMPLES[domain];
  let name = s.name;
  for (let n = 2; workspace.nameTaken(workspaceDir, name); n++) name = `${s.name} (${n})`;
  const card = await P.createProject(user, { name, folder, format: 'jss', domain, manualType: s.type } as P.CreateProjectInput);
  const media = path.join(projectDirFor(card.id), 'Media'); fs.mkdirSync(media, { recursive: true });
  fs.copyFileSync(path.join(config.root, 'samples', 'jss', 'dummy-figure.png'), path.join(media, 'sample-figure.png'));   // the drawn placeholder picture
  // dummy data right under every section's own title (a section's content comes before its sub-sections)
  let n = 0;
  const xml = readSource(card.id).xml
    .replace(/<systemName>[^<]*<\/systemName>|<systemName\/>/, `<systemName>${EQ}</systemName>`)
    .replace(/<section\b[^>]*>\s*<title>([^<]*)<\/title>/g, (opening: string, heading: string) => opening + dummyFor(heading, n++, s.platform));
  await writeSource(card.id, xml);
  return card;
}

// The JSG samples (User Handbook and Illustrated Spare Parts List): dummy data about an invented "Demo Equipment DE-100" (backend/samples/jsg-*, made by scripts/make-jsg-sample.js),
// so a person can try the editor, the ancillary pages and the PDF without a real document.

import fs from 'fs';
import path from 'path';
import { workspace, workspaceDir } from '../../context';
import * as P from '../projects';
import { projectDirFor } from '../../context';
import { jsgTypeById } from './registry';
import { SOURCE_NAME } from './service';

export type SampleKind = 'uhb' | 'ispl';
const SAMPLES: Record<SampleKind, { dir: string; name: string }> = {
  uhb: { dir: 'jsg-uhb', name: 'Sample - JSG User Handbook (Dummy Data)' },
  ispl: { dir: 'jsg-ispl', name: 'Sample - JSG Illustrated Spare Parts List (Dummy Data)' },
};
export const sampleDir = (kind: SampleKind): string => path.resolve(__dirname, '..', '..', '..', 'samples', SAMPLES[kind].dir);
export const SAMPLE_DIR = sampleDir('uhb');

export const jsgSampleAvailable = (kind: SampleKind = 'uhb'): boolean => fs.existsSync(path.join(sampleDir(kind), 'jsg-document.xml'));

export async function createJsgSampleProject(user: P.User, folder?: string, kind: SampleKind = 'uhb'): Promise<P.ProjectCard> {
  if (!SAMPLES[kind]) throw Object.assign(new Error('The sample kind is "uhb" or "ispl".'), { status: 400, code: 'BAD_SAMPLE' });
  if (!jsgSampleAvailable(kind)) throw Object.assign(new Error(`The JSG sample is not installed (backend/samples/${SAMPLES[kind].dir} is missing).`), { status: 404, code: 'NO_SAMPLE' });
  const SAMPLE_DIR = sampleDir(kind);
  const base = SAMPLES[kind].name;
  let name = base;
  for (let n = 2; workspace.nameTaken(workspaceDir, name); n++) name = `${base} (${n})`;
  const type = jsgTypeById(kind);
  const card = await P.createProject(user, { name, folder, format: 'jsg', domain: 'land', manualType: type?.id } as P.CreateProjectInput);
  const dir = projectDirFor(card.id);
  fs.copyFileSync(path.join(SAMPLE_DIR, 'jsg-document.xml'), path.join(dir, SOURCE_NAME));
  const media = path.join(SAMPLE_DIR, 'Media');
  if (fs.existsSync(media)) { fs.mkdirSync(path.join(dir, 'Media'), { recursive: true }); for (const f of fs.readdirSync(media)) fs.copyFileSync(path.join(media, f), path.join(dir, 'Media', f)); }
  return card;
}

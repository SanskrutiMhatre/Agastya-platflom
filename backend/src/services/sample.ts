// =============================================================================
// Sample project - a ready-made project for trying the platform: three real
// S1000D data modules (description, procedure, fault isolation), the figure they
// use, a publication with three chapters, and filled-in publication details, so
// every screen has something to show and a PDF can be built straight away.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { config, vendor } from '../config';
import { workspace, workspaceDir } from '../context';
import * as P from './projects';
import * as csdb from './csdb';
import * as pm from './pm';

const SAMPLES = path.join(config.root, 'samples');
const CHAPTERS: Array<{ title: string; infoCode: string }> = [
  { title: 'Description', infoCode: '040' },
  { title: 'Procedures', infoCode: '520' },
  { title: 'Fault isolation', infoCode: '421' },
];

export async function createSampleProject(user: P.User, folder?: string): Promise<P.ProjectCard> {
  const base = 'Sample - Hydraulic Pump';
  let name = base;
  for (let n = 2; workspace.nameTaken(workspaceDir, name); n++) name = `${base} (${n})`;

  const card = await P.createProject(user, { name, folder, format: 's1000d' });   // the S1000D wizard's project: the reference (Xignal) style and the direct engine
  const id = card.id;
  const actor = { id: user.id, username: user.username, role: user.role };

  for (const f of fs.readdirSync(SAMPLES)) {
    const src = path.join(SAMPLES, f);
    if (csdb.DM_FILE_RE.test(f)) await csdb.createDm(id, f, fs.readFileSync(src, 'utf8'), actor);
    else if (csdb.isImage(f)) fs.copyFileSync(src, path.join(csdb.csdbDir(id), f)); // beside the modules, where the figure's entity resolves
  }

  const dms = csdb.listDms(id);
  const entries = CHAPTERS.map((c) => ({
    type: 'folder' as const, title: c.title,
    children: dms.filter((d) => d.dmCodeAttrs.infoCode === c.infoCode).map((d) => ({
      type: 'dm' as const, dmCode: d.dmCodeAttrs, identExtension: d.identExtension, issueInfo: d.issueInfoAttrs, language: d.languageAttrs, techName: d.techName, infoName: d.infoName,
    })),
  })).filter((c) => c.children.length);
  const model = pm.readPm(id);
  pm.writePm(id, { meta: { ...model.meta, pmTitle: 'Hydraulic Pump Maintenance Manual', shortPmTitle: 'Hydraulic Pump' }, entries });

  P.updateProjectJson(id, (pj) => {
    pj.publication = {
      ...(pj.publication || {}),
      bookName: 'Hydraulic Pump Maintenance Manual', systemName: 'Hydraulic Pump', publicationNo: 'SAMPLE-001',
      securityClassification: 'RESTRICTED', month: String(new Date().getMonth() + 1).padStart(2, '0'), year: String(new Date().getFullYear()),
    };
  });
  void vendor;
  return P.projectCard(require('../context').store.getProjectRow(id), 'owner', user.role === 'admin' ? 'admin' : 'project');
}

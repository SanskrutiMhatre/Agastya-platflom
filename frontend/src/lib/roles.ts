import type { GlobalRole, ProjectRole, User } from '../api';

export const GLOBAL_LABEL: Record<GlobalRole, string> = { admin: 'Software administrator', project_manager: 'Project Manager', author: 'Author' };
export const globalLabel = (r: GlobalRole | undefined): string => (r ? GLOBAL_LABEL[r] : '');

export const PROJECT_LABEL: Record<ProjectRole, string> = { owner: 'Owner', manager: 'Project Manager', editor: 'Can edit', reviewer: 'Can review', viewer: 'Can view' };

/** Who gets the Activity dashboard: administrators (everything) and Project Managers (their projects). */
export const canMonitor = (u: User | null | undefined): boolean => !!u && (u.role === 'admin' || u.role === 'project_manager');

/*
  What the signed-in person may do inside a project (WP-13, FE-019). The SERVER computes it: every project card carries `can`, a map from the
  capability names its routes declare to true/false for this person's role, read from the route guards themselves (backend
  services/permissions.ts). The client no longer repeats the role ladder; it only asks the map. A missing map (an old server) allows nothing.
*/
export type Capability =
  | 'project.read' | 'project.clone' | 'project.rename' | 'project.delete'
  | 'dm.write' | 'dm.delete' | 'doc.lock' | 'pm.write' | 'graphics.write' | 'settings.write' | 'config.write'
  | 'publish.build' | 'publish.preview' | 'validate.run' | 'watermark.read' | 'watermark.write'
  | 'release.read' | 'release.submit' | 'release.decide' | 'review.comment'
  | 'members.read' | 'members.invite' | 'members.manage' | 'activity.read'
  | 'problems.review';
export type Can = Partial<Record<Capability, boolean>>;
export const may = (can: Can | null | undefined, cap: Capability): boolean => !!can?.[cap];

/*
  The newer project functions, by the capability their routes declare:
    package import  - scan and apply: dm.write; placing the modules no publication claimed: pm.write
    publish waivers - recording and withdrawing one: pm.write; anyone who can see the project may read them
*/
export const canImportPackage = (can: Can | null | undefined): boolean => may(can, 'dm.write');
export const canAssignModules = (can: Can | null | undefined): boolean => may(can, 'pm.write');
export const canRecordWaiver = (can: Can | null | undefined): boolean => may(can, 'pm.write');

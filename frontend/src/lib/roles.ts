import type { GlobalRole, ProjectRole, User } from '../api';

export const GLOBAL_LABEL: Record<GlobalRole, string> = { admin: 'Software administrator', project_manager: 'Project Manager', author: 'Author' };
export const globalLabel = (r: GlobalRole | undefined): string => (r ? GLOBAL_LABEL[r] : '');

export const PROJECT_LABEL: Record<ProjectRole, string> = { owner: 'Owner', manager: 'Project Manager', editor: 'Can edit', reviewer: 'Can review', viewer: 'Can view' };

/** Who gets the Activity dashboard: administrators (everything) and Project Managers (their projects). */
export const canMonitor = (u: User | null | undefined): boolean => !!u && (u.role === 'admin' || u.role === 'project_manager');

/** What each person may do inside a project, by project role. */
export const canWriteRole = (r: ProjectRole): boolean => r === 'editor' || r === 'manager' || r === 'owner';
export const canManageRole = (r: ProjectRole): boolean => r === 'manager' || r === 'owner';

/*
  Who may use the newer project functions. They mirror the server (the server decides; this only decides what is shown):
    package import - scan and apply need what a data module write needs ("Author or above": an editor, manager or owner of the project);
                     assigning the modules no publication claimed needs what writing the publication needs, which is the same level
    publish waivers - an editor or above records and withdraws them; anyone who can see the project may read them
    brand pack      - part of the project's settings, which an editor or above may change
  A reviewer can build and comment but not write, and a viewer only looks, so neither sees these actions.
*/
export const canImportPackage = (r: ProjectRole): boolean => canWriteRole(r);
export const canAssignModules = (r: ProjectRole): boolean => canWriteRole(r);
export const canRecordWaiver = (r: ProjectRole): boolean => canWriteRole(r);
export const canChooseBrandPack = (r: ProjectRole): boolean => canWriteRole(r);

/*
  Standard Numbering System (SNS). They mirror the server, which decides; this only decides what is shown:
    a project's SNS   - anyone who can see the project reads it; changing rows, importing, learning, ordering and deriving the publication structure
                        need what writing the publication needs: an editor, manager or owner (the server also asks for the project-write capability)
    organisation defaults - everyone signed in reads them; only a software administrator changes them
*/
export const canEditSns = (r: ProjectRole): boolean => canWriteRole(r);
export const canEditSnsDefaults = (u: User | null | undefined): boolean => !!u && u.role === 'admin';

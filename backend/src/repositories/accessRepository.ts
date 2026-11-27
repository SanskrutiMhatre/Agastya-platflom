// =============================================================================
// Groups, group grants, capability rules and the directory group map (audit WP-27: PLT-016, ENT-005, ENT-023). Migration 024.
//
// authz.evaluate (core/auth/authz.js) reads `groupRoleForProject` and `rulesFor` on every project decision, so a change made here (a person
// added to a group, a rule removed) applies to the very next request, without signing in again. The administrator screens and the project
// access routes write through the other methods. Dates are ISO strings, compared as text like everywhere in the schema.
// =============================================================================

import { SqliteRepository } from './sqliteBase';

export type ProjectRole = 'owner' | 'manager' | 'editor' | 'reviewer' | 'viewer';
export type MemberSource = 'local' | 'directory';
export interface AccessGroup { id: string; name: string; description: string; created_at: string; created_by: string | null; members?: number }
export interface GroupMember { group_id: string; user_id: string; source: MemberSource; added_at: string; username: string; full_name: string; disabled_at: string | null }
export interface GroupGrant { project_id: string; group_id: string; role: ProjectRole; granted_at: string; granted_by: string | null; name: string }
export interface CapabilityRule { id: string; project_id: string; subject_type: 'user' | 'group'; subject_id: string; capability: string; effect: 'allow' | 'deny'; created_at: string; created_by: string | null }
export interface DirectoryMapping { id: string; group_dn: string; global_role: string | null; group_id: string | null; created_at: string; created_by: string | null; group_name?: string | null }

export interface AccessRepository {
  listGroups(): AccessGroup[];
  getGroup(id: string): AccessGroup | null;
  findGroupByName(name: string): AccessGroup | null;
  createGroup(g: { id: string; name: string; description: string; now: string; by: string | null }): AccessGroup;
  updateGroup(id: string, f: { name?: string; description?: string }): AccessGroup | null;
  /** Removes the group, its members, its project grants and the rules that name it. Returns false when there was no such group. */
  deleteGroup(id: string): boolean;
  listGroupMembers(groupId: string): GroupMember[];
  addGroupMember(groupId: string, userId: string, source: MemberSource, now: string, by: string | null): void;
  removeGroupMember(groupId: string, userId: string): boolean;
  groupIdsForUser(userId: string): string[];
  /** The groups a directory feeds for this person become exactly `groupIds` (rows an administrator added by hand are kept). */
  replaceDirectoryMemberships(userId: string, groupIds: string[], now: string): { added: string[]; removed: string[] };

  listProjectGroupGrants(projectId: string): GroupGrant[];
  setProjectGroupGrant(projectId: string, groupId: string, role: ProjectRole, now: string, by: string | null): void;
  removeProjectGroupGrant(projectId: string, groupId: string): boolean;
  /** The strongest role any of the person's groups holds on the project, or null. */
  groupRoleForProject(projectId: string, userId: string): ProjectRole | null;
  /** Every project one of the person's groups is granted, with the strongest such role. */
  projectsGrantedToUser(userId: string): Array<{ project_id: string; role: ProjectRole }>;

  listRules(projectId: string): CapabilityRule[];
  /** Adds or replaces the rule for (project, subject, capability). */
  putRule(r: Omit<CapabilityRule, 'created_by'> & { created_by: string | null }): CapabilityRule;
  deleteRule(projectId: string, id: string): boolean;
  /** The rules of a project that apply to this person: their own, and their groups'. */
  rulesFor(projectId: string, userId: string): CapabilityRule[];
  /** Grants and rules of a deleted project. */
  deleteProjectAccess(projectId: string): void;

  listDirectoryMappings(): DirectoryMapping[];
  addDirectoryMapping(m: { id: string; groupDn: string; globalRole: string | null; groupId: string | null; now: string; by: string | null }): DirectoryMapping;
  deleteDirectoryMapping(id: string): boolean;
}

const RANK = `CASE g.role WHEN 'owner' THEN 5 WHEN 'manager' THEN 4 WHEN 'editor' THEN 3 WHEN 'reviewer' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END`;
const n = (r: { changes: number | bigint }): number => Number(r.changes);

export class SqliteAccessRepository extends SqliteRepository implements AccessRepository {
  listGroups(): AccessGroup[] {
    return this.q(`SELECT a.*, (SELECT COUNT(*) FROM access_group_members m WHERE m.group_id = a.id) AS members
                   FROM access_groups a ORDER BY a.name`).all() as unknown as AccessGroup[];
  }
  getGroup(id: string): AccessGroup | null {
    return (this.q('SELECT * FROM access_groups WHERE id = ?').get(id) as unknown as AccessGroup | undefined) ?? null;
  }
  findGroupByName(name: string): AccessGroup | null {
    return (this.q('SELECT * FROM access_groups WHERE name = ? COLLATE NOCASE').get(name) as unknown as AccessGroup | undefined) ?? null;
  }
  createGroup(g: { id: string; name: string; description: string; now: string; by: string | null }): AccessGroup {
    this.q('INSERT INTO access_groups (id, name, description, created_at, created_by) VALUES (?,?,?,?,?)').run(g.id, g.name, g.description, g.now, g.by);
    return this.getGroup(g.id) as AccessGroup;
  }
  updateGroup(id: string, f: { name?: string; description?: string }): AccessGroup | null {
    if (f.name !== undefined) this.q('UPDATE access_groups SET name = ? WHERE id = ?').run(f.name, id);
    if (f.description !== undefined) this.q('UPDATE access_groups SET description = ? WHERE id = ?').run(f.description, id);
    return this.getGroup(id);
  }
  deleteGroup(id: string): boolean {
    this.q('DELETE FROM access_group_members WHERE group_id = ?').run(id);
    this.q('DELETE FROM project_group_grants WHERE group_id = ?').run(id);
    this.q("DELETE FROM project_capability_rules WHERE subject_type = 'group' AND subject_id = ?").run(id);
    this.q('UPDATE directory_group_map SET group_id = NULL WHERE group_id = ?').run(id);
    return n(this.q('DELETE FROM access_groups WHERE id = ?').run(id)) > 0;
  }
  listGroupMembers(groupId: string): GroupMember[] {
    return this.q(`SELECT m.group_id, m.user_id, m.source, m.added_at, u.username, u.full_name, u.disabled_at
                   FROM access_group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.username`).all(groupId) as unknown as GroupMember[];
  }
  addGroupMember(groupId: string, userId: string, source: MemberSource, now: string, by: string | null): void {
    this.q(`INSERT INTO access_group_members (group_id, user_id, source, added_at, added_by) VALUES (?,?,?,?,?)
            ON CONFLICT(group_id, user_id) DO NOTHING`).run(groupId, userId, source, now, by);
  }
  removeGroupMember(groupId: string, userId: string): boolean {
    return n(this.q('DELETE FROM access_group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId)) > 0;
  }
  groupIdsForUser(userId: string): string[] {
    return (this.q('SELECT group_id FROM access_group_members WHERE user_id = ? ORDER BY group_id').all(userId) as Array<{ group_id: string }>).map((r) => r.group_id);
  }
  replaceDirectoryMemberships(userId: string, groupIds: string[], now: string): { added: string[]; removed: string[] } {
    const want = new Set(groupIds);
    const have = (this.q("SELECT group_id FROM access_group_members WHERE user_id = ? AND source = 'directory'").all(userId) as Array<{ group_id: string }>).map((r) => r.group_id);
    const removed = have.filter((g) => !want.has(g));
    for (const g of removed) this.q("DELETE FROM access_group_members WHERE group_id = ? AND user_id = ? AND source = 'directory'").run(g, userId);
    const added: string[] = [];
    for (const g of want) {
      if (have.includes(g)) continue;
      if (n(this.q(`INSERT INTO access_group_members (group_id, user_id, source, added_at, added_by) VALUES (?,?,'directory',?,NULL)
                    ON CONFLICT(group_id, user_id) DO NOTHING`).run(g, userId, now)) > 0) added.push(g);
    }
    return { added, removed };
  }

  listProjectGroupGrants(projectId: string): GroupGrant[] {
    return this.q(`SELECT g.*, a.name FROM project_group_grants g JOIN access_groups a ON a.id = g.group_id
                   WHERE g.project_id = ? ORDER BY a.name`).all(projectId) as unknown as GroupGrant[];
  }
  setProjectGroupGrant(projectId: string, groupId: string, role: ProjectRole, now: string, by: string | null): void {
    this.q(`INSERT INTO project_group_grants (project_id, group_id, role, granted_at, granted_by) VALUES (?,?,?,?,?)
            ON CONFLICT(project_id, group_id) DO UPDATE SET role = excluded.role, granted_at = excluded.granted_at, granted_by = excluded.granted_by`)
      .run(projectId, groupId, role, now, by);
  }
  removeProjectGroupGrant(projectId: string, groupId: string): boolean {
    return n(this.q('DELETE FROM project_group_grants WHERE project_id = ? AND group_id = ?').run(projectId, groupId)) > 0;
  }
  groupRoleForProject(projectId: string, userId: string): ProjectRole | null {
    const r = this.q(`SELECT g.role FROM project_group_grants g JOIN access_group_members m ON m.group_id = g.group_id
                      WHERE g.project_id = ? AND m.user_id = ? ORDER BY ${RANK} DESC LIMIT 1`).get(projectId, userId) as { role: ProjectRole } | undefined;
    return r ? r.role : null;
  }
  projectsGrantedToUser(userId: string): Array<{ project_id: string; role: ProjectRole }> {
    const rows = this.q(`SELECT g.project_id, g.role, ${RANK} AS rk FROM project_group_grants g JOIN access_group_members m ON m.group_id = g.group_id
                         WHERE m.user_id = ? ORDER BY g.project_id, rk DESC`).all(userId) as Array<{ project_id: string; role: ProjectRole }>;
    const best = new Map<string, ProjectRole>();
    for (const r of rows) if (!best.has(r.project_id)) best.set(r.project_id, r.role);
    return [...best].map(([project_id, role]) => ({ project_id, role }));
  }

  listRules(projectId: string): CapabilityRule[] {
    return this.q('SELECT * FROM project_capability_rules WHERE project_id = ? ORDER BY capability, subject_type, subject_id').all(projectId) as unknown as CapabilityRule[];
  }
  putRule(r: Omit<CapabilityRule, 'created_by'> & { created_by: string | null }): CapabilityRule {
    this.q(`INSERT INTO project_capability_rules (id, project_id, subject_type, subject_id, capability, effect, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(project_id, subject_type, subject_id, capability) DO UPDATE SET effect = excluded.effect, created_at = excluded.created_at, created_by = excluded.created_by`)
      .run(r.id, r.project_id, r.subject_type, r.subject_id, r.capability, r.effect, r.created_at, r.created_by);
    return this.q('SELECT * FROM project_capability_rules WHERE project_id = ? AND subject_type = ? AND subject_id = ? AND capability = ?')
      .get(r.project_id, r.subject_type, r.subject_id, r.capability) as unknown as CapabilityRule;
  }
  deleteRule(projectId: string, id: string): boolean {
    return n(this.q('DELETE FROM project_capability_rules WHERE project_id = ? AND id = ?').run(projectId, id)) > 0;
  }
  rulesFor(projectId: string, userId: string): CapabilityRule[] {
    return this.q(`SELECT r.* FROM project_capability_rules r WHERE r.project_id = ? AND (
                     (r.subject_type = 'user' AND r.subject_id = ?)
                     OR (r.subject_type = 'group' AND r.subject_id IN (SELECT group_id FROM access_group_members WHERE user_id = ?)))`)
      .all(projectId, userId, userId) as unknown as CapabilityRule[];
  }
  deleteProjectAccess(projectId: string): void {
    this.q('DELETE FROM project_group_grants WHERE project_id = ?').run(projectId);
    this.q('DELETE FROM project_capability_rules WHERE project_id = ?').run(projectId);
  }

  listDirectoryMappings(): DirectoryMapping[] {
    return this.q(`SELECT d.*, a.name AS group_name FROM directory_group_map d LEFT JOIN access_groups a ON a.id = d.group_id ORDER BY d.group_dn`).all() as unknown as DirectoryMapping[];
  }
  addDirectoryMapping(m: { id: string; groupDn: string; globalRole: string | null; groupId: string | null; now: string; by: string | null }): DirectoryMapping {
    this.q('INSERT INTO directory_group_map (id, group_dn, global_role, group_id, created_at, created_by) VALUES (?,?,?,?,?,?)').run(m.id, m.groupDn, m.globalRole, m.groupId, m.now, m.by);
    return this.listDirectoryMappings().find((x) => x.id === m.id) as DirectoryMapping;
  }
  deleteDirectoryMapping(id: string): boolean {
    return n(this.q('DELETE FROM directory_group_map WHERE id = ?').run(id)) > 0;
  }
}

// WP-22 (UX-007): the "Continue" card of the Project Home: the data module this person last had open in the S1000D editor of a project.
// A convenience of this browser (it says where to pick up, it is not a record), so it lives in localStorage, per project.

export interface ContinueDoc { file: string; title: string; at: string }
const key = (projectId: string) => `agastya.continue.${projectId}`;

export function rememberDoc(projectId: string, file: string, title: string): void {
  try { localStorage.setItem(key(projectId), JSON.stringify({ file, title, at: new Date().toISOString() })); } catch { /* private mode */ }
}

export function lastDoc(projectId: string): ContinueDoc | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(projectId)) ?? 'null');
    return v && typeof v.file === 'string' && typeof v.at === 'string' ? { file: v.file, title: typeof v.title === 'string' ? v.title : v.file, at: v.at } : null;
  } catch { return null; }
}

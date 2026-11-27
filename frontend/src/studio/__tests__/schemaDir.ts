// Where the Studio's schema set for an issue lives on disk (WP-18, FE-032). The sets 4-2, 5-0, 6 and 7 are the server's own
// (backend/schemas/4.2 ...), served to the browser at /schemas/<issue>/ by the backend; 4-1 and the shared entity files stay in public/schemas.
import path from 'node:path';

export const BACKEND_SCHEMAS = path.resolve(__dirname, '../../../../backend/schemas');
export const PUBLIC_SCHEMAS = path.resolve(__dirname, '../../../public/schemas');
export const SERVER_SETS: Record<string, string> = { '4-2': '4.2', '5-0': '5.0', '6': '6.0', '7': '7.0' };

export function schemaDir(issue: string): string {
  return SERVER_SETS[issue] ? path.join(BACKEND_SCHEMAS, SERVER_SETS[issue]) : path.join(PUBLIC_SCHEMAS, issue);
}

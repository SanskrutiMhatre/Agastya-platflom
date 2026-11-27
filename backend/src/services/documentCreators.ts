// =============================================================================
// Document creators: how a new JSS or JSG project gets its first document (audit WP-10, ARC-006).
//
// projects.ts used to load the JSS and JSG services with a lazy require() inside createProject, which hid an 8-module import cycle
// (projects -> jss/service -> xengine/project -> projectConfig -> ... -> projects). Now each engine registers its creator here when it
// loads, and projects.ts asks this leaf module. app.ts loads both engines (through their routes, and explicitly), so they are registered
// before the first request; a missing creator is a start-up wiring error and says so instead of creating a project without a document.
// =============================================================================

export type DocumentKind = 'jss' | 'jsg';
/** Write the first document of a new project of `typeId` (a JSS or JSG document type id). */
export type DocumentCreator = (projectId: string, typeId: string, opts: { projectName: string }) => void;

const creators = new Map<DocumentKind, DocumentCreator>();

export function registerDocumentCreator(kind: DocumentKind, create: DocumentCreator): void { creators.set(kind, create); }

export function documentCreator(kind: DocumentKind): DocumentCreator {
  const c = creators.get(kind);
  if (!c) throw new Error(`No ${kind.toUpperCase()} document creator is registered: the ${kind} engine was not loaded (app.ts loads it at start).`);
  return c;
}

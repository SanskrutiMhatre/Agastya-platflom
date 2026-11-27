// =============================================================================
// Document formats that are built by an engine of their own (audit WP-15, PUB-011), registered the way publishChecks.ts registers gate checks.
//
// The shared release flow (release.ts) and the shared S1000D / JSS build (publisher.ts) must not know such a format by name: the format's own
// engine stays isolated from theirs (JSG_ENGINE.md section 6, guarded by the jsg-engine ISOLATION test). The format registers here, when its engine
// loads, what the shared code needs to know:
//   - which file a release is recorded against, and which files its fingerprint covers;
//   - that the shared build must refuse the project, and what to say instead.
// A project no format claims is handled exactly as before.
// =============================================================================

export interface OwnEngineFormat {
  /** The format's name in messages ("JSG"). */
  name: string;
  owns(projectId: string): boolean;
  /** The project file a release is recorded against (project-relative). */
  releaseDocument(projectId: string): string;
  /** The project files a release fingerprint covers (project-relative, sorted). */
  releaseSources(projectId: string): string[];
  /** What the shared S1000D / JSS build answers for such a project (409). */
  refusal: { code: string; message: string };
}

const formats: OwnEngineFormat[] = [];

/** Registers a format (again: replaces it). */
export function registerOwnEngineFormat(f: OwnEngineFormat): void {
  const i = formats.findIndex((x) => x.name === f.name);
  if (i >= 0) formats[i] = f; else formats.push(f);
}

/** The format that owns a project, or null when the shared engines build it. */
export function ownEngineFormatOf(projectId: string): OwnEngineFormat | null {
  for (const f of formats) { try { if (f.owns(projectId)) return f; } catch { /* a project that cannot be read is nobody's */ } }
  return null;
}

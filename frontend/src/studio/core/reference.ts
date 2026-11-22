// The lists a host (the platform) can hand the New data module wizard so its fields are dropdowns instead of free text.
// All optional in effect: an empty list leaves that field a text box, so a host with nothing configured behaves as before.

/** The Administrator's global lists. */
export interface ReferenceData {
  languages: Array<{ code: string; name: string }>;
  countries: Array<{ code: string; name: string }>;
  dmTypes: Array<{ schema: string; name: string; infoCode?: string }>;
  security: Array<{ code: string; name: string }>;
  rpc: Array<{ cage: string; name: string }>;
  originators: Array<{ cage: string; name: string }>;
}

/**
 * The PROJECT's S1000D configuration as the wizard needs it (server: GET /api/projects/:id/s1000d + /applicability). A project value
 * always wins over a browser-remembered one, and what the project does not set is left to the author.
 */
export interface ProjectRefs {
  /** '' = the project has not set it yet. */
  mic: string;
  /** Issue key as the wizard uses it ('4-2', '5-0', '6', '7'); null = the project has no issue yet (the author picks). */
  issue: string | null;
  language: string; country: string;
  responsiblePartner: { code: string; name: string }; originator: { code: string; name: string };
  security: string;
  brex: { mode: 'default' | 'project'; dmc: string | null };
  /** Codes the project offers for its issue, per kind. */
  codes: { infoCode: Array<{ code: string; title: string }>; learnCode: Array<{ code: string; title: string }>; learnEventCode: Array<{ code: string; title: string }>; itemLocationCode: Array<{ code: string; title: string }> };
  dmTypes: Array<{ schema: string; name: string; enabled: boolean; defaultCode: string; recommended: string[]; unresolved: string | null }>;
  /** The project's own SNS (flat: path "21", "21/10", "21/10/00"). Empty = free text. */
  sns: Array<{ path: string; level: number; code: string; title: string }>;
  snsEnforced: boolean;
  /** The project's applicability definitions; null when it has no ACT. */
  applic: null | {
    act: { mic: string; info: string; schemaFile: string };
    attributes: Array<{ id: string; name: string; values: string[]; type: string }>;
    conditions: Array<{ id: string; name: string; values: string[]; type: string }>;
  };
}

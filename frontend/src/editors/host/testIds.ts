// WP-21: the test ids the JSS and JSG pages had before the host drew them, written out in full (not `${kind}-state`) so that the parity scan
// (scripts/parity/scan.mjs) still finds each one where it is rendered, and the e2e specs that use them keep working unchanged.

export const DOC_IDS = {
  jss: {
    state: { 'data-testid': 'jss-state' }, split: { 'data-testid': 'jss-split' }, host: { 'data-testid': 'jss-host' },
    note: { 'data-testid': 'jss-note' }, download: { 'data-testid': 'jss-download' }, conflict: { 'data-testid': 'jss-conflict' },
  },
  jsg: {
    state: { 'data-testid': 'jsg-state' }, split: { 'data-testid': 'jsg-split' }, host: { 'data-testid': 'jsg-host' },
    note: { 'data-testid': 'jsg-note' }, download: { 'data-testid': 'jsg-download' }, conflict: { 'data-testid': 'jsg-conflict' },
  },
} as const;

/** the S1000D page's save-state chip */
export const S1000D_STATE = { 'data-testid': 'save-state' } as const;

export type TestId = { readonly 'data-testid': string };

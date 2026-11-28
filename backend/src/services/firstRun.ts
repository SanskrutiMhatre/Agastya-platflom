// =============================================================================
// The account side of a first start (Phase 3, P3-6; docs/phase3/standalone.md). Called by the server's start (index.ts) and by the
// installer's tool (scripts/default-accounts.js), so both take the same steps in the same order:
//
//   1. standalone only: the default accounts of a fresh data folder (core/auth/defaultAccounts.js; once per data folder, never again);
//   2. every mode: the INITIAL_ADMIN_* bootstrap administrator (core/auth/bootstrap.js; a no-op once any administrator exists).
//
// A common server (AGASTYA_DEPLOYMENT=server, the default) only ever runs step 2, exactly as before P3-6: its first administrator is
// created by the setup screen (POST /api/auth/setup) or INITIAL_ADMIN_*, everyone else through user management.
// =============================================================================

import type { AccountDeployment } from '../config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureDefaultAccounts } = require('../core/auth/defaultAccounts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureBootstrapAdmin } = require('../core/auth/bootstrap');

export interface FirstRunDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any;
  audit: (fields: Record<string, unknown>) => void;
  deployment: AccountDeployment;
  initialAdmin?: { INITIAL_ADMIN_USERNAME?: string; INITIAL_ADMIN_PASSWORD?: string };
  log?: (line: string) => void;
}

export interface FirstRunResult { defaultAccounts: { created: string[]; reason: string }; bootstrap: { created: boolean; reason?: string } }

export async function initialiseAccounts(d: FirstRunDeps): Promise<FirstRunResult> {
  const log = d.log ?? ((l: string) => console.log(l));
  const defaultAccounts = await ensureDefaultAccounts({ store: d.store, audit: d.audit, deployment: d.deployment, log, now: () => new Date() });
  const bootstrap = await ensureBootstrapAdmin({ store: d.store, audit: d.audit, env: d.initialAdmin ?? {}, log, now: () => new Date() });
  return { defaultAccounts, bootstrap };
}

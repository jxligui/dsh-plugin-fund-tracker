/** Fund tracker Host entry.
 *
 * Responsibilities (thin on purpose):
 *  - declare Host service dependencies (inject)
 *  - open the SQLite store, kick off library refresh
 *  - DSH login gate: holdings are private, per signed-in account
 *  - delegate HTTP handling to lib/routes.js
 *  - clean up everything on unload
 */

export const inject = ['webServer', 'connection', 'deepseekAccount'];

import { openDb, refreshLibrary } from './lib/store.js';
import { registerRoutes } from './lib/routes.js';

export function apply(ctx) {
  const deepseekAccount = ctx.deepseekAccount;

  let db;
  try {
    db = openDb();
    refreshLibrary(db); // async seed/refresh of the local fund/index library
  } catch (error) {
    console.error('[fund-tracker] failed to open SQLite database', error);
  }

  const accountState = async () => {
    try {
      const view = deepseekAccount ? await deepseekAccount.getState() : null;
      const loggedIn = !!(view && view.status === 'credential-stored');
      const profile = view && view.profile;
      const account = loggedIn
        ? String((profile && (profile.userId ?? profile.id)) || 'dsh-account')
        : null;
      return { loggedIn, account };
    } catch (error) {
      console.error('[fund-tracker] account state lookup failed', error);
      return { loggedIn: false, account: null };
    }
  };

  const requireAccount = async () => {
    const state = await accountState();
    if (!state.loggedIn || !state.account || !db) return null;
    return state;
  };

  const disposeRoutes = registerRoutes(ctx, {
    getDb: () => db,
    accountState,
    requireAccount,
  });

  return () => {
    if (typeof disposeRoutes === 'function') disposeRoutes();
    if (db) {
      try { db.close(); } catch {}
    }
  };
}

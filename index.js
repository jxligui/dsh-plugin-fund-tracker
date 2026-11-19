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

import { openDb, refreshLibrary, settleTrades, upsertNavs, nextNavBatch, commitNavBatch, navSyncStats, syncOnSale } from './lib/store.js';
import { registerRoutes, syncNavs } from './lib/routes.js';
import { fetchNavHistory, fetchJdzPage } from './lib/market.js';

// Background NAV sync cadence. NAVs are published once per fund-day (evening),
// so 30 minutes is plenty; syncNavs itself throttles to the same window and
// skips codes whose latest stored NAV is already today's.
const NAV_TIMER_MS = 30 * 60 * 1000;
const NAV_FIRST_RUN_MS = 60 * 1000;

// Full-library NAV sync: every fund in fund_base (~28k codes) walked in
// resumable batches. 300 codes / 30s / concurrency 10 finishes a pass in
// ~45 minutes; a fresh pass starts at most once every 20 hours.
const NAV_ALL_STEP_MS = 30 * 1000;
const NAV_ALL_BATCH = 300;
const NAV_ALL_CONCURRENCY = 10;
const NAV_ALL_PASS_MS = 20 * 3600 * 1000;

/** Sync NAV history for every held fund (all accounts), then settle trades. */
async function backgroundSync(db) {
  try {
    const codes = db.prepare('SELECT DISTINCT code FROM holdings').all().map(r => r.code);
    const result = await syncNavs(db, codes);
    const accounts = db.prepare('SELECT DISTINCT account FROM holdings').all().map(r => r.account);
    let settled = 0;
    for (const account of accounts) settled += settleTrades(db, account);
    if (result.synced || settled) {
      console.log(`[fund-tracker] background sync: ${result.synced} funds nav-updated, ${settled} trades settled`);
    }
    // On-sale flags + bulk NAV day for the whole library (self-throttled 20h).
    await syncOnSale(db, fetchJdzPage);
  } catch (error) {
    console.error('[fund-tracker] background nav sync failed', error);
  }
}

/** One resumable batch of the all-funds NAV walk (latest NAV day per code). */
async function syncAllNavsStep(db) {
  try {
    const stats = navSyncStats(db);
    if (stats.doneAt && Date.now() - stats.doneAt < NAV_ALL_PASS_MS) return; // pass complete, throttled
    const { codes, next } = nextNavBatch(db, NAV_ALL_BATCH);
    if (codes.length === 0) return;
    let fetched = 0;
    for (let i = 0; i < codes.length; i += NAV_ALL_CONCURRENCY) {
      const slice = codes.slice(i, i + NAV_ALL_CONCURRENCY);
      await Promise.all(slice.map(async code => {
        const rows = await fetchNavHistory(code, 1); // latest published NAV only
        if (rows.length > 0) { upsertNavs(db, code, rows); fetched += 1; }
      }));
    }
    commitNavBatch(db, next);
    if (!next) console.log('[fund-tracker] all-fund NAV pass complete:', navSyncStats(db));
    else if (Math.random() < 0.1) console.log(`[fund-tracker] all-fund NAV progress: cursor ${next}, got ${fetched}/${codes.length} this batch`);
  } catch (error) {
    console.error('[fund-tracker] all-fund NAV batch failed', error);
  }
}

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

  // Scheduled task: keep fund_nav current and settle pending trades even when
  // the panel is never opened (daemon-style, host-lifetime timer).
  let navBusy = false;
  const runBackgroundSync = async () => {
    if (!db || navBusy) return;
    navBusy = true;
    try { await backgroundSync(db); } finally { navBusy = false; }
  };
  let navAllBusy = false;
  const runAllNavsStep = async () => {
    if (!db || navAllBusy) return;
    navAllBusy = true;
    try { await syncAllNavsStep(db); } finally { navAllBusy = false; }
  };
  const navFirstRun = setTimeout(runBackgroundSync, NAV_FIRST_RUN_MS);
  const navTimer = setInterval(runBackgroundSync, NAV_TIMER_MS);
  if (typeof navTimer.unref === 'function') navTimer.unref();
  // The all-fund walk starts after the library refresh has had time to seed
  // fund_base (otherwise the first pass would be tiny).
  const navAllFirstRun = setTimeout(runAllNavsStep, 5 * 60 * 1000);
  const navAllTimer = setInterval(runAllNavsStep, NAV_ALL_STEP_MS);
  if (typeof navAllTimer.unref === 'function') navAllTimer.unref();

  return () => {
    clearTimeout(navFirstRun);
    clearInterval(navTimer);
    clearTimeout(navAllFirstRun);
    clearInterval(navAllTimer);
    if (typeof disposeRoutes === 'function') disposeRoutes();
    if (db) {
      try { db.close(); } catch {}
    }
  };
}

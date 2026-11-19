/** API route handlers for the fund tracker (native Node http handlers).
 *
 * Layering: index.js (entry/wiring) -> routes.js (HTTP handlers)
 *   -> store.js (SQLite persistence) / market.js (remote adapters).
 *
 * webServer.register requires { kind: 'exact', path, handler(req, res) }.
 * Every request passes connection.admit() so the browser peer token is
 * enforced exactly like the built-in /api gateway.
 */

import { homedir } from 'node:os';
import { MAX_CODES, DEFAULT_INDICE_CODES } from './constants.js';
import {
  refreshLibrary, libInfo, searchLocal, listHoldings, listPortfolio,
  upsertHolding, deleteHolding, getSetting, setSetting, indexLibrary,
  fundPage, indexPage, fundTypes, syncEtfLibrary, etfInfo, adjustShares, setWatch, seedDemoHoldings,
  upsertNavs, latestNav, recordTrade, settleTrades, todayStr, navSyncStats, syncOnSale,
  listGroups, addGroup, renameGroup, deleteGroup, setHoldingGroup,
} from './store.js';
import { fetchFundQuotes, fetchIndices, searchFunds, fetchDetail, fetchNavHistory, fetchJdzPage } from './market.js';

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// Sync daily NAV history into fund_nav for the given codes. Codes whose
// latest stored NAV is already today's are skipped; a 30-minute global
// throttle covers the window before today's NAV is published in the evening
// (repeated opens during the day do not re-hit the remote API). Shared by the
// list/trade handlers and the background timer in index.js.
export async function syncNavs(db, codes) {
  if (!db || !Array.isArray(codes) || codes.length === 0) return { synced: 0 };
  const today = todayStr();
  const need = [];
  for (const code of codes) {
    if (!/^\d{6}$/.test(code)) continue;
    const latest = latestNav(db, code);
    if (!latest || latest.date < today) need.push(code);
  }
  if (need.length === 0) return { synced: 0 };
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('nav_synced_at');
    const last = row ? Number(row.value) : 0;
    const fresh = need.filter(code => latestNav(db, code) == null); // never-fetched codes always fetch
    if (Date.now() - last < 30 * 60 * 1000 && fresh.length === 0) return { synced: 0 };
    await Promise.all(need.map(async code => {
      const rows = await fetchNavHistory(code, 15);
      upsertNavs(db, code, rows);
    }));
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('nav_synced_at', String(Date.now()));
    return { synced: need.length };
  } catch (error) {
    console.error('[fund-tracker] nav sync failed', error);
    return { synced: 0, error: String((error && error.message) || error) };
  }
}

export function registerRoutes(ctx, { getDb, accountState, requireAccount }) {
  const webServer = ctx.webServer;
  const connection = ctx.connection;
  const disposes = [];

  const register = (path, handler) => {
    disposes.push(webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          if (connection) {
            const admission = connection.admit(req);
            if (admission && 'rejection' in admission) {
              sendJson(res, { error: admission.rejection === 401 ? 'unauthorized' : 'forbidden' }, admission.rejection);
              return;
            }
          }
          await handler(req, res);
        } catch (error) {
          console.error(`[fund-tracker] ${path} handler failed`, error);
          sendJson(res, { error: String((error && error.message) || error) }, 500);
        }
      },
    }));
  };

  try {
    register('/fund-tracker/quotes', async (req, res) => {
      const db = getDb();
      const url = new URL(req.url, 'http://local');

      if (url.searchParams.get('market') === '1') {
        const { indices, etfs } = await fetchIndices(db);
        sendJson(res, { indices, etfs, fetchedAt: new Date().toISOString() });
        return;
      }

      const codes = (url.searchParams.get('codes') || '')
        .split(',')
        .map(c => c.trim())
        .filter(c => /^\d{6}$/.test(c))
        .slice(0, MAX_CODES);
      const quotes = await fetchFundQuotes(codes);
      sendJson(res, { quotes: quotes.quotes, yesterday: quotes.yesterday, fetchedAt: new Date().toISOString() });
    });

    register('/fund-tracker/api', async (req, res) => {
      const db = getDb();
      const url = new URL(req.url, 'http://local');
      const action = url.searchParams.get('action') || '';

      // --- public (no login) ---
      if (action === 'debug') {
        let fundCount = null;
        let indexCount = null;
        let dbError = null;
        try {
          fundCount = db.prepare('SELECT COUNT(*) n FROM fund_base').get().n;
          indexCount = db.prepare('SELECT COUNT(*) n FROM index_base').get().n;
        } catch (error) {
          dbError = String((error && error.message) || error);
        }
        sendJson(res, {
          hasDb: !!db, fundCount, indexCount, dbError,
          profileDir: process.env.DSH_PROFILE_DIR || null, home: homedir(),
        });
        return;
      }

      if (action === 'session') {
        sendJson(res, await accountState());
        return;
      }

      if (action === 'libinfo') {
        const info = libInfo(db);
        const etf = etfInfo(db);
        sendJson(res, { ...info, etfCount: etf.count, etfThemes: etf.themes, nav: navSyncStats(db) });
        return;
      }

      if (action === 'indices') {
        const state = await accountState();
        let selected = DEFAULT_INDICE_CODES;
        if (state.loggedIn && state.account) {
          const saved = getSetting(db, state.account, 'indices');
          if (Array.isArray(saved) && saved.length > 0) selected = saved;
        }
        sendJson(res, { library: indexLibrary(db), selected, loggedIn: state.loggedIn });
        return;
      }

      if (action === 'search') {
        const query = (url.searchParams.get('query') || '').trim().slice(0, 40);
        if (!query) { sendJson(res, { items: [], local: 0 }); return; }
        let local = searchLocal(db, query);
        if (local.length === 0 && db) {
          await refreshLibrary(db); // lazy retry of the seed if the first attempt failed
          local = searchLocal(db, query);
        }
        const localItems = [];
        const seen = new Set();
        for (const r of local) {
          if (seen.has(r.code)) continue;
          seen.add(r.code);
          localItems.push({ code: r.code, name: r.name, type: r.kind === 'index' ? '指数' : r.type || '', kind: r.kind });
        }
        if (localItems.length >= 8) { sendJson(res, { items: localItems, local: localItems.length }); return; }
        const remote = await searchFunds(query);
        const merged = [...localItems, ...remote.filter(x => !seen.has(x.code))];
        sendJson(res, { items: merged, local: localItems.length });
        return;
      }

      if (action === 'detail') {
        const code = (url.searchParams.get('code') || '').trim();
        if (!/^\d{6}$/.test(code)) { sendJson(res, { detail: null, error: 'invalid code' }); return; }
        sendJson(res, { detail: await fetchDetail(code) });
        return;
      }

      if (action === 'fundlist') {
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const size = Math.min(50, Math.max(5, Number(url.searchParams.get('size')) || 20));
        const query = (url.searchParams.get('query') || '').slice(0, 40);
        const type = (url.searchParams.get('type') || '').slice(0, 20);
        // 基金状态筛选：默认在售（on_sale=1），all = 全部基金。
        const status = url.searchParams.get('status') === 'all' ? 'all' : 'onsale';
        sendJson(res, { page, size, ...fundPage(db, { page, size, query, type, status }) });
        return;
      }

      if (action === 'fundtypes') {
        const status = url.searchParams.get('status') === 'all' ? 'all' : 'onsale';
        sendJson(res, { types: fundTypes(db, { status }) });
        return;
      }

      if (action === 'indexlist') {
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const size = Math.min(50, Math.max(4, Number(url.searchParams.get('size')) || 12));
        sendJson(res, { page, size, ...indexPage(db, { page, size }) });
        return;
      }

      // --- private (per-account data) ---
      if (action === 'etfinfo') {
        sendJson(res, etfInfo(db));
        return;
      }

      if (action === 'syncetf') {
        if (!(await requireAccount())) { sendJson(res, { error: 'forbidden' }, 403); return; }
        sendJson(res, syncEtfLibrary(db));
        return;
      }

      if (action === 'refreshlib') {
        if (!(await requireAccount())) { sendJson(res, { error: 'forbidden' }, 403); return; }
        const info = await refreshLibrary(db, true);
        const etf = syncEtfLibrary(db); // one sync keeps the ETF master list in step with the big library
        const onSale = await syncOnSale(db, fetchJdzPage, true); // on-sale flags + bulk NAV day
        sendJson(res, { ...info, etfCount: etf.count, onSale: onSale.onSale });
        return;
      }

      if (action === 'savesettings') {
        const state = await requireAccount();
        if (!state) { sendJson(res, { error: 'forbidden' }, 403); return; }
        const body = await readBody(req);
        const key = String(body.key || '').slice(0, 40);
        if (key !== 'indices') { sendJson(res, { error: 'unknown key' }, 400); return; }
        const value = Array.isArray(body.value) ? body.value.map(String).filter(Boolean) : [];
        setSetting(db, state.account, key, value);
        sendJson(res, { saved: true });
        return;
      }

      if (action === 'trade') {
        const state = await requireAccount();
        if (!state) { sendJson(res, { error: 'forbidden' }, 403); return; }
        const body = await readBody(req);
        const code = String(body.code || '').trim();
        if (!/^\d{6}$/.test(code)) { sendJson(res, { error: 'invalid code' }, 400); return; }
        // New semantics: amount-only trade; shares are confirmed automatically
        // once the T+1 (QDII T+2) NAV lands. Legacy `delta` (shares) is still
        // honored for older clients.
        if (body.amount !== undefined && body.amount !== '') {
          const side = body.mode === 'reduce' || body.side === 'sell' ? 'sell' : 'buy';
          const amount = Number(body.amount);
          if (!isFinite(amount) || amount <= 0) { sendJson(res, { error: 'invalid amount' }, 400); return; }
          await syncNavs(db, [code]);
          const result = recordTrade(db, state.account, { code, name: String(body.name || '').slice(0, 80), side, amount });
          const settled = settleTrades(db, state.account);
          sendJson(res, { result, settled, items: listPortfolio(db, state.account) });
          return;
        }
        const delta = Number(body.delta);
        if (!isFinite(delta) || delta === 0) { sendJson(res, { error: 'invalid delta' }, 400); return; }
        const result = adjustShares(db, state.account, code, delta);
        if (!result) { sendJson(res, { error: 'not found' }, 404); return; }
        sendJson(res, { result, items: listPortfolio(db, state.account) });
        return;
      }

      if (action === 'list') {
        const state = await requireAccount();
        if (!state) { sendJson(res, { error: 'forbidden' }, 403); return; }
        seedDemoHoldings(db, state.account); // first-visit demo data for this account
        // Opening 持仓基金: refresh NAV history for held funds, then settle
        // whatever trades/pending amounts now have a confirmation NAV.
        const codes = listHoldings(db, state.account).map(x => x.code);
        await syncNavs(db, codes);
        const settled = settleTrades(db, state.account);
        sendJson(res, { settled, items: listPortfolio(db, state.account) });
        return;
      }

      if (action === 'watch') {
        const state = await requireAccount();
        if (!state) { sendJson(res, { error: 'forbidden' }, 403); return; }
        const body = await readBody(req);
        const code = String(body.code || '').trim();
        if (!/^\d{6}$/.test(code)) { sendJson(res, { error: 'invalid code' }, 400); return; }
        const result = setWatch(db, state.account, code, body.watch !== false);
        if (!result) { sendJson(res, { error: 'not found' }, 404); return; }
        sendJson(res, { result, items: listPortfolio(db, state.account) });
        return;
      }

      // --- custom holdings groups (private) ---
      if (action === 'grouplist') {
        const state = await requireAccount();
        if (!state) { sendJson(res, { error: 'forbidden' }, 403); return; }
        sendJson(res, { groups: listGroups(db, state.account) });
        return;
      }

      if (action === 'groupmovebatch') {
        const state = await requireAccount();
        if (!state) { sendJson(res, { error: 'forbidden' }, 403); return; }
        const body = await readBody(req);
        const clean = s => String(s || '').trim().slice(0, 30);
        const name = body.name == null || body.name === '' ? null : clean(body.name);
        const codes = Array.isArray(body.codes)
          ? body.codes.map(c => String(c).trim()).filter(c => /^\d{6}$/.test(c)).slice(0, 200)
          : [];
        if (codes.length === 0) { sendJson(res, { error: 'invalid codes' }, 400); return; }
        let moved = 0;
        for (const code of codes) {
          if (setHoldingGroup(db, state.account, code, name)) moved += 1;
        }
        sendJson(res, { moved, items: listPortfolio(db, state.account) });
        return;
      }

      if (action === 'groupadd' || action === 'grouprename' || action === 'groupdelete' || action === 'groupmove') {
        const state = await requireAccount();
        if (!state) { sendJson(res, { error: 'forbidden' }, 403); return; }
        const body = await readBody(req);
        const clean = s => String(s || '').trim().slice(0, 30);
        if (action === 'groupadd') {
          const name = clean(body.name);
          if (!name) { sendJson(res, { error: 'invalid name' }, 400); return; }
          const groups = listGroups(db, state.account);
          if (groups.some(g => g.name === name)) { sendJson(res, { error: 'duplicate' }, 400); return; }
          const ok = addGroup(db, state.account, name, groups.length);
          if (!ok) { sendJson(res, { error: 'duplicate' }, 400); return; }
          sendJson(res, { groups: listGroups(db, state.account) });
          return;
        }
        if (action === 'grouprename') {
          const oldName = clean(body.oldName);
          const newName = clean(body.newName);
          if (!oldName || !newName) { sendJson(res, { error: 'invalid name' }, 400); return; }
          const groups = listGroups(db, state.account);
          if (newName !== oldName && groups.some(g => g.name === newName)) { sendJson(res, { error: 'duplicate' }, 400); return; }
          renameGroup(db, state.account, oldName, newName);
          sendJson(res, { groups: listGroups(db, state.account), items: listPortfolio(db, state.account) });
          return;
        }
        if (action === 'groupdelete') {
          const name = clean(body.name);
          if (!name) { sendJson(res, { error: 'invalid name' }, 400); return; }
          deleteGroup(db, state.account, name);
          sendJson(res, { groups: listGroups(db, state.account), items: listPortfolio(db, state.account) });
          return;
        }
        // groupmove
        const code = clean(body.code);
        if (!/^\d{6}$/.test(code)) { sendJson(res, { error: 'invalid code' }, 400); return; }
        const name = body.name == null || body.name === '' ? null : clean(body.name);
        const result = setHoldingGroup(db, state.account, code, name);
        if (!result) { sendJson(res, { error: 'not found' }, 404); return; }
        sendJson(res, { result, items: listPortfolio(db, state.account) });
        return;
      }

      if (action === 'save' || action === 'delete') {
        const state = await requireAccount();
        if (!state) { sendJson(res, { error: 'forbidden' }, 403); return; }
        const body = await readBody(req);
        const code = String(body.code || '').trim();
        if (!/^\d{6}$/.test(code)) { sendJson(res, { error: 'invalid code' }, 400); return; }
        if (action === 'delete') {
          deleteHolding(db, state.account, code);
        } else {
          const shares = body.shares == null || body.shares === '' ? null : Number(body.shares);
          const cost = body.cost == null || body.cost === '' ? null : Number(body.cost);
          const name = String(body.name || '').slice(0, 80);
          // Omitted `watch` keeps the current flag, so editing a position never
          // silently drops it from (or adds it to) the watchlist.
          const watch = body.watch === undefined || body.watch === null ? undefined : !!body.watch;
          // Amount entered while the NAV was unknown; '' or null clears it.
          const rawPending = body.pendingAmount;
          const pendingAmount = rawPending === undefined
            ? undefined
            : (rawPending === null || rawPending === '' ? null : Number(rawPending));
          if (pendingAmount !== undefined && pendingAmount !== null && !isFinite(pendingAmount)) {
            sendJson(res, { error: 'invalid amount' }, 400);
            return;
          }
          // groupName omitted keeps the current group; '' or null = ungrouped.
          const groupName = body.groupName === undefined ? undefined : String(body.groupName || '').trim().slice(0, 30) || null;
          upsertHolding(db, state.account, { code, name, shares, cost, watch, pendingAmount, groupName });
        }
        sendJson(res, { items: listPortfolio(db, state.account) });
        return;
      }

      sendJson(res, { error: 'unknown action' });
    });
  } catch (error) {
    console.error('[fund-tracker] failed to register routes', error);
  }

  return () => {
    for (const dispose of disposes) {
      if (typeof dispose === 'function') dispose();
    }
  };
}

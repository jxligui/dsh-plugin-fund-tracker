/** SQLite persistence: holdings, fund/index library, per-account settings. */

import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { FUND_LIST_URL, INDEX_LIBRARY, LIB_REFRESH_MS, ETF_LIBRARY } from './constants.js';

function dbPath() {
  // Fixed home-relative location: the Harness host process may or may not
  // export DSH_PROFILE_DIR to plugins, and two candidate paths previously
  // created two divergent databases. One canonical path only.
  return join(homedir(), '.dsh', 'fund-tracker', 'fund-tracker.db');
}

export function openDb() {
  const file = dbPath();
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // The Harness host and background syncs share this file; WAL + a busy
  // timeout turn "database is locked" into a short wait instead of an error.
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
  } catch {}
  db.exec(`CREATE TABLE IF NOT EXISTS holdings (
    account TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT,
    shares REAL,
    cost REAL,
    watch INTEGER NOT NULL DEFAULT 0,
    pending_amount REAL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account, code)
  )`);
  // Older databases have no `watch` / `pending_amount` column: a fund used to be
  // "watched" exactly when it carried no shares/cost. Backfill that to keep
  // existing watchlists intact.
  const holdingCols = db.prepare('PRAGMA table_info(holdings)').all().map(c => c.name);
  if (!holdingCols.includes('watch')) {
    db.exec('ALTER TABLE holdings ADD COLUMN watch INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE holdings SET watch = 1 WHERE shares IS NULL AND cost IS NULL');
  }
  if (!holdingCols.includes('pending_amount')) {
    db.exec('ALTER TABLE holdings ADD COLUMN pending_amount REAL');
  }
  // Custom groups for holdings: NULL group_name means "未分组" (ungrouped).
  if (!holdingCols.includes('group_name')) {
    db.exec('ALTER TABLE holdings ADD COLUMN group_name TEXT');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS fund_groups (
    account TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account, name)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS fund_base (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pinyin TEXT,
    fullpy TEXT,
    type TEXT,
    kind TEXT NOT NULL DEFAULT 'fund',
    on_sale INTEGER
  )`);
  const baseCols = db.prepare('PRAGMA table_info(fund_base)').all().map(c => c.name);
  if (!baseCols.includes('on_sale')) {
    db.exec('ALTER TABLE fund_base ADD COLUMN on_sale INTEGER');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS index_base (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pinyin TEXT,
    secid TEXT NOT NULL,
    category TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS user_settings (
    account TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (account, key)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS etf_base (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    secid TEXT NOT NULL,
    theme TEXT
  )`);
  // Daily NAV history per fund, synced from FundMNHisNetList. This is the
  // authoritative local source for holdings-amount math and trade settlement.
  db.exec(`CREATE TABLE IF NOT EXISTS fund_nav (
    code TEXT NOT NULL,
    date TEXT NOT NULL,          -- YYYY-MM-DD (NAV day, Shanghai)
    nav REAL NOT NULL,
    pct REAL,                    -- day change in %
    PRIMARY KEY (code, date)
  )`);
  // Amount-only buy/sell records awaiting share confirmation. `confirm_date`
  // is the earliest NAV day that may settle the trade (T+1, QDII T+2).
  db.exec(`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT NOT NULL,
    code TEXT NOT NULL,
    side TEXT NOT NULL,          -- 'buy' | 'sell'
    amount REAL NOT NULL,
    shares REAL,                 -- confirmed shares (filled at settlement)
    nav REAL,                    -- NAV used at settlement
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed'
    trade_date TEXT NOT NULL,
    confirm_date TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  const etfCount = db.prepare('SELECT COUNT(*) n FROM etf_base').get().n;
  if (etfCount < ETF_LIBRARY.length) {
    const insertEtf = db.prepare('INSERT OR REPLACE INTO etf_base (code, name, secid, theme) VALUES (?, ?, ?, ?)');
    for (const [secid, code, name, theme] of ETF_LIBRARY) {
      insertEtf.run(code, name, secid, theme);
    }
  }
  const indexCount = db.prepare('SELECT COUNT(*) n FROM index_base').get().n;
  if (indexCount < INDEX_LIBRARY.length) {
    const insertIndex = db.prepare('INSERT OR REPLACE INTO index_base (code, name, pinyin, secid, category) VALUES (?, ?, ?, ?, ?)');
    for (const [secid, code, name, pinyin, category] of INDEX_LIBRARY) {
      insertIndex.run(code, name, pinyin, secid, category);
    }
  }
  return db;
}

export function libInfo(db) {
  if (!db) return { count: 0, refreshedAt: null };
  try {
    const count = db.prepare('SELECT COUNT(*) n FROM fund_base').get().n;
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('lib_refreshed_at');
    return { count, refreshedAt: row ? Number(row.value) : null };
  } catch {
    return { count: 0, refreshedAt: null };
  }
}

export async function refreshLibrary(db, force = false) {
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('lib_refreshed_at');
    const last = row ? Number(row.value) : 0;
    if (!force && Date.now() - last < LIB_REFRESH_MS) return libInfo(db);
    const response = await fetch(FUND_LIST_URL, { headers: { referer: 'https://fund.eastmoney.com/' } });
    if (!response.ok) return libInfo(db);
    const text = await response.text();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    const arr = JSON.parse(text.slice(start, end + 1));
    const insert = db.prepare('INSERT OR REPLACE INTO fund_base (code, name, pinyin, fullpy, type, kind) VALUES (?, ?, ?, ?, ?, ?)');
    const insertIndex = db.prepare('INSERT OR REPLACE INTO fund_base (code, name, pinyin, fullpy, type, kind) VALUES (?, ?, ?, NULL, ?, ?)');
    db.exec('BEGIN');
    try {
      db.exec("DELETE FROM fund_base WHERE kind = 'fund'");
      for (const entry of arr) {
        if (!entry || !/^\d{6}$/.test(String(entry[0] || ''))) continue;
        insert.run(String(entry[0]), String(entry[2] || ''), String(entry[1] || '').toUpperCase(), String(entry[4] || '').toUpperCase(), String(entry[3] || ''), 'fund');
      }
      for (const [, code, name, pinyin, category] of INDEX_LIBRARY) {
        insertIndex.run(code, name, pinyin, `指数 · ${category}`, 'index');
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('lib_refreshed_at', String(Date.now()));
    console.log('[fund-tracker] local fund library refreshed');
    return libInfo(db);
  } catch (error) {
    console.error('[fund-tracker] library refresh failed', error);
    return libInfo(db);
  }
}

export function searchLocal(db, query) {
  if (!db) return [];
  const q = query.trim().toUpperCase();
  if (!q) return [];
  try {
    const funds = db.prepare(`SELECT code, name, pinyin, type, kind FROM fund_base
                       WHERE code LIKE ? OR name LIKE ? OR pinyin LIKE ? OR fullpy LIKE ?
                       ORDER BY code LIMIT 15`)
      .all(`${q}%`, `%${q}%`, `${q}%`, `${q}%`);
    const indices = db.prepare(`SELECT code, name, pinyin, category AS type, kind FROM index_base
                       WHERE code LIKE ? OR name LIKE ? OR pinyin LIKE ?
                       ORDER BY code LIMIT 8`)
      .all(`${q}%`, `%${q}%`, `${q}%`).map(r => ({ ...r, kind: 'index' }));
    return [...indices, ...funds];
  } catch {
    return [];
  }
}

export function listHoldings(db, account) {
  return db.prepare('SELECT code, name, shares, cost, watch, pending_amount, group_name FROM holdings WHERE account = ? ORDER BY updated_at DESC').all(account)
    .map(r => ({
      code: r.code,
      name: r.name || '',
      shares: r.shares ?? null,
      cost: r.cost ?? null,
      watch: !!r.watch,
      // Amount entered before the NAV was known; settled into shares on a later fetch.
      pendingAmount: r.pending_amount ?? null,
      groupName: r.group_name ?? null,
    }));
}

/** `watch` / `pendingAmount` / `groupName` are tri-state: undefined keeps the current value. */
export function upsertHolding(db, account, { code, name, shares, cost, watch, pendingAmount, groupName }) {
  const prev = db.prepare('SELECT watch, pending_amount, group_name FROM holdings WHERE account = ? AND code = ?').get(account, code);
  const watchValue = watch == null ? (prev ? (prev.watch ? 1 : 0) : 0) : (watch ? 1 : 0);
  const pendingValue = pendingAmount === undefined
    ? (prev ? prev.pending_amount ?? null : null)
    : (pendingAmount == null ? null : pendingAmount);
  const groupValue = groupName === undefined
    ? (prev ? prev.group_name ?? null : null)
    : (groupName == null || groupName === '' ? null : groupName);
  db.prepare(`INSERT INTO holdings (account, code, name, shares, cost, watch, pending_amount, group_name, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(account, code) DO UPDATE SET
                name = excluded.name,
                shares = excluded.shares,
                cost = excluded.cost,
                watch = excluded.watch,
                pending_amount = excluded.pending_amount,
                group_name = excluded.group_name,
                updated_at = excluded.updated_at`)
    .run(account, code, name, shares, cost, watchValue, pendingValue, groupValue, Date.now());
}

// --- custom holdings groups ------------------------------------------------

export function listGroups(db, account) {
  try {
    return db.prepare('SELECT name, sort_order FROM fund_groups WHERE account = ? ORDER BY sort_order, name').all(account);
  } catch {
    return [];
  }
}

/** Add a group. Returns false if it already exists. */
export function addGroup(db, account, name, sortOrder) {
  try {
    db.prepare('INSERT INTO fund_groups (account, name, sort_order) VALUES (?, ?, ?)').run(account, name, sortOrder);
    return true;
  } catch {
    return false;
  }
}

/** Rename a group and move its funds to the new name. */
export function renameGroup(db, account, oldName, newName) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE fund_groups SET name = ? WHERE account = ? AND name = ?').run(newName, account, oldName);
    db.prepare('UPDATE holdings SET group_name = ? WHERE account = ? AND group_name = ?').run(newName, account, oldName);
    db.exec('COMMIT');
    return true;
  } catch {
    db.exec('ROLLBACK');
    return false;
  }
}

/** Delete a group; funds in it become ungrouped (group_name = NULL). */
export function deleteGroup(db, account, name) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM fund_groups WHERE account = ? AND name = ?').run(account, name);
    db.prepare('UPDATE holdings SET group_name = NULL WHERE account = ? AND group_name = ?').run(account, name);
    db.exec('COMMIT');
    return true;
  } catch {
    db.exec('ROLLBACK');
    return false;
  }
}

/** Move one holding into a group (or ungrouped when name is null/empty). */
export function setHoldingGroup(db, account, code, name) {
  const row = db.prepare('SELECT code FROM holdings WHERE account = ? AND code = ?').get(account, code);
  if (!row) return null;
  const value = name == null || name === '' ? null : name;
  db.prepare('UPDATE holdings SET group_name = ?, updated_at = ? WHERE account = ? AND code = ?')
    .run(value, Date.now(), account, code);
  return { code, groupName: value };
}

/** Add to / remove from the watchlist without touching shares or cost. */
export function setWatch(db, account, code, on) {
  const row = db.prepare('SELECT code FROM holdings WHERE account = ? AND code = ?').get(account, code);
  if (!row) return null;
  db.prepare('UPDATE holdings SET watch = ?, updated_at = ? WHERE account = ? AND code = ?')
    .run(on ? 1 : 0, Date.now(), account, code);
  return { code, watch: !!on };
}

export function deleteHolding(db, account, code) {
  db.prepare('DELETE FROM holdings WHERE account = ? AND code = ?').run(account, code);
}

export function adjustShares(db, account, code, delta) {
  const row = db.prepare('SELECT shares, name, cost FROM holdings WHERE account = ? AND code = ?').get(account, code);
  if (!row) return null;
  const current = row.shares != null ? row.shares : 0;
  const next = Math.max(0, current + delta);
  db.prepare('UPDATE holdings SET shares = ?, updated_at = ? WHERE account = ? AND code = ?')
    .run(next, Date.now(), account, code);
  return { code, name: row.name, shares: next, cost: row.cost };
}

// ---------------------------------------------------------------------------
// NAV history & trade settlement
// ---------------------------------------------------------------------------

/** Shanghai-calendar date string for "now" (host clock is CST anyway). */
export function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDaysStr(dateStr, days) {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

export function upsertNavs(db, code, rows) {
  if (!db || !Array.isArray(rows) || rows.length === 0) return 0;
  const insert = db.prepare('INSERT OR REPLACE INTO fund_nav (code, date, nav, pct) VALUES (?, ?, ?, ?)');
  let n = 0;
  for (const row of rows) {
    if (!row || !row.date || !(row.nav > 0)) continue;
    insert.run(code, row.date, row.nav, row.pct != null && isFinite(row.pct) ? row.pct : null);
    n += 1;
  }
  return n;
}

/** Latest stored NAV row for a code, or null. */
export function latestNav(db, code) {
  try {
    const row = db.prepare('SELECT date, nav, pct FROM fund_nav WHERE code = ? ORDER BY date DESC LIMIT 1').get(code);
    return row || null;
  } catch {
    return null;
  }
}

/** Earliest stored NAV row with date >= `dateStr`, or null. */
function navFrom(db, code, dateStr) {
  try {
    const row = db.prepare('SELECT date, nav FROM fund_nav WHERE code = ? AND date >= ? ORDER BY date ASC LIMIT 1').get(code, dateStr);
    return row || null;
  } catch {
    return null;
  }
}

// --- full-library NAV sync cursor -----------------------------------------
// "All funds" is ~28k codes; the per-fund history API is the only reliable
// source, so the sync walks the whole fund_base in resumable batches driven
// by a persisted code cursor (meta `navall_cursor` / `navall_done_at`).

/** Next batch of fund codes after the cursor, plus the cursor to commit. */
export function nextNavBatch(db, limit) {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'navall_cursor'").get();
    const cursor = row ? String(row.value) : '';
    const codes = db.prepare("SELECT code FROM fund_base WHERE kind = 'fund' AND code > ? ORDER BY code LIMIT ?")
      .all(cursor, limit).map(r => r.code);
    return { codes, next: codes.length > 0 ? codes[codes.length - 1] : '' };
  } catch {
    return { codes: [], next: '' };
  }
}

/** Persist the batch cursor; a finished pass (next='') stamps navall_done_at. */
export function commitNavBatch(db, next) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('navall_cursor', ?)").run(next);
  if (!next) {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('navall_done_at', ?)").run(String(Date.now()));
  }
}

/** Progress stats for the settings page: codes stored / total / last pass. */
export function navSyncStats(db) {
  if (!db) return { funds: 0, total: 0, doneAt: null };
  try {
    const funds = db.prepare('SELECT COUNT(DISTINCT code) n FROM fund_nav').get().n;
    const total = db.prepare("SELECT COUNT(*) n FROM fund_base WHERE kind = 'fund'").get().n;
    const row = db.prepare("SELECT value FROM meta WHERE key = 'navall_done_at'").get();
    return { funds, total, doneAt: row ? Number(row.value) : null };
  } catch {
    return { funds: 0, total: 0, doneAt: null };
  }
}

/**
 * Refresh the on_sale flag for the whole fund library from the jdzf list
 * (onlySale=1) and bulk-store the latest NAV day into fund_nav. One pass is
 * ~100 requests of 200 funds; throttled to once every 20 hours.
 */
export async function syncOnSale(db, fetchPage, force = false) {
  if (!db || typeof fetchPage !== 'function') return { onSale: 0, navRows: 0 };
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'onsale_synced_at'").get();
    const last = row ? Number(row.value) : 0;
    if (!force && Date.now() - last < 20 * 3600 * 1000) {
      return { onSale: db.prepare('SELECT COUNT(*) n FROM fund_base WHERE on_sale = 1').get().n, navRows: 0 };
    }
    let onSale = 0;
    let navRows = 0;
    let navDate = null;
    let page = 1;
    // Reset first, flag as pages arrive. A crashed pass leaves partial flags,
    // but the completion stamp below is only written at the end, so the next
    // tick retries the whole pass.
    db.exec("UPDATE fund_base SET on_sale = 0 WHERE kind = 'fund'");
    for (;;) {
      const data = await fetchPage(page, 200, 1);
      if (!data || data.rows.length === 0) break;
      navDate = navDate || data.date;
      db.exec('BEGIN');
      try {
        const flag = db.prepare('UPDATE fund_base SET on_sale = 1 WHERE code = ?');
        for (const r of data.rows) flag.run(r.code);
        if (navDate) {
          const insertNav = db.prepare('INSERT OR REPLACE INTO fund_nav (code, date, nav, pct) VALUES (?, ?, ?, ?)');
          for (const r of data.rows) {
            if (r.nav != null) { insertNav.run(r.code, navDate, r.nav, r.pct); navRows += 1; }
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      onSale += data.rows.length;
      if (page >= data.pages || page > 200) break;
      page += 1;
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('onsale_synced_at', ?)").run(String(Date.now()));
    console.log(`[fund-tracker] on-sale sync: ${onSale} funds flagged, ${navRows} nav rows (${navDate || 'no date'})`);
    return { onSale, navRows };
  } catch (error) {
    console.error('[fund-tracker] on-sale sync failed', error);
    return { onSale: 0, navRows: 0, error: String((error && error.message) || error) };
  }
}

/** QDII funds confirm at T+2; everything else at T+1. */
function confirmOffsetDays(db, code) {
  try {
    const row = db.prepare('SELECT name, type FROM fund_base WHERE code = ?').get(code);
    const text = row ? `${row.name || ''}${row.type || ''}` : '';
    return /QDII/i.test(text) ? 2 : 1;
  } catch {
    return 1;
  }
}

/**
 * Record an amount-only buy/sell. Shares stay "pending" until the NAV of the
 * confirmation day is known; the amount itself is already part of the
 * displayed holdings value (per user requirement).
 */
export function recordTrade(db, account, { code, name, side, amount }) {
  const row = db.prepare('SELECT name FROM holdings WHERE account = ? AND code = ?').get(account, code);
  if (!row) {
    db.prepare('INSERT INTO holdings (account, code, name, shares, cost, watch, updated_at) VALUES (?, ?, ?, NULL, NULL, 0, ?)')
      .run(account, code, name || '', Date.now());
  } else if (name && !row.name) {
    db.prepare('UPDATE holdings SET name = ?, updated_at = ? WHERE account = ? AND code = ?').run(name, Date.now(), account, code);
  }
  const today = todayStr();
  const confirmDate = addDaysStr(today, confirmOffsetDays(db, code));
  const info = db.prepare(`INSERT INTO trades (account, code, side, amount, status, trade_date, confirm_date, created_at)
                           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`)
    .run(account, code, side, amount, today, confirmDate, Date.now());
  return { id: Number(info.lastInsertRowid), code, side, amount, confirmDate };
}

/**
 * Settle everything that has a usable NAV now:
 *  1. legacy `holdings.pending_amount` rows -> converted to shares additively;
 *  2. pending trades whose confirm_date NAV (or any later NAV) is stored
 *     -> shares computed as amount / NAV, applied to the holding, confirmed.
 * Buys move the average cost; sells keep it. Returns the number settled.
 */
export function settleTrades(db, account) {
  let settled = 0;
  // 1. pending amounts recorded on the holding itself
  const pendings = db.prepare('SELECT code, shares, cost, pending_amount FROM holdings WHERE account = ? AND pending_amount > 0').all(account);
  for (const p of pendings) {
    const navRow = latestNav(db, p.code);
    if (!navRow) continue;
    const add = Number((p.pending_amount / navRow.nav).toFixed(2));
    const oldShares = p.shares != null ? p.shares : 0;
    const newShares = Number((oldShares + add).toFixed(2));
    let cost = p.cost;
    if (p.cost != null && oldShares > 0) cost = (oldShares * p.cost + p.pending_amount) / newShares;
    else if (p.cost == null) cost = navRow.nav;
    db.prepare('UPDATE holdings SET shares = ?, cost = ?, pending_amount = NULL, updated_at = ? WHERE account = ? AND code = ?')
      .run(newShares, cost, Date.now(), account, p.code);
    settled += 1;
  }
  // 2. pending amount-only trades
  const trades = db.prepare(`SELECT id, code, side, amount, confirm_date FROM trades
                             WHERE account = ? AND status = 'pending' ORDER BY id`).all(account);
  for (const tr of trades) {
    const navRow = navFrom(db, tr.code, tr.confirm_date);
    if (!navRow) continue; // confirm-day NAV not published yet
    const shares = Number((tr.amount / navRow.nav).toFixed(2));
    const hold = db.prepare('SELECT shares, cost FROM holdings WHERE account = ? AND code = ?').get(account, tr.code);
    const oldShares = hold && hold.shares != null ? hold.shares : 0;
    let newShares = oldShares;
    let cost = hold ? hold.cost : null;
    if (tr.side === 'buy') {
      newShares = Number((oldShares + shares).toFixed(2));
      if (cost != null && oldShares > 0) cost = (oldShares * cost + tr.amount) / newShares;
      else if (cost == null) cost = navRow.nav;
    } else {
      newShares = Math.max(0, Number((oldShares - shares).toFixed(2)));
    }
    if (hold) {
      db.prepare('UPDATE holdings SET shares = ?, cost = ?, updated_at = ? WHERE account = ? AND code = ?')
        .run(newShares, cost, Date.now(), account, tr.code);
    }
    db.prepare(`UPDATE trades SET status = 'confirmed', shares = ?, nav = ? WHERE id = ?`)
      .run(shares, navRow.nav, tr.id);
    settled += 1;
  }
  return settled;
}

/**
 * Holdings plus computed asset values: nav from the local fund_nav table
 * (latest = today's published NAV, else the previous day's). The displayed
 * amount = shares * nav + pending buy amounts not yet confirmed into shares.
 */
export function listPortfolio(db, account) {
  const items = listHoldings(db, account);
  return items.map(item => {
    const navRow = latestNav(db, item.code);
    const nav = navRow ? navRow.nav : null;
    // Second-latest NAV day: the "昨日净值" fallback when today's is unpublished.
    const prevRow = navRow
      ? db.prepare('SELECT nav FROM fund_nav WHERE code = ? AND date < ? ORDER BY date DESC LIMIT 1').get(item.code, navRow.date)
      : null;
    const base = item.shares != null && nav != null ? Number((item.shares * nav).toFixed(2)) : null;
    const pend = db.prepare(`SELECT side, amount FROM trades WHERE account = ? AND code = ? AND status = 'pending'`).all(account, item.code);
    const pendingBuy = pend.filter(x => x.side === 'buy').reduce((s, x) => s + x.amount, 0);
    const pendingSell = pend.filter(x => x.side === 'sell').reduce((s, x) => s + x.amount, 0);
    return {
      ...item,
      nav,
      navDate: navRow ? navRow.date : null,
      prevNav: prevRow ? prevRow.nav : null,
      // Pending buys still count as holdings value until shares are confirmed.
      amount: base != null || pendingBuy > 0 ? Number(((base || 0) + pendingBuy).toFixed(2)) : null,
      pendingBuy: pendingBuy > 0 ? Number(pendingBuy.toFixed(2)) : 0,
      pendingSell: pendingSell > 0 ? Number(pendingSell.toFixed(2)) : 0,
    };
  });
}

export function getSetting(db, account, key) {
  try {
    const row = db.prepare('SELECT value FROM user_settings WHERE account = ? AND key = ?').get(account, key);
    if (!row) return null;
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export function setSetting(db, account, key, value) {
  db.prepare('INSERT OR REPLACE INTO user_settings (account, key, value) VALUES (?, ?, ?)')
    .run(account, key, JSON.stringify(value));
}

export function fundTypes(db, { status = 'onsale' } = {}) {
  if (!db) return [];
  try {
    const onSale = status !== 'all' ? 'AND on_sale = 1' : '';
    return db.prepare(`SELECT type, COUNT(*) n FROM fund_base WHERE kind = 'fund' AND type != '' ${onSale} GROUP BY type ORDER BY n DESC`).all();
  } catch {
    return [];
  }
}

export function fundPage(db, { page = 1, size = 20, query = '', type = '', status = 'onsale' } = {}) {
  if (!db) return { items: [], total: 0 };
  const offset = (Math.max(1, page) - 1) * size;
  const q = query.trim().toUpperCase();
  try {
    const conds = ["kind = 'fund'"];
    if (status !== 'all') conds.push('on_sale = 1');
    const args = [];
    if (q) {
      conds.push('(code LIKE ? OR name LIKE ? OR pinyin LIKE ? OR fullpy LIKE ?)');
      args.push(`${q}%`, `%${q}%`, `${q}%`, `${q}%`);
    }
    if (type && type !== 'all') {
      conds.push('type LIKE ?');
      args.push(`${type}%`);
    }
    const where = conds.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM fund_base WHERE ${where}`).get(...args).n;
    const items = db.prepare(`SELECT code, name, type FROM fund_base WHERE ${where} ORDER BY code LIMIT ? OFFSET ?`)
      .all(...args, size, offset);
    return { items, total };
  } catch {
    return { items: [], total: 0 };
  }
}

// Demo holdings seeded once on first activation so the panel has data to
// develop and test against. Codes are real funds from the local library.
// Demo holdings seeded once on first list per account. Each position carries
// a benchmark NAV (`refNav`, a real published NAV snapshot) and a cost factor,
// so the first-run experience shows believable gains/losses (mix of + and -)
// without needing any network call. Cost = refNav * costFactor. Once live NAV
// syncs, the real NAV replaces refNav for market value (cost stays fixed).
// Last 4 = watchlist-only entries (shares null).
const DEMO_HOLDINGS = [
  { code: '000001', name: '华夏成长混合', shares: 1200, cost: 0.8640 },  // refNav .96 × .90 → +11%
  { code: '110022', name: '易方达消费行业股票', shares: 800, cost: 3.2510 }, // 3.01 × 1.08 → -7%
  { code: '161725', name: '招商中证白酒指数(LOF)A', shares: 2000, cost: 0.6370 }, // .5791 × 1.10 → -9%
  { code: '519674', name: '银河创新成长混合A', shares: 300, cost: 8.0950 },  // 9.5232 × .85 → +18%
  { code: '270002', name: '广发稳健增长混合A', shares: 1500, cost: 1.4010 }, // 1.4594 × .96 → +4%
  { code: '005827', name: '易方达蓝筹精选混合', shares: 1000, cost: 1.4800 }, // 1.3578 × 1.09 → -8%
  { code: '000021', name: '华夏成长混合(后端)', shares: null, cost: null },
  { code: '012414', name: '招商中证白酒指数(LOF)C', shares: null, cost: null },
  { code: '512480', name: '半导体ETF', shares: null, cost: null },
  { code: '159928', name: '消费ETF', shares: null, cost: null },
];

export function seedDemoHoldings(db, account) {
  if (!db || !account) return;
  try {
    const key = `demo_seeded_${account}`;
    const seeded = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    if (seeded) return;
    const insert = db.prepare('INSERT INTO holdings (account, code, name, shares, cost, watch, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const item of DEMO_HOLDINGS) {
      insert.run(account, item.code, item.name, item.shares, item.cost, item.shares == null && item.cost == null ? 1 : 0, Date.now());
    }
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(Date.now()));
    console.log(`[fund-tracker] demo holdings seeded for ${account}`);
  } catch (error) {
    console.error('[fund-tracker] demo seed failed', error);
  }
}

export function syncEtfLibrary(db) {
  if (!db) return { count: 0 };
  try {
    const insertEtf = db.prepare('INSERT OR REPLACE INTO etf_base (code, name, secid, theme) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM etf_base');
      for (const [secid, code, name, theme] of ETF_LIBRARY) {
        insertEtf.run(code, name, secid, theme);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { count: db.prepare('SELECT COUNT(*) n FROM etf_base').get().n };
  } catch (error) {
    console.error('[fund-tracker] etf sync failed', error);
    return { count: 0, error: String((error && error.message) || error) };
  }
}

export function etfInfo(db) {
  if (!db) return { count: 0, themes: 0 };
  try {
    const count = db.prepare('SELECT COUNT(*) n FROM etf_base').get().n;
    const themes = db.prepare('SELECT COUNT(DISTINCT theme) n FROM etf_base').get().n;
    return { count, themes };
  } catch {
    return { count: 0, themes: 0 };
  }
}

export function indexPage(db, { page = 1, size = 10 } = {}) {
  if (!db) return { items: [], total: 0 };
  const offset = (Math.max(1, page) - 1) * size;
  try {
    const total = db.prepare('SELECT COUNT(*) n FROM index_base').get().n;
    const items = db.prepare('SELECT code, name, category FROM index_base ORDER BY category, code LIMIT ? OFFSET ?')
      .all(size, offset);
    return { items, total };
  } catch {
    return { items: [], total: 0 };
  }
}

export function indexLibrary(db) {
  if (!db) return INDEX_LIBRARY.map(([, code, name, pinyin, category]) => ({ code, name, pinyin, category }));
  return db.prepare('SELECT code, name, pinyin, category FROM index_base ORDER BY category, code').all();
}

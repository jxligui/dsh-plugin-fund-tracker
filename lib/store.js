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
  db.exec(`CREATE TABLE IF NOT EXISTS fund_base (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pinyin TEXT,
    fullpy TEXT,
    type TEXT,
    kind TEXT NOT NULL DEFAULT 'fund'
  )`);
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
  return db.prepare('SELECT code, name, shares, cost, watch, pending_amount FROM holdings WHERE account = ? ORDER BY updated_at DESC').all(account)
    .map(r => ({
      code: r.code,
      name: r.name || '',
      shares: r.shares ?? null,
      cost: r.cost ?? null,
      watch: !!r.watch,
      // Amount entered before the NAV was known; settled into shares on a later fetch.
      pendingAmount: r.pending_amount ?? null,
    }));
}

/** `watch` / `pendingAmount` are tri-state: undefined keeps the current value. */
export function upsertHolding(db, account, { code, name, shares, cost, watch, pendingAmount }) {
  const prev = db.prepare('SELECT watch, pending_amount FROM holdings WHERE account = ? AND code = ?').get(account, code);
  const watchValue = watch == null ? (prev ? (prev.watch ? 1 : 0) : 0) : (watch ? 1 : 0);
  const pendingValue = pendingAmount === undefined
    ? (prev ? prev.pending_amount ?? null : null)
    : (pendingAmount == null ? null : pendingAmount);
  db.prepare(`INSERT INTO holdings (account, code, name, shares, cost, watch, pending_amount, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(account, code) DO UPDATE SET
                name = excluded.name,
                shares = excluded.shares,
                cost = excluded.cost,
                watch = excluded.watch,
                pending_amount = excluded.pending_amount,
                updated_at = excluded.updated_at`)
    .run(account, code, name, shares, cost, watchValue, pendingValue, Date.now());
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

export function fundTypes(db) {
  if (!db) return [];
  try {
    return db.prepare("SELECT type, COUNT(*) n FROM fund_base WHERE kind = 'fund' AND type != '' GROUP BY type ORDER BY n DESC").all();
  } catch {
    return [];
  }
}

export function fundPage(db, { page = 1, size = 20, query = '', type = '' } = {}) {
  if (!db) return { items: [], total: 0 };
  const offset = (Math.max(1, page) - 1) * size;
  const q = query.trim().toUpperCase();
  try {
    const conds = ["kind = 'fund'"];
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
const DEMO_HOLDINGS = [
  { code: '000001', name: '华夏成长混合', shares: 1234.56, cost: 1.8523 },
  { code: '110022', name: '易方达消费行业', shares: 500, cost: 4.21 },
  { code: '161725', name: '招商中证白酒指数(LOF)A', shares: 800, cost: 1.05 },
  { code: '519674', name: '银河创新成长混合A', shares: 600, cost: 2.48 },
  { code: '270002', name: '广发稳健增长混合A', shares: 900, cost: 1.62 },
  { code: '005827', name: '易方达蓝筹精选混合', shares: 700, cost: 1.93 },
  { code: '000021', name: '华夏成长混合(后端)', shares: null, cost: null },
  { code: '512480', name: '半导体龙头ETF', shares: null, cost: null },
  { code: '159928', name: '消费ETF', shares: null, cost: null },
  { code: '515790', name: '光伏ETF', shares: null, cost: null },
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

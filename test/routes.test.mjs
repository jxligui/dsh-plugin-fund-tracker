/** Integration tests: routes.js against the real store + a mock harness. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCtx, makeReq, callRoute } from './harness-mock.mjs';
import { registerRoutes } from '../lib/routes.js';
import { openDb, getSetting, setSetting } from '../lib/store.js';

process.env.DSH_PROFILE_DIR = process.env.FT_TEST_PROFILE || ':memory:';

const { ctx, routes } = createMockCtx();
const db = openDb();
const accountState = async () => ({ loggedIn: true, account: 'test' });
const requireAccount = async () => (db ? accountState() : null);
registerRoutes(ctx, { getDb: () => db, accountState, requireAccount });

const api = async (qs, body) => callRoute(routes, '/fund-tracker/api', makeReq(`/fund-tracker/api?${qs}`, { method: body ? 'POST' : 'GET', body }));

test('both routes registered with exact kind', () => {
  assert.ok(routes.has('/fund-tracker/quotes'));
  assert.ok(routes.has('/fund-tracker/api'));
});

test('debug: db visible with data', async () => {
  const res = await api('action=debug');
  const data = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(data.hasDb, true);
  assert.ok(data.fundCount > 10000, `fundCount=${data.fundCount}`);
  assert.ok(data.indexCount >= 29, `indexCount=${data.indexCount}`);
  assert.equal(data.dbError, null);
});

test('session returns logged-in local account', async () => {
  const res = await api('action=session');
  const data = res.json();
  assert.equal(data.loggedIn, true);
  assert.ok(data.account);
});

test('indexlist pagination returns all 29 indices', async () => {
  const res = await api('action=indexlist&page=1&size=12');
  const data = res.json();
  assert.equal(data.total, 29);
  assert.equal(data.items.length, 12);
  const p3 = await (await api('action=indexlist&page=3&size=12')).json();
  assert.equal(p3.items.length, 5);
});

test('fundlist pagination over full library', async () => {
  const res = await api('action=fundlist&page=1&size=5');
  const data = res.json();
  assert.ok(data.total > 20000, `total=${data.total}`);
  assert.equal(data.items.length, 5);
  assert.ok(/^\d{6}$/.test(data.items[0].code));
});

test('fundlist pinyin query filters', async () => {
  // status=all: the fixture fund may be suspended from purchase, which the
  // default on-sale filter would otherwise hide.
  const res = await api('action=fundlist&page=1&size=10&query=HXCZHH&status=all');
  const data = res.json();
  assert.ok(data.total >= 1);
  assert.ok(data.items.every(x => x.name.includes('华夏成长') || x.code === '000001'));
});

test('fundlist defaults to on-sale funds', async () => {
  const onsale = await api('action=fundlist&page=1&size=10');
  assert.ok(onsale.json().total > 1000);
  const all = await api('action=fundlist&page=1&size=10&status=all');
  assert.ok(all.json().total > onsale.json().total);
});

test('save / list / delete holding round-trip', async () => {
  const saved = await (await api('action=save', { code: '000001', name: '测试基金', shares: '100', cost: '1.5' })).json();
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].shares, 100);
  const afterDelete = await (await api('action=delete', { code: '000001' })).json();
  assert.equal(afterDelete.items.length, 0);
});

test('watch flag is independent of position shares', async () => {
  await api('action=save', { code: '110022', name: '测试持仓', shares: '500', cost: '2' });
  // 加入我的自选 keeps the position but marks it watched.
  const watched = await (await api('action=watch', { code: '110022', watch: true })).json();
  assert.equal(watched.result.watch, true);
  const row = watched.items.find(x => x.code === '110022');
  assert.equal(row.watch, true);
  assert.equal(row.shares, 500);
  // Editing shares/cost without a `watch` field must not clear the flag.
  const edited = await (await api('action=save', { code: '110022', shares: '600', cost: '2.1' })).json();
  const editedRow = edited.items.find(x => x.code === '110022');
  assert.equal(editedRow.watch, true);
  assert.equal(editedRow.shares, 600);
  // 加入持仓 on a watch-only fund keeps it in the watchlist too.
  await api('action=save', { code: '161725', name: '测试自选', shares: '', cost: '', watch: true });
  const promoted = await (await api('action=save', { code: '161725', name: '测试自选', shares: '800', cost: '1.05' })).json();
  const promotedRow = promoted.items.find(x => x.code === '161725');
  assert.equal(promotedRow.watch, true);
  assert.equal(promotedRow.shares, 800);
  // Unwatching keeps the position row.
  const unwatched = await (await api('action=watch', { code: '161725', watch: false })).json();
  assert.equal(unwatched.items.find(x => x.code === '161725').watch, false);
  assert.equal(unwatched.items.find(x => x.code === '161725').shares, 800);
  await api('action=delete', { code: '110022' });
  await api('action=delete', { code: '161725' });
});

test('amount saved before NAV stays pending until settled', async () => {
  const saved = await (await api('action=save', { code: '000021', name: '待确认基金', shares: '', cost: '', pendingAmount: '1000' })).json();
  const row = saved.items.find(x => x.code === '000021');
  assert.equal(row.pendingAmount, 1000);
  assert.equal(row.shares, null);
  // Once a quote exists the client writes the converted shares and clears the flag.
  const settled = await (await api('action=save', { code: '000021', shares: '500', cost: '2', pendingAmount: '' })).json();
  const done = settled.items.find(x => x.code === '000021');
  assert.equal(done.shares, 500);
  assert.equal(done.pendingAmount, null);
  // An omitted `pendingAmount` must not wipe a pending record on unrelated saves.
  await api('action=save', { code: '000021', shares: '', cost: '', pendingAmount: '2000' });
  const kept = await (await api('action=save', { code: '000021', name: '待确认基金' })).json();
  assert.equal(kept.items.find(x => x.code === '000021').pendingAmount, 2000);
  await api('action=delete', { code: '000021' });
});

test('savesettings + indices reflect selection', async () => {
  const save = await api('action=savesettings', { key: 'indices', value: ['000001', 'HSI'] });
  assert.equal(save.statusCode, 200);
  assert.equal(save.json().saved, true);
  const cfg = await (await api('action=indices')).json();
  assert.deepEqual(cfg.selected, ['000001', 'HSI']);
  assert.ok(cfg.library.length >= 29);
  // restore default
  await api('action=savesettings', { key: 'indices', value: ['000001', '399001', '399006', '000300', '000688', '000905', '000016', 'HSI'] });
});

test('invalid code rejected with 400', async () => {
  const res = await api('action=save', { code: 'abc', name: '' });
  assert.equal(res.statusCode, 400);
});

test('quotes fund estimates shape (network optional)', async () => {
  const res = await callRoute(routes, '/fund-tracker/quotes', makeReq('/fund-tracker/quotes?codes=000001'));
  const data = res.json();
  assert.ok(Array.isArray(data.quotes));
}, { skip: process.env.FT_SKIP_NETWORK === '1' });

test('quotes market indices shape (network optional)', async () => {
  const res = await callRoute(routes, '/fund-tracker/quotes', makeReq('/fund-tracker/quotes?market=1'));
  const data = res.json();
  assert.ok(Array.isArray(data.indices));
}, { skip: process.env.FT_SKIP_NETWORK === '1' });

test('amount-only trade settles into shares once the confirm-day NAV exists', async () => {
  const { upsertNavs, recordTrade, settleTrades, listPortfolio, latestNav } = await import('../lib/store.js');
  const code = '000031';
  try {
    // Seeded NAV history: confirm date is T+1, so 2020-01-02 settles a
    // trade made on 2020-01-01.
    upsertNavs(db, code, [
      { date: '2020-01-02', nav: 2, pct: 1 },
      { date: '2020-01-03', nav: 2.1, pct: 5 },
    ]);
    assert.equal(latestNav(db, code).nav, 2.1);

    const trade = recordTrade(db, 'test', { code, name: '结算测试', side: 'buy', amount: 1000 });
    assert.equal(trade.side, 'buy');
    // Before settlement the amount shows up as pending value, shares unknown.
    let items = listPortfolio(db, 'test').filter(x => x.code === code);
    assert.equal(items[0].shares, null);
    assert.equal(items[0].pendingBuy, 1000);
    assert.equal(items[0].amount, 1000);

    // The confirm date lies in the past relative to stored NAVs, but the trade
    // was recorded "today": simulate by rewinding confirm_date to the fixture.
    db.prepare('UPDATE trades SET confirm_date = ? WHERE id = ?').run('2020-01-02', trade.id);
    const settled = settleTrades(db, 'test');
    assert.ok(settled >= 1);
    items = listPortfolio(db, 'test').filter(x => x.code === code);
    // 1000 / 2 = 500 shares at the 2020-01-02 NAV, cost = that NAV.
    assert.equal(items[0].shares, 500);
    assert.equal(items[0].cost, 2);
    assert.equal(items[0].pendingBuy, 0);
    // Latest NAV (2.1) values the position: 500 * 2.1 = 1050.
    assert.equal(items[0].amount, 1050);

    // A sell reduces shares but keeps the average cost.
    const sell = recordTrade(db, 'test', { code, side: 'sell', amount: 420 });
    db.prepare('UPDATE trades SET confirm_date = ? WHERE id = ?').run('2020-01-03', sell.id);
    settleTrades(db, 'test');
    items = listPortfolio(db, 'test').filter(x => x.code === code);
    // 420 / 2.1 = 200 shares sold -> 300 left.
    assert.equal(items[0].shares, 300);
    assert.equal(items[0].cost, 2);
  } finally {
    db.prepare('DELETE FROM holdings WHERE account = ? AND code = ?').run('test', code);
    db.prepare('DELETE FROM trades WHERE account = ? AND code = ?').run('test', code);
    db.prepare('DELETE FROM fund_nav WHERE code = ?').run(code);
  }
});

test('custom groups: add / move / rename / delete', async () => {
  const g1 = '__test_group_a__';
  const g2 = '__test_group_b__';
  try {
    // start clean
    for (const g of [g1, g2]) await api('action=groupdelete', { name: g });

    const added = await (await api('action=groupadd', { name: g1 })).json();
    assert.ok(added.groups.some(x => x.name === g1));
    // duplicate rejected
    const dup = await api('action=groupadd', { name: g1 });
    assert.equal(dup.statusCode, 400);

    await api('action=save', { code: '000001', name: '分组测试', shares: '100', cost: '1' });
    const moved = await (await api('action=groupmove', { code: '000001', name: g1 })).json();
    assert.equal(moved.items.find(x => x.code === '000001').groupName, g1);

    const renamed = await (await api('action=grouprename', { oldName: g1, newName: g2 })).json();
    assert.ok(renamed.groups.some(x => x.name === g2));
    assert.ok(!renamed.groups.some(x => x.name === g1));
    assert.equal(renamed.items.find(x => x.code === '000001').groupName, g2);

    // deleting the group ungroups the fund but keeps the position
    const deleted = await (await api('action=groupdelete', { name: g2 })).json();
    assert.equal(deleted.items.find(x => x.code === '000001').groupName, null);
    assert.equal(deleted.items.find(x => x.code === '000001').shares, 100);
  } finally {
    for (const g of [g1, g2]) await api('action=groupdelete', { name: g });
    await api('action=delete', { code: '000001' });
  }
});

test('groupmovebatch assigns multiple funds to one group', async () => {
  const g = '__test_batch_group__';
  try {
    await api('action=groupdelete', { name: g });
    await api('action=groupadd', { name: g });
    await api('action=save', { code: '000001', name: '批量测试A', shares: '100', cost: '1' });
    await api('action=save', { code: '110022', name: '批量测试B', shares: '200', cost: '2' });
    const res = await (await api('action=groupmovebatch', { codes: ['000001', '110022'], name: g })).json();
    assert.equal(res.moved, 2);
    assert.equal(res.items.find(x => x.code === '000001').groupName, g);
    assert.equal(res.items.find(x => x.code === '110022').groupName, g);
    // moving back to ungrouped also works in batch
    const back = await (await api('action=groupmovebatch', { codes: ['000001', '110022'], name: null })).json();
    assert.equal(back.items.find(x => x.code === '000001').groupName, null);
  } finally {
    await api('action=groupdelete', { name: g });
    await api('action=delete', { code: '000001' });
    await api('action=delete', { code: '110022' });
  }
});

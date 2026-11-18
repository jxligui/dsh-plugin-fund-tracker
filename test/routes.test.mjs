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
  const res = await api('action=fundlist&page=1&size=10&query=HXCZHH');
  const data = res.json();
  assert.ok(data.total >= 1);
  assert.ok(data.items.every(x => x.name.includes('华夏成长') || x.code === '000001'));
});

test('save / list / delete holding round-trip', async () => {
  const saved = await (await api('action=save', { code: '000001', name: '测试基金', shares: '100', cost: '1.5' })).json();
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].shares, 100);
  const afterDelete = await (await api('action=delete', { code: '000001' })).json();
  assert.equal(afterDelete.items.length, 0);
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

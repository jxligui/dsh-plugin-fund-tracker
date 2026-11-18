/** Minimal mock of the DSH webServer/connection contract for tests.
 *  Encodes the contract learned from the Harness source:
 *  routes MUST be { kind: 'exact'|'prefix', path, handler(req, res) }.
 */
import assert from 'node:assert/strict';

export function createMockCtx() {
  const routes = new Map();
  const ctx = {
    webServer: {
      register(route) {
        assert.ok(route, 'route must be an object');
        assert.ok(route.kind === 'exact' || route.kind === 'prefix', `route.kind must be exact|prefix, got: ${route.kind}`);
        assert.equal(typeof route.path, 'string', 'route.path must be a string');
        assert.equal(typeof route.handler, 'function', 'route.handler must be a function');
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    connection: { admit: () => ({ admitted: true }) },
  };
  return { ctx, routes };
}

export function makeReq(url, { method = 'GET', body } = {}) {
  const listeners = {};
  const req = {
    url,
    method,
    emit(event, arg) { for (const fn of listeners[event] || []) fn(arg); return req; },
    on(event, fn) { (listeners[event] ||= []).push(fn); return req; },
  };
  if (body !== undefined) {
    const payload = Buffer.from(JSON.stringify(body));
    // macrotask: emit after the handler has attached its listeners
    setTimeout(() => {
      req.emit('data', payload);
      req.emit('end');
    }, 0);
  } else {
    setTimeout(() => req.emit('end'), 0);
  }
  return req;
}

export function makeRes() {
  const res = {
    statusCode: 200,
    headers: null,
    chunks: [],
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || null; },
    end(chunk) { if (chunk) this.chunks.push(chunk); this.done = true; },
    text() { return Buffer.concat(this.chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString('utf8'); },
    json() { return JSON.parse(this.text()); },
  };
  return res;
}

export async function callRoute(routes, path, req) {
  const route = routes.get(path);
  assert.ok(route, `route not registered: ${path}`);
  const res = makeRes();
  await route.handler(req, res);
  // wait a tick for async bodies
  await new Promise(r => setImmediate(r));
  return res;
}

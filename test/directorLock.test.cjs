'use strict';
// The Director lock (services/directorLock.js + route/directorLock.route.js):
// only hashes stored, the password needed both ways, wrong passwords limited,
// admin changes lock the account and bump its version, nothing leaks.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const bcrypt = require('bcryptjs');
const requireAuth = require('../authMiddleware.js');
const { createDirectorLockService, createMemoryLockStore } = require('../services/directorLock.js');
const { createDirectorLockRouter, createDirectorLockAdminHandlers } = require('../route/directorLock.route.js');
const { createFailureLimiter } = require('../utils/rateLimit.js');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';
const ADMIN = '65f0000000000000000000ad';
const DEFAULT_PASSWORD = 'Demon@123';
// Made once here, as the deployment does with scripts/hash-director-lock.cjs.
const DEFAULT_HASH = bcrypt.hashSync(DEFAULT_PASSWORD, 4);

async function start({ defaultHash = DEFAULT_HASH } = {}) {
  const store = createMemoryLockStore();
  [ALICE, BOB].forEach((u) => store.addUser(u));
  const emitted = [];
  const audited = [];
  const service = createDirectorLockService({
    store,
    defaultHash: () => defaultHash,
    emit: (userId, state) => emitted.push({ userId, state }),
    audit: async (e) => audited.push(e),
    hashCost: 4,
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {};
    if (req.headers['x-test-user']) req.session.userId = req.headers['x-test-user'];
    next();
  });
  app.use('/api/director-lock', createDirectorLockRouter({ service, auth: requireAuth }));
  const admin = express.Router();
  // Stand-in for requireAdmin: only ADMIN gets through.
  admin.use((req, res, next) => (req.session.userId === ADMIN ? next() : res.status(403).json({ message: 'Admin only' })));
  const h = createDirectorLockAdminHandlers(service);
  admin.get('/users/:id/director-lock', h.get);
  admin.put('/users/:id/director-lock', h.set);
  admin.post('/users/:id/director-lock/reset', h.reset);
  admin.put('/users/:id/director-lock/scope', h.scope);
  app.use('/api/admin-panel', admin);

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { user, body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(user ? { 'x-test-user': user } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers, text };
  };
  return { call, store, emitted, audited, close: () => new Promise((r) => server.close(r)) };
}

test('an account starts unlocked; the default password locks and unlocks it', async () => {
  const app = await start();
  try {
    assert.deepEqual((await app.call('GET', '/api/director-lock', { user: ALICE })).json, { locked: false, designerLocked: false, accountLocked: false, scope: { director: true, designer: true }, available: true, hasCustomCredential: false, version: 0 });
    const locked = await app.call('POST', '/api/director-lock/lock', { user: ALICE, body: { password: DEFAULT_PASSWORD } });
    assert.equal(locked.status, 200);
    assert.equal(locked.json.locked, true);
    assert.equal(app.emitted.at(-1).userId, ALICE, 'the desktops are told');
    assert.equal((await app.call('GET', '/api/director-lock', { user: BOB })).json.locked, false, 'one account only');
    const open = await app.call('POST', '/api/director-lock/unlock', { user: ALICE, body: { password: DEFAULT_PASSWORD } });
    assert.equal(open.json.locked, false);
  } finally {
    await app.close();
  }
});

test('the password is needed both ways, and nobody logged out gets in', async () => {
  const app = await start();
  try {
    assert.equal((await app.call('POST', '/api/director-lock/lock', { user: ALICE, body: { password: 'nope' } })).status, 401);
    assert.equal((await app.call('POST', '/api/director-lock/lock', { user: ALICE, body: {} })).status, 401);
    assert.equal(app.store.raw(ALICE).locked, false, 'a wrong password does not lock');
    assert.equal((await app.call('GET', '/api/director-lock')).status, 401);
    assert.equal((await app.call('POST', '/api/director-lock/unlock', { body: { password: DEFAULT_PASSWORD } })).status, 401);
  } finally {
    await app.close();
  }
});

test('the sixth wrong password in the window is refused with 429 and Retry-After, even when right', async () => {
  const app = await start();
  try {
    for (let i = 0; i < 5; i++) {
      assert.equal((await app.call('POST', '/api/director-lock/unlock', { user: ALICE, body: { password: `wrong${i}` } })).status, 401);
    }
    const blocked = await app.call('POST', '/api/director-lock/unlock', { user: ALICE, body: { password: DEFAULT_PASSWORD } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal((await app.call('POST', '/api/director-lock/lock', { user: BOB, body: { password: DEFAULT_PASSWORD } })).status, 200, 'another account is not affected');
  } finally {
    await app.close();
  }
});

test('an admin sets an account password: only a hash is kept, the account locks, the version goes up', async () => {
  const app = await start();
  try {
    const bad = await app.call('PUT', `/api/admin-panel/users/${ALICE}/director-lock`, { user: ADMIN, body: { password: 'Short1!', confirm: 'Short1!' } });
    assert.equal(bad.status, 400);
    const mismatch = await app.call('PUT', `/api/admin-panel/users/${ALICE}/director-lock`, { user: ADMIN, body: { password: 'Longenough1', confirm: 'Longenough2' } });
    assert.equal(mismatch.status, 400);

    const set = await app.call('PUT', `/api/admin-panel/users/${ALICE}/director-lock`, { user: ADMIN, body: { password: 'NewSecret#42', confirm: 'NewSecret#42' } });
    assert.equal(set.status, 200);
    assert.deepEqual(set.json, { locked: true, designerLocked: true, accountLocked: true, scope: { director: true, designer: true }, available: true, hasCustomCredential: true, version: 1 });
    assert.ok(!set.text.includes('$2'), 'no hash in the response');
    const raw = app.store.raw(ALICE);
    assert.notEqual(raw.hash, 'NewSecret#42');
    assert.ok(await bcrypt.compare('NewSecret#42', raw.hash), 'a bcrypt hash of it');
    assert.deepEqual(app.audited.at(-1), { adminId: ADMIN, action: 'director-lock.set', targetUserId: ALICE });
    assert.equal(app.emitted.at(-1).state.locked, true, 'desktops re-lock');

    // The default no longer opens it; the new password does.
    assert.equal((await app.call('POST', '/api/director-lock/unlock', { user: ALICE, body: { password: DEFAULT_PASSWORD } })).status, 401);
    assert.equal((await app.call('POST', '/api/director-lock/unlock', { user: ALICE, body: { password: 'NewSecret#42' } })).json.locked, false);

    const reset = await app.call('POST', `/api/admin-panel/users/${ALICE}/director-lock/reset`, { user: ADMIN });
    assert.deepEqual(reset.json, { locked: false, designerLocked: false, accountLocked: false, scope: { director: true, designer: true }, available: true, hasCustomCredential: false, version: 2 });
    assert.equal(app.store.raw(ALICE).hash, null);
  } finally {
    await app.close();
  }
});

test('the lock scope: an admin picks whether it covers the Auto Switcher, the Designer or both', async () => {
  const app = await start();
  try {
    await app.call('POST', '/api/director-lock/lock', { user: ALICE, body: { password: DEFAULT_PASSWORD } });
    let s = (await app.call('GET', '/api/director-lock', { user: ALICE })).json;
    assert.equal(s.locked, true);
    assert.equal(s.designerLocked, true, 'one lock, both areas by default');

    const off = await app.call('PUT', `/api/admin-panel/users/${ALICE}/director-lock/scope`, { user: ADMIN, body: { designer: false } });
    assert.equal(off.status, 200);
    assert.deepEqual(off.json.scope, { director: true, designer: false });
    assert.equal(off.json.locked, true, 'the Auto Switcher stays locked');
    assert.equal(off.json.designerLocked, false);
    assert.equal(off.json.accountLocked, true);
    assert.equal(app.emitted.at(-1).state.designerLocked, false, 'clients are told');
    assert.equal(app.audited.at(-1).action, 'director-lock.scope');

    const dirOff = await app.call('PUT', `/api/admin-panel/users/${ALICE}/director-lock/scope`, { user: ADMIN, body: { director: false, designer: true } });
    assert.equal(dirOff.json.locked, false, 'the desktop sees the Director as unlocked');
    assert.equal(dirOff.json.designerLocked, true);

    assert.equal((await app.call('PUT', `/api/admin-panel/users/${ALICE}/director-lock/scope`, { user: ADMIN, body: { designer: 'yes' } })).status, 400);
    assert.equal((await app.call('PUT', `/api/admin-panel/users/${ALICE}/director-lock/scope`, { user: ALICE, body: { designer: false } })).status, 403);
  } finally {
    await app.close();
  }
});

test('requireDesignerUnlocked: writes get 423 while the Designer is locked, reads go through', async () => {
  const { createRequireDesignerUnlocked, forget } = require('../middleware/requireDesignerUnlocked.js');
  let locked = true;
  let lookups = 0;
  const mw = createRequireDesignerUnlocked({ state: async () => { lookups++; return { designerLocked: locked }; } });
  const run = (method, userId) => new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    mw({ method, session: { userId } }, res, () => resolve({ next: true }));
  });
  assert.deepEqual(await run('GET', ALICE), { next: true });
  const w = await run('PUT', ALICE);
  assert.equal(w.code, 423);
  assert.equal(w.body.code, 'ACCOUNT_LOCKED');
  assert.deepEqual(await run('POST', undefined), { next: true }, 'no user: the route answers 401 itself');
  locked = false;
  assert.equal((await run('DELETE', ALICE)).code, 423, 'memoised for a few seconds');
  forget(ALICE);
  assert.deepEqual(await run('DELETE', ALICE), { next: true }, 'forget() drops the memo');
  assert.equal(lookups, 2);
});

test('only an admin can change or read another account', async () => {
  const app = await start();
  try {
    assert.equal((await app.call('PUT', `/api/admin-panel/users/${BOB}/director-lock`, { user: ALICE, body: { password: 'Whatever123', confirm: 'Whatever123' } })).status, 403);
    assert.equal((await app.call('GET', `/api/admin-panel/users/${BOB}/director-lock`, { user: ALICE })).status, 403);
    assert.equal((await app.call('GET', `/api/admin-panel/users/not-an-id/director-lock`, { user: ADMIN })).status, 400);
    assert.equal((await app.call('GET', `/api/admin-panel/users/65f0000000000000000000ff/director-lock`, { user: ADMIN })).status, 404);
  } finally {
    await app.close();
  }
});

test('with no default hash configured, an account without its own password cannot lock', async () => {
  const app = await start({ defaultHash: '' });
  try {
    assert.equal((await app.call('GET', '/api/director-lock', { user: ALICE })).json.available, false);
    assert.equal((await app.call('POST', '/api/director-lock/lock', { user: ALICE, body: { password: DEFAULT_PASSWORD } })).status, 503);
  } finally {
    await app.close();
  }
});

test('no plaintext default password in the backend sources', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (['node_modules', '.git', 'test'].includes(name)) continue;
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(c?js|json)$/.test(name) && fs.readFileSync(p, 'utf8').includes(DEFAULT_PASSWORD)) hits.push(p);
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('the failure limiter forgets failures once the window has passed', () => {
  let t = 0;
  const lim = createFailureLimiter({ max: 2, windowMs: 1000, now: () => t });
  lim.fail('k');
  lim.fail('k');
  assert.equal(lim.check('k').blocked, true);
  t = 1001;
  assert.equal(lim.check('k').blocked, false);
  lim.fail('k');
  lim.clear('k');
  assert.equal(lim.check('k').blocked, false);
});

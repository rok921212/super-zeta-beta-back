'use strict';
// Admin-managed Director settings (services/directorSettings.js +
// route/directorSettings.route.js): unmanaged by default, validated like the
// desktop's config.rs, admin-only to change, audited, pushed to the desktops,
// and recent decisions kept in memory only.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { createDirectorSettingsService, createMemorySettingsStore, validConfig, RECOMMENDED } = require('../services/directorSettings.js');
const { createDirectorSettingsRouter, createDirectorSettingsAdminHandlers } = require('../route/directorSettings.route.js');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';
const ADMIN = '65f0000000000000000000ad';

async function start() {
  const store = createMemorySettingsStore();
  [ALICE, BOB].forEach((u) => store.addUser(u));
  const emitted = [];
  const audited = [];
  let clock = 1_000_000;
  const service = createDirectorSettingsService({ store, emit: (userId, state) => emitted.push({ userId, state }), audit: async (e) => audited.push(e), now: () => clock });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {};
    if (req.headers['x-test-user']) req.session.userId = req.headers['x-test-user'];
    next();
  });
  app.use('/api/director-settings', createDirectorSettingsRouter({ service, auth: requireAuth, now: () => clock }));
  const admin = express.Router();
  admin.use((req, res, next) => (req.session.userId === ADMIN ? next() : res.status(403).json({ message: 'Admin only' })));
  const h = createDirectorSettingsAdminHandlers(service);
  admin.get('/users/:id/director-settings', h.get);
  admin.put('/users/:id/director-settings', h.set);
  admin.post('/users/:id/director-settings/reset', h.reset);
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
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  return { call, emitted, audited, tick: (ms) => { clock += ms; }, close: () => new Promise((r) => server.close(r)) };
}

const URL = `/api/admin-panel/users/${ALICE}/director-settings`;

test('unmanaged by default: every PC keeps its own settings', async () => {
  const app = await start();
  try {
    assert.deepEqual((await app.call('GET', '/api/director-settings', { user: ALICE })).json, { managed: false, allowAutoSwitch: true, config: null, version: 0, updatedAt: null });
    assert.equal((await app.call('GET', '/api/director-settings')).status, 401, 'needs a login');
  } finally {
    await app.close();
  }
});

test('only an admin manages them; partial configs are filled with the recommended values; the desktops are told', async () => {
  const app = await start();
  try {
    assert.equal((await app.call('PUT', URL, { user: ALICE, body: { config: { sensitivity: 5 } } })).status, 403, 'not the account itself');
    const set = await app.call('PUT', URL, { user: ADMIN, body: { config: { sensitivity: 4, vehicleSuppression: false }, allowAutoSwitch: false } });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual(set.json.config, { ...RECOMMENDED, sensitivity: 4, vehicleSuppression: false });
    assert.equal(set.json.managed, true);
    assert.equal(set.json.allowAutoSwitch, false);
    assert.equal(set.json.version, 1);
    assert.deepEqual(app.emitted.at(-1), { userId: ALICE, state: set.json });
    assert.deepEqual(app.audited.at(-1), { adminId: ADMIN, action: 'director-settings.set', targetUserId: ALICE });
    assert.equal((await app.call('GET', '/api/director-settings', { user: ALICE })).json.config.sensitivity, 4);
    assert.equal((await app.call('GET', '/api/director-settings', { user: BOB })).json.managed, false, 'one account only');

    const reset = await app.call('POST', `${URL}/reset`, { user: ADMIN });
    assert.deepEqual({ managed: reset.json.managed, allow: reset.json.allowAutoSwitch, config: reset.json.config, version: reset.json.version }, { managed: false, allow: true, config: null, version: 2 });
    assert.equal(app.audited.at(-1).action, 'director-settings.reset');
  } finally {
    await app.close();
  }
});

test('invalid settings are refused with a reason', async () => {
  for (const [config, re] of [
    [{ sensitivity: 9 }, /sensitivity must be a whole number from 1 to 5/],
    [{ leadTicks: 2.5 }, /whole number/],
    [{ idlePolicy: 'random' }, /rotate or stay/],
    [{ dryRun: false }, /not a Director setting/],
    [{ playerDwellS: 20, fightDwellS: 10 }, /fight dwell cannot be shorter/],
    [[], /object/],
  ]) {
    assert.throws(() => validConfig(config), re, JSON.stringify(config));
  }
  const app = await start();
  try {
    const bad = await app.call('PUT', URL, { user: ADMIN, body: { config: { minKeyGapS: 0 } } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.message, /minKeyGapS/);
    assert.equal((await app.call('PUT', `/api/admin-panel/users/nope/director-settings`, { user: ADMIN, body: {} })).status, 400);
  } finally {
    await app.close();
  }
});

test('decisions: reported by the desktop, kept in memory (bounded), read by the admin, throttled', async () => {
  const app = await start();
  try {
    const d = (i) => ({ time: '12:00:0' + (i % 10), kind: 'fight', teamId: i, name: `P${i}`, reason: 'fight on: teams [1, 2]', ok: true, extra: 'dropped' });
    const first = await app.call('POST', '/api/director-settings/decisions', { user: ALICE, body: { decisions: [d(1), d(2)] } });
    assert.equal(first.status, 200);
    assert.equal((await app.call('POST', '/api/director-settings/decisions', { user: ALICE, body: { decisions: [d(3)] } })).status, 429, 'too soon');
    for (let i = 0; i < 5; i++) {
      app.tick(5000);
      await app.call('POST', '/api/director-settings/decisions', { user: ALICE, body: { decisions: Array.from({ length: 20 }, (_, k) => d(100 + i * 20 + k)) } });
    }
    const seen = (await app.call('GET', URL, { user: ADMIN })).json;
    assert.equal(seen.decisions.length, 40, 'only the newest 40 are kept');
    assert.equal(seen.decisions.at(-1).teamId, 199);
    assert.equal(seen.decisions[0].extra, undefined, 'unknown fields are not kept');
    assert.ok(seen.decisionsAt);
    assert.deepEqual(seen.recommended, RECOMMENDED);
  } finally {
    await app.close();
  }
});

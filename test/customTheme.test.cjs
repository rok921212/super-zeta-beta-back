'use strict';
// Custom themes (Theme9+): numbering, ownership, slot rules, and cleanup when
// a layout is deleted. Real routers + controllers over the in-memory stores.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startDesignerApp } = require('./helpers/designerApp.cjs');
const { createMemoryStore } = require('../services/overlayLayoutStore.js');
const { createMemoryThemeStore } = require('../services/customThemeStore.js');
const schema = require('../utils/layoutSchema.generated.cjs');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';

let app;
test.before(async () => { app = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore() }); });
test.after(() => app.close());

const newLayout = async (user, name = 'L') => (await app.call('POST', '/api/overlay-layouts', { user, body: { name, draft: schema.createEmptyLayout() } })).json;

test('auth is required', async () => {
  assert.equal((await app.call('GET', '/api/custom-themes')).status, 401);
});

test('themes are numbered 9, 10, 11 per owner; names default to "Theme N"', async () => {
  const a = await app.call('POST', '/api/custom-themes', { user: ALICE, body: {} });
  const b = await app.call('POST', '/api/custom-themes', { user: ALICE, body: { name: 'Finals pack' } });
  const c = await app.call('POST', '/api/custom-themes', { user: BOB, body: {} });
  assert.equal(a.status, 201);
  assert.equal(a.json.number, 9);
  assert.equal(a.json.label, 'Theme9');
  assert.equal(a.json.name, 'Theme 9');
  assert.equal(b.json.number, 10);
  assert.equal(b.json.name, 'Finals pack');
  assert.equal(c.json.number, 9, 'numbering is per owner');
  const list = await app.call('GET', '/api/custom-themes', { user: ALICE });
  assert.deepEqual(list.json.map((t) => t.number), [9, 10]);
});

test('slots: set, move between themes, replace, clear; validation + ownership', async () => {
  const t1 = (await app.call('POST', '/api/custom-themes', { user: ALICE, body: { name: 'S1' } })).json;
  const t2 = (await app.call('POST', '/api/custom-themes', { user: ALICE, body: { name: 'S2' } })).json;
  const l1 = await newLayout(ALICE, 'Lower bar');
  const l2 = await newLayout(ALICE, 'Other lower');
  const bobLayout = await newLayout(BOB, 'bob');

  let r = await app.call('PUT', `/api/custom-themes/${t1._id}/slots/Lower`, { user: ALICE, body: { layoutId: l1._id } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.slots.map((s) => [s.viewKey, s.name, s.publishedRev]), [['Lower', 'Lower bar', 0]]);
  assert.equal(r.json.slots[0].publicId, l1.publicId);

  // same layout into another theme -> removed from the first
  r = await app.call('PUT', `/api/custom-themes/${t2._id}/slots/Alerts`, { user: ALICE, body: { layoutId: l1._id } });
  assert.deepEqual(r.json.slots.map((s) => s.viewKey), ['Alerts']);
  const list = (await app.call('GET', '/api/custom-themes', { user: ALICE })).json;
  assert.equal(list.find((t) => t._id === t1._id).slots.length, 0);

  // a different layout replaces the view's previous one
  r = await app.call('PUT', `/api/custom-themes/${t2._id}/slots/Alerts`, { user: ALICE, body: { layoutId: l2._id } });
  assert.deepEqual(r.json.slots.map((s) => s.layoutId), [l2._id]);

  // Custom1-9 view keys are allowed
  r = await app.call('PUT', `/api/custom-themes/${t2._id}/slots/Custom3`, { user: ALICE, body: { layoutId: l1._id } });
  assert.equal(r.status, 200);

  // clear
  r = await app.call('PUT', `/api/custom-themes/${t2._id}/slots/Custom3`, { user: ALICE, body: { layoutId: null } });
  assert.deepEqual(r.json.slots.map((s) => s.viewKey), ['Alerts']);

  assert.equal((await app.call('PUT', `/api/custom-themes/${t2._id}/slots/NotAView`, { user: ALICE, body: { layoutId: l1._id } })).status, 400);
  assert.equal((await app.call('PUT', `/api/custom-themes/${t2._id}/slots/Lower`, { user: ALICE, body: { layoutId: 'nope' } })).status, 400);
  assert.equal((await app.call('PUT', `/api/custom-themes/${t2._id}/slots/Lower`, { user: ALICE, body: { layoutId: bobLayout._id } })).status, 404, "another user's layout");
  assert.equal((await app.call('PUT', `/api/custom-themes/${t2._id}/slots/Lower`, { user: BOB, body: { layoutId: bobLayout._id } })).status, 404, "another user's theme");
  assert.equal((await app.call('GET', '/api/custom-themes', { user: BOB })).json.some((t) => t._id === t2._id), false);
});

test('publishing shows up in the theme; deleting a layout clears its slot', async () => {
  const t = (await app.call('POST', '/api/custom-themes', { user: ALICE, body: { name: 'Pub' } })).json;
  const l = await newLayout(ALICE, 'Pub layout');
  await app.call('PUT', `/api/custom-themes/${t._id}/slots/LiveStats`, { user: ALICE, body: { layoutId: l._id } });
  const pub = await app.call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: { expectedRev: l.draftRev } });
  assert.equal(pub.status, 200);
  let theme = (await app.call('GET', '/api/custom-themes', { user: ALICE })).json.find((x) => x._id === t._id);
  assert.equal(theme.slots[0].publishedRev, 1);

  assert.equal((await app.call('DELETE', `/api/overlay-layouts/${l._id}`, { user: ALICE })).status, 204);
  theme = (await app.call('GET', '/api/custom-themes', { user: ALICE })).json.find((x) => x._id === t._id);
  assert.deepEqual(theme.slots, []);
});

test('rename + delete; numbers continue from the highest remaining', async () => {
  const u = '65f0000000000000000000c3';
  const a = (await app.call('POST', '/api/custom-themes', { user: u, body: {} })).json;
  const b = (await app.call('POST', '/api/custom-themes', { user: u, body: {} })).json;
  assert.equal((await app.call('PATCH', `/api/custom-themes/${a._id}`, { user: u, body: { name: '' } })).status, 400);
  const ren = await app.call('PATCH', `/api/custom-themes/${a._id}`, { user: u, body: { name: 'Renamed' } });
  assert.equal(ren.json.name, 'Renamed');
  assert.equal((await app.call('DELETE', `/api/custom-themes/${b._id}`, { user: u })).status, 204);
  assert.equal((await app.call('DELETE', `/api/custom-themes/${b._id}`, { user: u })).status, 404);
  const c = (await app.call('POST', '/api/custom-themes', { user: u, body: {} })).json;
  assert.equal(c.number, 10, 'top number is reused after the top theme was deleted');
  assert.equal((await app.call('DELETE', `/api/custom-themes/${a._id}`, { user: BOB })).status, 404);
});

test('an Atlas collection-cap failure is reported as 507, not a bare 500', async () => {
  const layoutStore = createMemoryStore();
  layoutStore.create = async () => {
    const e = new Error('cannot create a new collection -- already using 500 collections of 500');
    e.code = 8000;
    throw e;
  };
  const broken = await startDesignerApp({ layoutStore, themeStore: createMemoryThemeStore() });
  try {
    const r = await broken.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'x' } });
    assert.equal(r.status, 507);
    assert.equal(r.json.code, 'COLLECTION_LIMIT');
    assert.match(r.json.message, /collection limit/i);
  } finally {
    await broken.close();
  }
});

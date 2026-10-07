'use strict';
// The Designer cache (services/designerCache.js): what is served without the
// database, what a write clears, and what must never be cached. Real routers
// and controllers over the in-memory stores, with call counters on the stores
// and an isolated stand-in for Redis.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startDesignerApp } = require('./helpers/designerApp.cjs');
const { createMemoryStore } = require('../services/overlayLayoutStore.js');
const { createMemoryThemeStore } = require('../services/customThemeStore.js');
const { createMemoryFontStore } = require('../services/overlayFontStore.js');
const { withLayoutCache, withThemeCache, withFontCache, createLru, createMemoryBackend } = require('../services/designerCache.js');
const schema = require('../utils/layoutSchema.generated.cjs');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';

/** Count every call that reaches the real store. */
function counted(store) {
  const calls = {};
  const out = {};
  for (const [name, fn] of Object.entries(store)) {
    out[name] = typeof fn === 'function' ? (...args) => { calls[name] = (calls[name] || 0) + 1; return fn(...args); } : fn;
  }
  return { store: out, calls, n: (name) => calls[name] || 0 };
}

async function setup(shared = {}) {
  const backend = shared.backend || createMemoryBackend();
  const layouts = shared.layouts || counted(createMemoryStore());
  const themes = shared.themes || counted(createMemoryThemeStore());
  const fonts = shared.fonts || counted(createMemoryFontStore());
  const layoutStore = withLayoutCache(layouts.store, { backend });
  const app = await startDesignerApp({
    layoutStore,
    themeStore: withThemeCache(themes.store, { backend }),
    fontStore: withFontCache(fonts.store, { backend }),
  });
  return { app, backend, layouts, themes, fonts, layoutStore };
}

const el = (id, x = 0) => ({ id, type: 'rect', x, y: 0, w: 100, h: 40 });
const create = async (app, user = ALICE, name = 'L') => (await app.call('POST', '/api/overlay-layouts', { user, body: { name, draft: { ...schema.createEmptyLayout(), elements: [el('a')] } } })).json;
const woff2 = (size = 64) => { const b = Buffer.alloc(size, 7); b.writeUInt32BE(0x774f4632, 0); b.writeUInt32BE(size, 8); return b; };
const uploadFont = async (app, name, user = ALICE) => (await fetch(`${app.base}/api/overlay-fonts?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'font/woff2', 'x-test-user': user }, body: woff2(200) })).json();

test('lists: read once, served from the cache, cleared by any write of that owner — and only that owner', async () => {
  const { app, layouts } = await setup();
  try {
    const l = await create(app);
    await create(app, BOB, 'bob');
    for (let i = 0; i < 5; i++) assert.equal((await app.call('GET', '/api/overlay-layouts', { user: ALICE })).json.length, 1);
    assert.equal(layouts.n('list'), 1);
    await app.call('GET', '/api/overlay-layouts', { user: BOB });
    assert.equal(layouts.n('list'), 2, 'each owner has their own entry');

    await app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'Renamed' } });
    const after = await app.call('GET', '/api/overlay-layouts', { user: ALICE });
    assert.equal(after.json[0].name, 'Renamed', 'never stale after a write');
    assert.equal(layouts.n('list'), 3);
    await app.call('GET', '/api/overlay-layouts', { user: BOB });
    assert.equal(layouts.n('list'), 3, "Alice's write did not touch Bob's cache");

    await create(app, ALICE, 'second');
    assert.equal((await app.call('GET', '/api/overlay-layouts', { user: ALICE })).json.length, 2);
    await app.call('DELETE', `/api/overlay-layouts/${l._id}`, { user: ALICE });
    assert.deepEqual((await app.call('GET', '/api/overlay-layouts', { user: ALICE })).json.map((x) => x.name), ['second']);
  } finally { await app.close(); }
});

test('the OBS render route: polling costs the database nothing; a publish shows at once', async () => {
  const { app, layouts } = await setup();
  try {
    const l = await create(app);
    assert.equal((await app.call('GET', `/api/overlay-render/${l.publicId}`)).status, 404, 'not published yet');
    await app.call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} });

    const first = await app.call('GET', `/api/overlay-render/${l.publicId}`);
    assert.equal(first.json.publishedRev, 1);
    const byPublic = layouts.n('getByPublicId');
    const revision = layouts.n('getRevision');
    const etag = first.headers.get('etag');
    for (let i = 0; i < 20; i++) {
      const r = await app.call('GET', `/api/overlay-render/${l.publicId}`, { headers: i % 2 ? { 'if-none-match': etag } : {} });
      assert.equal(r.status, i % 2 ? 304 : 200);
    }
    assert.equal(layouts.n('getByPublicId'), byPublic, '20 polls: no lookup query');
    assert.equal(layouts.n('getRevision'), revision, '20 polls: the immutable revision came from memory');

    await app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, draft: { ...schema.createEmptyLayout(), elements: [el('a'), el('b', 50)] } } });
    assert.equal((await app.call('GET', `/api/overlay-render/${l.publicId}`)).json.published.elements.length, 1, 'a save alone changes nothing on air');
    await app.call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} });
    const second = await app.call('GET', `/api/overlay-render/${l.publicId}`, { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 200);
    assert.equal(second.json.publishedRev, 2);
    assert.equal(second.json.published.elements.length, 2);
  } finally { await app.close(); }
});

test('the render lookup never carries the draft, and an unknown public id is remembered briefly', async () => {
  const { app, layouts, backend } = await setup();
  try {
    const l = await create(app);
    await app.call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} });
    await app.call('GET', `/api/overlay-render/${l.publicId}`);
    const cachedLookup = JSON.parse(JSON.stringify(await backend.getCache(`dz:pub:${l.publicId}`)));
    assert.equal(cachedLookup.draft, undefined);
    assert.equal(cachedLookup.publishedRev, 1);

    const before = layouts.n('getByPublicId');
    for (let i = 0; i < 5; i++) assert.equal((await app.call('GET', '/api/overlay-render/NoSuchOverlay1')).status, 404);
    assert.equal(layouts.n('getByPublicId'), before + 1, 'five misses, one query');
  } finally { await app.close(); }
});

test('reads that feed writes are never cached: save, publish and restore always see the database', async () => {
  const { app, layouts } = await setup();
  try {
    const l = await create(app);
    const gets = () => layouts.n('get');
    let n = gets();
    await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE });
    await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE });
    assert.equal(gets(), n + 2, 'the full layout is read from the store every time');

    // a stale expectedRev is still caught (the compare-and-set runs in the store, not the cache)
    await app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'one' } });
    const stale = await app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'two' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.currentRev, 2);

    n = gets();
    assert.equal((await app.call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: { expectedRev: 2 } })).status, 200);
    assert.ok(gets() > n, 'publish read the draft from the store');
  } finally { await app.close(); }
});

test('GET /:id revalidation is answered from the cached summary; ownership still holds', async () => {
  const { app, layouts } = await setup();
  try {
    const l = await create(app);
    const first = await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE });
    const etag = first.headers.get('etag');
    const gets = layouts.n('get');
    for (let i = 0; i < 4; i++) assert.equal((await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE, headers: { 'if-none-match': etag } })).status, 304);
    assert.equal(layouts.n('get'), gets, 'four 304s without loading the draft');
    assert.equal(layouts.n('getSummary'), 1, 'and the summary came from the cache after the first');

    assert.equal((await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: BOB, headers: { 'if-none-match': etag } })).status, 404, 'a cached summary is not a way in');

    await app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'Changed' } });
    const after = await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE, headers: { 'if-none-match': etag } });
    assert.equal(after.status, 200);
    assert.equal(after.json.name, 'Changed');
  } finally { await app.close(); }
});

test('list responses revalidate with an ETag: unchanged = 304, changed = fresh body', async () => {
  const { app } = await setup();
  try {
    const l = await create(app);
    for (const url of ['/api/overlay-layouts', '/api/custom-themes', '/api/overlay-fonts', `/api/overlay-layouts/${l._id}/revisions`]) {
      const a = await app.call('GET', url, { user: ALICE });
      assert.equal(a.status, 200, url);
      const etag = a.headers.get('etag');
      assert.ok(etag, `${url} has an ETag`);
      assert.match(a.headers.get('cache-control'), /private, no-cache/);
      assert.equal((await app.call('GET', url, { user: ALICE, headers: { 'if-none-match': etag } })).status, 304, url);
    }
    const before = (await app.call('GET', '/api/custom-themes', { user: ALICE })).headers.get('etag');
    await app.call('POST', '/api/custom-themes', { user: ALICE, body: {} });
    const after = await app.call('GET', '/api/custom-themes', { user: ALICE, headers: { 'if-none-match': before } });
    assert.equal(after.status, 200);
    assert.equal(after.json.length, 1);
  } finally { await app.close(); }
});

test('themes and fonts: cached lists, cleared by their writes; font files are served from memory', async () => {
  const { app, themes, fonts } = await setup();
  try {
    const l = await create(app);
    const t = (await app.call('POST', '/api/custom-themes', { user: ALICE, body: {} })).json;
    for (let i = 0; i < 4; i++) await app.call('GET', '/api/custom-themes', { user: ALICE });
    assert.equal(themes.n('list'), 1);
    await app.call('PUT', `/api/custom-themes/${t._id}/slots/Lower`, { user: ALICE, body: { layoutId: l._id } });
    assert.equal((await app.call('GET', '/api/custom-themes', { user: ALICE })).json[0].slots.length, 1);
    // deleting the layout clears its slot — and the cached theme list with it
    await app.call('DELETE', `/api/overlay-layouts/${l._id}`, { user: ALICE });
    assert.equal((await app.call('GET', '/api/custom-themes', { user: ALICE })).json[0].slots.length, 0);

    const font = await uploadFont(app, 'Headline');
    for (let i = 0; i < 4; i++) assert.equal((await app.call('GET', '/api/overlay-fonts', { user: ALICE })).json.length, 1);
    assert.equal(fonts.n('list'), 1);
    for (let i = 0; i < 6; i++) assert.equal((await fetch(`${app.base}/api/overlay-fonts/file/${font._id}`)).status, 200);
    assert.equal(fonts.n('getFile'), 1, 'six downloads, one read');
    await uploadFont(app, 'Body');
    assert.equal((await app.call('GET', '/api/overlay-fonts', { user: ALICE })).json.length, 2, 'upload cleared the list');
    await app.call('DELETE', `/api/overlay-fonts/${font._id}`, { user: ALICE });
    assert.equal((await fetch(`${app.base}/api/overlay-fonts/file/${font._id}`)).status, 404, 'a deleted font is not served from memory');
    assert.deepEqual((await app.call('GET', '/api/overlay-fonts', { user: ALICE })).json.map((f) => f.family), ['Body']);
  } finally { await app.close(); }
});

test('two server instances sharing Redis: a write on one is seen by the other', async () => {
  const a = await setup();
  const b = await setup({ backend: a.backend, layouts: a.layouts, themes: a.themes, fonts: a.fonts });
  try {
    const l = await create(a.app);
    assert.equal((await b.app.call('GET', '/api/overlay-layouts', { user: ALICE })).json[0].name, 'L'); // B caches the list
    await a.app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'From A' } });
    assert.equal((await b.app.call('GET', '/api/overlay-layouts', { user: ALICE })).json[0].name, 'From A');
    const etag = (await b.app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE })).headers.get('etag');
    await a.app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 2, name: 'Again' } });
    assert.equal((await b.app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE, headers: { 'if-none-match': etag } })).status, 200, 'B does not answer 304 from a stale summary');
  } finally { await a.app.close(); await b.app.close(); }
});

test('concurrent readers of a cold key share one database read', async () => {
  const { app, layouts } = await setup();
  try {
    await create(app);
    const before = layouts.n('list');
    await Promise.all(Array.from({ length: 12 }, () => app.call('GET', '/api/overlay-layouts', { user: ALICE })));
    assert.ok(layouts.n('list') - before <= 2, `12 simultaneous requests -> ${layouts.n('list') - before} read(s)`);
  } finally { await app.close(); }
});

test('the in-process LRU is bounded by entries and by bytes, and expires', async () => {
  const lru = createLru({ maxEntries: 3, maxBytes: 100 });
  lru.set('a', 1, 40); lru.set('b', 2, 40);
  assert.equal(lru.get('a'), 1); // a is now the most recent
  lru.set('c', 3, 40); // 120 bytes > 100: the least recently used (b) goes
  assert.equal(lru.get('b'), undefined);
  assert.deepEqual([lru.get('a'), lru.get('c')], [1, 3]);
  lru.set('huge', 9, 1000);
  assert.equal(lru.get('huge'), undefined, 'a value larger than the whole budget is not stored');
  lru.set('d', 4, 1); lru.set('e', 5, 1);
  assert.ok(lru.size <= 3 && lru.bytes <= 100);
  lru.deleteWhere((k) => k === 'e');
  assert.equal(lru.get('e'), undefined);

  const short = createLru({ ttlMs: 20 });
  short.set('x', 1);
  assert.equal(short.get('x'), 1);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(short.get('x'), undefined);
});

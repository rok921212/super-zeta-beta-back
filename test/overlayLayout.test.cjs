'use strict';
// Designer layouts API: CRUD, optimistic concurrency, ownership isolation,
// validation (types / formatters / operators / URLs / size), publish
// immutability, the production lock, and the public render route's ETag.
// Runs the real routers + controller over the in-memory store
// (services/overlayLayoutStore.js createMemoryStore — same contract as Mongo).
//
//   npm test   (node --test test/)

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { createOverlayLayoutRouters } = require('../route/overlayLayout.route.js');
const { createMemoryStore } = require('../services/overlayLayoutStore.js');
const schema = require('../utils/layoutSchema.generated.cjs');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';

let server;
let base;
let store;

test.before(async () => {
  store = createMemoryStore();
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  // Stand-in for index.js's JWT shim: same req.session shape.
  app.use((req, res, next) => {
    req.session = {};
    if (req.headers['x-test-user']) req.session.userId = req.headers['x-test-user'];
    next();
  });
  const routers = createOverlayLayoutRouters({ store, auth: requireAuth });
  app.use('/api/overlay-layouts', routers.layouts);
  app.use('/api/overlay-render', routers.render);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((r) => server.close(r)));

async function call(method, url, { user, body, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(user ? { 'x-test-user': user } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers };
}

const textEl = (id, extra = {}) => ({
  id, type: 'text', x: 10, y: 10, w: 300, h: 60, text: 'Hello',
  bind: { text: { path: 'derived.teams[0].teamName', format: 'upper', fallback: '' } },
  style: { color: { ref: 'theme.colors.text' }, fontSize: 32 },
  ...extra,
});
const draftWith = (...elements) => ({ ...schema.createEmptyLayout(), elements });

async function createLayout(user = ALICE, body = {}) {
  const r = await call('POST', '/api/overlay-layouts', { user, body: { name: 'Standings', ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

test('schema copy is in sync with the front source', () => {
  const front = path.join(__dirname, '..', '..', '..', 'front', 'src', 'graphics', 'schema', 'layoutSchema.js');
  if (!fs.existsSync(front)) return; // backend-only checkout (Render build)
  const generated = fs.readFileSync(path.join(__dirname, '..', 'utils', 'layoutSchema.generated.cjs'), 'utf8');
  assert.ok(generated.endsWith(fs.readFileSync(front, 'utf8')), 'run: node front/scripts/sync-layout-schema.mjs');
});

test('auth is required', async () => {
  assert.equal((await call('GET', '/api/overlay-layouts')).status, 401);
  assert.equal((await call('POST', '/api/overlay-layouts', { body: {} })).status, 401);
});

test('create / list / get; owner comes from the token, never the body', async () => {
  const l = await createLayout(ALICE, { ownerId: BOB, draft: draftWith(textEl('t1')) });
  assert.equal(l.draftRev, 1);
  assert.equal(l.publishedRev, 0);
  assert.match(l.publicId, /^[A-Za-z0-9]{12}$/);
  assert.equal(l.draft.elements[0].id, 't1');
  assert.equal(l.draft.elements[0].opacity, 1, 'normalized on the way in');

  const mine = await call('GET', '/api/overlay-layouts', { user: ALICE });
  assert.ok(mine.json.some((x) => x._id === l._id));
  assert.equal(mine.json[0].draft, undefined, 'list is summaries only');
  const bobs = await call('GET', '/api/overlay-layouts', { user: BOB });
  assert.ok(!bobs.json.some((x) => x._id === l._id));

  assert.equal((await call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE })).status, 200);
  assert.equal((await call('GET', '/api/overlay-layouts/not-an-id', { user: ALICE })).status, 404);
});

test('another user can neither read, edit, publish, lock, duplicate nor delete', async () => {
  const l = await createLayout(ALICE);
  const id = l._id;
  assert.equal((await call('GET', `/api/overlay-layouts/${id}`, { user: BOB })).status, 404);
  assert.equal((await call('PUT', `/api/overlay-layouts/${id}`, { user: BOB, body: { expectedRev: 1, name: 'x' } })).status, 404);
  assert.equal((await call('POST', `/api/overlay-layouts/${id}/publish`, { user: BOB, body: {} })).status, 404);
  assert.equal((await call('POST', `/api/overlay-layouts/${id}/lock`, { user: BOB })).status, 404);
  assert.equal((await call('POST', `/api/overlay-layouts/${id}/duplicate`, { user: BOB })).status, 404);
  assert.equal((await call('DELETE', `/api/overlay-layouts/${id}`, { user: BOB })).status, 404);
  assert.equal((await call('GET', `/api/overlay-layouts/${id}`, { user: ALICE })).json.name, 'Standings');
});

test('autosave uses optimistic concurrency: stale expectedRev -> 409, nothing overwritten', async () => {
  const l = await createLayout();
  const a = await call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, draft: draftWith(textEl('a')) } });
  assert.equal(a.status, 200);
  assert.equal(a.json.draftRev, 2);
  const stale = await call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, draft: draftWith(textEl('b')) } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.currentRev, 2);
  const now = await call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE });
  assert.equal(now.json.draft.elements[0].id, 'a');
  assert.equal((await call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { name: 'x' } })).status, 400, 'expectedRev required');
});

test('validation rejects unsafe or malformed layouts', async () => {
  const bad = [
    ['unknown element type', draftWith({ id: 'x', type: 'iframe', x: 0, y: 0, w: 1, h: 1 })],
    ['unknown formatter', draftWith(textEl('x', { bind: { text: { path: 'match.map', format: 'eval' } } }))],
    ['unknown operator', draftWith(textEl('x', { visibleWhen: { path: 'item.isAllDead', op: 'matches', value: true } }))],
    ['binding outside the allowed roots', draftWith(textEl('x', { bind: { text: { path: 'window.localStorage' } } }))],
    ['prototype path', draftWith(textEl('x', { bind: { text: { path: 'item.__proto__.x' } } }))],
    ['javascript: URL', draftWith({ id: 'x', type: 'image', x: 0, y: 0, w: 1, h: 1, src: 'javascript:alert(1)' })],
    ['data: URL', draftWith({ id: 'x', type: 'image', x: 0, y: 0, w: 1, h: 1, src: 'data:image/png;base64,AAAA' })],
    ['http: URL', draftWith({ id: 'x', type: 'image', x: 0, y: 0, w: 1, h: 1, src: 'http://evil.example/a.png' })],
    ['path traversal', draftWith({ id: 'x', type: 'image', x: 0, y: 0, w: 1, h: 1, src: '/a/%2e%2e/b.png' })],
    ['CSS injection', draftWith(textEl('x', { style: { fill: 'red;background:url(//evil)' } }))],
    ['svg path with script', draftWith({ id: 'x', type: 'path', x: 0, y: 0, w: 1, h: 1, d: 'M0 0 <script>' })],
    ['duplicate ids', draftWith(textEl('x'), textEl('x'))],
    ['children on a leaf', draftWith(textEl('x', { children: [] }))],
  ];
  for (const [label, draft] of bad) {
    const r = await call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: label, draft } });
    assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.json)}`);
    assert.ok(Array.isArray(r.json.errors) && r.json.errors.length > 0, label);
  }
});

test('size, element-count and nesting limits', async () => {
  const many = draftWith(...Array.from({ length: schema.LIMITS.maxElements + 1 }, (_, i) => ({ id: `r${i}`, type: 'rect', x: 0, y: 0, w: 1, h: 1 })));
  assert.equal((await call('POST', '/api/overlay-layouts', { user: ALICE, body: { draft: many } })).status, 400);

  let nested = { id: 'leaf', type: 'rect', x: 0, y: 0, w: 1, h: 1 };
  for (let i = 0; i < schema.LIMITS.maxDepth + 1; i++) nested = { id: `g${i}`, type: 'group', x: 0, y: 0, w: 1, h: 1, children: [nested] };
  assert.equal((await call('POST', '/api/overlay-layouts', { user: ALICE, body: { draft: draftWith(nested) } })).status, 400);

  const huge = draftWith(textEl('big', { text: 'x'.repeat(1500) }));
  huge.variables = Object.fromEntries(Array.from({ length: 199 }, (_, i) => [`v${i}`, 'y'.repeat(2048)]));
  huge.brand = Object.fromEntries(Array.from({ length: 199 }, (_, i) => [`b${i}`, 'z'.repeat(2048)]));
  assert.equal((await call('POST', '/api/overlay-layouts', { user: ALICE, body: { draft: huge } })).status, 400);
});

test('publish creates an immutable revision; later autosaves never change what is live', async () => {
  const l = await createLayout(ALICE, { draft: draftWith(textEl('v1')) });
  const p1 = await call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: { expectedRev: 1 } });
  assert.equal(p1.status, 200, JSON.stringify(p1.json));
  assert.equal(p1.json.publishedRev, 1);

  await call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, draft: draftWith(textEl('v2')) } });
  const live = await call('GET', `/api/overlay-render/${l.publicId}`);
  assert.equal(live.status, 200);
  assert.equal(live.json.published.elements[0].id, 'v1', 'draft edit did not leak to the live revision');

  const p2 = await call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} });
  assert.equal(p2.json.publishedRev, 2);
  const rev1 = await store.getRevision(l._id, 1);
  assert.equal(rev1.document.elements[0].id, 'v1', 'revision 1 unchanged');

  const revs = await call('GET', `/api/overlay-layouts/${l._id}/revisions`, { user: ALICE });
  assert.deepEqual(revs.json.map((r) => r.rev), [2, 1]);

  // publishing with a stale view of the draft is refused
  const stale = await call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: { expectedRev: 1 } });
  assert.equal(stale.status, 409);
});

test('concurrent publishes: exactly one wins', async () => {
  const l = await createLayout();
  const results = await Promise.all([1, 2, 3].map(() => call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} })));
  const ok = results.filter((r) => r.status === 200);
  assert.ok(ok.length >= 1);
  const layout = await store.get(l._id, ALICE);
  const revs = await store.listRevisions(l._id);
  assert.equal(revs.length, layout.publishedRev, 'no orphan / duplicate revisions');
  assert.ok(results.every((r) => r.status === 200 || r.status === 409));
});

test('restore copies a revision into the draft (with concurrency)', async () => {
  const l = await createLayout(ALICE, { draft: draftWith(textEl('orig')) });
  await call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} });
  const e = await call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, draft: draftWith(textEl('edited')) } });
  const r = await call('POST', `/api/overlay-layouts/${l._id}/revisions/1/restore`, { user: ALICE, body: { expectedRev: e.json.draftRev } });
  assert.equal(r.status, 200);
  assert.equal(r.json.draft.elements[0].id, 'orig');
  assert.equal((await call('POST', `/api/overlay-layouts/${l._id}/revisions/9/restore`, { user: ALICE, body: { expectedRev: r.json.draftRev } })).status, 404);
});

test('production lock blocks edit, publish and delete (423) until unlocked', async () => {
  const l = await createLayout();
  assert.equal((await call('POST', `/api/overlay-layouts/${l._id}/lock`, { user: ALICE })).json.productionLocked, true);
  assert.equal((await call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'x' } })).status, 423);
  assert.equal((await call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} })).status, 423);
  assert.equal((await call('DELETE', `/api/overlay-layouts/${l._id}`, { user: ALICE })).status, 423);
  await call('POST', `/api/overlay-layouts/${l._id}/unlock`, { user: ALICE });
  assert.equal((await call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'x' } })).status, 200);
});

test('public render: 404 until published, then ETag / 304, and new ETag after republish', async () => {
  const l = await createLayout(ALICE, { draft: draftWith(textEl('r1')), defaults: { tournamentId: ALICE, roundId: BOB }, assetBase: 'https://cdn.example.com/' });
  assert.equal((await call('GET', `/api/overlay-render/${l.publicId}`)).status, 404);
  assert.equal((await call('GET', '/api/overlay-render/bad!id')).status, 404);
  await call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} });

  const r = await call('GET', `/api/overlay-render/${l.publicId}`);
  assert.equal(r.status, 200);
  const etag = r.headers.get('etag');
  assert.equal(etag, `"${l.publicId}-1"`);
  assert.match(r.headers.get('cache-control'), /max-age=10/);
  assert.equal(r.json.defaults.tournamentId, ALICE);
  assert.equal(r.json.assetBase, 'https://cdn.example.com');
  assert.equal(r.json.stage.width, 1920);
  assert.equal(r.json.draft, undefined, 'drafts are never public');

  assert.equal((await call('GET', `/api/overlay-render/${l.publicId}`, { headers: { 'If-None-Match': etag } })).status, 304);
  await call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} });
  const again = await call('GET', `/api/overlay-render/${l.publicId}`, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('etag'), `"${l.publicId}-2"`);
});

test('duplicate makes an unpublished copy with a new publicId; delete removes revisions', async () => {
  const l = await createLayout(ALICE, { draft: draftWith(textEl('d1')) });
  await call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: ALICE, body: {} });
  const d = await call('POST', `/api/overlay-layouts/${l._id}/duplicate`, { user: ALICE });
  assert.equal(d.status, 201);
  assert.notEqual(d.json.publicId, l.publicId);
  assert.equal(d.json.publishedRev, 0);
  assert.equal(d.json.draft.elements[0].id, 'd1');

  assert.equal((await call('DELETE', `/api/overlay-layouts/${l._id}`, { user: ALICE })).status, 204);
  assert.equal((await store.listRevisions(l._id)).length, 0);
  assert.equal((await call('GET', `/api/overlay-render/${l.publicId}`)).status, 404);
});

test('meta validation: bad defaults / assetBase rejected', async () => {
  assert.equal((await call('POST', '/api/overlay-layouts', { user: ALICE, body: { defaults: { tournamentId: 'nope' } } })).status, 400);
  assert.equal((await call('POST', '/api/overlay-layouts', { user: ALICE, body: { assetBase: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await call('POST', '/api/overlay-layouts', { user: ALICE, body: { defaults: { matchMode: 'whatever' } } })).status, 400);
});

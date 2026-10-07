'use strict';
// Designer save transport + the animation schema additions:
//   - gzipped request bodies are accepted (body-parser inflates them);
//   - ?return=summary answers without echoing the draft back;
//   - GET /:id revalidates with an ETag (304 when nothing changed);
//   - exit triggers, timing options, wiggle and the new easings validate.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { startDesignerApp } = require('./helpers/designerApp.cjs');
const { createMemoryStore } = require('../services/overlayLayoutStore.js');
const { createMemoryThemeStore } = require('../services/customThemeStore.js');
const schema = require('../utils/layoutSchema.generated.cjs');

const ALICE = '65f0000000000000000000a1';

let app;
test.before(async () => { app = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore() }); });
test.after(() => app.close());

const newLayout = async () => (await app.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'T', draft: schema.createEmptyLayout() } })).json;
const el = (over = {}) => ({ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 40, ...over });

test('the layout says what its save route can do', async () => {
  const l = await newLayout();
  const got = await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE });
  assert.deepEqual(got.json.capabilities, ['gzip-save', 'summary-save']);
});

test('a gzipped save is accepted and stored exactly; ?return=summary does not echo the draft', async () => {
  const l = await newLayout();
  const draft = { ...schema.createEmptyLayout(), elements: Array.from({ length: 60 }, (_, i) => el({ id: `e${i}`, x: i, name: `Row background ${i}`, style: { fill: 'rgba(17,24,39,0.92)', radius: 4 } })) };
  const json = JSON.stringify({ expectedRev: 1, draft });
  const gz = zlib.gzipSync(json);
  assert.ok(gz.length < json.length / 5, `gzip should shrink a draft a lot (${json.length} -> ${gz.length})`);

  const res = await fetch(`${app.base}/api/overlay-layouts/${l._id}?return=summary`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'x-test-user': ALICE },
    body: gz,
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.draftRev, 2);
  assert.equal(body.draft, undefined, 'summary only');
  assert.ok(text.length < 600, `the reply should be tiny (${text.length} bytes)`);

  const stored = await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE });
  assert.equal(stored.json.draft.elements.length, 60);
  assert.equal(stored.json.draft.elements[59].name, 'Row background 59');
});

test('without ?return=summary the full layout still comes back (older editors)', async () => {
  const l = await newLayout();
  const r = await app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'Renamed' } });
  assert.equal(r.status, 200);
  assert.ok(r.json.draft, 'draft echoed');
});

test('a gzipped save is still validated', async () => {
  const l = await newLayout();
  const bad = zlib.gzipSync(JSON.stringify({ expectedRev: 1, draft: { ...schema.createEmptyLayout(), elements: [el({ type: 'nope' })] } }));
  const res = await fetch(`${app.base}/api/overlay-layouts/${l._id}?return=summary`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'x-test-user': ALICE }, body: bad,
  });
  assert.equal(res.status, 400);
});

test('GET /:id revalidates: 304 until the layout changes', async () => {
  const l = await newLayout();
  const first = await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE });
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.match(first.headers.get('cache-control'), /private/);
  assert.match(first.headers.get('cache-control'), /no-cache/);
  assert.equal((await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE, headers: { 'if-none-match': etag } })).status, 304);

  await app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: ALICE, body: { expectedRev: 1, name: 'Changed' } });
  const after = await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE, headers: { 'if-none-match': etag } });
  assert.equal(after.status, 200);
  assert.notEqual(after.headers.get('etag'), etag);

  // locking does not bump draftRev, but it changes what GET returns
  const etag2 = after.headers.get('etag');
  await app.call('POST', `/api/overlay-layouts/${l._id}/lock`, { user: ALICE });
  assert.equal((await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: ALICE, headers: { 'if-none-match': etag2 } })).status, 200);
});

test('animation schema: exit triggers, timing, wiggle, new easings and properties', () => {
  const clip = (over) => ({ id: 'c', duration: 500, trigger: { type: 'enter' }, tracks: [{ prop: 'opacity', keyframes: [{ t: 0, value: 0 }, { t: 500, value: 1 }] }], ...over });
  const check = (c) => schema.validateLayout({ ...schema.createEmptyLayout(), elements: [el({ timeline: { clips: [c] } })] });

  assert.equal(check(clip({ trigger: { type: 'exit' } })).ok, true);
  assert.equal(check(clip({ trigger: { type: 'exit', after: 5000 } })).ok, true);
  assert.equal(check(clip({ delay: 200, speed: 2, stagger: 60, direction: 'alternate', loop: true })).ok, true);
  assert.equal(check(clip({ tracks: [{ prop: 'dx', keyframes: [{ t: 0, value: -300, ease: 'elasticOut' }, { t: 500, value: 0 }], wiggle: { freq: 2, amp: 6 } }] })).ok, true);
  for (const prop of ['dx', 'dy', 'rotateX', 'rotateY', 'skewY', 'originX', 'originY', 'wipeL', 'wipeR', 'wipeT', 'wipeB', 'saturate', 'hueRotate', 'contrast', 'letterSpacing']) {
    assert.equal(check(clip({ tracks: [{ prop, keyframes: [{ t: 0, value: 0, ease: 'hold' }, { t: 500, value: 1 }] }] })).ok, true, prop);
  }

  const paths = (c) => check(c).errors.map((e) => e.path.replace('elements[0].timeline.clips[0].', ''));
  assert.deepEqual(paths(clip({ trigger: { type: 'exit', after: -1 } })), ['trigger.after']);
  assert.deepEqual(paths(clip({ speed: 0 })), ['speed']);
  assert.deepEqual(paths(clip({ direction: 'sideways' })), ['direction']);
  assert.deepEqual(paths(clip({ stagger: 99999 })), ['stagger']);
  assert.deepEqual(paths(clip({ tracks: [{ prop: 'dx', keyframes: [{ t: 0, value: 0 }], wiggle: { freq: 0, amp: 1 } }] })), ['tracks[0].wiggle']);
  assert.deepEqual(paths(clip({ tracks: [{ prop: 'opacity', keyframes: [{ t: 0, value: 0, ease: 'warp9' }] }] })), ['tracks[0].keyframes[0].ease']);
  assert.deepEqual(paths(clip({ trigger: { type: 'leave' } })), ['trigger']);
});

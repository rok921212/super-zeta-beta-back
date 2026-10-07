'use strict';
// Designer font library: woff2-only uploads (decided by the bytes), limits,
// ownership, the public file route, and the font snapshot a publish puts on
// the revision. Real routers + controllers over the in-memory stores.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startDesignerApp } = require('./helpers/designerApp.cjs');
const { createMemoryStore } = require('../services/overlayLayoutStore.js');
const { createMemoryThemeStore } = require('../services/customThemeStore.js');
const { createMemoryFontStore } = require('../services/overlayFontStore.js');
const { MAX_FONT_BYTES, MAX_FONTS_PER_USER } = require('../controller/overlayFont.controller.js');
const schema = require('../utils/layoutSchema.generated.cjs');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';

/** A buffer with a valid WOFF2 header ('wOF2' + flavor + total length). */
function woff2(size = 64) {
  const buf = Buffer.alloc(size, 7);
  buf.writeUInt32BE(0x774f4632, 0);
  buf.writeUInt32BE(0x00010000, 4);
  buf.writeUInt32BE(size, 8);
  return buf;
}

let app;
test.before(async () => { app = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore() }); });
test.after(() => app.close());

async function upload(target, name, bytes, { user = ALICE, type = 'font/woff2' } = {}) {
  const res = await fetch(`${target.base}/api/overlay-fonts?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': type, ...(user ? { 'x-test-user': user } : {}) },
    body: bytes,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json };
}

test('auth is required for the library, not for the file', async () => {
  assert.equal((await app.call('GET', '/api/overlay-fonts')).status, 401);
  assert.equal((await upload(app, 'Nope', woff2(), { user: null })).status, 401);
  assert.equal((await app.call('GET', '/api/overlay-fonts/file/65f0000000000000000000ff')).status, 404);
});

test('upload a woff2, list it, and serve the bytes publicly with an immutable cache', async () => {
  const bytes = woff2(200);
  const up = await upload(app, 'Clan  Display', bytes);
  assert.equal(up.status, 201);
  assert.equal(up.json.family, 'Clan Display', 'whitespace is collapsed');
  assert.equal(up.json.size, 200);

  const list = await app.call('GET', '/api/overlay-fonts', { user: ALICE });
  assert.deepEqual(list.json.map((f) => f.family), ['Clan Display']);
  assert.equal(list.json[0].data, undefined, 'the list never carries bytes');
  assert.deepEqual((await app.call('GET', '/api/overlay-fonts', { user: BOB })).json, [], 'libraries are per owner');

  const file = await fetch(`${app.base}/api/overlay-fonts/file/${up.json._id}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'font/woff2');
  assert.match(file.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
});

test('only woff2 is accepted — by content, not by name or content-type', async () => {
  const ttf = Buffer.alloc(64, 1);
  ttf.writeUInt32BE(0x00010000, 0); // TrueType signature
  assert.equal((await upload(app, 'Fake', ttf)).status, 400, 'ttf bytes labelled font/woff2');
  assert.equal((await upload(app, 'Fake', woff2(), { type: 'font/ttf' })).status, 400, 'woff2 bytes under another content-type');
  const truncated = woff2(200).subarray(0, 100); // header length no longer matches
  assert.equal((await upload(app, 'Fake', truncated)).status, 400);
  const wrong = await upload(app, 'Fake', Buffer.from('wOFF' + 'x'.repeat(60)));
  assert.equal(wrong.status, 400);
  assert.match(wrong.json.message, /woff2/);
});

test('name rules: shape, built-in names, duplicates (case-insensitive)', async () => {
  assert.equal((await upload(app, '', woff2())).status, 400);
  assert.equal((await upload(app, '9lives', woff2())).status, 400);
  assert.equal((await upload(app, 'a";}x', woff2())).status, 400);
  assert.equal((await upload(app, 'tungsten', woff2())).status, 409, 'cannot shadow a bundled font');
  assert.equal((await upload(app, 'Dup', woff2())).status, 201);
  assert.equal((await upload(app, 'dup', woff2())).status, 409);
  assert.equal((await upload(app, 'Dup', woff2(), { user: BOB })).status, 201, 'another owner may reuse the name');
});

test('oversize fonts are refused with 413', async () => {
  const big = await upload(app, 'Huge', woff2(MAX_FONT_BYTES + 1));
  assert.equal(big.status, 413);
  assert.match(big.json.message, /2 MB/);
});

test('delete is owner-scoped; the file is gone afterwards', async () => {
  const up = await upload(app, 'Temp', woff2());
  assert.equal((await app.call('DELETE', `/api/overlay-fonts/${up.json._id}`, { user: BOB })).status, 404);
  assert.equal((await app.call('DELETE', '/api/overlay-fonts/not-an-id', { user: ALICE })).status, 404);
  assert.equal((await app.call('DELETE', `/api/overlay-fonts/${up.json._id}`, { user: ALICE })).status, 204);
  assert.equal((await app.call('GET', `/api/overlay-fonts/file/${up.json._id}`)).status, 404);
});

test('a library is capped', async () => {
  const capped = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore(), fontStore: createMemoryFontStore() });
  try {
    for (let i = 0; i < MAX_FONTS_PER_USER; i++) {
      assert.equal((await upload(capped, `Font ${i}`, woff2())).status, 201);
    }
    const over = await upload(capped, 'One too many', woff2());
    assert.equal(over.status, 409);
    assert.match(over.json.message, /limit/i);
  } finally {
    await capped.close();
  }
});

test('publish snapshots the font library onto the revision the runtime renders', async () => {
  const fresh = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore() });
  try {
    const layout = (await fresh.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'L', draft: schema.createEmptyLayout() } })).json;
    const first = (await upload(fresh, 'Headline', woff2())).json;
    assert.equal((await fresh.call('POST', `/api/overlay-layouts/${layout._id}/publish`, { user: ALICE, body: {} })).status, 200);

    let render = (await fresh.call('GET', `/api/overlay-render/${layout.publicId}`)).json;
    assert.deepEqual(render.fonts, [{ id: first._id, family: 'Headline' }]);

    // A font uploaded later is not part of the already-published revision…
    const second = (await upload(fresh, 'Body', woff2())).json;
    render = (await fresh.call('GET', `/api/overlay-render/${layout.publicId}`)).json;
    assert.equal(render.fonts.length, 1);

    // …until the next publish.
    await fresh.call('POST', `/api/overlay-layouts/${layout._id}/publish`, { user: ALICE, body: {} });
    render = (await fresh.call('GET', `/api/overlay-render/${layout.publicId}`)).json;
    assert.deepEqual(render.fonts.map((f) => f.id), [first._id, second._id]);
  } finally {
    await fresh.close();
  }
});

'use strict';
// Theme export / import (.sstheme): the round trip between two accounts, what
// travels in the file, and that a bad file writes nothing. Real routers +
// controllers over the in-memory stores.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { startDesignerApp } = require('./helpers/designerApp.cjs');
const { createMemoryStore } = require('../services/overlayLayoutStore.js');
const { createMemoryThemeStore } = require('../services/customThemeStore.js');
const { createMemoryFontStore } = require('../services/overlayFontStore.js');
const { encodePack, decodePack, usedFamilies, packFileName } = require('../services/themePack.js');
const schema = require('../utils/layoutSchema.generated.cjs');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';
const CAROL = '65f0000000000000000000c3';
const DAVE = '65f0000000000000000000d4';
const EVE = '65f0000000000000000000e5';
const FRANK = '65f0000000000000000000f6';

/** A buffer with a valid WOFF2 header ('wOF2' + flavor + total length). */
function woff2(size = 64, fill = 7) {
  const buf = Buffer.alloc(size, fill);
  buf.writeUInt32BE(0x774f4632, 0);
  buf.writeUInt32BE(0x00010000, 4);
  buf.writeUInt32BE(size, 8);
  return buf;
}

let app;
test.before(async () => {
  app = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore(), fontStore: createMemoryFontStore() });
});
test.after(() => app.close());

/** A valid draft whose document font is `family`. */
function draftWithFont(family) {
  const doc = schema.createEmptyLayout();
  if (family) doc.theme.typography.fontFamily = `"${family}", sans-serif`;
  return doc;
}

const newLayout = async (user, name, family) =>
  (await app.call('POST', '/api/overlay-layouts', { user, body: { name, draft: draftWithFont(family), defaults: { tournamentId: '65f0000000000000000000ee', matchMode: 'liveMatch' } } })).json;

async function uploadFont(user, name, bytes) {
  const res = await fetch(`${app.base}/api/overlay-fonts?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'font/woff2', 'x-test-user': user }, body: bytes,
  });
  assert.equal(res.status, 201);
  return res.json();
}

async function download(user, url) {
  const res = await fetch(app.base + url, { headers: user ? { 'x-test-user': user } : {} });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function importFile(user, bytes, query = '', type = 'application/octet-stream') {
  const res = await fetch(`${app.base}/api/custom-themes/import${query}`, {
    method: 'POST', headers: { 'content-type': type, ...(user ? { 'x-test-user': user } : {}) }, body: bytes,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json };
}

const layoutsOf = async (user) => (await app.call('GET', '/api/overlay-layouts', { user })).json;
const themesOf = async (user) => (await app.call('GET', '/api/custom-themes', { user })).json;
const fontsOf = async (user) => (await app.call('GET', '/api/overlay-fonts', { user })).json;

test('auth is required; another account cannot export my layout or theme', async () => {
  const layout = await newLayout(ALICE, 'Private', null);
  const theme = (await app.call('POST', '/api/custom-themes', { user: ALICE, body: { name: 'Mine' } })).json;
  await app.call('PUT', `/api/custom-themes/${theme._id}/slots/Lower`, { user: ALICE, body: { layoutId: layout._id } });
  assert.equal((await download(null, `/api/overlay-layouts/${layout._id}/export`)).status, 401);
  assert.equal((await importFile(null, Buffer.from('x'))).status, 401);
  assert.equal((await download(BOB, `/api/overlay-layouts/${layout._id}/export`)).status, 404);
  assert.equal((await download(BOB, `/api/custom-themes/${theme._id}/export`)).status, 404);
  assert.equal((await download(ALICE, '/api/overlay-layouts/not-an-id/export')).status, 404);
  await app.call('DELETE', `/api/custom-themes/${theme._id}`, { user: ALICE });
});

test('theme round trip: export from one account, import into another as a named, published theme', async () => {
  await uploadFont(ALICE, 'Clan Display', woff2(300, 3));
  await uploadFont(ALICE, 'Unused Face', woff2(5000, 4));
  const lower = await newLayout(ALICE, 'Lower bar', 'Clan Display');
  const alerts = await newLayout(ALICE, 'Kill alerts', null);
  const theme = (await app.call('POST', '/api/custom-themes', { user: ALICE, body: { name: 'Finals pack' } })).json;
  await app.call('PUT', `/api/custom-themes/${theme._id}/slots/Lower`, { user: ALICE, body: { layoutId: lower._id } });
  await app.call('PUT', `/api/custom-themes/${theme._id}/slots/Alerts`, { user: ALICE, body: { layoutId: alerts._id } });

  const file = await download(ALICE, `/api/custom-themes/${theme._id}/export`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/octet-stream');
  assert.match(file.headers.get('content-disposition'), /Finals-pack\.sstheme/);
  assert.equal(file.bytes.subarray(0, 4).toString('latin1'), 'SSTH');

  // What is inside: both layouts (DisplayHud view order), only the font that is used, nothing account-bound.
  const { pack } = decodePack(file.bytes);
  assert.equal(pack.name, 'Finals pack');
  assert.deepEqual(pack.layouts.map((l) => [l.name, l.viewKey, l.matchMode]), [['Kill alerts', 'Alerts', 'liveMatch'], ['Lower bar', 'Lower', 'liveMatch']]);
  assert.deepEqual(pack.fonts.map((f) => f.family), ['Clan Display']);
  const text = zlib.gunzipSync(file.bytes.subarray(5)).toString('utf8');
  for (const secret of [ALICE, lower._id, lower.publicId, '65f0000000000000000000ee']) assert.ok(!text.includes(secret), `${secret} must not be in the file`);
  assert.ok(file.bytes.length < 2000, `a small theme is a small file (${file.bytes.length} bytes)`);

  // dryRun describes the file and writes nothing.
  const dry = await importFile(BOB, file.bytes, '?dryRun=1');
  assert.equal(dry.status, 200);
  assert.equal(dry.json.name, 'Finals pack');
  assert.deepEqual(dry.json.layouts.map((l) => l.viewKey), ['Alerts', 'Lower']);
  assert.deepEqual(dry.json.fonts, ['Clan Display']);
  assert.deepEqual(await layoutsOf(BOB), []);
  assert.deepEqual(await themesOf(BOB), []);
  assert.deepEqual(await fontsOf(BOB), []);

  const done = await importFile(BOB, file.bytes, `?name=${encodeURIComponent('  Bob finals ')}`);
  assert.equal(done.status, 201);
  assert.equal(done.json.theme.name, 'Bob finals');
  assert.equal(done.json.theme.number, 9);
  assert.deepEqual(done.json.theme.slots.map((s) => [s.viewKey, s.name, s.publishedRev]).sort(), [['Alerts', 'Kill alerts', 1], ['Lower', 'Lower bar', 1]]);
  assert.deepEqual(done.json.warnings, []);

  // Bob owns fresh copies: new ids, new public ids, and they render publicly.
  const bobLayouts = await layoutsOf(BOB);
  assert.equal(bobLayouts.length, 2);
  for (const l of bobLayouts) {
    assert.ok(![lower._id, alerts._id].includes(l._id));
    assert.ok(![lower.publicId, alerts.publicId].includes(l.publicId));
    assert.equal(l.defaults.tournamentId, null);
    assert.equal(l.defaults.matchMode, 'liveMatch');
  }
  const bobFonts = await fontsOf(BOB);
  assert.deepEqual(bobFonts.map((f) => [f.family, f.size]), [['Clan Display', 300]]);
  const bobLower = bobLayouts.find((l) => l.name === 'Lower bar');
  const render = await app.call('GET', `/api/overlay-render/${bobLower.publicId}`);
  assert.equal(render.status, 200);
  assert.equal(render.json.published.theme.typography.fontFamily, '"Clan Display", sans-serif');
  assert.deepEqual(render.json.fonts, [{ id: bobFonts[0]._id, family: 'Clan Display' }], 'the revision carries the imported font');
  const fontFile = await download(null, `/api/overlay-fonts/file/${bobFonts[0]._id}`);
  assert.ok(fontFile.bytes.equals(woff2(300, 3)), 'font bytes survive the round trip');

  // Alice is untouched.
  assert.equal((await themesOf(ALICE)).length, 1);
  assert.equal((await layoutsOf(ALICE)).filter((l) => l.name === 'Lower bar').length, 1);
});

test('single layout export: slot view, else the suggested view, else Custom1; name defaults to the file name', async () => {
  const l = await newLayout(CAROL, 'Scoreboard', null);
  let file = await download(CAROL, `/api/overlay-layouts/${l._id}/export?viewKey=LiveStats`);
  assert.equal(file.status, 200);
  assert.equal(decodePack(file.bytes).pack.layouts[0].viewKey, 'LiveStats');
  assert.equal(decodePack((await download(CAROL, `/api/overlay-layouts/${l._id}/export?viewKey=Bogus`)).bytes).pack.layouts[0].viewKey, null);

  const noView = await importFile(CAROL, (await download(CAROL, `/api/overlay-layouts/${l._id}/export`)).bytes);
  assert.equal(noView.status, 201);
  assert.equal(noView.json.theme.name, 'Scoreboard');
  assert.deepEqual(noView.json.theme.slots.map((s) => s.viewKey), ['Custom1']);

  const t = (await app.call('POST', '/api/custom-themes', { user: CAROL, body: {} })).json;
  await app.call('PUT', `/api/custom-themes/${t._id}/slots/Dom`, { user: CAROL, body: { layoutId: l._id } });
  file = await download(CAROL, `/api/overlay-layouts/${l._id}/export?viewKey=LiveStats`);
  assert.equal(decodePack(file.bytes).pack.layouts[0].viewKey, 'Dom', 'its real slot wins over the suggestion');

  const empty = (await app.call('POST', '/api/custom-themes', { user: CAROL, body: {} })).json;
  assert.equal((await download(CAROL, `/api/custom-themes/${empty._id}/export`)).status, 400);
});

test('import: duplicate / unknown views fall back to Custom slots; fonts are reused, skipped or added', async () => {
  await uploadFont(DAVE, 'clan display', woff2(80, 9)); // Dave already has that family
  const doc = draftWithFont('Clan Display');
  const bytes = encodePack({
    name: 'Mixed',
    schemaVersion: schema.SCHEMA_VERSION,
    layouts: [
      { name: 'A', viewKey: 'Lower', matchMode: 'nonsense', assetBase: 'http://insecure.example', draft: doc },
      { name: 'B', viewKey: 'Lower', draft: doc },
      { name: 'C', viewKey: 'NotAView', draft: doc },
    ],
    fonts: [
      { family: 'Clan Display', data: woff2(300, 3) },
      { family: 'Impact', data: woff2(100) },
      { family: 'Broken', data: Buffer.from('not a font at all, just some bytes that are long enough to pass') },
      { family: 'Fresh Face', data: woff2(120) },
    ],
  });
  const done = await importFile(DAVE, bytes);
  assert.equal(done.status, 201);
  assert.deepEqual(done.json.theme.slots.map((s) => [s.name, s.viewKey]).sort(), [['A', 'Lower'], ['B', 'Custom1'], ['C', 'Custom2']]);
  assert.equal(done.json.warnings.length, 2);
  assert.match(done.json.warnings.join(' '), /Impact/);
  assert.match(done.json.warnings.join(' '), /Broken/);
  assert.deepEqual((await fontsOf(DAVE)).map((f) => [f.family, f.size]), [['clan display', 80], ['Fresh Face', 120]], 'the existing font is kept, only the new usable one is added');
  const a = (await layoutsOf(DAVE)).find((l) => l.name === 'A');
  assert.equal(a.defaults.matchMode, 'selectedMatch');
  assert.equal(a.assetBase, '');
});

test('a bad file is a 400 and writes nothing', async () => {
  const good = encodePack({ name: 'Ok', schemaVersion: schema.SCHEMA_VERSION, layouts: [{ name: 'A', viewKey: 'Lower', draft: schema.createEmptyLayout() }], fonts: [] });
  const bad = (layouts) => encodePack({ name: 'Bad', schemaVersion: schema.SCHEMA_VERSION, layouts, fonts: [] });
  const invalidDraft = { ...schema.createEmptyLayout(), elements: [{ type: 'image', id: 'e1', x: 0, y: 0, w: 10, h: 10, src: 'javascript:alert(1)' }] };

  const cases = [
    ['random bytes', Buffer.from('definitely not a theme file')],
    ['header only', Buffer.from('SSTH')],
    ['truncated', good.subarray(0, good.length - 12)],
    ['newer version', Buffer.concat([Buffer.from('SSTH'), Buffer.from([9]), good.subarray(5)])],
    ['not gzip', Buffer.concat([Buffer.from('SSTH'), Buffer.from([1]), Buffer.from('{"layouts":[]}')])],
    ['no layouts', Buffer.concat([Buffer.from('SSTH'), Buffer.from([1]), zlib.gzipSync(JSON.stringify({ v: 1, layouts: [] }))])],
    ['second draft invalid', bad([{ name: 'A', viewKey: 'Lower', draft: schema.createEmptyLayout() }, { name: 'B', viewKey: 'Alerts', draft: invalidDraft }])],
    ['too many for the Custom slots', bad(Array.from({ length: 10 }, (_, i) => ({ name: `L${i}`, viewKey: null, draft: schema.createEmptyLayout() })))],
  ];
  for (const [label, bytes] of cases) {
    const r = await importFile(EVE, bytes);
    assert.equal(r.status, 400, label);
    assert.ok(r.json && typeof r.json.message === 'string' && r.json.message, `${label}: has a message`);
  }
  assert.equal((await importFile(EVE, good, '', 'text/plain')).status, 400, 'wrong content type');
  assert.equal((await importFile(EVE, good, `?name=${'x'.repeat(61)}`)).status, 400, 'name too long');
  assert.equal((await importFile(EVE, Buffer.alloc(13 * 1024 * 1024, 1))).status, 413, 'over the upload limit');
  assert.deepEqual(await layoutsOf(EVE), []);
  assert.deepEqual(await themesOf(EVE), []);

  assert.equal((await importFile(EVE, good)).status, 201, 'and the good file still imports');
});

test('a failure part-way through an import removes what it created', async () => {
  const layoutStore = createMemoryStore();
  const themeStore = createMemoryThemeStore();
  themeStore.setSlot = async () => { throw new Error('boom'); };
  const local = await startDesignerApp({ layoutStore, themeStore, fontStore: createMemoryFontStore() });
  try {
    const bytes = encodePack({ name: 'Ok', schemaVersion: schema.SCHEMA_VERSION, layouts: [{ name: 'A', viewKey: 'Lower', draft: schema.createEmptyLayout() }], fonts: [] });
    const res = await fetch(`${local.base}/api/custom-themes/import`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-test-user': FRANK }, body: bytes });
    assert.equal(res.status, 500);
    assert.deepEqual(await layoutStore.list(FRANK), []);
    assert.deepEqual(await themeStore.list(FRANK), []);
    assert.equal(layoutStore._revisions.length, 0);
  } finally {
    await local.close();
  }
});

test('pack helpers: used families, file names, zip-bomb guard', () => {
  const families = usedFamilies({
    theme: { typography: { fontFamily: 'Inter, sans-serif', headingFamily: "'Big Head'" } },
    elements: [{ style: { fontFamily: '"Clan Display", sans-serif' }, children: [{ style: { fontFamily: { ref: 'theme.typography.fontFamily' } } }] }],
  });
  assert.deepEqual([...families].sort(), ['big head', 'clan display', 'inter', 'sans-serif']);
  assert.equal(packFileName('Finals: pack / 2026!'), 'Finals-pack-2026.sstheme');
  assert.equal(packFileName('////'), 'theme.sstheme');
  const bomb = Buffer.concat([Buffer.from('SSTH'), Buffer.from([1]), zlib.gzipSync(Buffer.alloc(41 * 1024 * 1024, 0x20))]);
  assert.ok(bomb.length < 100 * 1024);
  assert.match(decodePack(bomb).error, /too large/);
});

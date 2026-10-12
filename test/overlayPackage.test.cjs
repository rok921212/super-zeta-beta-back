'use strict';
// Overlay packages (.zip): hand-authored HTML + CSS graphics and exported
// designs, imported as a new design. The decoder on its own, then the real
// routers over the in-memory stores.

const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, strToU8, unzipSync, strFromU8 } = require('fflate');
const { startDesignerApp } = require('./helpers/designerApp.cjs');
const { createMemoryStore } = require('../services/overlayLayoutStore.js');
const { createMemoryThemeStore } = require('../services/customThemeStore.js');
const { decodePackage, encodePackage, packageFileName } = require('../services/overlayPackage.js');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';

/** Enough of a PNG for the server's size check (signature + IHDR). */
function png(width = 8, height = 8, seed = 0) {
  const ihdr = Buffer.alloc(13 + 8);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.from([seed, 0, 0, 0])]);
}
function woff2(size = 64) {
  const buf = Buffer.alloc(size, 7);
  buf.writeUInt32BE(0x774f4632, 0); buf.writeUInt32BE(0x00010000, 4); buf.writeUInt32BE(size, 8);
  return buf;
}
/** { path: string | Buffer } -> zip bytes. */
function zip(files) {
  const out = {};
  for (const [p, v] of Object.entries(files)) out[p] = typeof v === 'string' ? strToU8(v) : new Uint8Array(v);
  return Buffer.from(zipSync(out));
}
const manifest = (extra = {}) => JSON.stringify({ format: 'scoresync-overlay', version: 1, kind: 'html', name: 'Neon Card', canvas: { width: 1280, height: 720 }, ...extra });

// ── decoder ────────────────────────────────────────────────────────────────

test('html package: whole document unpacked, images rewritten, @font-face moved to the font library', () => {
  const out = decodePackage(zip({
    'overlay.json': manifest({ author: { name: 'Kai', url: 'https://kai.example' }, license: 'CC-BY-4.0', tags: ['neon', 'neon', 'a,b'] }),
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"><style>.x{color:red}</style><script>alert(1)</script></head><body><div class="x"><img src="assets/logo.png">{{derived.teams[0].teamName}}</div></body></html>',
    'style.css': '@font-face { font-family: "Bebas Neue"; src: url(fonts/bebas.woff2) format("woff2"); }\n.x { background: url("assets/bg.png"); font-family: "Bebas Neue"; animation: in 1s both; }\n@keyframes in { from { opacity: 0 } }',
    'assets/logo.png': png(8, 8, 1),
    'assets/bg.png': png(8, 8, 2),
    'fonts/bebas.woff2': woff2(),
    'tools/build.js': 'console.log(1)',
  }));
  assert.ok(out.pkg, out.error);
  const { manifest: m, draft, assets, fonts, warnings } = out.pkg;
  assert.equal(m.name, 'Neon Card');
  assert.deepEqual(m.author, { name: 'Kai', url: 'https://kai.example' });
  assert.deepEqual(m.tags, ['neon']);
  assert.equal(draft.stage.width, 1280);
  assert.equal(draft.elements.length, 1);
  const el = draft.elements[0];
  assert.equal(el.type, 'css');
  assert.equal(el.w, 1280);
  assert.doesNotMatch(el.css.html, /script|<body|<link/i);
  assert.match(el.css.html, /src="asset:[a-f0-9]{24}"/);
  assert.match(el.css.css, /url\("asset:[a-f0-9]{24}"\)/);
  assert.match(el.css.css, /@keyframes in/);
  assert.doesNotMatch(el.css.css, /@font-face/);
  assert.match(el.css.css, /\.x\{color:red\}/);
  assert.equal(assets.length, 2);
  assert.deepEqual(fonts.map((f) => f.family), ['Bebas Neue']);
  assert.ok(warnings.some((w) => /Scripts were removed/.test(w)));
  assert.ok(warnings.some((w) => /tools\/build\.js/.test(w)));
});

test('explicit layers, zipped folder, and the css file not counted twice', () => {
  const out = decodePackage(zip({
    'pack/overlay.json': manifest({ layers: [
      { name: 'Top', html: 'top.html', css: 'top.css', x: 10, y: 20, width: 300, height: 100 },
      { name: 'Bottom', html: 'parts/bottom.html' },
    ] }),
    'pack/top.html': '<link rel="stylesheet" href="top.css"><div class="t">TOP</div>',
    'pack/top.css': '.t{color:#fff}',
    'pack/parts/bottom.html': '<img src="../img/a.png">',
    'pack/img/a.png': png(),
  }));
  assert.ok(out.pkg, out.error);
  const [top, bottom] = out.pkg.draft.elements;
  assert.deepEqual([top.name, top.x, top.y, top.w, top.h], ['Top', 10, 20, 300, 100]);
  assert.equal(top.css.css.match(/\.t\{/g).length, 1);
  assert.equal(bottom.w, 1280);
  assert.match(bottom.css.html, /asset:/);
});

test('bad packages are refused with a clear message', () => {
  assert.match(decodePackage(Buffer.from('not a zip at all, definitely not')).error, /not an overlay package/);
  assert.match(decodePackage(zip({ 'index.html': '<p>x</p>' })).error, /no overlay\.json/);
  assert.match(decodePackage(zip({ 'overlay.json': '{"name":"x"}', 'index.html': '<p>x</p>' })).error, /"format"/);
  assert.match(decodePackage(zip({ 'overlay.json': manifest({ version: 9 }), 'index.html': '<p>x</p>' })).error, /newer version/);
  assert.match(decodePackage(zip({ 'overlay.json': manifest() })).error, /index\.html/);
  assert.match(decodePackage(zip({ 'overlay.json': manifest(), '../evil.html': 'x', 'index.html': '<p>x</p>' })).error, /unsafe path/);
  assert.match(decodePackage(zip({ 'overlay.json': manifest(), 'index.html': `<p>${'x'.repeat(70000)}</p>` })).error, /at most/);
});

test('design package round trip keeps the document and its images', () => {
  const draft = { schemaVersion: 1, stage: { width: 1920, height: 1080, background: null }, elements: [{ id: 'img1', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'asset:65f0000000000000000000aa' }] };
  const bytes = encodePackage({
    manifest: { name: 'Mine', author: { name: 'Kai', url: '' }, license: 'CC0', tags: ['x'], canvas: { width: 1920, height: 1080, background: null } },
    draft,
    assets: [{ id: '65f0000000000000000000aa', mime: 'image/png', data: png() }],
    fonts: [{ family: 'Bebas Neue', data: woff2() }],
  });
  const names = Object.keys(unzipSync(new Uint8Array(bytes)));
  assert.ok(names.includes('assets/65f0000000000000000000aa.png'));
  assert.ok(names.includes('fonts/Bebas-Neue.woff2'));
  const meta = JSON.parse(strFromU8(unzipSync(new Uint8Array(bytes))['overlay.json']));
  assert.equal(meta.kind, 'design');
  const out = decodePackage(bytes);
  assert.ok(out.pkg, out.error);
  assert.deepEqual(out.pkg.draft.elements, draft.elements);
  assert.equal(out.pkg.assets[0].id, '65f0000000000000000000aa');
  assert.deepEqual(out.pkg.fonts.map((f) => f.family), ['Bebas Neue']);
  assert.equal(out.pkg.manifest.license, 'CC0');
  assert.equal(packageFileName('Finals: card'), 'Finals-card.zip');
});

// ── routes ─────────────────────────────────────────────────────────────────

let app;
test.before(async () => {
  app = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore() });
});
test.after(() => app.close());

async function post(user, bytes, query = '') {
  const res = await fetch(`${app.base}/api/overlay-layouts/import-package${query}`, {
    method: 'POST', headers: { 'content-type': 'application/zip', ...(user ? { 'x-test-user': user } : {}) }, body: bytes,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json };
}

const htmlPackage = () => zip({
  'overlay.json': manifest({ author: { name: 'Kai' }, license: 'personal', tags: ['card'] }),
  'index.html': '<div class="c"><img src="assets/logo.png"></div>',
  'style.css': '.c{animation:a 1s}@keyframes a{from{opacity:0}}',
  'assets/logo.png': png(16, 16, 9),
});

test('import-package: auth, dry run writes nothing, import creates one design with its image', async () => {
  assert.equal((await post(null, htmlPackage())).status, 401);

  const before = (await app.call('GET', '/api/overlay-layouts', { user: ALICE })).json.length;
  const dry = await post(ALICE, htmlPackage(), '?dryRun=1');
  assert.equal(dry.status, 200);
  assert.equal(dry.json.name, 'Neon Card');
  assert.equal(dry.json.layerCount, 1);
  assert.equal(dry.json.images, 1);
  assert.equal((await app.call('GET', '/api/overlay-layouts', { user: ALICE })).json.length, before);
  assert.equal((await app.call('GET', '/api/overlay-assets', { user: ALICE })).json.items?.length ?? 0, 0);

  const made = await post(ALICE, htmlPackage(), `?name=${encodeURIComponent('My card')}`);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.layout.name, 'My card');
  const full = (await app.call('GET', `/api/overlay-layouts/${made.json.layout._id}`, { user: ALICE })).json;
  const el = full.draft.elements[0];
  assert.equal(el.type, 'css');
  const id = /asset:([a-f0-9]{24})/.exec(el.css.html)[1];
  const img = await fetch(`${app.base}/api/overlay-assets/file/${id}`);
  assert.equal(img.status, 200);
});

test('import-package: banned content is a 400 and nothing is written', async () => {
  const before = (await app.call('GET', '/api/overlay-layouts', { user: BOB })).json.length;
  const bad = zip({ 'overlay.json': manifest(), 'index.html': '<div onclick="steal()">x</div>' });
  const res = await post(BOB, bad);
  assert.equal(res.status, 400);
  assert.ok(res.json.errors.some((e) => /event handlers/.test(e.message)));
  assert.equal((await app.call('GET', '/api/overlay-layouts', { user: BOB })).json.length, before);
  assert.equal((await post(BOB, Buffer.from('nope'))).status, 400);
});

test('export-package -> import on another account: same design, own image copy, credit kept', async () => {
  const made = await post(ALICE, htmlPackage());
  const id = made.json.layout._id;
  assert.equal((await fetch(`${app.base}/api/overlay-layouts/${id}/export-package`, { headers: { 'x-test-user': BOB } })).status, 404);
  const res = await fetch(`${app.base}/api/overlay-layouts/${id}/export-package`, { headers: { 'x-test-user': ALICE } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /Neon-Card\.zip/);
  const bytes = Buffer.from(await res.arrayBuffer());
  const meta = JSON.parse(strFromU8(unzipSync(new Uint8Array(bytes))['overlay.json']));
  assert.equal(meta.author.name, 'Kai');

  const again = await post(BOB, bytes);
  assert.equal(again.status, 201, JSON.stringify(again.json));
  const bobs = (await app.call('GET', `/api/overlay-layouts/${again.json.layout._id}`, { user: BOB })).json;
  const alices = (await app.call('GET', `/api/overlay-layouts/${id}`, { user: ALICE })).json;
  const aliceImg = /asset:([a-f0-9]{24})/.exec(alices.draft.elements[0].css.html)[1];
  const bobImg = /asset:([a-f0-9]{24})/.exec(bobs.draft.elements[0].css.html)[1];
  assert.notEqual(aliceImg, bobImg);
  assert.equal(bobs.draft.elements[0].css.css, alices.draft.elements[0].css.css);
});

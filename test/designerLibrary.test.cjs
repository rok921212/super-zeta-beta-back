'use strict';
// The Designer's library additions: uploaded images (types decided by the
// bytes, SVG safety, limits, "in use" protection), design categories, library
// metadata on a layout, and the schema's version guard. Real routers +
// controllers over the in-memory stores.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { startDesignerApp } = require('./helpers/designerApp.cjs');
const { createMemoryStore } = require('../services/overlayLayoutStore.js');
const { createMemoryThemeStore } = require('../services/customThemeStore.js');
const { imageInfo, svgProblem } = require('../utils/imageInfo.js');
const { MAX_ASSET_BYTES } = require('../controller/overlayAsset.controller.js');
const schema = require('../utils/layoutSchema.generated.cjs');

const ALICE = '65f0000000000000000000a1';
const BOB = '65f0000000000000000000b2';

// ── tiny valid image files ───────────────────────────────────────────────────

function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A real, decodable PNG of the given size (one flat colour; `seed` makes the bytes differ). */
function png(width = 4, height = 3, seed = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + width * 3, seed & 0xff); row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Header-only PNG: enough for the size check, used to claim huge dimensions. */
function pngHeader(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)]);
}
function jpeg(width = 20, height = 10) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), sof, Buffer.from([0xff, 0xd9])]);
}
function webp(width = 16, height = 9) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUInt32LE(10, 16); b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3);
  return b;
}
const svg = (inner = '<rect width="10" height="10"/>', attrs = 'width="40" height="20"') =>
  Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`);

let app;
test.before(async () => { app = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore() }); });
test.after(() => app.close());

async function upload(bytes, { user = ALICE, name = 'pic.png', type = 'application/octet-stream', target = app } = {}) {
  const res = await fetch(`${target.base}/api/overlay-assets?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': type, ...(user ? { 'x-test-user': user } : {}) }, body: bytes,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json };
}

const layoutWith = (assetId, extra = {}) => {
  const d = schema.createEmptyLayout();
  d.elements = [{ id: 'frame', type: 'ellipse', x: 0, y: 0, w: 200, h: 200, imageFill: { src: `asset:${assetId}`, fit: 'cover' }, ...extra }];
  return d;
};

// ── imageInfo ────────────────────────────────────────────────────────────────

test('imageInfo reads type and size from the bytes', () => {
  assert.deepEqual(imageInfo(png(640, 360)), { mime: 'image/png', width: 640, height: 360 });
  assert.deepEqual(imageInfo(jpeg(1920, 1080)), { mime: 'image/jpeg', width: 1920, height: 1080 });
  assert.deepEqual(imageInfo(webp(300, 200)), { mime: 'image/webp', width: 300, height: 200 });
  const s = imageInfo(svg());
  assert.equal(s.mime, 'image/svg+xml');
  assert.deepEqual([s.width, s.height, s.problem], [40, 20, null]);
  assert.deepEqual([imageInfo(svg('<path d="M0 0"/>', 'viewBox="0 0 120 60"')).width, imageInfo(svg('<path d="M0 0"/>', 'viewBox="0 0 120 60"')).height], [120, 60]);
  assert.equal(imageInfo(Buffer.from('GIF89a..............')), null);
  assert.equal(imageInfo(Buffer.from('<html><body>hi</body></html>')), null);
});

test('an SVG that could run code or load something is refused, a plain one is not', () => {
  assert.equal(svgProblem('<svg><rect fill="url(#g)"/><use href="#a"/></svg>'), null);
  assert.equal(svgProblem('<svg><image href="data:image/png;base64,AAAA"/></svg>'), null);
  for (const bad of [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="x()"></svg>',
    '<svg><a href="javascript:alert(1)">x</a></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<svg><image href="https://evil.example/x.png"/></svg>',
    '<svg><use xlink:href="https://evil.example/s.svg#a"/></svg>',
    '<svg><style>@import url(https://evil.example/a.css);</style></svg>',
    '<svg><rect style="fill:url(https://evil.example/p)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>',
  ]) assert.ok(svgProblem(bad), bad);
});

// ── upload / list / serve ────────────────────────────────────────────────────

test('auth is required for the library, not for the file', async () => {
  assert.equal((await app.call('GET', '/api/overlay-assets')).status, 401);
  assert.equal((await upload(png(), { user: null })).status, 401);
  assert.equal((await app.call('GET', '/api/overlay-assets/file/65f0000000000000000000ff')).status, 404);
});

test('upload stores an image once, lists it per owner, and serves it publicly, immutable and sandboxed', async () => {
  const bytes = png(64, 32, 1);
  const up = await upload(bytes, { name: 'Team <Logo>.PNG' });
  assert.equal(up.status, 201);
  assert.deepEqual([up.json.mime, up.json.width, up.json.height, up.json.size], ['image/png', 64, 32, bytes.length]);
  assert.equal(up.json.name, 'Team Logo', 'the name is cleaned and loses its extension');

  const again = await upload(bytes, { name: 'same file' });
  assert.equal(again.status, 200);
  assert.equal(again.json._id, up.json._id, 'the same bytes are the same asset');
  assert.equal(again.json.duplicate, true);

  const list = await app.call('GET', '/api/overlay-assets', { user: ALICE });
  assert.equal(list.json.length, 1);
  assert.equal(list.json[0].data, undefined, 'the list never carries bytes');
  assert.deepEqual((await app.call('GET', '/api/overlay-assets', { user: BOB })).json, []);

  const res = await fetch(`${app.base}/api/overlay-assets/file/${up.json._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(bytes));
});

test('the type comes from the bytes: wrong files, unsafe SVG, oversize and huge images are refused', async () => {
  assert.equal((await upload(Buffer.from('this is not an image at all'), { type: 'image/png' })).status, 400);
  const bad = await upload(svg('<script>alert(1)</script>'), { type: 'image/svg+xml' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.message, /script/);
  assert.equal((await upload(svg(), { type: 'image/svg+xml' })).status, 201);
  const huge = await upload(pngHeader(9000, 100));
  assert.equal(huge.status, 413);
  assert.match(huge.json.message, /9000/);
  const big = Buffer.concat([png(8, 8, 3), Buffer.alloc(MAX_ASSET_BYTES)]);
  assert.equal((await upload(big)).status, 413);
});

test('thumbnail, rename and ownership', async () => {
  const up = await upload(png(100, 100, 7));
  const put = (bytes, user = ALICE) => fetch(`${app.base}/api/overlay-assets/${up.json._id}/thumb`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-test-user': user }, body: bytes });
  assert.equal((await put(svg())).status, 400, 'a thumbnail is never an SVG');
  assert.equal((await put(png(64, 64, 9), BOB)).status, 404);
  assert.equal((await put(png(64, 64, 9))).status, 200);
  const t = await fetch(`${app.base}/api/overlay-assets/thumb/${up.json._id}`);
  assert.ok(Buffer.from(await t.arrayBuffer()).equals(png(64, 64, 9)));

  assert.equal((await app.call('PATCH', `/api/overlay-assets/${up.json._id}`, { user: BOB, body: { name: 'x' } })).status, 404);
  assert.equal((await app.call('PATCH', `/api/overlay-assets/${up.json._id}`, { user: ALICE, body: { name: '  ' } })).status, 400);
  const renamed = await app.call('PATCH', `/api/overlay-assets/${up.json._id}`, { user: ALICE, body: { name: 'Portrait' } });
  assert.equal(renamed.json.name, 'Portrait');
  assert.equal((await app.call('DELETE', `/api/overlay-assets/${up.json._id}`, { user: BOB })).status, 404);
  assert.equal((await app.call('DELETE', `/api/overlay-assets/${up.json._id}`, { user: ALICE })).status, 204);
});

test('an image in use is protected: drafts need force, a published revision always blocks', async () => {
  const up = await upload(png(50, 50, 21));
  const id = up.json._id;
  const made = await app.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'Portrait card', draft: layoutWith(id) } });
  assert.equal(made.status, 201);
  assert.deepEqual(made.json.stage, { width: 1920, height: 1080 });

  const refused = await app.call('DELETE', `/api/overlay-assets/${id}`, { user: ALICE });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, 'ASSET_IN_USE');
  assert.deepEqual(refused.json.usedBy, { drafts: 1, published: 0 });

  assert.equal((await app.call('POST', `/api/overlay-layouts/${made.json._id}/publish`, { user: ALICE, body: {} })).status, 200);
  const onAir = await app.call('DELETE', `/api/overlay-assets/${id}?force=1`, { user: ALICE });
  assert.equal(onAir.status, 409);
  assert.equal(onAir.json.code, 'ASSET_PUBLISHED');

  // The draft drops the image: the published revision still holds it.
  const saved = await app.call('PUT', `/api/overlay-layouts/${made.json._id}`, { user: ALICE, body: { expectedRev: made.json.draftRev, draft: schema.createEmptyLayout() } });
  assert.equal(saved.status, 200);
  assert.equal((await app.call('DELETE', `/api/overlay-assets/${id}`, { user: ALICE })).json.code, 'ASSET_PUBLISHED');
});

test('publish refuses a draft that points at an image the owner does not have', async () => {
  const made = await app.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'Ghost', draft: layoutWith('65f0000000000000000000ee') } });
  const pub = await app.call('POST', `/api/overlay-layouts/${made.json._id}/publish`, { user: ALICE, body: {} });
  assert.equal(pub.status, 400);
  assert.match(pub.json.errors[0].message, /no longer in your library/);
  // Someone else's image is "not there" too.
  const bobs = await upload(png(30, 30, 44), { user: BOB });
  const other = await app.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'Borrowed', draft: layoutWith(bobs.json._id) } });
  assert.equal((await app.call('POST', `/api/overlay-layouts/${other.json._id}/publish`, { user: ALICE, body: {} })).status, 400);
});

test('without the overlay database the image and category routes answer 503 and store nothing', async () => {
  const off = await startDesignerApp({ layoutStore: createMemoryStore(), themeStore: createMemoryThemeStore(), overlayAvailable: () => false });
  try {
    assert.equal((await upload(png(), { target: off })).status, 503);
    assert.equal((await off.call('GET', '/api/overlay-assets', { user: ALICE })).status, 503);
    assert.equal((await off.call('POST', '/api/overlay-categories', { user: ALICE, body: { name: 'Finals' } })).status, 503);
  } finally { await off.close(); }
});

// ── categories + library metadata ────────────────────────────────────────────

test('categories: unique per owner, never a built-in name, delete uncategorises its designs', async () => {
  assert.equal((await app.call('POST', '/api/overlay-categories', { body: { name: 'Finals' } })).status, 401);
  const made = await app.call('POST', '/api/overlay-categories', { user: ALICE, body: { name: '  Grand   Finals ' } });
  assert.equal(made.status, 201);
  assert.equal(made.json.name, 'Grand Finals');
  assert.equal((await app.call('POST', '/api/overlay-categories', { user: ALICE, body: { name: 'grand finals' } })).status, 409);
  assert.equal((await app.call('POST', '/api/overlay-categories', { user: ALICE, body: { name: 'Kill Feed' } })).status, 409, 'built-in name');
  assert.equal((await app.call('POST', '/api/overlay-categories', { user: ALICE, body: { name: '' } })).status, 400);
  assert.equal((await app.call('POST', '/api/overlay-categories', { user: BOB, body: { name: 'Grand Finals' } })).status, 201, 'another owner may reuse the name');
  assert.equal((await app.call('PATCH', `/api/overlay-categories/${made.json._id}`, { user: BOB, body: { name: 'Mine' } })).status, 404);
  assert.equal((await app.call('PATCH', `/api/overlay-categories/${made.json._id}`, { user: ALICE, body: { name: 'Finals' } })).json.name, 'Finals');

  const layout = await app.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'Winner card' } });
  const id = layout.json._id;
  const filed = await app.call('PATCH', `/api/overlay-layouts/${id}/meta`, { user: ALICE, body: { categoryId: made.json._id } });
  assert.equal(filed.json.categoryId, made.json._id);
  const del = await app.call('DELETE', `/api/overlay-categories/${made.json._id}`, { user: ALICE });
  assert.deepEqual(del.json, { removed: true, uncategorised: 1 });
  const after = (await app.call('GET', '/api/overlay-layouts', { user: ALICE })).json.find((l) => l._id === id);
  assert.equal(after.categoryId, null, 'the design is still there, just uncategorised');
});

test('library metadata: validated, owner-only, never moves the draft revision, kept by duplicate', async () => {
  const layout = await app.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'R2R Lower Third V1' } });
  const id = layout.json._id;
  const url = `/api/overlay-layouts/${id}/meta`;
  assert.equal((await app.call('PATCH', url, { user: BOB, body: { name: 'stolen' } })).status, 404);
  assert.equal((await app.call('PATCH', url, { user: ALICE, body: {} })).status, 400);
  assert.equal((await app.call('PATCH', url, { user: ALICE, body: { categoryId: 'no-such-category' } })).status, 400);
  assert.equal((await app.call('PATCH', url, { user: ALICE, body: { categoryId: '65f0000000000000000000cc' } })).status, 400, 'a category id that is not the caller\'s');
  assert.equal((await app.call('PATCH', url, { user: ALICE, body: { tags: ['a,b'] } })).status, 400);

  const ok = await app.call('PATCH', url, { user: ALICE, body: { name: 'R2R Lower Third V2', description: 'Blue variant', categoryId: 'lower-thirds', tags: ['R2R', 'r2r', ' finals '], archived: true, isTemplate: true } });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.name, ok.json.description, ok.json.categoryId, ok.json.isTemplate], ['R2R Lower Third V2', 'Blue variant', 'lower-thirds', true]);
  assert.deepEqual(ok.json.tags, ['R2R', 'finals'], 'trimmed and de-duplicated ignoring case');
  assert.ok(ok.json.archivedAt);
  assert.equal(ok.json.draftRev, layout.json.draftRev, 'filing a design is not an edit');

  const restored = await app.call('PATCH', url, { user: ALICE, body: { archived: false } });
  assert.equal(restored.json.archivedAt, null);

  const copy = await app.call('POST', `/api/overlay-layouts/${id}/duplicate`, { user: ALICE });
  assert.deepEqual([copy.json.categoryId, copy.json.tags, copy.json.isTemplate, copy.json.archivedAt], ['lower-thirds', ['R2R', 'finals'], false, null]);

  // A locked design can still be filed away.
  await app.call('POST', `/api/overlay-layouts/${id}/lock`, { user: ALICE });
  assert.equal((await app.call('PATCH', url, { user: ALICE, body: { categoryId: null } })).status, 200);
});

// ── schema ───────────────────────────────────────────────────────────────────

test('a document from a newer schema version is refused, never reinterpreted', async () => {
  const future = { ...schema.createEmptyLayout(), schemaVersion: schema.SCHEMA_VERSION + 1 };
  assert.equal(schema.normalizeLayout(future).schemaVersion, schema.SCHEMA_VERSION + 1, 'not stamped down');
  const result = schema.validateLayout(schema.normalizeLayout(future));
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /newer version/);
  const res = await app.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'From the future', draft: future } });
  assert.equal(res.status, 400);
});

test('schema additions: frames, asset references, text styles, saved animations', () => {
  const ok = (el, extra = {}) => schema.validateLayout(schema.normalizeLayout({ ...schema.createEmptyLayout(), ...extra, elements: el ? [el] : [] }));
  const base = { id: 'a', x: 0, y: 0, w: 100, h: 100 };
  assert.ok(schema.isSafeUrl('asset:65f0000000000000000000a1'));
  assert.equal(schema.isSafeUrl('asset:../../etc'), false);
  assert.equal(schema.isSafeUrl('data:image/png;base64,AAAA'), false, 'never base64 inside a document');
  assert.ok(ok({ ...base, type: 'polygon', points: [[0, 0], [100, 0], [50, 100]], imageFill: { src: 'asset:65f0000000000000000000a1', fit: 'cover', scale: 1.5, posX: 0.2, posY: 1 } }).ok);
  assert.equal(ok({ ...base, type: 'text', imageFill: { src: '/a.png' } }).ok, false, 'only shapes hold a picture');
  assert.equal(ok({ ...base, type: 'rect', imageFill: { src: 'javascript:alert(1)' } }).ok, false);
  assert.equal(ok({ ...base, type: 'rect', imageFill: { fit: 'stretch' } }).ok, false);
  assert.equal(ok({ ...base, type: 'rect', imageFill: { scale: 50 } }).ok, false);
  assert.ok(ok({ ...base, type: 'text', text: 'Hi', style: { textStroke: '#000000', textStrokeWidth: 2, textFit: 'shrink', textGradient: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: 'rgba(0,0,255,0.5)' }] } } }).ok);
  assert.equal(ok({ ...base, type: 'text', style: { textGradient: { type: 'conic', stops: [] } } }).ok, false);
  assert.ok(ok(null, { stage: { width: 1080, height: 1920, background: null, backgroundImage: 'asset:65f0000000000000000000a1' } }).ok);
  assert.equal(ok(null, { stage: { width: 1080, height: 1920, background: null, backgroundImage: 'http://x/y.png' } }).ok, false);
  const clip = { id: 'c1', name: 'Imported', trigger: { type: 'enter' }, duration: 500, tracks: [{ prop: 'opacity', keyframes: [{ t: 0, value: 0 }, { t: 500, value: 1 }] }] };
  assert.ok(ok(null, { editor: { safeArea: true, margin: 40, animPresets: [clip] } }).ok);
  assert.equal(ok(null, { editor: { animPresets: [{ ...clip, tracks: [{ prop: 'zIndex', keyframes: [{ t: 0, value: 1 }] }] }] } }).ok, false);
  assert.deepEqual(
    schema.extractAssetIds({ ...schema.createEmptyLayout(), stage: { backgroundImage: 'asset:aaaaaaaaaaaaaaaaaaaaaaaa' }, brand: { logo: 'asset:bbbbbbbbbbbbbbbbbbbbbbbb' },
      elements: [{ type: 'group', children: [{ type: 'image', src: 'asset:cccccccccccccccccccccccc', fallbackSrc: '/def_logo.avif' }, { type: 'rect', imageFill: { src: 'asset:aaaaaaaaaaaaaaaaaaaaaaaa' } }] }] }).sort(),
    ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc']
  );
});

// ── theme files carry uploaded images ────────────────────────────────────────

test('a theme file carries the uploaded images a design uses; the importer gets its own copies', async () => {
  const bytes = png(80, 80, 99);
  const up = await upload(bytes, { name: 'hexagon logo' });
  const made = await app.call('POST', '/api/overlay-layouts', { user: ALICE, body: { name: 'Logo card', draft: layoutWith(up.json._id) } });
  const file = await fetch(`${app.base}/api/overlay-layouts/${made.json._id}/export`, { headers: { 'x-test-user': ALICE } });
  assert.equal(file.status, 200);
  const pack = Buffer.from(await file.arrayBuffer());

  const dry = await fetch(`${app.base}/api/custom-themes/import?dryRun=1`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-test-user': BOB }, body: pack });
  assert.equal((await dry.json()).images, 1);
  const before = (await app.call('GET', '/api/overlay-assets', { user: BOB })).json.length;
  const imp = await fetch(`${app.base}/api/custom-themes/import?name=Imported`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-test-user': BOB }, body: pack });
  assert.equal(imp.status, 201);
  const theme = (await imp.json()).theme;

  const bobAssets = (await app.call('GET', '/api/overlay-assets', { user: BOB })).json;
  assert.equal(bobAssets.length, before + 1);
  const mine = bobAssets.find((a) => a.name === 'hexagon logo');
  assert.ok(mine && mine._id !== up.json._id, 'a new asset id in the importing account');
  const layout = await app.call('GET', `/api/overlay-layouts/${theme.slots[0].layoutId}`, { user: BOB });
  assert.equal(layout.json.draft.elements[0].imageFill.src, `asset:${mine._id}`, 'the draft points at the copy');
  const served = await fetch(`${app.base}/api/overlay-assets/file/${mine._id}`);
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(bytes));
});

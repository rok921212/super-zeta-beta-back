'use strict';
// Code layers (element type `code`): the shared schema copy, the server-side
// gate (CODE_LAYERS_ENABLED + publish needs compiled output) and .ssx files
// inside overlay packages.

const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, strToU8 } = require('fflate');
const schema = require('../utils/layoutSchema.generated.cjs');
const { checkDraft } = require('../controller/overlayLayout.controller.js');
const { decodePackage } = require('../services/overlayPackage.js');

const codeEl = (code, extra = {}) => ({ id: 'code_1', type: 'code', name: 'Board', x: 0, y: 0, w: 800, h: 200, code, ...extra });
const draftWith = (...elements) => ({ ...schema.createEmptyLayout(), elements });
const compiled = { source: '<script lang="js">ss.on("data", () => {})</script>', lang: 'js', styleLang: 'css', compiledJs: '"use strict";ss.on("data", () => {})', compilerVersion: 1 };

function png(seed = 0) {
  const ihdr = Buffer.alloc(21);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(8, 8); ihdr.writeUInt32BE(8, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.from([seed, 0, 0, 0])]);
}
function zip(files) {
  const out = {};
  for (const [p, v] of Object.entries(files)) out[p] = typeof v === 'string' ? strToU8(v) : new Uint8Array(v);
  return Buffer.from(zipSync(out));
}
const manifest = (extra = {}) => JSON.stringify({ format: 'scoresync-overlay', version: 1, kind: 'html', name: 'Code Pack', canvas: { width: 1920, height: 1080 }, ...extra });

test('schema copy knows the code layer', () => {
  assert.ok(schema.ELEMENT_TYPES.includes('code'));
  assert.equal(schema.validateLayout(draftWith(codeEl(compiled))).ok, true);
  assert.equal(schema.validateLayout(draftWith(codeEl({ source: 'x', lang: 'cobol' }))).ok, false);
});

test('saving keeps an uncompiled code layer; publishing refuses it', () => {
  const raw = draftWith(codeEl({ source: '<script lang="tsx">export default () => null</script>', lang: 'tsx' }));
  assert.ok(checkDraft(raw).doc);
  const pub = checkDraft(raw, { publish: true });
  assert.ok(pub.errors);
  assert.match(pub.errors[0].message, /not compiled/);
  assert.ok(checkDraft(draftWith(codeEl(compiled)), { publish: true }).doc);
  // Inside a group too.
  const grouped = draftWith({ id: 'g', type: 'group', x: 0, y: 0, w: 800, h: 200, children: [codeEl({ source: 'x', lang: 'js' })] });
  assert.ok(checkDraft(grouped, { publish: true }).errors);
});

test('CODE_LAYERS_ENABLED=false refuses any draft holding a code layer', () => {
  const before = process.env.CODE_LAYERS_ENABLED;
  process.env.CODE_LAYERS_ENABLED = 'false';
  try {
    const r = checkDraft(draftWith(codeEl(compiled)));
    assert.ok(r.errors);
    assert.match(r.errors[0].message, /turned off/);
    assert.ok(checkDraft(draftWith()).doc); // designs without code are untouched
  } finally {
    if (before === undefined) delete process.env.CODE_LAYERS_ENABLED; else process.env.CODE_LAYERS_ENABLED = before;
  }
});

test('package: an .ssx layer becomes a code layer with its images rewritten', () => {
  const ssx = `<!-- scoresync-component v1 -->
<overlay name="Board" width="1280" height="300" />
<template><img src="assets/logo.png"></template>
<style>.a { background: url(assets/bg.png); }</style>
<script lang="tsx">export default function Board() { return <div className="a" />; }</script>`;
  const out = decodePackage(zip({
    'overlay.json': manifest({ layers: [{ name: 'Board', code: 'layers/board.ssx', x: 10, y: 20 }] }),
    'layers/board.ssx': ssx,
    'layers/assets/logo.png': png(1),
    'layers/assets/bg.png': png(2),
    'extra/tool.js': 'console.log(1)',
  }));
  assert.ok(out.pkg, out.error);
  const el = out.pkg.draft.elements[0];
  assert.equal(el.type, 'code');
  assert.deepEqual([el.x, el.y, el.w, el.h], [10, 20, 1280, 300]);
  assert.equal(el.code.lang, 'tsx');
  assert.match(el.code.source, /src="asset:[a-f0-9]{24}"/);
  assert.match(el.code.source, /url\("asset:[a-f0-9]{24}"\)/);
  assert.equal(out.pkg.assets.length, 2);
  assert.ok(out.pkg.warnings.some((w) => /extra\/tool\.js.*\.ssx/.test(w)));
  assert.ok(checkDraft(out.pkg.draft).doc, 'the imported draft saves');
});

test('package: index.ssx alone is the default layer; a non-.ssx code file is refused', () => {
  const ok = decodePackage(zip({ 'overlay.json': manifest(), 'index.ssx': '<template><b>{{match.matchNo}}</b></template><script lang="js">1</script>' }));
  assert.ok(ok.pkg, ok.error);
  assert.equal(ok.pkg.draft.elements[0].type, 'code');
  assert.equal(ok.pkg.draft.elements[0].code.lang, 'js');
  assert.equal(ok.pkg.draft.elements[0].w, 1920);
  const bad = decodePackage(zip({ 'overlay.json': manifest({ layers: [{ code: 'board.js' }] }), 'board.js': 'x' }));
  assert.match(bad.error, /must be an \.ssx file/);
});

'use strict';
// Cloudinary delivery transforms on the wire (utils/cdnImage.js via wireNormalize).

const test = require('node:test');
const assert = require('node:assert/strict');
const { cdnImageUrl, CDN_TRANSFORM } = require('../utils/cdnImage.js');
const { normalizeWireValue } = require('../utils/wireNormalize.js');
const { encodeMsgpack } = require('../utils/msgpackCodec.js');
const { decode } = require('@msgpack/msgpack');

process.env.CDN_IMAGE_TRANSFORMS = 'true';

const PLAIN = 'https://res.cloudinary.com/demo/image/upload/v1735718663/logos/team.png';

test('a plain Cloudinary image gets the transforms, once', () => {
  const out = cdnImageUrl(PLAIN);
  assert.equal(out, `https://res.cloudinary.com/demo/image/upload/${CDN_TRANSFORM}/v1735718663/logos/team.png`);
  assert.equal(cdnImageUrl(out), out, 'idempotent');
  assert.equal(cdnImageUrl('https://res.cloudinary.com/demo/image/upload/team.png'), `https://res.cloudinary.com/demo/image/upload/${CDN_TRANSFORM}/team.png`);
});

test('everything else is left alone', () => {
  for (const v of [
    'https://res.cloudinary.com/demo/image/upload/w_200,h_200/v1/a.png', // already transformed
    'https://res.cloudinary.com/demo/video/upload/v1/a.mp4',
    'https://res.cloudinary.com/demo/image/fetch/https://x.com/a.png',
    'https://example.com/image/upload/v1/a.png',
    '/def_logo.avif', 'TEAM', '', 'data:image/png;base64,AAAA',
  ]) assert.equal(cdnImageUrl(v), v, v);
  assert.equal(cdnImageUrl(null), null);
  assert.equal(cdnImageUrl(42), 42);
});

test('off unless switched on', () => {
  delete process.env.CDN_IMAGE_TRANSFORMS;
  try { assert.equal(cdnImageUrl(PLAIN), PLAIN); } finally { process.env.CDN_IMAGE_TRANSFORMS = 'true'; }
});

test('wire payloads carry the transformed URLs, other fields unchanged', () => {
  const doc = { teamName: 'Alpha', teamLogo: PLAIN, players: [{ playerName: 'p1', picUrl: PLAIN, kills: 3 }] };
  const norm = normalizeWireValue(doc);
  assert.equal(norm.teamName, 'Alpha');
  assert.equal(norm.players[0].kills, 3);
  assert.ok(norm.teamLogo.includes(CDN_TRANSFORM));
  assert.ok(norm.players[0].picUrl.includes(CDN_TRANSFORM));
  const round = decode(encodeMsgpack(doc));
  assert.ok(round.players[0].picUrl.includes(CDN_TRANSFORM));
});

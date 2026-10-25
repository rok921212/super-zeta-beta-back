const test = require('node:test');
const assert = require('node:assert/strict');
// config.js refuses to load without these (same as homeShowcase.test.cjs).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { realPlayerPhoto, BUILT_IN } = require('../services/teamDefaults');

test('realPlayerPhoto treats empty and default placeholders as missing', () => {
  assert.equal(realPlayerPhoto(''), '');
  assert.equal(realPlayerPhoto(undefined), '');
  assert.equal(realPlayerPhoto('  '), '');
  assert.equal(realPlayerPhoto(BUILT_IN.defaultPlayerPhoto), '');
  assert.equal(realPlayerPhoto(' https://res.cloudinary.com/x/image/upload/p.png '), 'https://res.cloudinary.com/x/image/upload/p.png');
});

test('a real roster photo beats a stored placeholder; a real per-match photo still wins', () => {
  const pick = (matchPic, rosterPic) =>
    realPlayerPhoto(matchPic) || realPlayerPhoto(rosterPic) || matchPic?.trim() || rosterPic?.trim() || '';
  assert.equal(pick('/def_char.avif', 'https://cdn/new.png'), 'https://cdn/new.png');
  assert.equal(pick('https://cdn/override.png', 'https://cdn/new.png'), 'https://cdn/override.png');
  assert.equal(pick('/def_char.avif', ''), '/def_char.avif');
});

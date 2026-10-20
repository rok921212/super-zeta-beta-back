'use strict';
// Smash Point input (utils/smashPoint.js) and the match schema field.

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { normalizeSmashPoint } = require('../utils/smashPoint.js');
const Match = require('../models/match.model.js');

test('a filled value is kept, trimmed; enabled needs a value', () => {
  assert.deepEqual(normalizeSmashPoint({ enabled: true, value: '  80 PTS ', displayText: ' Smash ' }).value, { enabled: true, value: '80 PTS', displayText: 'Smash' });
  assert.deepEqual(normalizeSmashPoint({ enabled: true, value: '   ' }).value, { enabled: false, value: '', displayText: '' }, 'blank = off');
  assert.deepEqual(normalizeSmashPoint({ enabled: false, value: '80' }).value, { enabled: false, value: '80', displayText: '' }, 'switched off keeps the value');
  assert.deepEqual(normalizeSmashPoint({ enabled: true, value: 80 }).value.value, '80', 'a number is fine');
});

test('clearing and bad input', () => {
  assert.deepEqual(normalizeSmashPoint(null).value, { enabled: false, value: '', displayText: '' });
  assert.match(normalizeSmashPoint('80').error, /object/);
  assert.match(normalizeSmashPoint({ value: { a: 1 } }).error, /text/);
  assert.match(normalizeSmashPoint({ value: 'x'.repeat(41) }).error, /40/);
  assert.match(normalizeSmashPoint({ value: '1', displayText: 'y'.repeat(25) }).error, /24/);
});

test('the match schema stores it and old matches have none', () => {
  const id = () => new mongoose.Types.ObjectId();
  const base = { tournamentId: id(), roundId: id(), matchNo: 1, time: '1:00 PM', map: 'Erangel', userId: id() };
  const old = new Match(base);
  assert.equal(old.toObject().smashPoint, undefined, 'existing matches are unchanged');
  const m = new Match({ ...base, smashPoint: { enabled: true, value: '80' } });
  assert.deepEqual(m.toObject().smashPoint, { enabled: true, value: '80', displayText: '' });
  assert.equal(m.validateSync(), undefined);
  assert.ok(new Match({ ...base, smashPoint: { value: 'x'.repeat(41) } }).validateSync(), 'too long fails validation');
});

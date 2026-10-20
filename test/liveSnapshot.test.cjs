// Full roster snapshots from the desktop relay (utils/liveSnapshot.js): a
// same-game snapshot keeps the dead players it lacks, a new game replaces.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFullSnapshot, isSameGame } = require('../utils/liveSnapshot');

const keyOf = (p) => (p.uId != null ? String(p.uId) : null);
const p = (uId, killNum, dead = false) => ({ uId, killNum, liveState: dead ? 5 : 0, bHasDied: dead });
const mapOf = (list) => new Map(list.map((x) => [String(x.uId), x]));

test('relay restart mid-game: dead players missing from the snapshot are kept', () => {
  const prev = mapOf([p(1, 3), p(2, 0, true), p(3, 1, true), p(4, 2)]);
  // The restarted relay only knows the living.
  const { players, sameGame, keptDead } = applyFullSnapshot(prev, [p(1, 4), p(4, 2)], keyOf);
  assert.equal(sameGame, true);
  assert.equal(keptDead, 2);
  assert.equal(players.get('2').liveState, 5);
  assert.equal(players.get('3').bHasDied, true);
  assert.equal(players.get('1').killNum, 4, 'living players come from the snapshot');
});

test('alive players missing from a same-game snapshot are not kept', () => {
  const prev = mapOf([p(1, 3), p(2, 0)]);
  const { players } = applyFullSnapshot(prev, [p(1, 3)], keyOf);
  assert.equal(players.has('2'), false);
});

test('a new game replaces the map: kills down, dead alive again, or no player in common', () => {
  const prev = mapOf([p(1, 3), p(2, 0, true)]);
  assert.equal(isSameGame(prev, [p(1, 0)], keyOf), false);
  assert.equal(isSameGame(prev, [p(1, 3), p(2, 0, false)], keyOf), false);
  assert.equal(isSameGame(prev, [p(9, 0)], keyOf), false);
  const { players, keptDead } = applyFullSnapshot(prev, [p(1, 0), p(5, 0)], keyOf);
  assert.equal(keptDead, 0);
  assert.equal(players.has('2'), false, 'the previous game\'s dead do not leak into the next');
});

test('an empty previous map is not the same game', () => {
  assert.equal(isSameGame(new Map(), [p(1, 0)], keyOf), false);
});

// keyframeHashOf (utils/matchTeamDiff.js): the periodic full-roster keyframe
// is skipped when its hash is unchanged, so per-tick noise must not change it
// while a real change (kill, health, knock) must.
const test = require('node:test');
const assert = require('node:assert/strict');
const { keyframeHashOf } = require('../utils/matchTeamDiff');

const roster = (over = {}) => [{
  teamId: 't1', placePoints: 0,
  players: [{ uId: 'p1', killNum: 1, health: 100, liveState: 0, survivalTime: 120, marchDistance: 300, location: { x: 1, y: 2, z: 3 }, ...over }],
}];

test('per-tick fields alone do not change the stable hash', () => {
  const a = keyframeHashOf(roster());
  const b = keyframeHashOf(roster({ survivalTime: 122, marchDistance: 310, location: { x: 5, y: 6, z: 7 } }));
  assert.equal(a, b);
});

test('a real change does', () => {
  const a = keyframeHashOf(roster());
  assert.notEqual(a, keyframeHashOf(roster({ killNum: 2 })));
  assert.notEqual(a, keyframeHashOf(roster({ health: 40 })));
  assert.notEqual(a, keyframeHashOf(roster({ liveState: 4 })));
});

test('stable=false hashes every field (kill switch)', () => {
  assert.notEqual(keyframeHashOf(roster(), false), keyframeHashOf(roster({ survivalTime: 122 }), false));
});

test('a dead player keeps survivalTime in the hash', () => {
  assert.notEqual(
    keyframeHashOf(roster({ bHasDied: true, survivalTime: 300 })),
    keyframeHashOf(roster({ bHasDied: true, survivalTime: 301 }))
  );
});

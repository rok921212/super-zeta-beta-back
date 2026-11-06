// Manual corrections reach the live match (utils/liveManualEdit.js): the live
// copy is what overlays are served and what SAVE DATA writes to Mongo.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  editLiveTeam, editLivePlayer, editLiveTeamPlayers, addLivePlayers, removeLivePlayers,
} = require('../utils/liveManualEdit');

const player = (uId, killNum, extra = {}) => ({ uId, killNum, bHasDied: false, ...extra });
const teams = () => [
  { _id: 't1', teamId: 'g1', placePoints: 2, players: [player('1', 5, { _id: 'p1' }), player('2', 1)] },
  { _id: 't2', teamId: 'g2', placePoints: 0, players: [player('3', 0)] },
];

test('points: only the edited team changes, found by _id or teamId', () => {
  const byId = editLiveTeam(teams(), 't1', (t) => ({ ...t, placePoints: 10, placePointsLocked: true }));
  assert.equal(byId[0].placePoints, 10);
  assert.equal(byId[0].placePointsLocked, true);
  assert.equal(byId[1].placePoints, 0);
  assert.equal(editLiveTeam(teams(), 'g2', (t) => ({ ...t, placePoints: 7 }))[1].placePoints, 7);
});

test('a kill adjustment applies to the live count, which can be ahead of Mongo', () => {
  // Mongo holds 0 (autosave off), live holds 5: +1 must give 6, not Mongo's 1.
  const next = editLivePlayer(teams(), 't1', { playerId: 'p1', uId: '1' }, { killNumChange: 1 });
  assert.equal(next[0].players[0].killNum, 6);
});

test('a kill adjustment never goes below zero', () => {
  const next = editLivePlayer(teams(), 't1', { uId: '2' }, { killNumChange: -5 });
  assert.equal(next[0].players[1].killNum, 0);
});

test('a live player without _id is found by uId', () => {
  const next = editLivePlayer(teams(), 't1', { playerId: 'other', uId: '2' }, { fields: { bHasDied: true } });
  assert.equal(next[0].players[1].bHasDied, true);
  assert.equal(next[0].players[0].bHasDied, false);
});

test('fields left out of the edit keep their live values', () => {
  const next = editLivePlayer(teams(), 't1', { uId: '1' }, { fields: { bHasDied: true } });
  assert.equal(next[0].players[0].killNum, 5);
});

test('the live object is not changed in place: the next delta diffs against it', () => {
  const before = teams();
  const next = editLivePlayer(before, 't1', { uId: '1' }, { killNumChange: 1 });
  assert.equal(before[0].players[0].killNum, 5);
  assert.notEqual(next[0], before[0]);
  assert.equal(next[1], before[1], 'teams not edited are shared');
});

test('whole-team edit sets every player of that team only', () => {
  const next = editLiveTeamPlayers(teams(), 't1', { bHasDied: true });
  assert.deepEqual(next[0].players.map((p) => p.bHasDied), [true, true]);
  assert.equal(next[1].players[0].bHasDied, false);
});

test('roster add skips players already there, remove matches on _id or uId', () => {
  const added = addLivePlayers(teams(), 't2', [player('3', 0), player('9', 0, { _id: 'p9' })]);
  assert.deepEqual(added[1].players.map((p) => p.uId), ['3', '9']);
  const removed = removeLivePlayers(teams(), 't1', [{ _id: 'p1' }, { uId: '2' }]);
  assert.equal(removed[0].players.length, 0);
});

test('an unknown team changes nothing and a team without players is safe', () => {
  assert.deepEqual(editLivePlayer(teams(), 'nope', { uId: '1' }, { killNumChange: 1 }), teams());
  assert.deepEqual(editLiveTeamPlayers([{ _id: 't1' }], 't1', { bHasDied: true })[0].players, []);
});

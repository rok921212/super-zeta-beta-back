const test = require('node:test');
const assert = require('node:assert/strict');
const { planCsvImport } = require('../utils/matchDataCsvImport');

const player = (n, extra = {}) => ({ _id: `p${n}`, uId: `10000${n}`, playerName: `P${n}`, killNum: 0, ...extra });
const makeTeams = () => ([
  { _id: 'mA', teamId: 'tA', teamName: 'Alpha Squad', teamTag: 'ALP', slot: 3, players: [player(1), player(2)] },
  { _id: 'mB', teamId: 'tB', teamName: 'Bravo', teamTag: 'BRV', slot: 4, players: [player(3), player(4, { killNum: 5 }), player(5), player(6)] },
]);
const row = (teamTag, playerUid, playerName = 'New', kills = '2', teamName = '') => ({ teamName, teamTag, playerName, playerUid, kills });

test('updates an existing player by UID', () => {
  const plan = planCsvImport(makeTeams(), [row('ALP', '100001', 'Renamed', '7')]);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(
    { sub: plan.updates[0].playerSubId, name: plan.updates[0].playerName, kills: plan.updates[0].kills },
    { sub: 'p1', name: 'Renamed', kills: 7 }
  );
  assert.equal(plan.adds.length, 0);
});

test('blank kills / name leave the existing values alone', () => {
  const plan = planCsvImport(makeTeams(), [row('ALP', '100001', '', '')]);
  assert.equal(plan.updates[0].kills, null);
  assert.equal(plan.updates[0].playerName, null);
});

test('updates where the UID sits even when the row names another team', () => {
  const plan = planCsvImport(makeTeams(), [row('BRV', '100001')]);
  assert.equal(plan.updates[0].teamSubId, 'mA');
  assert.equal(plan.notes.length, 1);
});

test('adds a new player to a free seat, matching the tag loosely', () => {
  const plan = planCsvImport(makeTeams(), [row(' alp ', '200001', 'Fresh', '3')]);
  assert.equal(plan.adds.length, 1);
  assert.equal(plan.adds[0].teamSubId, 'mA');
  assert.equal(plan.adds[0].seated, true);
  assert.equal(plan.adds[0].replacePlayerSubId, null);
  assert.equal(plan.adds[0].kills, 3);
});

test('falls back to the team name when the tag does not match', () => {
  const plan = planCsvImport(makeTeams(), [row('???', '200001', 'Fresh', '1', 'alphasquad')]);
  assert.equal(plan.adds[0].teamSubId, 'mA');
});

test('full team: new player replaces an unlisted, zero-stat player first', () => {
  const plan = planCsvImport(makeTeams(), [row('BRV', '200001'), row('BRV', '100003')]);
  // 100003 (p3) is listed, p4 has kills -> p5 goes first.
  assert.equal(plan.adds[0].replacePlayerSubId, 'p5');
  assert.equal(plan.adds[0].seated, true);
});

test('full team with every seat listed in the CSV: new player skipped', () => {
  const plan = planCsvImport(makeTeams(), [
    row('BRV', '100003'), row('BRV', '100004'), row('BRV', '100005'), row('BRV', '100006'),
    row('BRV', '200001'),
  ]);
  assert.equal(plan.adds.length, 1);
  assert.equal(plan.adds[0].seated, false);
  assert.equal(plan.skipped[0].reason, 'team_full');
});

test('more new players than seats: fills, then replaces, then skips', () => {
  const plan = planCsvImport(makeTeams(), [
    row('ALP', '200001'), row('ALP', '200002'), row('ALP', '200003'),
    row('ALP', '200004'), row('ALP', '200005'),
  ]);
  assert.deepEqual(plan.adds.map(a => a.seated), [true, true, true, true, false]);
  assert.deepEqual(plan.adds.map(a => a.replacePlayerSubId), [null, null, 'p1', 'p2', null]);
});

test('team not in the match is skipped', () => {
  const plan = planCsvImport(makeTeams(), [row('ZZZ', '200001')]);
  assert.equal(plan.adds.length, 0);
  assert.equal(plan.skipped[0].reason, 'team_not_in_match');
});

test('bad UID, bad kills, duplicate UID and nameless new player are skipped', () => {
  const plan = planCsvImport(makeTeams(), [
    row('ALP', '5.58E+09'),
    row('ALP', '100001', 'X', '-3'),
    row('ALP', '100002'),
    row('ALP', '100002'),
    row('ALP', '200009', ''),
  ]);
  assert.deepEqual(plan.skipped.map(s => s.reason), ['invalid_uid', 'invalid_kills', 'duplicate_uid', 'missing_name']);
  assert.deepEqual(plan.skipped.map(s => s.row), [2, 3, 5, 6]);
  assert.equal(plan.updates.length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUidDirectory } = require('../utils/uidDirectory');

const current = [
  { teamId: 'tA', teamName: 'Alpha', teamTag: 'ALP', slot: 3, players: [{ playerName: 'Seated', uId: '100001' }] },
  { teamId: 'tB', teamName: 'Bravo', teamTag: 'BRV', slot: 4, players: [] },
];

test('merges current, source matches then roster, first UID wins', () => {
  const sources = [
    { matchId: 'm2', matchNo: 2, teams: [{ teamId: 'tA', players: [{ playerName: 'Renamed', uId: '100001' }, { playerName: 'FromM2', uId: '100002' }] }] },
    { matchId: 'm1', matchNo: 1, teams: [{ teamId: 'tA', players: [{ playerName: 'OldName', uId: '100002' }, { playerName: 'FromM1', uId: '100003' }] }] },
  ];
  const catalog = [{ _id: 'tA', players: [{ playerName: 'Roster', playerId: '100004' }, { playerName: 'Dup', playerId: '100003' }] }];
  const [alpha] = buildUidDirectory(current, sources, catalog);
  assert.deepEqual(alpha.players.map(p => [p.playerName, p.uId, p.source]), [
    ['Seated', '100001', 'current'],
    ['FromM2', '100002', 'match'],
    ['FromM1', '100003', 'match'],
    ['Roster', '100004', 'roster'],
  ]);
  assert.equal(alpha.players[1].matchNo, 2);
});

test('teams are paired by teamId; other teams and blank UIDs add nothing', () => {
  const sources = [{ matchId: 'm1', matchNo: 1, teams: [
    { teamId: 'tZ', players: [{ playerName: 'Stranger', uId: '900001' }] },
    { teamId: 'tB', players: [{ playerName: 'NoUid', uId: '' }, { playerName: 'B1', uId: '200001' }] },
  ] }];
  const dir = buildUidDirectory(current, sources, []);
  assert.deepEqual(dir[1].players.map(p => p.uId), ['200001']);
  assert.equal(dir[0].players.length, 1);
  assert.deepEqual([dir[1].teamTag, dir[1].slot], ['BRV', 4]);
});

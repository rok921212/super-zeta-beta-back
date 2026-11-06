// Which live players go on a team's slot (utils/slotRouting.js): a previous
// game's squad or a team sharing the slot number must not fake an
// elimination and hand over its rank ("ghost point").
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRosterOwners, slotPlayersForTeam } = require('../utils/slotRouting');

const normalizeId = (id) => (id ? String(id).trim() : '');
const normalizeName = (n) => String(n).toLowerCase().replace(/[\p{P}\p{S}\p{Z}]/gu, '');
const live = (uId, rank, dead = false, playerName = 'p' + uId) =>
  ({ uId, teamId: 5, rank, liveState: dead ? 5 : 0, bHasDied: dead, playerName });
const roster = (...ids) => ids.map((id) => ({ playerId: String(id), playerName: 'p' + id }));

// Mirrors the controller: first 4 players, rank = min over them.
const pick = (list) => list.slice(0, 4);
const teamRank = (list) => Math.min(...pick(list).map((p) => p.rank || 0));

// `slots`: team id -> slot number. Teams not named sit on their own slot.
function route({ slotPlayers, teamId, groups, slots = {}, carried = [] }) {
  const owners = buildRosterOwners(groups, normalizeId);
  const liveOrder = new Map(slotPlayers.map((p, i) => [p, i]));
  const slotByTeamId = new Map([...groups.keys()].map((id, i) => [id, slots[id] ?? 100 + i]));
  return slotPlayersForTeam({
    slotPlayers, ownTeamId: teamId, groupPlayers: groups.get(teamId), rosterOwners: owners,
    slotByTeamId, isCarriedOver: (p) => carried.includes(p),
    liveOrder, normalizeId, normalizeName,
  });
}

test("last game's dead squad on a reused slot: this game's live players win, no ghost rank", () => {
  // Old squad (rank 3, all dead) first in the live map, then this game's squad.
  const old = [live(1, 3, true), live(2, 3, true), live(3, 3, true), live(4, 3, true)];
  const now = [live(11, 0), live(12, 0), live(13, 0), live(14, 0)];
  const groups = new Map([['A', roster(11, 12, 13, 14)], ['B', roster(1, 2, 3, 4)]]);
  const out = route({ slotPlayers: [...old, ...now], teamId: 'A', groups });
  assert.deepEqual(pick(out).map((p) => p.uId).sort(), [11, 12, 13, 14]);
  assert.equal(teamRank(out), 0, 'still alive, unplaced');
});

test('old squad not on any roster in this match: newest-seen still fills the slot first', () => {
  const old = [live(1, 2, true), live(2, 2, true), live(3, 2, true), live(4, 2, true)];
  const now = [live(11, 0), live(12, 0), live(13, 0), live(14, 0)];
  // This team's roster has no playerIds (only names that don't match).
  const groups = new Map([['A', [{ playerName: 'someone else' }]]]);
  const out = route({ slotPlayers: [...old, ...now], teamId: 'A', groups });
  assert.deepEqual(pick(out).map((p) => p.uId).sort(), [11, 12, 13, 14]);
  assert.equal(teamRank(out), 0);
});

test('two teams sharing a slot number: each gets only its own roster players', () => {
  const squad = [live(21, 4, true), live(22, 4, true), live(23, 4, true), live(24, 4, true)];
  const groups = new Map([['A', roster(21, 22, 23, 24)], ['B', roster(31, 32, 33, 34)]]);
  const slots = { A: 5, B: 5 };
  assert.equal(route({ slotPlayers: squad, teamId: 'A', groups, slots }).length, 4);
  assert.equal(route({ slotPlayers: squad, teamId: 'B', groups, slots }).length, 0, 'B is not eliminated by A');
});

test("borrowed lineup listed on other teams' rosters stays on the slot the game reports (TEAM SIR)", () => {
  const squad = [live(1, 20, true), live(2, 20, true), live(3, 20, true), live(4, 20, true)];
  const groups = new Map([
    ['SIR', roster(91, 92, 93, 94)],
    ['RBG', roster(1)],
    ['S7', roster(2, 3)],
    ['CGN', roster(4)],
  ]);
  const out = route({ slotPlayers: squad, teamId: 'SIR', groups, slots: { SIR: 5, RBG: 19, S7: 6, CGN: 17 } });
  assert.equal(pick(out).length, 4, 'not MISS');
  assert.equal(teamRank(out), 20, 'keeps its place points');
});

test('carried-over dead squad on a slot nobody plays: no ghost rank', () => {
  const old = [live(1, 3, true), live(2, 3, true), live(3, 3, true), live(4, 3, true)];
  const groups = new Map([['A', roster(11, 12, 13, 14)], ['B', roster(1, 2, 3, 4)]]);
  const out = route({ slotPlayers: old, teamId: 'A', groups, slots: { A: 5, B: 9 }, carried: old });
  assert.equal(out.length, 0);
});

test("a player on an earlier team's roster and their own stays with their own team", () => {
  const p = live(1, 0);
  const groups = new Map([['B', roster(1)], ['A', roster(1, 2)]]);
  const slots = { A: 5, B: 9 };
  assert.equal(route({ slotPlayers: [p], teamId: 'A', groups, slots }).length, 1);
  assert.equal(route({ slotPlayers: [p], teamId: 'A', groups, slots, carried: [p] }).length, 1, 'own roster, even when carried over');
});

test('own roster players still come before a borrowed player', () => {
  const borrowed = live(1, 0);
  const mine = [live(11, 0), live(12, 0), live(13, 0), live(14, 0)];
  const groups = new Map([['A', roster(11, 12, 13, 14)], ['B', roster(1)]]);
  const out = route({ slotPlayers: [...mine, borrowed], teamId: 'A', groups, slots: { A: 5, B: 9 } });
  assert.deepEqual(pick(out).map((p) => p.uId).sort(), [11, 12, 13, 14]);
});

test('own roster by name (bad playerId) still comes first', () => {
  const stray = live(99, 0);
  const mine = live(7, 0, false, 'Mine');
  const groups = new Map([['A', [{ playerId: 'typo', playerName: 'mine' }]]]);
  const out = route({ slotPlayers: [mine, stray], teamId: 'A', groups });
  assert.equal(out[0].uId, 7);
});

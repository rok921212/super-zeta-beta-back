// Live-tick read caches (utils/writeEpoch.js + the per-tick clone in
// pubgApiMatchData.controller.js). Covers the two ways these caches could
// break the live pipeline: a write that fails to invalidate, and a shared
// object that makes computeChangedTeams see no change.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createEpoch, attachWriteEpochHooks } = require('../utils/writeEpoch');
const { computeChangedTeams } = require('../utils/matchTeamDiff');

// Captures the post-hooks attachWriteEpochHooks registers, so they can be
// fired with a fake query/document `this` without a database.
function fakeSchema() {
  const hooks = new Map();
  return {
    hooks,
    post(op, optsOrFn, maybeFn) {
      hooks.set(op, typeof optsOrFn === 'function' ? optsOrFn : maybeFn);
    },
  };
}
const asQuery = (filter) => ({ getFilter: () => filter });

test('epoch: scoped bump invalidates only that key; global bump invalidates all', () => {
  const e = createEpoch('t');
  const a = e.snapshot('A');
  const b = e.snapshot('B');
  e.bump('A');
  assert.equal(e.isCurrent('A', a), false);
  assert.equal(e.isCurrent('B', b), true);
  const b2 = e.snapshot('B');
  e.bump(null);
  assert.equal(e.isCurrent('B', b2), false);
});

test('hooks: every write op is registered', () => {
  const schema = fakeSchema();
  attachWriteEpochHooks(schema, createEpoch('t'), 'matchId');
  for (const op of ['save', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'replaceOne', 'insertMany']) {
    assert.ok(schema.hooks.has(op), `missing hook for ${op}`);
  }
});

test('hooks: findOneAndUpdate with an ObjectId matchId bumps that match', () => {
  const schema = fakeSchema();
  const e = createEpoch('t');
  attachWriteEpochHooks(schema, e, 'matchId');
  const id = new mongoose.Types.ObjectId();
  const snap = e.snapshot(String(id));
  const other = e.snapshot('other');
  schema.hooks.get('findOneAndUpdate').call(asQuery({ matchId: id, userId: 'u' }));
  assert.equal(e.isCurrent(String(id), snap), false);
  assert.equal(e.isCurrent('other', other), true);
});

test('hooks: save (document middleware) bumps the doc key', () => {
  const schema = fakeSchema();
  const e = createEpoch('t');
  attachWriteEpochHooks(schema, e, 'matchId');
  const snap = e.snapshot('m1');
  schema.hooks.get('save').call({ matchId: 'm1' });
  assert.equal(e.isCurrent('m1', snap), false);
});

test('hooks: operator / missing filter falls back to a global bump', () => {
  const schema = fakeSchema();
  const e = createEpoch('t');
  attachWriteEpochHooks(schema, e, 'matchId');
  let snap = e.snapshot('m1');
  schema.hooks.get('deleteMany').call(asQuery({ matchId: { $in: ['m1', 'm2'] } }));
  assert.equal(e.isCurrent('m1', snap), false);
  snap = e.snapshot('m1');
  schema.hooks.get('updateMany').call(asQuery({ _id: 'x' }));
  assert.equal(e.isCurrent('m1', snap), false);
});

test('read racing a write is discarded (snapshot taken before the read)', () => {
  const e = createEpoch('t');
  const snapBeforeRead = e.snapshot('m1');
  e.bump('m1'); // write lands while the read is in flight
  assert.equal(e.isCurrent('m1', snapBeforeRead), false);
});

// Mirrors cloneMatchDataForTick in the controller.
const cloneForTick = (doc) => ({ ...doc, teams: (doc.teams || []).map((t) => ({ ...t })) });

test('clone: per-tick copies keep computeChangedTeams detecting changes', () => {
  const base = {
    matchId: 'm1',
    teams: [
      { teamId: 't1', slot: 1, rank: 0, placePoints: 0, players: [{ uId: 'p1', killNum: 0, health: 100 }] },
      { teamId: 't2', slot: 2, rank: 0, placePoints: 0, players: [{ uId: 'p2', killNum: 0, health: 100 }] },
    ],
  };
  // Tick 1: same mutation pattern as updateMatchDataWithLiveStats.
  const tick1 = cloneForTick(base);
  tick1.teams[0].players = [{ uId: 'p1', killNum: 0, health: 100 }];
  tick1.teams[1].players = [{ uId: 'p2', killNum: 0, health: 100 }];
  // Tick 2: one kill on team 1.
  const tick2 = cloneForTick(base);
  tick2.teams[0].players = [{ uId: 'p1', killNum: 1, health: 100 }];
  tick2.teams[1].players = [{ uId: 'p2', killNum: 0, health: 100 }];

  const changed = computeChangedTeams(tick2.teams, tick1.teams);
  assert.ok(changed.length >= 1, 'a kill must produce a delta');
  assert.ok(changed.some((t) => String(t.teamId) === 't1'));
  // The cached base is never touched by a tick.
  assert.equal(base.teams[0].players[0].killNum, 0);
  assert.notEqual(tick1.teams[0], tick2.teams[0]);
});

test('clone: rank/placePoints written on a tick do not leak into the base', () => {
  const base = { teams: [{ teamId: 't1', rank: 0, placePoints: 0, players: [] }] };
  const tick = cloneForTick(base);
  tick.teams[0].rank = 1;
  tick.teams[0].placePoints = 10;
  assert.equal(base.teams[0].rank, 0);
  assert.equal(base.teams[0].placePoints, 0);
});

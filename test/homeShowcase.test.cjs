'use strict';
// Home page showcase: the snapshot keeps display fields only, rejects unusable
// events, and the public route answers repeat visits with a 304. Models are
// stubbed: no database needed.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

const Tournament = require('../models/tournament.model');
const Round = require('../models/round.model');
const Match = require('../models/match.model');
const Group = require('../models/group.model.js');
const Team = require('../models/teams.model.js');
const showcase = require('../services/homeShowcase.js');
const controller = require('../controller/homeShowcase.controller.js');

/** A mongoose-query look-alike: every builder method chains, awaiting gives `value`. */
const q = (value) => {
  const chain = {
    select: () => chain, sort: () => chain, lean: () => chain, maxTimeMS: () => chain, populate: () => chain,
    then: (ok, ko) => Promise.resolve(value).then(ok, ko),
  };
  return chain;
};

const T_ID = '65f0000000000000000000a1';
const R_ID = '65f0000000000000000000a2';
const G_ID = '65f0000000000000000000a3';
const team = (i, extra = {}) => ({
  _id: `65f00000000000000000${String(100 + i).padStart(4, '0')}`,
  teamFullName: `Team ${i}`, teamTag: `T${i}`, logo: `https://cdn.example.com/t${i}.png`,
  createdBy: '65f0000000000000000000ff', hiddenBy: ['x'],
  players: [1, 2, 3, 4, 5].map((p) => ({ _id: 'pid', playerName: `P${i}${p}`, playerId: `51${i}${p}`, photo: `/p${i}${p}.png`, hiddenBy: ['x'] })),
  ...extra,
});

function stub({ teams = [team(1), team(2), team(3)], roundGroups = [G_ID], tournament = {} } = {}) {
  Tournament.findById = () => q({ _id: T_ID, tournamentName: 'Spring Cup', torLogo: 'data:image/png;base64,AAAA', primaryColor: '#ff0000', secondaryColor: 'red', userId: 'owner', ...tournament });
  Round.findOne = () => q({ _id: R_ID, tournamentId: T_ID, roundName: 'Finals', day: 'Day 3', groups: roundGroups, createdBy: 'owner' });
  Group.findById = () => q({ _id: G_ID, groupName: 'Group A', slots: teams.map((t, i) => ({ team: t._id, slot: i + 1 })) });
  Match.find = () => q([{ matchNo: 1, map: 'Erangel' }, { matchNo: 2, map: 'Miramar' }]);
  Team.find = () => q(teams);
}

test('the seed keeps display fields only', async () => {
  stub({ teams: [team(1, { logo: 'http://insecure.example.com/x.png' }), team(2), team(3)] });
  const seed = await showcase.buildShowcaseSeed({ tournamentId: T_ID, roundId: R_ID });
  const json = JSON.stringify(seed);
  for (const leaked of ['owner', 'hiddenBy', 'createdBy', '_id', 'pid', 'userId', 'base64']) assert.ok(!json.includes(leaked), `leaked ${leaked}`);
  assert.equal(seed.tournament.tournamentName, 'Spring Cup');
  assert.equal(seed.tournament.primaryColor, '#ff0000');
  assert.equal(seed.tournament.secondaryColor, undefined, 'a non-hex colour is dropped');
  assert.equal(seed.tournament.torLogo, undefined, 'data: URLs are dropped');
  assert.deepEqual(seed.round, { roundName: 'Finals', day: 'Day 3' });
  assert.equal(seed.groupName, 'Group A');
  assert.deepEqual(seed.maps, ['Erangel', 'Miramar']);
  assert.equal(seed.teams.length, 3);
  assert.equal(seed.teams[0].logo, undefined, 'http (not https) logos are dropped');
  assert.equal(seed.teams[1].logo, 'https://cdn.example.com/t2.png');
  assert.equal(seed.teams[1].players.length, 4, 'at most 4 players');
  assert.deepEqual(seed.teams[1].players[0], { name: 'P21', photo: '/p21.png', uId: '5121' });
});

test('an event the simulation cannot use is refused', async () => {
  stub({ teams: [team(1), team(2)] });
  await assert.rejects(showcase.buildShowcaseSeed({ tournamentId: T_ID, roundId: R_ID }), (e) => e.status === 400 && /at least 3/.test(e.message));
  stub();
  await assert.rejects(showcase.buildShowcaseSeed({ tournamentId: T_ID, roundId: R_ID, groupId: '65f0000000000000000000b9' }), (e) => e.status === 400);
  stub({ roundGroups: [] });
  await assert.rejects(showcase.buildShowcaseSeed({ tournamentId: T_ID, roundId: R_ID }), (e) => e.status === 400);
  stub();
  Tournament.findById = () => q(null);
  await assert.rejects(showcase.buildShowcaseSeed({ tournamentId: T_ID, roundId: R_ID }), (e) => e.status === 404);
});

test('view keys are cleaned', () => {
  assert.deepEqual(showcase.cleanViews(['Lower', 'Lower', 'bad key!', 42, 'LiveStats']), ['Lower', 'LiveStats']);
  assert.deepEqual(showcase.cleanViews('Lower'), []);
});

test('public route: no showcase, then 200 with an ETag, then 304', async () => {
  const realRead = showcase.readShowcase;
  const res = () => {
    const r = { statusCode: 200, headers: {}, body: undefined };
    r.set = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.end = () => r;
    return r;
  };
  try {
    showcase.readShowcase = async () => ({ showcase: null, etag: '"hs-0"' });
    const empty = res();
    await controller.getPublic({ headers: {} }, empty);
    assert.deepEqual(empty.body, { showcase: null });

    const saved = { seed: { teams: [] }, defaultTheme: 'Theme3', views: ['Lower'], source: { tournamentId: T_ID }, updatedAt: new Date(1000) };
    showcase.readShowcase = async () => ({ showcase: saved, etag: '"hs-1000"' });
    const first = res();
    await controller.getPublic({ headers: {} }, first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers.etag, '"hs-1000"');
    assert.equal(first.body.showcase.defaultTheme, 'Theme3');
    assert.equal(first.body.showcase.source, undefined, 'the admin-only source never goes public');

    const again = res();
    await controller.getPublic({ headers: { 'if-none-match': '"hs-1000"' } }, again);
    assert.equal(again.statusCode, 304);
    assert.equal(again.body, undefined);
  } finally {
    showcase.readShowcase = realRead;
  }
});

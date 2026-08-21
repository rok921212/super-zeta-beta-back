// Manual, one-off verification for player-level + field-level delta encoding
// (utils/matchTeamDiff.js's computeChangedPlayers/computeChangedPlayerFields),
// following the same standalone-script convention as verify-team-delta.js.
// NOT wired into npm start/CI.
//   Run: node scripts/verify-player-delta.js
const {
  computeChangedPlayers,
  computeChangedPlayerFields,
  PLAYER_IDENTITY_FIELDS,
  DEAD_WEIGHT_PLAYER_FIELDS,
} = require('../utils/matchTeamDiff');

const results = [];
const pass = (msg) => results.push(`PASS: ${msg}`);
const fail = (msg) => results.push(`FAIL: ${msg}`);

function synthPlayer(n, overrides = {}) {
  return {
    _id: `p${n}`,
    docId: `p${n}`,
    uId: `u${n}`,
    playerName: `Player ${n}`,
    teamId: 1,
    teamIdfromApi: 1,
    teamName: 'Team 1',
    killNum: 0,
    health: 100,
    healthMax: 100,
    liveState: 0,
    assists: 0,
    location: { x: 0, y: 0, z: 0 },
    AIKillNum: 0,
    ...overrides,
  };
}

// --- 1. First tick for a player (no previous): full object returned as-is ---
const p1 = synthPlayer(1);
const firstTick = computeChangedPlayerFields(p1, undefined);
firstTick === p1
  ? pass('First tick for a player: full object returned unchanged')
  : fail(`First tick: expected the exact same object back, got ${JSON.stringify(firstTick)}`);

// --- 2. No change: only identity fields survive, and computeChangedPlayers omits it entirely ---
const p2prev = synthPlayer(2);
const p2now = { ...p2prev };
const noChangeFields = computeChangedPlayerFields(p2now, p2prev);
const noChangeKeys = Object.keys(noChangeFields).filter((k) => !PLAYER_IDENTITY_FIELDS.includes(k));
noChangeKeys.length === 0
  ? pass('No-op player tick: diff has zero non-identity fields')
  : fail(`No-op player tick: expected 0 non-identity fields, got ${JSON.stringify(noChangeKeys)}`);

const noChangeList = computeChangedPlayers([p2now], [p2prev]);
noChangeList.length === 0
  ? pass('computeChangedPlayers: unchanged player omitted entirely from the list')
  : fail(`computeChangedPlayers: expected empty list, got ${noChangeList.length} entries`);

// --- 3. One field changes (killNum): only that field + identity fields survive ---
const p3prev = synthPlayer(3);
const p3now = { ...p3prev, killNum: 5 };
const oneFieldDiff = computeChangedPlayerFields(p3now, p3prev);
const oneFieldChangedKeys = Object.keys(oneFieldDiff).filter((k) => !PLAYER_IDENTITY_FIELDS.includes(k));
(oneFieldChangedKeys.length === 1 && oneFieldDiff.killNum === 5 && oneFieldDiff.health === undefined)
  ? pass(`Single-field change (killNum): diff carries only killNum + identity — got extra keys ${JSON.stringify(oneFieldChangedKeys)}`)
  : fail(`Single-field change: expected only [killNum], got ${JSON.stringify(oneFieldChangedKeys)}, health=${oneFieldDiff.health}`);

// --- 4. A nested field changes (location): detected like any other field ---
const p4prev = synthPlayer(4);
const p4now = { ...p4prev, location: { x: 5, y: 5, z: 0 } };
const locDiff = computeChangedPlayerFields(p4now, p4prev);
const locChangedKeys = Object.keys(locDiff).filter((k) => !PLAYER_IDENTITY_FIELDS.includes(k));
(locChangedKeys.length === 1 && locChangedKeys[0] === 'location')
  ? pass('location-only change: detected via nested-object comparison')
  : fail(`location-only change: expected only [location], got ${JSON.stringify(locChangedKeys)}`);

// --- 5. Dead-weight fields never appear in the diff, even when they "change" ---
const p5prev = synthPlayer(5);
const p5now = { ...p5prev, AIKillNum: 99, killNum: 1 }; // AIKillNum moved too, alongside a real change
const deadWeightDiff = computeChangedPlayerFields(p5now, p5prev);
(!('AIKillNum' in deadWeightDiff) && deadWeightDiff.killNum === 1)
  ? pass('Dead-weight field (AIKillNum) excluded from diff even when its raw value moved')
  : fail(`Dead-weight field leaked into diff: ${JSON.stringify(Object.keys(deadWeightDiff))}`);
DEAD_WEIGHT_PLAYER_FIELDS.has('AIKillNum')
  ? pass('AIKillNum confirmed present in DEAD_WEIGHT_PLAYER_FIELDS')
  : fail('AIKillNum missing from DEAD_WEIGHT_PLAYER_FIELDS — test assumption invalid');

// --- 6. Mixed roster: only the changed player is returned, unrelated player omitted ---
const teamPrev = [synthPlayer(6), synthPlayer(7)];
const teamNow = [synthPlayer(6), { ...synthPlayer(7), health: 42 }];
const rosterDiff = computeChangedPlayers(teamNow, teamPrev);
(rosterDiff.length === 1 && rosterDiff[0].docId === 'p7' && rosterDiff[0].health === 42)
  ? pass(`Mixed roster: only the changed player (p7) returned, unrelated player (p6) omitted — ${rosterDiff.length}/2 players sent`)
  : fail(`Mixed roster: expected exactly [p7], got ${JSON.stringify(rosterDiff.map((p) => p.docId))}`);

// --- 7. Client-side merge: a partial player diff merges onto (not replaces) the prior full player ---
function mergePlayer(prevPlayer, incomingDiff) {
  return { ...prevPlayer, ...incomingDiff };
}
const prevFullPlayer = synthPlayer(8, { killNum: 2, health: 80, assists: 3 });
const incomingPartial = computeChangedPlayerFields({ ...prevFullPlayer, health: 60 }, prevFullPlayer);
const mergedPlayer = mergePlayer(prevFullPlayer, incomingPartial);
(mergedPlayer.health === 60 && mergedPlayer.killNum === 2 && mergedPlayer.assists === 3)
  ? pass('Client merge: updated field (health) applied, untouched fields (killNum, assists) retained from prior state')
  : fail(`Client merge: health=${mergedPlayer.health}, killNum=${mergedPlayer.killNum}, assists=${mergedPlayer.assists}`);

console.log('\n=== PLAYER DELTA VERIFICATION RESULTS ===');
results.forEach((r) => console.log(r));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);

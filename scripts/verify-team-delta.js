// Manual, one-off verification for team-level delta encoding
// (utils/matchTeamDiff.js), following the same standalone-script convention
// as scripts/benchmark-deflate.js. NOT wired into npm start/CI.
//   Run: node scripts/verify-team-delta.js
const { computeChangedTeams } = require('../utils/matchTeamDiff');

const results = [];
const pass = (msg) => results.push(`PASS: ${msg}`);
const fail = (msg) => results.push(`FAIL: ${msg}`);

function synthTeam(slot, overrides = {}) {
  return {
    teamId: slot,
    teamName: `Team ${slot}`,
    slot,
    placePoints: 0,
    players: [
      { _id: `p${slot}-1`, uId: `u${slot}-1`, playerName: 'A', killNum: 0, health: 100, location: { x: 0, y: 0, z: 0 } },
      { _id: `p${slot}-2`, uId: `u${slot}-2`, playerName: 'B', killNum: 0, health: 100, location: { x: 0, y: 0, z: 0 } },
    ],
    ...overrides,
  };
}

// --- 1. First tick: no previous state -> every team is "changed" ---
const tick1 = Array.from({ length: 24 }, (_, i) => synthTeam(i + 1));
const firstTickResult = computeChangedTeams(tick1, undefined);
firstTickResult.length === 24
  ? pass(`First tick (no lastData): all 24 teams returned — got ${firstTickResult.length}`)
  : fail(`First tick: expected 24, got ${firstTickResult.length}`);

// --- 2. Second tick, nothing changed -> zero teams returned ---
const tick2Unchanged = tick1.map((t) => JSON.parse(JSON.stringify(t))); // deep clone, identical content
const noChangeResult = computeChangedTeams(tick2Unchanged, tick1);
noChangeResult.length === 0
  ? pass(`No-op tick: 0 teams returned — got ${noChangeResult.length}`)
  : fail(`No-op tick: expected 0, got ${noChangeResult.length}`);

// --- 3. Only a non-TRACKED_FIELDS field changes (location) -> still detected ---
const tick3 = tick1.map((t) => JSON.parse(JSON.stringify(t)));
tick3[5].players[0].location = { x: 999, y: 888, z: 1 }; // team slot 6, NOT in TRACKED_FIELDS
const locationChangeResult = computeChangedTeams(tick3, tick1);
(locationChangeResult.length === 1 && locationChangeResult[0].slot === 6)
  ? pass(`Location-only change on team 6: correctly detected (${locationChangeResult.length} team returned)`)
  : fail(`Location-only change: expected exactly team 6, got ${JSON.stringify(locationChangeResult.map((t) => t.slot))}`);

// --- 4. A real stat change (killNum) is also detected, unrelated teams excluded ---
const tick4 = tick1.map((t) => JSON.parse(JSON.stringify(t)));
tick4[10].players[1].killNum = 3; // team slot 11
const killChangeResult = computeChangedTeams(tick4, tick1);
(killChangeResult.length === 1 && killChangeResult[0].slot === 11)
  ? pass(`killNum change on team 11: correctly isolated (${killChangeResult.length} team returned, ${((1 - 1/24) * 100).toFixed(0)}% smaller than full snapshot)`)
  : fail(`killNum change: expected exactly team 11, got ${JSON.stringify(killChangeResult.map((t) => t.slot))}`);

// --- 5. Client-side merge contract: a team/player omitted from a delta retains its last-known value ---
// Ported (structure) from PublicThemeRenderer.tsx's processLiveMatchUpdate merge block, now
// with a SECOND, DIFFERENT merge rule one level deeper: a delta'd team's own scalar fields
// (teamName/placePoints/etc) are always complete when the team is present at all (backend
// still sends those in full), but its `players` array is partial — only players that actually
// changed — so each present player must be SHALLOW-MERGED onto the previous full player
// object (keeping fields the delta omitted), not wholesale-replaced like a team is.
const teamKeyFn = (t) => String(t.teamId ?? t._id);
const playerKeyFn = (p) => String(p.docId ?? p._id);

function clientMerge(prevTeams, incomingTeams) {
  const incomingById = new Map(incomingTeams.map((t) => [teamKeyFn(t), t]));

  const merged = prevTeams.map((prevTeam) => {
    const incomingTeam = incomingById.get(teamKeyFn(prevTeam));
    if (!incomingTeam) return prevTeam; // team wasn't in the delta at all — untouched

    const incomingPlayersById = new Map((incomingTeam.players || []).map((p) => [playerKeyFn(p), p]));
    const mergedPlayers = (prevTeam.players || []).map((prevPlayer) => {
      const incomingPlayer = incomingPlayersById.get(playerKeyFn(prevPlayer));
      return incomingPlayer ? { ...prevPlayer, ...incomingPlayer } : prevPlayer;
    });
    const knownPlayerIds = new Set((prevTeam.players || []).map(playerKeyFn));
    for (const p of incomingTeam.players || []) {
      if (!knownPlayerIds.has(playerKeyFn(p))) mergedPlayers.push(p); // new player, first tick for them
    }

    return { ...prevTeam, ...incomingTeam, players: mergedPlayers };
  });

  const knownTeamIds = new Set(prevTeams.map(teamKeyFn));
  for (const t of incomingTeams) {
    if (!knownTeamIds.has(teamKeyFn(t))) merged.push(t); // new team, first tick for it
  }
  return merged;
}

const clientPrevState = tick1; // client's last-known full state
const backendDelta = killChangeResult; // only team 11, with only its changed player, per test 4
const merged = clientMerge(clientPrevState, backendDelta);
const mergedTeam11 = merged.find((t) => t.slot === 11);
const mergedTeam1 = merged.find((t) => t.slot === 1); // untouched, should be byte-identical to original

(merged.length === 24
  && backendDelta[0].players.length === 1 // backend only sent the ONE player that actually changed
  && mergedTeam11.players.length === 2 // client still has both players after merge
  && mergedTeam11.players[1].killNum === 3 // the changed player got the update
  && mergedTeam11.players[0].killNum === 0 // the untouched sibling player kept its prior value
  && JSON.stringify(mergedTeam1) === JSON.stringify(tick1[0]))
  ? pass(`Client merge: 24 teams after merge, team 11's changed player got the update, its untouched teammate and team 1 (omitted from delta) both retained their exact prior values`)
  : fail(`Client merge: length=${merged.length}, deltaPlayers=${backendDelta[0]?.players?.length}, team11.players=${mergedTeam11?.players?.length}, team11.p1.killNum=${mergedTeam11?.players[1]?.killNum}, team1 unchanged=${JSON.stringify(mergedTeam1) === JSON.stringify(tick1[0])}`);

console.log('\n=== TEAM DELTA VERIFICATION RESULTS ===');
results.forEach((r) => console.log(r));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);

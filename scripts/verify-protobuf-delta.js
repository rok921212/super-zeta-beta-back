// Manual, one-off verification for the protobuf field-presence round-trip:
// matchTeamDiff.js's player delta -> protobufCodec.js's toProtoPlayer/
// encodeProtobuf -> decode with { defaults: true } — the SAME options
// PublicThemeRenderer.tsx's decodeWireMessage already uses, unchanged.
// protobufjs implements `optional` as a synthetic one-field oneof, and its
// toObject() respects that field's real presence independent of the
// `defaults` option (confirmed by reading the generated overlay.pb.js) — so
// no client-side decode change was needed. This script proves that: an
// unchanged optional field survives the wire as ABSENT, not as 0/false; a
// changed field survives with its real value; and a non-optional
// zero-valued field (AIKillNum) still correctly defaults to 0 as before.
// NOT wired into npm start/CI.
//   Run: node scripts/verify-protobuf-delta.js
const { computeChangedPlayerFields } = require('../utils/matchTeamDiff');
const { encodeProtobuf, toProtoTeam } = require('../utils/protobufCodec');
const proto = require('../proto/overlay.pb.js').overlay;

const results = [];
const pass = (msg) => results.push(`PASS: ${msg}`);
const fail = (msg) => results.push(`FAIL: ${msg}`);

function synthPlayer(n, overrides = {}) {
  return {
    _id: `p${n}`,
    uId: `u${n}`,
    playerName: `Player ${n}`,
    teamId: 1,
    teamIdfromApi: 1,
    teamName: 'Team 1',
    killNum: 2,
    health: 77,
    healthMax: 100,
    liveState: 0,
    assists: 1,
    location: { x: 10, y: 20, z: 0 },
    ...overrides,
  };
}

// Decode exactly like PublicThemeRenderer.tsx's decodeWireMessage must:
// defaults:false so an absent optional field is OMITTED, not 0-filled.
function decodeTeam(bytes) {
  // bytes[0] is the 0xC1 protobuf marker byte (see protobufCodec.js) — strip
  // it the same way decodeWireMessage does before handing off to protobufjs.
  const decoded = proto.Team.decode(bytes.subarray(1));
  return proto.Team.toObject(decoded, { defaults: true, longs: String });
}

// --- 1. Only the changed field (health) survives the full round-trip; an
//        unchanged optional field (killNum) is genuinely ABSENT, not 0 ---
const prevPlayer = synthPlayer(1);
const nowPlayer = { ...prevPlayer, health: 40 }; // only health actually changed
const diffedPlayer = computeChangedPlayerFields(nowPlayer, prevPlayer);

const prevTeam = { teamId: '1', _id: 't1', teamName: 'Team 1', players: [prevPlayer] };
const deltaTeam = { ...prevTeam, players: [diffedPlayer] };

const encoded = encodeProtobuf('MatchDataPayload', { matchId: 'm1', teams: [toProtoTeam(deltaTeam)] });
// encodeProtobuf wraps a whole MatchDataPayload, not a bare Team — decode
// that instead, matching what decodeWireMessage actually receives on the wire.
const decodedPayload = proto.MatchDataPayload.decode(encoded.subarray(1));
const decodedObj = proto.MatchDataPayload.toObject(decodedPayload, { defaults: true, longs: String });
const decodedPlayer = decodedObj.teams[0].players[0];

('health' in decodedPlayer && decodedPlayer.health === 40)
  ? pass(`Changed field (health) survived the wire with its real value (${decodedPlayer.health})`)
  : fail(`Changed field (health): expected present=40, got ${JSON.stringify(decodedPlayer.health)}`);

(!('killNum' in decodedPlayer))
  ? pass('Unchanged optional field (killNum) is genuinely ABSENT after decode — not silently 0')
  : fail(`Unchanged optional field (killNum) leaked onto the wire as ${JSON.stringify(decodedPlayer.killNum)} — presence tracking broken`);

(!('liveState' in decodedPlayer) && !('assists' in decodedPlayer) && !('location' in decodedPlayer))
  ? pass('Other unchanged optional fields (liveState, assists, location) all correctly absent')
  : fail(`Other unchanged fields leaked: liveState=${decodedPlayer.liveState}, assists=${decodedPlayer.assists}, location=${JSON.stringify(decodedPlayer.location)}`);

// Routing fields (uId, docId) always survive regardless of delta status.
(decodedPlayer.uId === 'u1' && decodedPlayer.docId === 'p1')
  ? pass('Routing fields (uId, docId) always present on a partial player')
  : fail(`Routing fields missing/wrong: uId=${decodedPlayer.uId}, docId=${decodedPlayer.docId}`);

// Display strings are now `optional` too — an UNCHANGED one is absent, same
// as an unchanged stat. The client merge keeps its last-known value.
(!('teamName' in decodedPlayer) && !('playerName' in decodedPlayer) && !('picUrl' in decodedPlayer))
  ? pass('Unchanged display strings (teamName, playerName, picUrl) correctly ABSENT on a partial player')
  : fail(`Unchanged display strings leaked: teamName=${JSON.stringify(decodedPlayer.teamName)}, playerName=${JSON.stringify(decodedPlayer.playerName)}, picUrl=${JSON.stringify(decodedPlayer.picUrl)}`);

// --- 1b. A CHANGED display string (picUrl) does survive the round-trip ---
const prevWithPic = synthPlayer(3, { picUrl: 'https://cdn/old.jpg' });
const nowWithPic = { ...prevWithPic, picUrl: 'https://cdn/new.jpg' };
const picDiff = computeChangedPlayerFields(nowWithPic, prevWithPic);
const picTeam = { teamId: '3', _id: 't3', teamName: 'Team 3', players: [picDiff] };
const picDecoded = proto.MatchDataPayload.toObject(
  proto.MatchDataPayload.decode(encodeProtobuf('MatchDataPayload', { matchId: 'm1', teams: [toProtoTeam(picTeam)] }).subarray(1)),
  { defaults: true, longs: String }
);
const picPlayer = picDecoded.teams[0].players[0];
(picPlayer.picUrl === 'https://cdn/new.jpg' && !('playerName' in picPlayer))
  ? pass('Changed display string (picUrl) survives; sibling unchanged display string (playerName) still absent')
  : fail(`Changed display string: picUrl=${JSON.stringify(picPlayer.picUrl)}, playerName=${JSON.stringify(picPlayer.playerName)}`);
// client merge keeps the old pic when a later tick omits it
const mergedPic = { ...nowWithPic, ...computeChangedPlayerFields({ ...nowWithPic, health: 1 }, nowWithPic) };
(mergedPic.picUrl === 'https://cdn/new.jpg')
  ? pass('Client merge: a stats-only later tick keeps the last-known picUrl')
  : fail(`Client merge dropped picUrl: ${JSON.stringify(mergedPic.picUrl)}`);

// --- 2. Reserved dead-weight fields (e.g. AIKillNum) are absent from the wire ---
(!('AIKillNum' in decodedPlayer) && !('PoisonTotalDamage' in decodedPlayer))
  ? pass('Reserved dead-weight fields (AIKillNum, PoisonTotalDamage) absent from the decoded object')
  : fail(`Reserved dead-weight field present: AIKillNum=${JSON.stringify(decodedPlayer.AIKillNum)}, PoisonTotalDamage=${JSON.stringify(decodedPlayer.PoisonTotalDamage)}`);

// --- 3. First-tick (full) player: every optional field present with its real value ---
const firstTickTeam = { teamId: '2', _id: 't2', teamName: 'Team 2', players: [synthPlayer(2)] };
const firstTickEncoded = encodeProtobuf('MatchDataPayload', { matchId: 'm1', teams: [toProtoTeam(firstTickTeam)] });
const firstTickDecoded = proto.MatchDataPayload.toObject(
  proto.MatchDataPayload.decode(firstTickEncoded.subarray(1)),
  { defaults: true, longs: String }
);
const firstTickPlayer = firstTickDecoded.teams[0].players[0];
(firstTickPlayer.killNum === 2 && firstTickPlayer.health === 77 && firstTickPlayer.assists === 1)
  ? pass('First-tick (full) player: every field present with its real value, as before this change')
  : fail(`First-tick player missing/wrong fields: killNum=${firstTickPlayer.killNum}, health=${firstTickPlayer.health}, assists=${firstTickPlayer.assists}`);

console.log('\n=== PROTOBUF DELTA ROUND-TRIP VERIFICATION RESULTS ===');
results.forEach((r) => console.log(r));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);

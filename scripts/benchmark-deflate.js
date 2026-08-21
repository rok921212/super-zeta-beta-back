// Manual, one-off benchmark for whether re-enabling perMessageDeflate on
// socket.js is worth it. NOT wired into npm start/CI — run by hand:
//   node scripts/benchmark-deflate.js
//
// socket.js currently disables perMessageDeflate on an unverified claim
// that msgpack payloads are "too high-entropy to benefit." This script
// tests that claim against a realistic payload, across all three encodings
// this project now uses on the hot live-tick path (JSON, msgpack,
// protobuf), so the decision in socket.js can cite real numbers instead of
// a guess. See plan step 3 for the decision rule to apply to the output.
const zlib = require('zlib');
const { encodeMsgpack } = require('../utils/msgpackCodec');
const { encodeProtobuf, toProtoMatchDataPayload } = require('../utils/protobufCodec');

const ITERATIONS = 100;
const LEVELS = [1, 6, 9];

function synthPlayer(i, teamSlot) {
  return {
    uId: `u${i}`,
    playerName: `Player${i}`,
    playerOpenId: `open${i}`,
    picUrl: `https://cdn.example.com/players/${i}.png`,
    showPicUrl: `https://cdn.example.com/players/${i}-show.png`,
    character: 'None',
    teamIdfromApi: teamSlot,
    teamId: teamSlot,
    teamName: `Team ${teamSlot}`,
    location: { x: Math.random() * 8000, y: Math.random() * 8000, z: Math.random() * 500 },
    health: Math.floor(Math.random() * 100),
    healthMax: 100,
    liveState: 1,
    isFiring: false,
    bHasDied: false,
    isOutsideBlueCircle: false,
    killNum: Math.floor(Math.random() * 6),
    killNumBeforeDie: 0,
    gotAirDropNum: 0,
    maxKillDistance: Math.floor(Math.random() * 300),
    damage: Math.floor(Math.random() * 800),
    killNumInVehicle: 0,
    killNumByGrenade: 0,
    AIKillNum: 0,
    BossKillNum: 0,
    rank: 0,
    inDamage: Math.floor(Math.random() * 400),
    headShotNum: Math.floor(Math.random() * 3),
    survivalTime: Math.floor(Math.random() * 1800),
    driveDistance: Math.floor(Math.random() * 5000),
    marchDistance: Math.floor(Math.random() * 3000),
    assists: Math.floor(Math.random() * 4),
    outsideBlueCircleTime: 0,
    knockouts: Math.floor(Math.random() * 3),
    rescueTimes: 0,
    useSmokeGrenadeNum: Math.floor(Math.random() * 3),
    useFragGrenadeNum: Math.floor(Math.random() * 3),
    useBurnGrenadeNum: 0,
    useFlashGrenadeNum: Math.floor(Math.random() * 2),
    PoisonTotalDamage: 0,
    UseSelfRescueTime: 0,
    UseEmergencyCallTime: 0,
    contribution: Math.floor(Math.random() * 100),
    heal: Math.floor(Math.random() * 200),
  };
}

function synthMatch(teamCount = 20, playersPerTeam = 4) {
  const teams = [];
  for (let t = 1; t <= teamCount; t++) {
    const players = [];
    for (let p = 0; p < playersPerTeam; p++) players.push(synthPlayer(t * 10 + p, t));
    teams.push({
      teamId: t,
      teamName: `Team ${t}`,
      teamTag: `TM${t}`,
      teamLogo: `https://cdn.example.com/logos/${t}.png`,
      slot: t,
      placePoints: 0,
      rank: 0,
      players,
    });
  }
  return { matchId: '507f1f77bcf86cd799439011', teams };
}

function avgTime(fn) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6 / ITERATIONS; // ms/op
}

function benchmarkEncoding(label, buffer) {
  console.log(`\n--- ${label}: raw size = ${buffer.length} bytes ---`);
  for (const level of LEVELS) {
    let deflated;
    const ms = avgTime(() => { deflated = zlib.deflateRawSync(buffer, { level }); });
    const pct = (100 * (1 - deflated.length / buffer.length)).toFixed(1);
    console.log(`  level ${level}: ${deflated.length} bytes (${pct}% saved), ${ms.toFixed(3)} ms/op`);
  }
}

const sample = synthMatch(20, 4);

console.log(`Sample: ${sample.teams.length} teams x ${sample.teams[0].players.length} players = ${sample.teams.length * sample.teams[0].players.length} players`);

const jsonBuffer = Buffer.from(JSON.stringify(sample));
benchmarkEncoding('JSON.stringify (isolates "deflate helps regardless of encoding")', jsonBuffer);

const msgpackBuffer = encodeMsgpack(sample);
benchmarkEncoding('encodeMsgpack (today\'s wire format for this payload)', msgpackBuffer);

const protoMapped = toProtoMatchDataPayload(sample);
const protoBuffer = encodeProtobuf('MatchDataPayload', protoMapped);
benchmarkEncoding('encodeProtobuf (new wire format for negotiated clients)', protoBuffer);

console.log(`\nRaw size comparison: JSON=${jsonBuffer.length} msgpack=${msgpackBuffer.length} (${(100 * (1 - msgpackBuffer.length / jsonBuffer.length)).toFixed(1)}% smaller than JSON) protobuf=${protoBuffer.length} (${(100 * (1 - protoBuffer.length / jsonBuffer.length)).toFixed(1)}% smaller than JSON)`);
console.log('\nApply the decision rule from the plan to whichever encoding(s) are actually in use on the wire (msgpack for the user: room and unnegotiated overlay clients; protobuf for negotiated overlay clients) before touching perMessageDeflate in socket.js.');

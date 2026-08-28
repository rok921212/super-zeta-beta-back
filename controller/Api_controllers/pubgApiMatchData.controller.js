const crypto = require('crypto');
const zlib = require('zlib');
const mongoose = require('mongoose');
const { decode } = require('@msgpack/msgpack');
const MatchSelection = require('../../models/MatchSelection.model');
const MatchData = require('../../models/matchData.model');
const Round = require('../../models/round.model');
const Group = require('../../models/group.model');
const User = require('../../models/User.model');
const updateTeamsWithApiPlayers = require('./playerCheckandSwitch');
const { getSocket } = require('../../socket');
const { computeOverallMatchDataForRound } = require('../overall.controller');
const { encodeMsgpack } = require('../../utils/msgpackCodec');
const { updateDeadTeamList, hydrateMatchDataIdentity } = require('../Bulkpublic.controller');
const { VIEWS_NEEDING_OVERALL, VIEWS_NEEDING_MATCH_DATA, VIEWS_NEEDING_POSITIONAL_DATA } = require('../../utils/viewDataTiers');
const { setSocketWireFormat, clearSocketWireFormat } = require('../../utils/socketFormatRegistry');
const { emitToRoomSplitByFormat } = require('../../utils/roomEmit');
const { toProtoMatchDataPayload, toProtoOverallDataPayload } = require('../../utils/protobufCodec');
const { computeChangedTeams, TRACKED_FIELDS, stripPositionalFields } = require('../../utils/matchTeamDiff');
const { getRoundStructureVersion } = require('../../utils/roundStructure');

// ─── In-Memory Live Match Cache ───────────────────────────────────────────────
const liveMatchCache = new Map();

// ─── Group (roster) Cache ─────────────────────────────────────────────────────
// Group.find(...).populate('slots.team') was being re-run — populate
// round trip and all — on every single live tick, per match, per user, even
// though roster/group data changes rarely. Short TTL so a roster edit is
// still picked up within a few seconds.
//
// Stale-while-revalidate: on expiry, the stale cached value is returned
// IMMEDIATELY and the refetch happens in the background instead of being
// awaited inline. This function sits on updateMatchDataWithLiveStats's
// critical path, which the userProcessing gate holds ticks open for — a
// blocking cache-miss refetch every ~5s was a smaller-scale recurrence of
// the same failure mode fixed for computeOverallMatchDataForRound: a slow
// DB round trip on that one tick could exceed the ~2s PCOB gap and get that
// tick silently dropped. Only the very first call for a given key (nothing
// cached yet) still blocks, since there's no stale value to serve.
//
// Fetches ALL groups for (tournamentId, userId), not just one — a
// tournament can legitimately have multiple Group documents per user
// (e.g. "Group A" / "Group B", see group.controller.js's own
// Group.find({tournamentId, userId}) listing endpoint). A prior version
// used findOne here, which arbitrarily returned only one group; any team
// whose roster actually lived in a different group silently got treated
// as having an empty roster (groupPlayers = []) on every live tick,
// forever — no roster photo/name fallback ever available for that team's
// players, even though the roster data was correct. Fetching every group
// and merging their slots (see groupSlotByTeamId below) fixes that.
const GROUP_CACHE_TTL_MS = 5000;
const groupCache = new Map(); // `${tournamentId}:${userId}` -> { groups, expiresAt }
const groupRefreshInFlight = new Set(); // keys currently being refreshed in the background

async function fetchGroups(tournamentId, userId) {
  return Group.find({ tournamentId, userId }).populate('slots.team').lean();
}

function refreshGroupInBackground(key, tournamentId, userId) {
  if (groupRefreshInFlight.has(key)) return;
  groupRefreshInFlight.add(key);
  fetchGroups(tournamentId, userId)
    .then(groups => {
      groupCache.set(key, { groups, expiresAt: Date.now() + GROUP_CACHE_TTL_MS });
    })
    .catch(err => {
      console.warn(`[getGroupsCached] background refresh failed for ${key}:`, err.message);
    })
    .finally(() => {
      groupRefreshInFlight.delete(key);
    });
}

async function getGroupsCached(tournamentId, userId) {
  const key = `${tournamentId}:${userId}`;
  const cached = groupCache.get(key);
  if (cached) {
    if (cached.expiresAt <= Date.now()) {
      refreshGroupInBackground(key, tournamentId, userId);
    }
    return cached.groups;
  }
  // First call ever for this key — nothing stale to serve, must block.
  const groups = await fetchGroups(tournamentId, userId);
  groupCache.set(key, { groups, expiresAt: Date.now() + GROUP_CACHE_TTL_MS });
  return groups;
}

// ─── Unmatched-Player Diagnostic Log ──────────────────────────────────────────
// Surfaces exactly which live players fail to resolve against the roster —
// the dominant real cause of a missing picUrl is a roster playerId that
// doesn't actually match this player's live uId (see the format check added
// to teams.controller.js's validatePlayerIds). Without this, that failure is
// completely silent. Rate-limited per (match, uid) so a persistently
// unmatched player doesn't spam the log every ~2s tick.
const UNMATCHED_LOG_TTL_MS = 5 * 60 * 1000;
const loggedUnmatched = new Map(); // `${matchId}:${uid}` -> lastLoggedAt

function logUnmatchedPlayer(matchId, uid, playerName) {
  const key = `${matchId}:${uid}`;
  const lastLogged = loggedUnmatched.get(key);
  if (lastLogged && Date.now() - lastLogged < UNMATCHED_LOG_TTL_MS) return;
  loggedUnmatched.set(key, Date.now());
  console.warn(
    `[unmatched-player] match=${matchId} uId=${uid} playerName="${playerName}" — no roster match this tick, picUrl will stay blank until the roster playerId is fixed`
  );
}

// Live, queryable view of who's currently unmatched per match (unlike the
// rate-limited log above, this always reflects the latest tick) — backs the
// operator-facing "unmatched players" panel in matchDataController.tsx.
const unmatchedPlayersByMatch = new Map(); // matchId (string) -> Map<uid, { playerName, lastSeenAt }>

function markUnmatched(matchId, uid, playerName) {
  const key = String(matchId);
  let m = unmatchedPlayersByMatch.get(key);
  if (!m) { m = new Map(); unmatchedPlayersByMatch.set(key, m); }
  const isNewlyUnmatched = !m.has(uid);
  m.set(uid, { playerName, lastSeenAt: Date.now() });
  return isNewlyUnmatched;
}

function markMatched(matchId, uid) {
  return unmatchedPlayersByMatch.get(String(matchId))?.delete(uid) || false;
}

function getUnmatchedPlayers(matchId) {
  const m = unmatchedPlayersByMatch.get(String(matchId));
  if (!m) return [];
  return Array.from(m.entries()).map(([uid, info]) => ({ uid, ...info }));
}

// ─── API-Enabled Round IDs Cache ──────────────────────────────────────────────
// pollForUser (fired on every debounced socket tick) and
// discoverAndStartPollingUsers (every 10s) were each independently running
// the exact same Round.find({apiEnable:true}) query. Centralize it so the
// hot per-tick path reuses the same short-lived cache instead of paying its
// own round trip every tick.
// Shorter than the 10s discoverAndStartPollingUsers interval, so that
// periodic discovery run always re-queries fresh (keeping apiEnable
// toggles responsive) while ticks in between reuse the cached value.
const API_ENABLED_ROUNDS_TTL_MS = 8000;
let apiEnabledRoundIdsCache = null;
let apiEnabledRoundIdsCacheAt = 0;

async function getApiEnabledRoundIds() {
  if (apiEnabledRoundIdsCache && Date.now() - apiEnabledRoundIdsCacheAt < API_ENABLED_ROUNDS_TTL_MS) {
    return apiEnabledRoundIdsCache;
  }
  const apiEnabledRounds = await Round.find({ apiEnable: true }).select('_id').lean();
  apiEnabledRoundIdsCache = apiEnabledRounds.map(r => r._id.toString());
  apiEnabledRoundIdsCacheAt = Date.now();
  return apiEnabledRoundIdsCache;
}

// ─── Background Save Queue ────────────────────────────────────────────────────
// Keyed by "matchId:userId" so a newer tick's snapshot for a match
// overwrites the still-pending one instead of queuing alongside it — the DB
// only ever needs the LATEST teams array, so holding every intermediate
// tick would just mean writing (and immediately overwriting) stale data for
// no benefit. Flushed on SAVE_FLUSH_INTERVAL_MS instead of immediately
// after every push, so several ticks' worth of changes across every active
// match land in one bulkWrite instead of one per tick. Live socket delivery
// is entirely unaffected by this delay — that reads from
// liveMatchCache/memoryMatch (updated synchronously every tick), never from
// this queue or from Mongo.
const SAVE_FLUSH_INTERVAL_MS = 3000;
const saveQueue = new Map(); // "matchId:userId" -> { matchId, userId, teams }
let isSaving = false;

// Automatic 3s persistence is OFF by default now — live match `teams` are
// persisted only on an explicit POST /api/match/save-current (the dashboard
// "SAVE DATA" button, via saveLiveMatchSnapshot below). Set LIVE_AUTOSAVE=true
// to restore the old continuous flush (e.g. as a durability safety net).
const LIVE_AUTOSAVE_ENABLED = process.env.LIVE_AUTOSAVE === 'true';

async function processSaveQueue() {
  if (isSaving || saveQueue.size === 0) return;
  isSaving = true;

  const batch = Array.from(saveQueue.values());
  saveQueue.clear();
  try {
    await MatchData.bulkWrite(
      batch.map(job => ({
        updateOne: {
          filter: { matchId: job.matchId, userId: job.userId },
          update: { $set: { teams: job.teams } },
        },
      })),
      { ordered: false }
    );
    console.log(c('green', `💾 Bulk-saved ${batch.length} job(s)`));
  } catch (err) {
    console.error('Background save error:', err.message);
  } finally {
    isSaving = false;
  }
}

if (LIVE_AUTOSAVE_ENABLED) setInterval(processSaveQueue, SAVE_FLUSH_INTERVAL_MS);

// ─── On-demand Live Snapshot Save ────────────────────────────────────────────
// Persists the CURRENT in-memory live snapshot for one match to MongoDB on
// operator demand (dashboard "SAVE DATA" button), using the SAME write shape as
// processSaveQueue above ($set teams only, keyed by { matchId, userId }). It is
// an idempotent overwrite of the single MatchData doc — never a history doc.
// Reads liveMatchCache directly and does NOT touch the socket, the relay, PCOB
// ingestion, polling flags, the saveQueue, or the flush timer — the live
// pipeline keeps reading liveMatchCache untouched.
//
// userId here is req.session.userId (hex string from the JWT). The cache is
// keyed `${String(userId)}:${String(matchId)}` at set-time (see
// updateMatchDataWithLiveStats), and String(hex) === hex, so the Map lookup
// matches. Mongoose casts the hex strings in the updateOne filter to ObjectId
// against the schema, so the DB filter hits the same doc the automatic path
// (ObjectIds) writes.
async function saveLiveMatchSnapshot({ matchId, userId }) {
  const cacheKey = `${String(userId)}:${String(matchId)}`;
  const entry = liveMatchCache.get(cacheKey);
  if (!entry || !Array.isArray(entry.teams)) {
    return { saved: false, reason: 'no-live-snapshot' };
  }
  const result = await MatchData.updateOne(
    { matchId, userId },
    { $set: { teams: entry.teams } }
  );
  if (!result.matchedCount) {
    return { saved: false, reason: 'no-matchdata-doc' };
  }
  console.log(c('green', `💾 SAVE DATA: match=${String(matchId)} user=${String(userId)} teams=${entry.teams.length}`));
  return { saved: true, matchId: String(matchId), savedAt: new Date().toISOString() };
}

// ─── One-time Index Setup ─────────────────────────────────────────────────────
const ensureIndexes = async () => {
  try {
    const db = mongoose.connection.db;

    await db.collection('matchdatas').createIndex(
      { matchId: 1, userId: 1 },
      { background: true, name: 'matchId_userId' }
    );
    await db.collection('matchselections').createIndex(
      { matchId: 1, isSelected: 1, userId: 1 },
      { background: true, name: 'matchId_isSelected_userId' }
    );
    await db.collection('matchselections').createIndex(
      { isSelected: 1, userId: 1, roundId: 1 },
      { background: true, name: 'isSelected_userId_roundId' }
    );
    await db.collection('matchselections').createIndex(
      { isSelected: 1, isPollingActive: 1, roundId: 1 },
      { background: true, name: 'isSelected_isPollingActive_roundId' }
    );
    await db.collection('rounds').createIndex(
      { apiEnable: 1 },
      { background: true, name: 'apiEnable' }
    );
    await db.collection('groups').createIndex(
      { tournamentId: 1, userId: 1 },
      { background: true, name: 'tournamentId_userId' }
    );

    console.log(c('green', '✔ MongoDB indexes ensured'));
  } catch (err) {
    console.warn('Index setup warning (non-fatal):', err.message);
  }
};

// ─── Console Logger Utility ───────────────────────────────────────────────────
const chalk = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  cyan:     '\x1b[36m',
  white:    '\x1b[37m',
  bgRed:    '\x1b[41m',
  bgGreen:  '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue:   '\x1b[44m',
};
const c = (color, text) => `${chalk[color]}${text}${chalk.reset}`;

// Full table dumps / diff tables are synchronous console writes on the hot
// emit path, running per tick per active match — console.log is a
// SYNCHRONOUS write whenever stdout is a non-TTY pipe (which it is on
// Render), so a slow/backed-up log drain there blocks the single Node
// event loop for every concurrently-running match, not just the one being
// logged. Opt-IN only (was opt-out, i.e. on by default, which is backwards
// for a hazard this severe) — set VERBOSE_MATCH_LOGS=true to get per-tick
// table/diff dumps for local debugging.
const VERBOSE_MATCH_LOGS = process.env.VERBOSE_MATCH_LOGS === 'true';

// ─── Log Diff ─────────────────────────────────────────────────────────────────
function logMatchDiff(matchId, lastData, currentData) {
  const timestamp = new Date().toLocaleTimeString();
  const changes = [];

  currentData.teams.forEach((team, ti) => {
    const lastTeam = lastData?.teams?.[ti];
    const tag = team.teamTag || team.teamName || `Slot${team.slot}`;

    if (lastTeam && team.placePoints !== lastTeam.placePoints) {
      changes.push({
        team: tag, slot: team.slot, player: '—', field: 'placePoints',
        old: lastTeam.placePoints, new: team.placePoints
      });
    }

    team.players?.forEach((player, pi) => {
      const lastPlayer = lastTeam?.players?.[pi];
      const TRACKED = [
        'killNum', 'health', 'damage', 'assists', 'knockouts',
        'liveState', 'bHasDied', 'headShotNum', 'survivalTime',
        'rescueTimes', 'inDamage', 'heal', 'rank',
      ];
      TRACKED.forEach(field => {
        const newVal = player[field];
        const oldVal = lastPlayer?.[field];
        if (oldVal !== undefined && newVal !== oldVal) {
          changes.push({
            team: tag,
            slot: team.slot,
            player: player.playerName || player.uId,
            field,
            old: oldVal,
            new: newVal
          });
        }
      });
    });
  });

  if (!changes.length) {
    console.log(`${c('dim', timestamp)} ${c('yellow', '≈')} match=${matchId} — no stat changes`);
    return;
  }

  console.log(`\n${c('bgBlue', c('bold', ` LIVE UPDATE `))} ${c('cyan', matchId)} ${c('dim', `@ ${timestamp}`)}`);
  console.log(c('dim', '─'.repeat(80)));

  const W = { slot: 4, team: 8, player: 18, field: 22, old: 10, new: 10 };
  const row = (slot, team, player, field, oldV, newV) =>
    `  ${String(slot).padStart(W.slot)}  ${String(team).padEnd(W.team)}  ${String(player).padEnd(W.player)}  ${String(field).padEnd(W.field)}  ${String(oldV).padStart(W.old)}  →  ${String(newV).padEnd(W.new)}`;

  console.log(c('dim', row('Slot', 'Team', 'Player', 'Field', 'Before', 'After')));
  console.log(c('dim', '─'.repeat(80)));

  changes.forEach(ch => {
    const isGood   = ['killNum', 'assists', 'knockouts', 'headShotNum', 'heal', 'rescueTimes'].includes(ch.field);
    const isBad    = ['bHasDied', 'liveState'].includes(ch.field) && ch.new > ch.old;
    const isHealth = ch.field === 'health';

    let colored;
    if (isBad)
      colored = c('red',    row(ch.slot, ch.team, ch.player, ch.field, ch.old, ch.new));
    else if (isGood)
      colored = c('green',  row(ch.slot, ch.team, ch.player, ch.field, ch.old, ch.new));
    else if (isHealth && ch.new < ch.old)
      colored = c('yellow', row(ch.slot, ch.team, ch.player, ch.field, ch.old, ch.new));
    else
      colored = row(ch.slot, ch.team, ch.player, ch.field, ch.old, ch.new);

    console.log(colored);
  });

  console.log(c('dim', '─'.repeat(80)));
  console.log(`  ${c('bold', String(changes.length))} change(s) detected\n`);
}

// ─── Log Full Table ───────────────────────────────────────────────────────────
function logFullMatchTable(matchData) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n${c('bgGreen', c('bold', ` MATCH SNAPSHOT `))} ${c('cyan', String(matchData.matchId))} ${c('dim', `@ ${timestamp}`)}`);
  console.log(c('dim', '─'.repeat(110)));

  const hdr =
    `  ${'Sl'.padStart(2)}  ${'Team'.padEnd(8)}  ${'Player'.padEnd(18)}` +
    `  ${'HP'.padStart(4)}  ${'Kills'.padStart(5)}  ${'Dmg'.padStart(6)}` +
    `  ${'Assists'.padStart(7)}  ${'KO'.padStart(3)}  ${'State'.padStart(5)}` +
    `  ${'Rank'.padStart(4)}  ${'Died'.padStart(5)}`;
  console.log(c('dim', hdr));
  console.log(c('dim', '─'.repeat(110)));

  matchData.teams?.forEach(team => {
    const tag = team.teamTag || team.teamName || `Slot${team.slot}`;
    team.players?.forEach((p, i) => {
      const died = p.bHasDied ? c('red', 'DEAD ') : c('green', 'ALIVE');
      const hp =
        p.health <= 30 ? c('red',    String(p.health || 0).padStart(4)) :
        p.health <= 70 ? c('yellow', String(p.health || 0).padStart(4)) :
                         String(p.health || 0).padStart(4);
      const line =
        `  ${String(team.slot).padStart(2)}` +
        `  ${(i === 0 ? tag : '').padEnd(8)}` +
        `  ${(p.playerName || p.uId || '?').padEnd(18)}` +
        `  ${hp}` +
        `  ${String(p.killNum   || 0).padStart(5)}` +
        `  ${String(p.damage    || 0).padStart(6)}` +
        `  ${String(p.assists   || 0).padStart(7)}` +
        `  ${String(p.knockouts || 0).padStart(3)}` +
        `  ${String(p.liveState || 0).padStart(5)}` +
        `  ${String(p.rank      || 0).padStart(4)}` +
        `  ${died}`;
      console.log(line);
    });
  });

  console.log(c('dim', '─'.repeat(110)) + '\n');
}

// ─── Per-User Live Player Cache (pushed via socket from each user's local relay) ─
// This replaces the old single global `latestApiPlayers`. Each connected relay
// socket is bound to a userId on a `registerRelay` handshake, and its pushes
// are stored keyed by that userId — so N users' relays running at the same
// time no longer stomp on each other's data.
const liveApiPlayersByUser = new Map(); // userId -> { players, at }

// ─── Relay Wire-Protocol State (delta + sequence-number tracking) ────────────
// The relay (fetcher.rs) now sends totalPlayerList as either a full roster
// (isFull:true) or a DELTA of only new/changed players (isFull:false), each
// tagged with a monotonic wireSeq. This map is the single source of truth for
// that protocol per user: which socket is currently authoritative, the
// highest wireSeq applied, and the merged player set (keyed by uid) that
// liveApiPlayersByUser is rebuilt from after every message.
//
// Keyed by userId (matching how liveApiPlayersByUser/downstream consumption
// is keyed), but every write is gated on the incoming packet's own socket.id
// matching .socketId — that comparison is what rejects a stale, already-
// evicted connection's late-arriving packet (registerRelay's eviction loop
// calls s.disconnect(true) on the old socket, but that does not retroactively
// cancel a 'totalPlayerList' callback already queued on the event loop for
// it). Reset wholesale on every registerRelay (fresh connection or
// reconnect), so a connection swap never inherits stale seq/player state.
const relayStateByUser = new Map(); // userId -> { socketId, lastReceivedSeq, players: Map<uid, playerObj> }

// Mirrors fetcher.rs's player_key(): prefer uId, fall back to playerName.
function playerKeyOf(p) {
  if (p == null) return null;
  if (p.uId !== undefined && p.uId !== null && p.uId !== '') return String(p.uId);
  if (p.playerName) return String(p.playerName);
  return null;
}

// PCOB uses -1 as a "not populated yet" sentinel on at least `rank` (only
// assigned once a player/team is eliminated) — possibly other stat fields
// too. Plain `x || 0` doesn't catch it since -1 is truthy, so it was
// leaking straight through to persisted/broadcast player data and showing
// up as a literal "-1" on the overlay. Clamp explicitly at ingestion.
const nonNeg = (v) => (typeof v === 'number' && v > 0) ? Math.trunc(v) : 0;

// Every numeric player-stat field PCOB can supply, clamped via nonNeg (plus
// healthMax's own positive-or-default-100 rule). Shared by both the
// "matched to roster" and "unmatched" player branches below in
// updateMatchDataWithLiveStats so the two field lists can't drift apart —
// the unmatched branch previously only re-clamped 5 of these, leaving the
// rest exposed to the same raw -1 sentinel via its `...apiPlayer` spread.
function clampedNumericPlayerStats(apiPlayer) {
  return {
    health:                nonNeg(apiPlayer.health),
    healthMax:             (typeof apiPlayer.healthMax === 'number' && apiPlayer.healthMax > 0) ? Math.trunc(apiPlayer.healthMax) : 100,
    liveState:             nonNeg(apiPlayer.liveState),
    rank:                  nonNeg(apiPlayer.rank),
    killNum:               nonNeg(apiPlayer.killNum),
    killNumBeforeDie:      nonNeg(apiPlayer.killNumBeforeDie),
    damage:                nonNeg(apiPlayer.damage),
    assists:               nonNeg(apiPlayer.assists),
    knockouts:             nonNeg(apiPlayer.knockouts),
    headShotNum:           nonNeg(apiPlayer.headShotNum),
    survivalTime:          nonNeg(apiPlayer.survivalTime),
    inDamage:              nonNeg(apiPlayer.inDamage),
    driveDistance:         nonNeg(apiPlayer.driveDistance),
    marchDistance:         nonNeg(apiPlayer.marchDistance),
    outsideBlueCircleTime: nonNeg(apiPlayer.outsideBlueCircleTime),
    rescueTimes:           nonNeg(apiPlayer.rescueTimes),
    gotAirDropNum:         nonNeg(apiPlayer.gotAirDropNum),
    maxKillDistance:       nonNeg(apiPlayer.maxKillDistance),
    killNumInVehicle:      nonNeg(apiPlayer.killNumInVehicle),
    killNumByGrenade:      nonNeg(apiPlayer.killNumByGrenade),
    AIKillNum:             nonNeg(apiPlayer.AIKillNum),
    BossKillNum:           nonNeg(apiPlayer.BossKillNum),
    useSmokeGrenadeNum:    nonNeg(apiPlayer.useSmokeGrenadeNum),
    useFragGrenadeNum:     nonNeg(apiPlayer.useFragGrenadeNum),
    useBurnGrenadeNum:     nonNeg(apiPlayer.useBurnGrenadeNum),
    useFlashGrenadeNum:    nonNeg(apiPlayer.useFlashGrenadeNum),
    PoisonTotalDamage:     nonNeg(apiPlayer.PoisonTotalDamage),
    UseSelfRescueTime:     nonNeg(apiPlayer.UseSelfRescueTime),
    UseEmergencyCallTime:  nonNeg(apiPlayer.UseEmergencyCallTime),
    heal:                  nonNeg(apiPlayer.heal),
  };
}

// ─── Cheap Fingerprinting (replaces full-object MD5 hashing on hot path) ─────
// Hashing the entire match object (including location/inventory noise) on
// every tick is wasted CPU. We only care about the fields logMatchDiff
// actually tracks, so fingerprint just those. TRACKED_FIELDS now lives in
// matchTeamDiff.js (imported above) so this gate and the player-level delta
// diff share one source of truth instead of drifting.

// Returns the raw parts array instead of hashing it — comparing two arrays
// element-by-element is cheaper than an MD5 digest on every tick, and we
// avoid a crypto call entirely on the (very common) no-change tick.
function computeFingerprintParts(matchData) {
  const parts = [];
  matchData.teams?.forEach(team => {
    parts.push(team.placePoints);
    team.players?.forEach(p => {
      for (const f of TRACKED_FIELDS) parts.push(p[f]);
    });
  });
  return parts;
}

function fingerprintsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Same idea as computeFingerprintParts, but over computeOverallMatchDataForRound's
// aggregated output — the per-tick match fingerprint gates whether we recompute
// the aggregate at all, but the aggregate itself was still resent even when
// identical to what was last sent (e.g. a tick that only changed a non-numeric
// field like `character` moves the match fingerprint but not the cumulative
// totals). This second gate skips that redundant `overallDataUpdate` emit.
function computeOverallFingerprintParts(teams) {
  const parts = [];
  (teams || []).forEach(team => {
    parts.push(team.placePoints, team.wwcd, team.matchesPlayed);
    (team.players || []).forEach(p => {
      for (const f of TRACKED_FIELDS) parts.push(p[f]);
    });
  });
  return parts;
}

const lastOverallFingerprintByUserMatch = {};
// Full overallTeams array from the last tick actually emitted for this
// cacheKey — diffed via computeChangedTeams (same helper the matchData path
// uses) so a standings tick only resends the teams that actually changed,
// instead of the entire round-wide roster every time any one team moves.
const lastOverallTeamsByUserMatch = {};

// Guards computeOverallMatchDataForRound (round-wide standings recompute —
// scans every MatchData in the round and re-aggregates every player) from
// running twice in parallel for the same match. This is NOT what gates
// userProcessing/tick acceptance below — it's fire-and-forget precisely so
// a slow round-wide recompute can never block the next live tick from being
// accepted (see emitUpdates).
const overallRecomputeInFlight = new Set(); // cacheKey (userKey:matchId)

// Set of dead team ids (from updateDeadTeamList) as of the last tick we
// bothered recomputing the round-wide standings for. Round totals (kills,
// damage, survivalTime, ...) are summed from every match's CURRENT live
// player stats regardless of whether that match has finished for a team —
// meaning the raw aggregate genuinely changes every tick a player is alive
// (survivalTime alone ticks up every second). Gating solely on
// computeOverallFingerprintParts never actually filters anything out as a
// result. Overall standings are only meaningful once a team's placement for
// a match is settled, so emitOverallUpdate is only invoked when a team's
// alive/dead status changed (or this is the first tick for this match) —
// not on every live combat-stat tick.
const lastDeadTeamIdsByUserMatch = {};

// ─── Event Debounce / Concurrency Guards ──────────────────────────────────────
const EVENT_DEBOUNCE_MS = 150;   // coalesce bursts of rapid game-tick pushes per user

// Leading+trailing, not pure trailing-edge: PCOB ticks arrive ~2s apart in
// the common case (isolated, not bursty), so a plain trailing-edge debounce
// (fire only after EVENT_DEBOUNCE_MS of silence) made almost every tick pay
// the full delay for no coalescing benefit. Firing immediately on the first
// tick after being idle (leading edge) removes that delay for the common
// case, while a single trailing fire still coalesces genuine bursts exactly
// as before.
const debounceStateByUser = new Map(); // userId -> { timer, pendingTrailing }

// userId -> boolean. Presence in the map means a run is currently in
// flight; the boolean value is a "rerun once more when this finishes" flag
// — same size-1 coalescing pattern as debounceStateByUser's pendingTrailing
// above. Previously a plain Set used as a drop-gate: a tick that arrived
// while the previous one was still running (e.g. a momentary Atlas latency
// spike, a cold cache-miss) was thrown away outright rather than delayed,
// so the viewer had to wait for the NEXT raw PCOB tick (~2s later) to catch
// up — reading as an irregular stall rather than a steady cadence. Now it
// just gets coalesced into one immediate follow-up run instead of lost.
const userProcessing = new Map();

// ─── Active User Tracking ───────────────────────────────────────────────────
// Populated purely by discovery of active MatchSelections in the DB — no
// per-user timers/intervals live here anymore. It's just "who should we
// update when the next socket push arrives".
const activeUserKeys = new Set();
const userKeyToDbId = new Map();

// DIAGNOSTIC (2026-08-23), throttled: discoverAndStartPollingUsers' pass
// summary below only needs to print when something actually changed —
// roundIds/selectedMatches/uniqueActiveUserIds are stable for long
// stretches, so logging every 10s pass unconditionally just repeats the
// same line forever once the system is steady.
let lastDiscoveryLogSignature = null;

// DIAGNOSTIC (2026-08-23): throttle for the "tick ignored, not in
// activeUserKeys" warning in triggerImmediateUpdateForUser below — ticks
// arrive every ~1-2s from a live relay, so an unthrottled log line there
// would flood the log for the entire duration of a stuck window instead of
// just marking its start/extent.
const lastActiveDropLoggedAt = new Map(); // userId -> ms timestamp
const ACTIVE_DROP_LOG_INTERVAL_MS = 5000;

// Called by isPollingactive.controller.js right after it flips a
// MatchSelection's isPollingActive, so a newly-toggled-on user's already-
// arriving relay ticks are accepted immediately instead of being silently
// dropped by triggerImmediateUpdateForUser() until the next
// discoverAndStartPollingUsers() pass (up to 10s away). Does the exact same
// per-user bookkeeping that function already does (see its
// activeUserKeys.add/userKeyToDbId.set below) — this just does it early,
// for one user, instead of waiting for the periodic sweep. Does not touch
// either cache's TTL/interval, or anything on the relay/registerRelay side.
function markUserActiveForPolling(userId) {
  const key = String(userId);
  const wasActive = activeUserKeys.has(key);
  activeUserKeys.add(key);
  userKeyToDbId.set(key, userId);
  if (!wasActive) console.log(`[activeUsers] + ${key} (direct mark, e.g. polling-toggle endpoint)`);
}
function markUserInactiveForPolling(userId) {
  const key = String(userId);
  const wasActive = activeUserKeys.has(key);
  activeUserKeys.delete(key);
  if (wasActive) console.log(`[activeUsers] - ${key} (direct mark, e.g. polling-toggle endpoint)`);
}

const lastMatchDataByUserMatch = {};
const lastFingerprintByUserMatch = {}; // stores fingerprint PARTS arrays, not hashes

// socket.id -> userId, so disconnect can clean up the right entries
const socketIdToUserId = new Map();

// ─── Binary Payload Decode Helper ──────────────────────────────────────────
// The relay now sends 'totalPlayerList' as MessagePack-encoded binary
// (Payload::Binary on the Rust side, via rmp_serde::to_vec_named) instead
// of plain JSON, to cut wire size/CPU on the hot live-tick path. Socket.IO
// hands binary attachments back here as a Buffer (Node) — decode() from
// @msgpack/msgpack accepts a Buffer/Uint8Array/ArrayBuffer directly.
//
// Kept permissive on purpose: if a raw JS object ever comes through
// instead (e.g. an older un-updated relay build still emitting JSON, or a
// dev/test client), we pass it through unchanged rather than throwing —
// so this one handler keeps working across a mixed-version rollout
// instead of requiring every relay to update in lockstep with this server.
function decodeTotalPlayerListPayload(raw) {
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (buf.length > 0 && buf[0] === 0x01) {
      // 0x01 prefix = raw-deflate-compressed msgpack (see fetcher.rs's
      // to_msgpack). A valid top-level msgpack map/array encoding never
      // starts with 0x01, so this byte unambiguously distinguishes the
      // compressed format from legacy raw msgpack — no per-connection
      // negotiation needed, safe across a mixed-version relay rollout.
      return decode(zlib.inflateRawSync(buf.subarray(1)));
    }
    return decode(buf);
  }
  // Already a plain object/array — nothing to decode (back-compat path).
  return raw;
}

// ─── Main Updater ─────────────────────────────────────────────────────────────
function startLiveMatchUpdater() {
  const io = getSocket();
  console.log('Socket.IO instance connected:', !!io);
  console.log(
    'live autosave: ' +
    (LIVE_AUTOSAVE_ENABLED ? 'ON (3s flush)' : 'OFF — manual SAVE DATA only')
  );

  // ── Receive live player data pushed from each user's local relay ───────────
  io.on('connection', (socket) => {
    console.log(c('dim', `[socket] client connected: ${socket.id} transport=${socket.conn.transport.name}${socket.recovered ? ' (recovered)' : ''}`));

    // connectionStateRecovery (socket.js): on a resumed session, rooms and
    // socket.data are restored and missed non-volatile packets are replayed —
    // but the per-socket wire-format registry is keyed by socket.id (NEW
    // after recovery), so re-seed it from the socket.data.wireFormat stashed
    // in joinRoundRoom, otherwise the first post-recovery emit for a protobuf
    // overlay would be split as msgpack until its next joinRoundRoom.
    if (socket.recovered && socket.data.wireFormat === 'protobuf') {
      setSocketWireFormat(socket.id, 'protobuf');
    }

    // DIAGNOSTIC (2026-08-23): fills the gap identified while chasing the
    // relay's ~2-4s connect/die flap — until now this app never logged
    // WHY the underlying engine.io transport actually closed/errored, only
    // the higher-level socket.io 'disconnect' (which never fires for a raw
    // transport-level failure — see the Rust relay's own '.on("error", ...)'
    // vs '.on("disconnect", ...)' split in fetcher.rs). Tagged with
    // socket.id (and socket.data.userId once registerRelay sets it) so
    // these correlate with the existing registerRelay/disconnect logs
    // below for the same socket.
    socket.conn.on('upgrade', () => {
      console.log(c('dim', `[engine] upgrade socket=${socket.id} user=${socket.data?.userId ?? 'n/a'} transport=${socket.conn.transport.name}`));
    });
    socket.conn.on('close', (reason, description) => {
      console.log(c('yellow', `[engine] transport close socket=${socket.id} user=${socket.data?.userId ?? 'n/a'} reason=${reason} description=${description ?? 'n/a'}`));
    });
    socket.conn.on('error', (err) => {
      console.error(c('red', `[engine] transport error socket=${socket.id} user=${socket.data?.userId ?? 'n/a'} error=${err}`));
    });

    // A cookie-bearing client (the dashboard) already has a verified
    // session by the time the socket handshake completes (io.engine.use
    // shares the same session middleware as Express) — auto-join it to its
    // own room so it receives the user-scoped liveMatchUpdate/
    // overallDataUpdate emits below without needing the relay's separate
    // token handshake (the relay has no cookie to present; this does).
    // Deliberately does not set socket.data.userId — that stays reserved
    // for the relay's own registration/eviction logic.
    const sessionUserId = socket.request.session?.userId;
    if (sessionUserId) {
      socket.join(`user:${sessionUserId}`);

      // Bandwidth: this dashboard socket can declare msgpack support for the
      // user: room's liveMatchUpdate via ?msgpackLiveUpdate=1 on the connect
      // query string. The liveMatchUpdate on this room is now always msgpack
      // (and a team-level DELTA — see emitUpdates below), so this flag is
      // effectively always true for real clients; kept for the log line and
      // in case a pre-msgpack client ever needs detecting.
      const supportsMsgpack = socket.handshake.query?.msgpackLiveUpdate === '1';
      socket.data.supportsMsgpackLiveUpdate = supportsMsgpack;
      console.log(c('cyan', `[socket] dashboard joined user:${sessionUserId} (${socket.id}) wire=${supportsMsgpack ? 'msgpack' : 'json'}`));

      // Full baseline for the delta stream. liveMatchUpdate on user:<id> is
      // a team-level delta now, so a dashboard that connects mid-match — or
      // RECONNECTS after an outage (socket.io makes a fresh socket + re-runs
      // this handler) — would otherwise only ever see partial teams. The
      // HTTP matchdata fetch on the dashboard's mount covers first load but
      // not a reconnect. Replay whatever full snapshots liveMatchCache holds
      // for this user's active match(es) — usually one; the client filters
      // by its own matchId/_id so any extra is harmless. msgpack, non-
      // volatile (a catch-up send must not be dropped under backpressure).
      //
      // Skipped on a recovered session (connectionStateRecovery): the missed
      // liveMatchUpdate deltas were already replayed, so a full re-send here
      // would just be redundant bytes.
      if (!socket.recovered) {
        const uidStr = String(sessionUserId);
        for (const [cacheKey, fullMatch] of liveMatchCache) {
          if (!cacheKey.startsWith(`${uidStr}:`)) continue;
          const hydratedMatchId = cacheKey.slice(uidStr.length + 1);
          socket.emit('liveMatchUpdate', encodeMsgpack({ ...fullMatch, matchId: hydratedMatchId }));
          console.log(c('dim', `[socket] user-room hydration -> ${socket.id} cacheKey=${cacheKey}`));
        }
      }
    }

    // Each relay identifies which user it belongs to before pushing data.
    // The relay has no session cookie to present (it's a bare WebSocket
    // connection from the desktop app, not a browser), so it can't reuse
    // the normal session-auth path — instead it presents the opaque
    // relayToken issued at login, and we resolve the real userId from
    // that server-side. A client-supplied userId is never trusted directly:
    // that's what let anyone claim to be any user, evict their live relay,
    // and inject fake stats into their overlay.
    //
    // NOTE: registerRelay itself is unaffected by the msgpack change — the
    // Rust side still emits it as a plain JSON object ({ relayToken }),
    // so this handler keeps receiving a normal JS object here.
    socket.on('registerRelay', async ({ relayToken } = {}, callback) => {
  // Application-level ack so the relay can tell "server accepted this
  // registration" apart from "the socket.io emit merely sent" — a
  // successful transport-level connect/emit says nothing about whether
  // this handler actually ran to completion and accepted the token.
  // Guarded so a relay build still doing a plain (non-ack) emit — where
  // socket.io hands us `callback === undefined` — is unaffected.
  const ack = (payload) => {
    // DIAGNOSTIC: symmetric with the Rust relay's client-side ack logging
    // (fetcher.rs await_register_ack). Covers every ack(...) call site
    // below. No relayToken/secret logged — only the boolean outcome and,
    // when present, the non-sensitive reason string.
    console.log(c('dim', `[socket][registerRelay] sending ACK to ${socket.id}: ok=${payload.ok}${payload.reason ? ` reason=${payload.reason}` : ''}`));
    if (typeof callback === 'function') callback(payload);
  };

  // DIAGNOSTIC: logged unconditionally, before any await, so a registerRelay
  // that never gets this far (vs. one that arrives but then stalls/dies
  // inside the DB lookup below) is distinguishable from the outside.
  const registerStartedAt = Date.now();
  console.log(c('dim', `[socket][registerRelay] received from ${socket.id} (mongoose readyState=${mongoose.connection.readyState})`));

  // The entire handler used to run with no try/catch. If User.findOne below
  // ever threw (or hung — see the race/timeout added there), this async
  // event handler died silently: no ack() call, no log line, nothing —
  // completely indistinguishable from the server never having received
  // registerRelay at all. That silent-death path is what let a slow/broken
  // Mongoose connection look identical to a transport/protocol bug from the
  // Rust side, which only ever sees "ack timed out after 5s". Wrapping the
  // whole handler guarantees SOME ack + log line comes back every time.
  try {
    if (!relayToken) {
      console.warn(c('yellow', `[socket] registerRelay from ${socket.id} missing relayToken`));
      ack({ ok: false, reason: 'missing relayToken' });
      return;
    }

    // Fast path: this socket already completed a full registration earlier
    // in its lifetime. A new socket.io connection always gets a fresh
    // socket.data object, so socket.data.userId being set here means this
    // can only be a keepalive re-emit on the SAME still-open connection —
    // the Rust relay's 5s watchdog re-emits registerRelay unconditionally
    // for the app's whole lifetime, not just on reconnect (see fetcher.rs).
    // Nothing about this socket's identity could have changed without a new
    // connection, so re-verifying relayToken against Mongo on every one of
    // these is pure waste. Safe to skip unconditionally: the relay is
    // fire-and-forget for registerRelay (fetcher.rs deliberately does NOT
    // use emit_with_ack — an earlier version that waited on the server's
    // ack "never once succeeded against the real deployed Render backend,
    // only against localhost" — so it never observes this ack's timing or
    // payload; skipping straight to it changes nothing the relay can see).
    if (socket.data.userId) {
      console.debug(`[socket] registerRelay keepalive from already-registered socket ${socket.id} (user=${socket.data.userId}) — skipping DB lookup`);
      ack({ ok: true, userId: socket.data.userId });
      return;
    }

    // This repo has already hit "Mongoose silently stalls against Atlas
    // when deployed on Render, but not locally" once before (see TODO.md's
    // "Fix Render Mongoose Timeout Issue" — its bufferTimeoutMS fix never
    // actually made it into index.js's mongoose.connect() call). Mongoose's
    // own default bufferTimeoutMS is 10s, comfortably longer than the Rust
    // relay's fixed 5s REGISTER_ACK_TIMEOUT (fetcher.rs) — so a buffering
    // stall in that 5-10s window lets Rust give up and disconnect long
    // before this line would have thrown or resolved on its own. Racing it
    // against an explicit 3s timeout makes the failure fast and LOUD
    // instead of silently outliving the caller.
    const REGISTER_DB_LOOKUP_TIMEOUT_MS = 3000;
    const user = await Promise.race([
      User.findOne({ relayToken }).select('_id').lean(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`User.findOne timed out after ${REGISTER_DB_LOOKUP_TIMEOUT_MS}ms (mongoose readyState=${mongoose.connection.readyState})`)),
          REGISTER_DB_LOOKUP_TIMEOUT_MS,
        )
      ),
    ]);
    console.log(c('dim', `[socket][registerRelay] DB lookup for ${socket.id} took ${Date.now() - registerStartedAt}ms`));

    if (!user) {
      console.warn(c('yellow', `[socket] registerRelay from ${socket.id} presented an unknown relayToken`));
      ack({ ok: false, reason: 'unknown relayToken' });
      return;
    }
    const key = String(user._id);

  // Evict any other socket already registered for this same user — this is
  // what happens when the app restarts without a clean disconnect: the old
  // socket lingers on Render and keeps pushing stale data until the new one
  // shows up. Force it closed immediately instead of waiting on a timeout.
  for (const [id, s] of io.sockets.sockets) {
    if (id !== socket.id && s.data?.userId === key) {
      console.log(c('yellow', `[socket] evicting stale relay ${id} for user ${key} (superseded by ${socket.id})`));
      // Told before being killed so the Rust relay can tell "I was
      // superseded by another device" apart from an ordinary network
      // drop and skip its usual auto-reconnect — see fetcher.rs's
      // "relayEvicted" handler. Same emit-then-disconnect pattern as
      // requestFullSnapshot elsewhere in this handler.
      s.emit('relayEvicted', { reason: 'superseded' });
      s.disconnect(true);
    }
  }

  socket.data.userId = key;
  socketIdToUserId.set(socket.id, key);
  socket.join(`user:${key}`);

  // Every registration — first-ever OR a reconnect replacing a stale
  // connection — rebinds socketId and resets lastReceivedSeq (so gap
  // detection doesn't misjudge the new connection's sequence numbering
  // against an old baseline), and forces an immediate full resync
  // rather than waiting for the relay's next natural tick or for a
  // gap to be detected.
  //
  // Deliberately PRESERVES the existing accumulated `players` Map
  // (if any) rather than resetting it to empty. A prior version reset
  // it here, which opened a window between this reset and the
  // requested full snapshot's response actually arriving: if any tick
  // — even a partial delta — landed in that window,
  // updateMatchDataWithLiveStats would unconditionally rebuild every
  // team's players array from that incomplete apiPlayers set (it does
  // this every tick, no backfill), wiping out previously-known players
  // (including ones no longer actively changing, e.g. already dead)
  // and persisting that empty roster straight to MatchData. Preserving
  // the map means the worst case during the resync window is
  // stale-but-present data, never a false disappearance — matching how
  // staleness is handled everywhere else in this pipeline. The eventual
  // full-snapshot response still wholesale-replaces this map as before
  // (see the totalPlayerList handler's isFull branch), so a genuine
  // reset (e.g. a real new match) is unaffected.
  const existing = relayStateByUser.get(key);
  if (existing?.socketId === socket.id) {
    // Same socket re-registering — e.g. the relay's periodic 20s keepalive
    // re-emitting registerRelay on a connection that never dropped. Nothing
    // about the connection actually changed, so don't reset the seq
    // baseline or force a full-roster resync: that used to happen on
    // EVERY keepalive, unconditionally re-sending the entire accumulated
    // roster every 20 seconds for the whole broadcast regardless of
    // whether anything changed, completely bypassing the delta protocol.
    console.debug(`[socket] registerRelay keepalive from already-registered socket ${socket.id} (user=${key}) — skipping resync`);
  } else {
    relayStateByUser.set(key, {
      socketId: socket.id,
      lastReceivedSeq: null,
      players: existing?.players ?? new Map(),
    });
    socket.emit('requestFullSnapshot');
  }

  console.log(c('cyan', `[socket] relay registered → user ${key} (${socket.id}, ${Date.now() - registerStartedAt}ms total)`));
  ack({ ok: true, userId: key });

  // Reconcile the relay's own sending_enabled with the DB truth on every
  // (re)registration. A polling toggle that happened while this relay was
  // mid-reconnect broadcasts pollingStatusUpdated into user:<id> and never
  // reaches a socket that wasn't in the room yet — this pushes the current
  // state to the freshly-(re)joined relay socket so the desktop/website
  // "Fetch Data" switch and the relay can't stay diverged. Fire-and-forget
  // AFTER the ack (must not delay it); goes only to this one socket. The
  // Rust `pollingStatusUpdated` handler reads `isPollingActive` and calls
  // set_sending_enabled, which no-ops when already at that value.
  //
  // Query is `isPollingActive: true` ONLY — NOT `isSelected: true` too.
  // updatePollingStatus never sets isSelected, so a selection that is
  // polling-active but not flagged isSelected (a normal state) would
  // otherwise make this push `{isPollingActive:false}` and wrongly disarm
  // the relay on every reconnect. This matches activeUserKeys /
  // stopAllPolling's own `exists({ userId, isPollingActive: true })`.
  MatchSelection.findOne({ userId: user._id, isPollingActive: true })
    .select('_id matchId roundId tournamentId')
    .lean()
    .then((sel) => {
      socket.emit('pollingStatusUpdated', sel
        ? { _id: sel._id, matchId: sel.matchId, roundId: sel.roundId, tournamentId: sel.tournamentId, isPollingActive: true, userStillActive: true, ts: Date.now() }
        : { isPollingActive: false, userStillActive: false, ts: Date.now() });
    })
    .catch((e) => console.warn(c('yellow', `[socket] registerRelay polling reconcile failed for ${key}: ${e.message}`)));
  } catch (err) {
    console.error(c('red', `[socket][registerRelay] handler FAILED for ${socket.id} after ${Date.now() - registerStartedAt}ms: ${err.message}`));
    ack({ ok: false, reason: 'internal error' });
  }
});

    socket.on('totalPlayerList', (raw) => {
      const userId = socket.data.userId;
      if (!userId) {
        console.warn(c('yellow', `[socket] totalPlayerList from unregistered socket ${socket.id} — ignored`));
        return;
      }

      // Reject a packet from a socket that isn't the currently-registered
      // one for this user. registerRelay's eviction loop calls
      // s.disconnect(true) on a superseded connection, but that does not
      // retroactively cancel a 'totalPlayerList' callback already queued
      // on the event loop for it — without this check, a stale packet
      // could land AFTER the new connection has already reset
      // relayStateByUser, corrupting its fresh seq/player baseline.
      const state = relayStateByUser.get(userId);
      if (!state || state.socketId !== socket.id) {
        console.warn(
          c('yellow', `[socket] totalPlayerList from STALE/evicted socket ${socket.id} (user=${userId}, active=${state?.socketId ?? 'none'}) — ignored`)
        );
        return;
      }

      // Wire size (bytes actually received over the socket, compressed) —
      // logged below alongside the tick's player counts so bandwidth usage
      // is visible per-tick without needing a separate instrumentation pass.
      const wireBytes = Buffer.isBuffer(raw) ? raw.length
        : (raw instanceof ArrayBuffer ? raw.byteLength : (raw?.length ?? 0));

      // Decode the MessagePack binary payload back into a plain object
      // before anything else touches it.
      let data;
      try {
        data = decodeTotalPlayerListPayload(raw);
      } catch (e) {
        // TEMP DIAGNOSTIC (see plan doc "Part B"): every decode failure so
        // far has consumed exactly 1 byte before erroring, which only
        // happens on the no-inflate branch of decodeTotalPlayerListPayload
        // — i.e. buf[0] is never the expected 0x01 prefix. Logging the raw
        // type/length/leading bytes pins down exactly what's arriving
        // instead of the expected [0x01, ...deflate-compressed msgpack].
        const isBuf = Buffer.isBuffer(raw) || raw instanceof Uint8Array || raw instanceof ArrayBuffer;
        const buf = isBuf ? (Buffer.isBuffer(raw) ? raw : Buffer.from(raw)) : null;
        console.error(c('red', `[socket] failed to decode msgpack totalPlayerList from ${socket.id} (user=${userId}): ${e.message}`));
        console.error(c('red', `[socket][diag] raw type=${isBuf ? 'binary' : typeof raw} length=${buf ? buf.length : (raw?.length ?? 'n/a')} first16Hex=${buf ? buf.subarray(0, 16).toString('hex') : 'n/a'}`));
        return;
      }

      const incomingPlayers = Array.isArray(data?.playerInfoList) ? data.playerInfoList
        : Array.isArray(data) ? data : [];
      const wireSeq = typeof data?.wireSeq === 'number' ? data.wireSeq : null;
      // No wireSeq at all ⇒ an un-updated relay build that always sends
      // the complete roster with no isFull flag — treat as full for
      // back-compat during a mixed-version rollout, regardless of
      // data.isFull's value.
      const isFull = data?.isFull === true || wireSeq === null;

      if (isFull) {
        // Never regress: the pending-retry path on the relay can deliver a
        // full snapshot for an "old" wireSeq well after newer deltas (or
        // another full snapshot) already landed — the relay has several
        // independent full-snapshot senders (resume-push, requestFullSnapshot's
        // own response, a new-match reset, and a background retry loop that
        // can take minutes to finally land), any of which can arrive out of
        // order. Unlike the delta branch below, this used to apply
        // unconditionally regardless of ordering, silently reverting
        // health/liveState/bHasDied/etc. for every player it contained —
        // the source of the rapid dead/alive-and-health-flicker bug. Now it
        // gets the same "don't regress already-applied state" treatment:
        // a stale full snapshot only backfills players not already known,
        // it never overwrites fresher data.
        const isStaleFull = wireSeq != null && state.lastReceivedSeq != null && wireSeq < state.lastReceivedSeq;
        if (isStaleFull) {
          for (const p of incomingPlayers) {
            const uid = playerKeyOf(p);
            if (uid != null && !state.players.has(uid)) state.players.set(uid, p);
          }
          console.debug(`[socket] stale full snapshot (wireSeq=${wireSeq} < ${state.lastReceivedSeq}) user=${userId} — merged unseen players only, did not overwrite`);
        } else {
          state.players = new Map();
          for (const p of incomingPlayers) {
            const uid = playerKeyOf(p);
            if (uid != null) state.players.set(uid, p);
          }
        }
        if (wireSeq != null) {
          state.lastReceivedSeq = state.lastReceivedSeq == null
            ? wireSeq
            : Math.max(state.lastReceivedSeq, wireSeq);
        }
      } else {
        if (state.lastReceivedSeq != null && wireSeq <= state.lastReceivedSeq) {
          // Stale/out-of-order-low delta (e.g. a slow retry attempt that
          // finally landed after fresher ticks already arrived) — drop
          // it rather than risk regressing a monotonically-increasing
          // stat field backward. Whatever it had is already superseded.
          console.debug(`[socket] dropping out-of-order-low delta (wireSeq=${wireSeq}, already at ${state.lastReceivedSeq}) user=${userId}`);
          return;
        }
        const expected = state.lastReceivedSeq == null ? null : state.lastReceivedSeq + 1;
        if (expected !== null && wireSeq !== expected) {
          console.warn(
            c('yellow', `[socket] totalPlayerList GAP user=${userId}: expected wireSeq ${expected}, got ${wireSeq} — requesting resync`)
          );
          socket.emit('requestFullSnapshot');
          // Still merge what DID arrive below — don't discard useful
          // partial data while the resync is in flight.
        }
        for (const p of incomingPlayers) {
          const uid = playerKeyOf(p);
          if (uid != null) {
            // Shallow-merge rather than overwrite: the relay already sends
            // field-level patches for an existing player (fetcher.rs's
            // field_diff — only the fields that actually changed, plus
            // uId), not a complete object. This merge is what makes that
            // safe — an overwrite would silently null out every field the
            // patch didn't include. Only a brand-new player (no prior
            // baseline on the relay side) or a full-snapshot tick ever
            // arrives here as a complete object.
            const prev = state.players.get(uid);
            state.players.set(uid, prev ? { ...prev, ...p } : p);
          }
        }
        state.lastReceivedSeq = wireSeq;
      }

      const players = Array.from(state.players.values());
      liveApiPlayersByUser.set(userId, { players, at: Date.now() });

      // BANDWIDTH + SOCKET: the one line that matters for "are we getting
      // data, and how much is it costing us" — wire bytes actually received
      // (post-compression), full vs delta, and player counts, per tick.
      console.log(`[socket] rx totalPlayerList user=${userId} ${wireBytes}B ${isFull ? 'full' : 'delta'} seq=${wireSeq ?? 'n/a'} players=${incomingPlayers.length}/${players.length}`);

      // Leading+trailing per user: bursts from ONE user's relay still
      // coalesce (trailing fire), but an isolated tick (the common case at
      // PCOB's ~2s cadence) fires immediately instead of always paying the
      // full EVENT_DEBOUNCE_MS delay for no coalescing benefit.
      const debounceState = debounceStateByUser.get(userId);
      if (!debounceState) {
        triggerImmediateUpdateForUser(userId).catch(err =>
          console.error(`[trigger] user ${userId} error:`, err)
        );
        const timer = setTimeout(() => {
          const s = debounceStateByUser.get(userId);
          debounceStateByUser.delete(userId);
          if (s && s.pendingTrailing) {
            triggerImmediateUpdateForUser(userId).catch(err =>
              console.error(`[trigger] user ${userId} error:`, err)
            );
          }
        }, EVENT_DEBOUNCE_MS);
        debounceStateByUser.set(userId, { timer, pendingTrailing: false });
      } else {
        debounceState.pendingTrailing = true;
      }
    });

    // Public overlay room join — anonymous, no auth (mirrors the old
    // joinBulkRoom/leaveBulkRoom from comsock.js). Scoped per round rather
    // than per match so a followSelected overlay keeps receiving whichever
    // match is currently selected, without needing to rejoin on a switch.
    socket.on('joinRoundRoom', async ({ tournamentId, roundId, view, wireFormat, tiers } = {}) => {
      if (!tournamentId || !roundId) return;

      // Leave whatever round/tier this socket was previously scoped to
      // before joining the new one(s) — covers BOTH a view/wireFormat
      // switch on the SAME round (which used to leave the socket in both
      // matchData and matchDataPositional at once, double-delivering every
      // tick) and a switch to a DIFFERENT round entirely (which used to
      // leave the socket still subscribed to the old round's rooms
      // forever, since only the client-initiated leaveRoundRoom event ever
      // called socket.leave). socket.leave on a room the socket isn't in
      // is a documented no-op, so this is safe to call unconditionally.
      const prevScope = socket.data.roundRoomScope;
      if (prevScope) {
        socket.leave(`round:${prevScope.tournamentId}:${prevScope.roundId}:matchData`);
        socket.leave(`round:${prevScope.tournamentId}:${prevScope.roundId}:matchDataPositional`);
        socket.leave(`round:${prevScope.tournamentId}:${prevScope.roundId}:overall`);
        socket.leave(`round:${prevScope.tournamentId}:${prevScope.roundId}:control`);
      }
      socket.data.roundRoomScope = { tournamentId, roundId };

      // Every overlay for this round joins :control regardless of `view`, so
      // a structural change (matches list / selection / schedule) reaches
      // even views that need no live tier. Hand this socket the current
      // structure version straight back as its baseline for future
      // roundStructureChanged events and for its own reconnect check —
      // replaces the overlay's old blind 10-min poll + unconditional
      // refetch-on-every-reconnect. See utils/roundStructure.js.
      socket.join(`round:${tournamentId}:${roundId}:control`);
      socket.emit('roundStructureChanged', {
        tournamentId,
        roundId,
        version: getRoundStructureVersion(tournamentId, roundId),
      });

      if (wireFormat === 'protobuf') {
        setSocketWireFormat(socket.id, 'protobuf');
      } else {
        // Missing else branch previously: a socket that had negotiated
        // protobuf on an earlier joinRoundRoom call (e.g. before a view
        // switch back to the msgpack default) kept that stale registry
        // entry forever — getSocketWireFormat has no other way to learn
        // the socket moved away from protobuf short of it disconnecting.
        clearSocketWireFormat(socket.id);
      }
      // Stashed on socket.data so connectionStateRecovery restores it — the
      // wire-format registry itself is keyed by socket.id, which changes on
      // recovery (see the `socket.recovered` re-seed in io.on('connection')).
      socket.data.wireFormat = wireFormat === 'protobuf' ? 'protobuf' : 'msgpack';

      const matchDataRoom = `round:${tournamentId}:${roundId}:matchData`;
      const matchDataPositionalRoom = `round:${tournamentId}:${roundId}:matchDataPositional`;
      const overallRoom = `round:${tournamentId}:${roundId}:overall`;

      // A missing `view` means an old/pre-deploy overlay build (never sends
      // it) — treat that as "needs everything" so an already-open OBS
      // Browser Source mid-broadcast never silently goes dark because of a
      // deploy. A recognized view only joins the tier(s) it actually needs.
      //
      // matchDataPositional's payload is a strict superset of matchData's
      // (core fields + location), so a socket joins ONE of the two rooms,
      // never both — joining both would double-deliver every core field on
      // every tick a position-needing view is present in the same match.
      //
      // `tiers` (optional): an explicit list of live-data tiers the caller
      // wants — any of 'matchData' | 'matchDataPositional' | 'overall'
      // | 'control'. Used by the desktop overlay relay (desktop-app/relay/
      // server.cjs), which fans ONE upstream connection out to many local OBS
      // Browser Sources and so must ask for exactly the union of tiers its
      // local consumers need, independent of any single `view`. When absent
      // (every non-relay caller, and any old build) the `view` -> tier
      // mapping is used unchanged. `control` is always joined regardless, so
      // `tiers` only actually gates matchData / matchDataPositional / overall.
      const explicitTiers = Array.isArray(tiers) && tiers.length > 0 ? new Set(tiers) : null;
      const joinOverall = explicitTiers
        ? explicitTiers.has('overall')
        : (!view || VIEWS_NEEDING_OVERALL.has(view));
      const needsPositional = explicitTiers
        ? explicitTiers.has('matchDataPositional')
        : (!view || VIEWS_NEEDING_POSITIONAL_DATA.has(view));
      const needsMatchData = explicitTiers
        ? explicitTiers.has('matchData')
        : (!view || VIEWS_NEEDING_MATCH_DATA.has(view));
      const joinMatchDataPositional = needsPositional;
      const joinMatchData = needsMatchData && !needsPositional;

      if (joinMatchDataPositional) socket.join(matchDataPositionalRoom);
      else if (joinMatchData) socket.join(matchDataRoom);
      if (joinOverall) socket.join(overallRoom);

      console.log(`[bw][room] socket ${socket.id} joinRoundRoom view=${view ?? '(none)'} tiers=${explicitTiers ? [...explicitTiers].join('+') : '(none)'} wireFormat=${wireFormat ?? 'msgpack'} -> matchData=${joinMatchData} matchDataPositional=${joinMatchDataPositional} overall=${joinOverall}`);

      // Instant hydration: without this, a socket that just joined gets
      // nothing until the NEXT live tick from the desktop relay — could be
      // seconds away, or never if the relay isn't actively ticking (e.g.
      // no roster change). liveMatchCache already holds the last full
      // match-data object for exactly this purpose; it's just never been
      // read from here before. Scoped to matchData/matchDataPositional
      // only — the :overall room has no equivalent full-snapshot cache
      // (only a last-delta cache), and computing one synchronously here
      // would mean running computeOverallMatchDataForRound (already
      // documented above as the most expensive step in the tick path) on
      // every single join, which is out of scope for this fix.
      if (!joinMatchData && !joinMatchDataPositional) return;
      try {
        // isSelected is unique per (tournamentId, roundId) globally (see
        // MatchSelection.controller.js's selectMatch, which unconditionally
        // clears isSelected for every other selection in that round before
        // setting the new one) — this needs no session/auth, so it also
        // works for the fully anonymous public-overlay case this handler's
        // own comment says it must support.
        const selection = await MatchSelection.findOne({ tournamentId, roundId, isSelected: true })
          .select('userId matchId')
          .lean();
        if (!selection) return;
        const cacheKey = `${String(selection.userId)}:${String(selection.matchId)}`;
        const memoryMatch = liveMatchCache.get(cacheKey);
        if (!memoryMatch) return;

        // volatile:false deliberately, unlike the regular tick path above
        // — this is a one-shot catch-up send for a socket that has nothing
        // yet, so it must not be silently dropped under backpressure the
        // way a routine tick's delta safely can be.
        const basePayload = { ...memoryMatch, matchId: String(selection.matchId) };
        if (joinMatchDataPositional) {
          emitToRoomSplitByFormat(io, [socket.id], 'liveMatchUpdate', {
            protoMessageName: 'MatchDataPayload',
            mapToProto: toProtoMatchDataPayload,
            data: { ...basePayload, teams: memoryMatch.teams },
            volatile: false,
          });
        } else {
          emitToRoomSplitByFormat(io, [socket.id], 'liveMatchUpdate', {
            protoMessageName: 'MatchDataPayload',
            mapToProto: toProtoMatchDataPayload,
            data: { ...basePayload, teams: stripPositionalFields(memoryMatch.teams) },
            volatile: false,
          });
        }
      } catch (err) {
        console.error(`[bw][room] joinRoundRoom hydration failed for ${socket.id}:`, err.message);
      }
    });

    socket.on('leaveRoundRoom', ({ tournamentId, roundId } = {}) => {
      if (!tournamentId || !roundId) return;
      socket.leave(`round:${tournamentId}:${roundId}:matchData`);
      socket.leave(`round:${tournamentId}:${roundId}:matchDataPositional`);
      socket.leave(`round:${tournamentId}:${roundId}:overall`);
      socket.leave(`round:${tournamentId}:${roundId}:control`);
      // Keep joinRoundRoom's own leave-before-join bookkeeping in sync —
      // an explicit leave here means there's no longer a "previous scope"
      // for a later joinRoundRoom call to redundantly (harmlessly) leave.
      if (
        socket.data.roundRoomScope &&
        socket.data.roundRoomScope.tournamentId === tournamentId &&
        socket.data.roundRoomScope.roundId === roundId
      ) {
        delete socket.data.roundRoomScope;
      }
      console.log(`[bw][room] socket ${socket.id} leaveRoundRoom tournamentId=${tournamentId} roundId=${roundId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(c('dim', `[socket] client disconnected: ${socket.id} (reason=${reason})`));
      clearSocketWireFormat(socket.id);
      const userId = socketIdToUserId.get(socket.id);
      socketIdToUserId.delete(socket.id);
      if (!userId) return;

      // Only clear relay wire-protocol state if THIS was the currently-
      // authoritative connection for the user — a belated disconnect from
      // an already-evicted/superseded socket must not clobber a newer
      // connection's already-registered seq/player state.
      const relayState = relayStateByUser.get(userId);
      if (relayState && relayState.socketId === socket.id) {
        relayStateByUser.delete(userId);
      }

      // Only clear this user's live-data state if no other socket (e.g. a
      // reconnect already in flight, or a second device) still claims them.
      const stillConnected = [...io.sockets.sockets.values()]
        .some(s => s.id !== socket.id && s.data?.userId === userId);

      if (!stillConnected) {
        liveApiPlayersByUser.delete(userId);
        const debounceState = debounceStateByUser.get(userId);
        if (debounceState) {
          clearTimeout(debounceState.timer);
          debounceStateByUser.delete(userId);
        }
        console.log(c('dim', `[socket] cleared relay state for user ${userId}`));
      }
    });
  });

  if (mongoose.connection.readyState === 1) {
    ensureIndexes();
  } else {
    mongoose.connection.once('open', ensureIndexes);
  }

  // Ticks slower than this get an always-on (not gated by VERBOSE_MATCH_LOGS)
  // warning logged, so remaining latency variance is measurable in
  // production instead of guessed at. Deliberately just one line per slow
  // pass, not a per-field table — cheap enough to leave on permanently.
  const SLOW_POLL_THRESHOLD_MS = 500;

  // ── Fired on every debounced socket push, scoped to ONE user ────────────
  // Size-1 coalescing: if a new tick arrives while a previous one for this
  // user is still running, it doesn't get dropped — it flags "run once more
  // immediately after this finishes" (same pattern as debounceStateByUser's
  // pendingTrailing above), so a single slow pass costs at most one extra
  // immediate re-run instead of a full ~2s wait for the next raw PCOB tick.
  async function triggerImmediateUpdateForUser(userId) {
    if (!activeUserKeys.has(userId)) {
      // DIAGNOSTIC (2026-08-23): this was a completely silent drop before —
      // a totalPlayerList tick can arrive, decode fine, and update
      // liveApiPlayersByUser (see the socket handler), but never reach
      // matchData/the broadcast because of this gate, with zero trace in
      // the log. Throttled — see ACTIVE_DROP_LOG_INTERVAL_MS.
      const now = Date.now();
      const lastLogged = lastActiveDropLoggedAt.get(userId) || 0;
      if (now - lastLogged >= ACTIVE_DROP_LOG_INTERVAL_MS) {
        lastActiveDropLoggedAt.set(userId, now);
        console.warn(`[trigger] user=${userId} tick ignored — not in activeUserKeys (data received but not processed)`);
      }
      return; // not an active/polling user — ignore
    }
    lastActiveDropLoggedAt.delete(userId);
    if (userProcessing.has(userId)) {
      userProcessing.set(userId, true);
      console.debug(`[trigger] user=${userId} tick arrived mid-pass — coalescing into follow-up run`);
      return;
    }
    userProcessing.set(userId, false);
    try {
      do {
        userProcessing.set(userId, false);
        const startedAt = Date.now();
        const hadChanges = await pollForUser(userId);
        const elapsed = Date.now() - startedAt;
        console.debug(`[trigger] pollForUser(${userId}) done in ${elapsed}ms hadChanges=${hadChanges}`);
        if (elapsed > SLOW_POLL_THRESHOLD_MS) {
          console.warn(`[perf] pollForUser(${userId}) took ${elapsed}ms`);
        }
      } while (userProcessing.get(userId));
    } finally {
      userProcessing.delete(userId);
    }
  }

  // ─── Core Match Update ──────────────────────────────────────────────────────
  const updateMatchDataWithLiveStats = async (matchId, userId, apiPlayers, apiPlayersAt) => {
    // These two queries don't depend on each other — run in parallel.
    // Both .lean() — matchData is never saved directly here (writes go
    // through the bulkWrite saveQueue below), so the Mongoose document
    // hydration/change-tracking overhead was paid every ~2s tick for
    // nothing; team mutations below just operate on the plain object.
    const [matchData, selectedMatch] = await Promise.all([
      MatchData.findOne({ matchId, userId }).lean(),
      MatchSelection.findOne({ matchId, isSelected: true, userId }).lean(),
    ]);

    if (!matchData) {
      console.log('No MatchData found for matchId:', matchId);
      return null;
    }

    const tournamentId = selectedMatch?.tournamentId;
    if (!tournamentId) {
      console.log('Cannot find tournamentId for matchId:', matchId);
      return null;
    }

    const groups = await getGroupsCached(tournamentId, userId);
    if (!groups || groups.length === 0) {
      console.log('No group found for tournament:', tournamentId.toString());
      return null;
    }

    if (!apiPlayers?.length) {
      console.warn(`⚠️  No live player data received via socket yet for user=${userId} — skipping this cycle`);
      return matchData;
    }

    const STALE_MS = 15000;
    if (apiPlayersAt && Date.now() - apiPlayersAt > STALE_MS) {
      console.warn(
        `⚠️  Player data is stale (${Math.round((Date.now() - apiPlayersAt) / 1000)}s old) for user=${userId} — relay may be disconnected`
      );
    }

    const normalizeId = id => (id ? String(id).trim() : '');

    // Case-fold and strip whitespace/punctuation/symbols (Unicode-aware —
    // covers ASCII brackets/dashes as well as common decorative clan-tag
    // separators like full-width brackets or a katakana middle dot) before
    // comparing names for the roster-rescue fallback below. Real
    // letters/digits in any script are left alone, so two genuinely
    // different names still won't collide — this only rescues names that
    // differ purely in formatting.
    const normalizeNameForMatch = name => String(name).toLowerCase().replace(/[\p{P}\p{S}\p{Z}]/gu, '');

    // Pre-index every group's slots by team _id once, instead of a linear
    // `slots.find(...)` scan per team below (was O(teams × slots)). Spans
    // ALL groups for this tournament+user (not just one) — a team's
    // roster can live in any of them (e.g. "Group A"/"Group B"), and a
    // team is only ever expected to appear in one group's slots, so
    // flattening across groups carries no meaningful collision risk.
    const groupSlotByTeamId = new Map();
    for (const g of groups) {
      for (const s of g.slots || []) {
        if (s.team?._id) groupSlotByTeamId.set(s.team._id.toString(), s);
      }
    }

    // groupPlayers per team — used only to enrich a live player's
    // name/photo/openId (see the matchPlayer/grpPlayer lookups below),
    // never for team routing.
    const teamGroupPlayers = new Map(); // teamId (string) -> groupPlayers[]
    for (const t of matchData.teams) {
      const gSlot = groupSlotByTeamId.get(t.teamId.toString());
      teamGroupPlayers.set(String(t.teamId), gSlot?.team?.players || []);
    }

    // Team routing is a pure function of THIS tick: every apiPlayer sharing
    // the same live apiPlayer.teamId is one in-game squad, grouped together
    // and attached, as a whole, to the ONE tournament team whose slot
    // number equals that teamId. Deterministic and stateless — unlike a
    // roster/continuity-based resolver, nothing here depends on what a
    // previous tick (or the roster) decided, so a bad read can never get
    // permanently "stuck": every tick re-derives fresh from the live
    // payload.
    const apiPlayersByTeamId = new Map(); // Number(apiTeamId) -> apiPlayer[]
    for (const p of apiPlayers) {
      const apiTeamId = Number(p.teamId);
      if (Number.isNaN(apiTeamId)) continue;
      const list = apiPlayersByTeamId.get(apiTeamId);
      if (list) list.push(p); else apiPlayersByTeamId.set(apiTeamId, [p]);
    }

    // Fed below with only players that ALREADY have a known identity this
    // tick (matchPlayer from a prior tick, or grpPlayer from the admin
    // roster) — kept deliberately conservative, unlike live-display
    // routing above. This permanent, cross-tournament roster was
    // specifically hardened once against blindly trusting
    // apiTeamId === slot: an unrelated squad's ephemeral teamId colliding
    // with a team's slot number used to permanently corrupt the wrong
    // team's roster. A bare teamId/slot match on a never-before-seen uid
    // is not reliable enough grounds for a PERMANENT roster write.
    const resolvedPlayersByTeamId = new Map(); // teamDbId(string) -> apiPlayer[]

    // Whether this tick actually added/removed a uid from
    // unmatchedPlayersByMatch (not just refreshed lastSeenAt on an
    // already-unmatched player) — gates the unmatchedPlayersUpdate socket
    // emit in pollForUser below, so a persistently-unmatched player doesn't
    // trigger an emit every tick.
    let unmatchedSetChanged = false;

    for (const team of matchData.teams) {
      const newTeamPlayers = [];
      const usedUIds = new Set();

      const groupPlayers = teamGroupPlayers.get(String(team.teamId)) || [];
      const teamApiPlayers = apiPlayersByTeamId.get(Number(team.slot)) || [];
      const matchDataByUid = new Map((team.players || []).map(p => [normalizeId(p.uId), p]));

      for (const apiPlayer of teamApiPlayers) {
        if (newTeamPlayers.length >= 4) break;
        const uid = normalizeId(apiPlayer.uId);
        if (usedUIds.has(uid)) continue;

        const matchPlayer = matchDataByUid.get(uid);
        let grpPlayer = groupPlayers.find(p => normalizeId(p.playerId) === uid);

        // Fallback for a roster player whose playerId is missing/mistyped:
        // try matching by playerName (trimmed, case-insensitive) within
        // THIS team's own roster only — groupPlayers is already scoped to
        // `team`, so no cross-team risk. Rescues already-existing rosters
        // with bad playerId data (new writes are now validated at the
        // source — see teams.controller.js's validatePlayerIds) without
        // needing a manual re-entry, and is what lets the roster photo
        // (grpPlayer.photo, below) still get attached.
        if (!matchPlayer && !grpPlayer && apiPlayer.playerName) {
          const apiNameNorm = normalizeNameForMatch(apiPlayer.playerName);
          if (apiNameNorm) {
            grpPlayer = groupPlayers.find(
              p => p.playerName && normalizeNameForMatch(p.playerName) === apiNameNorm
            );
          }
        }

        let finalPlayer;
        if (matchPlayer || grpPlayer) {
          finalPlayer = {
            ...apiPlayer,
            _id:                   matchPlayer?._id || new mongoose.Types.ObjectId(),
            uId:                   uid,
            playerOpenId:          matchPlayer?.playerOpenId  || grpPlayer?.playerOpenId  || apiPlayer.playerOpenId || '',
            playerName:            matchPlayer?.playerName?.trim() || grpPlayer?.playerName?.trim() || apiPlayer.playerName,
            picUrl:                matchPlayer?.picUrl?.trim() || grpPlayer?.photo?.trim() || apiPlayer.picUrl || '',
            showPicUrl:            '',
            teamIdfromApi:         team.slot,
            location:              apiPlayer.location || { x: 0, y: 0, z: 0 },
            bHasDied:              apiPlayer.liveState === 5,
            ...clampedNumericPlayerStats(apiPlayer),
            isFiring:              apiPlayer.isFiring             || false,
            isOutsideBlueCircle:   apiPlayer.isOutsideBlueCircle || false,
            teamId:                apiPlayer.teamId,
            teamName:              apiPlayer.teamName             || '',
            character:             apiPlayer.character            || 'None',
            playerKey:             apiPlayer.playerKey            || 0,
          };

          const teamDbId = String(team.teamId);
          const list = resolvedPlayersByTeamId.get(teamDbId);
          if (list) list.push(apiPlayer); else resolvedPlayersByTeamId.set(teamDbId, [apiPlayer]);
          if (markMatched(matchId, uid)) unmatchedSetChanged = true;
        } else {
          logUnmatchedPlayer(matchId, uid, apiPlayer.playerName);
          if (markUnmatched(matchId, uid, apiPlayer.playerName)) unmatchedSetChanged = true;

          finalPlayer = {
            ...apiPlayer,
            _id:           new mongoose.Types.ObjectId(),
            uId:           uid,
            teamIdfromApi: team.slot,
            location:      apiPlayer.location || { x: 0, y: 0, z: 0 },
            bHasDied:      apiPlayer.liveState === 5,
            picUrl:        apiPlayer.picUrl || '',
            showPicUrl:    '',
            playerName:    apiPlayer.playerName,
            // `...apiPlayer` above spreads every raw field unguarded — same
            // -1-sentinel leak as the branch above, so re-clamp the full
            // numeric-stat field list the same way (shared helper keeps the
            // two branches' field lists from drifting apart again).
            ...clampedNumericPlayerStats(apiPlayer),
          };
        }

        newTeamPlayers.push(finalPlayer);
        usedUIds.add(uid);
      }

      // null (not 0) when this tick reported no live players for this team
      // at all — 0 is a real rank value ("still alive, unplaced"), so it
      // must stay distinguishable from "no data this tick." Without this
      // distinction, any single tick with an empty/missing live feed for an
      // already-ranked team (API gap, PCOB reconnect, timing jitter around
      // their elimination) would blow away their earned placePoints back to
      // 0 below, then have it jump back up once good data resumed — which
      // is exactly the "overall total flickers down and up" symptom, since
      // computeOverallMatchDataForRound sums this field live every tick.
      const teamRank = newTeamPlayers.length
        ? Math.min(...newTeamPlayers.map(p => p.rank || 0))
        : null;

      // A manual correction via updateTeamPoints locks placePoints/rank —
      // leave them alone until an operator explicitly unlocks, instead of
      // silently reverting the correction on this tick. Same treatment for
      // a no-data tick (teamRank === null): keep the last-known rank/points
      // rather than resetting them, mirroring how team.players below is
      // allowed to go empty without that being read as "eliminated."
      if (!team.placePointsLocked && teamRank !== null) {
        team.rank = teamRank;
        team.placePoints = ((rank) => {
          switch (rank) {
            case 1: return 10;
            case 2: return 6;
            case 3: return 5;
            case 4: return 4;
            case 5: return 3;
            case 6: return 2;
            case 7: return 1;
            case 8: return 1;
            default: return 0;
          }
        })(teamRank);
      }

      // team.players reflects only players actually reported live by the
      // API this tick — no backfilling from the registered roster. A team
      // with fewer live players than its roster size simply has fewer
      // entries here; see isTeamAllDead (Bulkpublic.controller.js) and its
      // frontend mirror (PublicThemeRenderer.tsx) for how elimination is
      // detected without assuming a fixed 4-player array.
      team.players = newTeamPlayers;
    }

    // A player who fails to resolve against the roster this tick (the
    // `else` branch above) gets picUrl/playerName wiped to '' with no
    // retry within this function — this is the one place that can backfill
    // it before the tick is persisted/emitted, using the same identity
    // cache the public bulk endpoints already rely on for "result" screens.
    hydrateMatchDataIdentity(matchData, tournamentId);

    // Reconcile the Teams collection exactly once per match, on the first
    // tick that actually has live player data — not on every tick. A
    // roster change mid-match is intentionally NOT chased after this;
    // the next match's own first snapshot is what picks up a new lineup.
    if (!matchData.rosterSynced && resolvedPlayersByTeamId.size > 0) {
      updateTeamsWithApiPlayers(resolvedPlayersByTeamId, matchId, userId).catch(err =>
        console.error(`[updateTeamsWithApiPlayers] user ${userId} match ${matchId}:`, err.message)
      );
      matchData.rosterSynced = true;
      MatchData.updateOne({ matchId, userId }, { $set: { rosterSynced: true } }).catch(err =>
        console.error(`[rosterSynced] user ${userId} match ${matchId}:`, err.message)
      );
    }

    const updatedObject = matchData;
    const cacheKey = `${String(userId)}:${String(matchId)}`;

    // Skip the DB write (and cache overwrite) entirely if nothing tracked
    // actually changed since last tick — most ticks for most matches are
    // no-ops, so this is the biggest lever once many matches run at once.
    const newFingerprint = computeFingerprintParts(updatedObject);
    const prevFingerprint = lastFingerprintByUserMatch[cacheKey];
    const unchanged = fingerprintsEqual(newFingerprint, prevFingerprint);

    if (unchanged) {
      return { data: updatedObject, changed: false, unmatchedChanged: unmatchedSetChanged };
    }

    liveMatchCache.set(cacheKey, updatedObject);
    lastFingerprintByUserMatch[cacheKey] = newFingerprint;

    // Overwrites any still-pending snapshot for this match — see the
    // Background Save Queue definition above for why the flush is
    // deliberately deferred to a timer instead of happening right here.
    // Gated on LIVE_AUTOSAVE_ENABLED: with automatic persistence off nothing
    // drains saveQueue, so populating it would just leak memory. The manual
    // SAVE DATA path (saveLiveMatchSnapshot) reads liveMatchCache above, not
    // this queue.
    if (LIVE_AUTOSAVE_ENABLED) {
      saveQueue.set(cacheKey, {
        matchId,
        userId,
        teams: updatedObject.teams,
      });

      if (VERBOSE_MATCH_LOGS) {
        console.log(
          `${c('dim', `[${new Date().toLocaleTimeString()}]`)} ` +
          `${c('green', '✔ DB update queued')} for match=${matchId} user=${String(userId)}`
        );
      }
    }

    return { data: updatedObject, changed: true, unmatchedChanged: unmatchedSetChanged };
  };

  // ─── Per-User Update Pass ───────────────────────────────────────────────────
  const pollForUser = async (userKey) => {
    if (!userKey) return false;

    let hadChanges = false;
    const dbUserId =
      userKeyToDbId.get(String(userKey)) ||
      (mongoose.Types.ObjectId.isValid(String(userKey))
        ? new mongoose.Types.ObjectId(String(userKey))
        : userKey);

    try {
      const roundIds = await getApiEnabledRoundIds();
      if (!roundIds.length) {
        console.warn(`[pollForUser] user=${userKey} skipped — no API-enabled rounds`);
        return false;
      }

      const selectedMatches = await MatchSelection.find({
        isSelected: true,
        userId:     dbUserId,
        roundId:    { $in: roundIds }
      }).lean();

      if (!selectedMatches.length) {
        console.warn(`[pollForUser] user=${userKey} skipped — no selected+API-enabled MatchSelection found (roundIds=${roundIds.length})`);
        return false;
      }

      const liveEntry = liveApiPlayersByUser.get(String(userKey));
      const apiPlayers = liveEntry?.players || [];
      const apiPlayersAt = liveEntry?.at || null;

      // Independent matches for the same user can update in parallel too
      await Promise.all(selectedMatches.map(async (selected) => {
        const selUserId = selected.userId;

        if (!selected.isPollingActive) {
          console.warn(`[pollForUser] user=${userKey} matchId=${selected.matchId} skipped — isPollingActive=false on this MatchSelection`);
          return;
        }

        const result = await updateMatchDataWithLiveStats(selected.matchId, selUserId, apiPlayers, apiPlayersAt);
        if (!result) return;

        const { data: updatedMatchData, changed } = result;

        // Push-based replacement for the operator dashboard's old 10s
        // unmatched-players poll — only emit when the unmatched set's
        // membership actually changed this tick (see unmatchedSetChanged
        // above), not on every tick a persistently-unmatched player is
        // still present.
        if (result.unmatchedChanged) {
          io.to(`user:${userKey}`).emit('unmatchedPlayersUpdate', {
            matchId: String(selected.matchId),
            players: getUnmatchedPlayers(selected.matchId),
          });
        }

        const cacheKey    = `${String(userKey)}:${String(selected.matchId)}`;
        const memoryMatch = liveMatchCache.get(cacheKey) || updatedMatchData;
        const lastData    = lastMatchDataByUserMatch[cacheKey];

        // ─────────────────────────────────────────────────────────────────
        // Frontend forwarding. liveMatchUpdate/overallDataUpdate go to two
        // destinations:
        //   1. `user:${userKey}` — the authenticated dashboard
        //      (matchDataController.tsx), plain JSON, unchanged.
        //   2. `round:${tournamentId}:${roundId}:matchData` — the public
        //      overlay (PublicThemeRenderer.tsx), protobuf/msgpack-encoded.
        //      liveMatchUpdate here is now a TEAM-LEVEL DELTA — only teams
        //      that actually changed since the last tick are included (see
        //      computeChangedTeams / emitUpdates below). Safe because
        //      processLiveMatchUpdate merges a partial `teams` array by
        //      team ID client-side, keeping a team's last-known value when
        //      it's absent from a given tick; a client that misses a delta
        //      entirely self-heals via the next full HTTP bulk-fetch
        //      (mount/view-change/match-switch), not via socket resend.
        //      overallDataUpdate on the :overall sub-room is still the full
        //      standings object every time — not delta'd (yet).
        //
        // computeOverallMatchDataForRound (round-wide standings) is fired
        // WITHOUT being awaited — it scans every MatchData in the round and
        // re-aggregates every player, easily the most expensive step here,
        // and this function's caller (pollForUser) is what `userProcessing`
        // gates tick-acceptance on. Awaiting it here used to mean a slow
        // round (many matches) could make a single tick's processing take
        // longer than the ~2s gap between PCOB ticks, silently dropping the
        // next tick for this user since userProcessing was still held.
        // overallRecomputeInFlight prevents two recomputes for the same
        // match stacking if a tick arrives while the previous one is still
        // running — it just skips that tick's recompute rather than queuing
        // or blocking; the next changed tick will try again.
        // ─────────────────────────────────────────────────────────────────
        const emitOverallUpdate = async () => {
          if (overallRecomputeInFlight.has(cacheKey)) return;
          overallRecomputeInFlight.add(cacheKey);
          try {
            const overallTeams = await computeOverallMatchDataForRound(
              selected.tournamentId, selected.roundId, selected.matchId, selUserId
            );
            const overallFingerprint = computeOverallFingerprintParts(overallTeams);
            const unchangedOverall = fingerprintsEqual(overallFingerprint, lastOverallFingerprintByUserMatch[cacheKey]);
            lastOverallFingerprintByUserMatch[cacheKey] = overallFingerprint;
            if (!unchangedOverall) {
              // Team-level delta, mirroring the matchData path above: first
              // tick for this (user, match) has no previous entry, so
              // computeChangedTeams naturally returns the full roster.
              // PublicThemeRenderer.tsx merges by teamId (same as
              // liveMatchUpdate), keeping a team's last-known values when
              // it's absent from a given tick rather than blanking it.
              const changedOverallTeams = computeChangedTeams(overallTeams, lastOverallTeamsByUserMatch[cacheKey]);
              lastOverallTeamsByUserMatch[cacheKey] = overallTeams;
              const overallRoom = `round:${selected.tournamentId}:${selected.roundId}:overall`;
              if (changedOverallTeams.length === 0) {
                // Structurally near-impossible: the fingerprint gate above is
                // a strict subset of what this full-object comparison
                // covers. Logged loudly rather than silently skipped so a
                // future divergence is visible.
                console.warn(`[bw][overall-delta] ${cacheKey}: change gate fired but 0 teams differ — skipping ${overallRoom} emit this tick`);
              } else {
                const overallPayload = {
                  tournamentId: selected.tournamentId,
                  roundId:      selected.roundId,
                  matchId:      selected.matchId,
                  teams:        changedOverallTeams,
                  createdAt:    new Date()
                };
                // not volatile — overall standings should always land.
                // NOTE: no `user:${userKey}` emit here — confirmed zero
                // consumers of overallDataUpdate on that room anywhere in
                // front/ or desktop-app/ (only the public overlay listens,
                // and only on the round:...:overall sub-room below). Removed
                // as dead traffic; see plan step 1.
                console.log(`[bw][overall-delta] ${cacheKey}: ${changedOverallTeams.length}/${overallTeams.length} teams changed -> ${overallRoom}`);
                emitToRoomSplitByFormat(io, overallRoom, 'overallDataUpdate', {
                  protoMessageName: 'OverallDataPayload',
                  mapToProto: toProtoOverallDataPayload,
                  data: overallPayload,
                  volatile: false,
                });
              }
            }
          } catch (overallError) {
            console.warn('Failed to compute overall data:', overallError.message);
          } finally {
            overallRecomputeInFlight.delete(cacheKey);
          }
        };

        const emitUpdates = () => {
          memoryMatch.deadTeamList = updateDeadTeamList(selected.matchId, memoryMatch);

          // Team-level (+ player-level) delta since the last tick. Computed
          // ONCE here and reused for both the operator dashboard (user:
          // room) and the public overlay rooms — all three now send this
          // diff, not the whole memoryMatch. First tick for this
          // (user, match): lastData is undefined, so computeChangedTeams
          // returns the full roster — a natural full baseline.
          const changedTeams = computeChangedTeams(memoryMatch.teams, lastData?.teams);
          const matchDataRoom = `round:${selected.tournamentId}:${selected.roundId}:matchData`;
          const matchDataPositionalRoom = `round:${selected.tournamentId}:${selected.roundId}:matchDataPositional`;

          // volatile: if a client's socket buffer is backed up, drop this
          // frame rather than queueing — always prefer the freshest data.
          //
          // Operator dashboard (user: room): a tiny liveness heartbeat for
          // isPolling.tsx's "LIVE • data Xs ago" dot (that component used to
          // join the PUBLIC round room and subscribe to the whole delta
          // stream just for this), plus the liveMatchUpdate itself.
          //
          // liveMatchUpdate was the ENTIRE memoryMatch (every team, every
          // player, ~40 fields incl. location + deadTeamList) every ~2s
          // tick, as msgpack OR plain JSON. Now it's the same `changedTeams`
          // delta the public rooms use, msgpack only. `location` is kept
          // here (the dashboard's own map / observing-player views read it
          // off matchData; desktop firing-detection uses a separate local
          // PCOB feed, not this). Every consumer negotiates
          // ?msgpackLiveUpdate=1 (the SharedWorker and the Rust hub both
          // do), and a dashboard that connects or reconnects mid-match gets
          // a full baseline from the user-room hydration in
          // io.on('connection') above — so the plain-JSON fallback is gone.
          // Relay sockets (s.data.userId set) never listen for this.
          {
            const userRoom = `user:${userKey}`;
            const userRoomIds = io.sockets.adapter.rooms.get(userRoom);
            if (userRoomIds && userRoomIds.size > 0) {
              io.to(userRoom).volatile.emit('dataHeartbeat', {
                tournamentId: String(selected.tournamentId),
                roundId: String(selected.roundId),
                matchId: String(selected.matchId),
                at: Date.now(),
              });

              if (changedTeams.length > 0) {
                const targets = [];
                for (const id of userRoomIds) {
                  const s = io.sockets.sockets.get(id);
                  if (!s || s.data?.userId) continue;
                  targets.push(id);
                }
                if (targets.length) {
                  const encoded = encodeMsgpack({ ...memoryMatch, teams: changedTeams, matchId: String(selected.matchId) });
                  console.log(`[bw][emit] liveMatchUpdate (delta) -> ${userRoom}: sockets=${targets.length} teams=${changedTeams.length}/${memoryMatch.teams.length} bytes=${encoded.length}`);
                  io.to(targets).volatile.emit('liveMatchUpdate', encoded);
                }
              }
            }
          }

          // Public overlay: only send the teams that actually changed since
          // the last tick (team-level delta), to whichever sockets joined
          // the matchData tier (view-scoped — see joinRoundRoom above),
          // split by negotiated wire format (protobuf vs. msgpack).
          if (changedTeams.length === 0) {
            // Structurally near-impossible: the top-level `changed` gate
            // (TRACKED_FIELDS-based) is a strict subset of what this
            // full-object comparison covers, so if `changed` fired, at
            // least one team should differ here too. Logged loudly rather
            // than silently skipped so a future divergence is visible.
            console.warn(`[bw][delta] ${cacheKey}: change gate fired but 0 teams differ — skipping ${matchDataRoom}/${matchDataPositionalRoom} emit this tick`);
          } else {
            console.log(`[bw][delta] ${cacheKey}: ${changedTeams.length}/${memoryMatch.teams.length} teams changed -> ${matchDataRoom}/${matchDataPositionalRoom}`);
            // Core tier: no `location` — the vast majority of views (kill
            // feeds, stat panels, standings, etc.) never render position,
            // and location is the field most likely to differ on any given
            // tick during combat, so stripping it here is what actually
            // shrinks the common-case payload. emitToRoomSplitByFormat
            // no-ops (skips encode entirely) when a room is empty, so this
            // costs nothing extra when nobody's joined either room.
            emitToRoomSplitByFormat(io, matchDataRoom, 'liveMatchUpdate', {
              protoMessageName: 'MatchDataPayload',
              mapToProto: toProtoMatchDataPayload,
              data: { ...memoryMatch, teams: stripPositionalFields(changedTeams), matchId: String(selected.matchId) },
              volatile: true,
            });
            // Positional tier: strict superset of the core payload (adds
            // location back) — only mapPreview-type views join this room,
            // and joinRoundRoom ensures a socket joins one or the other,
            // never both.
            emitToRoomSplitByFormat(io, matchDataPositionalRoom, 'liveMatchUpdate', {
              protoMessageName: 'MatchDataPayload',
              mapToProto: toProtoMatchDataPayload,
              data: { ...memoryMatch, teams: changedTeams, matchId: String(selected.matchId) },
              volatile: true,
            });
          }

          // Round-wide standings only matter once a team's placement for
          // THIS match is settled (rank/placePoints, kills counted toward
          // the round total) — not on every live combat-stat tick, since
          // computeOverallMatchDataForRound sums each match's CURRENT live
          // player stats (health/damage/survivalTime, ...) regardless of
          // whether that team has finished playing, and those change on
          // essentially every tick a player is alive. Only recompute/
          // broadcast when a team's alive/dead status actually changed —
          // or this is the very first tick seen for this match, so a
          // brand-new match still shows up in the standings immediately.
          const deadTeamIds = new Set(memoryMatch.deadTeamList.map(t => String(t.teamId)));
          const prevDeadTeamIds = lastDeadTeamIdsByUserMatch[cacheKey];
          const eliminationChanged = !prevDeadTeamIds ||
            deadTeamIds.size !== prevDeadTeamIds.size ||
            [...deadTeamIds].some(id => !prevDeadTeamIds.has(id));
          lastDeadTeamIdsByUserMatch[cacheKey] = deadTeamIds;

          if (eliminationChanged) {
            emitOverallUpdate().catch(err =>
              console.error(`[overall] ${cacheKey} error:`, err.message)
            );
          }
        };

        if (!lastData) {
          if (VERBOSE_MATCH_LOGS) logFullMatchTable(memoryMatch);
          emitUpdates();
          lastMatchDataByUserMatch[cacheKey] = memoryMatch;
          hadChanges = true;
        } else if (changed) {
          if (VERBOSE_MATCH_LOGS) logMatchDiff(selected.matchId, lastData, memoryMatch);
          emitUpdates();
          lastMatchDataByUserMatch[cacheKey] = memoryMatch;
          hadChanges = true;
        } else if (VERBOSE_MATCH_LOGS) {
          console.log(
            `${c('dim', `[${new Date().toLocaleTimeString()}]`)} ` +
            `${c('yellow', '≈')} match=${selected.matchId} — no changes`
          );
        }
      }));
    } catch (err) {
      console.error(`[user ${userKey}] Update error:`, err);
    }

    return hadChanges;
  };

  // ─── User Discovery ─────────────────────────────────────────────────────────
  // This just maintains the set of users we should react for when a socket
  // push arrives — it no longer starts/stops any per-user polling timers.
  const discoverAndStartPollingUsers = async () => {
    try {
      const roundIds = await getApiEnabledRoundIds();
      if (!roundIds.length) {
        console.log('[discovery] No API-enabled rounds found');
        return;
      }

      const selectedMatches = await MatchSelection.find({
        isSelected:      true,
        userId:          { $exists: true, $ne: null },
        roundId:         { $in: roundIds },
        isPollingActive: true,
      }).lean();

      const activeUserIds = [];
      for (const s of selectedMatches) {
        const key = String(s.userId);
        userKeyToDbId.set(key, s.userId);
        activeUserIds.push(key);
      }

      const uniqueActiveUserIds = [...new Set(activeUserIds)];

      // DIAGNOSTIC (2026-08-23): sizes for this pass, so a user dropping
      // out below is explainable — few/no roundIds means no round has
      // apiEnable, few/no selectedMatches means no MatchSelection matched
      // isSelected+isPollingActive for that round set.
      const discoverySignature = `${roundIds.length}:${selectedMatches.length}:${uniqueActiveUserIds.length}`;
      if (discoverySignature !== lastDiscoveryLogSignature) {
        console.debug(`[discovery] pass: roundIds=${roundIds.length} selectedMatches=${selectedMatches.length} uniqueActiveUserIds=${uniqueActiveUserIds.length}`);
        lastDiscoveryLogSignature = discoverySignature;
      }

      for (const uid of uniqueActiveUserIds) {
        if (!activeUserKeys.has(uid)) {
          activeUserKeys.add(uid);
          console.log(`[discovery] NOW ACTIVE (socket-driven) → ${uid}`);
        }
      }

      for (const existingUid of Array.from(activeUserKeys)) {
        if (!uniqueActiveUserIds.includes(existingUid)) {
          activeUserKeys.delete(existingUid);
          console.log(`[discovery] NO LONGER ACTIVE → ${existingUid}`);
        }
      }
    } catch (e) {
      console.error('[discovery] Error:', e);
    }
  };

  // Background save queue is flushed on its own timer — see
  // SAVE_FLUSH_INTERVAL_MS near the queue's definition above.

  // Boot: figure out who is active, then just wait for socket pushes.
  // Re-run discovery periodically ONLY to pick up new/removed selections —
  // this does not fetch or poll live player data, it just maintains the
  // active-user set used by triggerImmediateUpdateForUser().
  //
  // Bandwidth: the real-time path is already event-driven — the polling
  // toggle endpoint calls markUserActiveForPolling()/markUserInactiveForPolling()
  // synchronously, so a newly armed match is picked up immediately without
  // waiting for this timer. This interval is now only a slow reconcile /
  // safety net (e.g. a Round.apiEnable flag flipped directly in the DB), so
  // 60s instead of 10s — 6x fewer MongoDB round-trips per idle server, which
  // is outbound (Atlas) traffic Render bills as service-initiated.
  discoverAndStartPollingUsers();
  setInterval(discoverAndStartPollingUsers, 60000);
}

module.exports = { startLiveMatchUpdater, getUnmatchedPlayers, markUserActiveForPolling, markUserInactiveForPolling, saveLiveMatchSnapshot };
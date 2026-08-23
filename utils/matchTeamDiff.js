// Team-level and player-level change detection for the public overlay's
// liveMatchUpdate/overallDataUpdate. Trims the outgoing payload down to only
// what actually changed since the last tick — team-level (skip a team
// entirely) AND, within a changed team, player-level + field-level (skip a
// player entirely, or send only the fields on it that actually changed) —
// instead of resending the whole match every ~2s. Safe because
// PublicThemeRenderer.tsx's processLiveMatchUpdate/handleOverallDataUpdate
// merge partial teams AND partial players by id, keeping the last-known
// value for anything absent from a given tick.
function teamKey(team) {
  return String(team?.teamId ?? team?._id ?? '');
}

function playerKey(player) {
  return String(player?.uId ?? player?.docId ?? player?._id ?? '');
}

// Same 13-field list pubgApiMatchData.controller.js's fingerprint gate uses
// to decide "did ANYTHING change this tick" (cheap array-compare, no
// crypto). Relocated here so the fingerprint gate and the player-level diff
// below share one source of truth instead of drifting — re-exported for the
// controller's existing import.
const TRACKED_FIELDS = [
  'killNum', 'health', 'damage', 'assists', 'knockouts',
  'liveState', 'bHasDied', 'headShotNum', 'survivalTime',
  'rescueTimes', 'inDamage', 'heal', 'rank',
];

// Fields protobufCodec.js's toProtoPlayer already hardcodes to 0 regardless
// of input (confirmed dead weight — no front/src/Themes view reads any of
// them). Diffing/carrying these would be pure waste since they're collapsed
// to a constant on the wire no matter what value they hold here.
const DEAD_WEIGHT_PLAYER_FIELDS = new Set([
  'AIKillNum', 'BossKillNum', 'inDamage', 'outsideBlueCircleTime',
  'PoisonTotalDamage', 'UseSelfRescueTime', 'UseEmergencyCallTime',
]);

// Fields that always ride along on an included player regardless of
// whether they changed — identity (needed to key/route the player at all)
// plus display strings that change so rarely the field-presence bookkeeping
// isn't worth the extra merge complexity for them.
const PLAYER_IDENTITY_FIELDS = [
  'uId', 'docId', '_id', 'playerName', 'playerOpenId', 'picUrl',
  'showPicUrl', 'character', 'teamIdfromApi', 'teamId', 'teamName',
];

function fieldsEqual(a, b) {
  // location is a nested {x,y,z} object; every other field here is a scalar.
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

// Returns a player object containing only the identity fields plus whichever
// OTHER fields actually differ from `previous` — or the full player object
// unchanged on a first-tick-for-this-player (no `previous`), same "first
// tick sends everything" rule computeChangedTeams already uses for teams.
function computeChangedPlayerFields(current, previous) {
  if (!previous) return current;

  const out = {};
  for (const key of PLAYER_IDENTITY_FIELDS) {
    if (current[key] !== undefined) out[key] = current[key];
  }
  for (const key of Object.keys(current)) {
    if (PLAYER_IDENTITY_FIELDS.includes(key) || DEAD_WEIGHT_PLAYER_FIELDS.has(key)) continue;
    if (!fieldsEqual(current[key], previous[key])) out[key] = current[key];
  }
  return out;
}

// Player-level counterpart to computeChangedTeams: only players that
// actually changed (beyond identity) survive into the output array. A
// player present only in `previousPlayers` (e.g. removed from the roster)
// is simply absent from the result — same as computeChangedTeams' handling
// of a removed team.
function computeChangedPlayers(currentPlayers, previousPlayers) {
  const prevByKey = new Map((previousPlayers || []).map((p) => [playerKey(p), p]));
  const changed = [];
  for (const player of currentPlayers || []) {
    const prevPlayer = prevByKey.get(playerKey(player));
    const diffed = computeChangedPlayerFields(player, prevPlayer);
    if (!prevPlayer) {
      changed.push(diffed);
      continue;
    }
    const changedKeys = Object.keys(diffed).filter((k) => !PLAYER_IDENTITY_FIELDS.includes(k));
    if (changedKeys.length > 0) changed.push(diffed);
  }
  return changed;
}

// Deliberately a full-object comparison (JSON.stringify), not a reuse of
// TRACKED_FIELDS above — that list exists only to cheaply gate "did ANYTHING
// change this tick" and deliberately excludes location/isFiring/
// isOutsideBlueCircle/character/picUrl/teamName ("noise" for that narrower
// purpose). Reusing it here would silently skip a team whose only change is,
// say, position. A team is small (~4 players), so a full comparison is
// cheap — negligible next to the DB/roster work already done per tick — and
// has no field list to drift out of sync later.
// `location` is the one field that changes on nearly every tick for any
// alive/moving player, which otherwise forces computeChangedTeams to
// re-include most alive teams almost every tick. Views that don't render
// player position (the vast majority — see viewDataTiers.js) get this
// stripped so their room's payload only carries it when it actually
// matters. NOT applied to isFiring — that's a combat-stat field, not
// positional, and several core-tier views render off it.
const POSITIONAL_PLAYER_FIELDS = ['location'];

function stripPositionalFields(teams) {
  return (teams || []).map((team) => {
    if (!(team.players || []).some((p) => 'location' in p)) return team;
    return {
      ...team,
      players: team.players.map(({ location, ...rest }) => rest),
    };
  });
}

function computeChangedTeams(currentTeams, previousTeams) {
  const prevByKey = new Map((previousTeams || []).map((t) => [teamKey(t), t]));
  const changed = [];
  for (const team of currentTeams || []) {
    const prevTeam = prevByKey.get(teamKey(team));
    if (!prevTeam) {
      changed.push(team); // brand-new team: send everything, unchanged behavior
      continue;
    }
    if (JSON.stringify(team) !== JSON.stringify(prevTeam)) {
      changed.push({ ...team, players: computeChangedPlayers(team.players, prevTeam.players) });
    }
  }
  return changed;
}

module.exports = {
  computeChangedTeams,
  computeChangedPlayers,
  computeChangedPlayerFields,
  stripPositionalFields,
  teamKey,
  playerKey,
  TRACKED_FIELDS,
  DEAD_WEIGHT_PLAYER_FIELDS,
  PLAYER_IDENTITY_FIELDS,
  POSITIONAL_PLAYER_FIELDS,
};

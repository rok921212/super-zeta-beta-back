const mongoose = require('mongoose');

const Tournament = require('../models/tournament.model');
const Round = require('../models/round.model');
const Match = require('../models/match.model');
const MatchData = require('../models/matchData.model');
const MatchSelection = require('../models/MatchSelection.model');
const Group = require('../models/group.model.js');
const { createMatchDataForMatchDoc } = require('./matchData.controller');
const { aggregateOverallTeams } = require('./overall.controller');

/* --------------------------------------------------------------------
   Same view -> data-requirement tables as the frontend
   (PublicThemeRenderer.tsx), kept in sync manually. If you add a view
   there that needs a new data source, mirror it here too.

   VIEWS_NEEDING_OVERALL / VIEWS_NEEDING_MATCH_DATA are hoisted to
   utils/viewDataTiers.js — the socket layer (pubgApiMatchData.controller.js
   joinRoundRoom) needs the exact same two sets to decide which
   round:${tid}:${rid}:* sub-room a socket joins, and importing one shared
   copy keeps this file's HTTP-bulk logic and the socket-room logic from
   drifting apart within this repo.
-------------------------------------------------------------------- */
const { VIEWS_NEEDING_OVERALL, VIEWS_NEEDING_MATCH_DATA } = require('../utils/viewDataTiers');
const VIEWS_NEEDING_MATCHES_LIST = new Set([
  'Lower', 'Schedule', 'HighlightSchedule', 'OverAllData', 'OverallFrags', 'highlightPoints', 'EventMvp',
]);
const VIEWS_NEEDING_ALL_MATCH_DATAS = new Set([
  'Schedule', 'highlightPoints', 'HighlightSchedule', 'OverAllData', 'OverallFrags',
  'EventMvp', 'Achive',
]);

// Field set actually read by the round-summary views (Schedule,
// HighlightSchedule, OverAllData, OverallFrags, highlightPoints) —
// confirmed against every theme's component. These are NOT live/real-time
// views (those use currentMatchData/overallData, untouched by this), so
// matchDatasData can drop every live-tick-only field (location, health,
// driveDistance, grenade counters, deadTeamList, ...) that these views
// never read. Keep in sync with VIEWS_NEEDING_ALL_MATCH_DATAS above if a
// future view added to that set needs more fields.
const SUMMARY_PLAYER_FIELDS = ['killNum', 'damage', 'assists', 'survivalTime', 'knockouts'];

// Achive's round-wide "PLAYERS SUMMARY" leaderboard aggregates
// grenade-kills/kill-distance/travel-distance across every match too, so
// its matchDatasData entries need the extra live-stat fields that the
// other summary views above don't read. Kept as its own list rather than
// widening SUMMARY_PLAYER_FIELDS so those other views' payload stays slim.
const ACHIVE_MATCH_LIST_FIELDS = [
  ...SUMMARY_PLAYER_FIELDS, 'killNumByGrenade', 'maxKillDistance', 'driveDistance', 'marchDistance',
];

/* --------------------------------------------------------------------
   PER-VIEW PLAYER-FIELD SLIMMING (currentMatchData / overallData)
   --------------------------------------------------------------------
   Before this, every view in VIEWS_NEEDING_MATCH_DATA / VIEWS_NEEDING_OVERALL
   got the complete, unslimmed player object — every numeric stat field the
   live-ingest pipeline can produce, including several (location,
   killNumBeforeDie, AIKillNum, BossKillNum, inDamage, outsideBlueCircleTime,
   PoisonTotalDamage, UseSelfRescueTime, UseEmergencyCallTime, contribution,
   showPicUrl) that NO view in any theme actually reads — confirmed by
   auditing every theme component's actual field usage in front/src/Themes.
   `slots`/`PlayerSwitch`/`mapPreview` (identity-only UI) were paying the
   same ~65KB per-request cost as `Dom`/`WwcdStats`/etc. (full live-stat
   views) for exactly this reason.

   Tiers are additive (each includes the previous). Deliberately err toward
   including a field where a view's exact need was ambiguous across themes,
   and any view NOT listed in VIEW_PLAYER_TIER falls back to 'full' (no
   slimming at all) so an unaudited/future view never silently loses a
   field a live broadcast depends on. The HTTP /bulk request only ever
   carries `view`, never `theme` (PublicThemeRenderer.tsx), so a tier must
   be a safe union across every theme that implements a given view, not
   theme-specific.
-------------------------------------------------------------------- */
const IDENTITY_PLAYER_FIELDS = ['_id', 'uId', 'playerName', 'picUrl'];
const LIGHT_PLAYER_FIELDS = [
  ...IDENTITY_PLAYER_FIELDS,
  'killNum', 'liveState', 'bHasDied', 'rank', 'isFiring', 'isOutsideBlueCircle', 'survivalTime',
];
const MID_PLAYER_FIELDS = [
  ...LIGHT_PLAYER_FIELDS,
  'damage', 'assists', 'knockouts', 'health', 'healthMax', 'heal',
];
const HEAVY_PLAYER_FIELDS = [
  ...MID_PLAYER_FIELDS,
  'headShotNum', 'killNumInVehicle', 'killNumByGrenade',
  'useSmokeGrenadeNum', 'useFragGrenadeNum', 'useBurnGrenadeNum', 'useFlashGrenadeNum',
  'gotAirDropNum', 'maxKillDistance', 'rescueTimes', 'driveDistance', 'marchDistance',
];
const PLAYER_FIELD_TIERS = {
  identity: IDENTITY_PLAYER_FIELDS,
  light: LIGHT_PLAYER_FIELDS,
  mid: MID_PLAYER_FIELDS,
  heavy: HEAVY_PLAYER_FIELDS,
};

// view -> tier name. LiveStats and EventMvp are deliberately NOT listed
// (-> 'full'): LiveStats is the core live UI nearly every theme leans on
// and combines matchData+overallData at once; EventMvp already pulls
// matches list + overallData + full matchData + all-match-datas
// simultaneously, so there's no meaningful slim available for it anyway.
const VIEW_PLAYER_TIER = {
  slots: 'identity',
  PlayerSwitch: 'identity',
  mapPreview: 'identity',

  Alerts: 'light',
  LiveFrags: 'light',
  Recall: 'light',
  LiveData: 'light',

  MatchData: 'mid',
  Upper: 'mid',
  RosterShowCase: 'mid',
  TeamH2H: 'mid',

  MatchSummary: 'heavy',
  Dom: 'heavy',
  mvp: 'heavy',
  WwcdStats: 'heavy',
  WwcdSummary: 'heavy',
  MatchFragrs: 'heavy',
  Achive: 'heavy',
  playerH2H: 'heavy',
};

function pickFields(obj, fields) {
  if (!obj) return obj;
  const out = {};
  for (const f of fields) out[f] = obj[f];
  return out;
}

// Only slims team.players[] — team-level fields (teamId/teamTag/teamName/
// teamLogo/placePoints/wwcd/slot, a handful of small values) are left
// untouched everywhere; the byte cost this whole file is fixing lives in
// the players arrays (dozens of players x ~28 fields), not the team shell.
function slimPlayersForView(teams, view) {
  const tierName = VIEW_PLAYER_TIER[view];
  if (!tierName) return teams; // unaudited/unlisted view — leave as-is, full fidelity
  const fields = PLAYER_FIELD_TIERS[tierName];
  return (teams || []).map(team => ({
    ...team,
    players: (team.players || []).map(p => pickFields(p, fields)),
  }));
}

// Builds a fresh, independent object rather than mutating matchData in
// place — matchDataMap's entries are shared/aliased with
// currentMatchData.matchData (the live match), so mutating here would risk
// stripping fields off the real-time payload too.
function slimMatchDataForList(matchData, view) {
  if (!matchData) return matchData;
  const fields = view === 'Achive' ? ACHIVE_MATCH_LIST_FIELDS : SUMMARY_PLAYER_FIELDS;
  return {
    _id: matchData._id,
    matchId: matchData.matchId,
    teams: (matchData.teams || []).map(team => ({
      teamId: team.teamId ?? team._id,
      teamName: team.teamName,
      teamTag: team.teamTag,
      teamLogo: team.teamLogo,
      slot: team.slot,
      placePoints: team.placePoints,
      players: (team.players || []).map(p => {
        const slim = { uId: p.uId, _id: p._id, playerName: p.playerName, picUrl: p.picUrl };
        for (const f of fields) slim[f] = p[f];
        return slim;
      }),
    })),
  };
}

/* --------------------------------------------------------------------
   IDENTITY HYDRATION CACHE
   -------------------------------------------------------------------- */
// Keyed by `${tournamentId}:${teamId/playerId}` — NOT just the raw id.
// Teams are a shared catalog reused across different users' tournaments,
// so a bare teamId/playerId key would let one tournament's cached identity
// (name/photo) silently bleed into a completely unrelated tournament that
// happens to reuse the same shared team. Scoping by tournamentId keeps each
// tournament's cached identity data isolated from every other one.
// Keyed by the player's stable `uId`, NOT `player._id` — in the live
// API-polling pipeline (pubgApiMatchData.controller.js), every player's
// `_id` is a brand-new ObjectId generated fresh on EVERY tick, so an
// `_id`-keyed cache could never hit for that pipeline (each tick looks like
// a never-seen-before player). `uId` is the one identifier that's actually
// stable tick-to-tick and match-to-match.
const playerIdentityCache = new Map(); // `${tournamentId}:${uId}` -> { playerName, picUrl, showPicUrl }
const teamIdentityCache = new Map();   // `${tournamentId}:${teamId}`   -> { teamName, teamTag, teamLogo }

function hydrateMatchDataIdentity(matchData, tournamentId) {
  if (!matchData?.teams) return matchData;
  const scope = tournamentId?.toString() || 'unscoped';

  for (const team of matchData.teams) {
    const teamId = (team.teamId ?? team._id)?.toString();
    const teamKey = teamId ? `${scope}:${teamId}` : null;
    if (teamKey) {
      const isTeamComplete = Boolean(team.teamName && team.teamTag && team.teamLogo);
      if (isTeamComplete) {
        teamIdentityCache.set(teamKey, {
          teamName: team.teamName,
          teamTag: team.teamTag,
          teamLogo: team.teamLogo,
        });
      } else {
        const cached = teamIdentityCache.get(teamKey);
        if (cached) {
          if (!team.teamName) team.teamName = cached.teamName;
          if (!team.teamTag) team.teamTag = cached.teamTag;
          if (!team.teamLogo) team.teamLogo = cached.teamLogo;
        }
      }
    }

    for (const player of team.players || []) {
      // Prefer the stable `uId` (see comment on playerIdentityCache above);
      // `_id` is only a fallback for the rare shape that has no uId at all.
      const uid = (player.uId != null && String(player.uId).trim()) || player._id?.toString();
      if (!uid) continue;
      const pKey = `${scope}:${uid}`;
      const cached = playerIdentityCache.get(pKey);

      // Backfill per-field, not all-or-nothing — a player showing up with a
      // real name but a blank picUrl (the common case: raw API telemetry
      // always has a name, never a photo) must still get their photo
      // backfilled, not be treated as "complete" just because the name is
      // present.
      if (!player.playerName && cached?.playerName) player.playerName = cached.playerName;
      if (!player.picUrl && cached?.picUrl) player.picUrl = cached.picUrl;
      if (!player.showPicUrl && cached?.showPicUrl) player.showPicUrl = cached.showPicUrl;

      // Then record whatever the player now has — never regress a
      // previously-known-good field back to blank.
      playerIdentityCache.set(pKey, {
        playerName: player.playerName || cached?.playerName || '',
        picUrl: player.picUrl || cached?.picUrl || '',
        showPicUrl: player.showPicUrl || cached?.showPicUrl || '',
      });
    }
  }

  return matchData;
}

/* --------------------------------------------------------------------
   DEAD TEAM LIST — real-time elimination tracking, computed server-side
   --------------------------------------------------------------------
   death: matchId -> {
     everAlive: Set<teamKey>,       // teams observed alive at least once
     dead: Set<teamKey>,            // teams currently considered eliminated
     deadAt: Map<teamKey, Date>,    // when each currently-dead team FIRST
                                     // transitioned into `dead` — cleared
                                     // if the team un-dies (ratchet
                                     // reversal below), so a later
                                     // re-death gets an honest fresh
                                     // timestamp instead of reusing the
                                     // original one.
   }

   `rank` is read straight off the live-ingest-populated team.rank field
   (same source the rest of matchData.teams comes from) — this module
   doesn't compute or infer placement itself, just carries it through
   onto the dead-team snapshot alongside the identity/stat fields.
-------------------------------------------------------------------- */
const matchDeathState = new Map();

function isTeamAllDead(team) {
  return (
    Array.isArray(team.players) &&
    team.players.length > 0 &&
    team.players.every(p => p.liveState === 5 || p.bHasDied)
  );
}

function updateDeadTeamList(matchId, matchData) {
  if (!matchId || !matchData?.teams) return [];

  const stateKey = matchId.toString();
  let state = matchDeathState.get(stateKey);
  if (!state) {
    state = { everAlive: new Set(), dead: new Set(), deadAt: new Map(), rankAt: new Map() };
    matchDeathState.set(stateKey, state);
  }

  const totalTeams = matchData.teams.length;

  for (const team of matchData.teams) {
    const teamKey = (team.teamId ?? team._id)?.toString();
    if (!teamKey) continue;

    if (!isTeamAllDead(team)) {
      state.everAlive.add(teamKey);
      state.dead.delete(teamKey);
      state.deadAt.delete(teamKey);
      state.rankAt.delete(teamKey);
      continue;
    }

    if (state.everAlive.has(teamKey)) {
      if (!state.dead.has(teamKey)) {
        // First tick this team is seen dead in this life — stamp both
        // together. rank = teams still alive INCLUDING this one, at the
        // instant it died: total teams minus however many were already
        // dead before it (state.dead.size here is a snapshot taken
        // before this team is added below, so it's exactly "teams dead
        // before this one").
        state.deadAt.set(teamKey, new Date());
        state.rankAt.set(teamKey, totalTeams - state.dead.size);
      }
      state.dead.add(teamKey);
    }
  }

  return matchData.teams
    .filter(team => {
      const teamKey = (team.teamId ?? team._id)?.toString();
      return teamKey && state.dead.has(teamKey);
    })
    .map(team => {
      const teamKey = (team.teamId ?? team._id)?.toString();
      return {
        teamId: team.teamId ?? team._id,
        teamTag: team.teamTag,
        teamName: team.teamName,
        teamLogo: team.teamLogo,
        placePoints: team.placePoints,
        rank: state.rankAt.get(teamKey) ?? null,
        totalKills: (team.players || []).reduce((sum, p) => sum + (p.killNum || 0), 0),
        deadAt: state.deadAt.get(teamKey) ?? null,
      };
    });
}

/** Fetch matchData for an already-loaded match doc (no re-fetching the match). */
async function getMatchDataForMatchDoc(match) {
  if (!match) return null;

  let matchData = await MatchData.findOne({ matchId: match._id, userId: match.userId }).lean();
  if (!matchData) matchData = await MatchData.findOne({ matchId: match._id }).lean();
  if (!matchData) {
    try {
      const created = await createMatchDataForMatchDoc(match._id);
      matchData = created && created.toObject ? created.toObject() : created;
    } catch (err) {
      return null;
    }
  }

  matchData = hydrateMatchDataIdentity(matchData, match.tournamentId);
  matchData.deadTeamList = updateDeadTeamList(match._id, matchData);

  return matchData;
}

/** Fetch (or lazily create) the matchData doc for a single match, given only its id. */
async function getMatchDataForMatch(matchId) {
  const match = await Match.findById(matchId).lean();
  if (!match) return null;
  return getMatchDataForMatchDoc(match);
}

/**
 * Fetch matchData for a list of matches, keyed by matchId string. One
 * batched $in query instead of a per-match findOne — the previous version
 * ran N (or up to 2N on the userId-fallback branch) separate round trips
 * per call, and this runs on every live tick, so it scaled with round size
 * on every single update.
 */
async function getMatchDataBatch(matches) {
  const map = new Map();
  if (!matches.length) return map;

  const matchIds = matches.map(m => m._id);
  const allMatchDatas = await MatchData.find({ matchId: { $in: matchIds } }).lean();

  const byMatchId = new Map(); // matchId string -> MatchData[]
  for (const md of allMatchDatas) {
    const key = md.matchId.toString();
    if (!byMatchId.has(key)) byMatchId.set(key, []);
    byMatchId.get(key).push(md);
  }

  await Promise.all(matches.map(async (m) => {
    const key = m._id.toString();
    const candidates = byMatchId.get(key) || [];
    // Prefer the doc whose userId matches the match's own userId, same
    // preference the old findOne({matchId,userId}) -> findOne({matchId})
    // fallback expressed.
    let matchData = candidates.find(md => String(md.userId) === String(m.userId)) || candidates[0] || null;

    if (!matchData) {
      // Rare path: no MatchData exists yet for this match — lazily create
      // it, one at a time, only for the matches that actually need it.
      try {
        const created = await createMatchDataForMatchDoc(m._id);
        matchData = created && created.toObject ? created.toObject() : created;
      } catch (err) {
        return;
      }
    }
    if (!matchData) return;

    matchData = hydrateMatchDataIdentity(matchData, m.tournamentId);
    matchData.deadTeamList = updateDeadTeamList(m._id, matchData);
    map.set(key, matchData);
  }));

  return map;
}

/**
 * Aggregate every match in a round into cumulative per-team / per-player totals.
 * Thin wrapper around overall.controller.js's aggregateOverallTeams — the same
 * core the dashboard/live-socket path (computeOverallMatchDataForRound) uses,
 * so this public/bulk path and that one always agree on placePoints/wwcd/stats
 * instead of drifting apart via two hand-maintained implementations. This
 * function keeps its own matches/matchDataMap fetching (with the optional
 * pre-fetched params for the buildBulkPayload batching path) since that part
 * isn't the source of any mismatch and is already optimized for this call site.
 */
async function getOverallForRound(tournamentId, roundId, { matches: matchesIn, matchDataMap: matchDataMapIn } = {}) {
  const matches = matchesIn || await Match.find({ tournamentId, roundId }).sort({ matchNo: 1 }).lean();
  if (!matches.length) {
    // No synthetic `createdAt` here — see the note on the normal return below.
    return { tournamentId, roundId, totalMatches: 0, teams: [] };
  }

  const matchDataMap = matchDataMapIn || await getMatchDataBatch(matches);
  // Order by `matches` (already matchNo-sorted) rather than Map insertion
  // order — aggregateOverallTeams' identity fields (teamName/teamTag/
  // teamLogo/picUrl/etc.) take the LAST-processed match's value, so this
  // must reflect real chronological match order. See overall.controller.js's
  // computeOverallMatchDataForRound for the matching fix.
  const orderedMatchDatas = matches
    .map(m => matchDataMap.get(m._id.toString()))
    .filter(Boolean);
  const teams = aggregateOverallTeams(orderedMatchDatas);

  // Deliberately NO `createdAt: new Date()` — a wall-clock timestamp in the
  // body changes the bytes on every regeneration, so Express's ETag never
  // matched and `GET /api/public/bulk|overall` could never return a 304.
  // Every OBS overlay re-downloads this on mount, on the 10-min poll, and on
  // every socket reconnect; without a stable body those are all full sends.
  // The rest of this payload is already deterministic for a given DB state.
  return {
    tournamentId,
    roundId,
    totalMatches: matches.length,
    teams,
  };
}

async function buildBulkPayload({ tournamentId, roundId, matchId, view = null, followSelected = false, includeAll = false }) {
  const needsOverall = includeAll || VIEWS_NEEDING_OVERALL.has(view);
  const needsMatchData = includeAll || VIEWS_NEEDING_MATCH_DATA.has(view);
  const needsMatchesList = includeAll || VIEWS_NEEDING_MATCHES_LIST.has(view);
  const needsAllMatchDatas = includeAll || VIEWS_NEEDING_ALL_MATCH_DATAS.has(view);

  const [tournament, round] = await Promise.all([
    Tournament.findById(tournamentId).lean(),
    Round.findById(roundId).lean(),
  ]);

  let effectiveMatchId = matchId || null;
  if (followSelected) {
    const selected = await MatchSelection.findOne({ tournamentId, roundId, isSelected: true })
      .sort({ createdAt: -1 })
      .lean();
    if (selected?.matchId) {
      effectiveMatchId = selected.matchId.toString();
    } else {
      const latest = await Match.findOne({ tournamentId, roundId }).sort({ matchNo: -1 }).lean();
      if (latest?._id) effectiveMatchId = latest._id.toString();
    }
  }

  const needsMatchesForLookup = needsMatchesList || needsAllMatchDatas || needsOverall;

  const matchPromise = effectiveMatchId ? Match.findById(effectiveMatchId).lean() : Promise.resolve(null);
  const groupsPromise = needsMatchesList
    ? Group.find({ tournamentId }).populate('slots.team').lean()
    : Promise.resolve(null);
  const matchesPromise = needsMatchesForLookup
    ? Match.find({ tournamentId, roundId }).sort({ matchNo: 1 }).lean()
    : Promise.resolve(null);

  const [match, groups, roundMatches] = await Promise.all([matchPromise, groupsPromise, matchesPromise]);

  let matchDataMap = null;
  if (roundMatches && (needsOverall || needsAllMatchDatas)) {
    matchDataMap = await getMatchDataBatch(roundMatches);
  }

  const matchDataPromise = needsMatchData && effectiveMatchId
    ? (matchDataMap && matchDataMap.has(effectiveMatchId)
        ? Promise.resolve(matchDataMap.get(effectiveMatchId))
        : getMatchDataForMatch(effectiveMatchId).catch(() => null))
    : Promise.resolve(null);

  const overallPromise = needsOverall
    ? getOverallForRound(tournamentId, roundId, { matches: roundMatches, matchDataMap }).catch(() => null)
    : Promise.resolve(null);

  const [matchData, overallData] = await Promise.all([matchDataPromise, overallPromise]);

  let enrichedMatches = [];
  if (roundMatches) {
    const groupMap = groups ? new Map(groups.map(g => [g._id.toString(), g.groupName])) : new Map();
    enrichedMatches = roundMatches.map(m => {
      if (groups && m.groups && m.groups.length > 0) {
        m.groupName = groupMap.get(m.groups[0].toString()) || 'Unknown';
        m.groupNames = m.groups.slice(0, 2).map(id => groupMap.get(id.toString()) || 'Unknown').filter(Boolean);
      } else if (groups) {
        m.groupName = 'Unknown';
        m.groupNames = [];
      }
      return m;
    });
  }

  const matchNoById = new Map(enrichedMatches.map(m => [m._id.toString(), m.matchNo]));

  let matchDatasData = [];
  if (needsAllMatchDatas && enrichedMatches.length > 0 && matchDataMap) {
    matchDatasData = enrichedMatches
      .map(m => {
        const md = matchDataMap.get(m._id.toString());
        if (!md) return null;
        return { matchId: m._id, matchNo: m.matchNo, matchData: slimMatchDataForList(md, view) };
      })
      .filter(Boolean);
  }

  const matchesList = needsMatchesList ? enrichedMatches : [];

  const matchesData = {
    list: matchesList,
    current: match,
    effectiveMatchId,
  };

  // Per-view player-field slimming (see VIEW_PLAYER_TIER above). Only ever
  // applies on a real, single-view REST fetch — includeAll (and any view
  // not in the tier map) always gets the untouched full object.
  const shouldSlimForView = !includeAll && !!VIEW_PLAYER_TIER[view];
  const slimmedMatchData = (shouldSlimForView && matchData)
    ? { ...matchData, teams: slimPlayersForView(matchData.teams, view) }
    : matchData;
  const slimmedOverallData = (shouldSlimForView && overallData)
    ? { ...overallData, teams: slimPlayersForView(overallData.teams, view) }
    : overallData;

  const currentMatchData = slimmedMatchData
    ? {
        matchId: effectiveMatchId,
        matchNo: match ? match.matchNo : (matchNoById.get(effectiveMatchId) ?? null),
        matchData: slimmedMatchData,
      }
    : null;

  return {
    tournamentData: tournament || null,
    roundData: round || null,
    matchesData,
    matchDatasData,
    currentMatchData,
    overallData: slimmedOverallData || null,
    // No `updatedAt: new Date()` — see getOverallForRound above for why a
    // wall-clock stamp here defeats HTTP 304 revalidation on this endpoint.
  };
}

async function getBulkData(req, res) {
  try {
    const { tournamentId, roundId, matchId } = req.params;
    const { view, followSelected, includeAll } = req.query;

    if (!mongoose.Types.ObjectId.isValid(tournamentId) || !mongoose.Types.ObjectId.isValid(roundId)) {
      return res.status(400).json({ error: 'Invalid tournamentId or roundId' });
    }

    const payload = await buildBulkPayload({
      tournamentId,
      roundId,
      matchId,
      view: view || null,
      followSelected: (followSelected || 'false').toLowerCase() === 'true',
      includeAll: includeAll ? includeAll.toLowerCase() === 'true' : !view,
    });

    if (!payload.tournamentData) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Authoritative per-round revision. Rides in the body as
    // roundData.publicRev (what the overlay reads) and this header (what the
    // local relay reads without decoding the msgpack body). The msgpack cache
    // middleware re-stamps the header on its hit / 304 paths.
    res.set('X-Public-Rev', String(payload.roundData?.publicRev ?? 0));

    res.json(payload);
  } catch (err) {
    console.error('Bulk data error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  buildBulkPayload,
  getBulkData,
  getMatchDataForMatch,
  getMatchDataForMatchDoc,
  getMatchDataBatch,
  getOverallForRound,
  hydrateMatchDataIdentity,
  updateDeadTeamList,
};
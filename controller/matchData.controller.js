const MatchData = require('../models/matchData.model');
const Match = require('../models/match.model');
const Round = require('../models/round.model');
const Tournament = require('../models/tournament.model');
const Group = require('../models/group.model.js');
const { getSocket } = require('../socket.js');
const mongoose = require('mongoose');
const { computeOverallMatchDataForRound } = require('./overall.controller');
const { encodeMsgpack } = require('../utils/msgpackCodec');
const { emitToRoomSplitByFormat } = require('../utils/roomEmit');
const { toProtoMatchDataPayload, toProtoOverallDataPayload } = require('../utils/protobufCodec');
const { stripPositionalFields } = require('../utils/matchTeamDiff');
const { bumpRound } = require('../utils/publicRevision');
const { notifyRoundStructureChanged } = require('../utils/roundStructure');

// ─── Shared player-template builder ───────────────────────────────────────────
// Was previously copy-pasted 3x (create / replace / add) with small drifts
// between copies — e.g. the replace/add copies were missing the `teamId`
// field entirely, which the original create path always set. Centralizing
// it means all three paths always produce an identically-shaped player.
function buildFreshPlayer(sourcePlayer, teamSlot, teamName) {
  return {
    uId: sourcePlayer.playerId || sourcePlayer.uId || '',
    _id: sourcePlayer._id,
    playerName: sourcePlayer.playerName,
    playerOpenId: sourcePlayer.playerOpenId || '',
    picUrl: sourcePlayer.photo || sourcePlayer.picUrl || '',
    showPicUrl: '',
    character: 'None',
    isFiring: false,
    bHasDied: false,
    location: { x: 0, y: 0, z: 0 },
    health: 0,
    healthMax: 0,
    liveState: 0,
    killNum: 0,
    killNumBeforeDie: 0,
    playerKey: '',
    gotAirDropNum: 0,
    maxKillDistance: 0,
    damage: 0,
    killNumInVehicle: 0,
    killNumByGrenade: 0,
    AIKillNum: 0,
    BossKillNum: 0,
    rank: 0,
    isOutsideBlueCircle: false,
    inDamage: 0,
    heal: 0,
    headShotNum: 0,
    survivalTime: 0,
    driveDistance: 0,
    marchDistance: 0,
    assists: 0,
    outsideBlueCircleTime: 0,
    knockouts: 0,
    rescueTimes: 0,
    useSmokeGrenadeNum: 0,
    useFragGrenadeNum: 0,
    useBurnGrenadeNum: 0,
    useFlashGrenadeNum: 0,
    PoisonTotalDamage: 0,
    UseSelfRescueTime: 0,
    UseEmergencyCallTime: 0,
    teamIdfromApi: '',
    teamId: teamSlot,
    teamName: teamName || '',
    contribution: 0,
  };
}

// ─── Small ID helpers ──────────────────────────────────────────────────────
// Endpoints in this file have historically matched a "team" two different
// ways: some by the MatchData subdocument's own `_id`, others by the
// `teamId` field (which references the original Team document). That
// inconsistency is a likely cause of intermittent "Team not found" errors
// depending on which id the caller happens to send. matchesTeamId() and the
// $or clauses below accept either, so callers aren't punished for it.
function toObjectIdOrNull(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}
function matchesTeamId(team, teamId) {
  return String(team._id) === String(teamId) || String(team.teamId) === String(teamId);
}

// ─── In-memory per-resource update lock (unchanged behavior, shared helper) ──
const updateLocks = new Map();
function acquireLock(lockKey) {
  if (updateLocks.has(lockKey)) return false;
  updateLocks.set(lockKey, true);
  return true;
}
function releaseLock(lockKey) {
  updateLocks.delete(lockKey);
}

// Fire the secondary "overall standings" recompute + broadcast without
// making the caller wait on it — it's an aggregate view, not the primary
// resource being mutated, so there's no correctness reason to block the
// HTTP response on it. Shaves the slowest part of every write off the
// response time the client actually sees.
//
// Also pushes to the PUBLIC overlay room (`round:${tournamentId}:${roundId}`,
// see PublicThemeRenderer.tsx) — msgpack-encoded binary, same event names
// (liveMatchUpdate/overallDataUpdate) the automatic API live-tick path
// (pubgApiMatchData.controller.js) already uses. Manual edits used to reach
// the overlay via comsock.js's MongoDB change-stream watcher (deleted this
// session); this is what replaces that for the manual-entry path
// specifically. `matchData` is the caller's already-updated document —
// passing it through avoids a redundant re-fetch.
function emitOverallUpdateAsync(io, matchId, userId, matchData) {
  console.log(`[socket] emitOverallUpdateAsync called matchId=${matchId} userId=${userId} hasMatchData=${!!matchData}`);
  Match.findById(matchId).lean()
    .then(match => {
      if (!match) {
        console.warn(`[socket] emitOverallUpdateAsync: no Match found for matchId=${matchId} — nothing emitted`);
        return;
      }
      const matchDataRoom = `round:${match.tournamentId}:${match.roundId}:matchData`;
      const matchDataPositionalRoom = `round:${match.tournamentId}:${match.roundId}:matchDataPositional`;
      const overallRoom = `round:${match.tournamentId}:${match.roundId}:overall`;
      console.log(`[bw][emit] emitOverallUpdateAsync: matchDataRoom=${matchDataRoom} (${io.sockets.adapter.rooms.get(matchDataRoom)?.size || 0} sockets) matchDataPositionalRoom=${matchDataPositionalRoom} (${io.sockets.adapter.rooms.get(matchDataPositionalRoom)?.size || 0} sockets) overallRoom=${overallRoom} (${io.sockets.adapter.rooms.get(overallRoom)?.size || 0} sockets)`);

      if (matchData) {
        // Same core/positional split as the automatic live-tick path
        // (pubgApiMatchData.controller.js's emitUpdates) — this is a
        // second, separate emitter into the same rooms for manual
        // dashboard edits, so it needs the same split or a manual edit
        // would leak `location` straight into the core room.
        emitToRoomSplitByFormat(io, matchDataRoom, 'liveMatchUpdate', {
          protoMessageName: 'MatchDataPayload',
          mapToProto: toProtoMatchDataPayload,
          data: { ...matchData, teams: stripPositionalFields(matchData.teams), matchId: String(matchId) },
          volatile: false,
        });
        emitToRoomSplitByFormat(io, matchDataPositionalRoom, 'liveMatchUpdate', {
          protoMessageName: 'MatchDataPayload',
          mapToProto: toProtoMatchDataPayload,
          data: { ...matchData, matchId: String(matchId) },
          volatile: false,
        });
      }

      return computeOverallMatchDataForRound(match.tournamentId, match.roundId, matchId, userId)
        .then(overallTeams => {
          const overallPayload = {
            tournamentId: match.tournamentId,
            roundId: match.roundId,
            matchId,
            teams: overallTeams,
            createdAt: new Date(),
          };
          // NOTE: no `user:${userId}` emit here — confirmed zero consumers
          // of overallDataUpdate on that room anywhere in front/ or
          // desktop-app/. Removed as dead traffic; see plan step 1.
          console.log(`[bw][overall] overallDataUpdate -> ${overallRoom} match=${matchId} teams=${overallTeams.length}`);
          emitToRoomSplitByFormat(io, overallRoom, 'overallDataUpdate', {
            protoMessageName: 'OverallDataPayload',
            mapToProto: toProtoOverallDataPayload,
            data: overallPayload,
            volatile: false,
          });
        });
    })
    .catch(err => console.warn('Failed to emit overall data update:', err.message));
}

const createMatchDataForMatchDoc = async (matchOrId) => {
  try {
    if (!matchOrId) throw new Error('No matchId provided');
    const matchId = typeof matchOrId === 'object' && matchOrId._id ? matchOrId._id : matchOrId;

    // Read-only fetch — .lean() skips document hydration since we only
    // ever read from `match` here, we never save() it.
    const match = await Match.findById(matchId).populate({
      path: 'groups',
      populate: {
        path: 'slots.team',
        populate: { path: 'players' },
      }
    }).lean();

    if (!match) throw new Error('Match not found');

    let teams = (match.groups || []).flatMap(group =>
      (group.slots || [])
        .filter(slot => slot.team)
        .map(slot => ({
          slot: slot.slot,
          teamId: slot.team._id,
          teamLogo: slot.team.logo || '',
          teamName: slot.team.teamFullName || slot.team.teamName || '',
          teamTag: slot.team.teamTag || '',
          players: (slot.team.players || []).slice(0, 4)
            .map(player => buildFreshPlayer(player, slot.slot, slot.team.teamFullName || '')),
        }))
    );

    teams.sort((a, b) => a.slot - b.slot);

    const matchData = new MatchData({
      matchId: match._id,
      userId: match.userId,
      teams
    });

    await matchData.save();
    return matchData;
  } catch (error) {
    console.error('Error creating MatchData:', error);
    throw error;
  }
};

// Builds a MatchData team entry from a populated Group slot — the same shape
// createMatchDataForMatchDoc produces at match-creation time.
function buildSlotTeam(slot) {
  const teamName = slot.team.teamFullName || slot.team.teamName || '';
  return {
    slot: slot.slot,
    teamId: slot.team._id,
    teamLogo: slot.team.logo || '',
    teamName,
    teamTag: slot.team.teamTag || '',
    players: (slot.team.players || []).slice(0, 4)
      .map(player => buildFreshPlayer(player, slot.slot, teamName)),
  };
}

// Any per-player value that only live/recorded data sets — a freshly
// created roster player (buildFreshPlayer) has all of these at 0.
const PLAYER_DATA_FIELDS = [
  'killNum', 'damage', 'knockouts', 'assists', 'survivalTime', 'inDamage',
  'heal', 'headShotNum', 'health', 'healthMax', 'liveState', 'rank',
];

// True once a match has ANY recorded data: a placement/rank on a team or any
// live stat on a player. Such a match's slots are history: round-robin
// groups get re-slotted between matches (a group plays 11–18 one match,
// 3–10 the next), and rewriting a played match's slots/teams to the group's
// new layout would make it collide with the other group's slots.
//
// rosterSynced is set in the DB by the live updater on the first tick that
// carries live player data (pubgApiMatchData.controller.js) — a durable
// "this match has gone live" signal even while LIVE_AUTOSAVE is off and the
// stats themselves only live in memory until SAVE DATA.
function matchHasResults(matchData) {
  if (matchData?.rosterSynced) return true;
  return (matchData?.teams || []).some(t =>
    Number(t.placePoints || 0) > 0 ||
    Number(t.rank || 0) > 0 ||
    (t.players || []).some(p => PLAYER_DATA_FIELDS.some(f => Number(p?.[f] || 0) > 0))
  );
}

// Projection with just enough of MatchData to evaluate matchHasResults.
const RESULTS_PROJECTION = 'matchId rosterSynced teams.placePoints teams.rank ' +
  PLAYER_DATA_FIELDS.map(f => `teams.players.${f}`).join(' ');

// A locked match's MatchData is frozen against group edits: no slot moves,
// no added/swapped teams — only team name/tag/logo still refresh. A match
// locks automatically as soon as it has any data: recorded in the DB, or
// live in the auto-update cache (not yet persisted by SAVE DATA). The live
// updater routes squads by team.slot every tick, so a slot change mid-match
// would put live stats on the wrong teams.
function isMatchLocked(match, matchData) {
  if (matchHasResults(matchData)) return true;
  const matchId = match?._id || matchData?.matchId;
  if (!matchId) return false;
  // Lazy require: the live controller loads modules that load this file.
  const { getLiveMatchData } = require('./Api_controllers/pubgApiMatchData.controller.js');
  return matchHasResults(getLiveMatchData(matchId));
}

// Locked path: refresh display metadata of teams already in the match and
// nothing else. Returns the per-team change list (empty when nothing moved).
function refreshLockedMatchMetadata(matchData, slots) {
  const changedTeams = [];
  let changed = false;
  for (const slot of slots) {
    if (!slot.team) continue;
    const existing = matchData.teams.find(t => String(t.teamId) === String(slot.team._id));
    if (!existing) continue;
    const { changed: metaChanged, fieldChanges } = refreshTeamMetadata(existing, slot, { keepSlot: true });
    if (metaChanged) changed = true;
    if (Object.keys(fieldChanges).length > 0) {
      changedTeams.push({ teamId: existing.teamId, changes: fieldChanges });
    }
  }
  return { changed, changedTeams };
}

// Same team — only refresh display metadata, never touch live stats/roster.
// Returns the changed display fields ({} when nothing changed).
function refreshTeamMetadata(existing, slot, { keepSlot = false } = {}) {
  const teamName = slot.team.teamFullName || slot.team.teamName || '';
  const teamTag = slot.team.teamTag || '';
  const teamLogo = slot.team.logo || '';
  const fieldChanges = {};
  let changed = false;
  if (!keepSlot && existing.slot !== slot.slot) { existing.slot = slot.slot; changed = true; }
  if (existing.teamName !== teamName) { existing.teamName = teamName; changed = true; fieldChanges.teamName = teamName; }
  if (existing.teamTag !== teamTag) { existing.teamTag = teamTag; changed = true; fieldChanges.teamTag = teamTag; }
  if (existing.teamLogo !== teamLogo) { existing.teamLogo = teamLogo; changed = true; fieldChanges.teamLogo = teamLogo; }
  return { changed, fieldChanges };
}

// Save a reconciled MatchData and push it to the operator console, the
// overlay rooms, and (once per round) the public revision.
async function persistSyncedMatchData(io, matchData, changedTeams, mref, bumpedRounds, reason) {
  matchData.markModified('teams');
  await matchData.save();

  // Push to the operator console (per-team, same event/shape every other
  // MatchData mutation already uses) and to the public overlay's round
  // room (via the existing manual-edit broadcast helper), so a team
  // rename/logo swap shows up immediately instead of waiting on the
  // console's next fetch or the overlay's poll fallback.
  for (const { teamId, changes } of changedTeams) {
    io.to(`user:${matchData.userId}`).emit('matchDataUpdated', {
      matchDataId: matchData._id,
      teamId,
      changes,
    });
  }
  emitOverallUpdateAsync(io, matchData.matchId, matchData.userId, matchData.toObject());

  // Team identity/roster in this MatchData changed -> the public bulk
  // payload for the whole round changed (overallData folds every match).
  if (mref && mref.roundId && !bumpedRounds.has(String(mref.roundId))) {
    bumpedRounds.add(String(mref.roundId));
    bumpRound(io, {
      tournamentId: mref.tournamentId,
      roundId: mref.roundId,
      matchId: matchData.matchId,
      reason,
      scope: 'round',
    });
  }
}

const teamIdsOfGroup = (g) => (g?.slots || [])
  .filter(s => s.team)
  .map(s => String(s.team._id || s.team));

// Reconciles existing MatchData docs against a Group's current slots.
// createMatchDataForMatchDoc only ever runs once, at match-creation time —
// if a team is added to (or swapped into) a group slot afterwards, the
// matches that already exist for that group never learn about it. This
// walks every such match and patches in what's missing, without touching
// already-recorded live stats (placePoints, per-player fields) for teams
// that are unchanged.
//
// Teams are matched by teamId. Slot numbers are only unique WITHIN a group —
// round-robin rounds reuse the same slot numbers in every group and pair
// groups per match (A vs B, A vs C…) — so a bare slot match used to treat
// the OTHER group's team at that slot as a "swap" and overwrite it, dropping
// teams from the match (and from overall standings).
const syncMatchDataTeamsForGroup = async (groupId) => {
  try {
    const group = await Group.findById(groupId).populate({
      path: 'slots.team',
      populate: { path: 'players' },
    }).lean();
    if (!group) return;

    // Each match's groups (team ids only) so a slot-swap is only ever
    // resolved against a team that doesn't belong to another group.
    const matches = await Match.find({ groups: group._id })
      .select('_id tournamentId roundId groups')
      .populate({ path: 'groups', select: 'slots.team' })
      .lean();
    if (!matches.length) return;
    const matchById = new Map(matches.map(m => [String(m._id), m]));

    const matchDatas = await MatchData.find({ matchId: { $in: matches.map(m => m._id) } });

    const io = getSocket();
    const bumpedRounds = new Set();
    const thisGroupTeamIds = new Set(teamIdsOfGroup(group));

    for (const matchData of matchDatas) {
      const mref = matchById.get(String(matchData.matchId));

      // Locked match: the group edit must not reach inside it (slots and
      // team list stay as played/configured) — only names/logos refresh.
      if (isMatchLocked(mref, matchData)) {
        const locked = refreshLockedMatchMetadata(matchData, group.slots || []);
        if (locked.changed) {
          await persistSyncedMatchData(io, matchData, locked.changedTeams, mref, bumpedRounds, 'syncGroup');
        }
        continue;
      }

      const otherGroupTeamIds = new Set(
        (mref?.groups || [])
          .filter(g => g && String(g._id) !== String(group._id))
          .flatMap(teamIdsOfGroup)
      );

      let changed = false;
      // Per-team diffs collected as we go, so we can push exactly what
      // changed to live listeners after save instead of re-diffing.
      const changedTeams = [];

      for (const slot of group.slots || []) {
        if (!slot.team) continue;

        const existing = matchData.teams.find(t => String(t.teamId) === String(slot.team._id));
        if (existing) {
          const { changed: metaChanged, fieldChanges } = refreshTeamMetadata(existing, slot);
          if (metaChanged) changed = true;
          if (Object.keys(fieldChanges).length > 0) {
            changedTeams.push({ teamId: existing.teamId, changes: fieldChanges });
          }
          continue;
        }

        const fresh = buildSlotTeam(slot);
        // A real in-group swap: the team at this slot is no longer in this
        // group and isn't another group's team either.
        const swapped = matchData.teams.find(t =>
          t.slot === slot.slot &&
          !thisGroupTeamIds.has(String(t.teamId)) &&
          !otherGroupTeamIds.has(String(t.teamId))
        );

        if (swapped) {
          // Slot's team was swapped — replace identity/roster, drop stale stats.
          Object.assign(swapped, fresh, { placePoints: 0, rank: 0, placePointsLocked: false });
        } else {
          // Brand new team in this match — add it.
          matchData.teams.push(fresh);
        }
        changed = true;
        const { teamName, teamTag, teamLogo, players } = fresh;
        changedTeams.push({ teamId: slot.team._id, changes: { teamName, teamTag, teamLogo, players } });
      }

      if (changed) {
        await persistSyncedMatchData(io, matchData, changedTeams, mref, bumpedRounds, 'syncGroup');
      }
    }
  } catch (error) {
    console.error('Error syncing MatchData teams for group:', error);
  }
};

// Reconciles ONE match's MatchData against the teams of every group the
// match currently has: adds any team (by teamId) that is missing and
// refreshes display metadata of those present. Never removes a team and
// never touches recorded stats. Used when a match's / round's groups change,
// and as the repair for MatchData damaged by the old slot-based sync
// (duplicate teamIds are collapsed, keeping the later — original — entry).
// A locked match (see isMatchLocked) only gets name/logo refreshes unless
// `force` is set — force is reserved for the explicit Resync Teams repair,
// which still never moves an existing team's slot in a locked match.
// Returns { added, deduped, locked } counts.
const syncMatchDataTeamsForMatch = async (matchId, { reason = 'syncMatch', force = false } = {}) => {
  const match = await Match.findById(matchId).populate({
    path: 'groups',
    populate: { path: 'slots.team', populate: { path: 'players' } },
  }).lean();
  if (!match) return { added: 0, deduped: 0 };

  const matchData = await MatchData.findOne({ matchId: match._id });
  if (!matchData) {
    const created = await createMatchDataForMatchDoc(match._id);
    return { added: created?.teams?.length || 0, deduped: 0 };
  }

  const locked = isMatchLocked(match, matchData);
  const allSlots = (match.groups || []).flatMap(g => g?.slots || []);
  if (locked && !force) {
    const res = refreshLockedMatchMetadata(matchData, allSlots);
    if (res.changed) {
      await persistSyncedMatchData(getSocket(), matchData, res.changedTeams, match, new Set(), reason);
    }
    return { added: 0, deduped: 0, locked: true };
  }

  let changed = false;
  const changedTeams = [];

  // Collapse duplicate teamIds left behind by the old slot-based "swap".
  // The EARLIER entry is the overwritten other-group team (roster reset,
  // but its placePoints/rank are still that overwritten team's real
  // placement); the LATER entry is the original with the real live stats.
  // Keep the later one and remember what the dropped one held, by slot.
  const lastIndexByTeam = new Map();
  matchData.teams.forEach((t, i) => lastIndexByTeam.set(String(t.teamId), i));
  const before = matchData.teams.length;
  const droppedBySlot = new Map(); // slot -> { placePoints, rank }
  const deduped = matchData.teams.filter((t, i) => {
    if (lastIndexByTeam.get(String(t.teamId)) === i) return true;
    if (!droppedBySlot.has(t.slot)) {
      droppedBySlot.set(t.slot, { placePoints: Number(t.placePoints || 0), rank: Number(t.rank || 0) });
    }
    return false;
  });
  if (deduped.length !== before) {
    console.warn(`[syncMatch] match=${match._id} removed ${before - deduped.length} duplicate team entr(y/ies)`);
    matchData.teams = deduped;
    changed = true;
  }

  const keepSlot = locked; // forced repair of a locked match never moves slots
  let added = 0;
  for (const group of match.groups || []) {
    for (const slot of group?.slots || []) {
      if (!slot.team) continue;
      const existing = matchData.teams.find(t => String(t.teamId) === String(slot.team._id));
      if (existing) {
        const { changed: metaChanged, fieldChanges } = refreshTeamMetadata(existing, slot, { keepSlot });
        if (metaChanged) changed = true;
        if (Object.keys(fieldChanges).length > 0) {
          changedTeams.push({ teamId: existing.teamId, changes: fieldChanges });
        }
        continue;
      }
      const fresh = buildSlotTeam(slot);
      // A team re-added into the slot a dropped duplicate occupied gets that
      // entry's placement back (it was this team's result before the old
      // sync overwrote it). Kills were reset by that overwrite and are lost.
      const recovered = droppedBySlot.get(fresh.slot);
      if (recovered) {
        fresh.placePoints = recovered.placePoints;
        fresh.rank = recovered.rank;
        droppedBySlot.delete(fresh.slot);
      }
      matchData.teams.push(fresh);
      added++;
      changed = true;
      console.log(`[syncMatch] match=${match._id} re-added team ${fresh.teamName} (slot ${fresh.slot}, group ${group.groupName || group._id})${recovered ? ` with recovered placePoints=${recovered.placePoints}` : ''}`);
      const { teamName, teamTag, teamLogo, players } = fresh;
      changedTeams.push({ teamId: slot.team._id, changes: { teamName, teamTag, teamLogo, players } });
    }
  }

  if (changed) {
    matchData.teams.sort((a, b) => a.slot - b.slot);
    await persistSyncedMatchData(getSocket(), matchData, changedTeams, match, new Set(), reason);
  }
  return { added, deduped: before - deduped.length, locked };
};

// Get MatchData by matchId (user-scoped)
const getMatchDataByMatchId = async (req, res) => {
  try {
    const { matchId } = req.params;
    let userId = req.session && req.session.userId;

    if (!userId) {
      const match = await Match.findById(matchId).lean();
      if (!match) return res.status(404).json({ error: 'Match not found' });
      const round = await Round.findById(match.roundId).lean();
      if (!round) return res.status(404).json({ error: 'Round not found' });
      const tournament = await Tournament.findById(round.tournamentId).lean();
      if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
      userId = tournament.createdBy;
    }

    let match = await Match.findOne({ _id: matchId, userId }).lean();

    if (!match) {
      const possible = await Match.findById(matchId).lean();
      if (!possible) return res.status(404).json({ error: 'Match not found' });

      // A match that's already owned by someone else must never be
      // silently reassigned to the current caller — only backfill
      // ownership for genuinely unowned (legacy) matches.
      if (possible.userId) {
        return res.status(404).json({ error: 'Match not found or not yours' });
      }

      const round = await Round.findOne({ _id: possible.roundId, createdBy: userId }).lean();
      if (!round) return res.status(404).json({ error: 'Match not found or not yours' });

      await Match.updateOne({ _id: possible._id, userId: { $exists: false } }, { $set: { userId } });
      match = { ...possible, userId };
    }

    let matchData = await MatchData.findOne({ matchId: match._id, userId }).lean();

    if (!matchData) {
      try {
        const created = await createMatchDataForMatchDoc(match._id);
        if (created && !created.userId) {
          created.userId = userId;
          await created.save();
        }
        matchData = created ? created.toObject() : null;
      } catch (e) {
        return res.json({ _id: null, matchId: match._id, userId, teams: [] });
      }
    }

    if (!matchData) return res.json({ _id: null, matchId: match._id, userId, teams: [] });

    res.json(matchData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// === Update Team Points & Emit via Socket ===
const updateTeamPoints = async (req, res) => {
  const { matchId, matchDataId, teamId } = req.params;
  const lockKey = `${matchDataId}-${teamId}-points`;

  if (!acquireLock(lockKey)) {
    console.log('Team points update already in progress for:', lockKey);
    return res.status(429).json({ error: 'Update already in progress, please wait' });
  }

  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = req.session.userId;

    const { placePoints, rank, unlock } = req.body;
    if (typeof placePoints !== 'number') {
      return res.status(400).json({ error: 'placePoints must be a number' });
    }

    const teamObjId = toObjectIdOrNull(teamId);
    if (!teamObjId) return res.status(400).json({ error: 'Invalid teamId' });

    // Manually correcting placePoints locks it so the live-poll scoring
    // loop (pubgApiMatchData.controller.js) doesn't silently overwrite the
    // correction on its next tick. Pass `unlock: true` to hand control
    // back to auto-scoring. `rank` is optional — pass it alongside
    // placePoints when correcting a team whose real placement also needs
    // fixing (WWCD/standings key off rank, not placePoints).
    const setFields = {
      'teams.$[team].placePoints': placePoints,
      'teams.$[team].placePointsLocked': unlock !== true,
    };
    if (typeof rank === 'number') {
      setFields['teams.$[team].rank'] = rank;
    }

    // Ownership + team-location + write, all in ONE atomic round trip —
    // replaces the old "fetch Match, fetch MatchData, then $set with
    // arrayFilters" 3-query sequence with a single findOneAndUpdate whose
    // own filter already proves ownership (matchData.userId === req.session.userId).
    const result = await MatchData.findOneAndUpdate(
      { _id: matchDataId, matchId, userId },
      { $set: setFields },
      {
        new: true,
        arrayFilters: [{ $or: [{ 'team._id': teamObjId }, { 'team.teamId': teamObjId }] }],
      }
    ).lean();

    if (!result) return res.status(404).json({ error: 'MatchData or Team not found, or not yours' });

    const io = getSocket();
    console.log(`[socket] matchDataUpdated -> user:${userId} team=${teamId}`);
    io.to(`user:${userId}`).emit('matchDataUpdated', { matchDataId, teamId, changes: { placePoints } });

    // Respond immediately — the client doesn't need to wait on the
    // secondary "overall standings" recompute below.
    res.json({ message: 'Team placePoints updated', matchDataId, teamId, changes: { placePoints } });

    emitOverallUpdateAsync(io, matchId, userId, result);
    bumpRound(io, {
      tournamentId: req.params.tournamentId,
      roundId: req.params.roundId,
      matchId,
      reason: 'updateTeamPoints',
      scope: 'round',
    });
  } catch (error) {
    console.error('Error updating team points:', error);
    res.status(500).json({ error: error.message });
  } finally {
    releaseLock(lockKey);
  }
};

// === Update a single player's stats (PATCH) ===
//
// WHY THIS WAS FAILING INTERMITTENTLY:
// The old implementation did: findById(matchDataId) -> mutate the JS object
// -> matchData.save(). Mongoose documents carry an optimistic-concurrency
// version key (`__v`) under the hood, and .save() throws a VersionError if
// the document changed in the DB between your findById and your save. In a
// live-scoring tool, operators fire off several PATCH requests for
// different players/stats within milliseconds of each other — exactly the
// pattern that triggers this. Two of `updateTeamPoints` and
// `updateTeamPlayersBulkStats` already had `updateLocks` guarding them, but
// this endpoint had none, and even a lock only prevents identical duplicate
// requests, not two *different* concurrent PATCHes racing on the same
// document's version.
//
// FIX: replaced the read-modify-save cycle with a single atomic
// findOneAndUpdate using arrayFilters to reach the exact player field(s).
// Mongo handles the write atomically at the document level, so there's
// nothing to version-conflict on, and it's also strictly fewer round trips
// (was 3 auth/lookup queries + 1 save; now 1 query total).
const updatePlayerStats = async (req, res) => {
  try {
    const { matchId, matchDataId, teamId, playerId } = req.params;
    const updateData = req.body;

    if (!matchId || !matchDataId || !teamId || !playerId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized - No session' });
    }
    const userId = req.session.userId;

    const teamObjId = toObjectIdOrNull(teamId);
    const playerObjId = toObjectIdOrNull(playerId);
    if (!teamObjId || !playerObjId) {
      return res.status(400).json({ error: 'Invalid teamId or playerId' });
    }

    // NOTE: 'killNum' is intentionally NOT in this list. It used to be
    // present here *and* handled separately via killNumChange below — if a
    // caller sent both in the same payload, whichever code path ran last
    // silently won, and the two could fight each other across requests.
    // It now has exactly one path: absolute value OR delta, never both.
    const allowedFields = [
      'playerName', 'playerOpenId', 'picUrl', 'showPicUrl', 'character', 'isFiring',
      'bHasDied', 'health', 'healthMax', 'liveState', 'killNumBeforeDie',
      'playerKey', 'gotAirDropNum', 'maxKillDistance', 'damage', 'heal', 'killNumInVehicle',
      'killNumByGrenade', 'AIKillNum', 'BossKillNum', 'rank', 'isOutsideBlueCircle',
      'inDamage', 'headShotNum', 'survivalTime', 'driveDistance', 'marchDistance',
      'assists', 'outsideBlueCircleTime', 'knockouts', 'rescueTimes',
      'useSmokeGrenadeNum', 'useFragGrenadeNum', 'useBurnGrenadeNum', 'useFlashGrenadeNum',
      'PoisonTotalDamage', 'UseSelfRescueTime', 'UseEmergencyCallTime', 'teamIdfromApi',
      'contribution', 'location'
    ];

    // These should never legitimately go negative — an operator mistyping
    // a value (or a stray negative delta, see killNumChange below) must not
    // be able to write a negative stat straight into MongoDB with zero
    // validation (the schema itself has no `min` guard on these).
    const NONNEG_NUMERIC_FIELDS = new Set([
      'health', 'healthMax', 'liveState', 'killNumBeforeDie', 'gotAirDropNum',
      'maxKillDistance', 'damage', 'heal', 'killNumInVehicle', 'killNumByGrenade',
      'AIKillNum', 'BossKillNum', 'rank', 'inDamage', 'headShotNum',
      'survivalTime', 'driveDistance', 'marchDistance', 'assists',
      'outsideBlueCircleTime', 'knockouts', 'rescueTimes', 'useSmokeGrenadeNum',
      'useFragGrenadeNum', 'useBurnGrenadeNum', 'useFlashGrenadeNum',
      'PoisonTotalDamage', 'UseSelfRescueTime', 'UseEmergencyCallTime',
      'contribution',
    ]);

    const setOps = {};
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        let value = updateData[field];
        if (NONNEG_NUMERIC_FIELDS.has(field) && typeof value === 'number') {
          value = Math.max(0, value);
        }
        setOps[`teams.$[team].players.$[player].${field}`] = value;
      }
    });

    const arrayFilters = [
      { $or: [{ 'team._id': teamObjId }, { 'team.teamId': teamObjId }] },
      { 'player._id': playerObjId },
    ];

    let updated;
    if (updateData.killNumChange !== undefined) {
      const change = Number(updateData.killNumChange) || 0;
      if (change < 0) {
        // Don't trust the caller's delta to already be floor-safe — it was
        // computed client-side against a possibly-stale local killNum
        // (front/src/dashboard/matchDataController.tsx's updateKillCount),
        // and a blind $inc here could drive the real, current value
        // negative if a live PCOB tick moved it in between. Instead,
        // atomically apply the decrement ONLY if the CURRENT stored value
        // (checked by Mongo itself, at write time, via the arrayFilter
        // condition below — not a separate read-then-write race) can
        // absorb it without crossing zero; otherwise fall through and
        // clamp to exactly 0. Both branches remain single atomic
        // findOneAndUpdate calls, same pattern as the rest of this
        // endpoint.
        updated = await MatchData.findOneAndUpdate(
          { _id: matchDataId, matchId, userId },
          { $inc: { 'teams.$[team].players.$[player].killNum': change }, ...(Object.keys(setOps).length ? { $set: setOps } : {}) },
          {
            new: true,
            arrayFilters: [
              arrayFilters[0],
              { ...arrayFilters[1], 'player.killNum': { $gte: -change } },
            ],
          }
        ).lean();

        if (!updated) {
          updated = await MatchData.findOneAndUpdate(
            { _id: matchDataId, matchId, userId },
            { $set: { ...setOps, 'teams.$[team].players.$[player].killNum': 0 } },
            { new: true, arrayFilters }
          ).lean();
        }
      } else {
        updated = await MatchData.findOneAndUpdate(
          { _id: matchDataId, matchId, userId },
          { $inc: { 'teams.$[team].players.$[player].killNum': change }, ...(Object.keys(setOps).length ? { $set: setOps } : {}) },
          { new: true, arrayFilters }
        ).lean();
      }
    } else {
      if (updateData.killNum !== undefined) {
        setOps['teams.$[team].players.$[player].killNum'] = Math.max(0, Number(updateData.killNum) || 0);
      }
      if (!Object.keys(setOps).length) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }
      updated = await MatchData.findOneAndUpdate(
        { _id: matchDataId, matchId, userId },
        { $set: setOps },
        { new: true, arrayFilters }
      ).lean();
    }

    if (!updated) {
      return res.status(404).json({ error: 'MatchData not found or not yours' });
    }

    const team = updated.teams.find(t => matchesTeamId(t, teamId));
    const player = team?.players.find(p => String(p._id) === String(playerId));
    if (!team || !player) {
      return res.status(404).json({ error: 'Team or player not found' });
    }

    const updates = {};
    allowedFields.forEach(f => { if (updateData[f] !== undefined) updates[f] = updateData[f]; });
    if (updateData.killNumChange !== undefined || updateData.killNum !== undefined) {
      updates.killNum = player.killNum;
    }

    const io = getSocket();
    const room = `user:${userId}`;
    console.log(`[socket] playerStatsUpdated -> ${room} player=${playerId}`);
    io.to(room).emit('playerStatsUpdated', { matchDataId, teamId, playerId, updates });

    if (updates.killNum !== undefined) {
      const teamTotalKills = team.players.reduce((sum, p) => sum + (p.killNum || 0), 0);
      io.to(room).emit('teamStatsUpdated', {
        matchDataId,
        teamId,
        totalKills: teamTotalKills,
        players: team.players.map(p => ({ _id: p._id, killNum: p.killNum })),
      });
    }

    res.json({ message: 'Player stats updated', player });

    emitOverallUpdateAsync(io, matchId, userId, updated);
    bumpRound(io, {
      tournamentId: req.params.tournamentId,
      roundId: req.params.roundId,
      matchId,
      reason: 'updatePlayerStats',
      scope: 'round',
    });
  } catch (error) {
    console.error('Error in updatePlayerStats:', error);
    res.status(500).json({ error: error.message });
  }
};

const deleteMatchDataById = async (req, res) => {
  try {
    const { tournamentId, roundId, matchId } = req.params;
    const match = await Match.findOneAndDelete({ _id: matchId, tournamentId, roundId, userId: req.session.userId });
    if (!match) return res.status(404).json({ error: 'Match not found in this round/tournament' });
    await MatchData.deleteMany({ matchId: match._id, userId: req.session.userId });
    // Deletes a Match (+ its MatchData): matches list, current match and
    // standings all change. Structural signal; also folds the round publicRev
    // bump so the local relay + overlays refetch immediately.
    notifyRoundStructureChanged(match.tournamentId, match.roundId);
    return res.json({ message: 'Match and related MatchData deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Bulk update all players in a team (e.g., toggle bHasDied for entire team)
const updateTeamPlayersBulkStats = async (req, res) => {
  const { matchId, matchDataId, teamId } = req.params;
  const lockKey = `${matchDataId}-${teamId}-bulk`;

  if (!acquireLock(lockKey)) {
    console.log('Bulk team update already in progress for:', lockKey);
    return res.status(429).json({ error: 'Update already in progress, please wait' });
  }

  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = req.session.userId;

    const { bHasDied } = req.body;
    if (typeof bHasDied !== 'boolean') {
      return res.status(400).json({ error: 'bHasDied must be a boolean' });
    }

    const teamObjId = toObjectIdOrNull(teamId);
    if (!teamObjId) return res.status(400).json({ error: 'Invalid teamId' });

    // `players.$[]` applies to every element of the nested players array in
    // one atomic write — no need to load the document, mutate every player
    // in JS, then save() the whole thing back.
    const result = await MatchData.findOneAndUpdate(
      { _id: matchDataId, matchId, userId },
      { $set: { 'teams.$[team].players.$[].bHasDied': bHasDied } },
      {
        new: true,
        arrayFilters: [{ $or: [{ 'team._id': teamObjId }, { 'team.teamId': teamObjId }] }],
      }
    ).lean();

    if (!result) return res.status(404).json({ error: 'MatchData or Team not found, or not yours' });

    const team = result.teams.find(t => matchesTeamId(t, teamId));

    const io = getSocket();
    console.log(`[socket] matchDataUpdated -> user:${userId} team=${teamId} bulkDied`);
    io.to(`user:${userId}`).emit('matchDataUpdated', {
      matchDataId,
      teamId,
      changes: { players: team.players.map(p => ({ _id: p._id, bHasDied: p.bHasDied })) },
    });

    res.json({ message: 'Team players updated', teamId, bHasDied });

    emitOverallUpdateAsync(io, matchId, userId, result);
    bumpRound(io, {
      tournamentId: req.params.tournamentId,
      roundId: req.params.roundId,
      matchId,
      reason: 'bulkTeamStats',
      scope: 'round',
    });
  } catch (error) {
    console.error('Error in bulk team update:', error);
    res.status(500).json({ error: error.message });
  } finally {
    releaseLock(lockKey);
  }
};

const updatePlayerByIdInMatchData = async (req, res) => {
  try {
    const { matchDataId, teamId } = req.params;
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { replacements } = req.body;

    if (!Array.isArray(replacements) || replacements.length === 0) {
      return res.status(400).json({ error: 'No replacements provided' });
    }

    // Single ownership-scoped fetch — the previous version's real working
    // query (`MatchData.findById(matchDataId)`, further down) had NO
    // userId filter at all and relied entirely on a separate check-and-
    // discard query earlier in the function. This one query now both
    // proves ownership and is the doc we actually mutate.
    const matchData = await MatchData.findOne({ _id: matchDataId, userId: req.session.userId });
    if (!matchData) return res.status(404).json({ error: 'MatchData not found or not yours' });

    const team = matchData.teams.find(t => matchesTeamId(t, teamId));
    if (!team) return res.status(404).json({ error: 'Team not found in MatchData' });

    const match = await Match.findById(matchData.matchId).populate({
      path: 'groups',
      populate: { path: 'slots.team', model: 'Team' }
    }).lean();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const matchTeam = (match.groups || [])
      .flatMap(g => g.slots || [])
      .map(s => s.team)
      .find(t => t && String(t._id) === String(team.teamId));
    if (!matchTeam) return res.status(404).json({ error: 'Matching team not found in match groups' });

    replacements.forEach(({ oldPlayerId, newPlayerId }) => {
      const playerIndex = team.players.findIndex(p => p._id.toString() === oldPlayerId);
      if (playerIndex === -1) return;

      const newPlayer = matchTeam.players.find(p => p._id.toString() === newPlayerId);
      if (!newPlayer) return;

      team.players[playerIndex] = buildFreshPlayer(newPlayer, team.slot, team.teamName);
    });

    matchData.markModified('teams');
    await matchData.save();

    const io = getSocket();
    console.log(`[socket] matchDataUpdated -> user:${req.session.userId} team=${teamId} replaced`);
    io.to(`user:${req.session.userId}`).emit('matchDataUpdated', { matchDataId, teamId, changes: { players: team.players } });

    // Roster change is invisible to the round rooms otherwise (matchDataUpdated
    // only goes to user:<id>). Bump the round's publicRev so overlays refetch.
    bumpRound(io, {
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      matchId: matchData.matchId,
      reason: 'replaceRoster',
      scope: 'round',
    });

    return res.json({ message: 'Players updated successfully', team });
  } catch (err) {
    console.error('Error updating players in MatchData:', err);
    return res.status(500).json({ error: err.message });
  }
};

const addPlayersToTeamInMatchData = async (req, res) => {
  try {
    const { matchDataId, teamId } = req.params;
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { newPlayerIds } = req.body;

    if (!Array.isArray(newPlayerIds) || newPlayerIds.length === 0) {
      return res.status(400).json({ error: 'newPlayerIds must be a non-empty array' });
    }
    if (
      !mongoose.Types.ObjectId.isValid(matchDataId) ||
      !mongoose.Types.ObjectId.isValid(teamId) ||
      !newPlayerIds.every(id => mongoose.Types.ObjectId.isValid(id))
    ) {
      return res.status(400).json({ error: 'Invalid ObjectId format for one or more IDs' });
    }

    const matchData = await MatchData.findOne({ _id: matchDataId, userId: req.session.userId });
    if (!matchData) return res.status(404).json({ error: 'MatchData not found or not yours' });

    const team = matchData.teams.find(t => matchesTeamId(t, teamId));
    if (!team) return res.status(404).json({ error: 'Team not found in this MatchData' });

    const match = await Match.findById(matchData.matchId).populate({
      path: 'groups',
      populate: { path: 'slots.team', model: 'Team' }
    }).lean();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    let matchTeam = null;
    for (const group of match.groups || []) {
      for (const slot of group.slots || []) {
        if (slot.team && String(slot.team._id) === String(team.teamId)) {
          matchTeam = slot.team;
          break;
        }
      }
      if (matchTeam) break;
    }
    if (!matchTeam) return res.status(404).json({ error: 'Matching team not found in match groups' });

    const playersToAdd = newPlayerIds
      .filter(id => !team.players.some(p => p._id.toString() === id))
      .map(id => matchTeam.players.find(p => p._id.toString() === id))
      .filter(Boolean);

    if (playersToAdd.length === 0) {
      return res.status(400).json({ error: 'All players are already in the team or invalid' });
    }

    playersToAdd.forEach(newPlayer => {
      team.players.push(buildFreshPlayer(newPlayer, team.slot, team.teamName));
    });

    matchData.markModified('teams');
    await matchData.save();

    const io = getSocket();
    console.log(`[socket] matchDataUpdated -> user:${req.session.userId} team=${teamId} added`);
    io.to(`user:${req.session.userId}`).emit('matchDataUpdated', { matchDataId, teamId, changes: { players: team.players } });

    bumpRound(io, {
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      matchId: matchData.matchId,
      reason: 'addRosterPlayers',
      scope: 'round',
    });

    return res.json({ message: 'Players added successfully', team });
  } catch (error) {
    console.error('Error adding players to MatchData:', error);
    return res.status(500).json({ error: error.message });
  }
};

const removePlayersFromTeamInMatchData = async (req, res) => {
  try {
    const { matchDataId, teamId } = req.params;
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { playerIds } = req.body;

    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({ error: 'playerIds must be a non-empty array' });
    }
    if (!mongoose.Types.ObjectId.isValid(matchDataId) || !mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ error: 'Invalid ObjectId format for matchDataId or teamId' });
    }
    const invalidPlayer = playerIds.find(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidPlayer) {
      return res.status(400).json({ error: `Invalid ObjectId format for playerId: ${invalidPlayer}` });
    }

    const matchData = await MatchData.findOne({ _id: matchDataId, userId: req.session.userId });
    if (!matchData) return res.status(404).json({ error: 'MatchData not found or not yours' });

    const team = matchData.teams.find(t => matchesTeamId(t, teamId));
    if (!team) return res.status(404).json({ error: 'Team not found in this MatchData' });

    team.players = team.players.filter(p => !playerIds.includes(p._id.toString()));

    matchData.markModified('teams');
    await matchData.save();

    const match = await Match.findById(matchData.matchId).select('tournamentId roundId').lean();

    const io = getSocket();
    console.log(`[socket] matchDataUpdated -> user:${req.session.userId} team=${teamId} removed`);
    io.to(`user:${req.session.userId}`).emit('matchDataUpdated', { matchDataId, teamId, changes: { players: team.players } });

    if (match) {
      bumpRound(io, {
        tournamentId: match.tournamentId,
        roundId: match.roundId,
        matchId: matchData.matchId,
        reason: 'removeRosterPlayers',
        scope: 'round',
      });
    }

    return res.json({ message: 'Players removed successfully', team });
  } catch (error) {
    console.error('Error removing players from MatchData:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Bulk-copies the auto-detected previous match's roster (in the same round,
// the match with the highest matchNo below this one) into this match, one
// team at a time, matched by their shared Team ref (teamId) since a team's
// MatchData subdocument _id differs per match. Only playerName/uId survive
// the copy — buildFreshPlayer resets every live-stat field, exactly as if
// the player had just been added new. Teams with no counterpart in the
// previous match's roster are left untouched and reported in skippedTeams
// rather than erased.
const copyRosterFromPreviousMatch = async (req, res) => {
  try {
    const { matchDataId } = req.params;
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(matchDataId)) {
      return res.status(400).json({ error: 'Invalid ObjectId format for matchDataId' });
    }

    const matchData = await MatchData.findOne({ _id: matchDataId, userId: req.session.userId });
    if (!matchData) return res.status(404).json({ error: 'MatchData not found or not yours' });

    const currentMatch = await Match.findById(matchData.matchId).lean();
    if (!currentMatch) return res.status(404).json({ error: 'Match not found for this MatchData' });

    const previousMatch = await Match.findOne({
      tournamentId: currentMatch.tournamentId,
      roundId: currentMatch.roundId,
      userId: req.session.userId,
      matchNo: { $lt: currentMatch.matchNo },
    }).sort({ matchNo: -1, _id: -1 }).lean();
    if (!previousMatch) {
      return res.status(404).json({ error: 'No previous match found in this round', reason: 'no_previous_match' });
    }

    const previousMatchData = await MatchData.findOne({ matchId: previousMatch._id, userId: req.session.userId }).lean();
    if (!previousMatchData) {
      return res.status(404).json({ error: 'Previous match has no roster data yet', reason: 'no_previous_matchdata' });
    }

    const updatedTeams = [];
    const skippedTeams = [];

    for (const team of matchData.teams) {
      const prevTeam = (previousMatchData.teams || []).find(pt => matchesTeamId(pt, String(team.teamId)));
      if (!prevTeam) {
        skippedTeams.push({ teamId: team.teamId, teamName: team.teamName });
        continue;
      }

      // _id is stripped before buildFreshPlayer: its default passthrough
      // (`_id: sourcePlayer._id`) is correct for its other callers (stable
      // Team-roster player ids) but here the source _id belongs to a
      // DIFFERENT match's MatchData subdocument and must never be reused —
      // omitting it lets Mongoose assign a fresh id.
      team.players = (prevTeam.players || [])
        .slice(0, 4)
        .map(({ _id, ...rest }) => buildFreshPlayer(rest, team.slot, team.teamName));

      updatedTeams.push({ teamId: team.teamId, teamName: team.teamName, players: team.players });
    }

    if (updatedTeams.length > 0) {
      matchData.markModified('teams');
      await matchData.save();

      const io = getSocket();
      for (const ut of updatedTeams) {
        console.log(`[socket] matchDataUpdated -> user:${req.session.userId} team=${ut.teamId} roster-copied`);
        io.to(`user:${req.session.userId}`).emit('matchDataUpdated', {
          matchDataId,
          teamId: ut.teamId,
          changes: { players: ut.players },
        });
      }
      bumpRound(io, {
        tournamentId: currentMatch.tournamentId,
        roundId: currentMatch.roundId,
        matchId: currentMatch._id,
        reason: 'copyPreviousRoster',
        scope: 'round',
      });
    }

    return res.json({
      message: 'Roster copied from previous match',
      matchDataId,
      previousMatchId: previousMatch._id,
      previousMatchNo: previousMatch.matchNo,
      updatedTeams,
      skippedTeams,
    });
  } catch (error) {
    console.error('Error copying roster from previous match:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Surfaces which live players in this match currently have no roster match
// (see markUnmatched/getUnmatchedPlayers in pubgApiMatchData.controller.js)
// so an operator can fix a bad UID instead of it silently never working —
// backs the panel in matchDataController.tsx.
//
// Required lazily, inside the handler, rather than at module load time:
// pubgApiMatchData.controller.js requires Bulkpublic.controller.js, which in
// turn requires createMatchDataForMatchDoc from THIS file — a top-level
// require here would close that into a circular require and risk this file's
// own exports being partially undefined wherever the cycle resolves first.
// By request time every module has already finished loading, so this always
// resolves to the fully-populated export.
const getUnmatchedPlayersForMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const { getUnmatchedPlayers } = require('./Api_controllers/pubgApiMatchData.controller');
    res.json(getUnmatchedPlayers(matchId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createMatchDataForMatchDoc,
  syncMatchDataTeamsForGroup,
  syncMatchDataTeamsForMatch,
  isMatchLocked,
  matchHasResults,
  RESULTS_PROJECTION,
  getMatchDataByMatchId,
  updateTeamPoints,
  deleteMatchDataById,

  updatePlayerStats,
  updatePlayerByIdInMatchData,
  addPlayersToTeamInMatchData,
  removePlayersFromTeamInMatchData,
  copyRosterFromPreviousMatch,
  updateTeamPlayersBulkStats,
  getUnmatchedPlayersForMatch,
};
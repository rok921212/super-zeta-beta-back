const Match = require('../models/match.model');
const Round = require('../models/round.model');
const Tournament = require('../models/tournament.model');
const MatchData = require('../models/matchData.model');
const MatchSelection = require('../models/MatchSelection.model.js');
const User = require('../models/User.model.js');

const mongoose = require('mongoose');

const {
  createMatchDataForMatchDoc,
  syncMatchDataTeamsForMatch,
  isMatchLocked,
  matchHasResults,
  RESULTS_PROJECTION,
} = require('./matchData.controller.js');
const { getSocket } = require('../socket.js');
const { notifyRoundStructureChanged } = require('../utils/roundStructure.js');
const { saveLiveMatchSnapshot } = require('./Api_controllers/pubgApiMatchData.controller.js');
const { bumpRound } = require('../utils/publicRevision.js');

// Convert time to 12-hour
function convertTo12Hour(time24) {
  if (!time24) return time24;
  const [hourStr, minute] = time24.split(':');
  let hour = parseInt(hourStr, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour.toString().padStart(2, '0')}:${minute} ${ampm}`;
}

// Fetch match with groups populated. Used to embed the full MatchData
// document (every team/player stat field) here too, but no consumer
// (front or desktop-app dashboards, or the matchUpdated/matchCreated/
// matchDeleted socket broadcasts built from this) ever reads that field —
// confirmed via full grep of both frontends. For a round with several
// matches this was multiplying one match's full-roster payload (tens of
// KB) by every match in the list for zero benefit (~1.67MB observed for
// one round). Dropped entirely; matchData for a specific match/round is
// what /api/public/bulk and matchDataController.tsx already fetch
// separately when actually needed.
async function fetchMatchWithData(match) {
  const populatedMatch = await match.populate({
    path: 'groups',
    populate: { path: 'slots.team', model: 'Team' },
  });
  const obj = populatedMatch.toObject();
  // autoLocked: the match has results, so group edits no longer reach it
  // (see isMatchLocked). Lean projection — just enough to decide.
  const md = await MatchData.findOne({ matchId: populatedMatch._id })
    .select(RESULTS_PROJECTION).lean();
  obj.autoLocked = isMatchLocked(populatedMatch, md);
  return obj;
}

// ✅ Create match (user-based)
const createMatchInRoundInTournament = async (req, res) => {
  try {
    const { tournamentId, roundId } = req.params;
    const round = await Round.findOne({ _id: roundId, createdBy: req.session.userId });
    if (!round) return res.status(404).json({ message: 'Round not found or not yours' });

    // Per-user match quota. Full admins are always unlimited; maxMatches 0/unset
    // = unlimited. Soft cap: two truly-concurrent creates could both pass the
    // count — acceptable for a "you've reached the limit" prompt (a hard cap
    // would need a counter doc / transaction like round.model's apiEnable index).
    const owner = await User.findById(req.session.userId).select('isAdmin maxMatches').maxTimeMS(5000);
    if (owner && !owner.isAdmin && owner.maxMatches > 0) {
      const used = await Match.countDocuments({ userId: req.session.userId }).maxTimeMS(5000);
      if (used >= owner.maxMatches) {
        return res.status(403).json({
          error: `You have reached the maximum match limit (${owner.maxMatches}).`,
          code: 'MATCH_LIMIT',
          used,
          max: owner.maxMatches,
        });
      }
    }

    let time = req.body.time ? convertTo12Hour(req.body.time) : undefined;

    const groupIds = req.body.groupIds?.length > 0
      ? req.body.groupIds
      : round.groups.map(g => g._id);

    const match = new Match({
      ...req.body,
      time,
      tournamentId,
      roundId,
      groups: groupIds,
      userId: req.session.userId, // ✅ assign owner
    });

    const savedMatch = await match.save();
    const createdMatchData = await createMatchDataForMatchDoc(savedMatch);

    const payload = { match: savedMatch, matchData: createdMatchData };
    getSocket().to(`user:${req.session.userId}`).emit('matchCreated', payload);
    notifyRoundStructureChanged(tournamentId, roundId);

    res.status(201).json(payload);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ✅ Get match by ID
const getMatchById = async (req, res) => {
  try {
    const match = await Match.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!match) return res.status(404).json({ error: 'Match not found or not yours' });

    const matchWithData = await fetchMatchWithData(match);
    res.json(matchWithData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Get matches by round ID
const getMatchesByRoundId = async (req, res) => {
  try {
    const matches = await Match.find({ roundId: req.params.roundId, userId: req.session.userId });
    const matchesWithData = await Promise.all(matches.map(fetchMatchWithData));
    res.json(matchesWithData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Get matches by tournament ID
const getMatchesByTournamentId = async (req, res) => {
  try {
    const matches = await Match.find({ tournamentId: req.params.tournamentId, userId: req.session.userId });
    const matchesWithData = await Promise.all(matches.map(fetchMatchWithData));
    res.json(matchesWithData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Get matches by tournament & round
const getMatchesByTournamentAndRound = async (req, res) => {
  try {
    const matches = await Match.find({
      tournamentId: req.params.tournamentId,
      roundId: req.params.roundId,
      userId: req.session.userId,
    });
    const matchesWithData = await Promise.all(matches.map(fetchMatchWithData));
    res.json(matchesWithData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Update match
const updateMatch = async (req, res) => {
  try {
    const { tournamentId, roundId, id } = req.params;
    const match = await Match.findOne({ _id: id, tournamentId, roundId, userId: req.session.userId });
    if (!match) return res.status(404).json({ error: 'Match not found or not yours' });

    if (req.body.time !== undefined) {
      match.time = convertTo12Hour(req.body.time);
      delete req.body.time;
    }

    // The dashboard sends `groupIds`, not the schema's `groups` — map it, or
    // a match's group edit is silently dropped by Object.assign.
    let groupsChanged = false;
    if (Array.isArray(req.body.groupIds) && req.body.groupIds.length > 0) {
      const prev = (match.groups || []).map(String).sort().join(',');
      const next = req.body.groupIds.map(String).sort().join(',');
      groupsChanged = prev !== next;
      if (groupsChanged) {
        const md = await MatchData.findOne({ matchId: match._id })
          .select(RESULTS_PROJECTION).lean();
        if (isMatchLocked(match, md)) {
          return res.status(409).json({ error: 'Match is locked — it already has data, so its groups cannot change' });
        }
      }
      match.groups = req.body.groupIds;
    }
    delete req.body.groupIds;

    Object.assign(match, req.body);
    const updatedMatch = await match.save();
    if (groupsChanged) await syncMatchDataTeamsForMatch(updatedMatch._id, { reason: 'matchGroupsChanged' });
    const updatedMatchWithData = await fetchMatchWithData(updatedMatch);

    getSocket().to(`user:${req.session.userId}`).emit('matchUpdated', updatedMatchWithData);
    notifyRoundStructureChanged(tournamentId, roundId);
    res.json(updatedMatchWithData);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ✅ Delete match
const deleteMatch = async (req, res) => {
  try {
    const { roundId, tournamentId, id } = req.params;
    const match = await Match.findOneAndDelete({ _id: id, tournamentId, roundId, userId: req.session.userId });
    if (!match) return res.status(404).json({ error: 'Match not found or not yours' });

    await MatchData.deleteMany({ matchId: match._id });
    const deletedSelections = await MatchSelection.deleteMany({ matchId: match._id });

    getSocket().to(`user:${req.session.userId}`).emit('matchDeleted', { matchId: match._id });
    notifyRoundStructureChanged(tournamentId, roundId);

    res.json({
      message: 'Match, related MatchData, and MatchSelections deleted successfully',
      deletedSelectionsCount: deletedSelections.deletedCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Repair: re-add any group team missing from each match's MatchData in a
// round (and collapse duplicate teamIds), without changing any groups.
const resyncRoundMatchTeams = async (req, res) => {
  try {
    const { tournamentId, roundId } = req.params;
    const matches = await Match.find({ tournamentId, roundId, userId: req.session.userId })
      .select('_id matchNo').lean();
    if (!matches.length) return res.status(404).json({ error: 'No matches found for this round' });

    const results = [];
    for (const m of matches) {
      // Explicit repair: runs on locked matches too (force), but never moves
      // an existing team's slot there.
      const r = await syncMatchDataTeamsForMatch(m._id, { reason: 'resyncTeams', force: true });
      results.push({ matchId: m._id, matchNo: m.matchNo, ...r });
    }
    notifyRoundStructureChanged(tournamentId, roundId);
    res.json({ message: 'Match teams resynced', results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Update all matches in a round (user-based)
const updateAllMatchesWithRoundGroups = async (req, res) => {
  try {
    const { roundId } = req.params;
    const round = await Round.findOne({ _id: roundId, createdBy: req.session.userId }).populate('groups');
    if (!round) return res.status(404).json({ message: 'Round not found or not yours' });

    // Locked matches (manual lock or has results) keep their groups.
    const roundMatches = await Match.find({ roundId: round._id, userId: req.session.userId })
      .select('_id').lean();
    const matchDatas = await MatchData.find({ matchId: { $in: roundMatches.map(m => m._id) } })
      .select(RESULTS_PROJECTION).lean();
    const mdByMatch = new Map(matchDatas.map(md => [String(md.matchId), md]));
    const unlocked = roundMatches.filter(m => !isMatchLocked(m, mdByMatch.get(String(m._id))));
    const skippedLocked = roundMatches.length - unlocked.length;

    const result = await Match.updateMany(
      { _id: { $in: unlocked.map(m => m._id) } },
      { $set: { groups: round.groups.map(g => g._id) } }
    );

    // Match.groups changed -> bring each match's MatchData teams in line.
    for (const m of unlocked) {
      await syncMatchDataTeamsForMatch(m._id, { reason: 'roundGroupsChanged' });
    }

    getSocket().to(`user:${req.session.userId}`).emit('roundGroupsUpdated', {
      roundId: round._id,
      modifiedCount: result.modifiedCount,
    });
    notifyRoundStructureChanged(round.tournamentId, round._id);

    res.status(200).json({
      message: 'All matches updated with round groups',
      modifiedCount: result.modifiedCount,
      skippedLocked,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error updating matches', error: err.message });
  }
};

// ✅ Manual "SAVE DATA" — snapshot the current in-memory live match state to
// MongoDB, on operator demand. NOT a finalization: the socket, relay, PCOB
// ingestion, live emissions and polling all keep running unchanged. This is an
// idempotent overwrite of the one MatchData doc (no history docs).
//
// Body: { tournamentId, roundId, matchId? }. When matchId is omitted the
// current match is resolved from the round's isSelected MatchSelection (the
// same identifier system joinRoundRoom / getSelectedMatch already use).
const saveCurrentMatchData = async (req, res) => {
  try {
    const userId = req.session.userId;
    let { tournamentId, roundId, matchId } = req.body || {};

    if (matchId) {
      if (!mongoose.Types.ObjectId.isValid(matchId)) {
        return res.status(400).json({ success: false, message: 'Invalid matchId' });
      }
      // Explicit matchId must still belong to this operator.
      const owned = await Match.findOne({ _id: matchId, userId })
        .select('_id tournamentId roundId')
        .lean();
      if (!owned) {
        return res.status(404).json({ success: false, message: 'Match not found or not yours' });
      }
      tournamentId = tournamentId || String(owned.tournamentId);
      roundId = roundId || String(owned.roundId);
    } else {
      if (!tournamentId || !roundId) {
        return res.status(400).json({ success: false, message: 'tournamentId and roundId (or matchId) required' });
      }
      const selection = await MatchSelection.findOne({ tournamentId, roundId, userId, isSelected: true }).lean();
      if (!selection) {
        // Not an error — the schedule / match-data pages can be open with no
        // match selected for this round yet.
        return res.status(200).json({ success: true, saved: false, reason: 'no-selected-match' });
      }
      matchId = String(selection.matchId);
    }

    const result = await saveLiveMatchSnapshot({ matchId, userId });

    if (!result.saved) {
      return res.status(200).json({ success: true, saved: false, reason: result.reason });
    }

    // Bump the round's authoritative publicRev — this busts the backend public
    // round cache (/api/public/bulk + /overall) AND emits `publicDataInvalidated`
    // so co-located OBS overlays refetch immediately instead of waiting for a
    // TTL. The automatic 3s writer never did this; with it off, this is the only
    // thing keeping result screens fresh after a manual save.
    if (tournamentId && roundId) {
      try {
        await bumpRound(getSocket(), { tournamentId, roundId, matchId, reason: 'saveCurrent', scope: 'round' });
      } catch (e) {
        console.warn('[saveCurrentMatchData] publicRev bump failed:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      saved: true,
      matchId: result.matchId,
      savedAt: result.savedAt,
    });
  } catch (err) {
    console.error('[saveCurrentMatchData]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// How many matches the caller has created vs. their cap. Drives the
// "maximum match limit" banner in the dashboard Navbar and the disabled
// "Add Match" button, so the UI can warn BEFORE a create is attempted.
const getMatchUsage = async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('isAdmin maxMatches').maxTimeMS(5000);
    if (!user) return res.status(401).json({ message: 'Not logged in' });

    const unlimited = !!user.isAdmin || !user.maxMatches || user.maxMatches <= 0;
    const used = await Match.countDocuments({ userId: req.session.userId }).maxTimeMS(5000);

    return res.json({
      used,
      max: unlimited ? null : user.maxMatches,
      unlimited,
      limitReached: !unlimited && used >= user.maxMatches,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  createMatchInRoundInTournament,
  getMatchById,
  getMatchesByRoundId,
  getMatchesByTournamentId,
  getMatchesByTournamentAndRound,
  updateMatch,
  deleteMatch,
  updateAllMatchesWithRoundGroups,
  resyncRoundMatchTeams,
  saveCurrentMatchData,
  getMatchUsage,
};

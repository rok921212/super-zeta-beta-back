const mongoose = require('mongoose');
const Tournament = require('../models/tournament.model.js');
const Round = require('../models/round.model');
const Team = require('../models/teams.model');
const Match = require('../models/match.model');
const MatchData = require('../models/matchData.model');
const Group = require('../models/group.model');
const MatchSelection = require('../models/MatchSelection.model');
const { getSocket } = require('../socket.js');
const { bumpTournament } = require('../utils/publicRevision.js');

// --- CREATE TOURNAMENT ---
const createTournament = async (req, res) => {
  try {
    const tournament = new Tournament({
      ...req.body,
      userId: req.session.userId, // assign current user as owner
    });
    const savedTournament = await tournament.save();
    res.status(201).json(savedTournament);
  } catch (err) {
    console.error('createTournament error:', err);
    res.status(400).json({ error: err.message });
  }
};

// --- GET ALL TOURNAMENTS (current user only) ---
// Two shapes, by query:
//  - no query params  -> the full array, as always (desktop app, Designer
//    inspector, admin panel).
//  - search/limit/page/ids -> { tournaments, total, page, pages }, newest
//    first, same contract as getAllTeams. The website dashboard and Display
//    HUD load the latest 20 this way and search for anything older, instead
//    of pulling the user's whole history on every visit.
//    `ids` (comma list) fetches specific tournaments regardless of age — the
//    HUD uses it to name a selected/API-live tournament outside the latest 20.
const TOURNAMENT_LIST_DEFAULT_LIMIT = 20;
const TOURNAMENT_LIST_MAX_LIMIT = 100;
const TOURNAMENT_LIST_MAX_IDS = 50;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getTournaments = async (req, res) => {
  try {
    const { search, limit, page, ids } = req.query;
    const userId = req.session.userId;

    if (search === undefined && limit === undefined && page === undefined && ids === undefined) {
      const tournaments = await Tournament.find({ userId }).lean();
      return res.json(tournaments);
    }

    const filter = { userId };
    const term = typeof search === 'string' ? search.trim() : '';
    if (term) filter.tournamentName = { $regex: escapeRegex(term), $options: 'i' };
    if (typeof ids === 'string') {
      filter._id = {
        $in: ids.split(',')
          .map(id => id.trim())
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .slice(0, TOURNAMENT_LIST_MAX_IDS),
      };
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || TOURNAMENT_LIST_DEFAULT_LIMIT, 1), TOURNAMENT_LIST_MAX_LIMIT);

    // No timestamps on the model — _id order is creation order.
    const [tournaments, total] = await Promise.all([
      Tournament.find(filter).sort({ _id: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Tournament.countDocuments(filter),
    ]);
    res.json({ tournaments, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    console.error('getTournaments error:', err);
    res.status(500).json({ error: err.message });
  }
};

// --- GET TOURNAMENT BY ID (owner check) ---
const getTournamentById = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.session.userId }).lean();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found or unauthorized' });

    const rounds = await Round.find({ tournamentId: tournament._id })
      .populate({
        path: 'groups',
        populate: { path: 'slots.team', model: 'Team' },
      })
      .lean();

    res.json({ ...tournament, rounds });
  } catch (err) {
    console.error('getTournamentById error:', err);
    res.status(500).json({ error: err.message });
  }
};

// --- GET TOURNAMENT BY NAME (owner check) ---
const getTournamentByName = async (req, res) => {
  try {
    const name = req.params.name.trim();
    const tournament = await Tournament.findOne({
      tournamentName: { $regex: `^${name}$`, $options: 'i' },
      userId: req.session.userId,
    });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found or unauthorized' });
    res.json(tournament);
  } catch (err) {
    console.error('getTournamentByName error:', err);
    res.status(500).json({ error: err.message });
  }
};

// --- GET ROUNDS BY TOURNAMENT (owner check) ---
const getRoundsByTournamentId = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.tournamentId, userId: req.session.userId });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found or unauthorized' });

    const rounds = await Round.find({ tournamentId: tournament._id }).lean();
    res.json(rounds);
  } catch (err) {
    console.error('getRoundsByTournamentId error:', err);
    res.status(500).json({ error: err.message });
  }
};

// --- UPDATE TOURNAMENT (owner check) ---
const updateTournament = async (req, res) => {
  try {
    const updatedTournament = await Tournament.findOneAndUpdate(
      { _id: req.params.id, userId: req.session.userId },
      req.body,
      { new: true }
    );
    if (!updatedTournament) return res.status(404).json({ error: 'Tournament not found or unauthorized' });
    res.json(updatedTournament);
    // tournamentName / logo / primaryColor / secondaryColor / overlayBg / day
    // are the theme skin of EVERY overlay for this tournament, and this path
    // emits nothing else — bump every round's publicRev.
    let io = null;
    try { io = getSocket(); } catch { /* socket not ready */ }
    bumpTournament(io, { tournamentId: req.params.id, reason: 'updateTournament' });
  } catch (err) {
    console.error('updateTournament error:', err);
    res.status(400).json({ error: err.message });
  }
};

// --- DELETE TOURNAMENT (owner check) ---
const deleteTournament = async (req, res) => {
  try {
    const tournament = await Tournament.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found or unauthorized' });

    const tournamentId = tournament._id;

    // Announce before the cascade wipes the rooms/clients — bump every round's
    // publicRev so any co-located overlay drops its cache immediately.
    try { bumpTournament(getSocket(), { tournamentId, reason: 'deleteTournament' }); } catch { /* socket not ready */ }

    // Delete related data
    const rounds = await Round.find({ tournamentId }).select('_id');
    const roundIds = rounds.map(r => r._id);
    const matches = await Match.find({ roundId: { $in: roundIds } }).select('_id');
    const matchIds = matches.map(m => m._id);

    await Promise.all([
      Group.deleteMany({ tournamentId }),
      MatchData.deleteMany({ matchId: { $in: matchIds } }),
      Match.deleteMany({ _id: { $in: matchIds } }),
      Round.deleteMany({ _id: { $in: roundIds } }),
      MatchSelection.deleteMany({ tournamentId }),
      Tournament.findByIdAndDelete(tournamentId)
    ]);

    res.json({ message: 'Tournament and all related data deleted successfully' });
  } catch (err) {
    console.error('deleteTournament error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  createTournament,
  getTournaments,
  getTournamentById,
  getTournamentByName,
  updateTournament,
  deleteTournament,
  getRoundsByTournamentId
};

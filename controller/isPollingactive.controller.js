const MatchSelection = require('../models/MatchSelection.model.js');
const Round = require('../models/round.model.js');
const mongoose = require('mongoose');
const { getSocket } = require('../socket.js'); // ✅ updated import
const { markUserActiveForPolling, markUserInactiveForPolling } = require('./Api_controllers/pubgApiMatchData.controller.js');

// GET isPollingActive for a match (user-based)
const getPollingStatus = async (req, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid matchId' });
    }

    const selection = await MatchSelection.findOne({ matchId, userId });
    if (!selection) {
      return res.status(404).json({ message: 'MatchSelection not found' });
    }

    res.status(200).json({ matchId, isPollingActive: selection.isPollingActive });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PATCH update isPollingActive for a specific match, round, and tournament (user-based)
const updatePollingStatus = async (req, res) => {
  try {
    const { matchId, roundId, tournamentId } = req.params;
    const { isPollingActive } = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(matchId) ||
        !mongoose.Types.ObjectId.isValid(roundId) ||
        !mongoose.Types.ObjectId.isValid(tournamentId)) {
      return res.status(400).json({ message: 'Invalid matchId, roundId, or tournamentId' });
    }

    if (typeof isPollingActive !== 'boolean') {
      return res.status(400).json({ message: 'isPollingActive must be a boolean' });
    }

    // Check if the round has API enabled
    const round = await Round.findById(roundId);
    if (!round) {
      return res.status(404).json({ message: 'Round not found' });
    }

    // Allow polling only if API is enabled for the round
    if (!round.apiEnable) {
      return res.status(403).json({ message: 'API is not enabled for this round. Cannot modify polling status.' });
    }

    // Disable polling for all other matches of this user in the same round & tournament.
    // Capture which ones were actually ON first, so we can emit a
    // pollingStatusUpdated for each — otherwise every client keeps showing
    // the just-force-disabled sibling as still LIVE until a refetch.
    let disabledSiblings = [];
    if (isPollingActive) {
      disabledSiblings = await MatchSelection.find(
        { tournamentId, roundId, matchId: { $ne: matchId }, userId, isPollingActive: true }
      ).select('_id matchId roundId tournamentId').lean();

      await MatchSelection.updateMany(
        { tournamentId, roundId, matchId: { $ne: matchId }, userId },
        { $set: { isPollingActive: false } }
      );
    }

    // Update the specific match selection for this user
    const updatedSelection = await MatchSelection.findOneAndUpdate(
      { matchId, roundId, tournamentId, userId },
      { $set: { isPollingActive } },
      { new: true, upsert: true }
    );

    if (!updatedSelection) {
      return res.status(404).json({ message: 'MatchSelection not found' });
    }

    // Register this user as active for the live-ingestion path right away,
    // instead of waiting for the next discoverAndStartPollingUsers() pass —
    // otherwise relay ticks that are already arriving for this user get
    // silently dropped by triggerImmediateUpdateForUser() until that next
    // pass catches up. The periodic sweep is now 60s (bandwidth: fewer Atlas
    // round-trips), so this fast path must be fully correct on its own.
    // Whether ANY of this user's selections is still polling after this
    // change — carried in the broadcast so a match-agnostic consumer (the
    // desktop relay switch / its propless PollingManager mount) knows
    // whether an `isPollingActive:false` for one match means "pause the
    // relay" or "keep going, another match is still live".
    let userStillActive = true;
    if (isPollingActive) {
      markUserActiveForPolling(userId);
    } else {
      // Only deactivate the user if this was their LAST active selection —
      // an operator running two live matches in different rounds who stops
      // one must keep ingesting for the other. (markUserInactiveForPolling
      // is per-user, not per-match, so an unconditional call here would
      // freeze the other overlay until the 60s sweep re-added the user.)
      const stillActive = await MatchSelection.exists({ userId, isPollingActive: true });
      userStillActive = !!stillActive;
      if (!stillActive) markUserInactiveForPolling(userId);
    }

    // --- Emit WebSocket event ---
    // Room must match `user:${key}` joined in registerRelay
    // (pubgApiMatchData.controller.js) — a bare userId room has no members.
    // `ts` is a monotonic-enough server stamp shared by every event this
    // request emits; clients apply last-write-wins on it so a slow/reordered
    // broadcast can't clobber newer state. Sibling-off events go out FIRST
    // and the real target LAST, so the last message the room sees is the
    // authoritative target state.
    const io = getSocket();
    const room = `user:${userId}`;
    const ts = Date.now();

    disabledSiblings.forEach((s) => {
      io.to(room).emit('pollingStatusUpdated', {
        _id: s._id,
        matchId: s.matchId,
        roundId: s.roundId,
        tournamentId: s.tournamentId,
        isPollingActive: false,
        userStillActive: true, // the target of this request is turning ON
        ts
      });
    });

    console.log(`[socket] pollingStatusUpdated -> ${room} match=${matchId} (siblings off: ${disabledSiblings.length})`);
    io.to(room).emit('pollingStatusUpdated', {
      _id: updatedSelection._id,
      matchId,
      roundId,
      tournamentId,
      isPollingActive: updatedSelection.isPollingActive,
      userStillActive,
      ts
    });

    res.status(200).json({
      message: 'Polling status updated',
      tournamentId,
      roundId,
      matchId,
      isPollingActive: updatedSelection.isPollingActive,
      userStillActive,
      ts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PATCH stop polling for every one of the current user's active selections
// in a single DB call — used by stopAllPolling() on logout instead of one
// PATCH per selection. Deliberately does NOT check round.apiEnable: turning
// everything off must always succeed regardless of any round's state,
// otherwise a selection whose round later gets apiEnable disabled can never
// be cleared (see updatePollingStatus's gate above).
const stopAllPolling = async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const active = await MatchSelection.find({ userId, isPollingActive: true });

    if (active.length > 0) {
      await MatchSelection.updateMany(
        { userId, isPollingActive: true },
        { $set: { isPollingActive: false } }
      );

      const io = getSocket();
      const room = `user:${userId}`;
      const ts = Date.now();
      active.forEach((s) => {
        io.to(room).emit('pollingStatusUpdated', {
          _id: s._id,
          matchId: s.matchId,
          roundId: s.roundId,
          tournamentId: s.tournamentId,
          isPollingActive: false,
          userStillActive: false, // everything is being turned off
          ts
        });
      });
    }

    markUserInactiveForPolling(userId);

    res.status(200).json({ message: 'Polling stopped for all selections', stopped: active.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getPollingStatus,
  updatePollingStatus,
  stopAllPolling
};
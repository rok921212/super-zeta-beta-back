const Round = require('../models/round.model.js');
const { getSocket } = require('../socket'); // Socket.IO singleton

// Get the currently-set overlay view/theme for a round (used by the
// authenticated dashboard; the anonymous public read used by the OBS
// overlay itself lives inline in index.js's public routes block). Stored
// directly on the Round document — see round.model.js's overlayView/
// overlayTheme fields — rather than a separate collection, since this
// Atlas cluster's shared tier is capped at 500 collections.
const getOverlayControl = async (req, res) => {
  try {
    const { tournamentId, roundId } = req.params;

    if (!tournamentId || !roundId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const round = await Round.findOne({ _id: roundId, tournamentId }).lean();

    if (!round || (!round.overlayView && !round.overlayTheme)) {
      return res.status(404).json({ message: 'No overlay control set for this round' });
    }

    res.status(200).json({ view: round.overlayView, theme: round.overlayTheme, updatedAt: round.updatedAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Set the current view/theme for a round and broadcast it to every public
// overlay socket currently joined to that round (see joinRoundRoom's new
// unconditional `round:${tournamentId}:${roundId}:control` join).
const setOverlayControl = async (req, res) => {
  try {
    const { tournamentId, roundId, view, theme } = req.body;

    if (!tournamentId || !roundId || !view || !theme) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const round = await Round.findOneAndUpdate(
      { _id: roundId, tournamentId },
      { $set: { overlayView: view, overlayTheme: theme } },
      { new: true }
    );

    if (!round) {
      return res.status(404).json({ message: 'Round not found' });
    }

    const io = getSocket();
    const room = `round:${tournamentId}:${roundId}:control`;
    console.log(`[socket] overlayViewChanged -> ${room} view=${view} theme=${theme}`);
    io.to(room).emit('overlayViewChanged', { tournamentId, roundId, view, theme });

    res.status(200).json({ message: 'Overlay control updated', view: round.overlayView, theme: round.overlayTheme, updatedAt: round.updatedAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getOverlayControl,
  setOverlayControl
};

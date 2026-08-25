const mongoose = require('mongoose');

const roundSchema = new mongoose.Schema({
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  roundName: { type: String, required: true },
  apiEnable: { type: Boolean, default: false },
  day: { type: String },
  groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
  selectedMatch: {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match' },
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Live-switch overlay state (see OverlayControl.controller.js) — kept on
  // Round rather than a separate collection since the relationship is
  // already 1:1 per round, and the Atlas shared-tier cluster this app runs
  // on is capped at 500 collections.
  overlayView: { type: String, default: null },
  overlayTheme: { type: String, default: null },
}, { timestamps: true });

// Hard DB-level guarantee: a user can never have more than one round
// with apiEnable: true at the same time, no matter what the app code does.
roundSchema.index(
  { createdBy: 1, apiEnable: 1 },
  { unique: true, partialFilterExpression: { apiEnable: true } }
);

module.exports = mongoose.model('Round', roundSchema);
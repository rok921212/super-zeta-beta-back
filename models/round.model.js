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
  // Authoritative, durable, monotonically-increasing revision of everything this
  // round's public overlays consume. Bumped ($inc, never reset) after ANY
  // successful mutation that can change a /api/public/bulk response for the
  // round — see utils/publicRevision.js. Survives a server restart, which is
  // what keeps the local overlay relay's cache correct across a redeploy.
  publicRev: { type: Number, default: 0 },
}, { timestamps: true });

// Hard DB-level guarantee: a user can never have more than one round
// with apiEnable: true at the same time, no matter what the app code does.
roundSchema.index(
  { createdBy: 1, apiEnable: 1 },
  { unique: true, partialFilterExpression: { apiEnable: true } }
);

module.exports = mongoose.model('Round', roundSchema);
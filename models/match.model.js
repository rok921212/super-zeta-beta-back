const mongoose = require('mongoose');
const { Schema } = mongoose;

const matchSchema = new mongoose.Schema({
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  roundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Round', required: true },
  matchNo: { type: Number, required: true },
  time: { type: String, required: true },
  map: { type: String, required: true },
  groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
   userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // ✅ new
  // Smash Point: a value the operator types for this match, shown as a bar in
  // LiveStats and LiveData while `enabled` and `value` is not blank
  // (front/src/Themes/shared/components/SmashPointBar.tsx). Display only:
  // no scoring rule is applied to it. `displayText` replaces the
  // "SMASH POINT" label when set.
  smashPoint: {
    type: new Schema({
      enabled: { type: Boolean, default: false },
      value: { type: String, default: '', maxlength: 40 },
      displayText: { type: String, default: '', maxlength: 24 },
    }, { _id: false }),
    default: undefined,
  },
});

// Every live-tick payload build (Bulkpublic.controller.js, overall.controller.js)
// filters Match.find({tournamentId, roundId}) — was running unindexed.
matchSchema.index({ tournamentId: 1, roundId: 1 });

// Per-user match-count queries: the maxMatches limit check and the admin
// overview aggregation both filter/group on userId.
matchSchema.index({ userId: 1 });

module.exports = mongoose.models.Match || mongoose.model('Match', matchSchema);

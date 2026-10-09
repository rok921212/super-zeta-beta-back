const mongoose = require('mongoose');
const Schema = mongoose.Schema; // ✅ add this

const tournamentSchema = new mongoose.Schema({
  tournamentName: { type: String, required: true },
  torLogo: { type: String },
  day: { type: String },
  primaryColor: { type: String },
  secondaryColor: { type: String },
  overlayBg: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // Assuming userId is required

});

// The per-user list, newest first (getTournaments).
tournamentSchema.index({ userId: 1, _id: -1 });

module.exports = mongoose.model('Tournament', tournamentSchema);

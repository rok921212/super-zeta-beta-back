const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  // "Sub-Admin" is purely a label + a home for a per-user match quota. It
  // grants NO extra access (not the admin panel, not cross-account data) —
  // a sub-admin is an ordinary dashboard user whose match creation is capped.
  isSubAdmin: { type: Boolean, default: false },
  // Max matches this account may create. 0 (or unset) = unlimited. Ignored
  // entirely for full admins (isAdmin), who are always unlimited. Enforced in
  // controller/match.controller.js#createMatchInRoundInTournament.
  maxMatches: { type: Number, default: 0, min: 0 },
  // Set on every successful loginUser (atomic $set, never via save()).
  lastLoginAt: { type: Date },
  loginCount: { type: Number, default: 0 },
  // Opaque token the desktop relay presents to prove which user it belongs
  // to over the socket connection (which carries no session cookie).
  // select: false keeps it out of normal find()/findById() results so it
  // never leaks through getAllUsers or any other user's response.
  relayToken: { type: String, unique: true, sparse: true, select: false },
  // SYNC OVERLAY (controller/overlaySync.controller.js): while tournamentId +
  // roundId are set, every public overlay link of this account renders THAT
  // round instead of the one in its own URL. `stamp` (ms) outlives a stop, so
  // an overlay can tell a newer "off" from an older "on". select: false keeps
  // it out of ordinary user reads.
  overlaySync: {
    type: new mongoose.Schema({
      tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', default: null },
      roundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Round', default: null },
      scheduleMatches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Match' }],
      stamp: { type: Number, default: 0 },
    }, { _id: false }),
    select: false,
  },
  // Permanent overlay links: the public id in /public/live/<overlayKey> and
  // /o/<publicId>?k=<overlayKey>. Those links name no tournament or round and
  // render whatever `overlaySync` points at. Created the first time permanent
  // links are switched on and never changed, so the links in OBS stay valid.
  overlayKey: { type: String, unique: true, sparse: true, select: false },
}, { timestamps: true });

// Hash password before saving.
// NOTE: this used to check this.isModified('pasword') (typo'd field name),
// which never matches a real path, so it was always false and this hook
// NEVER hashed anything — every password was saved to Mongo in plaintext.
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password.
// Also transparently upgrades any pre-existing plaintext row (saved under
// the bug above) to a real bcrypt hash on the next successful login,
// instead of requiring a separate migration/password reset.
userSchema.methods.matchPassword = async function(password) {
  const stored = this.password || '';
  const isBcryptHash = /^\$2[aby]\$/.test(stored);

  if (!isBcryptHash) {
    if (password !== stored) return false;
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(password, salt);
    await this.save();
    return true;
  }

  return await bcrypt.compare(password, stored);
};

module.exports = mongoose.model('User', userSchema);

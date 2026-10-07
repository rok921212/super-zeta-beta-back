const mongoose = require('mongoose');

// A Designer overlay layout (ScoreSync Graphics Engine).
//
// `draft` is the only thing the editor's autosave writes (optimistic
// concurrency on draftRev). Publishing copies a validated draft into an
// immutable OverlayLayoutRevision and bumps publishedRev; the public OBS
// runtime (/o/:publicId) only ever reads that revision — an autosave can never
// change what is live on stream.
//
// The document shape inside draft/revisions is defined + validated by
// utils/layoutSchema.generated.cjs (source: front/src/graphics/schema).
const overlayLayoutSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Reserved for organization/team collaboration — layouts stay owner-scoped until then.
  organizationId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: { type: String, required: true, maxlength: 120 },
  // Unguessable id used in the public runtime URL (never the Mongo _id).
  publicId: { type: String, required: true, unique: true },
  schemaVersion: { type: Number, required: true, default: 1 },
  draft: { type: mongoose.Schema.Types.Mixed, required: true },
  draftRev: { type: Number, required: true, default: 1 },
  publishedRev: { type: Number, required: true, default: 0 },
  publishedRevisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'OverlayLayoutRevision', default: null },
  publishedAt: { type: Date, default: null },
  productionLocked: { type: Boolean, default: false },
  defaults: {
    tournamentId: { type: String, default: null },
    roundId: { type: String, default: null },
    matchMode: { type: String, default: 'selectedMatch' },
  },
  // Resolves root-relative assets (/def_logo.avif) when the page is hosted elsewhere.
  assetBase: { type: String, default: '' },
}, { timestamps: true, minimize: false });

// Bound per connection: overlays live on their own cluster (db/overlayConnection.js).
const modelFor = (conn = mongoose.connection) => conn.models.OverlayLayout || conn.model('OverlayLayout', overlayLayoutSchema);

module.exports = { schema: overlayLayoutSchema, modelFor };

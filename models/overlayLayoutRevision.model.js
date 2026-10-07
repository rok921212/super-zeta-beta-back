const mongoose = require('mongoose');

// An immutable published snapshot of an OverlayLayout's draft. Never updated
// after insert — a new publish is a new revision. The (layoutId, rev) unique
// index is what makes two concurrent publishes of the same layout safe: the
// loser gets a duplicate-key error and answers 409.
const overlayLayoutRevisionSchema = new mongoose.Schema({
  layoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'OverlayLayout', required: true },
  rev: { type: Number, required: true },
  schemaVersion: { type: Number, required: true },
  document: { type: mongoose.Schema.Types.Mixed, required: true },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The owner's uploaded fonts at publish time, so the public runtime can
  // register them (bytes: GET /api/overlay-fonts/file/:id).
  fonts: { type: [{ _id: false, id: { type: String, required: true }, family: { type: String, required: true } }], default: [] },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

overlayLayoutRevisionSchema.index({ layoutId: 1, rev: 1 }, { unique: true });

// Bound per connection: overlays live on their own cluster (db/overlayConnection.js).
const modelFor = (conn = mongoose.connection) => conn.models.OverlayLayoutRevision || conn.model('OverlayLayoutRevision', overlayLayoutRevisionSchema);

module.exports = { schema: overlayLayoutRevisionSchema, modelFor };

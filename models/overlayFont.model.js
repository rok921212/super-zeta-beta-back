const mongoose = require('mongoose');

// A .woff2 font a user uploaded for the Designer. One library per account:
// every layout of that owner can use it, and a publish snapshots the list
// ({ id, family }) onto the revision so the public runtime knows what to load.
// The bytes live in the document — fonts are capped at 2 MB, far under the
// 16 MB document limit, and are served by GET /api/overlay-fonts/file/:id.
const overlayFontSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  family: { type: String, required: true, maxlength: 40 },
  // Lowercased family: "My Font" and "my font" are the same name to a browser.
  familyKey: { type: String, required: true, maxlength: 40 },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true },
}, { timestamps: true });

overlayFontSchema.index({ ownerId: 1, familyKey: 1 }, { unique: true });

// Bound per connection: overlays live on their own cluster (db/overlayConnection.js).
const modelFor = (conn = mongoose.connection) => conn.models.OverlayFont || conn.model('OverlayFont', overlayFontSchema);

module.exports = { schema: overlayFontSchema, modelFor };

const mongoose = require('mongoose');

// An image a user uploaded for the Designer (PNG / JPEG / WebP / SVG). One
// library per account. A layout refers to it as `asset:<_id>`, never by URL and
// never as base64 inside the document. The bytes live here (capped at 4 MB, far
// under the 16 MB document limit) and are served by
// GET /api/overlay-assets/file/:id. `thumb` is a small preview the browser made.
const overlayAssetSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, maxlength: 120 },
  mime: { type: String, required: true },
  size: { type: Number, required: true },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  // sha256 of the bytes: the same file uploaded twice is one asset.
  hash: { type: String, required: true },
  data: { type: Buffer, required: true },
  thumb: { type: Buffer, default: null },
  thumbMime: { type: String, default: null },
}, { timestamps: true });

overlayAssetSchema.index({ ownerId: 1, hash: 1 }, { unique: true });

// Bound per connection: overlays live on their own cluster (db/overlayConnection.js).
const modelFor = (conn = mongoose.connection) => conn.models.OverlayAsset || conn.model('OverlayAsset', overlayAssetSchema);

module.exports = { schema: overlayAssetSchema, modelFor };

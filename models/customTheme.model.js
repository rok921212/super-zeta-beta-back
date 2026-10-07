const mongoose = require('mongoose');

// A user's custom overlay theme (Theme9, Theme10, …) built from Designer
// layouts: each slot maps one overlay view (Lower, Alerts, LiveStats, …) to a
// layout. DisplayHud lists these after the built-in Theme1-8 and opens the
// slot's published layout at /o/:publicId.
const customThemeSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  number: { type: Number, required: true, min: 9 },
  name: { type: String, required: true, maxlength: 60 },
  slots: [{
    _id: false,
    viewKey: { type: String, required: true },
    layoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'OverlayLayout', required: true },
  }],
}, { timestamps: true });

customThemeSchema.index({ ownerId: 1, number: 1 }, { unique: true });

// Bound per connection: overlays live on their own cluster (db/overlayConnection.js).
const modelFor = (conn = mongoose.connection) => conn.models.CustomTheme || conn.model('CustomTheme', customThemeSchema);

module.exports = { schema: customThemeSchema, modelFor };

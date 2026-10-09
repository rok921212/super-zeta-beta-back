const mongoose = require('mongoose');

// A design category the account made itself (the built-in ones are constants:
// DESIGN_CATEGORIES in utils/layoutSchema.generated.cjs). A category is only a
// label on a design (`OverlayLayout.categoryId`): deleting one never deletes
// designs, they become uncategorised.
const overlayCategorySchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, maxlength: 40 },
  // Lowercased name: "Finals" and "finals" are the same category.
  nameKey: { type: String, required: true, maxlength: 40 },
}, { timestamps: true });

overlayCategorySchema.index({ ownerId: 1, nameKey: 1 }, { unique: true });

// Bound per connection: overlays live on their own cluster (db/overlayConnection.js).
const modelFor = (conn = mongoose.connection) => conn.models.OverlayCategory || conn.model('OverlayCategory', overlayCategorySchema);

module.exports = { schema: overlayCategorySchema, modelFor };

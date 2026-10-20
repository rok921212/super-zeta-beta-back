const mongoose = require('mongoose');

// What an admin changed from the admin panel that needs a trail (today: the
// Director lock passwords). Lives on the overlay cluster: the main cluster is
// at its collection cap (db/overlayConnection.js). Never holds a password.
const adminAuditSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  adminId: { type: String, required: true },
  action: { type: String, required: true },
  targetUserId: { type: String, default: null },
  detail: { type: String, default: '' },
}, { versionKey: false });

const modelFor = (conn = mongoose.connection) => conn.models.AdminAudit || conn.model('AdminAudit', adminAuditSchema);

module.exports = { schema: adminAuditSchema, modelFor };

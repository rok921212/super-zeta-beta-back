const mongoose = require('mongoose');

// App-wide settings an admin edits from the admin panel. One document
// (key 'global'). Today it only holds the default images stamped onto a
// team / player that is created without one — see services/teamDefaults.js.
const appSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  // Empty = use the built-in asset.
  defaultTeamLogo: { type: String, default: '' },
  defaultPlayerPhoto: { type: String, default: '' },
  defaultTeamFlag: { type: String, default: '' },
  // Every value that used to be a default. "Apply to existing" treats a
  // team/player still carrying one of these as "never given its own image".
  retired: {
    logo: { type: [String], default: [] },
    photo: { type: [String], default: [] },
    flag: { type: [String], default: [] },
  },
}, { timestamps: true });

// Bound per connection: the main cluster is at its collection cap, so this
// lives on the overlay cluster (db/overlayConnection.js).
const modelFor = (conn = mongoose.connection) => conn.models.AppSettings || conn.model('AppSettings', appSettingsSchema);

module.exports = { schema: appSettingsSchema, modelFor };

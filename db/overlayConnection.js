// The Designer's dedicated MongoDB connection (layouts, published revisions,
// custom themes). Overlays live on their own cluster so they never compete
// with the main database — the main Atlas cluster is at its collection cap.
//
//   OVERLAY_MONGODB_URI   the overlay cluster (optional)
//   OVERLAY_MONGODB_DB    database name on it (default scoresync_overlays)
//
// Without OVERLAY_MONGODB_URI the overlay models fall back to the default
// mongoose connection (the main cluster), exactly as before.

const mongoose = require('mongoose');
const config = require('../config');

const CONNECT_OPTS = {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  bufferTimeoutMS: 30000,
  family: 4,
};

let conn = null;

const dedicated = () => !!config.OVERLAY_MONGODB_URI;

/** The connection overlay models are bound to (created once, lazily). */
function getOverlayConnection() {
  if (!dedicated()) return mongoose.connection;
  if (!conn) {
    conn = mongoose.createConnection(config.OVERLAY_MONGODB_URI, { ...CONNECT_OPTS, dbName: config.OVERLAY_MONGODB_DB });
    conn.on('error', (err) => console.error(`❌ Overlay MongoDB error: ${err.message}`));
    conn.on('disconnected', () => console.warn('⚠️ Overlay MongoDB disconnected'));
    conn.on('reconnected', () => console.log('✅ Overlay MongoDB reconnected'));
  }
  return conn;
}

/** Wait for the overlay connection at startup. Never throws: the rest of the app must still boot. */
async function connectOverlayDb() {
  if (!dedicated()) {
    console.warn('⚠️ OVERLAY_MONGODB_URI not set — Designer overlays use the main MongoDB connection');
    return false;
  }
  try {
    await getOverlayConnection().asPromise();
    console.log(`✅ Overlay MongoDB connected (db ${config.OVERLAY_MONGODB_DB})`);
    return true;
  } catch (err) {
    console.error(`❌ Overlay MongoDB connection failed: ${err.message} — Designer endpoints will error until it connects`);
    return false;
  }
}

/** For /health. */
function overlayDbState() {
  const c = getOverlayConnection();
  return { dedicated: dedicated(), connected: c.readyState === 1, db: dedicated() ? config.OVERLAY_MONGODB_DB : c.name || null };
}

module.exports = { getOverlayConnection, connectOverlayDb, overlayDbState };

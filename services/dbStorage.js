// MongoDB storage used / left per cluster, for the admin panel.
//
// "Used" is measured the way Atlas shared tiers (M0) count it: dataSize +
// indexSize (uncompressed), summed over EVERY database on the cluster — not
// just the one mongoose is connected to, and not the compressed storageSize.
// "Left" is the configured quota minus that; Atlas does not expose the quota
// through the driver, so it comes from config (MONGODB_QUOTA_MB /
// OVERLAY_MONGODB_QUOTA_MB, default 512).

const mongoose = require('mongoose');
const config = require('../config');
const { getOverlayConnection, overlayDbState } = require('../db/overlayConnection');

const MB = 1024 * 1024;
const COLLECTION_CAP = 500; // Atlas shared tiers: collections per cluster
const SYSTEM_DBS = new Set(['admin', 'local', 'config']);
const TTL_MS = 60 * 1000;
const COMMAND_OPTS = { maxTimeMS: 8000 };

let memo = null; // { at, value }
let inflight = null;

async function clusterReport({ key, label, conn, quotaMb }) {
  const quotaBytes = quotaMb * MB;
  const base = { key, label, quotaBytes, collectionCap: COLLECTION_CAP };
  if (conn.readyState !== 1) return { ...base, connected: false };

  const client = conn.getClient();
  let names;
  let partial = false;
  try {
    const { databases } = await client.db().admin().listDatabases({ nameOnly: true, ...COMMAND_OPTS });
    names = databases.map((d) => d.name).filter((n) => !SYSTEM_DBS.has(n));
  } catch (err) {
    // DB user may not list databases: report the connected database only.
    names = [conn.name];
    partial = true;
  }

  const stats = await Promise.all(
    names.map(async (name) => {
      const s = await client.db(name).command({ dbStats: 1 }, COMMAND_OPTS);
      return {
        name,
        dataBytes: s.dataSize || 0,
        indexBytes: s.indexSize || 0,
        storageBytes: s.storageSize || 0,
        collections: s.collections || 0,
        objects: s.objects || 0,
      };
    })
  );

  const sum = (f) => stats.reduce((n, s) => n + s[f], 0);
  const dataBytes = sum('dataBytes');
  const indexBytes = sum('indexBytes');
  const usedBytes = dataBytes + indexBytes;

  return {
    ...base,
    connected: true,
    partial,
    usedBytes,
    freeBytes: Math.max(0, quotaBytes - usedBytes),
    percentUsed: quotaBytes ? Math.round((usedBytes / quotaBytes) * 1000) / 10 : 0,
    dataBytes,
    indexBytes,
    storageBytes: sum('storageBytes'),
    collections: sum('collections'),
    objects: sum('objects'),
    databases: stats
      .map((s) => ({ name: s.name, usedBytes: s.dataBytes + s.indexBytes, collections: s.collections }))
      .sort((a, b) => b.usedBytes - a.usedBytes),
  };
}

async function build() {
  const main = mongoose.connection;
  const targets = [{ key: 'main', label: 'Main cluster', conn: main, quotaMb: config.MONGODB_QUOTA_MB }];

  // Without a dedicated overlay cluster the overlay connection IS the main
  // one — reporting it again would double-count.
  if (overlayDbState().dedicated) {
    const overlay = getOverlayConnection();
    const sameCluster = overlay.readyState === 1 && main.readyState === 1 && overlay.host === main.host;
    if (!sameCluster) {
      targets.push({ key: 'overlay', label: 'Overlay cluster', conn: overlay, quotaMb: config.OVERLAY_MONGODB_QUOTA_MB });
    }
  }

  const clusters = await Promise.all(
    targets.map((t) =>
      clusterReport(t).catch((err) => ({
        key: t.key,
        label: t.label,
        quotaBytes: t.quotaMb * MB,
        collectionCap: COLLECTION_CAP,
        connected: false,
        error: err.message,
      }))
    )
  );
  return { generatedAt: new Date().toISOString(), clusters };
}

/** Cached for 60s; `fresh` forces a re-read. Concurrent callers share one read. */
async function getStorageReport({ fresh = false } = {}) {
  if (!fresh && memo && Date.now() - memo.at < TTL_MS) return memo.value;
  if (!inflight) {
    inflight = build()
      .then((value) => {
        memo = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

module.exports = { getStorageReport };

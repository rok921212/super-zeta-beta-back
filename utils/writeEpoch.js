// In-process write epochs for the live tick's read caches.
//
// The live tick (pubgApiMatchData.controller.js) used to re-read MatchData,
// MatchSelection and the populated Groups from Atlas on every ~2s push, per
// account. Caching those reads is only safe if every write invalidates them,
// so the models register mongoose post-hooks here (attachWriteEpochHooks)
// and the tick caches tag each entry with the epoch it was read at.
//
// Read protocol: snapshot() BEFORE the query, store the snapshot with the
// result, and reuse the entry only while isCurrent(). A write that lands
// while a read is in flight bumps the epoch after the snapshot was taken, so
// that read's (possibly stale) result is discarded on the next tick.
//
// Single-process only (Render runs one instance — see middleware/cache.js);
// a second instance would need these bumps over pub/sub.

function createEpoch(name) {
  let globalEpoch = 0;
  const byKey = new Map(); // key -> epoch

  return {
    name,
    // key: a matchId / userId string when the write's scope is known, or
    // null for "anything may have changed".
    bump(key) {
      if (key == null) globalEpoch++;
      else byKey.set(String(key), (byKey.get(String(key)) || 0) + 1);
    },
    snapshot(key) {
      return { g: globalEpoch, k: key == null ? 0 : (byKey.get(String(key)) || 0) };
    },
    isCurrent(key, snap) {
      if (!snap) return false;
      const now = this.snapshot(key);
      return now.g === snap.g && now.k === snap.k;
    },
  };
}

const WRITE_OPS = [
  'save', 'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace',
  'findOneAndDelete', 'deleteOne', 'deleteMany', 'replaceOne',
];

// keyField: the field that scopes the epoch (e.g. 'matchId'). A write whose
// filter/doc carries it bumps only that key; any other write bumps globally.
function attachWriteEpochHooks(schema, epoch, keyField) {
  // A scalar or ObjectId value scopes the bump; anything else (missing, or an
  // operator object like {$in: [...]}) falls back to a global bump.
  const scalar = (v) => {
    if (v == null) return null;
    if (typeof v !== 'object') return String(v);
    return v._bsontype ? String(v) : null;
  };
  const keyOf = (ctx) => {
    try {
      // Query middleware has getFilter(); document middleware's `this` is the doc.
      return typeof ctx?.getFilter === 'function'
        ? scalar(ctx.getFilter()?.[keyField])
        : scalar(ctx?.[keyField]);
    } catch {
      return null;
    }
  };
  for (const op of WRITE_OPS) {
    schema.post(op, { document: true, query: true }, function () {
      epoch.bump(keyOf(this));
    });
  }
  schema.post('insertMany', function () { epoch.bump(null); });
  // Model.bulkWrite has no reliable per-op hook here; callers bump manually.
}

const matchDataEpoch = createEpoch('matchData');
const matchSelectionEpoch = createEpoch('matchSelection');
const rosterEpoch = createEpoch('roster'); // Group + Teams

module.exports = { createEpoch, attachWriteEpochHooks, matchDataEpoch, matchSelectionEpoch, rosterEpoch };

// Caching for the Designer's stores (layouts, custom themes, fonts).
//
// Two tiers, chosen per kind of data:
//
//   REDIS (shared by every server instance, invalidated on write)
//     small, per-owner or per-layout JSON: the layout list, layout summaries,
//     the public-id lookup the OBS render route polls, revision lists, theme
//     lists, font lists. A write clears the affected scope AFTER it has landed
//     (clearing first would let a concurrent read re-cache the old value).
//
//   PROCESS MEMORY (per instance, bounded LRU)
//     immutable, large values that would cost real egress to pull out of
//     Redis on every hit: published revision documents (up to 512 KB) and
//     font files (up to 2 MB). They never change once stored, so there is
//     nothing to invalidate except on delete.
//
// What is deliberately NOT cached: a layout's full draft as read by the save /
// publish / restore paths (`get`), theme `get` / `maxNumber`, font `count`.
// Those reads feed writes — they must come from the database, always.
//
// Every wrapper returns the same interface as the store it wraps, so the
// controllers do not know caching exists, and the in-memory stores used by the
// tests get exactly the same behaviour as the Mongo ones.

const redis = require('../middleware/cache.js');

const MINUTE = 60;
const TTL = {
  owner: 10 * MINUTE,   // lists: cleared on every write by that owner; the TTL is only a safety net
  layout: 10 * MINUTE,  // summaries / public-id lookup / revision list
  miss: 30,             // "no such public id": short, so a typo'd URL cannot hammer Mongo
};

const stats = { hits: 0, misses: 0, memoryHits: 0, invalidations: 0 };

// ── bounded in-process LRU ──────────────────────────────────────────────────

function createLru({ maxEntries = 200, maxBytes = Infinity, ttlMs = 0 } = {}) {
  const map = new Map(); // key -> { value, bytes, at }
  let bytes = 0;
  const drop = (key) => {
    const e = map.get(key);
    if (!e) return;
    bytes -= e.bytes;
    map.delete(key);
  };
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (ttlMs && Date.now() - e.at > ttlMs) { drop(key); return undefined; }
      map.delete(key); // re-insert = most recently used
      map.set(key, e);
      return e.value;
    },
    set(key, value, size = 1) {
      drop(key);
      if (size > maxBytes) return; // never worth evicting everything for one value
      map.set(key, { value, bytes: size, at: Date.now() });
      bytes += size;
      while (map.size > maxEntries || bytes > maxBytes) drop(map.keys().next().value);
    },
    delete: drop,
    deleteWhere(pred) { for (const key of [...map.keys()]) if (pred(key)) drop(key); },
    clear() { map.clear(); bytes = 0; },
    get size() { return map.size; },
    get bytes() { return bytes; },
  };
}

// ── read-through over Redis, with request coalescing ────────────────────────

const inFlight = new Map(); // key -> Promise

/**
 * Value for `key` from Redis, else from `load()` (stored under `scope`).
 * Concurrent callers for the same key share one load.
 * A null load result is never cached.
 */
async function cached(backend, key, scope, ttlSeconds, load) {
  const hit = await backend.getCache(key);
  if (hit !== null && hit !== undefined) { stats.hits++; return hit; }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const value = await load();
      stats.misses++;
      if (value !== null && value !== undefined) {
        // JSON round-trip now, so a cold read and a cache hit hand back the same shape
        // (ObjectIds and Dates become strings either way).
        const plain = JSON.parse(JSON.stringify(value));
        backend.setCache(key, plain, ttlSeconds, scope).catch(() => {});
        return plain;
      }
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

const ownerScope = (ownerId) => `dz:owner:${ownerId}`;
const layoutScope = (layoutId) => `dz:layout:${layoutId}`;

// ── layouts ─────────────────────────────────────────────────────────────────

function withLayoutCache(store, { backend = redis } = {}) {
  // Published revisions are immutable: keep the hot ones in memory (≈ 24 MB at most).
  const revisions = createLru({ maxEntries: 60, maxBytes: 24 * 1024 * 1024, ttlMs: 60 * 60 * 1000 });
  // Per-instance memo of the public-id lookup: an OBS source polls it every minute,
  // and 5 s of staleness there is invisible (a publish already takes "up to a minute").
  const publicMemo = createLru({ maxEntries: 500, ttlMs: 5000 });
  const publicIds = new Map(); // layoutId -> publicId, to clear the memo on a write

  const invalidate = async (layoutId, ownerId) => {
    stats.invalidations++;
    const pub = publicIds.get(String(layoutId));
    if (pub) publicMemo.delete(pub);
    await Promise.all([
      backend.invalidateScope(layoutScope(layoutId)),
      ownerId ? backend.invalidateScope(ownerScope(ownerId)) : null,
    ]);
  };
  const dropRevisions = (layoutId) => revisions.deleteWhere((k) => k.startsWith(`${layoutId}:`));

  /** Owner of a layout we are about to change, when the caller did not pass it (insertRevision). */
  const summaryFor = (id, ownerId) => cached(backend, `dz:sum:${id}`, layoutScope(id), TTL.layout, () =>
    (store.getSummary ? store.getSummary(id, ownerId) : store.get(id, ownerId).then((l) => { if (!l) return l; const { draft, ...rest } = l; return rest; })));

  return {
    ...store,

    list: (ownerId) => cached(backend, `dz:layouts:${ownerId}`, ownerScope(ownerId), TTL.owner, () => store.list(ownerId)),

    /** Everything about a layout except its draft. Cached; ownership is still checked on every call. */
    async getSummary(id, ownerId) {
      const s = await summaryFor(id, ownerId);
      return s && String(s.ownerId) === String(ownerId) ? s : null;
    },

    /** The render route's lookup: summary fields only (the draft is never needed there). */
    async getByPublicId(publicId) {
      const memo = publicMemo.get(publicId);
      if (memo !== undefined) { stats.memoryHits++; return memo; }
      const miss = await backend.getCache(`dz:pubmiss:${publicId}`);
      if (miss) { publicMemo.set(publicId, null); return null; }
      const hit = await backend.getCache(`dz:pub:${publicId}`);
      if (hit) { stats.hits++; publicIds.set(String(hit._id), publicId); publicMemo.set(publicId, hit); return hit; }
      stats.misses++;
      const found = await store.getByPublicId(publicId);
      if (!found) {
        backend.setCache(`dz:pubmiss:${publicId}`, 1, TTL.miss, 'dz:pubmiss').catch(() => {});
        publicMemo.set(publicId, null);
        return null;
      }
      const { draft, ...summary } = found;
      const plain = JSON.parse(JSON.stringify(summary));
      publicIds.set(String(plain._id), publicId);
      backend.setCache(`dz:pub:${publicId}`, plain, TTL.layout, layoutScope(plain._id)).catch(() => {});
      publicMemo.set(publicId, plain);
      return plain;
    },

    listRevisions: (layoutId) => cached(backend, `dz:revs:${layoutId}`, layoutScope(layoutId), TTL.layout, () => store.listRevisions(layoutId)),

    async getRevision(layoutId, rev) {
      const key = `${layoutId}:${rev}`;
      const memo = revisions.get(key);
      if (memo) { stats.memoryHits++; return memo; }
      const found = await store.getRevision(layoutId, rev);
      if (found) {
        const plain = JSON.parse(JSON.stringify(found));
        revisions.set(key, plain, JSON.stringify(plain.document || {}).length);
        return plain;
      }
      return found;
    },

    // ── writes: change first, then clear what the change made stale ──

    async create(fields) {
      const created = await store.create(fields);
      // a brand-new public id may have been asked for (and remembered as missing) moments ago
      publicMemo.delete(created.publicId);
      await Promise.all([backend.invalidateScope(ownerScope(fields.ownerId)), backend.deleteCache(`dz:pubmiss:${created.publicId}`)]);
      return created;
    },
    async updateDraft(id, ownerId, expectedRev, set) {
      const updated = await store.updateDraft(id, ownerId, expectedRev, set);
      if (updated) await invalidate(id, ownerId);
      return updated;
    },
    async setFields(id, ownerId, set, opts) {
      const updated = await store.setFields(id, ownerId, set, opts);
      if (updated) await invalidate(id, ownerId);
      return updated;
    },
    async markPublished(id, ownerId, fromRev, toRev, revisionId) {
      const updated = await store.markPublished(id, ownerId, fromRev, toRev, revisionId);
      if (updated) await invalidate(id, ownerId);
      return updated;
    },
    async insertRevision(rev) {
      const inserted = await store.insertRevision(rev);
      await backend.invalidateScope(layoutScope(rev.layoutId)); // the revision list
      return inserted;
    },
    async remove(id, ownerId) {
      const removed = await store.remove(id, ownerId);
      if (removed) {
        dropRevisions(String(id));
        await invalidate(id, ownerId);
        publicIds.delete(String(id));
      }
      return removed;
    },

    /** Uncategorise every design of a deleted category, then drop what that made stale. */
    async clearCategory(ownerId, categoryId) {
      const ids = await store.clearCategory(ownerId, categoryId);
      await Promise.all(ids.map((id) => invalidate(id, ownerId)));
      return ids;
    },

    _cache: { revisions, publicMemo },
  };
}

// ── custom themes ───────────────────────────────────────────────────────────

function withThemeCache(store, { backend = redis } = {}) {
  const clear = (ownerId) => { stats.invalidations++; return backend.invalidateScope(ownerScope(ownerId)); };
  const after = (ownerId, result, changed = result) => (changed ? clear(ownerId).then(() => result) : result);
  return {
    ...store,
    list: (ownerId) => cached(backend, `dz:themes:${ownerId}`, ownerScope(ownerId), TTL.owner, () => store.list(ownerId)),
    create: async (fields) => after(fields.ownerId, await store.create(fields)),
    rename: async (id, ownerId, name) => after(ownerId, await store.rename(id, ownerId, name)),
    remove: async (id, ownerId) => after(ownerId, await store.remove(id, ownerId)),
    setSlot: async (id, ownerId, viewKey, layoutId) => after(ownerId, await store.setSlot(id, ownerId, viewKey, layoutId)),
    clearLayout: async (ownerId, layoutId) => { await store.clearLayout(ownerId, layoutId); await clear(ownerId); },
  };
}

// ── fonts ───────────────────────────────────────────────────────────────────

function withFontCache(store, { backend = redis } = {}) {
  // Font files never change (a re-upload is a new id): serve repeats from memory, up to 48 MB.
  const files = createLru({ maxEntries: 120, maxBytes: 48 * 1024 * 1024, ttlMs: 6 * 60 * 60 * 1000 });
  return {
    ...store,
    list: (ownerId) => cached(backend, `dz:fonts:${ownerId}`, ownerScope(ownerId), TTL.owner, () => store.list(ownerId)),
    async getFile(id) {
      const memo = files.get(String(id));
      if (memo) { stats.memoryHits++; return memo; }
      const found = await store.getFile(id);
      if (found) files.set(String(id), found, found.data.length);
      return found;
    },
    async create(fields) {
      const created = await store.create(fields);
      stats.invalidations++;
      await backend.invalidateScope(ownerScope(fields.ownerId));
      return created;
    },
    async remove(id, ownerId) {
      const removed = await store.remove(id, ownerId);
      if (removed) {
        files.delete(String(id));
        stats.invalidations++;
        await backend.invalidateScope(ownerScope(ownerId));
      }
      return removed;
    },
    _cache: { files },
  };
}

// ── uploaded images ─────────────────────────────────────────────────────────

function withAssetCache(store, { backend = redis } = {}) {
  // Image bytes never change (a new upload is a new id): serve repeats from memory, up to 64 MB.
  const files = createLru({ maxEntries: 200, maxBytes: 64 * 1024 * 1024, ttlMs: 6 * 60 * 60 * 1000 });
  const thumbs = createLru({ maxEntries: 600, maxBytes: 16 * 1024 * 1024, ttlMs: 6 * 60 * 60 * 1000 });
  const clear = (ownerId) => { stats.invalidations++; return backend.invalidateScope(ownerScope(ownerId)); };
  return {
    ...store,
    list: (ownerId) => cached(backend, `dz:assets:${ownerId}`, ownerScope(ownerId), TTL.owner, () => store.list(ownerId)),
    async getFile(id) {
      const memo = files.get(String(id));
      if (memo) { stats.memoryHits++; return memo; }
      const found = await store.getFile(id);
      if (found) files.set(String(id), found, found.data.length);
      return found;
    },
    async getThumb(id) {
      const memo = thumbs.get(String(id));
      if (memo) { stats.memoryHits++; return memo; }
      const found = await store.getThumb(id);
      if (found) thumbs.set(String(id), found, found.data.length);
      return found;
    },
    async create(fields) { const created = await store.create(fields); await clear(fields.ownerId); return created; },
    async setThumb(id, ownerId, data, mime) {
      const updated = await store.setThumb(id, ownerId, data, mime);
      if (updated) { thumbs.delete(String(id)); await clear(ownerId); }
      return updated;
    },
    async rename(id, ownerId, name) { const updated = await store.rename(id, ownerId, name); if (updated) await clear(ownerId); return updated; },
    async remove(id, ownerId) {
      const removed = await store.remove(id, ownerId);
      if (removed) { files.delete(String(id)); thumbs.delete(String(id)); await clear(ownerId); }
      return removed;
    },
    _cache: { files, thumbs },
  };
}

// ── design categories ───────────────────────────────────────────────────────

function withCategoryCache(store, { backend = redis } = {}) {
  const clear = (ownerId) => { stats.invalidations++; return backend.invalidateScope(ownerScope(ownerId)); };
  return {
    ...store,
    list: (ownerId) => cached(backend, `dz:cats:${ownerId}`, ownerScope(ownerId), TTL.owner, () => store.list(ownerId)),
    async create(fields) { const created = await store.create(fields); await clear(fields.ownerId); return created; },
    async rename(id, ownerId, name, nameKey) { const updated = await store.rename(id, ownerId, name, nameKey); if (updated) await clear(ownerId); return updated; },
    async remove(id, ownerId) { const removed = await store.remove(id, ownerId); if (removed) await clear(ownerId); return removed; },
  };
}

/** An isolated in-memory stand-in for the Redis helpers (tests; also what a Redis outage degrades to). */
function createMemoryBackend() {
  const values = new Map();
  const scopes = new Map();
  const calls = { get: 0, set: 0, invalidate: 0 };
  return {
    calls,
    getCache: async (key) => { calls.get++; return values.has(key) ? JSON.parse(values.get(key)) : null; },
    setCache: async (key, value, _ttl, scope = 'anon') => {
      calls.set++;
      values.set(key, JSON.stringify(value));
      if (!scopes.has(scope)) scopes.set(scope, new Set());
      scopes.get(scope).add(key);
    },
    deleteCache: async (key) => { values.delete(key); },
    invalidateScope: async (scope) => {
      calls.invalidate++;
      for (const key of scopes.get(scope) || []) values.delete(key);
      scopes.delete(scope);
    },
    keys: () => [...values.keys()],
  };
}

module.exports = { withLayoutCache, withThemeCache, withFontCache, withAssetCache, withCategoryCache, createLru, createMemoryBackend, designerCacheStats: stats, TTL };

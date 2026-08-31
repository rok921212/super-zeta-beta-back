const { Redis } = require('@upstash/redis');
const { encodeMsgpack } = require('../utils/msgpackCodec');

let getCache, setCache, deleteCache, invalidateScope, invalidateKeysByPrefix, cacheMiddleware, msgpackCacheMiddleware, invalidateCacheMiddleware;

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn('⚠️  Missing Redis env vars - using memory cache only');

  const memoryCache = new Map();
  const memoryScopeIndex = new Map(); // scope -> Set(keys)

  getCache = async (key) => memoryCache.get(key) ?? null;

  setCache = async (key, value, ttlSeconds = 300, scope = 'anon') => {
    memoryCache.set(key, value);
    if (!memoryScopeIndex.has(scope)) memoryScopeIndex.set(scope, new Set());
    memoryScopeIndex.get(scope).add(key);
    setTimeout(() => {
      memoryCache.delete(key);
      memoryScopeIndex.get(scope)?.delete(key);
    }, ttlSeconds * 1000);
  };

  deleteCache = async (key) => memoryCache.delete(key);

  invalidateScope = async (scope) => {
    const keys = memoryScopeIndex.get(scope);
    if (keys) {
      for (const k of keys) memoryCache.delete(k);
      memoryScopeIndex.delete(scope);
    }
  };

  invalidateKeysByPrefix = async () => {};

  cacheMiddleware = () => (req, res, next) => next();
  msgpackCacheMiddleware = () => (req, res, next) => next();
  invalidateCacheMiddleware = () => (req, res, next) => next();

  module.exports = { getCache, setCache, deleteCache, invalidateScope, invalidateKeysByPrefix, cacheMiddleware, msgpackCacheMiddleware, invalidateCacheMiddleware };
  return;
}

const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

(async () => {
  try {
    await redisClient.ping();
    console.log('✅ Upstash Redis connected');
  } catch (err) {
    console.error('❌ Upstash Redis connection failed:', err.message);
    process.exit(1);
  }
})();

// In-process fallback used only if a Redis call fails at runtime
const memoryCache = new Map();
const memoryScopeIndex = new Map(); // scope -> Set(keys)

const trackMemoryKey = (scope, key, ttlSeconds) => {
  if (!memoryScopeIndex.has(scope)) memoryScopeIndex.set(scope, new Set());
  memoryScopeIndex.get(scope).add(key);
  setTimeout(() => {
    memoryCache.delete(key);
    memoryScopeIndex.get(scope)?.delete(key);
  }, ttlSeconds * 1000);
};

// ── Cheap ETag epoch, per cache scope ──────────────────────────────────────
// Bumped on every invalidateScope / invalidateKeysByPrefix for a scope, so a
// manual dashboard edit (match selection, points correction, …) that clears
// the /bulk cache also rolls that scope's ETag — a revalidating overlay then
// gets the fresh body instead of a 304. Combined with a coarse time bucket in
// msgpackCacheMiddleware so anything that somehow bypasses invalidation still
// self-heals within one cache TTL.
const etagEpochByScope = new Map(); // scope -> integer
const getEtagEpoch = (scope) => etagEpochByScope.get(scope) || 0;
const bumpEtagEpoch = (scope) => etagEpochByScope.set(scope, getEtagEpoch(scope) + 1);

getCache = async (key) => {
  try {
    const value = await redisClient.get(key);
    return value ?? null;
  } catch (error) {
    console.warn('Cache get error, using memory:', error.message);
    return memoryCache.get(key) ?? null;
  }
};

setCache = async (key, value, ttlSeconds = 300, scope = 'anon') => {
  try {
    // Bandwidth: one pipelined REST round-trip instead of three separate
    // Upstash HTTPS requests (SET + SADD + EXPIRE). Every cache MISS on a
    // hot key (`/bulk`, `/overall`, polled by every overlay) used to cost 3
    // outbound requests; this makes it 1. Invalidation semantics are
    // unchanged — the `cache:keys:<scope>` set is still maintained exactly
    // as before, so invalidateScope()/invalidateKeysByPrefix() keep working.
    await redisClient.pipeline()
      .set(key, value, { ex: ttlSeconds })
      .sadd(`cache:keys:${scope}`, key)
      .expire(`cache:keys:${scope}`, ttlSeconds + 60)
      .exec();
  } catch (error) {
    console.warn('Cache set error, falling back to memory:', error.message);
    memoryCache.set(key, value);
    trackMemoryKey(scope, key, ttlSeconds);
  }
};

deleteCache = async (key) => {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.warn('Cache delete error:', error.message);
  }
  memoryCache.delete(key); // clear memory copy too, regardless of Redis outcome
};

invalidateScope = async (scope) => {
  bumpEtagEpoch(scope);
  try {
    const keys = await redisClient.smembers(`cache:keys:${scope}`);
    if (keys.length) await redisClient.del(...keys);
    await redisClient.del(`cache:keys:${scope}`);
  } catch (error) {
    console.warn('Cache scope invalidation error:', error.message);
  }
  // Always clear the memory-fallback copy for this scope too,
  // in case some entries were only ever written to memory.
  const memKeys = memoryScopeIndex.get(scope);
  if (memKeys) {
    for (const k of memKeys) memoryCache.delete(k);
    memoryScopeIndex.delete(scope);
  }
};

// Surgical version of invalidateScope: only clears keys for this scope whose
// path (the part of the key after `cache:<scope>:`) starts with one of the
// given prefixes, instead of every cached GET the user has. Call sites pass
// prefixes like 'cache:/api/teams' (a leftover from an older, scope-less key
// format) — strip the leading 'cache:' back off so it matches today's real
// `cache:<scope>:<originalUrl>` keys.
invalidateKeysByPrefix = async (scope, prefixes) => {
  const paths = prefixes
    .map(p => (typeof p === 'string' && p.startsWith('cache:')) ? p.slice(6) : p)
    .filter(Boolean);
  if (!paths.length) return;
  bumpEtagEpoch(scope);

  try {
    const allKeys = await redisClient.smembers(`cache:keys:${scope}`);
    const toDelete = allKeys.filter(k => paths.some(p => k.startsWith(`cache:${scope}:${p}`)));
    if (toDelete.length) {
      await redisClient.del(...toDelete);
      await redisClient.srem(`cache:keys:${scope}`, ...toDelete);
    }
  } catch (error) {
    console.warn('Prefix cache invalidation error:', error.message);
  }

  const memKeys = memoryScopeIndex.get(scope);
  if (memKeys) {
    for (const k of [...memKeys]) {
      if (paths.some(p => k.startsWith(`cache:${scope}:${p}`))) {
        memoryCache.delete(k);
        memKeys.delete(k);
      }
    }
  }
};

// Must run AFTER session middleware in server.js, so req.session is populated.
// scopeFn(req), when given, replaces the default session-based scope — used
// by routes whose data is written outside the normal request/response cycle
// (e.g. the live PUBG-API pipeline writing straight to MongoDB), so the write
// path can invalidate by a resource id (matchId/roundId) instead of needing
// to know which user sessions happen to have it cached.
// Response Cache-Control, separate from the Redis TTL above: the Redis
// cache only ever saved Mongo load, never egress bytes — nothing here used
// to set an HTTP caching header at all, so index.js's blanket
// `no-store` for /api/* (set earlier in the middleware chain, overwritten
// by whatever runs later) was the last word on every single response,
// cached or not, meaning the client re-fetched the full body every time
// regardless of a Redis hit. Deliberately shorter than ttlSeconds:
// invalidateCacheMiddleware below can only clear the server-side Redis
// entry on a write — it has no way to reach into a browser's already-cached
// copy, so a long browser max-age would mean staleness after an edit with
// no way to shorten it. 30s bounds that window while still absorbing rapid
// repeat polling of the same URL.
const BROWSER_CACHE_MAX_AGE = 30;

// `private` when this is genuinely per-user data (the default session/user
// scoping, no scopeFn override) — e.g. /teams' hiddenBy/createdBy
// filtering means two users can get different bodies for the same URL, so
// a shared/proxy cache must not reuse one user's response for another.
// `public` otherwise: the sessionID/'anon' fallback already means the
// Redis cache itself is shared across anonymous callers, and a scopeFn
// (resource-id-based, e.g. matchId/roundId) scope is for routes whose data
// isn't viewer-specific to begin with.
const cacheControlFor = (req, scopeFn) =>
  (!scopeFn && req.session?.userId)
    ? `private, max-age=${BROWSER_CACHE_MAX_AGE}`
    : `public, max-age=${BROWSER_CACHE_MAX_AGE}`;

cacheMiddleware = (ttlSeconds = 300, scopeFn = null) => {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();

    const scope = scopeFn ? scopeFn(req) : (req.session?.userId?.toString() || req.sessionID || 'anon');
    const key = `cache:${scope}:${req.originalUrl}`;
    const cacheControl = cacheControlFor(req, scopeFn);

    const cached = await getCache(key);
    if (cached) {
      res.set('Cache-Control', cacheControl);
      return res.json(cached);
    }

    const originalJson = res.json;
    res.json = function (data) {
      // Only persist actual successes — res.status(4xx/5xx).json(...) still
      // routes through this same patched res.json, and caching an error body
      // here means every request for this key returns that cached error (with
      // an implicit 200 on the cache-hit path above) until the TTL lapses.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setCache(key, data, ttlSeconds, scope).catch(console.warn);
      }
      res.set('Cache-Control', cacheControl);
      originalJson.call(this, data);
    };

    next();
  };
};

// Same hit/miss/setCache behavior as cacheMiddleware above (cache still
// stores the plain JS object under the same key scheme, so bustCache/
// invalidateScope in comsock.js need no changes), but the response body is
// MessagePack-encoded instead of JSON on both the hit and miss paths.
//
// keyFn(req), when given, replaces req.originalUrl as the per-request part of
// the cache key — used by /api/public/bulk to fold byte-identical `view`s
// (OverAllData/OverallFrags, Dom/WwcdStats/MatchFragrs, ...) onto one entry
// and to normalise query-param order. It only affects the cache key; the
// controller still sees the real req.query and builds the real (identical)
// body on a miss.
msgpackCacheMiddleware = (ttlSeconds = 300, scopeFn = null, keyFn = null) => {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();

    const scope = scopeFn ? scopeFn(req) : (req.session?.userId?.toString() || req.sessionID || 'anon');
    const keyPath = keyFn ? keyFn(req) : req.originalUrl;
    const key = `cache:${scope}:${keyPath}`;
    // In-process copy of the ENCODED msgpack body. Tracked in
    // memoryScopeIndex under `scope` so invalidateScope() sweeps it, and
    // prefixed `cache:<scope>:` so invalidateKeysByPrefix() matches it too.
    const bufKey = `${key}::mp`;
    // Memoised authoritative revision for this cached body (roundData.publicRev).
    // Threaded onto every exit as the X-Public-Rev response header so the local
    // overlay relay can order responses without decoding the msgpack body.
    const revKey = `${key}::rev`;
    const cacheControl = cacheControlFor(req, scopeFn);
    const setRevHeader = (rev) => res.set('X-Public-Rev', String(rev ?? 0));

    // Cheap conditional 304. The ETag is now purely the scope's revision
    // epoch — it changes if and only if invalidateScope / invalidateKeysByPrefix
    // ran for this scope, which every mutation path that can alter a /bulk or
    // /overall body already does (utils/publicRevision.js bumpRound/
    // bumpTournament -> invalidateScope on points/roster/selection/structure/
    // skin edits and the manual SAVE DATA). Between those events the body is
    // byte-identical, so a revalidating client stays 304 and pulls ~0 bytes.
    //
    // The previous form appended `.${floor(now / TTL)}`, a time bucket that
    // rolled every `ttlSeconds` (20s for /bulk) and forced a full-body 200 to
    // every OBS source every 20s even when nothing had changed — the single
    // biggest real HTTP-egress item. Dropped. On a cold start the in-process
    // epoch is 0 until the first bump; a client holding a stale pre-restart
    // ETag then gets one fresh 200 and self-heals on the next mutation.
    const etag = `W/"${getEtagEpoch(scope)}"`;
    res.set('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.locals.__bwBytes = 0;
      res.set('Cache-Control', cacheControl);
      setRevHeader(memoryCache.get(revKey) ?? 0);
      return res.status(304).end();
    }

    // Record the pre-compression body size for the [bw][http] logger —
    // compression() (now applied to application/msgpack too) strips
    // Content-Length, so without this the log line would read bytes=n/a for
    // exactly the endpoint that matters most to measure.
    const sendBuffered = (body) => {
      res.locals.__bwBytes = body.length;
      res.set('Content-Type', 'application/msgpack');
      res.set('Cache-Control', cacheControl);
      res.send(body);
    };

    // Serve the encoded body straight from memory — no Upstash GET (that GET
    // returned the full ~360 KB body over HTTPS on every cache hit, billed
    // service-initiated).
    const buffered = memoryCache.get(bufKey);
    if (buffered) {
      setRevHeader(memoryCache.get(revKey) ?? 0);
      return sendBuffered(buffered);
    }

    const cached = await getCache(key);
    if (cached) {
      const body = encodeMsgpack(cached);
      const rev = cached?.roundData?.publicRev ?? 0;
      memoryCache.set(bufKey, body);
      memoryCache.set(revKey, rev);
      trackMemoryKey(scope, bufKey, ttlSeconds);
      trackMemoryKey(scope, revKey, ttlSeconds);
      setRevHeader(rev);
      return sendBuffered(body);
    }

    res.json = function (data) {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      // See cacheMiddleware above for why this only caches on success.
      if (ok) setCache(key, data, ttlSeconds, scope).catch(console.warn);
      const body = encodeMsgpack(data);
      const rev = data?.roundData?.publicRev ?? 0;
      if (ok) {
        memoryCache.set(bufKey, body);
        memoryCache.set(revKey, rev);
        trackMemoryKey(scope, bufKey, ttlSeconds);
        trackMemoryKey(scope, revKey, ttlSeconds);
      }
      setRevHeader(rev);
      sendBuffered(body);
    };

    next();
  };
};

// When a route passes a key-list (or a function returning one), only clear
// the matching cache entries. When it doesn't, fall back to clearing EVERY
// cached GET for the acting user in one shot, so no route can ever be
// "forgotten" and left stale — that fallback is the safety net this used to
// always do; the key-list path just makes it surgical when a call site
// bothers to specify what actually changed.
invalidateCacheMiddleware = (keysOrFn) => {
  return (req, res, next) => {
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();

    // Deferred until the controller actually calls res.json (same res.json
    // patch pattern cacheMiddleware above uses for the SET side), instead
    // of running eagerly here before the controller has done anything.
    // Invalidating up front left a window spanning the controller's own
    // write sequence (often several awaited DB calls) where any GET could
    // land, find the cache already cleared but the write not yet done, and
    // re-cache the stale pre-write result for the full TTL — with nothing
    // left to clear it afterward. That's what made "create a match, list
    // still looks empty" possible.
    const scope = req.session?.userId?.toString() || req.sessionID || 'anon';
    const keys = typeof keysOrFn === 'function' ? keysOrFn(req) : keysOrFn;

    const originalJson = res.json.bind(res);
    res.json = (data) => {
      // Only on success — mirrors cacheMiddleware's own res.statusCode
      // guard. A failed write (400/500) changed nothing, so there's
      // nothing to invalidate.
      if (res.statusCode < 200 || res.statusCode >= 300) return originalJson(data);
      const invalidate = (Array.isArray(keys) && keys.length)
        ? invalidateKeysByPrefix(scope, keys)
        : invalidateScope(scope);
      invalidate
        .catch(err => console.warn('Cache invalidation error:', err.message))
        .then(() => originalJson(data));
    };

    next();
  };
};

module.exports = { getCache, setCache, deleteCache, invalidateScope, invalidateKeysByPrefix, cacheMiddleware, msgpackCacheMiddleware, invalidateCacheMiddleware };
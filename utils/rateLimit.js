// Failed-attempt limiter for password checks (route/directorLock.route.js).
//
// Counts failures per key in a sliding window; once a key has `max` failures
// inside `windowMs` it is blocked until the oldest of them ages out. A success
// clears the key. In memory: this backend runs as one Render instance, and a
// restart forgetting the counts only gives an attacker one fresh window.

function createFailureLimiter({ max = 5, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const failures = new Map(); // key -> [timestamps]

  const recent = (key) => {
    const cutoff = now() - windowMs;
    const list = (failures.get(key) || []).filter((t) => t > cutoff);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };

  return {
    /** { blocked, retryAfterS } for this key right now. */
    check(key) {
      const list = recent(key);
      if (list.length < max) return { blocked: false, retryAfterS: 0 };
      return { blocked: true, retryAfterS: Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000)) };
    },
    fail(key) {
      const list = recent(key);
      list.push(now());
      failures.set(key, list);
    },
    clear(key) {
      failures.delete(key);
    },
    /** Drops every key with nothing left in its window (called on a timer). */
    sweep() {
      for (const key of [...failures.keys()]) recent(key);
    },
  };
}

module.exports = { createFailureLimiter };

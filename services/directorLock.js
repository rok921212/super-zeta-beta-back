// The account lock (was "Director lock"): per account, one password that
// locks the desktop app's OB director controls (Auto Switcher,
// desktop-app/src-tauri/src/director/lock.rs) and the website Designer
// (middleware/requireDesignerUnlocked.js makes every Designer write a 423).
//
//   - `scope` (admin-set, default both) says which of the two the lock covers.
//     `locked` in the state stays "the Director is locked", so the desktop
//     needs no change; `designerLocked` is the Designer's, `accountLocked` raw.
//
//   - Only a bcrypt hash is kept: the account's own (User.directorLock.hash,
//     set by an admin) or, until one is set, the deployment default from the
//     DIRECTOR_LOCK_DEFAULT_HASH env var (scripts/hash-director-lock.cjs makes
//     one). No password is ever in source, a response or a log line.
//   - Locking needs the password too, so nobody can lock an operator out.
//   - Failed checks are limited per account+IP and per account
//     (utils/rateLimit.js); a blocked caller gets 429 with Retry-After.
//   - An admin setting or resetting a password bumps `version`, locks the
//     account and tells its desktops (`directorLockChanged` on user:<id>).
//
// Storage and side effects are injected so the logic is tested without Mongo.

const bcrypt = require('bcryptjs');
const { createFailureLimiter } = require('../utils/rateLimit.js');

const BCRYPT_COST = 12;
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

class LockError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

/** Store over the User model: only the directorLock sub-document is touched. */
function createMongoLockStore(User) {
  return {
    async get(userId) {
      const u = await User.findById(userId).select('+directorLock').lean().maxTimeMS(5000);
      if (!u) return null;
      return { hash: null, locked: false, version: 0, ...(u.directorLock || {}) };
    },
    async set(userId, fields) {
      const $set = {};
      for (const [k, v] of Object.entries(fields)) $set[`directorLock.${k}`] = v;
      await User.updateOne({ _id: userId }, { $set });
    },
  };
}

function createMemoryLockStore() {
  const docs = new Map();
  return {
    addUser(userId) { docs.set(String(userId), { hash: null, locked: false, version: 0 }); },
    async get(userId) { const d = docs.get(String(userId)); return d ? { ...d } : null; },
    async set(userId, fields) { const d = docs.get(String(userId)); if (d) Object.assign(d, fields); },
    raw(userId) { return docs.get(String(userId)); },
  };
}

function createDirectorLockService({
  store,
  defaultHash = () => process.env.DIRECTOR_LOCK_DEFAULT_HASH || '',
  emit = () => {},
  audit = async () => {},
  limiter = createFailureLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  accountLimiter = createFailureLimiter({ max: 20, windowMs: 60 * 60 * 1000 }),
  hashCost = BCRYPT_COST,
} = {}) {
  const fallback = () => {
    const h = String(defaultHash() || '').trim();
    return BCRYPT_RE.test(h) ? h : '';
  };

  const scopeOf = (doc) => ({
    director: doc.scope?.director !== false,
    designer: doc.scope?.designer !== false,
  });

  const view = (doc) => {
    const scope = scopeOf(doc);
    return {
      locked: !!doc.locked && scope.director,
      designerLocked: !!doc.locked && scope.designer,
      accountLocked: !!doc.locked,
      scope,
      available: !!(doc.hash || fallback()),
      hasCustomCredential: !!doc.hash,
      version: doc.version || 0,
    };
  };

  async function load(userId) {
    const doc = await store.get(userId);
    if (!doc) throw new LockError(404, 'Account not found');
    return doc;
  }

  async function check(userId, ip, password) {
    const key = `${userId}|${ip || ''}`;
    for (const [lim, k] of [[limiter, key], [accountLimiter, String(userId)]]) {
      const c = lim.check(k);
      if (c.blocked) throw new LockError(429, `Too many wrong passwords. Try again in ${Math.ceil(c.retryAfterS / 60)} min.`, { retryAfterS: c.retryAfterS });
    }
    const doc = await load(userId);
    const hash = doc.hash || fallback();
    if (!hash) throw new LockError(503, 'The Director lock is not set up for this account yet. Ask an admin to set its password.');
    const ok = typeof password === 'string' && password.length > 0 && password.length <= MAX_LENGTH && await bcrypt.compare(password, hash);
    if (!ok) {
      limiter.fail(key);
      accountLimiter.fail(String(userId));
      throw new LockError(401, 'Wrong Director lock password');
    }
    limiter.clear(key);
    return doc;
  }

  async function setLocked(userId, ip, password, locked) {
    const doc = await check(userId, ip, password);
    const fields = { locked, lockedAt: locked ? new Date() : null };
    await store.set(userId, fields);
    const next = view({ ...doc, ...fields });
    emit(userId, next);
    return next;
  }

  function validNew(password, confirm) {
    if (typeof password !== 'string' || password.length < MIN_LENGTH) throw new LockError(400, `The password needs at least ${MIN_LENGTH} characters`);
    if (password.length > MAX_LENGTH) throw new LockError(400, `The password can be at most ${MAX_LENGTH} characters`);
    if (password !== confirm) throw new LockError(400, 'The two passwords do not match');
  }

  return {
    async state(userId) {
      return view(await load(userId));
    },
    lock: (userId, ip, password) => setLocked(userId, ip, password, true),
    unlock: (userId, ip, password) => setLocked(userId, ip, password, false),

    /** Admin: give an account its own password. Locks it, so every desktop re-checks. */
    async setCredential(adminId, userId, password, confirm) {
      validNew(password, confirm);
      const doc = await load(userId);
      const fields = { hash: await bcrypt.hash(password, hashCost), locked: true, lockedAt: new Date(), version: (doc.version || 0) + 1, changedAt: new Date() };
      await store.set(userId, fields);
      accountLimiter.clear(String(userId));
      await audit({ adminId, action: 'director-lock.set', targetUserId: String(userId) });
      const next = view({ ...doc, ...fields });
      emit(userId, next);
      return next;
    },

    /** Admin: which areas the lock covers. Leaves the password and locked state alone. */
    async setScope(adminId, userId, body) {
      const doc = await load(userId);
      const scope = { ...scopeOf(doc) };
      for (const k of ['director', 'designer']) {
        if (body?.[k] === undefined) continue;
        if (typeof body[k] !== 'boolean') throw new LockError(400, `${k} must be true or false`);
        scope[k] = body[k];
      }
      await store.set(userId, { scope });
      await audit({ adminId, action: 'director-lock.scope', targetUserId: String(userId), scope });
      const next = view({ ...doc, scope });
      emit(userId, next);
      return next;
    },

    /** Admin: back to the deployment default password, and unlocked. */
    async reset(adminId, userId) {
      const doc = await load(userId);
      const fields = { hash: null, locked: false, lockedAt: null, version: (doc.version || 0) + 1, changedAt: new Date() };
      await store.set(userId, fields);
      accountLimiter.clear(String(userId));
      await audit({ adminId, action: 'director-lock.reset', targetUserId: String(userId) });
      const next = view({ ...doc, ...fields });
      emit(userId, next);
      return next;
    },
  };
}

/** Express handler wrapper: LockError -> its status (and Retry-After on 429). */
const send = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof LockError) {
      if (err.retryAfterS) res.set('Retry-After', String(err.retryAfterS));
      return res.status(err.status).json({ message: err.message });
    }
    console.error('[director-lock]', err.message);
    res.status(500).json({ message: 'Director lock error' });
  }
};

module.exports = { createDirectorLockService, createMongoLockStore, createMemoryLockStore, LockError, send, MIN_LENGTH };

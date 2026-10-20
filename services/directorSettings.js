// Director settings managed by an admin (the admin panel's Auto Switcher
// section) for one account's desktop OB director
// (desktop-app/src-tauri/src/director/managed.rs).
//
//   - Unmanaged (the default): every PC keeps its own settings, as before.
//   - Managed: the admin's fight-following values replace those fields on
//     every desktop of the account (the PC-specific ones — slots, keys, input
//     mode, map — stay per PC), and `allowAutoSwitch: false` stops the director
//     and keeps it from starting.
//   - Every change is validated here (the same ranges as the desktop's
//     config.rs `sanitized`), audited, and pushed to the account's desktops
//     (`directorSettingsChanged` on user:<id>).
//   - Recent switch decisions that desktops report are kept in memory only,
//     a few per account: no database write per switch.
//
// Storage and side effects are injected so the logic is tested without Mongo.

const { LockError } = require('./directorLock.js');

/** Recommended values: keep equal to DirectorConfig::default() in desktop-app/src-tauri/src/director/config.rs. */
const RECOMMENDED = Object.freeze({
  sensitivity: 3,
  playerDwellS: 5,
  fightDwellS: 9,
  idleDwellS: 20,
  minKeyGapS: 1,
  manualHoldS: 20,
  fightMargin: 0.25,
  playerMargin: 1,
  resolveAfterS: 6,
  resultHoldS: 5,
  cooldownS: 4,
  knockHoldS: 4,
  downHoldS: 1.5,
  leadTicks: 2,
  idlePolicy: 'rotate',
  vehicleSuppression: true,
});

/** [min, max, integer?] per numeric field — config.rs `sanitized`. */
const RANGES = {
  sensitivity: [1, 5, true],
  playerDwellS: [1, 60],
  fightDwellS: [1, 120],
  idleDwellS: [3, 300],
  minKeyGapS: [0.5, 10],
  manualHoldS: [0, 600],
  fightMargin: [0, 5],
  playerMargin: [0, 10],
  resolveAfterS: [2, 30],
  resultHoldS: [0, 30],
  cooldownS: [0, 60],
  knockHoldS: [0, 20],
  downHoldS: [0, 10],
  leadTicks: [1, 20, true],
};
const IDLE_POLICIES = ['rotate', 'stay'];
const DECISIONS_KEPT = 40;
const DECISION_BATCH = 20;

/** A full, valid config from a partial one (missing fields = recommended). Throws LockError 400. */
function validConfig(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) throw new LockError(400, 'config must be an object');
  const out = { ...RECOMMENDED };
  for (const [k, v] of Object.entries(input)) {
    if (RANGES[k]) {
      const [min, max, int] = RANGES[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
        throw new LockError(400, `${k} must be ${int ? 'a whole number' : 'a number'} from ${min} to ${max}`);
      }
      out[k] = v;
    } else if (k === 'idlePolicy') {
      if (!IDLE_POLICIES.includes(v)) throw new LockError(400, 'idlePolicy must be rotate or stay');
      out[k] = v;
    } else if (k === 'vehicleSuppression') {
      if (typeof v !== 'boolean') throw new LockError(400, 'vehicleSuppression must be true or false');
      out[k] = v;
    } else {
      throw new LockError(400, `${k} is not a Director setting an admin can manage`);
    }
  }
  if (out.fightDwellS < out.playerDwellS) throw new LockError(400, 'The fight dwell cannot be shorter than the player dwell');
  return out;
}

function createMongoSettingsStore(User) {
  return {
    async get(userId) {
      const u = await User.findById(userId).select('+directorSettings').lean().maxTimeMS(5000);
      return u ? { exists: true, ...(u.directorSettings || {}) } : null;
    },
    async set(userId, value) {
      await User.updateOne({ _id: userId }, { $set: { directorSettings: value } });
    },
  };
}

function createMemorySettingsStore() {
  const docs = new Map();
  return {
    addUser(userId) { docs.set(String(userId), {}); },
    async get(userId) { const d = docs.get(String(userId)); return d ? { exists: true, ...d } : null; },
    async set(userId, value) { if (docs.has(String(userId))) docs.set(String(userId), { ...value }); },
  };
}

function createDirectorSettingsService({ store, emit = () => {}, audit = async () => {}, now = () => Date.now() } = {}) {
  const decisions = new Map(); // userId -> { at, list }

  const view = (doc) => ({
    managed: !!doc.managed,
    allowAutoSwitch: doc.allowAutoSwitch !== false,
    config: doc.managed ? { ...RECOMMENDED, ...(doc.config || {}) } : null,
    version: doc.version || 0,
    updatedAt: doc.updatedAt || null,
  });

  async function load(userId) {
    const doc = await store.get(userId);
    if (!doc) throw new LockError(404, 'Account not found');
    return doc;
  }

  async function write(adminId, userId, next, action) {
    const doc = await load(userId);
    const value = { ...next, version: (doc.version || 0) + 1, updatedAt: new Date(now()).toISOString(), updatedBy: String(adminId) };
    await store.set(userId, value);
    await audit({ adminId: String(adminId), action, targetUserId: String(userId) });
    const v = view(value);
    emit(userId, v);
    return v;
  }

  return {
    recommended: () => ({ ...RECOMMENDED }),

    /** The signed-in account's own settings, for its desktops. */
    async state(userId) {
      return view(await load(userId));
    },

    /** Admin: the account's settings, the recommended values, and its recent decisions. */
    async adminState(userId) {
      const v = view(await load(userId));
      const d = decisions.get(String(userId));
      return { ...v, recommended: { ...RECOMMENDED }, decisions: d ? d.list : [], decisionsAt: d ? new Date(d.at).toISOString() : null };
    },

    /** Admin: manage this account's settings (a partial config is filled with the recommended values). */
    async set(adminId, userId, body) {
      const config = validConfig(body?.config ?? {});
      if (body?.allowAutoSwitch != null && typeof body.allowAutoSwitch !== 'boolean') throw new LockError(400, 'allowAutoSwitch must be true or false');
      return write(adminId, userId, { managed: true, config, allowAutoSwitch: body?.allowAutoSwitch !== false }, 'director-settings.set');
    },

    /** Admin: stop managing; every PC goes back to its own settings, and switching is allowed. */
    async reset(adminId, userId) {
      return write(adminId, userId, { managed: false, config: null, allowAutoSwitch: true }, 'director-settings.reset');
    },

    /** A desktop reports its latest switch decisions (newest last). Kept in memory, a few per account. */
    report(userId, list) {
      if (!Array.isArray(list)) throw new LockError(400, 'decisions must be a list');
      const clean = list.slice(-DECISION_BATCH).map((d) => ({
        time: String(d?.time ?? '').slice(0, 12),
        kind: String(d?.kind ?? '').slice(0, 16),
        teamId: Number.isFinite(d?.teamId) ? d.teamId : null,
        name: String(d?.name ?? '').slice(0, 40),
        reason: String(d?.reason ?? '').slice(0, 160),
        ok: d?.ok === true,
      }));
      const key = String(userId);
      const prev = decisions.get(key)?.list || [];
      decisions.set(key, { at: now(), list: [...prev, ...clean].slice(-DECISIONS_KEPT) });
      return { kept: Math.min(prev.length + clean.length, DECISIONS_KEPT) };
    },
  };
}

module.exports = { createDirectorSettingsService, createMongoSettingsStore, createMemorySettingsStore, validConfig, RECOMMENDED };

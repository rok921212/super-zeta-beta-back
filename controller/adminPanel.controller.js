// Admin-panel helpers. Auth is the EXISTING admin login only — every route in
// route/adminPanel.route.js sits behind requireAdmin (Bearer JWT ->
// req.session.userId -> User.isAdmin). There is no separate panel password or
// cookie: the secret URL is a frontend-only convenience, not a server factor.
//
// Tournament/round management is delegated straight to the existing
// controllers from the route file (so their cache behaviour is preserved) and
// is not re-implemented here.

const User = require('../models/User.model.js');
const Tournament = require('../models/tournament.model');
const Round = require('../models/round.model');
const Match = require('../models/match.model');
const Team = require('../models/teams.model.js');
const Group = require('../models/group.model.js');
const { getStorageReport } = require('../services/dbStorage');
const bwByUser = require('../utils/bwByUser');
const wsAccounting = require('../utils/wsAccounting');
const { BUILT_IN, FIELDS, getTeamDefaults, setTeamDefaults, getDefaultsWithRetired } = require('../services/teamDefaults.js');
const { syncMatchDataTeamsForGroup } = require('./matchData.controller.js');
const { isSafeUrl } = require('../utils/layoutSchema.generated.cjs');

// ── helpers ──────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const roleOf = (u) => (u.isAdmin ? 'admin' : u.isSubAdmin ? 'sub-admin' : 'user');

// Normalise a maxMatches value from the request body; returns { ok, value } or
// { ok:false }. 0 = unlimited; negatives / non-integers / NaN are rejected.
function parseMaxMatches(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

function sanitizeUser(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  delete o.password;
  delete o.relayToken; // never expose the desktop-relay token through the panel
  delete o.__v;
  return o;
}

// ── who is the signed-in admin? (behind requireAdmin) ───────────────────
// requireAdmin has already loaded req.authUser with { _id, username, email,
// isAdmin } selected — no password, no relayToken (unlike GET /api/users/me).
const me = (req, res) => {
  const u = req.authUser;
  res.status(200).json({
    user: { _id: u._id, username: u.username, email: u.email, isAdmin: u.isAdmin },
  });
};

// ── USER MANAGEMENT (behind requireAdmin) ─────────────────────────────
// Create a normal OR admin user. Uses the User model directly: the existing
// createUser controller hard-requires isAdmin:true + the ADMIN_CODE in the
// body, so it can't create normal users and we don't want the code in the
// browser. Password is hashed by the model's pre('save') hook.
const createUser = async (req, res) => {
  try {
    const { username, email, password, isAdmin, isSubAdmin } = req.body || {};

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'username, email and password are required' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'Invalid email address' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }
    const maxMatches = parseMaxMatches(req.body?.maxMatches);
    if (!maxMatches.ok) {
      return res.status(400).json({ message: 'maxMatches must be a whole number >= 0 (0 = unlimited)' });
    }

    const clash = await User.findOne({ $or: [{ email }, { username }] }).maxTimeMS(5000);
    if (clash) {
      return res.status(409).json({ message: 'A user with that email or username already exists' });
    }

    const user = new User({
      username,
      email,
      password,
      isAdmin: !!isAdmin,
      isSubAdmin: !isAdmin && !!isSubAdmin, // an admin is never also flagged sub-admin
      maxMatches: maxMatches.value || 0,
    });
    await user.save();

    console.log(`[admin-panel] user created id=${user._id} role=${roleOf(user)} by=${req.authUser._id}`);
    return res.status(201).json(sanitizeUser(user));
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// ── set the sub-admin flag and/or the match quota on a user ────────────
// PUT /api/admin-panel/users/:id/access  body { isSubAdmin?, maxMatches? }
// Deliberately does NOT touch isAdmin — that stays on PUT /users/:id
// (guardSelfDemote -> updateUser) so the last-admin lockout guard is kept.
const setUserAccess = async (req, res) => {
  try {
    const { id } = req.params;
    const { isSubAdmin } = req.body || {};
    const maxMatches = parseMaxMatches(req.body?.maxMatches);
    if (!maxMatches.ok) {
      return res.status(400).json({ message: 'maxMatches must be a whole number >= 0 (0 = unlimited)' });
    }

    const target = await User.findById(id).select('isAdmin').maxTimeMS(5000);
    if (!target) return res.status(404).json({ message: 'User not found' });

    const $set = {};
    if (isSubAdmin !== undefined) {
      // A full admin can't also be a sub-admin; ignore the flag for admins.
      $set.isSubAdmin = target.isAdmin ? false : !!isSubAdmin;
    }
    if (maxMatches.value !== undefined) $set.maxMatches = maxMatches.value;

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ message: 'Nothing to update (send isSubAdmin and/or maxMatches)' });
    }

    const updated = await User.findByIdAndUpdate(id, { $set }, { new: true })
      .select('username email isAdmin isSubAdmin maxMatches lastLoginAt loginCount createdAt')
      .maxTimeMS(5000);

    console.log(`[admin-panel] access set id=${id} ${JSON.stringify($set)} by=${req.authUser._id}`);
    return res.json(sanitizeUser(updated));
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// Guards that run BEFORE delegating to the existing updateUser / deleteUser,
// so an admin can't lock themselves (or the last admin) out of the system.
const guardSelfDemote = async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const actingId = String(req.authUser._id);
    const wantsDemote = req.body && req.body.isAdmin === false;

    if (wantsDemote && targetId === actingId) {
      return res.status(400).json({ message: "You can't remove your own admin privileges" });
    }
    if (wantsDemote) {
      const adminCount = await User.countDocuments({ isAdmin: true }).maxTimeMS(5000);
      const target = await User.findById(targetId).select('isAdmin').maxTimeMS(5000);
      if (target?.isAdmin && adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot demote the last remaining admin' });
      }
    }
    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const guardSelfDelete = async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const actingId = String(req.authUser._id);
    if (targetId === actingId) {
      return res.status(400).json({ message: "You can't delete your own account from the panel" });
    }
    const target = await User.findById(targetId).select('isAdmin').maxTimeMS(5000);
    if (target?.isAdmin) {
      const adminCount = await User.countDocuments({ isAdmin: true }).maxTimeMS(5000);
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last remaining admin' });
      }
    }
    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── OPTIONAL read-only global rounds view ──────────────────────────────
// The existing round controller scopes every query to createdBy === the
// caller, so the delegated /rounds route only ever shows the acting admin's
// own rounds. This endpoint gives a genuine cross-user read for oversight.
// Read-only; all writes still go through the scoped existing controllers.
const listAllRounds = async (req, res) => {
  try {
    const Round = require('../models/round.model');
    const rounds = await Round.find()
      .select('roundName day apiEnable tournamentId createdBy publicRev createdAt updatedAt')
      .populate('tournamentId', 'tournamentName userId')
      .populate('createdBy', 'username email')
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();
    return res.json(rounds);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── CROSS-USER OVERVIEW ───────────────────────────────────────────────
// GET /api/admin-panel/overview
// One row per user: role, last login, and totals for the tournaments /
// rounds / matches they own, plus the round they currently have API-enabled.
const overview = async (req, res) => {
  try {
    const [users, tAgg, rAgg, mAgg, apiRounds] = await Promise.all([
      User.find()
        .select('username email isAdmin isSubAdmin maxMatches lastLoginAt loginCount createdAt')
        .sort({ createdAt: 1 })
        .lean(),
      // Tournament.userId, Round.createdBy, Match.userId are the owner fields.
      Tournament.aggregate([{ $group: { _id: '$userId', n: { $sum: 1 } } }]),
      Round.aggregate([{ $group: { _id: '$createdBy', n: { $sum: 1 } } }]),
      Match.aggregate([{ $group: { _id: '$userId', n: { $sum: 1 } } }]),
      Round.find({ apiEnable: true })
        .select('roundName tournamentId createdBy')
        .populate('tournamentId', 'tournamentName')
        .lean(),
    ]);

    const byId = (agg) => {
      const m = new Map();
      for (const row of agg) if (row._id) m.set(String(row._id), row.n);
      return m;
    };
    const tCount = byId(tAgg);
    const rCount = byId(rAgg);
    const mCount = byId(mAgg);
    const apiByUser = new Map();
    for (const r of apiRounds) if (r.createdBy) apiByUser.set(String(r.createdBy), r);

    const rows = users.map((u) => {
      const id = String(u._id);
      const ar = apiByUser.get(id);
      return {
        _id: u._id,
        username: u.username,
        email: u.email,
        role: roleOf(u),
        isAdmin: !!u.isAdmin,
        isSubAdmin: !!u.isSubAdmin,
        maxMatches: u.maxMatches || 0,
        lastLoginAt: u.lastLoginAt || null,
        loginCount: u.loginCount || 0,
        createdAt: u.createdAt,
        counts: {
          tournaments: tCount.get(id) || 0,
          rounds: rCount.get(id) || 0,
          matches: mCount.get(id) || 0,
        },
        activeApiRound: ar
          ? {
              _id: ar._id,
              roundName: ar.roundName,
              tournamentId: ar.tournamentId?._id || ar.tournamentId || null,
              tournamentName: ar.tournamentId?.tournamentName || null,
            }
          : null,
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.tournaments += r.counts.tournaments;
        acc.rounds += r.counts.rounds;
        acc.matches += r.counts.matches;
        return acc;
      },
      { users: rows.length, tournaments: 0, rounds: 0, matches: 0 }
    );

    return res.json({ users: rows, totals });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── ONE USER'S ACTIVITY TREE ──────────────────────────────────────────
// GET /api/admin-panel/users/:id/activity
// Tournaments (owned) -> their rounds -> match count per round. Match docs
// themselves are NOT shipped (only counts) to keep the payload small.
const userActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('username email isAdmin isSubAdmin maxMatches').maxTimeMS(5000);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const [tournaments, rounds, matchAgg] = await Promise.all([
      Tournament.find({ userId: id }).select('tournamentName day createdAt').sort({ createdAt: 1 }).lean(),
      Round.find({ createdBy: id })
        .select('roundName day apiEnable tournamentId publicRev createdAt updatedAt')
        .sort({ createdAt: 1 })
        .lean(),
      Match.aggregate([
        { $match: { userId: user._id } },
        { $group: { _id: '$roundId', n: { $sum: 1 } } },
      ]),
    ]);

    const matchByRound = new Map();
    for (const row of matchAgg) if (row._id) matchByRound.set(String(row._id), row.n);

    const roundsByTournament = new Map();
    let totalMatches = 0;
    for (const r of rounds) {
      const matchCount = matchByRound.get(String(r._id)) || 0;
      totalMatches += matchCount;
      const key = String(r.tournamentId);
      if (!roundsByTournament.has(key)) roundsByTournament.set(key, []);
      roundsByTournament.get(key).push({ ...r, matchCount });
    }

    const tree = tournaments.map((t) => ({
      ...t,
      rounds: roundsByTournament.get(String(t._id)) || [],
    }));

    // Rounds whose parent tournament was deleted / not owned — still the user's.
    const orphanRounds = rounds.filter(
      (r) => !tournaments.some((t) => String(t._id) === String(r.tournamentId))
    );

    return res.json({
      user: { _id: user._id, username: user.username, email: user.email, role: roleOf(user), maxMatches: user.maxMatches || 0 },
      counts: { tournaments: tournaments.length, rounds: rounds.length, matches: totalMatches },
      tournaments: tree,
      orphanRounds: orphanRounds.map((r) => ({ ...r, matchCount: matchByRound.get(String(r._id)) || 0 })),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── MONGODB STORAGE ───────────────────────────────────────────────────
// GET /api/admin-panel/storage[?fresh=1]
// Used / left per cluster — see services/dbStorage.js for how it is counted.
const storage = async (req, res) => {
  try {
    return res.json(await getStorageReport({ fresh: req.query.fresh === '1' }));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── BANDWIDTH PER ACCOUNT ─────────────────────────────────────────────
// GET  /api/admin-panel/bandwidth
// POST /api/admin-panel/bandwidth/reset
// Egress since the last reset, one row per account (utils/bwByUser.js).
// Anonymous relay / overlay traffic is counted against its tournament and
// folded onto that tournament's owner here.
const TOP_ROUTES = 5;

const bandwidth = async (req, res) => {
  try {
    wsAccounting.sampleAll();
    const { since, rows } = bwByUser.snapshot();
    const active = wsAccounting.activeByOwner();

    const tournamentIds = new Set();
    for (const key of [...rows.map((r) => r.owner), ...Object.keys(active)]) {
      if (key.startsWith('t:')) tournamentIds.add(key.slice(2));
    }
    const tournaments = tournamentIds.size
      ? await Tournament.find({ _id: { $in: [...tournamentIds] } }).select('userId').lean()
      : [];
    const ownerOfTournament = new Map(tournaments.map((t) => [String(t._id), String(t.userId)]));
    const resolve = (key) => (key.startsWith('t:') && ownerOfTournament.get(key.slice(2))) || key;

    const merged = new Map();
    const rowOf = (key) => {
      let m = merged.get(key);
      if (!m) {
        m = { owner: key, httpWire: 0, httpReqs: 0, cacheWrite: 0, wsWire: 0, wsByKind: {}, wsConnects: {}, sockets: {}, routes: new Map() };
        merged.set(key, m);
      }
      return m;
    };
    const addInto = (target, source) => {
      for (const [k, v] of Object.entries(source)) target[k] = (target[k] || 0) + v;
    };
    for (const r of rows) {
      const m = rowOf(resolve(r.owner));
      m.httpWire += r.httpWire;
      m.httpReqs += r.httpReqs;
      m.cacheWrite += r.cacheWrite;
      m.wsWire += r.wsWire;
      addInto(m.wsByKind, r.wsByKind);
      addInto(m.wsConnects, r.wsConnects);
      for (const { route, count, bytes } of r.routes) {
        const e = m.routes.get(route) || { route, count: 0, bytes: 0 };
        e.count += count;
        e.bytes += bytes;
        m.routes.set(route, e);
      }
    }
    for (const [key, kinds] of Object.entries(active)) addInto(rowOf(resolve(key)).sockets, kinds);

    const userIds = [...merged.keys()].filter((k) => /^[a-f0-9]{24}$/i.test(k));
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select('username email').lean() : [];
    const userById = new Map(users.map((u) => [String(u._id), u]));

    const out = [...merged.values()].map((m) => {
      const u = userById.get(m.owner);
      return {
        ...m,
        username: u?.username || null,
        email: u?.email || null,
        total: m.httpWire + m.wsWire + m.cacheWrite,
        routes: [...m.routes.values()].sort((a, b) => b.bytes - a.bytes).slice(0, TOP_ROUTES),
      };
    }).sort((a, b) => b.total - a.total);

    return res.json({
      since: new Date(since).toISOString(),
      totals: {
        httpWire: out.reduce((n, r) => n + r.httpWire, 0),
        wsWire: out.reduce((n, r) => n + r.wsWire, 0),
        cacheWrite: out.reduce((n, r) => n + r.cacheWrite, 0),
      },
      rows: out,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const bandwidthReset = (req, res) => {
  wsAccounting.sampleAll(); // bytes already sent belong to the period being closed
  bwByUser.reset();
  return res.json({ ok: true });
};

// ── DEFAULT TEAM / PLAYER IMAGES ──────────────────────────────────────
// What a team or player created without an image gets (services/teamDefaults.js).
// GET  /api/admin-panel/team-defaults
// PUT  /api/admin-panel/team-defaults        body { defaultTeamLogo?, defaultPlayerPhoto?, defaultTeamFlag? } ('' = built-in)
// POST /api/admin-panel/team-defaults/apply  rewrite records still on an old default
const getTeamDefaultsHandler = async (req, res) => {
  return res.json({ defaults: await getTeamDefaults(), builtIn: BUILT_IN });
};

const updateTeamDefaults = async (req, res) => {
  try {
    const patch = {};
    for (const f of FIELDS) {
      const v = req.body?.[f];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !isSafeUrl(v.trim())) {
        return res.status(400).json({ message: `${f} must be an https:// URL or a /path on this site` });
      }
      patch[f] = v;
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ message: 'Nothing to update' });
    }
    const defaults = await setTeamDefaults(patch);
    console.log(`[admin-panel] team defaults set ${JSON.stringify(patch)} by=${req.authUser._id}`);
    return res.json({ defaults, builtIn: BUILT_IN });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// Only touches a logo / flag / photo that is still one of the old defaults
// (built-in or a previously set one) — an image someone chose is never replaced.
const applyTeamDefaults = async (req, res) => {
  try {
    const { current, old } = await getDefaultsWithRetired();
    const oldLogo = old.defaultTeamLogo;
    const oldFlag = old.defaultTeamFlag;
    const oldPhoto = old.defaultPlayerPhoto;

    const affected = await Team.find({
      $or: [{ logo: { $in: oldLogo } }, { teamFlag: { $in: oldFlag } }, { 'players.photo': { $in: oldPhoto } }],
    }).select('_id').lean();

    const [logos, flags, photos] = await Promise.all([
      Team.updateMany({ logo: { $in: oldLogo } }, { $set: { logo: current.defaultTeamLogo } }),
      Team.updateMany({ teamFlag: { $in: oldFlag } }, { $set: { teamFlag: current.defaultTeamFlag } }),
      Team.updateMany(
        { 'players.photo': { $in: oldPhoto } },
        { $set: { 'players.$[p].photo': current.defaultPlayerPhoto } },
        { arrayFilters: [{ 'p.photo': { $in: oldPhoto } }] }
      ),
    ]);

    // Already-created matches hold their own copy of these fields.
    const ids = affected.map(t => t._id);
    if (ids.length) {
      Group.find({ 'slots.team': { $in: ids } }).select('_id').lean()
        .then(async (groups) => { for (const g of groups) await syncMatchDataTeamsForGroup(g._id); })
        .catch(err => console.error('[admin-panel] MatchData sync after applying team defaults failed:', err.message));
    }

    console.log(`[admin-panel] team defaults applied teams=${ids.length} by=${req.authUser._id}`);
    return res.json({
      teamsTouched: ids.length,
      logos: logos.modifiedCount,
      flags: flags.modifiedCount,
      teamsWithPhotos: photos.modifiedCount,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  me,
  storage,
  bandwidth,
  bandwidthReset,
  getTeamDefaults: getTeamDefaultsHandler,
  updateTeamDefaults,
  applyTeamDefaults,
  createUser,
  setUserAccess,
  guardSelfDemote,
  guardSelfDelete,
  listAllRounds,
  overview,
  userActivity,
};

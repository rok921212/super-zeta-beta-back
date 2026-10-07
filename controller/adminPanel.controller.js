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
const { getStorageReport } = require('../services/dbStorage');

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

module.exports = {
  me,
  storage,
  createUser,
  setUserAccess,
  guardSelfDemote,
  guardSelfDelete,
  listAllRounds,
  overview,
  userActivity,
};

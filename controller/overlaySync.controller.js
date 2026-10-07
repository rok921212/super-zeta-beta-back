// SYNC OVERLAY.
//
// Every overlay link bakes a tournament + round into its URL, so a new
// tournament used to mean re-pasting every OBS Browser Source. An account can
// instead point ALL of its overlay links at one "sync target" round: the
// overlay page asks GET /api/public/overlay-sync/<the tournament in its URL>,
// and if the owner of that tournament has a target set, it renders the target
// round instead (front/src/dashboard/overlaySync.ts). With no target set the
// answer is null and the link behaves exactly as before.
//
// The redirect is resolved in the overlay page — the bulk endpoint, the round
// rooms and the local relay only ever see ordinary real ids.
//
// Live push: a change is announced as `publicDataInvalidated` WITHOUT a `rev`
// and with reason 'overlaySync', into the :control room of every round the
// account owns. That event is the one JSON control event the local relay
// already forwards verbatim, so no relay change is needed; the overlay engine
// ignores a rev-less invalidation, and the relay merely re-fetches that
// round's bulk once.
//
// Permanent links: an account also has one `overlayKey`. A link built on it
// (/public/live/<key>, /o/<publicId>?k=<key>) names no tournament or round at
// all and asks GET /api/public/overlay-sync/key/<key> for the target, so it
// never has to be re-pasted. With no target set such a link renders nothing.
//
// The API round wins: while the account has a round with apiEnable on (at
// most one, see round.model.js), that round is the target. Switching the API
// on for a round moves the target there at once (followApiRound, called from
// round.controller.js), and a PUT naming another round is answered with the
// API round instead. With no API round, the target is the round DisplayHud
// picked. The match shown is the round's selected one: the links carry
// followSelected=true.

const mongoose = require('mongoose');
const User = require('../models/User.model.js');
const Tournament = require('../models/tournament.model.js');
const Round = require('../models/round.model.js');
const { getSocket } = require('../socket');
const { newPublicId } = require('./overlayLayout.controller.js');

const isId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);
const KEY_RE = /^[A-Za-z0-9]{8,64}$/;

// The account's permanent-link key, created on first use and kept for good.
async function ensureOverlayKey(userId) {
  const user = await User.findById(userId).select('overlayKey').lean();
  if (user?.overlayKey) return user.overlayKey;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const key = newPublicId(16);
      const res = await User.updateOne({ _id: userId, overlayKey: { $exists: false } }, { $set: { overlayKey: key } });
      if (res.modifiedCount) return key;
      // Lost a race with another request: take the key that one stored.
      const again = await User.findById(userId).select('overlayKey').lean();
      if (again?.overlayKey) return again.overlayKey;
    } catch (err) {
      if (err && err.code === 11000) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique overlayKey');
}

// What both the HTTP answers and the socket push carry.
function publicShape(sync) {
  const stamp = Number(sync?.stamp) || 0;
  if (!sync?.tournamentId || !sync?.roundId) return { target: null, stamp };
  return {
    target: {
      tournamentId: String(sync.tournamentId),
      roundId: String(sync.roundId),
      scheduleMatches: (sync.scheduleMatches || []).map(String),
    },
    stamp,
  };
}

async function announce(userId, payload) {
  try {
    const rounds = await Round.find({ createdBy: userId }).select('_id tournamentId').lean();
    if (!rounds.length) return;
    const rooms = rounds.map((r) => `round:${r.tournamentId}:${r._id}:control`);
    getSocket().to(rooms).emit('publicDataInvalidated', { scope: 'round', reason: 'overlaySync', sync: payload });
    console.log(`[overlay-sync] announced to ${rooms.length} round(s) user=${userId} target=${payload.target ? payload.target.roundId : 'off'}`);
  } catch (err) {
    console.warn('[overlay-sync] announce failed:', err.message);
  }
}

// The account's API-enabled round, if it has one.
const apiRoundOf = (userId) => Round.findOne({ createdBy: userId, apiEnable: true }).select('_id tournamentId').lean();

// A round's API was just switched on: if the account's permanent links are
// on and show another round, move them to this one and tell every overlay.
// Called after the response has gone out, so it never throws.
async function followApiRound(userId, tournamentId, roundId) {
  try {
    const user = await User.findById(userId).select('overlaySync').lean();
    const cur = user?.overlaySync;
    if (!cur?.tournamentId || !cur?.roundId) return; // permanent links are off
    if (String(cur.roundId) === String(roundId)) return;
    const overlaySync = { tournamentId, roundId, scheduleMatches: [], stamp: Date.now() };
    await User.updateOne({ _id: userId }, { $set: { overlaySync } });
    await announce(userId, publicShape(overlaySync));
  } catch (err) {
    console.warn('[overlay-sync] follow API round failed:', err.message);
  }
}

const getOverlaySync = async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('overlaySync overlayKey').lean();
    res.json({ ...publicShape(user?.overlaySync), key: user?.overlayKey || null });
  } catch (err) {
    console.error('[overlay-sync] get failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const setOverlaySync = async (req, res) => {
  try {
    const userId = req.session.userId;
    const { tournamentId, roundId } = req.body || {};
    if (!isId(tournamentId) || !isId(roundId)) {
      return res.status(400).json({ message: 'tournamentId and roundId are required' });
    }
    const scheduleMatches = (Array.isArray(req.body.scheduleMatches) ? req.body.scheduleMatches : [])
      .filter(isId)
      .slice(0, 200);

    const [tournament, round] = await Promise.all([
      Tournament.findById(tournamentId).select('userId').lean(),
      Round.findById(roundId).select('tournamentId').lean(),
    ]);
    if (!tournament || !round || String(round.tournamentId) !== String(tournamentId)) {
      return res.status(404).json({ message: 'Tournament or round not found' });
    }
    if (String(tournament.userId) !== String(userId)) {
      return res.status(403).json({ message: 'Not your tournament' });
    }

    const key = await ensureOverlayKey(userId);
    // The API round wins over the round asked for; schedule picks belong to
    // the round they were made in.
    const apiRound = await apiRoundOf(userId);
    const overlaySync = apiRound && String(apiRound._id) !== String(roundId)
      ? { tournamentId: String(apiRound.tournamentId), roundId: String(apiRound._id), scheduleMatches: [], stamp: Date.now() }
      : { tournamentId, roundId, scheduleMatches, stamp: Date.now() };
    await User.updateOne({ _id: userId }, { $set: { overlaySync } });
    const payload = publicShape(overlaySync);
    announce(userId, payload);
    res.json({ ...payload, key });
  } catch (err) {
    console.error('[overlay-sync] set failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const clearOverlaySync = async (req, res) => {
  try {
    const userId = req.session.userId;
    const overlaySync = { tournamentId: null, roundId: null, scheduleMatches: [], stamp: Date.now() };
    await User.updateOne({ _id: userId }, { $set: { overlaySync } });
    const user = await User.findById(userId).select('overlayKey').lean();
    const payload = publicShape(overlaySync);
    announce(userId, payload);
    res.json({ ...payload, key: user?.overlayKey || null });
  } catch (err) {
    console.error('[overlay-sync] clear failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

async function liveShape(sync) {
  const payload = publicShape(sync);
  // A target whose round was since deleted must not strand the overlays on it.
  if (payload.target && !(await Round.exists({ _id: payload.target.roundId, tournamentId: payload.target.tournamentId }))) {
    payload.target = null;
  }
  return payload;
}

// Public: which round should an overlay whose URL names :tournamentId render?
const resolveOverlaySync = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { tournamentId } = req.params;
    if (!isId(tournamentId)) return res.status(400).json({ error: 'Invalid tournamentId' });

    const tournament = await Tournament.findById(tournamentId).select('userId').lean();
    if (!tournament?.userId) return res.json({ target: null, stamp: 0 });

    const user = await User.findById(tournament.userId).select('overlaySync').lean();
    res.json(await liveShape(user?.overlaySync));
  } catch (err) {
    console.error('[overlay-sync] resolve failed:', err);
    res.status(500).json({ error: err.message });
  }
};

// Public: which round should a permanent link (one built on :key) render?
const resolveOverlaySyncByKey = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { key } = req.params;
    if (!KEY_RE.test(String(key))) return res.status(400).json({ error: 'Invalid key' });

    const user = await User.findOne({ overlayKey: key }).select('overlaySync').lean();
    if (!user) return res.json({ target: null, stamp: 0 });
    res.json(await liveShape(user.overlaySync));
  } catch (err) {
    console.error('[overlay-sync] resolve by key failed:', err);
    res.status(500).json({ error: err.message });
  }
};

// Ranking page switcher (DisplayHud's 1 2 3 A buttons). The Match Data and
// Overall Data overlays flip pages on a timer; this tells every open overlay
// of one round to hold a page (`page` = zero-based index) or go back to the
// timer (`page` = null). Nothing is stored: it is a live command only, riding
// the same rev-less `publicDataInvalidated` event as the sync push above
// (front/src/Themes/shared/hooks/rankingPager.ts listens for it).
const PAGE_VIEWS = new Set(['MatchData', 'OverAllData']);
const MAX_PAGE = 50;

const sendOverlayPage = async (req, res) => {
  try {
    const { tournamentId, roundId, view } = req.body || {};
    const page = req.body?.page ?? null;
    if (!isId(tournamentId) || !isId(roundId)) {
      return res.status(400).json({ message: 'tournamentId and roundId are required' });
    }
    if (!PAGE_VIEWS.has(view)) return res.status(400).json({ message: 'Unknown view' });
    if (page !== null && !(Number.isInteger(page) && page >= 0 && page <= MAX_PAGE)) {
      return res.status(400).json({ message: 'page must be a page index or null' });
    }

    const [tournament, round] = await Promise.all([
      Tournament.findById(tournamentId).select('userId').lean(),
      Round.findById(roundId).select('tournamentId').lean(),
    ]);
    if (!tournament || !round || String(round.tournamentId) !== String(tournamentId)) {
      return res.status(404).json({ message: 'Tournament or round not found' });
    }
    if (String(tournament.userId) !== String(req.session.userId)) {
      return res.status(403).json({ message: 'Not your tournament' });
    }

    const pageCmd = { view, page, stamp: Date.now() };
    getSocket().to(`round:${tournamentId}:${roundId}:control`).emit('publicDataInvalidated', {
      tournamentId, roundId, scope: 'round', reason: 'overlayPage', pageCmd,
    });
    res.json(pageCmd);
  } catch (err) {
    console.error('[overlay-sync] page command failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { getOverlaySync, setOverlaySync, clearOverlaySync, sendOverlayPage, resolveOverlaySync, resolveOverlaySyncByKey, followApiRound };

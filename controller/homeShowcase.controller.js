// Home page showcase: the admin panel picks it (route/adminPanel.route.js,
// behind requireAdmin), the public home page reads it (index.js,
// GET /api/public/home-showcase). See services/homeShowcase.js.

const showcase = require('../services/homeShowcase.js');

const fail = (res, err, what) => {
  if (err instanceof showcase.ShowcaseError) return res.status(err.status).json({ message: err.message });
  if (err?.name === 'CastError') return res.status(400).json({ message: 'Invalid id' });
  console.error(`[home-showcase] ${what} failed:`, err?.message || err);
  return res.status(500).json({ message: `Could not ${what} the showcase` });
};

// ── admin ──
const get = async (req, res) => {
  try {
    const { showcase: s } = await showcase.readShowcase();
    res.json({ showcase: s });
  } catch (err) { fail(res, err, 'read'); }
};

const set = async (req, res) => {
  try {
    const { tournamentId, roundId, groupId, defaultTheme, views } = req.body || {};
    const s = await showcase.saveShowcase({ tournamentId, roundId, groupId, defaultTheme, views });
    res.json({ showcase: s });
  } catch (err) { fail(res, err, 'save'); }
};

const refresh = async (req, res) => {
  try {
    res.json({ showcase: await showcase.refreshShowcase() });
  } catch (err) { fail(res, err, 'refresh'); }
};

const clear = async (req, res) => {
  try {
    await showcase.clearShowcase();
    res.json({ showcase: null });
  } catch (err) { fail(res, err, 'reset'); }
};

// The groups of a round, for the picker: { _id, groupName, teams }.
const groups = async (req, res) => {
  try {
    const Round = require('../models/round.model');
    const Group = require('../models/group.model.js');
    const round = await Round.findById(req.query.roundId).select('groups').lean().maxTimeMS(5000);
    if (!round) return res.status(404).json({ message: 'Round not found' });
    const list = await Group.find({ _id: { $in: round.groups || [] } }).select('groupName slots').lean().maxTimeMS(5000);
    res.json(list.map((g) => ({ _id: g._id, groupName: g.groupName, teams: (g.slots || []).length })));
  } catch (err) { fail(res, err, 'list groups for'); }
};

// ── public ──
// Read by every home page visit: served from the in-process copy, with an
// ETag so a repeat visit is a bodiless 304. No showcase = { showcase: null }
// and the page uses its built-in sample.
const getPublic = async (req, res) => {
  try {
    const { showcase: s, etag } = await showcase.readShowcase();
    res.set('Cache-Control', 'public, max-age=300');
    res.set('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.json({ showcase: showcase.publicView(s) });
  } catch (err) {
    console.error('[home-showcase] public read failed:', err?.message || err);
    res.json({ showcase: null });
  }
};

module.exports = { get, set, refresh, clear, groups, getPublic };

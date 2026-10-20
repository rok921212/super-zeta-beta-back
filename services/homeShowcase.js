// The event shown in the home page simulation (front/src/home/sim). The site
// admin picks a tournament + round (+ group) in the admin panel; this builds a
// small, display-only snapshot of it: names, tags, logos, player names and
// photos, colours, maps. No ids, owners, scores or anything private. The
// simulation plays an invented match on top of it.
//
// Stored on the overlay cluster in the AppSettings collection (key
// 'homeShowcase'): the main cluster is at its collection cap.

const Tournament = require('../models/tournament.model');
const Round = require('../models/round.model');
const Match = require('../models/match.model');
const Group = require('../models/group.model.js');
const Team = require('../models/teams.model.js');
const { getOverlayConnection } = require('../db/overlayConnection.js');
const { modelFor } = require('../models/appSettings.model.js');
const { isSafeUrl } = require('../utils/layoutSchema.generated.cjs');

const KEY = 'homeShowcase';
const MAX_TEAMS = 25;
const MAX_PLAYERS = 4;
const MAX_BYTES = 300 * 1024;
const THEMES = ['Theme1', 'Theme2', 'Theme3', 'Theme4', 'Theme5', 'Theme6', 'Theme7', 'Theme8'];

const AppSettings = () => modelFor(getOverlayConnection());

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Only https / site-relative images: never data: URLs (size) or http (mixed content).
const img = (v) => {
  const s = str(v, 2048);
  return s && isSafeUrl(s) && !s.startsWith('data:') ? s : '';
};
const color = (v) => (/^#[0-9a-f]{3,8}$/i.test(str(v, 9)) ? str(v, 9) : '');
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));

class ShowcaseError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Builds the display-only seed for front/src/graphics/editor/simulation.ts (ShowcaseSeed). */
async function buildShowcaseSeed({ tournamentId, roundId, groupId }) {
  const [tournament, round] = await Promise.all([
    Tournament.findById(tournamentId).lean().maxTimeMS(5000),
    Round.findOne({ _id: roundId, tournamentId }).lean().maxTimeMS(5000),
  ]);
  if (!tournament) throw new ShowcaseError(404, 'Tournament not found');
  if (!round) throw new ShowcaseError(404, 'Round not found in that tournament');

  const groupIds = (round.groups || []).map(String);
  if (groupId && !groupIds.includes(String(groupId))) throw new ShowcaseError(400, 'That group is not part of the round');
  const chosen = groupId || groupIds[0];
  if (!chosen) throw new ShowcaseError(400, 'The round has no groups with teams');

  const [group, matches] = await Promise.all([
    Group.findById(chosen).lean().maxTimeMS(5000),
    Match.find({ roundId }).select('matchNo map').sort({ matchNo: 1 }).lean().maxTimeMS(5000),
  ]);
  if (!group) throw new ShowcaseError(404, 'Group not found');

  const slots = [...(group.slots || [])].sort((a, b) => (a.slot || 0) - (b.slot || 0)).slice(0, MAX_TEAMS);
  const teamDocs = await Team.find({ _id: { $in: slots.map((s) => s.team) } })
    .select('teamFullName teamTag logo players.playerName players.playerId players.photo')
    .lean().maxTimeMS(5000);
  const byId = new Map(teamDocs.map((t) => [String(t._id), t]));

  const teams = slots
    .map((s) => {
      const t = byId.get(String(s.team));
      if (!t) return null;
      const players = (t.players || []).slice(0, MAX_PLAYERS).map((p) => compact({
        name: str(p.playerName, 32), photo: img(p.photo), uId: str(p.playerId, 24),
      })).filter((p) => p.name);
      if (!players.length) return null;
      return compact({ name: str(t.teamFullName, 48), tag: str(t.teamTag, 8), logo: img(t.logo), slot: Number(s.slot) || undefined, players });
    })
    .filter((t) => t && t.name);
  if (teams.length < 3) throw new ShowcaseError(400, 'The group needs at least 3 teams with players');

  const seed = {
    tournament: compact({
      tournamentName: str(tournament.tournamentName, 60), torLogo: img(tournament.torLogo),
      primaryColor: color(tournament.primaryColor), secondaryColor: color(tournament.secondaryColor),
      overlayBg: color(tournament.overlayBg), day: str(tournament.day, 16),
    }),
    round: compact({ roundName: str(round.roundName, 40), day: str(round.day, 16) }),
    groupName: str(group.groupName, 40),
    maps: matches.map((m) => str(m.map, 24)).filter(Boolean).slice(0, 12),
    teams,
  };
  if (Buffer.byteLength(JSON.stringify(seed)) > MAX_BYTES) throw new ShowcaseError(400, 'The event is too large to show');
  return seed;
}

// ── storage, with an in-process copy for the public route ────────────────
let memo = null; // { showcase, etag }
const etagOf = (showcase) => `"hs-${showcase?.updatedAt ? new Date(showcase.updatedAt).getTime() : 0}"`;

async function readShowcase() {
  if (memo) return memo;
  const doc = await AppSettings().findOne({ key: KEY }).select('showcase').lean().maxTimeMS(5000);
  const showcase = doc?.showcase?.seed ? doc.showcase : null;
  memo = { showcase, etag: etagOf(showcase) };
  return memo;
}

function cleanViews(views) {
  if (!Array.isArray(views)) return [];
  return [...new Set(views.filter((v) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v)))].slice(0, 60);
}

/** Builds and saves the showcase. `source` is kept so "Refresh" can rebuild it later. */
async function saveShowcase({ tournamentId, roundId, groupId, defaultTheme, views }) {
  if (!tournamentId || !roundId) throw new ShowcaseError(400, 'tournamentId and roundId are required');
  const seed = await buildShowcaseSeed({ tournamentId, roundId, groupId });
  const showcase = {
    seed,
    defaultTheme: THEMES.includes(defaultTheme) ? defaultTheme : 'Theme1',
    views: cleanViews(views),
    source: compact({ tournamentId: String(tournamentId), roundId: String(roundId), groupId: groupId ? String(groupId) : '' }),
    updatedAt: new Date(),
  };
  await AppSettings().findOneAndUpdate({ key: KEY }, { $set: { showcase } }, { upsert: true, new: true }).maxTimeMS(5000);
  memo = null;
  return showcase;
}

/** Rebuilds from the saved source, keeping the theme and view choices. */
async function refreshShowcase() {
  memo = null;
  const { showcase } = await readShowcase();
  if (!showcase?.source) throw new ShowcaseError(404, 'No showcase is set');
  return saveShowcase({ ...showcase.source, defaultTheme: showcase.defaultTheme, views: showcase.views });
}

async function clearShowcase() {
  await AppSettings().updateOne({ key: KEY }, { $unset: { showcase: 1 } }).maxTimeMS(5000);
  memo = null;
}

/** What the home page gets: the seed and the visitor-facing choices, never `source`. */
const publicView = (showcase) => (showcase
  ? { seed: showcase.seed, defaultTheme: showcase.defaultTheme, views: showcase.views || [], updatedAt: showcase.updatedAt }
  : null);

module.exports = {
  ShowcaseError, buildShowcaseSeed, readShowcase, saveShowcase, refreshShowcase, clearShowcase, publicView, cleanViews,
  _resetForTests: () => { memo = null; },
};

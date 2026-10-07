// Custom themes API (Theme9, Theme10, …): owner-scoped groups of Designer
// layouts, one per overlay view. Numbers start at 9 (after the built-in
// Theme1-8) and are allocated per owner as max + 1.
//
// Rules:
//   - Identity comes from the verified JWT (req.session.userId) only.
//   - Another user's theme or layout is a 404.
//   - viewKey must be a known overlay view (same keys as DisplayHud) or Custom1-9.
//   - A layout sits in at most one slot of one theme.

const { sendConditionalJson } = require('../utils/conditionalJson.js');

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const FIRST_NUMBER = 9;

/** Overlay view keys a slot may use — keep in step with front/src/dashboard/overlayViews.ts. */
const VIEW_KEYS = [
  'Alerts', 'Lower', 'Upper', 'Dom', 'intro', 'LiveStats', 'LiveFrags', 'LiveData', 'Recall',
  'OverAllData', 'OverallFrags',
  'mvp', 'Achive', 'WwcdStats', 'WwcdSummary', 'MatchSummary', 'MatchData', 'MatchFragrs', 'playerH2H', 'TeamH2H',
  'Champions', '1stRunnerUp', '2ndRunnerUp', 'EventMvp',
  'CommingUpNext', 'highlightPoints', 'slots', 'RosterShowCase', 'PlayerSwitch',
  // Desktop app tools: drawn by the desktop app itself on the local game feed.
  'DesktopMap', 'DesktopBattleBar', 'DesktopObserving', 'DesktopMapTimer', 'DesktopTeamSlots',
];
const isViewKey = (k) => VIEW_KEYS.includes(k) || /^Custom[1-9]$/.test(k);

const log = (event, fields = {}) =>
  console.log(JSON.stringify({ scope: 'custom-themes', event, ...fields }));

/** Theme + each slot's layout summary (name / publicId / publishedRev); slots whose layout vanished are dropped. */
async function resolveTheme(layoutStore, theme, ownerId, layoutsById) {
  const byId = layoutsById || new Map((await layoutStore.list(ownerId)).map((l) => [String(l._id), l]));
  return {
    _id: theme._id,
    number: theme.number,
    name: theme.name,
    label: `Theme${theme.number}`,
    slots: theme.slots
      .filter((s) => byId.has(String(s.layoutId)))
      .map((s) => {
        const l = byId.get(String(s.layoutId));
        return { viewKey: s.viewKey, layoutId: String(s.layoutId), name: l.name, publicId: l.publicId, publishedRev: l.publishedRev || 0, defaults: l.defaults || null };
      }),
    updatedAt: theme.updatedAt,
  };
}

function createCustomThemeController({ themeStore, layoutStore }) {
  const userOf = (req) => String(req.session.userId);
  const idOk = (req, res) => {
    if (OBJECT_ID_RE.test(req.params.id || '')) return true;
    res.status(404).json({ message: 'Theme not found' });
    return false;
  };
  const checkName = (name) => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60;

  const resolve = (theme, ownerId, layoutsById) => resolveTheme(layoutStore, theme, ownerId, layoutsById);

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      log('error', { route: `${req.method} ${req.baseUrl}${req.route ? req.route.path : ''}`, name: err && err.name, code: err && err.code, message: err && err.message });
      if (res.headersSent) return;
      if (/cannot create a new collection|too many collections/i.test(String(err && err.message))) {
        return res.status(507).json({ message: 'Database collection limit reached — contact the administrator', code: 'COLLECTION_LIMIT' });
      }
      res.status(500).json({ message: 'Internal error' });
    }
  };

  return {
    viewKeys: VIEW_KEYS,

    list: wrap(async (req, res) => {
      const ownerId = userOf(req);
      const [themes, layouts] = await Promise.all([themeStore.list(ownerId), layoutStore.list(ownerId)]);
      const byId = new Map(layouts.map((l) => [String(l._id), l]));
      sendConditionalJson(req, res, await Promise.all(themes.map((t) => resolve(t, ownerId, byId))));
    }),

    create: wrap(async (req, res) => {
      const ownerId = userOf(req);
      const body = req.body || {};
      if (body.name !== undefined && !checkName(body.name)) return res.status(400).json({ message: 'name must be 1-60 characters' });
      for (let attempt = 0; attempt < 5; attempt++) {
        const number = Math.max(FIRST_NUMBER - 1, await themeStore.maxNumber(ownerId)) + 1;
        try {
          const theme = await themeStore.create({ ownerId, number, name: body.name ? body.name.trim() : `Theme ${number}` });
          log('created', { themeId: theme._id, userId: ownerId, number });
          return res.status(201).json(await resolve(theme, ownerId));
        } catch (err) {
          if (err && err.code === 11000) continue; // another tab took this number
          throw err;
        }
      }
      res.status(409).json({ message: 'Could not allocate a theme number, retry' });
    }),

    rename: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const name = (req.body || {}).name;
      if (!checkName(name)) return res.status(400).json({ message: 'name must be 1-60 characters' });
      const theme = await themeStore.rename(req.params.id, userOf(req), name.trim());
      if (!theme) return res.status(404).json({ message: 'Theme not found' });
      res.json(await resolve(theme, userOf(req)));
    }),

    remove: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const ok = await themeStore.remove(req.params.id, userOf(req));
      if (!ok) return res.status(404).json({ message: 'Theme not found' });
      res.status(204).end();
    }),

    setSlot: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const ownerId = userOf(req);
      const { viewKey } = req.params;
      if (!isViewKey(viewKey)) return res.status(400).json({ message: 'Unknown overlay view', errors: [{ path: 'viewKey', message: 'unknown view' }] });
      const layoutId = (req.body || {}).layoutId ?? null;
      if (layoutId !== null) {
        if (typeof layoutId !== 'string' || !OBJECT_ID_RE.test(layoutId)) return res.status(400).json({ message: 'layoutId must be an ObjectId or null' });
        const layout = await layoutStore.get(layoutId, ownerId);
        if (!layout) return res.status(404).json({ message: 'Layout not found' });
      }
      const theme = await themeStore.setSlot(req.params.id, ownerId, viewKey, layoutId);
      if (!theme) return res.status(404).json({ message: 'Theme not found' });
      res.json(await resolve(theme, ownerId));
    }),
  };
}

module.exports = { createCustomThemeController, VIEW_KEYS, FIRST_NUMBER, isViewKey, resolveTheme };

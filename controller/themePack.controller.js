// Theme export / import (`.sstheme`, services/themePack.js).
//
//   GET  /api/overlay-layouts/:id/export   one layout as a theme file
//   GET  /api/custom-themes/:id/export     every layout of a custom theme
//   POST /api/custom-themes/import         the file -> a NEW named theme in the caller's account
//
// Rules this file enforces:
//   - Identity comes from the verified JWT (req.session.userId) only. Another
//     user's layout or theme is a 404 on export.
//   - An import is validated completely (container, every draft, the name)
//     before the first write; a failure after that removes what it created.
//   - Imported layouts are published straight away, so the new theme works in
//     DisplayHud without a trip through the Designer.
//   - Only the fonts a design uses travel with it, and an imported font never
//     replaces one the account already has under the same name.

const schema = require('../utils/layoutSchema.generated.cjs');
const pack = require('../services/themePack.js');
const { checkDraft, createLayoutWithUniquePublicId, publishLayout, isCollectionLimitError } = require('./overlayLayout.controller.js');
const { VIEW_KEYS, FIRST_NUMBER, isViewKey, resolveTheme } = require('./customTheme.controller.js');
const { isWoff2, MAX_FONT_BYTES, MAX_FONTS_PER_USER, FAMILY_RE, RESERVED_FAMILIES } = require('./overlayFont.controller.js');

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MATCH_MODES = ['fixedMatch', 'selectedMatch', 'liveMatch', 'roundOverall', 'tournamentOverall'];
const CUSTOM_KEYS = Array.from({ length: 9 }, (_, i) => `Custom${i + 1}`);

const log = (event, fields = {}) =>
  console.log(JSON.stringify({ scope: 'theme-pack', event, ...fields }));

const nameOk = (name) => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60;

/**
 * Give every layout its own view slot: its own viewKey when that is a known
 * view nobody before it took, else the first free Custom1-9. Returns the keys
 * in layout order, or null when the Custom slots run out.
 */
function assignViewKeys(layouts) {
  const taken = new Set();
  const keys = layouts.map((l) => {
    if (l.viewKey && isViewKey(l.viewKey) && !taken.has(l.viewKey)) { taken.add(l.viewKey); return l.viewKey; }
    return null;
  });
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]) continue;
    const free = CUSTOM_KEYS.find((k) => !taken.has(k));
    if (!free) return null;
    taken.add(free);
    keys[i] = free;
  }
  return keys;
}

/**
 * Which of the file's fonts get added to this account. `existing` = the
 * lower-cased families the account already has. Returns { add, warnings }.
 */
function planFonts(fonts, existing, existingCount) {
  const add = [];
  const warnings = [];
  const seen = new Set(existing);
  let room = MAX_FONTS_PER_USER - existingCount;
  for (const f of fonts) {
    const key = f.family.toLowerCase();
    if (seen.has(key)) continue; // the account's own font of that name is used
    if (!FAMILY_RE.test(f.family) || RESERVED_FAMILIES.includes(key) || f.data.length > MAX_FONT_BYTES || !isWoff2(f.data)) {
      warnings.push(`Font "${f.family}" in the file is not usable and was skipped — text using it falls back to a default font.`);
      continue;
    }
    if (room <= 0) {
      warnings.push(`Font "${f.family}" was skipped: your font library is full (${MAX_FONTS_PER_USER}).`);
      continue;
    }
    seen.add(key);
    room -= 1;
    add.push(f);
  }
  return { add, warnings };
}

function createThemePackController({ layoutStore, themeStore, fontStore }) {
  const userOf = (req) => String(req.session.userId);

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      log('error', {
        route: `${req.method} ${req.baseUrl}${req.route ? req.route.path : ''}`,
        name: err && err.name, code: err && err.code, message: err && err.message,
      });
      if (res.headersSent) return;
      if (isCollectionLimitError(err)) {
        return res.status(507).json({ message: 'Database collection limit reached — contact the administrator', code: 'COLLECTION_LIMIT' });
      }
      res.status(500).json({ message: 'Internal error' });
    }
  };

  /** Layout records -> pack entries + the owner's fonts those drafts use. */
  async function buildPack(ownerId, name, entries) {
    const layouts = [];
    const families = new Set();
    for (const { layout, viewKey } of entries) {
      const draft = schema.normalizeLayout(layout.draft);
      pack.usedFamilies(draft, families);
      layouts.push({
        name: layout.name,
        viewKey: viewKey || null,
        matchMode: (layout.defaults && layout.defaults.matchMode) || 'selectedMatch',
        assetBase: layout.assetBase || '',
        draft,
      });
    }
    const fonts = [];
    if (fontStore && families.size) {
      for (const f of await fontStore.list(ownerId)) {
        if (!families.has(f.family.toLowerCase())) continue;
        const file = await fontStore.getFile(f._id);
        if (file) fonts.push({ family: f.family, data: file.data });
      }
    }
    return pack.encodePack({ name: name.slice(0, 60), schemaVersion: schema.SCHEMA_VERSION, layouts, fonts });
  }

  function sendPack(res, name, bytes) {
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${pack.packFileName(name)}"`);
    res.send(bytes);
  }

  return {
    exportLayout: wrap(async (req, res) => {
      const ownerId = userOf(req);
      if (!OBJECT_ID_RE.test(req.params.id || '')) return res.status(404).json({ message: 'Layout not found' });
      const layout = await layoutStore.get(req.params.id, ownerId);
      if (!layout) return res.status(404).json({ message: 'Layout not found' });
      // The view it fills in the author's theme; else the caller's suggestion.
      let viewKey = null;
      if (themeStore) {
        for (const t of await themeStore.list(ownerId)) {
          const slot = t.slots.find((s) => String(s.layoutId) === String(layout._id));
          if (slot) { viewKey = slot.viewKey; break; }
        }
      }
      if (!viewKey && typeof req.query.viewKey === 'string' && isViewKey(req.query.viewKey)) viewKey = req.query.viewKey;
      const bytes = await buildPack(ownerId, layout.name, [{ layout, viewKey }]);
      log('exported', { kind: 'layout', layoutId: String(layout._id), userId: ownerId, bytes: bytes.length });
      sendPack(res, layout.name, bytes);
    }),

    exportTheme: wrap(async (req, res) => {
      const ownerId = userOf(req);
      if (!OBJECT_ID_RE.test(req.params.id || '')) return res.status(404).json({ message: 'Theme not found' });
      const theme = await themeStore.get(req.params.id, ownerId);
      if (!theme) return res.status(404).json({ message: 'Theme not found' });
      // In DisplayHud's view order, so the file (and the import) reads the same every time.
      const order = (k) => { const i = VIEW_KEYS.indexOf(k); return i < 0 ? VIEW_KEYS.length + CUSTOM_KEYS.indexOf(k) : i; };
      const entries = [];
      for (const slot of [...theme.slots].sort((a, b) => order(a.viewKey) - order(b.viewKey))) {
        const layout = await layoutStore.get(slot.layoutId, ownerId);
        if (layout) entries.push({ layout, viewKey: slot.viewKey });
      }
      if (!entries.length) return res.status(400).json({ message: 'This theme has no layouts to export yet' });
      const bytes = await buildPack(ownerId, theme.name, entries);
      log('exported', { kind: 'theme', themeId: String(theme._id), userId: ownerId, layouts: entries.length, bytes: bytes.length });
      sendPack(res, theme.name, bytes);
    }),

    /** ?dryRun=1 answers with what the file holds (for the naming dialog) and writes nothing. */
    importPack: wrap(async (req, res) => {
      const ownerId = userOf(req);
      // express.raw only fills req.body for Content-Type: application/octet-stream.
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ message: `Send the ${pack.FILE_EXTENSION} file as the request body` });
      const decoded = pack.decodePack(req.body);
      if (decoded.error) return res.status(400).json({ message: decoded.error });
      const file = decoded.pack;

      // Everything is checked before the first write.
      const docs = [];
      for (let i = 0; i < file.layouts.length; i++) {
        const draft = checkDraft(file.layouts[i].draft);
        if (draft.errors) {
          return res.status(400).json({
            message: `Layout "${file.layouts[i].name}" in this file is not valid`,
            errors: draft.errors.map((e) => ({ ...e, path: `layouts.${i}.${e.path}` })),
          });
        }
        docs.push(draft.doc);
      }
      const viewKeys = assignViewKeys(file.layouts);
      if (!viewKeys) return res.status(400).json({ message: 'Theme file has more layouts than a theme has views' });

      const owned = fontStore ? await fontStore.list(ownerId) : [];
      const fontPlan = fontStore
        ? planFonts(file.fonts, owned.map((f) => f.family.toLowerCase()), owned.length)
        : { add: [], warnings: file.fonts.length ? ['Fonts in the file were skipped.'] : [] };
      const summary = {
        name: file.name || file.layouts[0].name.slice(0, 60),
        layouts: file.layouts.map((l, i) => ({ name: l.name, viewKey: viewKeys[i] })),
        fonts: file.fonts.map((f) => f.family),
        warnings: fontPlan.warnings,
      };
      if (req.query.dryRun === '1' || req.query.dryRun === 'true') return res.json(summary);

      const name = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name.trim() : summary.name;
      if (!nameOk(name)) return res.status(400).json({ message: 'name must be 1-60 characters' });

      const created = [];
      let theme = null;
      try {
        // Fonts first: publishing snapshots the account's font list onto each revision.
        for (const f of fontPlan.add) {
          try {
            await fontStore.create({ ownerId, family: f.family, familyKey: f.family.toLowerCase(), size: f.data.length, data: f.data });
          } catch (err) {
            if (!(err && err.code === 11000)) throw err; // another tab just added that family: use it
          }
        }
        for (let i = 0; i < file.layouts.length; i++) {
          const l = file.layouts[i];
          const assetBase = /^https:\/\//.test(l.assetBase) && schema.isSafeUrl(l.assetBase) ? l.assetBase.replace(/\/+$/, '') : '';
          const layout = await createLayoutWithUniquePublicId(layoutStore, {
            ownerId,
            schemaVersion: schema.SCHEMA_VERSION,
            name: l.name,
            draft: docs[i],
            defaults: { tournamentId: null, roundId: null, matchMode: MATCH_MODES.includes(l.matchMode) ? l.matchMode : 'selectedMatch' },
            assetBase,
          });
          created.push(layout);
          const out = await publishLayout(layoutStore, fontStore, layout, ownerId, docs[i]);
          if (!out.layout) throw new Error('imported layout could not be published');
        }
        for (let attempt = 0; attempt < 5 && !theme; attempt++) {
          const number = Math.max(FIRST_NUMBER - 1, await themeStore.maxNumber(ownerId)) + 1;
          try {
            theme = await themeStore.create({ ownerId, number, name });
          } catch (err) {
            if (!(err && err.code === 11000)) throw err; // another tab took this number
          }
        }
        if (!theme) throw new Error('could not allocate a theme number');
        let current = theme;
        for (let i = 0; i < created.length; i++) {
          current = await themeStore.setSlot(theme._id, ownerId, viewKeys[i], String(created[i]._id));
          if (!current) throw new Error('theme vanished during import');
        }
        log('imported', { themeId: String(theme._id), userId: ownerId, layouts: created.length, fonts: fontPlan.add.length, bytes: req.body.length });
        res.status(201).json({ theme: await resolveTheme(layoutStore, current, ownerId), warnings: fontPlan.warnings });
      } catch (err) {
        // Leave nothing half-imported behind (fonts stay: they are harmless and reusable).
        for (const l of created) {
          try { await layoutStore.remove(l._id, ownerId); } catch { /* best effort */ }
        }
        if (theme) {
          try { await themeStore.remove(theme._id, ownerId); } catch { /* best effort */ }
        }
        throw err;
      }
    }),
  };
}

/** Body-parser failures on the import route (too large) as JSON, not Express's HTML error page. */
function importErrorHandler(err, req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ message: 'Theme file is too large' });
  next(err);
}

module.exports = { createThemePackController, importErrorHandler, assignViewKeys, planFonts };

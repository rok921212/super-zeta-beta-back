// Design categories an account made itself -> /api/overlay-categories.
//
//   - A category is a label, not a container: deleting one moves its designs
//     to "uncategorised" and deletes none of them.
//   - Names are unique per account (case-insensitive) and may not repeat a
//     built-in category's name (DESIGN_CATEGORIES in the shared schema).
//   - Identity comes from the verified JWT only; another account's category is a 404.

const schema = require('../utils/layoutSchema.generated.cjs');
const { sendConditionalJson } = require('../utils/conditionalJson.js');

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_CATEGORIES_PER_USER = 40;
const NAME_RE = /^[^\u0000-\u001f<>]{1,40}$/;
const BUILTIN_KEYS = schema.DESIGN_CATEGORIES.map((c) => c.label.toLowerCase());

const toInfo = (c) => ({ _id: String(c._id), name: c.name });

/** A usable name, or null. Whitespace is collapsed. */
function cleanCategoryName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  return NAME_RE.test(name) ? name : null;
}

function createOverlayCategoryController(store, { layoutStore = null, available = () => true } = {}) {
  const userOf = (req) => String(req.session.userId);

  const wrap = (fn) => async (req, res) => {
    try {
      if (!available()) return res.status(503).json({ message: 'The overlay database is not configured on this server — categories are unavailable', code: 'OVERLAY_DB_MISSING' });
      await fn(req, res);
    } catch (err) {
      console.log(JSON.stringify({ scope: 'overlay-categories', event: 'error', name: err && err.name, code: err && err.code, message: err && err.message }));
      if (res.headersSent) return;
      res.status(500).json({ message: 'Internal error' });
    }
  };

  const checkName = (req, res) => {
    const name = cleanCategoryName(req.body && req.body.name);
    if (!name) { res.status(400).json({ message: 'Category name must be 1-40 characters' }); return null; }
    if (BUILTIN_KEYS.includes(name.toLowerCase())) { res.status(409).json({ message: `"${name}" is already a built-in category` }); return null; }
    return name;
  };

  return {
    list: wrap(async (req, res) => {
      sendConditionalJson(req, res, (await store.list(userOf(req))).map(toInfo));
    }),

    create: wrap(async (req, res) => {
      const name = checkName(req, res);
      if (!name) return;
      const ownerId = userOf(req);
      if ((await store.list(ownerId)).length >= MAX_CATEGORIES_PER_USER) {
        return res.status(409).json({ message: `Category limit reached (${MAX_CATEGORIES_PER_USER})` });
      }
      try {
        res.status(201).json(toInfo(await store.create({ ownerId, name, nameKey: name.toLowerCase() })));
      } catch (err) {
        if (err && err.code === 11000) return res.status(409).json({ message: `You already have a category named "${name}"` });
        throw err;
      }
    }),

    rename: wrap(async (req, res) => {
      if (!OBJECT_ID_RE.test(req.params.id || '')) return res.status(404).json({ message: 'Category not found' });
      const name = checkName(req, res);
      if (!name) return;
      try {
        const updated = await store.rename(req.params.id, userOf(req), name, name.toLowerCase());
        if (!updated) return res.status(404).json({ message: 'Category not found' });
        res.json(toInfo(updated));
      } catch (err) {
        if (err && err.code === 11000) return res.status(409).json({ message: `You already have a category named "${name}"` });
        throw err;
      }
    }),

    remove: wrap(async (req, res) => {
      const id = req.params.id || '';
      const ownerId = userOf(req);
      if (!OBJECT_ID_RE.test(id) || !(await store.remove(id, ownerId))) return res.status(404).json({ message: 'Category not found' });
      // Its designs stay; they just have no category any more.
      const moved = layoutStore && layoutStore.clearCategory ? await layoutStore.clearCategory(ownerId, id) : [];
      res.json({ removed: true, uncategorised: moved.length });
    }),
  };
}

module.exports = { createOverlayCategoryController, cleanCategoryName, MAX_CATEGORIES_PER_USER };

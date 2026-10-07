// Designer font library API.
//
// Rules this file enforces:
//   - Only .woff2 is accepted, and that is decided by the bytes (the `wOF2`
//     signature + the header's own length field), never by the file name or
//     the Content-Type the client claims.
//   - Identity comes from the verified JWT (req.session.userId) only. Another
//     user's font is a 404 on delete.
//   - The file route is public: a browser's @font-face request cannot carry a
//     Bearer token, and the published overlay runs logged-out inside OBS.

const { sendConditionalJson } = require('../utils/conditionalJson.js');

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const FAMILY_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const MAX_FONTS_PER_USER = 30;
// Families the front already ships (front/src/graphics/renderer/fonts.ts) plus
// CSS generics: an upload may not shadow them.
const RESERVED_FAMILIES = [
  'payback', 'awaking', 'supermolot', 'unisans', 'tungsten', 'bebas', 'agencyb', 'impact', 'relidux',
  'anton', 'bebas neue', 'righteous', 'inter',
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset',
];

const log = (event, fields = {}) =>
  console.log(JSON.stringify({ scope: 'overlay-fonts', event, ...fields }));

/** WOFF2 header: 'wOF2' signature, then flavor (4 bytes), then the total file length (uint32 BE). */
function isWoff2(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 48) return false;
  if (buf.readUInt32BE(0) !== 0x774f4632) return false;
  return buf.readUInt32BE(8) === buf.length;
}

/** Same mapping as overlayLayout.controller.js: the Atlas shared-tier collection cap. */
function isCollectionLimitError(err) {
  if (!err) return false;
  if (err.code === 8000 || err.code === 14031) return /collection/i.test(String(err.message)) || err.code === 14031;
  return /cannot create a new collection|collections? of \d+|too many collections/i.test(String(err.message));
}

const toInfo = (f) => ({ _id: String(f._id), family: f.family, size: f.size, createdAt: f.createdAt });

function createOverlayFontController(store) {
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

  return {
    list: wrap(async (req, res) => {
      sendConditionalJson(req, res, (await store.list(userOf(req))).map(toInfo));
    }),

    upload: wrap(async (req, res) => {
      const family = typeof req.query.name === 'string' ? req.query.name.trim().replace(/\s+/g, ' ') : '';
      if (!FAMILY_RE.test(family)) {
        return res.status(400).json({ message: 'Font name must start with a letter and use only letters, numbers, spaces, - or _ (max 40)' });
      }
      const familyKey = family.toLowerCase();
      if (RESERVED_FAMILIES.includes(familyKey)) {
        return res.status(409).json({ message: `"${family}" is a built-in font name — choose another name` });
      }
      // express.raw only fills req.body for Content-Type: font/woff2.
      const data = req.body;
      if (!Buffer.isBuffer(data) || !data.length) return res.status(400).json({ message: 'Only .woff2 fonts are supported' });
      if (data.length > MAX_FONT_BYTES) return res.status(413).json({ message: 'Font is larger than 2 MB' });
      if (!isWoff2(data)) return res.status(400).json({ message: 'Only .woff2 fonts are supported' });

      const ownerId = userOf(req);
      if (await store.count(ownerId) >= MAX_FONTS_PER_USER) {
        return res.status(409).json({ message: `Font limit reached (${MAX_FONTS_PER_USER}) — delete one first` });
      }
      let font;
      try {
        font = await store.create({ ownerId, family, familyKey, size: data.length, data });
      } catch (err) {
        if (err && err.code === 11000) return res.status(409).json({ message: `You already have a font named "${family}"` });
        throw err;
      }
      log('uploaded', { fontId: font._id, userId: ownerId, bytes: data.length });
      res.status(201).json(toInfo(font));
    }),

    remove: wrap(async (req, res) => {
      if (!OBJECT_ID_RE.test(req.params.id || '') || !(await store.remove(req.params.id, userOf(req)))) {
        return res.status(404).json({ message: 'Font not found' });
      }
      log('deleted', { fontId: req.params.id, userId: userOf(req) });
      res.status(204).end();
    }),

    /**
     * PUBLIC: GET /api/overlay-fonts/file/:id — the font bytes. A font never
     * changes once stored (a re-upload is a new id), so it is cached forever.
     */
    file: wrap(async (req, res) => {
      if (!OBJECT_ID_RE.test(req.params.id || '')) return res.status(404).json({ message: 'Font not found' });
      const font = await store.getFile(req.params.id);
      if (!font) return res.status(404).json({ message: 'Font not found' });
      res.set('Content-Type', 'font/woff2');
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.removeHeader('Pragma');
      res.removeHeader('Expires');
      res.send(font.data);
    }),
  };
}

/** Body-parser failures on the upload route (too large) as JSON, not Express's HTML error page. */
function uploadErrorHandler(err, req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ message: 'Font is larger than 2 MB' });
  next(err);
}

module.exports = { createOverlayFontController, uploadErrorHandler, isWoff2, MAX_FONT_BYTES, MAX_FONTS_PER_USER, FAMILY_RE, RESERVED_FAMILIES };

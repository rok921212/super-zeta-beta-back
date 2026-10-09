// Designer image library API.
//
// Rules this file enforces:
//   - PNG, JPEG, WebP and SVG only, decided by the bytes (utils/imageInfo.js),
//     never by the file name or the Content-Type the client claims.
//   - An SVG is checked, not cleaned: one that could run code or load an
//     outside file is refused. It is also served under a sandboxing CSP, so
//     opening the file URL directly cannot run anything either.
//   - Identity comes from the verified JWT (req.session.userId) only. Another
//     user's image is a 404 on rename / delete.
//   - The file routes are public: an <img> request cannot carry a Bearer
//     token, and the published overlay runs logged-out inside OBS.
//   - An image a design still uses is not deleted: a published revision that
//     refers to it must keep rendering.

const crypto = require('crypto');
const { sendConditionalJson } = require('../utils/conditionalJson.js');
const { imageInfo } = require('../utils/imageInfo.js');

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_THUMB_BYTES = 64 * 1024;
const MAX_ASSET_SIDE = 8192;
const MAX_ASSETS_PER_USER = 150;
/** Everything one account may store. The overlay cluster is small: this keeps one account from filling it. */
const MAX_ACCOUNT_BYTES = 60 * 1024 * 1024;
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/octet-stream'];

const log = (event, fields = {}) =>
  console.log(JSON.stringify({ scope: 'overlay-assets', event, ...fields }));

/** Same mapping as overlayLayout.controller.js: the Atlas shared-tier collection cap. */
function isCollectionLimitError(err) {
  if (!err) return false;
  if (err.code === 8000 || err.code === 14031) return /collection/i.test(String(err.message)) || err.code === 14031;
  return /cannot create a new collection|collections? of \d+|too many collections/i.test(String(err.message));
}

/** "team logo (final).PNG" -> "team logo (final)": a display name, never a path. */
function cleanName(raw) {
  const base = String(raw || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[\u0000-\u001f<>"'`\\/]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.slice(0, 120) || 'Image';
}

const toInfo = (a) => ({
  _id: String(a._id), name: a.name, mime: a.mime, size: a.size, width: a.width, height: a.height, hasThumb: !!a.hasThumb, createdAt: a.createdAt,
});

/**
 * `layoutStore` answers "is this image still used?" (assetUsage). `available`
 * is false when the overlay database is not configured: the library then
 * refuses to work instead of creating its collection anywhere else.
 */
function createOverlayAssetController(store, { layoutStore = null, available = () => true } = {}) {
  const userOf = (req) => String(req.session.userId);

  const wrap = (fn) => async (req, res) => {
    try {
      if (!available()) return res.status(503).json({ message: 'The overlay database is not configured on this server — images are unavailable', code: 'OVERLAY_DB_MISSING' });
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

  const sendBytes = (res, file) => {
    res.set('Content-Type', file.mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    // Opened on its own, an SVG is a document: no scripts, no outside loads, no same-origin access.
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.removeHeader('Pragma');
    res.removeHeader('Expires');
    res.send(file.data);
  };

  return {
    list: wrap(async (req, res) => {
      const items = (await store.list(userOf(req))).map(toInfo);
      sendConditionalJson(req, res, items);
    }),

    upload: wrap(async (req, res) => {
      const data = req.body;
      if (!Buffer.isBuffer(data) || !data.length) return res.status(400).json({ message: 'Only PNG, JPEG, WebP and SVG images are supported' });
      if (data.length > MAX_ASSET_BYTES) return res.status(413).json({ message: 'Image is larger than 4 MB' });
      const info = imageInfo(data);
      if (!info) return res.status(400).json({ message: 'Only PNG, JPEG, WebP and SVG images are supported' });
      if (info.problem) return res.status(400).json({ message: `This SVG cannot be used: ${info.problem}` });
      if (info.mime !== 'image/svg+xml' && (!info.width || !info.height)) return res.status(400).json({ message: 'The image file is damaged (no size in its header)' });
      if (info.width > MAX_ASSET_SIDE || info.height > MAX_ASSET_SIDE) {
        return res.status(413).json({ message: `Image is ${info.width}×${info.height} — the largest side allowed is ${MAX_ASSET_SIDE} px` });
      }

      const ownerId = userOf(req);
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      // The same file again is the same asset (200, not a second copy).
      const existing = await store.findByHash(ownerId, hash);
      if (existing) return res.status(200).json({ ...toInfo(existing), duplicate: true });

      const usage = await store.usage(ownerId);
      if (usage.count >= MAX_ASSETS_PER_USER) return res.status(409).json({ message: `Image limit reached (${MAX_ASSETS_PER_USER}) — delete one first` });
      if (usage.bytes + data.length > MAX_ACCOUNT_BYTES) return res.status(409).json({ message: 'Your image library is full (60 MB) — delete some images first' });

      let asset;
      try {
        asset = await store.create({ ownerId, name: cleanName(req.query.name), mime: info.mime, size: data.length, width: info.width, height: info.height, hash, data });
      } catch (err) {
        if (err && err.code === 11000) {
          const again = await store.findByHash(ownerId, hash);
          if (again) return res.status(200).json({ ...toInfo(again), duplicate: true });
        }
        throw err;
      }
      log('uploaded', { assetId: asset._id, userId: ownerId, bytes: data.length, mime: info.mime });
      res.status(201).json(toInfo(asset));
    }),

    /** A small preview the browser drew (PNG / JPEG / WebP only — never SVG). */
    setThumb: wrap(async (req, res) => {
      if (!OBJECT_ID_RE.test(req.params.id || '')) return res.status(404).json({ message: 'Image not found' });
      const data = req.body;
      if (!Buffer.isBuffer(data) || !data.length) return res.status(400).json({ message: 'Thumbnail must be a PNG, JPEG or WebP image' });
      if (data.length > MAX_THUMB_BYTES) return res.status(413).json({ message: 'Thumbnail is larger than 64 KB' });
      const info = imageInfo(data);
      if (!info || info.mime === 'image/svg+xml' || info.width > 512 || info.height > 512) return res.status(400).json({ message: 'Thumbnail must be a PNG, JPEG or WebP image up to 512 px' });
      const updated = await store.setThumb(req.params.id, userOf(req), data, info.mime);
      if (!updated) return res.status(404).json({ message: 'Image not found' });
      res.json(toInfo(updated));
    }),

    rename: wrap(async (req, res) => {
      if (!OBJECT_ID_RE.test(req.params.id || '')) return res.status(404).json({ message: 'Image not found' });
      const name = req.body && typeof req.body.name === 'string' ? cleanName(req.body.name) : '';
      if (!name || !String(req.body.name).trim()) return res.status(400).json({ message: 'Name must be 1-120 characters' });
      const updated = await store.rename(req.params.id, userOf(req), name);
      if (!updated) return res.status(404).json({ message: 'Image not found' });
      res.json(toInfo(updated));
    }),

    remove: wrap(async (req, res) => {
      const id = req.params.id || '';
      const ownerId = userOf(req);
      if (!OBJECT_ID_RE.test(id) || !(await store.ownedIds(ownerId, [id])).length) return res.status(404).json({ message: 'Image not found' });
      if (layoutStore && layoutStore.assetUsage) {
        const used = await layoutStore.assetUsage(ownerId, id);
        // A published revision is immutable and public: its pictures are never pulled out from under it.
        if (used.published > 0) {
          return res.status(409).json({ message: `This image is on air: ${used.published} published revision${used.published === 1 ? '' : 's'} use it. Delete or republish those designs first.`, usedBy: used, code: 'ASSET_PUBLISHED' });
        }
        if (used.drafts > 0 && req.query.force !== '1') {
          return res.status(409).json({ message: `This image is used by ${used.drafts} design${used.drafts === 1 ? '' : 's'}.`, usedBy: used, code: 'ASSET_IN_USE' });
        }
      }
      await store.remove(id, ownerId);
      log('deleted', { assetId: id, userId: ownerId });
      res.status(204).end();
    }),

    /** PUBLIC: GET /api/overlay-assets/file/:id — the image bytes. Never changes once stored. */
    file: wrap(async (req, res) => {
      if (!OBJECT_ID_RE.test(req.params.id || '')) return res.status(404).json({ message: 'Image not found' });
      const file = await store.getFile(req.params.id);
      if (!file) return res.status(404).json({ message: 'Image not found' });
      sendBytes(res, file);
    }),

    /** PUBLIC: the small preview; falls back to the image itself when none was stored. */
    thumb: wrap(async (req, res) => {
      if (!OBJECT_ID_RE.test(req.params.id || '')) return res.status(404).json({ message: 'Image not found' });
      const file = (await store.getThumb(req.params.id)) || (await store.getFile(req.params.id));
      if (!file) return res.status(404).json({ message: 'Image not found' });
      sendBytes(res, file);
    }),
  };
}

/** Body-parser failures on the upload routes (too large) as JSON, not Express's HTML error page. */
function uploadErrorHandler(err, req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ message: 'Image is larger than 4 MB' });
  next(err);
}

module.exports = {
  createOverlayAssetController, uploadErrorHandler, cleanName,
  MAX_ASSET_BYTES, MAX_THUMB_BYTES, MAX_ASSET_SIDE, MAX_ASSETS_PER_USER, MAX_ACCOUNT_BYTES, UPLOAD_TYPES,
};

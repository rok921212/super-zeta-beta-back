const express = require('express');
const requireAuth = require('../authMiddleware.js');
const {
  createOverlayAssetController, uploadErrorHandler, MAX_ASSET_BYTES, MAX_THUMB_BYTES, UPLOAD_TYPES,
} = require('../controller/overlayAsset.controller.js');

/**
 * Designer image library -> /api/overlay-assets.
 *   GET /file/:id, /thumb/:id   public (an <img> request carries no JWT)
 *   everything else owner-scoped, JWT required
 * `assetStore` / `auth` are injectable for tests (services/overlayAssetStore.js).
 */
function createOverlayAssetRouter({ assetStore, layoutStore = null, auth = requireAuth, available }) {
  const c = createOverlayAssetController(assetStore, { layoutStore, available });
  const router = express.Router();
  router.get('/file/:id', c.file);
  router.get('/thumb/:id', c.thumb);
  router.use(auth);
  router.get('/', c.list);
  // The body IS the image: raw bytes, parsed only for these routes.
  router.post('/', express.raw({ type: UPLOAD_TYPES, limit: MAX_ASSET_BYTES }), c.upload);
  router.put('/:id/thumb', express.raw({ type: UPLOAD_TYPES, limit: MAX_THUMB_BYTES }), c.setThumb);
  router.patch('/:id', c.rename);
  router.delete('/:id', c.remove);
  router.use(uploadErrorHandler);
  return router;
}

module.exports = { createOverlayAssetRouter };

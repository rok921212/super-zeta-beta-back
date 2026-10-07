const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { createOverlayFontController, uploadErrorHandler, MAX_FONT_BYTES } = require('../controller/overlayFont.controller.js');

/**
 * Designer font library -> /api/overlay-fonts.
 *   GET /file/:id   public (an @font-face request carries no JWT)
 *   everything else owner-scoped, JWT required
 * `fontStore` / `auth` are injectable for tests (services/overlayFontStore.js).
 */
function createOverlayFontRouter({ fontStore, auth = requireAuth }) {
  const c = createOverlayFontController(fontStore);
  const router = express.Router();
  router.get('/file/:id', c.file);
  router.use(auth);
  router.get('/', c.list);
  // The body IS the font: raw bytes, parsed only for this route and only for font/woff2.
  router.post('/', express.raw({ type: 'font/woff2', limit: MAX_FONT_BYTES }), c.upload);
  router.delete('/:id', c.remove);
  router.use(uploadErrorHandler);
  return router;
}

module.exports = { createOverlayFontRouter };

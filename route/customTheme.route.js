const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { createCustomThemeController } = require('../controller/customTheme.controller.js');
const { createThemePackController, importErrorHandler } = require('../controller/themePack.controller.js');
const { MAX_PACK_BYTES } = require('../services/themePack.js');

/**
 * Custom themes (Theme9+) -> /api/custom-themes (owner-scoped, JWT required).
 * `themeStore` / `layoutStore` / `fontStore` / `auth` are injectable for tests.
 */
function createCustomThemeRouter({ themeStore, layoutStore, fontStore = null, assetStore = null, auth = requireAuth }) {
  const c = createCustomThemeController({ themeStore, layoutStore });
  const packs = createThemePackController({ layoutStore, themeStore, fontStore, assetStore });
  const router = express.Router();
  router.use(auth);
  router.get('/', c.list);
  router.post('/', c.create);
  // The body IS the .sstheme file: raw bytes, parsed only for this route.
  router.post('/import', express.raw({ type: 'application/octet-stream', limit: MAX_PACK_BYTES }), packs.importPack);
  router.get('/:id/export', packs.exportTheme);
  router.patch('/:id', c.rename);
  router.delete('/:id', c.remove);
  router.put('/:id/slots/:viewKey', c.setSlot);
  router.use(importErrorHandler);
  return router;
}

module.exports = { createCustomThemeRouter };

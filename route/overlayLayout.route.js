const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { createOverlayLayoutController } = require('../controller/overlayLayout.controller.js');
const { createThemePackController, importErrorHandler } = require('../controller/themePack.controller.js');
const { MAX_PACKAGE_BYTES } = require('../services/overlayPackage.js');
const { createMongoStore } = require('../services/overlayLayoutStore.js');

/**
 * Designer layouts. Two routers:
 *   layouts -> /api/overlay-layouts    (owner-scoped, JWT required)
 *   render  -> /api/overlay-render     (public, published revisions only)
 * `store` / `auth` are injectable for tests (services/overlayLayoutStore.js).
 */
function createOverlayLayoutRouters({ store = createMongoStore(), auth = requireAuth, themeStore = null, fontStore = null, assetStore = null, categoryStore = null } = {}) {
  const c = createOverlayLayoutController(store, { themeStore, fontStore, assetStore, categoryStore });
  const packs = createThemePackController({ layoutStore: store, themeStore, fontStore, assetStore });

  const layouts = express.Router();
  layouts.use(auth);
  layouts.get('/', c.list);
  layouts.post('/', c.create);
  // The body IS the overlay package (.zip): raw bytes, parsed only for this route.
  layouts.post('/import-package', express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: MAX_PACKAGE_BYTES }), packs.importPackage);
  layouts.get('/:id', c.get);
  layouts.put('/:id', c.update);
  layouts.patch('/:id/meta', c.patchMeta);
  layouts.delete('/:id', c.remove);
  layouts.post('/:id/publish', c.publish);
  layouts.get('/:id/revisions', c.revisions);
  layouts.post('/:id/revisions/:rev/restore', c.restore);
  layouts.post('/:id/duplicate', c.duplicate);
  // The layout as a .sstheme file another account can import (controller/themePack.controller.js).
  layouts.get('/:id/export', packs.exportLayout);
  layouts.get('/:id/export-package', packs.exportPackage);
  layouts.post('/:id/lock', c.setLock(true));
  layouts.post('/:id/unlock', c.setLock(false));
  layouts.use(importErrorHandler);

  const render = express.Router();
  render.get('/:publicId', c.render);

  return { layouts, render };
}

module.exports = { createOverlayLayoutRouters };

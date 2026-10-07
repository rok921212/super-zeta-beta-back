const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { createOverlayLayoutController } = require('../controller/overlayLayout.controller.js');
const { createThemePackController } = require('../controller/themePack.controller.js');
const { createMongoStore } = require('../services/overlayLayoutStore.js');

/**
 * Designer layouts. Two routers:
 *   layouts -> /api/overlay-layouts    (owner-scoped, JWT required)
 *   render  -> /api/overlay-render     (public, published revisions only)
 * `store` / `auth` are injectable for tests (services/overlayLayoutStore.js).
 */
function createOverlayLayoutRouters({ store = createMongoStore(), auth = requireAuth, themeStore = null, fontStore = null } = {}) {
  const c = createOverlayLayoutController(store, { themeStore, fontStore });
  const packs = createThemePackController({ layoutStore: store, themeStore, fontStore });

  const layouts = express.Router();
  layouts.use(auth);
  layouts.get('/', c.list);
  layouts.post('/', c.create);
  layouts.get('/:id', c.get);
  layouts.put('/:id', c.update);
  layouts.delete('/:id', c.remove);
  layouts.post('/:id/publish', c.publish);
  layouts.get('/:id/revisions', c.revisions);
  layouts.post('/:id/revisions/:rev/restore', c.restore);
  layouts.post('/:id/duplicate', c.duplicate);
  // The layout as a .sstheme file another account can import (controller/themePack.controller.js).
  layouts.get('/:id/export', packs.exportLayout);
  layouts.post('/:id/lock', c.setLock(true));
  layouts.post('/:id/unlock', c.setLock(false));

  const render = express.Router();
  render.get('/:publicId', c.render);

  return { layouts, render };
}

module.exports = { createOverlayLayoutRouters };

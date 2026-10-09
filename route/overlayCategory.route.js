const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { createOverlayCategoryController } = require('../controller/overlayCategory.controller.js');

/**
 * Design categories -> /api/overlay-categories (owner-scoped, JWT required).
 * `categoryStore` / `auth` are injectable for tests (services/overlayCategoryStore.js).
 */
function createOverlayCategoryRouter({ categoryStore, layoutStore = null, auth = requireAuth, available }) {
  const c = createOverlayCategoryController(categoryStore, { layoutStore, available });
  const router = express.Router();
  router.use(auth);
  router.get('/', c.list);
  router.post('/', c.create);
  router.patch('/:id', c.rename);
  router.delete('/:id', c.remove);
  return router;
}

module.exports = { createOverlayCategoryRouter };

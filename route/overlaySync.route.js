const express = require('express');
const overlaySyncController = require('../controller/overlaySync.controller.js');
const requireAuth = require('../authMiddleware.js');

// Operator side — mounted at /api/overlay-sync.
const router = express.Router();
router.get('/', requireAuth, overlaySyncController.getOverlaySync);
router.put('/', requireAuth, overlaySyncController.setOverlaySync);
router.delete('/', requireAuth, overlaySyncController.clearOverlaySync);
router.post('/page', requireAuth, overlaySyncController.sendOverlayPage);

// Overlay side — mounted at /api/public, so it rides the local relay's public
// proxy like /api/public/bulk does.
const publicRouter = express.Router();
publicRouter.get('/overlay-sync/key/:key', overlaySyncController.resolveOverlaySyncByKey);
publicRouter.get('/overlay-sync/:tournamentId', overlaySyncController.resolveOverlaySync);

module.exports = { router, publicRouter };

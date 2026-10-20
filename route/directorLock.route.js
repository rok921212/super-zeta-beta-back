const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { createDirectorLockService, createMongoLockStore, send } = require('../services/directorLock.js');

/**
 * The Director lock (services/directorLock.js).
 *   /api/director-lock          the signed-in account's own lock (JWT)
 *     GET    state
 *     POST   /lock    { password }
 *     POST   /unlock  { password }
 *   admin handlers, mounted by route/adminPanel.route.js behind requireAdmin:
 *     GET    /api/admin-panel/users/:id/director-lock
 *     PUT    /api/admin-panel/users/:id/director-lock        { password, confirm }
 *     POST   /api/admin-panel/users/:id/director-lock/reset
 *     PUT    /api/admin-panel/users/:id/director-lock/scope  { director?, designer? }
 */
function createDirectorLockRouter({ service, auth = requireAuth }) {
  const router = express.Router();
  router.use(auth);
  const ip = (req) => req.ip || req.socket?.remoteAddress || '';
  router.get('/', send((req) => service.state(req.session.userId)));
  router.post('/lock', send((req) => service.lock(req.session.userId, ip(req), req.body?.password)));
  router.post('/unlock', send((req) => service.unlock(req.session.userId, ip(req), req.body?.password)));
  return router;
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function createDirectorLockAdminHandlers(service) {
  const target = (req) => {
    if (!OBJECT_ID_RE.test(req.params.id || '')) {
      const { LockError } = require('../services/directorLock.js');
      throw new LockError(400, 'Bad user id');
    }
    return req.params.id;
  };
  return {
    get: send((req) => service.state(target(req))),
    set: send((req) => service.setCredential(String(req.session.userId), target(req), req.body?.password, req.body?.confirm)),
    reset: send((req) => service.reset(String(req.session.userId), target(req))),
    scope: send((req) => service.setScope(String(req.session.userId), target(req), req.body)),
  };
}

/** The app's one service: User model, hub-room emit, audit on the overlay cluster. */
let defaultService = null;
function getDirectorLockService() {
  if (defaultService) return defaultService;
  const User = require('../models/User.model.js');
  const { getOverlayConnection, overlayDbState } = require('../db/overlayConnection.js');
  defaultService = createDirectorLockService({
    store: createMongoLockStore(User),
    emit: (userId, state) => {
      require('../middleware/requireDesignerUnlocked.js').forget(userId);
      try {
        require('../socket.js').getSocket().to(`user:${userId}`).emit('directorLockChanged', state);
      } catch (err) {
        console.warn('[director-lock] could not tell the desktops:', err.message);
      }
    },
    audit: async (entry) => {
      console.log(`[director-lock] ${entry.action} on ${entry.targetUserId} by admin ${entry.adminId}`);
      // Only on the dedicated overlay cluster: a new collection on the main
      // cluster would hit its collection cap.
      if (!overlayDbState().dedicated) return;
      try {
        await require('../models/adminAudit.model.js').modelFor(getOverlayConnection()).create(entry);
      } catch (err) {
        console.warn('[director-lock] audit write failed:', err.message);
      }
    },
  });
  return defaultService;
}

module.exports = { createDirectorLockRouter, createDirectorLockAdminHandlers, getDirectorLockService };

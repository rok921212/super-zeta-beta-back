const express = require('express');
const requireAuth = require('../authMiddleware.js');
const { send, LockError } = require('../services/directorLock.js');
const { createDirectorSettingsService, createMongoSettingsStore } = require('../services/directorSettings.js');

/**
 * Admin-managed Director settings (services/directorSettings.js).
 *   /api/director-settings              the signed-in account's own (JWT), for its desktops
 *     GET    state
 *     POST   /decisions  { decisions: [...] }   recent switch decisions (memory only)
 *   admin handlers, mounted by route/adminPanel.route.js behind requireAdmin:
 *     GET    /api/admin-panel/users/:id/director-settings
 *     PUT    /api/admin-panel/users/:id/director-settings        { config, allowAutoSwitch }
 *     POST   /api/admin-panel/users/:id/director-settings/reset
 */

/** A desktop reports at most this often (it batches every 15 s). */
const REPORT_MIN_GAP_MS = 3000;

function createDirectorSettingsRouter({ service, auth = requireAuth, now = () => Date.now() }) {
  const router = express.Router();
  router.use(auth);
  const lastReport = new Map();
  router.get('/', send((req) => service.state(req.session.userId)));
  router.post('/decisions', send(async (req) => {
    const key = String(req.session.userId);
    const t = now();
    if (t - (lastReport.get(key) || 0) < REPORT_MIN_GAP_MS) throw new LockError(429, 'Too many reports');
    lastReport.set(key, t);
    if (lastReport.size > 10000) lastReport.clear();
    return service.report(key, req.body?.decisions);
  }));
  return router;
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function createDirectorSettingsAdminHandlers(service) {
  const target = (req) => {
    if (!OBJECT_ID_RE.test(req.params.id || '')) throw new LockError(400, 'Bad user id');
    return req.params.id;
  };
  return {
    get: send((req) => service.adminState(target(req))),
    set: send((req) => service.set(String(req.session.userId), target(req), req.body)),
    reset: send((req) => service.reset(String(req.session.userId), target(req))),
  };
}

let defaultService = null;
function getDirectorSettingsService() {
  if (defaultService) return defaultService;
  const User = require('../models/User.model.js');
  const { getOverlayConnection, overlayDbState } = require('../db/overlayConnection.js');
  defaultService = createDirectorSettingsService({
    store: createMongoSettingsStore(User),
    emit: (userId, state) => {
      try {
        require('../socket.js').getSocket().to(`user:${userId}`).emit('directorSettingsChanged', state);
      } catch (err) {
        console.warn('[director-settings] could not tell the desktops:', err.message);
      }
    },
    audit: async (entry) => {
      console.log(`[director-settings] ${entry.action} on ${entry.targetUserId} by admin ${entry.adminId}`);
      if (!overlayDbState().dedicated) return; // never a new collection on the main cluster (collection cap)
      try {
        await require('../models/adminAudit.model.js').modelFor(getOverlayConnection()).create(entry);
      } catch (err) {
        console.warn('[director-settings] audit write failed:', err.message);
      }
    },
  });
  return defaultService;
}

module.exports = { createDirectorSettingsRouter, createDirectorSettingsAdminHandlers, getDirectorSettingsService };

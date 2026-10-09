const express = require('express');
const router = express.Router();

const requireAdmin = require('../middleware/requireAdmin.js');
const { cacheMiddleware, invalidateCacheMiddleware } = require('../middleware/cache.js');
const adminPanel = require('../controller/adminPanel.controller.js');

// Existing controllers — reused as-is so their authorization + cache
// behaviour is unchanged. Nothing in these files is modified.
const {
  updateUser,
  deleteUser,
  getAllUsers,
} = require('../controller/User.controller.js');
const roundController = require('../controller/round.controller.js');
const tournamentController = require('../controller/tournament.controller.js');

// ─────────────────────────────────────────────────────────────────────────
//  The ONLY gate: the existing admin authentication.
//  requireAdmin -> req.session.userId (from index.js's Bearer-JWT shim)
//               -> User.findById(...).isAdmin === true
//  The secret URL that leads here is a frontend-only convenience and is NOT
//  re-checked or trusted on the server.
// ─────────────────────────────────────────────────────────────────────────
router.use(requireAdmin);

router.get('/me', adminPanel.me);

// Per-socket / per-event WebSocket egress since boot (utils/wsAccounting.js).
router.get('/ws-bandwidth', (req, res) => res.json(require('../utils/wsAccounting').report()));

// Egress per account since the last reset (utils/bwByUser.js): HTTP, WebSocket and cache writes.
router.get('/bandwidth', adminPanel.bandwidth);
router.post('/bandwidth/reset', adminPanel.bandwidthReset);

// MongoDB storage used / left per cluster (services/dbStorage.js). ?fresh=1 skips the 60s memo.
router.get('/storage', adminPanel.storage);

// ── Default team logo / player photo / team flag ───────────────────────
router.get('/team-defaults', adminPanel.getTeamDefaults);
router.put('/team-defaults', adminPanel.updateTeamDefaults);
router.post('/team-defaults/apply', invalidateCacheMiddleware(['cache:/api/teams', 'cache:/api/matches', 'cache:/api/groups']), adminPanel.applyTeamDefaults);

// ── Cross-user overview (read-only) ────────────────────────────────────
router.get('/overview', adminPanel.overview);                        // every user + totals + last login + active API round
router.get('/users/:id/activity', adminPanel.userActivity);          // one user's tournament -> round -> match-count tree

// ── User management ────────────────────────────────────────────────────
router.get('/users', getAllUsers);                                   // existing controller
router.post('/users', adminPanel.createUser);                        // normal / sub-admin / admin user
router.put('/users/:id/access', adminPanel.setUserAccess);           // isSubAdmin + maxMatches only (NOT isAdmin)
router.put('/users/:id', adminPanel.guardSelfDemote, updateUser);    // update / change password / grant-revoke admin
router.delete('/users/:id', adminPanel.guardSelfDelete, deleteUser); // existing controller

// ── Tournament & round management ──────────────────────────────────────
// Delegated to the existing controllers WITH the existing cache middlewares,
// so cache invalidation works exactly as it does for /api/tournaments and
// /api/... rounds. Scope note: the round/tournament controllers filter by
// createdBy/userId === req.session.userId, so these operate on the signed-in
// admin's own tournaments (same as the dashboard). GET /rounds/all is an
// optional read-only cross-user view.
router.get('/tournaments', cacheMiddleware(), tournamentController.getTournaments);
router.get('/tournaments/:id', cacheMiddleware(), tournamentController.getTournamentById);

router.get('/rounds', cacheMiddleware(), roundController.getAllRounds);
router.get('/rounds/all', adminPanel.listAllRounds);

router.get('/tournaments/:tournamentId/rounds', cacheMiddleware(), roundController.getRoundsByTournamentId);
router.get('/tournaments/:tournamentId/rounds/:id', cacheMiddleware(), roundController.getRoundById);
router.post('/tournaments/:tournamentId/rounds', invalidateCacheMiddleware(), roundController.createRoundInTournament);
router.put('/tournaments/:tournamentId/rounds/:id', invalidateCacheMiddleware(), roundController.updateRound);
router.delete('/tournaments/:tournamentId/rounds/:id', invalidateCacheMiddleware(), roundController.deleteRound);

module.exports = router;

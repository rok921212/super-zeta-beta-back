const express = require('express');
const router = express.Router();
const { getBulkData } = require('../controller/Bulkpublic.controller');
const { msgpackCacheMiddleware } = require('../middleware/cache.js');

/**
 * GET /api/public/bulk/:tournamentId/:roundId/:matchId?
 *
 * Query params:
 *   view            - optional. If set, only fetches the data that view needs
 *                      (same rules PublicThemeRenderer.tsx uses). Omit to get everything.
 *   followSelected  - "true" | "false". If true, matchId is resolved from the
 *                      currently-selected match instead of the URL param.
 *   includeAll      - "true" | "false". Force-fetch everything regardless of `view`.
 *
 * Example:
 *   /api/public/bulk/64f.../64f2.../64f3...?view=Upper
 *   /api/public/bulk/64f.../64f2...?followSelected=true   (no matchId needed)
 */
// Bandwidth: TTL raised 3s -> 20s. Every OBS overlay source polls this on
// mount, on a 10-min timer, and on every socket reconnect; a 3s TTL meant
// each burst re-ran the full Mongo aggregation AND wrote a fresh Upstash
// REST entry (SET + SADD + EXPIRE) — that write traffic is billed
// service-initiated. The live match/overall slices in this payload are only
// a mount/reconnect seed anyway (the socket delta stream + joinRoundRoom
// hydration correct them within ~2s), and a manual dashboard edit still
// clears this key immediately via invalidateScope('round:<tid>:<rid>').
router.get(
  '/bulk/:tournamentId/:roundId/:matchId',
  msgpackCacheMiddleware(20, req => `round:${req.params.tournamentId}:${req.params.roundId}`),
  getBulkData
);

module.exports = router;
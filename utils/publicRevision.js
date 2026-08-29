// Authoritative public-overlay revision.
//
// `Round.publicRev` is a durable, monotonically-increasing integer bumped
// ($inc, never reset) AFTER any successful mutation that can change what this
// round's public overlays get from GET /api/public/bulk/... — points/stat/
// roster edits, match select/deselect, structural changes, tournament-skin
// changes, etc. It survives a server restart, so the local overlay relay's
// cache can trust it across a Render redeploy (an in-process counter would
// reset to 0 and leave the relay permanently "ahead").
//
// On every bump this module also:
//   - clears the backend's own /bulk + /overall Redis cache for the round
//     (invalidateScope, which also rolls that scope's ETag epoch), and
//   - emits a tiny `publicDataInvalidated` event into
//     round:<tid>:<rid>:control — a room the local relay's anonymous upstream
//     socket already joins — so the relay invalidates the exact affected cache
//     entries immediately instead of waiting for TTL.
//
// Call sites pass `getSocket()` as `io`. Every function swallows its own
// errors and never rejects — callers invoke it fire-and-forget AFTER their DB
// write has succeeded.

const Round = require('../models/round.model');
const { invalidateScope } = require('../middleware/cache');

// Small in-process cache of the latest known publicRev per round, so a hot path
// (the relay's periodic joinRoundRoom re-hydrate) can read a baseline without a
// Mongo round-trip. A miss falls back to a real read — so it always reports the
// durable value, even right after a restart.
const publicRevByRound = new Map(); // "<roundId>" -> number

async function getPublicRev(roundId) {
  const key = String(roundId);
  if (publicRevByRound.has(key)) return publicRevByRound.get(key);
  try {
    const doc = await Round.findById(roundId).select('publicRev').lean();
    const rev = doc?.publicRev ?? 0;
    publicRevByRound.set(key, rev);
    return rev;
  } catch {
    return 0;
  }
}

function emitInvalidated(io, { tournamentId, roundId, matchId, scope, rev, reason }) {
  if (!io) return;
  try {
    io.to(`round:${tournamentId}:${roundId}:control`).emit('publicDataInvalidated', {
      tournamentId: String(tournamentId),
      roundId: String(roundId),
      matchId: matchId ? String(matchId) : null,
      scope,
      rev,
      reason: reason || 'mutation',
    });
    console.log(`[bw][rev] publicDataInvalidated -> round:${tournamentId}:${roundId}:control scope=${scope} rev=${rev} reason=${reason}`);
  } catch (err) {
    console.warn('[bw][rev] emit skipped:', err.message);
  }
}

/**
 * Bump one round's publicRev and announce it.
 * @param io  result of getSocket() (may be null — the $inc + cache bust still run)
 * @param {{tournamentId:string, roundId:string, matchId?:string, reason:string, scope?:'match'|'round'|'exact'}} p
 * @returns {Promise<number|null>} the new publicRev, or null if the round is gone
 */
async function bumpRound(io, { tournamentId, roundId, matchId = null, reason, scope } = {}) {
  if (!roundId) return null;
  try {
    const round = await Round.findByIdAndUpdate(
      roundId,
      { $inc: { publicRev: 1 } },
      { new: true, projection: { publicRev: 1, tournamentId: 1 } },
    ).lean();
    if (!round) return null;

    const tid = tournamentId || round.tournamentId;
    publicRevByRound.set(String(roundId), round.publicRev);

    try {
      await invalidateScope(`round:${tid}:${roundId}`);
    } catch (err) {
      console.warn('[bw][rev] invalidateScope failed:', err.message);
    }

    emitInvalidated(io, {
      tournamentId: tid,
      roundId,
      matchId,
      scope: scope || (matchId ? 'match' : 'round'),
      rev: round.publicRev,
      reason,
    });
    return round.publicRev;
  } catch (err) {
    console.warn('[bw][rev] bumpRound failed:', err.message);
    return null;
  }
}

/**
 * Bump every round of a tournament — for a tournament-level change (theme
 * colours / logo / bg, or a delete) that affects every round's overlays.
 * @param io  result of getSocket()
 * @param {{tournamentId:string, reason:string}} p
 */
async function bumpTournament(io, { tournamentId, reason } = {}) {
  if (!tournamentId) return;
  try {
    await Round.updateMany({ tournamentId }, { $inc: { publicRev: 1 } });
    const rounds = await Round.find({ tournamentId }).select('_id publicRev').lean();
    for (const r of rounds) {
      publicRevByRound.set(String(r._id), r.publicRev);
      try {
        await invalidateScope(`round:${tournamentId}:${r._id}`);
      } catch (err) {
        console.warn('[bw][rev] invalidateScope failed:', err.message);
      }
      emitInvalidated(io, {
        tournamentId,
        roundId: r._id,
        matchId: null,
        scope: 'tournament',
        rev: r.publicRev,
        reason,
      });
    }
  } catch (err) {
    console.warn('[bw][rev] bumpTournament failed:', err.message);
  }
}

module.exports = { bumpRound, bumpTournament, getPublicRev, publicRevByRound };

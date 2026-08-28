// Structural change-signal for the public overlay
// (front/src/dashboard/PublicThemeRenderer.tsx).
//
// The socket tick path only pushes LIVE match/overall data. Structural
// fields — the matches list, which match is currently selected, per-match
// summaries, tournament/round metadata — are never pushed, so historically
// an OBS overlay learned of a structural change only by re-fetching
// /api/public/bulk on a blind 10-minute timer AND unconditionally on every
// socket reconnect, once per OBS Browser Source. That blind polling is a
// large chunk of the HTTP egress.
//
// This module lets the overlay drop it: on a real structural mutation
// (match created/updated/deleted, match selected/deselected, round updated)
// the server emits ONE tiny `roundStructureChanged` into
// `round:<tid>:<rid>:control` — a room every overlay for the round joins in
// joinRoundRoom regardless of its `view`, so even structural-only views
// (Lower, Schedule, intro, …) that join no live tier still get it. The
// overlay then does a single targeted refetch.
//
// `version` is Date.now() at the moment of the last change. It is advisory:
// the client only refetches when the number it receives is strictly greater
// than the one it last acted on. Using a wall-clock ms value (rather than a
// per-process counter) means it stays monotonic across a server restart in
// the normal case — a restart just loses this map, and the next
// joinRoundRoom then reports 0, which the client reads as "nothing newer
// than what I already hold" and does not refetch (a restart alone changes
// no tournament data). The next genuine structural change after a restart
// sets a fresh Date.now() that is still far greater than any value a client
// is holding, so change notifications resume working immediately.

const { getSocket } = require('../socket');

const versionByRound = new Map(); // "tid:rid" -> epoch ms of last structural change

const keyOf = (tournamentId, roundId) => `${tournamentId}:${roundId}`;

function getRoundStructureVersion(tournamentId, roundId) {
  return versionByRound.get(keyOf(String(tournamentId), String(roundId))) || 0;
}

// Call after any mutation that changes a round's structural shape. Accepts
// raw id strings or ObjectIds. No-op (bump only, no emit) if Socket.IO is
// somehow not initialized yet — the bump still counts for the next join.
function notifyRoundStructureChanged(tournamentId, roundId) {
  if (!tournamentId || !roundId) return;
  const tid = String(tournamentId);
  const rid = String(roundId);
  const version = Date.now();
  versionByRound.set(keyOf(tid, rid), version);
  try {
    getSocket()
      .to(`round:${tid}:${rid}:control`)
      .emit('roundStructureChanged', { tournamentId: tid, roundId: rid, version });
    console.log(`[bw][structure] roundStructureChanged -> round:${tid}:${rid}:control version=${version}`);
  } catch (err) {
    console.warn('[bw][structure] notify skipped (socket not ready):', err.message);
  }
}

module.exports = { notifyRoundStructureChanged, getRoundStructureVersion };

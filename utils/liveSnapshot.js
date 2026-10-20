// How a full roster snapshot from the desktop relay replaces the per-user
// live player map (pubgApiMatchData.controller.js, totalPlayerList handler).
//
// PCOB drops dead players from its list. The relay keeps them in its own
// accumulated roster, but that roster starts empty when the desktop app
// restarts, so the first full snapshot after a restart can lack every player
// who already died. Replacing the map with it made those players vanish; a
// team with no players left was then no longer "all dead" and came back as
// alive on every overlay.
//
// Rule: a full snapshot of the SAME game keeps the dead players it lacks. Any
// sign of a different game (no player in common, a kill count gone down, a
// dead player alive again) replaces the map outright, as before.

const isDeadPlayer = (p) => p?.bHasDied === true || Number(p?.liveState) === 5;

/** Whether `incoming` (array) continues the game held in `prev` (Map uid → player). */
function isSameGame(prev, incoming, keyOf) {
  if (!prev || prev.size === 0 || !incoming.length) return false;
  let shared = 0;
  for (const p of incoming) {
    const uid = keyOf(p);
    if (uid == null) continue;
    const before = prev.get(uid);
    if (!before) continue;
    shared++;
    const k0 = Number(before.killNum);
    const k1 = Number(p.killNum);
    if (Number.isFinite(k0) && Number.isFinite(k1) && k1 < k0) return false;
    if (isDeadPlayer(before) && (p.bHasDied !== undefined || p.liveState !== undefined) && !isDeadPlayer(p)) return false;
  }
  return shared > 0;
}

/**
 * The player map after a full (non-stale) snapshot.
 * @returns {{ players: Map, sameGame: boolean, keptDead: number }}
 */
function applyFullSnapshot(prev, incoming, keyOf) {
  const sameGame = isSameGame(prev, incoming, keyOf);
  const players = new Map();
  for (const p of incoming) {
    const uid = keyOf(p);
    if (uid != null) players.set(uid, p);
  }
  let keptDead = 0;
  if (sameGame) {
    for (const [uid, p] of prev) {
      if (!players.has(uid) && isDeadPlayer(p)) {
        players.set(uid, p);
        keptDead++;
      }
    }
  }
  return { players, sameGame, keptDead };
}

module.exports = { isDeadPlayer, isSameGame, applyFullSnapshot };

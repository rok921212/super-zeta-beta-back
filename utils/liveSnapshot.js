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
//
// A snapshot the desktop marks `newMatch` (fetcher.rs, on its confirmed
// kill-count reset) always replaces the map. The guess alone was fooled at a
// match boundary: the first zero-kill tick arrives as a delta that resets the
// shared players' kills, so the next full snapshot looked like the same game
// and kept the old game's dead squads, on slots nobody plays this game.

const isDeadPlayer = (p) => p?.bHasDied === true || Number(p?.liveState) === 5;

// Player objects a full snapshot lacked and the same-game rule kept. Slot
// routing trusts the feed's slot for a player the game just reported, but not
// for one of these: it may be a previous game's squad (utils/slotRouting.js).
// A WeakSet so no extra field reaches payloads or hashes; a delta or a later
// snapshot builds a new object, which clears the mark.
const carriedOver = new WeakSet();

/** Whether the game has not reported this player since a snapshot kept it. */
const isCarriedOver = (p) => !!p && typeof p === 'object' && carriedOver.has(p);

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
 * @param {{ newMatch?: boolean }} [opts] newMatch: the desktop says this roster starts a new game.
 * @returns {{ players: Map, sameGame: boolean, keptDead: number }}
 */
function applyFullSnapshot(prev, incoming, keyOf, opts = {}) {
  const sameGame = !opts.newMatch && isSameGame(prev, incoming, keyOf);
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
        carriedOver.add(p);
        keptDead++;
      }
    }
  }
  return { players, sameGame, keptDead };
}

module.exports = { isDeadPlayer, isSameGame, applyFullSnapshot, isCarriedOver };

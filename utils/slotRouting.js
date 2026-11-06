/* --------------------------------------------------------------------
   Which live players go on a tournament team's slot.

   The live map keeps every player it has seen, so a slot number can hold
   more than this game's squad: last game's squad on a reused slot number
   (when the new-game reset was missed), or a second team that shares the
   slot (round-robin groups reuse numbers). Both used to fill the 4 places
   with dead players, read as an elimination, and hand that squad's rank to
   the team as place points ("ghost point").

   Rules:
   - a player on ANOTHER team's registered roster never goes on this slot;
   - this team's own roster players come first;
   - then newest-seen first (later in the live map = this game).
-------------------------------------------------------------------- */

/** uid -> team id whose registered roster lists it (first team wins). */
function buildRosterOwners(groupPlayersByTeam, normalizeId) {
  const owners = new Map();
  for (const [teamDbId, players] of groupPlayersByTeam) {
    for (const gp of players || []) {
      const uid = normalizeId(gp.playerId);
      if (uid && !owners.has(uid)) owners.set(uid, String(teamDbId));
    }
  }
  return owners;
}

/**
 * The slot's live players for one team, filtered and ordered.
 * `liveOrder` maps each player object to its index in the live map.
 */
function slotPlayersForTeam({ slotPlayers, ownTeamId, groupPlayers, rosterOwners, liveOrder, normalizeId, normalizeName }) {
  const own = String(ownTeamId);
  const ownNames = new Set(
    (groupPlayers || []).map(p => p.playerName && normalizeName(p.playerName)).filter(Boolean)
  );
  const isOwn = p => rosterOwners.get(normalizeId(p.uId)) === own
    || (!!p.playerName && ownNames.has(normalizeName(p.playerName)));
  return (slotPlayers || [])
    .filter(p => {
      const owner = rosterOwners.get(normalizeId(p.uId));
      return !owner || owner === own;
    })
    .sort((a, b) => (isOwn(b) - isOwn(a)) || ((liveOrder.get(b) ?? 0) - (liveOrder.get(a) ?? 0)));
}

module.exports = { buildRosterOwners, slotPlayersForTeam };

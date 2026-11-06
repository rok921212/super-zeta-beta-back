/* --------------------------------------------------------------------
   Which live players go on a tournament team's slot.

   The live map keeps every player it has seen, so a slot number can hold
   more than this game's squad: last game's squad on a reused slot number
   (when the new-game reset was missed), or a second team that shares the
   slot (round-robin groups reuse numbers). Both used to fill the 4 places
   with dead players, read as an elimination, and hand that squad's rank to
   the team as place points ("ghost point").

   Rosters also keep past players, so a lineup of borrowed players can be
   listed entirely on other teams. Dropping everyone on another roster left
   such a team with no players (MISS) and no place points, so the feed wins
   unless there is a reason not to trust it.

   Rules, for a player on ANOTHER team's registered roster:
   - that team shares this slot number: never on this slot;
   - also on this team's own roster: stays;
   - carried over from an earlier snapshot (the game has not reported them
     since, utils/liveSnapshot.js): never on this slot;
   - otherwise the game put them here this game: stays.

   Order: this team's own roster players first, then newest-seen first
   (later in the live map = this game).
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
 * `slotByTeamId` maps each team id (string) to its slot number.
 */
function slotPlayersForTeam({ slotPlayers, ownTeamId, groupPlayers, rosterOwners, slotByTeamId, isCarriedOver, liveOrder, normalizeId, normalizeName }) {
  const own = String(ownTeamId);
  const ownSlot = slotByTeamId.get(own);
  const ownUids = new Set((groupPlayers || []).map(p => normalizeId(p.playerId)).filter(Boolean));
  const ownNames = new Set(
    (groupPlayers || []).map(p => p.playerName && normalizeName(p.playerName)).filter(Boolean)
  );
  const isOwn = p => ownUids.has(normalizeId(p.uId))
    || (!!p.playerName && ownNames.has(normalizeName(p.playerName)));
  return (slotPlayers || [])
    .filter(p => {
      const owner = rosterOwners.get(normalizeId(p.uId));
      if (!owner || owner === own) return true;
      if (slotByTeamId.get(owner) === ownSlot) return false;
      return isOwn(p) || !isCarriedOver(p);
    })
    .sort((a, b) => (isOwn(b) - isOwn(a)) || ((liveOrder.get(b) ?? 0) - (liveOrder.get(a) ?? 0)));
}

module.exports = { buildRosterOwners, slotPlayersForTeam };

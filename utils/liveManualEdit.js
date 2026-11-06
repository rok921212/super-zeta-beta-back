// Applies an operator's manual correction to the in-memory live match.
//
// A correction is written to MatchData in Mongo, but with LIVE_AUTOSAVE off the
// live copy (liveMatchCache) is what overlays are served and what SAVE DATA
// writes back. Left unpatched, a snapshot put the old value back on the overlay
// and SAVE DATA erased the correction.
//
// Only the edited fields change: Mongo can be behind the live copy, so its
// teams must never replace the live ones. For the same reason a kill adjustment
// is applied to the live count, not copied from what Mongo ended up with.
//
// Everything returns new objects. The live object is also the baseline the next
// tick's delta is diffed against, so changing it in place would hide this edit.

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

const isTeam = (team, teamId) => sameId(team._id, teamId) || sameId(team.teamId, teamId);

/** `update(team)` returns the new team; the other teams are left as they are. */
function editLiveTeam(teams, teamId, update) {
  return teams.map((team) => (isTeam(team, teamId) ? update(team) : team));
}

/** Live players always carry uId; `_id` is not guaranteed, so either one matches. */
function isPlayer(player, { playerId, uId }) {
  return sameId(player._id, playerId) || sameId(player.uId, uId);
}

/**
 * Edits one player of one team.
 * `fields`: values to set. `killNumChange`: added to the live count, floored at 0.
 */
function editLivePlayer(teams, teamId, who, { fields = {}, killNumChange } = {}) {
  return editLiveTeam(teams, teamId, (team) => ({
    ...team,
    players: (team.players || []).map((player) => {
      if (!isPlayer(player, who)) return player;
      const next = { ...player, ...fields };
      if (killNumChange !== undefined) {
        next.killNum = Math.max(0, (Number(player.killNum) || 0) + killNumChange);
      }
      return next;
    }),
  }));
}

/** Sets the same fields on every player of a team. */
function editLiveTeamPlayers(teams, teamId, fields) {
  return editLiveTeam(teams, teamId, (team) => ({
    ...team,
    players: (team.players || []).map((player) => ({ ...player, ...fields })),
  }));
}

/** Adds roster players the team does not have yet. */
function addLivePlayers(teams, teamId, added) {
  return editLiveTeam(teams, teamId, (team) => {
    const players = team.players || [];
    const fresh = added.filter((p) => !players.some((have) => isPlayer(have, { playerId: p._id, uId: p.uId })));
    return { ...team, players: [...players, ...fresh] };
  });
}

/** Removes roster players; `removed` holds their `_id` and `uId`. */
function removeLivePlayers(teams, teamId, removed) {
  return editLiveTeam(teams, teamId, (team) => ({
    ...team,
    players: (team.players || []).filter((p) => !removed.some((r) => isPlayer(p, { playerId: r._id, uId: r.uId }))),
  }));
}

module.exports = { editLiveTeam, editLivePlayer, editLiveTeamPlayers, addLivePlayers, removeLivePlayers };

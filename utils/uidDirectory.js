// Pure builder for GET /matchdata/:matchDataId/uid-directory — the list of
// known player names + UIDs per team of the current match, used by the
// screenshot import to turn an OCR'd name into a UID. No DB access, so the
// merge order can be unit-tested on its own.
//
// Sources, earliest wins when two carry the same UID:
//  1. players already seated in the current match        (source 'current')
//  2. the source match(es), in the order given            (source 'match')
//  3. the team's roster in the Teams catalog (playerId)   (source 'roster')
// Teams are paired by their Team ref (teamId); a team of a source match that
// isn't in the current match contributes nothing.

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * @param {Array} currentTeams   current MatchData teams (plain objects)
 * @param {Array} sourceMatches  [{ matchId, matchNo, teams }], newest first
 * @param {Array} catalogTeams   [{ _id, players: [{ playerName, playerId }] }]
 */
function buildUidDirectory(currentTeams, sourceMatches, catalogTeams) {
  const catalogById = new Map((catalogTeams || []).map(t => [String(t._id), t]));

  return (currentTeams || []).map((team) => {
    const teamId = str(team.teamId);
    const players = [];
    const seen = new Set();
    const push = (playerName, uId, source, extra = {}) => {
      const uid = str(uId);
      const name = str(playerName);
      if (!uid || !name || seen.has(uid)) return;
      seen.add(uid);
      players.push({ playerName: name, uId: uid, source, ...extra });
    };

    (team.players || []).forEach(p => push(p.playerName, p.uId, 'current'));

    (sourceMatches || []).forEach((m) => {
      const sourceTeam = (m.teams || []).find(t => teamId && str(t.teamId) === teamId);
      (sourceTeam?.players || []).forEach(p =>
        push(p.playerName, p.uId, 'match', { matchNo: m.matchNo ?? null, matchId: str(m.matchId) || null }));
    });

    (catalogById.get(teamId)?.players || []).forEach(p => push(p.playerName, p.playerId, 'roster'));

    return {
      teamId,
      teamName: team.teamName || '',
      teamTag: team.teamTag || '',
      slot: team.slot ?? null,
      players,
    };
  });
}

module.exports = { buildUidDirectory };

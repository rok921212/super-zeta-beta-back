const Team = require('../../models/teams.model');
const mongoose = require('mongoose');

// Case-fold and strip whitespace/punctuation/symbols (Unicode-aware) before
// comparing names for the roster-reconciliation fallback below — same
// normalization pubgApiMatchData.controller.js applies for its own
// name-based match. Duplicated locally rather than imported: that file
// already requires this one, so importing back would be a require cycle.
const normalizeNameForMatch = name => String(name).toLowerCase().replace(/[\p{P}\p{S}\p{Z}]/gu, '');

/**
 * Update Teams DB with API players already resolved to a team.
 *
 * Team assignment is NOT re-derived here — it's computed once, per tick, in
 * pubgApiMatchData.controller.js's updateMatchDataWithLiveStats (continuity
 * across ticks + an empirical apiTeamId<->team mapping built from
 * unambiguous players that tick), and handed to this function pre-resolved.
 * This function used to independently map `apiPlayer.teamId` (PUBG's
 * ephemeral in-match team id) straight onto a tournament `slot` number —
 * those two numbers are NOT guaranteed to be the same, and when an unrelated
 * squad in the match happened to get an in-game teamId that collided with a
 * team's slot number, their players got PERMANENTLY added to that team's
 * roster in the DB. Only ever adding players via the already-resolved
 * mapping removes that coincidental-collision path entirely, since a player
 * only reaches here once the caller's continuity/empirical-mapping logic has
 * actually placed them on this team.
 *
 * A resolved player is reconciled against the existing roster in three
 * ordered steps: (1) exact playerId match — already registered, just sync
 * playerName if it changed in-game; (2) no playerId match but an existing
 * roster entry has the same normalized name — that entry's playerId is
 * almost certainly a typo/stale value (the dominant real cause of a player
 * staying unmatched, per the name-fallback in pubgApiMatchData.controller.js),
 * so correct it in place rather than treating this as a new player; (3)
 * neither matches — genuinely new player, appended if the team has room, or
 * swapped into a registered slot that didn't appear in this tick's live data
 * (a substitute) if the roster is already at MAX_PLAYERS. New players are
 * added with a blank photo — that's filled in later by a human, not from
 * the live API.
 *
 * Called exactly once per match, by the caller, on the first tick that has
 * real live player data (see MatchData's `rosterSynced` flag) — not on
 * every tick.
 *
 * @param {Map<string, Array>} resolvedPlayersByTeamId - team DB _id (string) -> apiPlayer[]
 * @param {String} matchId - only used for logging
 */
async function updateTeamsWithApiPlayers(resolvedPlayersByTeamId, matchId) {
  try {
    const matchKey = String(matchId);
    if (!resolvedPlayersByTeamId || resolvedPlayersByTeamId.size === 0) return;

    let newPlayersAdded = 0;
    let skipCount = 0;

    // --- Collect all relevant teams from DB ---
    const teamIds = [...resolvedPlayersByTeamId.keys()];
    const teams = await Team.find({ _id: { $in: teamIds } });
    const teamMap = Object.fromEntries(teams.map(t => [t._id.toString(), t]));

    // Every uId already known to ANY team in this match — a resolved
    // assignment that happens to land on a uId already registered to a
    // DIFFERENT team is treated as a wrong guess rather than blindly
    // re-adding it — this roster is shared across tournaments, so a bad
    // guess here corrupts it permanently, not just this one match.
    const knownUidToTeamId = new Map();
    for (const team of teams) {
      for (const p of team.players || []) {
        if (p.playerId) {
          knownUidToTeamId.set(String(p.playerId), team._id.toString());
        }
      }
    }

    const MAX_PLAYERS = 4;
    const modifiedTeams = new Set();
    let nameSyncCount = 0;
    let reconciledCount = 0;

    for (const [teamDbId, apiPlayersForTeam] of resolvedPlayersByTeamId) {
      const team = teamMap[teamDbId];
      if (!team) continue;

      // This tick's live UIDs for the team — used below to tell a
      // genuinely-absent (substituted-out) roster slot apart from one
      // that's just temporarily unreported.
      const currentTickUids = new Set(
        apiPlayersForTeam
          .map(p => p.uId)
          .filter(uid => uid && uid !== 'undefined' && uid !== '')
          .map(String)
      );

      for (const apiPlayer of apiPlayersForTeam) {
        const uId = apiPlayer.uId;
        if (!uId || uId === 'undefined' || uId === '') continue;

        const latestName = typeof apiPlayer.playerName === 'string' ? apiPlayer.playerName.trim() : '';

        // Case 1: exact playerId match — already registered correctly.
        const existingByUid = team.players.find(p => String(p.playerId) === String(uId));
        if (existingByUid) {
          if (latestName && existingByUid.playerName !== latestName) {
            existingByUid.playerName = latestName;
            modifiedTeams.add(team);
            nameSyncCount++;
          }
          skipCount++;
          continue;
        }

        const owningTeamId = knownUidToTeamId.get(String(uId));
        if (owningTeamId && owningTeamId !== String(team._id)) {
          // Already a known member of a different team — don't misattribute.
          continue;
        }

        // Case 2: no playerId match, but an existing roster entry has the
        // same (normalized) name — that entry's stored playerId is almost
        // certainly wrong/stale rather than this being a different person.
        // Correct it in place instead of falling through to the
        // MAX_PLAYERS-capped "new player" path below, which would silently
        // drop this player forever on any already-full roster.
        const apiNameNorm = latestName && normalizeNameForMatch(latestName);
        const placeholder = apiNameNorm
          ? team.players.find(p => p.playerName && normalizeNameForMatch(p.playerName) === apiNameNorm)
          : null;

        if (placeholder) {
          placeholder.playerId = String(uId);
          if (!placeholder.photo && apiPlayer.picUrl) {
            placeholder.photo = apiPlayer.picUrl;
          }
          modifiedTeams.add(team);
          knownUidToTeamId.set(String(uId), String(team._id));
          reconciledCount++;
          continue;
        }

        // Case 3: genuinely new player.
        if (team.players.length >= MAX_PLAYERS) {
          // Roster's full — but if one of the 4 registered players isn't
          // part of THIS tick's live data, they've been substituted out,
          // so swap the new player into that slot instead of dropping them.
          const staleIndex = team.players.findIndex(
            p => p.playerId && !currentTickUids.has(String(p.playerId))
          );

          if (staleIndex === -1) {
            console.warn(`[roster-full] match=${matchKey} team=${team._id} uId=${uId} playerName="${latestName}" — team already has ${MAX_PLAYERS} players and no stale slot to replace; not added`);
            continue;
          }

          const stale = team.players[staleIndex];
          console.log(`[REPLACED] match=${matchKey} team=${team._id} ${stale.playerId}(${stale.playerName}) -> ${uId}(${latestName})`);
          stale.playerId = String(uId);
          stale.playerName = latestName;
          stale.photo = '';

          modifiedTeams.add(team);
          knownUidToTeamId.set(String(uId), String(team._id));
          newPlayersAdded++;
          continue;
        }

        team.players.push({
          _id: new mongoose.Types.ObjectId(),
          playerName: latestName,
          playerId: String(uId),
          photo: ''
        });

        modifiedTeams.add(team);
        knownUidToTeamId.set(String(uId), String(team._id));
        newPlayersAdded++;
      }
    }

    // Save every modified team in parallel instead of one sequential
    // `await team.save()` per new player — a burst of several new players
    // in one tick no longer serializes N round trips into a single tick's
    // latency budget.
    if (modifiedTeams.size > 0) {
      await Promise.all(
        Array.from(modifiedTeams).map(team => {
          team.markModified('players');
          return team.save();
        })
      );
    }

    // Finished - silent
    if (skipCount > 0) {
      console.log(`[EXISTS] ${skipCount} players`);
    }
    if (reconciledCount > 0) {
      console.log(`[RECONCILED] ${reconciledCount} players (playerId corrected via name match)`);
    }
    if (nameSyncCount > 0) {
      console.log(`[NAME-SYNC] ${nameSyncCount} players renamed`);
    }
  } catch (err) {
    console.error('Error updating teams:', err);
  }
}

module.exports = updateTeamsWithApiPlayers;

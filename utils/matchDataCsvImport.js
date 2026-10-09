// Pure planner for the MatchData CSV import (importMatchDataCsv in
// matchData.controller.js). Takes the match's current teams (plain objects)
// and the parsed CSV rows, and decides per row what should happen — no DB,
// no mutation — so the rules can be unit-tested on their own.
//
// Rules:
//  - The player UID is the key. A UID already in the match is updated where
//    it sits, even if the CSV row names a different team.
//  - A UID not in the match is added to the team the row names (by tag,
//    falling back to name). A team that isn't in the match is never created.
//  - A team holds at most MAX_TEAM_PLAYERS. When it is full, a new player
//    takes the seat of a current player the CSV does not list; if every seat
//    is a CSV player, the row is skipped.

const MAX_TEAM_PLAYERS = 4;

// Same rule as PLAYER_ID_FORMAT in teams.controller.js.
const PLAYER_ID_FORMAT = /^\d{5,20}$/;

// Lowercase + strip all whitespace, so "CYBER HERO" / "CyberHero" match.
const normalizeForMatch = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

// '' / undefined -> null ("not given"); otherwise a non-negative integer,
// or NaN when the cell isn't one.
function parseKills(value) {
  const raw = str(value);
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return NaN;
  return parseInt(raw, 10);
}

const hasStats = (p) =>
  Number(p?.killNum || 0) > 0 || Number(p?.damage || 0) > 0 ||
  Number(p?.knockouts || 0) > 0 || Number(p?.assists || 0) > 0;

function planCsvImport(teams, rows) {
  const updates = [];
  const adds = [];
  const skipped = [];
  const notes = [];

  const list = Array.isArray(teams) ? teams : [];
  const skip = (row, rowNum, reason, message) => skipped.push({
    row: rowNum,
    teamTag: str(row?.teamTag),
    playerName: str(row?.playerName),
    playerUid: str(row?.playerUid),
    reason,
    message,
  });

  // Pass 1: validate + dedupe rows.
  const valid = [];
  const seenUids = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    const rowNum = i + 2; // +1 for 0-index, +1 for the header row
    const playerUid = str(row?.playerUid);
    if (!PLAYER_ID_FORMAT.test(playerUid)) {
      return skip(row, rowNum, 'invalid_uid', `"${playerUid}" isn't a valid player UID (digits only, 5-20 chars)`);
    }
    const kills = parseKills(row?.kills);
    if (Number.isNaN(kills)) {
      return skip(row, rowNum, 'invalid_kills', `kills "${str(row?.kills)}" isn't a whole number`);
    }
    if (seenUids.has(playerUid)) {
      return skip(row, rowNum, 'duplicate_uid', `UID ${playerUid} appears more than once in the file — first row kept`);
    }
    seenUids.add(playerUid);
    valid.push({
      rowNum,
      row,
      playerUid,
      kills,
      playerName: str(row?.playerName),
      teamTag: str(row?.teamTag),
      teamName: str(row?.teamName),
    });
  });

  // uId -> where that player sits in the match right now.
  const byUid = new Map();
  list.forEach((team) => {
    (team.players || []).forEach((player) => {
      const uid = str(player?.uId);
      if (uid && !byUid.has(uid)) byUid.set(uid, { team, player });
    });
  });

  const findTeam = (teamTag, teamName) => {
    const tag = normalizeForMatch(teamTag);
    const name = normalizeForMatch(teamName);
    return (tag && list.find(t => normalizeForMatch(t.teamTag) === tag)) ||
      (name && list.find(t => normalizeForMatch(t.teamName) === name)) ||
      null;
  };

  // Pass 2: updates, and collect would-be adds per team.
  const pendingByTeam = new Map(); // String(team._id) -> { team, rows: [] }
  valid.forEach((v) => {
    const found = byUid.get(v.playerUid);
    if (found) {
      const csvTeam = findTeam(v.teamTag, v.teamName);
      if (csvTeam && String(csvTeam._id) !== String(found.team._id)) {
        notes.push({
          row: v.rowNum,
          message: `UID ${v.playerUid} is on "${found.team.teamTag || found.team.teamName}" in this match, not "${v.teamTag || v.teamName}" — updated where it is`,
        });
      }
      updates.push({
        row: v.rowNum,
        teamId: String(found.team.teamId),
        teamSubId: String(found.team._id),
        playerSubId: String(found.player._id),
        playerUid: v.playerUid,
        playerName: v.playerName || null,
        kills: v.kills,
      });
      return;
    }

    const team = findTeam(v.teamTag, v.teamName);
    if (!team) {
      return skip(v.row, v.rowNum, 'team_not_in_match', `team "${v.teamTag || v.teamName}" isn't in this match`);
    }
    if (!v.playerName) {
      return skip(v.row, v.rowNum, 'missing_name', `new player ${v.playerUid} needs a player name`);
    }
    const key = String(team._id);
    if (!pendingByTeam.has(key)) pendingByTeam.set(key, { team, rows: [] });
    pendingByTeam.get(key).rows.push(v);
  });

  // Pass 3: seat the adds.
  for (const { team, rows: pending } of pendingByTeam.values()) {
    const current = team.players || [];
    let freeSeats = Math.max(0, MAX_TEAM_PLAYERS - current.length);
    // Players the CSV doesn't mention, zero-stat ones first.
    const replaceable = current
      .filter(p => !seenUids.has(str(p?.uId)))
      .sort((a, b) => Number(hasStats(a)) - Number(hasStats(b)));

    pending.forEach((v) => {
      const add = {
        row: v.rowNum,
        teamId: String(team.teamId),
        teamSubId: String(team._id),
        playerUid: v.playerUid,
        playerName: v.playerName,
        kills: v.kills,
        replacePlayerSubId: null,
        replacedPlayerName: null,
        seated: true,
      };
      if (freeSeats > 0) {
        freeSeats -= 1;
      } else if (replaceable.length > 0) {
        const out = replaceable.shift();
        add.replacePlayerSubId = String(out._id);
        add.replacedPlayerName = out.playerName || '';
      } else {
        add.seated = false;
        skip(v.row, v.rowNum, 'team_full', `team "${team.teamTag || team.teamName}" already has ${MAX_TEAM_PLAYERS} players from this file`);
      }
      adds.push(add);
    });
  }

  return { updates, adds, skipped, notes };
}

module.exports = { planCsvImport, MAX_TEAM_PLAYERS, PLAYER_ID_FORMAT };

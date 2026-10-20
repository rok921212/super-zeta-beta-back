// Placement points for a team's finishing rank. Shared by the live scoring
// loop (pubgApiMatchData.controller.js) and the MatchData CSV/screenshot
// import, so both score a rank the same way.
function rankToPlacePoints(rank) {
  switch (rank) {
    case 1: return 10;
    case 2: return 6;
    case 3: return 5;
    case 4: return 4;
    case 5: return 3;
    case 6: return 2;
    case 7: return 1;
    case 8: return 1;
    default: return 0;
  }
}

module.exports = { rankToPlacePoints };

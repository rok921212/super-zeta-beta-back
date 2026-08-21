// Canonical view -> live-data-tier mapping, used to decide which
// round:${tid}:${rid}:* sub-room a socket joins (pubgApiMatchData.controller
// .js's joinRoundRoom) and, historically, which pieces of the HTTP bulk
// payload a view needs (Bulkpublic.controller.js's buildBulkPayload).
//
// Hoisted here (previously only defined inline in Bulkpublic.controller.js)
// so the socket-room logic and the HTTP-bulk logic can't drift apart within
// this repo. front/src/dashboard/PublicThemeRenderer.tsx keeps its own
// manually-synced copy — there's no monorepo tooling across the three repos
// in this project, same constraint that already applied before this file
// existed. If you add a view here, mirror it there too.
const VIEWS_NEEDING_OVERALL = new Set([
  'OverAllData', 'OverallFrags', 'LiveStats', '1stRunnerUp', '2ndRunnerUp', 'EventMvp', 'highlightPoints',
  'Champions',
]);
const VIEWS_NEEDING_MATCH_DATA = new Set([
  'Upper', 'Dom', 'Alerts', 'LiveStats', 'LiveFrags', 'MatchData', 'Achive', 'MatchFragrs',
  'WwcdSummary', 'WwcdStats', 'playerH2H', 'mapPreview', 'slots', 'TeamH2H', 'mvp',
  'RosterShowCase', 'MatchSummary', 'Champions', '1stRunnerUp', '2ndRunnerUp', 'EventMvp',
  'PlayerSwitch', 'LiveData', 'Recall',
]);

module.exports = { VIEWS_NEEDING_OVERALL, VIEWS_NEEDING_MATCH_DATA };

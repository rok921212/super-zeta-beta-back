// The images stamped onto a team / player created without one. Built-in
// assets unless an admin has set their own from the admin panel
// (/api/admin-panel/team-defaults).

const { getOverlayConnection } = require('../db/overlayConnection.js');
const { modelFor } = require('../models/appSettings.model.js');

const BUILT_IN = Object.freeze({
  defaultTeamLogo: '/def_logo.avif',
  defaultPlayerPhoto: '/def_char.avif',
  defaultTeamFlag: '/def_flag.avif',
});

// setting field -> its bucket in AppSettings.retired
const RETIRED_KEY = { defaultTeamLogo: 'logo', defaultPlayerPhoto: 'photo', defaultTeamFlag: 'flag' };
const FIELDS = Object.keys(BUILT_IN);

const SETTINGS_KEY = 'global';
const MEMO_MS = 60 * 1000;

let memo = null; // { at, doc }

const AppSettings = () => modelFor(getOverlayConnection());

async function loadDoc() {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.doc;
  const doc = await AppSettings().findOne({ key: SETTINGS_KEY }).lean().maxTimeMS(5000);
  memo = { at: Date.now(), doc: doc || null };
  return memo.doc;
}

const effective = (doc) => {
  const out = {};
  for (const f of FIELDS) out[f] = (doc && typeof doc[f] === 'string' && doc[f].trim()) ? doc[f] : BUILT_IN[f];
  return out;
};

// Never throws: creating a team must not fail because the settings read did.
async function getTeamDefaults() {
  try {
    return effective(await loadDoc());
  } catch (err) {
    console.warn(`[team-defaults] read failed, using built-ins: ${err.message}`);
    return { ...BUILT_IN };
  }
}

// patch: any of the three fields; '' resets that one to the built-in.
// Throws on a DB failure — the admin needs to see that the save didn't land.
async function setTeamDefaults(patch) {
  memo = null;
  const before = effective(await loadDoc());

  const $set = {};
  const $addToSet = {};
  for (const f of FIELDS) {
    if (patch[f] === undefined) continue;
    const next = patch[f].trim();
    $set[f] = next;
    if ((next || BUILT_IN[f]) !== before[f]) $addToSet[`retired.${RETIRED_KEY[f]}`] = before[f];
  }
  if (!Object.keys($set).length) return before;

  const update = { $set };
  if (Object.keys($addToSet).length) update.$addToSet = $addToSet;
  const doc = await AppSettings().findOneAndUpdate(
    { key: SETTINGS_KEY },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  memo = { at: Date.now(), doc };
  return effective(doc);
}

// For "apply to existing": per field, the current default and every value
// that counts as "still on a default" (built-in + retired, minus current).
async function getDefaultsWithRetired() {
  memo = null;
  const doc = await loadDoc();
  const current = effective(doc);
  const old = {};
  for (const f of FIELDS) {
    const retired = doc?.retired?.[RETIRED_KEY[f]] || [];
    old[f] = [...new Set([BUILT_IN[f], ...retired])].filter(v => v && v !== current[f]);
  }
  return { current, old };
}

module.exports = { BUILT_IN, FIELDS, getTeamDefaults, setTeamDefaults, getDefaultsWithRetired };

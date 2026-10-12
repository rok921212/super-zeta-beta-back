// Theme names are what operators pick themes by (DisplayHud shows the name), so two themes
// called "Theme 9" look like one theme twice — a re-imported .sstheme or a template theme
// typed with an existing name used to do exactly that. A wanted name that is already taken
// gets " (2)", " (3)"… instead.

const MAX_NAME = 60;

function uniqueThemeName(wanted, existing) {
  const base = String(wanted || '').trim().slice(0, MAX_NAME) || 'Theme';
  const taken = new Set((existing || []).map((t) => String(t && t.name || '').trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const name = base.slice(0, MAX_NAME - suffix.length) + suffix;
    if (!taken.has(name.toLowerCase())) return name;
  }
  return base;
}

module.exports = { uniqueThemeName };

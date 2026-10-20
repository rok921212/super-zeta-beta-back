// Smash Point (models/match.model.js `smashPoint`): checks and tidies what the
// match form sends. A display value only; no scoring rule is attached to it.

const MAX_VALUE = 40;
const MAX_LABEL = 24;

/** { value } ready to store, or { error }. `null` clears it. */
function normalizeSmashPoint(input) {
  if (input === null) return { value: { enabled: false, value: '', displayText: '' } };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'smashPoint must be an object' };
  const text = (v, field, max) => {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`smashPoint.${field} must be text`);
    const s = String(v).replace(/\s+/g, ' ').trim();
    if (s.length > max) throw new Error(`smashPoint.${field} can be at most ${max} characters`);
    return s;
  };
  try {
    const value = text(input.value, 'value', MAX_VALUE);
    const displayText = text(input.displayText, 'displayText', MAX_LABEL);
    return { value: { enabled: !!input.enabled && value !== '', value, displayText } };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { normalizeSmashPoint, MAX_VALUE, MAX_LABEL };

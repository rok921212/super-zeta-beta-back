// Shared by both msgpackCodec.js and protobufCodec.js. Mongoose .lean()
// docs contain ObjectId instances neither encoder can walk directly, and
// Date instances that need a stable string form on the wire. Factored out
// of msgpackCodec.js's original normalizeForMsgpack so both codecs stay in
// sync on this rather than drifting.
const { cdnImageUrl } = require('./cdnImage');

function isObjectId(value) {
  return typeof value === 'object' && value !== null && value._bsontype === 'ObjectId';
}

function normalizeWireValue(value) {
  // Image URLs (team logos, player photos…) go out with Cloudinary delivery
  // transforms: see cdnImage.js. Cheap prefix checks for every other string.
  if (typeof value === 'string') return cdnImageUrl(value);
  if (isObjectId(value)) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeWireValue);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = normalizeWireValue(value[key]);
    }
    return out;
  }
  return value;
}

module.exports = { isObjectId, normalizeWireValue };

// Cloudinary delivery transforms for image URLs on the wire. Uploads are
// stored as the original file (up to 5 MB), and every overlay, dashboard
// and desktop view downloaded that original. Adding `f_auto,q_auto` lets
// Cloudinary pick AVIF/WebP for the browser at an automatic quality, and
// `c_limit,w_1920,h_1080` caps the size at the 1080p stage (never upscales),
// so nothing gets bigger than a broadcast frame can show.
//
// Only plain `res.cloudinary.com/<cloud>/image/upload/` URLs are touched;
// a URL that already carries a transformation, a video, a fetch URL or any
// other host is left exactly as it is, so the rewrite is idempotent.
// Opt-in: CDN_IMAGE_TRANSFORMS=true. Turn it on only once every operator runs
// a desktop build whose INI logo download strips these transforms
// (services.rs normalize_logo_url); older builds could get AVIF/WebP there.

const TRANSFORM = 'f_auto,q_auto,c_limit,w_1920,h_1080';
const RE = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/|(?![a-z]{1,3}_[^/]*\/))/;

const enabled = () => process.env.CDN_IMAGE_TRANSFORMS === 'true';

/** The URL with delivery transforms, or the input unchanged when it is not a plain Cloudinary image URL. */
function cdnImageUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('http') || !value.includes('res.cloudinary.com/')) return value;
  if (!enabled()) return value;
  return value.replace(RE, (_, base, rest) => `${base}${TRANSFORM}/${rest}`);
}

module.exports = { cdnImageUrl, CDN_TRANSFORM: TRANSFORM };

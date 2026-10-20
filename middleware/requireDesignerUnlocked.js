// While an account's lock covers the Designer (services/directorLock.js,
// `designerLocked`), every Designer write answers 423 { code: 'ACCOUNT_LOCKED' }.
// Reads go through, so the Designer still opens view-only and published
// overlays keep rendering. Mounted in index.js in front of the Designer
// routers; a request with no signed-in user is left to their own auth (401).
//
// The state is memoised per account for a few seconds; the lock service calls
// forget() whenever it tells an account's clients something changed.

const TTL_MS = 5000;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const memo = new Map(); // userId -> { at, designerLocked }

function forget(userId) {
  memo.delete(String(userId));
}

function createRequireDesignerUnlocked({ state, now = () => Date.now() } = {}) {
  const lookup = state || ((userId) => require('../route/directorLock.route.js').getDirectorLockService().state(userId));

  async function designerLocked(userId) {
    const key = String(userId);
    const hit = memo.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.designerLocked;
    const s = await lookup(key);
    const locked = !!s?.designerLocked;
    memo.set(key, { at: now(), designerLocked: locked });
    return locked;
  }

  return async function requireDesignerUnlocked(req, res, next) {
    const userId = req.session?.userId;
    if (READ_METHODS.has(req.method) || !userId) return next();
    try {
      if (await designerLocked(userId)) {
        return res.status(423).json({
          code: 'ACCOUNT_LOCKED',
          message: 'The Designer is locked for this account. Unlock it with the account lock password.',
        });
      }
    } catch (err) {
      // An unknown account or a Mongo hiccup: let the route answer as before.
      console.warn('[designer-lock] state check failed:', err.message);
    }
    next();
  };
}

const requireDesignerUnlocked = createRequireDesignerUnlocked();

module.exports = requireDesignerUnlocked;
module.exports.forget = forget;
module.exports.createRequireDesignerUnlocked = createRequireDesignerUnlocked;

// Designer layouts API (ScoreSync Graphics Engine).
//
// Rules this file enforces:
//   - Identity comes from the verified JWT (req.session.userId) only — an
//     ownerId in the body is ignored. Another user's layout is a 404 (its
//     existence is not leaked).
//   - Every write validates the document with the ONE shared schema
//     (utils/layoutSchema.generated.cjs, source front/src/graphics/schema).
//   - Autosave writes only `draft`, with optimistic concurrency: the client
//     sends the draftRev it edited; a stale one gets 409 + the current rev,
//     never a silent overwrite.
//   - Publish copies the draft into an immutable revision; the public runtime
//     only ever reads published revisions.
//   - A production-locked layout refuses edits, publishes and deletion (423).

const crypto = require('crypto');
const schema = require('../utils/layoutSchema.generated.cjs');
const { sendConditionalJson } = require('../utils/conditionalJson.js');

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const PUBLIC_ID_RE = /^[A-Za-z0-9]{10,32}$/;
const MATCH_MODES = ['fixedMatch', 'selectedMatch', 'liveMatch', 'roundOverall', 'tournamentOverall'];
const PUBLIC_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function newPublicId(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += PUBLIC_ID_ALPHABET[bytes[i] % PUBLIC_ID_ALPHABET.length];
  return out;
}

const log = (event, fields = {}) =>
  console.log(JSON.stringify({ scope: 'overlay-layouts', event, ...fields }));

function toSummary(l) {
  return {
    _id: String(l._id),
    name: l.name,
    publicId: l.publicId,
    schemaVersion: l.schemaVersion,
    draftRev: l.draftRev,
    publishedRev: l.publishedRev,
    publishedAt: l.publishedAt || null,
    productionLocked: !!l.productionLocked,
    defaults: l.defaults || { tournamentId: null, roundId: null, matchMode: 'selectedMatch' },
    assetBase: l.assetBase || '',
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

/** What the save route understands — the editor only uses a feature this backend advertises. */
const SAVE_CAPABILITIES = ['gzip-save', 'summary-save'];

const toFull = (l) => ({ ...toSummary(l), draft: l.draft, capabilities: SAVE_CAPABILITIES });

/** Changes whenever anything a GET of the layout returns changes. */
const layoutEtag = (l) => `"${String(l._id)}-${l.draftRev}-${l.publishedRev}-${l.productionLocked ? 1 : 0}"`;

/**
 * Atlas shared tiers cap a cluster at 500 collections; the first insert into a
 * not-yet-existing collection then fails. Surface that instead of a bare 500.
 */
function isCollectionLimitError(err) {
  if (!err) return false;
  if (err.code === 8000 || err.code === 14031) return /collection/i.test(String(err.message)) || err.code === 14031;
  return /cannot create a new collection|collections? of \d+|too many collections/i.test(String(err.message));
}

/** Normalize + validate an untrusted draft. Returns { doc } or { errors }. */
function checkDraft(raw) {
  const doc = schema.normalizeLayout(raw);
  const result = schema.validateLayout(doc);
  return result.ok ? { doc } : { errors: result.errors };
}

/** Validate the optional non-document fields. Returns { set } or { errors }. */
function checkMeta(body) {
  const set = {};
  const errors = [];
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) errors.push({ path: 'name', message: 'name must be 1-120 characters' });
    else set.name = body.name.trim();
  }
  if (body.defaults !== undefined) {
    const d = body.defaults;
    if (d === null || typeof d !== 'object' || Array.isArray(d)) errors.push({ path: 'defaults', message: 'defaults must be an object' });
    else {
      const out = { tournamentId: null, roundId: null, matchMode: 'selectedMatch' };
      for (const k of ['tournamentId', 'roundId']) {
        if (d[k] == null || d[k] === '') continue;
        if (typeof d[k] !== 'string' || !OBJECT_ID_RE.test(d[k])) errors.push({ path: `defaults.${k}`, message: 'must be an ObjectId' });
        else out[k] = d[k];
      }
      if (d.matchMode != null) {
        if (!MATCH_MODES.includes(d.matchMode)) errors.push({ path: 'defaults.matchMode', message: 'unknown matchMode' });
        else out.matchMode = d.matchMode;
      }
      set.defaults = out;
    }
  }
  if (body.assetBase !== undefined) {
    const a = body.assetBase;
    if (a !== '' && (typeof a !== 'string' || !/^https:\/\//.test(a) || !schema.isSafeUrl(a))) {
      errors.push({ path: 'assetBase', message: 'assetBase must be an https:// origin or empty' });
    } else set.assetBase = a.replace(/\/+$/, '');
  }
  return errors.length ? { errors } : { set };
}

/** store.create with a fresh publicId, retried on the (rare) unique-index collision. */
async function createLayoutWithUniquePublicId(store, fields) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await store.create({ ...fields, publicId: newPublicId() });
    } catch (err) {
      if (err && err.code === 11000 && /publicId/.test(String(err.message || err.keyPattern && JSON.stringify(err.keyPattern)))) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique publicId');
}

/**
 * Copy a validated draft into the next immutable revision and point the layout
 * at it. Returns { layout, rev }, or { conflict: true } when another publish
 * of this layout won the race, or { missed: true } when the layout changed
 * underneath (locked / deleted / republished) between the two writes.
 */
async function publishLayout(store, fontStore, layout, userId, doc) {
  // Snapshot the owner's font library: the revision stays renderable as published.
  const fonts = fontStore ? (await fontStore.list(userId)).map((f) => ({ id: String(f._id), family: f.family })) : [];
  const nextRev = layout.publishedRev + 1;
  let revision;
  try {
    revision = await store.insertRevision({
      layoutId: String(layout._id),
      rev: nextRev,
      schemaVersion: schema.SCHEMA_VERSION,
      document: doc,
      publishedBy: userId,
      fonts,
    });
  } catch (err) {
    if (err && err.code === 11000) return { conflict: true, rev: nextRev };
    throw err;
  }
  const updated = await store.markPublished(layout._id, userId, layout.publishedRev, nextRev, revision._id);
  if (!updated) return { missed: true, rev: nextRev };
  return { layout: updated, rev: nextRev };
}

function createOverlayLayoutController(store, { themeStore = null, fontStore = null } = {}) {
  const userOf = (req) => String(req.session.userId);

  // 404 for a malformed id too — never a CastError 500.
  const idOk = (req, res) => {
    if (OBJECT_ID_RE.test(req.params.id || '')) return true;
    res.status(404).json({ message: 'Layout not found' });
    return false;
  };

  /** Why did a conditional write match nothing? */
  async function explainMiss(res, id, ownerId, extra = {}) {
    const current = await store.get(id, ownerId);
    if (!current) return res.status(404).json({ message: 'Layout not found' });
    if (current.productionLocked) return res.status(423).json({ message: 'Layout is production-locked', productionLocked: true });
    return res.status(409).json({
      message: 'Layout changed since you loaded it',
      currentRev: current.draftRev,
      publishedRev: current.publishedRev,
      ...extra,
    });
  }

  const createWithUniquePublicId = (fields) => createLayoutWithUniquePublicId(store, fields);

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      log('error', {
        route: `${req.method} ${req.baseUrl}${req.route ? req.route.path : ''}`,
        name: err && err.name, code: err && err.code, codeName: err && err.codeName, message: err && err.message,
      });
      if (res.headersSent) return;
      if (isCollectionLimitError(err)) {
        return res.status(507).json({ message: 'Database collection limit reached — contact the administrator', code: 'COLLECTION_LIMIT' });
      }
      res.status(500).json({ message: 'Internal error' });
    }
  };

  return {
    list: wrap(async (req, res) => {
      const items = await store.list(userOf(req));
      sendConditionalJson(req, res, items.map(toSummary));
    }),

    create: wrap(async (req, res) => {
      const body = req.body || {};
      const meta = checkMeta({ name: body.name ?? 'Untitled overlay', defaults: body.defaults, assetBase: body.assetBase });
      if (meta.errors) return res.status(400).json({ message: 'Invalid layout', errors: meta.errors });
      const draft = checkDraft(body.draft != null ? body.draft : schema.createEmptyLayout());
      if (draft.errors) return res.status(400).json({ message: 'Invalid layout', errors: draft.errors });
      const layout = await createWithUniquePublicId({
        ownerId: userOf(req),
        schemaVersion: schema.SCHEMA_VERSION,
        draft: draft.doc,
        ...meta.set,
      });
      log('created', { layoutId: String(layout._id), userId: userOf(req) });
      res.status(201).json(toFull(layout));
    }),

    get: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      // A revalidation is answered from the (cached) summary: an unchanged layout costs a 304
      // without ever loading its draft.
      const inm = req.headers['if-none-match'];
      if (inm && store.getSummary) {
        const summary = await store.getSummary(req.params.id, userOf(req));
        if (!summary) return res.status(404).json({ message: 'Layout not found' });
        if (layoutEtag(summary) === inm) {
          res.set('ETag', inm);
          res.set('Cache-Control', 'private, no-cache');
          res.removeHeader('Pragma');
          res.removeHeader('Expires');
          return res.status(304).end();
        }
      }
      const layout = await store.get(req.params.id, userOf(req));
      if (!layout) return res.status(404).json({ message: 'Layout not found' });
      // Private + revalidate: re-opening an unchanged layout costs a 304, never a stale draft.
      const etag = layoutEtag(layout);
      res.set('ETag', etag);
      res.set('Cache-Control', 'private, no-cache');
      res.removeHeader('Pragma');
      res.removeHeader('Expires');
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      res.json(toFull(layout));
    }),

    update: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const body = req.body || {};
      if (!Number.isInteger(body.expectedRev)) return res.status(400).json({ message: 'expectedRev (integer) is required' });
      const meta = checkMeta(body);
      if (meta.errors) return res.status(400).json({ message: 'Invalid layout', errors: meta.errors });
      const set = { ...meta.set };
      if (body.draft !== undefined) {
        const draft = checkDraft(body.draft);
        if (draft.errors) return res.status(400).json({ message: 'Invalid layout', errors: draft.errors });
        set.draft = draft.doc;
        set.schemaVersion = schema.SCHEMA_VERSION;
      }
      const updated = await store.updateDraft(req.params.id, userOf(req), body.expectedRev, set);
      if (!updated) return explainMiss(res, req.params.id, userOf(req));
      // ?return=summary: the editor already holds the draft it just sent — do not echo it back.
      res.json(req.query.return === 'summary' ? toSummary(updated) : toFull(updated));
    }),

    remove: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const current = await store.get(req.params.id, userOf(req));
      if (!current) return res.status(404).json({ message: 'Layout not found' });
      if (current.productionLocked) return res.status(423).json({ message: 'Layout is production-locked', productionLocked: true });
      await store.remove(req.params.id, userOf(req));
      if (themeStore) await themeStore.clearLayout(userOf(req), req.params.id); // drop it from any custom-theme slot
      log('deleted', { layoutId: req.params.id, userId: userOf(req) });
      res.status(204).end();
    }),

    publish: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const body = req.body || {};
      const userId = userOf(req);
      const layout = await store.get(req.params.id, userId);
      if (!layout) return res.status(404).json({ message: 'Layout not found' });
      if (layout.productionLocked) return res.status(423).json({ message: 'Layout is production-locked', productionLocked: true });
      // Publish exactly what the operator is looking at, not a newer autosave from another tab.
      if (body.expectedRev != null && body.expectedRev !== layout.draftRev) {
        return res.status(409).json({ message: 'Layout changed since you loaded it', currentRev: layout.draftRev, publishedRev: layout.publishedRev });
      }
      const draft = checkDraft(layout.draft);
      if (draft.errors) return res.status(400).json({ message: 'Draft is not publishable', errors: draft.errors });

      const out = await publishLayout(store, fontStore, layout, userId, draft.doc);
      if (out.conflict) return res.status(409).json({ message: 'Another publish of this layout just happened', publishedRev: out.rev });
      if (out.missed) return explainMiss(res, req.params.id, userId);
      const { layout: updated, rev: nextRev } = out;
      log('published', { layoutId: String(layout._id), userId, rev: nextRev, elements: schema.countElements(draft.doc) });
      res.json({ ...toSummary(updated), publishedRev: nextRev });
    }),

    revisions: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const layout = await (store.getSummary || store.get)(req.params.id, userOf(req));
      if (!layout) return res.status(404).json({ message: 'Layout not found' });
      sendConditionalJson(req, res, await store.listRevisions(String(layout._id)));
    }),

    restore: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const rev = Number(req.params.rev);
      const body = req.body || {};
      if (!Number.isInteger(rev) || rev < 1) return res.status(404).json({ message: 'Revision not found' });
      if (!Number.isInteger(body.expectedRev)) return res.status(400).json({ message: 'expectedRev (integer) is required' });
      const layout = await store.get(req.params.id, userOf(req));
      if (!layout) return res.status(404).json({ message: 'Layout not found' });
      const revision = await store.getRevision(String(layout._id), rev);
      if (!revision) return res.status(404).json({ message: 'Revision not found' });
      const draft = checkDraft(revision.document);
      if (draft.errors) return res.status(400).json({ message: 'Revision is not valid under the current schema', errors: draft.errors });
      const updated = await store.updateDraft(req.params.id, userOf(req), body.expectedRev, { draft: draft.doc });
      if (!updated) return explainMiss(res, req.params.id, userOf(req));
      log('restored', { layoutId: req.params.id, userId: userOf(req), rev });
      res.json(toFull(updated));
    }),

    duplicate: wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const layout = await store.get(req.params.id, userOf(req));
      if (!layout) return res.status(404).json({ message: 'Layout not found' });
      const draft = checkDraft(layout.draft);
      if (draft.errors) return res.status(400).json({ message: 'Invalid layout', errors: draft.errors });
      const copy = await createWithUniquePublicId({
        ownerId: userOf(req),
        schemaVersion: schema.SCHEMA_VERSION,
        name: `${layout.name} (copy)`.slice(0, 120),
        draft: draft.doc,
        defaults: layout.defaults,
        assetBase: layout.assetBase || '',
      });
      res.status(201).json(toFull(copy));
    }),

    setLock: (locked) => wrap(async (req, res) => {
      if (!idOk(req, res)) return;
      const updated = await store.setFields(req.params.id, userOf(req), { productionLocked: locked });
      if (!updated) return res.status(404).json({ message: 'Layout not found' });
      log(locked ? 'locked' : 'unlocked', { layoutId: req.params.id, userId: userOf(req) });
      res.json(toSummary(updated));
    }),

    /**
     * PUBLIC: GET /api/overlay-render/:publicId — the published document for
     * the OBS runtime. Deliberately outside /api/public/* so it never goes
     * through the local relay; cheap to revalidate (ETag on publishedRev).
     */
    render: wrap(async (req, res) => {
      const { publicId } = req.params;
      if (!PUBLIC_ID_RE.test(publicId || '')) return res.status(404).json({ message: 'Overlay not found' });
      const layout = await store.getByPublicId(publicId);
      if (!layout || !layout.publishedRev) return res.status(404).json({ message: 'Overlay not found or not published' });
      const etag = `"${publicId}-${layout.publishedRev}"`;
      res.set('ETag', etag);
      res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=60');
      res.removeHeader('Pragma');
      res.removeHeader('Expires');
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      const revision = await store.getRevision(String(layout._id), layout.publishedRev);
      if (!revision) return res.status(404).json({ message: 'Overlay not found or not published' });
      res.json({
        publicId,
        name: layout.name,
        publishedRev: layout.publishedRev,
        publishedAt: layout.publishedAt || null,
        schemaVersion: revision.schemaVersion,
        stage: revision.document.stage,
        defaults: layout.defaults || { tournamentId: null, roundId: null, matchMode: 'selectedMatch' },
        assetBase: layout.assetBase || '',
        fonts: revision.fonts || [],
        published: revision.document,
      });
    }),
  };
}

module.exports = { createOverlayLayoutController, newPublicId, checkDraft, createLayoutWithUniquePublicId, publishLayout, isCollectionLimitError };

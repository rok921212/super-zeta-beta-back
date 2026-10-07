// Persistence for Designer layouts, behind one small interface so the HTTP
// layer (controller/overlayLayout.controller.js) can be tested against an
// in-memory store with the SAME semantics as the Mongo one. Every method that
// changes a layout is a single conditional (compare-and-set) write: ownership,
// the expected draft revision and the production lock are part of the match,
// never a read-then-write.
//
// Interface (all async, all return plain objects or null):
//   list(ownerId)                                -> summaries (no draft)
//   create(fields)                               -> layout
//   get(id, ownerId)                             -> layout | null
//   getSummary(id, ownerId)                      -> layout without its draft | null
//   getByPublicId(publicId)                      -> layout without its draft | null   (the public render route)
//   updateDraft(id, ownerId, expectedRev, set)   -> layout | null   (draftRev++ ; needs !locked)
//   setFields(id, ownerId, set, {unlockedOnly})  -> layout | null
//   remove(id, ownerId)                          -> boolean        (also drops revisions)
//   insertRevision({layoutId, rev, schemaVersion, document, publishedBy}) -> revision  (dup (layoutId,rev) throws code 11000)
//   markPublished(id, ownerId, fromRev, toRev, revisionId) -> layout | null (needs publishedRev === fromRev and !locked)
//   listRevisions(layoutId)                      -> [{rev, createdAt, publishedBy}] newest first
//   getRevision(layoutId, rev)                   -> revision | null

const mongoose = require('mongoose');

const SUMMARY_FIELDS = 'name publicId schemaVersion draftRev publishedRev publishedAt productionLocked defaults assetBase createdAt updatedAt ownerId';

function createMongoStore({ connection } = {}) {
  const OverlayLayout = require('../models/overlayLayout.model.js').modelFor(connection || mongoose.connection);
  const OverlayLayoutRevision = require('../models/overlayLayoutRevision.model.js').modelFor(connection || mongoose.connection);
  const opts = { new: true, lean: true };
  return {
    list: (ownerId) => OverlayLayout.find({ ownerId }).select(SUMMARY_FIELDS).sort({ updatedAt: -1 }).lean(),
    create: async (fields) => (await OverlayLayout.create(fields)).toObject(),
    get: (id, ownerId) => OverlayLayout.findOne({ _id: id, ownerId }).lean(),
    getSummary: (id, ownerId) => OverlayLayout.findOne({ _id: id, ownerId }).select(SUMMARY_FIELDS).lean(),
    // The render route only needs the record, never the (up to 512 KB) draft.
    getByPublicId: (publicId) => OverlayLayout.findOne({ publicId }).select(SUMMARY_FIELDS).lean(),
    updateDraft: (id, ownerId, expectedRev, set) => OverlayLayout.findOneAndUpdate(
      { _id: id, ownerId, draftRev: expectedRev, productionLocked: false },
      { $set: set, $inc: { draftRev: 1 } },
      opts
    ),
    setFields: (id, ownerId, set, { unlockedOnly = false } = {}) => OverlayLayout.findOneAndUpdate(
      unlockedOnly ? { _id: id, ownerId, productionLocked: false } : { _id: id, ownerId },
      { $set: set },
      opts
    ),
    remove: async (id, ownerId) => {
      const res = await OverlayLayout.deleteOne({ _id: id, ownerId });
      if (res.deletedCount) await OverlayLayoutRevision.deleteMany({ layoutId: id });
      return res.deletedCount > 0;
    },
    insertRevision: async (rev) => (await OverlayLayoutRevision.create(rev)).toObject(),
    markPublished: (id, ownerId, fromRev, toRev, revisionId) => OverlayLayout.findOneAndUpdate(
      { _id: id, ownerId, publishedRev: fromRev, productionLocked: false },
      { $set: { publishedRev: toRev, publishedRevisionId: revisionId, publishedAt: new Date() } },
      opts
    ),
    listRevisions: (layoutId) => OverlayLayoutRevision.find({ layoutId }).select('rev createdAt publishedBy').sort({ rev: -1 }).lean(),
    getRevision: (layoutId, rev) => OverlayLayoutRevision.findOne({ layoutId, rev }).lean(),
  };
}

/** Same contract, in memory — for tests. Deep-copies on the way in and out like a database. */
function createMemoryStore() {
  const layouts = new Map();
  const revisions = [];
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => String(a) === String(b);
  const find = (id, ownerId) => {
    const l = layouts.get(String(id));
    return l && same(l.ownerId, ownerId) ? l : null;
  };
  const touch = (l) => { l.updatedAt = new Date().toISOString(); };
  return {
    async list(ownerId) {
      return [...layouts.values()]
        .filter((l) => same(l.ownerId, ownerId))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((l) => { const { draft, ...rest } = clone(l); return rest; });
    },
    async create(fields) {
      if ([...layouts.values()].some((l) => l.publicId === fields.publicId)) {
        const e = new Error('duplicate publicId'); e.code = 11000; throw e;
      }
      const now = new Date().toISOString();
      const l = {
        _id: new mongoose.Types.ObjectId().toString(),
        organizationId: null, schemaVersion: 1, draftRev: 1, publishedRev: 0, publishedRevisionId: null,
        publishedAt: null, productionLocked: false, defaults: { tournamentId: null, roundId: null, matchMode: 'selectedMatch' },
        assetBase: '', ...clone(fields), createdAt: now, updatedAt: now,
      };
      layouts.set(l._id, l);
      return clone(l);
    },
    async get(id, ownerId) { return clone(find(id, ownerId)); },
    async getSummary(id, ownerId) { const l = clone(find(id, ownerId)); if (!l) return null; const { draft, ...rest } = l; return rest; },
    async getByPublicId(publicId) { const l = clone([...layouts.values()].find((x) => x.publicId === publicId) || null); if (!l) return null; const { draft, ...rest } = l; return rest; },
    async updateDraft(id, ownerId, expectedRev, set) {
      const l = find(id, ownerId);
      if (!l || l.draftRev !== expectedRev || l.productionLocked) return null;
      Object.assign(l, clone(set));
      l.draftRev += 1;
      touch(l);
      return clone(l);
    },
    async setFields(id, ownerId, set, { unlockedOnly = false } = {}) {
      const l = find(id, ownerId);
      if (!l || (unlockedOnly && l.productionLocked)) return null;
      Object.assign(l, clone(set));
      touch(l);
      return clone(l);
    },
    async remove(id, ownerId) {
      const l = find(id, ownerId);
      if (!l) return false;
      layouts.delete(String(id));
      for (let i = revisions.length - 1; i >= 0; i--) if (same(revisions[i].layoutId, id)) revisions.splice(i, 1);
      return true;
    },
    async insertRevision(rev) {
      if (revisions.some((r) => same(r.layoutId, rev.layoutId) && r.rev === rev.rev)) {
        const e = new Error('duplicate revision'); e.code = 11000; throw e;
      }
      const r = { _id: new mongoose.Types.ObjectId().toString(), ...clone(rev), createdAt: new Date().toISOString() };
      revisions.push(r);
      return clone(r);
    },
    async markPublished(id, ownerId, fromRev, toRev, revisionId) {
      const l = find(id, ownerId);
      if (!l || l.publishedRev !== fromRev || l.productionLocked) return null;
      Object.assign(l, { publishedRev: toRev, publishedRevisionId: String(revisionId), publishedAt: new Date().toISOString() });
      touch(l);
      return clone(l);
    },
    async listRevisions(layoutId) {
      return revisions.filter((r) => same(r.layoutId, layoutId)).sort((a, b) => b.rev - a.rev)
        .map((r) => ({ rev: r.rev, createdAt: r.createdAt, publishedBy: r.publishedBy }));
    },
    async getRevision(layoutId, rev) {
      return clone(revisions.find((r) => same(r.layoutId, layoutId) && r.rev === rev) || null);
    },
    // test hook
    _revisions: revisions,
  };
}

module.exports = { createMongoStore, createMemoryStore };

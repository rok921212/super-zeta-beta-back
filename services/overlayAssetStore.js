// Persistence for uploaded Designer images, behind the same kind of small
// interface as services/overlayFontStore.js so the controller can be tested
// against an in-memory store with the SAME semantics as the Mongo one.
//
// Interface (all async, plain objects):
//   list(ownerId)                         -> [meta] newest first (never the bytes)
//   usage(ownerId)                        -> { count, bytes }
//   findByHash(ownerId, hash)             -> meta | null
//   create({ ownerId, name, mime, size, width, height, hash, data }) -> meta  (dup (ownerId, hash) throws code 11000)
//   getFile(id)                           -> { data: Buffer, mime, size } | null   (public: not owner-scoped)
//   getThumb(id)                          -> { data: Buffer, mime } | null         (public)
//   setThumb(id, ownerId, data, mime)     -> meta | null
//   rename(id, ownerId, name)             -> meta | null
//   remove(id, ownerId)                   -> boolean
//   ownedIds(ownerId, ids)                -> the ids among `ids` this owner has
//
// meta = { _id, ownerId, name, mime, size, width, height, hasThumb, createdAt }

const mongoose = require('mongoose');

const META_FIELDS = 'ownerId name mime size width height thumbMime createdAt';
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const plain = (a) => a && ({
  _id: String(a._id),
  ownerId: String(a.ownerId),
  name: a.name,
  mime: a.mime,
  size: a.size,
  width: a.width || 0,
  height: a.height || 0,
  hasThumb: !!a.thumbMime,
  createdAt: a.createdAt,
});

function createMongoAssetStore({ connection } = {}) {
  const OverlayAsset = require('../models/overlayAsset.model.js').modelFor(connection || mongoose.connection);
  return {
    list: async (ownerId) => (await OverlayAsset.find({ ownerId }).select(META_FIELDS).sort({ createdAt: -1 }).lean()).map(plain),
    usage: async (ownerId) => {
      const rows = await OverlayAsset.find({ ownerId }).select('size').lean();
      return { count: rows.length, bytes: rows.reduce((n, r) => n + (r.size || 0), 0) };
    },
    findByHash: async (ownerId, hash) => plain(await OverlayAsset.findOne({ ownerId, hash }).select(META_FIELDS).lean()),
    create: async (fields) => plain((await OverlayAsset.create(fields)).toObject()),
    getFile: async (id) => {
      // Not lean(): a hydrated document gives a real Buffer, lean() a BSON Binary.
      const a = await OverlayAsset.findById(id).select('data mime size');
      return a ? { data: Buffer.from(a.data), mime: a.mime, size: a.size } : null;
    },
    getThumb: async (id) => {
      const a = await OverlayAsset.findById(id).select('thumb thumbMime');
      return a && a.thumb && a.thumbMime ? { data: Buffer.from(a.thumb), mime: a.thumbMime } : null;
    },
    setThumb: async (id, ownerId, data, mime) => plain(await OverlayAsset.findOneAndUpdate(
      { _id: id, ownerId }, { $set: { thumb: data, thumbMime: mime } }, { new: true }
    ).select(META_FIELDS).lean()),
    rename: async (id, ownerId, name) => plain(await OverlayAsset.findOneAndUpdate(
      { _id: id, ownerId }, { $set: { name } }, { new: true }
    ).select(META_FIELDS).lean()),
    remove: async (id, ownerId) => (await OverlayAsset.deleteOne({ _id: id, ownerId })).deletedCount > 0,
    ownedIds: async (ownerId, ids) => {
      const valid = (ids || []).filter((i) => OBJECT_ID_RE.test(i));
      if (!valid.length) return [];
      return (await OverlayAsset.find({ ownerId, _id: { $in: valid } }).select('_id').lean()).map((a) => String(a._id));
    },
  };
}

function createMemoryAssetStore() {
  const assets = new Map();
  const mine = (ownerId) => [...assets.values()].filter((a) => String(a.ownerId) === String(ownerId));
  const own = (id, ownerId) => {
    const a = assets.get(String(id));
    return a && String(a.ownerId) === String(ownerId) ? a : null;
  };
  let tick = 0;
  return {
    async list(ownerId) { return mine(ownerId).sort((a, b) => b.seq - a.seq).map(plain); },
    async usage(ownerId) { const l = mine(ownerId); return { count: l.length, bytes: l.reduce((n, a) => n + a.size, 0) }; },
    async findByHash(ownerId, hash) { return plain(mine(ownerId).find((a) => a.hash === hash) || null); },
    async create(fields) {
      if (mine(fields.ownerId).some((a) => a.hash === fields.hash)) {
        const e = new Error('duplicate asset'); e.code = 11000; throw e;
      }
      const a = {
        _id: new mongoose.Types.ObjectId().toString(), ...fields, ownerId: String(fields.ownerId),
        data: Buffer.from(fields.data), thumb: null, thumbMime: null, createdAt: new Date().toISOString(), seq: ++tick,
      };
      assets.set(a._id, a);
      return plain(a);
    },
    async getFile(id) {
      const a = assets.get(String(id));
      return a ? { data: Buffer.from(a.data), mime: a.mime, size: a.size } : null;
    },
    async getThumb(id) {
      const a = assets.get(String(id));
      return a && a.thumb ? { data: Buffer.from(a.thumb), mime: a.thumbMime } : null;
    },
    async setThumb(id, ownerId, data, mime) {
      const a = own(id, ownerId);
      if (!a) return null;
      a.thumb = Buffer.from(data);
      a.thumbMime = mime;
      return plain(a);
    },
    async rename(id, ownerId, name) {
      const a = own(id, ownerId);
      if (!a) return null;
      a.name = name;
      return plain(a);
    },
    async remove(id, ownerId) {
      if (!own(id, ownerId)) return false;
      assets.delete(String(id));
      return true;
    },
    async ownedIds(ownerId, ids) {
      return (ids || []).filter((i) => own(i, ownerId)).map(String);
    },
  };
}

module.exports = { createMongoAssetStore, createMemoryAssetStore };

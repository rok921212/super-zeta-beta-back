// Persistence for uploaded Designer fonts, behind the same kind of small
// interface as services/customThemeStore.js so the controller can be tested
// against an in-memory store with the SAME semantics as the Mongo one.
//
// Interface (all async, plain objects):
//   list(ownerId)                                  -> [{ _id, family, size, createdAt }] oldest first (never the bytes)
//   count(ownerId)                                 -> number
//   create({ ownerId, family, familyKey, size, data }) -> font meta   (dup (ownerId, familyKey) throws code 11000)
//   getFile(id)                                    -> { data: Buffer, size } | null   (public: not owner-scoped)
//   remove(id, ownerId)                            -> boolean

const mongoose = require('mongoose');

const META_FIELDS = 'ownerId family size createdAt';

const plain = (f) => f && ({
  _id: String(f._id),
  ownerId: String(f.ownerId),
  family: f.family,
  size: f.size,
  createdAt: f.createdAt,
});

function createMongoFontStore({ connection } = {}) {
  const OverlayFont = require('../models/overlayFont.model.js').modelFor(connection || mongoose.connection);
  return {
    list: async (ownerId) => (await OverlayFont.find({ ownerId }).select(META_FIELDS).sort({ createdAt: 1 }).lean()).map(plain),
    count: (ownerId) => OverlayFont.countDocuments({ ownerId }),
    create: async (fields) => plain((await OverlayFont.create(fields)).toObject()),
    getFile: async (id) => {
      // Not lean(): a hydrated document gives a real Buffer, lean() a BSON Binary.
      const f = await OverlayFont.findById(id).select('data size');
      return f ? { data: Buffer.from(f.data), size: f.size } : null;
    },
    remove: async (id, ownerId) => (await OverlayFont.deleteOne({ _id: id, ownerId })).deletedCount > 0,
  };
}

function createMemoryFontStore() {
  const fonts = new Map();
  const mine = (ownerId) => [...fonts.values()].filter((f) => String(f.ownerId) === String(ownerId));
  return {
    async list(ownerId) {
      return mine(ownerId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(plain);
    },
    async count(ownerId) { return mine(ownerId).length; },
    async create(fields) {
      if (mine(fields.ownerId).some((f) => f.familyKey === fields.familyKey)) {
        const e = new Error('duplicate font family'); e.code = 11000; throw e;
      }
      const f = {
        _id: new mongoose.Types.ObjectId().toString(), ...fields, ownerId: String(fields.ownerId),
        data: Buffer.from(fields.data), createdAt: new Date().toISOString(),
      };
      fonts.set(f._id, f);
      return plain(f);
    },
    async getFile(id) {
      const f = fonts.get(String(id));
      return f ? { data: Buffer.from(f.data), size: f.size } : null;
    },
    async remove(id, ownerId) {
      const f = fonts.get(String(id));
      if (!f || String(f.ownerId) !== String(ownerId)) return false;
      fonts.delete(String(id));
      return true;
    },
  };
}

module.exports = { createMongoFontStore, createMemoryFontStore };

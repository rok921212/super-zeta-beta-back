// Persistence for the design categories an account made itself. Same shape as
// the other Designer stores: a Mongo store and an in-memory one with the same
// semantics, so the controller is tested without a database.
//
// Interface (all async, plain objects):
//   list(ownerId)                    -> [{ _id, name, createdAt }] by name
//   get(id, ownerId)                 -> category | null
//   create({ ownerId, name, nameKey }) -> category   (dup (ownerId, nameKey) throws code 11000)
//   rename(id, ownerId, name, nameKey) -> category | null   (dup throws code 11000)
//   remove(id, ownerId)              -> boolean

const mongoose = require('mongoose');

const plain = (c) => c && ({ _id: String(c._id), ownerId: String(c.ownerId), name: c.name, createdAt: c.createdAt });

function createMongoCategoryStore({ connection } = {}) {
  const OverlayCategory = require('../models/overlayCategory.model.js').modelFor(connection || mongoose.connection);
  return {
    list: async (ownerId) => (await OverlayCategory.find({ ownerId }).sort({ nameKey: 1 }).lean()).map(plain),
    get: async (id, ownerId) => plain(await OverlayCategory.findOne({ _id: id, ownerId }).lean()),
    create: async (fields) => plain((await OverlayCategory.create(fields)).toObject()),
    rename: async (id, ownerId, name, nameKey) => plain(await OverlayCategory.findOneAndUpdate(
      { _id: id, ownerId }, { $set: { name, nameKey } }, { new: true, lean: true }
    )),
    remove: async (id, ownerId) => (await OverlayCategory.deleteOne({ _id: id, ownerId })).deletedCount > 0,
  };
}

function createMemoryCategoryStore() {
  const cats = new Map();
  const mine = (ownerId) => [...cats.values()].filter((c) => String(c.ownerId) === String(ownerId));
  const own = (id, ownerId) => {
    const c = cats.get(String(id));
    return c && String(c.ownerId) === String(ownerId) ? c : null;
  };
  const dup = () => { const e = new Error('duplicate category'); e.code = 11000; return e; };
  return {
    async list(ownerId) { return mine(ownerId).sort((a, b) => a.nameKey.localeCompare(b.nameKey)).map(plain); },
    async get(id, ownerId) { return plain(own(id, ownerId)); },
    async create(fields) {
      if (mine(fields.ownerId).some((c) => c.nameKey === fields.nameKey)) throw dup();
      const c = { _id: new mongoose.Types.ObjectId().toString(), ...fields, ownerId: String(fields.ownerId), createdAt: new Date().toISOString() };
      cats.set(c._id, c);
      return plain(c);
    },
    async rename(id, ownerId, name, nameKey) {
      const c = own(id, ownerId);
      if (!c) return null;
      if (mine(ownerId).some((o) => o !== c && o.nameKey === nameKey)) throw dup();
      c.name = name;
      c.nameKey = nameKey;
      return plain(c);
    },
    async remove(id, ownerId) {
      if (!own(id, ownerId)) return false;
      cats.delete(String(id));
      return true;
    },
  };
}

module.exports = { createMongoCategoryStore, createMemoryCategoryStore };

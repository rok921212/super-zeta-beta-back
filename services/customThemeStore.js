// Persistence for custom themes (Theme9+), behind the same kind of small
// interface as services/overlayLayoutStore.js so the controller can be tested
// against an in-memory store with the SAME semantics as the Mongo one.
//
// Interface (all async, plain objects):
//   list(ownerId)                          -> themes, number ascending
//   get(id, ownerId)                       -> theme | null
//   maxNumber(ownerId)                     -> number | 0
//   create({ ownerId, number, name })      -> theme   (dup (ownerId, number) throws code 11000)
//   rename(id, ownerId, name)              -> theme | null
//   remove(id, ownerId)                    -> boolean
//   setSlot(id, ownerId, viewKey, layoutId|null) -> theme | null
//       A layout lives in at most ONE slot across the owner's themes: assigning
//       it first removes it everywhere else; the view's previous layout is replaced.
//   clearLayout(ownerId, layoutId)         -> void    (layout deleted)

const mongoose = require('mongoose');

const plain = (t) => t && ({
  _id: String(t._id),
  ownerId: String(t.ownerId),
  number: t.number,
  name: t.name,
  slots: (t.slots || []).map((s) => ({ viewKey: s.viewKey, layoutId: String(s.layoutId) })),
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

function createMongoThemeStore({ connection } = {}) {
  const CustomTheme = require('../models/customTheme.model.js').modelFor(connection || mongoose.connection);
  const opts = { new: true, lean: true };
  return {
    list: async (ownerId) => (await CustomTheme.find({ ownerId }).sort({ number: 1 }).lean()).map(plain),
    get: async (id, ownerId) => plain(await CustomTheme.findOne({ _id: id, ownerId }).lean()),
    maxNumber: async (ownerId) => {
      const top = await CustomTheme.findOne({ ownerId }).sort({ number: -1 }).select('number').lean();
      return top ? top.number : 0;
    },
    create: async (fields) => plain((await CustomTheme.create({ ...fields, slots: [] })).toObject()),
    rename: async (id, ownerId, name) => plain(await CustomTheme.findOneAndUpdate({ _id: id, ownerId }, { $set: { name } }, opts)),
    remove: async (id, ownerId) => (await CustomTheme.deleteOne({ _id: id, ownerId })).deletedCount > 0,
    setSlot: async (id, ownerId, viewKey, layoutId) => {
      const exists = await CustomTheme.exists({ _id: id, ownerId });
      if (!exists) return null;
      if (layoutId) await CustomTheme.updateMany({ ownerId }, { $pull: { slots: { layoutId } } });
      await CustomTheme.updateOne({ _id: id, ownerId }, { $pull: { slots: { viewKey } } });
      if (layoutId) await CustomTheme.updateOne({ _id: id, ownerId }, { $push: { slots: { viewKey, layoutId } } });
      return plain(await CustomTheme.findOne({ _id: id, ownerId }).lean());
    },
    clearLayout: async (ownerId, layoutId) => {
      await CustomTheme.updateMany({ ownerId }, { $pull: { slots: { layoutId } } });
    },
  };
}

function createMemoryThemeStore() {
  const themes = new Map();
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const find = (id, ownerId) => {
    const t = themes.get(String(id));
    return t && String(t.ownerId) === String(ownerId) ? t : null;
  };
  const touch = (t) => { t.updatedAt = new Date().toISOString(); };
  const mine = (ownerId) => [...themes.values()].filter((t) => String(t.ownerId) === String(ownerId));
  return {
    async list(ownerId) { return clone(mine(ownerId).sort((a, b) => a.number - b.number)); },
    async get(id, ownerId) { return clone(find(id, ownerId)); },
    async maxNumber(ownerId) { return mine(ownerId).reduce((m, t) => Math.max(m, t.number), 0); },
    async create(fields) {
      if (mine(fields.ownerId).some((t) => t.number === fields.number)) {
        const e = new Error('duplicate theme number'); e.code = 11000; throw e;
      }
      const now = new Date().toISOString();
      const t = { _id: new mongoose.Types.ObjectId().toString(), ...clone(fields), ownerId: String(fields.ownerId), slots: [], createdAt: now, updatedAt: now };
      themes.set(t._id, t);
      return clone(t);
    },
    async rename(id, ownerId, name) {
      const t = find(id, ownerId);
      if (!t) return null;
      t.name = name;
      touch(t);
      return clone(t);
    },
    async remove(id, ownerId) {
      if (!find(id, ownerId)) return false;
      themes.delete(String(id));
      return true;
    },
    async setSlot(id, ownerId, viewKey, layoutId) {
      const t = find(id, ownerId);
      if (!t) return null;
      if (layoutId) for (const o of mine(ownerId)) o.slots = o.slots.filter((s) => s.layoutId !== String(layoutId));
      t.slots = t.slots.filter((s) => s.viewKey !== viewKey);
      if (layoutId) t.slots.push({ viewKey, layoutId: String(layoutId) });
      touch(t);
      return clone(t);
    },
    async clearLayout(ownerId, layoutId) {
      for (const o of mine(ownerId)) o.slots = o.slots.filter((s) => s.layoutId !== String(layoutId));
    },
  };
}

module.exports = { createMongoThemeStore, createMemoryThemeStore };

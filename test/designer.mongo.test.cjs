'use strict';
// Designer API against a REAL MongoDB (the Mongo stores, not the memory ones)
// in a throwaway database that is dropped afterwards. Catches cast / lean /
// ObjectId / index differences the memory store can't. Opt-in:
//
//   MONGO_IT=1 npm test   (OVERLAY_MONGODB_URI from .env — the overlay cluster —
//                          else MONGODB_URI; throwaway db designer_it_<ts>)

const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.MONGO_IT === '1';

test('designer on real MongoDB', { skip: !ENABLED && 'set MONGO_IT=1 to run' }, async (t) => {
  require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
  require('node:dns').setServers(['8.8.8.8', '8.8.4.4']);
  const mongoose = require('mongoose');
  const { startDesignerApp } = require('./helpers/designerApp.cjs');
  const { createMongoStore } = require('../services/overlayLayoutStore.js');
  const { createMongoThemeStore } = require('../services/customThemeStore.js');
  const { createMongoFontStore } = require('../services/overlayFontStore.js');
  const { withLayoutCache, withThemeCache, withFontCache, createMemoryBackend } = require('../services/designerCache.js');
  const backend = createMemoryBackend();
  const schema = require('../utils/layoutSchema.generated.cjs');

  const dbName = `designer_it_${Date.now()}`;
  const uri = process.env.OVERLAY_MONGODB_URI || process.env.MONGODB_URI;
  const conn = await mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 20000, family: 4 }).asPromise();
  // Build the unique indexes up front (publicId, (layoutId, rev), (ownerId, number)).
  await Promise.all(['overlayLayout', 'overlayLayoutRevision', 'customTheme', 'overlayFont'].map((m) => require(`../models/${m}.model.js`).modelFor(conn).init()));
  const app = await startDesignerApp({
    // exactly as index.js wires them: every store behind the Designer cache
    layoutStore: withLayoutCache(createMongoStore({ connection: conn }), { backend }),
    themeStore: withThemeCache(createMongoThemeStore({ connection: conn }), { backend }),
    fontStore: withFontCache(createMongoFontStore({ connection: conn }), { backend }),
  });
  const A = '65f0000000000000000000a1';
  const B = '65f0000000000000000000b2';
  const el = { id: 't1', type: 'text', x: 0, y: 0, w: 100, h: 40, text: 'hi', bind: { text: { path: 'tournament.tournamentName' } }, style: { color: { ref: 'theme.colors.text' } } };

  try {
    await t.test('create / list / get / owner isolation', async () => {
      const c = await app.call('POST', '/api/overlay-layouts', { user: A, body: { name: 'IT', draft: { ...schema.createEmptyLayout(), elements: [el] } } });
      assert.equal(c.status, 201, JSON.stringify(c.json));
      assert.equal(c.json.draftRev, 1);
      const list = await app.call('GET', '/api/overlay-layouts', { user: A });
      assert.equal(list.json.length, 1);
      assert.equal(list.json[0].draft, undefined, 'list has no draft');
      assert.equal((await app.call('GET', `/api/overlay-layouts/${c.json._id}`, { user: A })).json.draft.elements[0].id, 't1');
      assert.equal((await app.call('GET', `/api/overlay-layouts/${c.json._id}`, { user: B })).status, 404);
      assert.equal((await app.call('GET', '/api/overlay-layouts/not-an-id', { user: A })).status, 404);
    });

    let id; let publicId;
    await t.test('autosave + 409 + meta', async () => {
      const [l] = (await app.call('GET', '/api/overlay-layouts', { user: A })).json;
      id = l._id; publicId = l.publicId;
      const s = await app.call('PUT', `/api/overlay-layouts/${id}`, { user: A, body: { expectedRev: 1, draft: { ...schema.createEmptyLayout(), elements: [el, { ...el, id: 't2' }] }, name: 'IT2', defaults: { tournamentId: '65f0000000000000000000d1', roundId: '65f0000000000000000000d2', matchMode: 'liveMatch' } } });
      assert.equal(s.status, 200, JSON.stringify(s.json));
      assert.equal(s.json.draftRev, 2);
      assert.equal(s.json.defaults.matchMode, 'liveMatch');
      const stale = await app.call('PUT', `/api/overlay-layouts/${id}`, { user: A, body: { expectedRev: 1, name: 'x' } });
      assert.equal(stale.status, 409);
      assert.equal(stale.json.currentRev, 2);
    });

    await t.test('render 404 before publish; publish immutable; republish', async () => {
      assert.equal((await app.call('GET', `/api/overlay-render/${publicId}`)).status, 404);
      const p = await app.call('POST', `/api/overlay-layouts/${id}/publish`, { user: A, body: { expectedRev: 2 } });
      assert.equal(p.status, 200, JSON.stringify(p.json));
      assert.equal(p.json.publishedRev, 1);
      await app.call('PUT', `/api/overlay-layouts/${id}`, { user: A, body: { expectedRev: 2, draft: schema.createEmptyLayout() } });
      const r = await app.call('GET', `/api/overlay-render/${publicId}`);
      assert.equal(r.status, 200);
      assert.equal(r.json.published.elements.length, 2, 'published copy unchanged by the later autosave');
      assert.equal(r.json.defaults.roundId, '65f0000000000000000000d2');
      const revs = await app.call('GET', `/api/overlay-layouts/${id}/revisions`, { user: A });
      assert.deepEqual(revs.json.map((x) => x.rev), [1]);
    });

    await t.test('restore / duplicate / lock / delete', async () => {
      const cur = (await app.call('GET', `/api/overlay-layouts/${id}`, { user: A })).json;
      const rs = await app.call('POST', `/api/overlay-layouts/${id}/revisions/1/restore`, { user: A, body: { expectedRev: cur.draftRev } });
      assert.equal(rs.status, 200, JSON.stringify(rs.json));
      assert.equal(rs.json.draft.elements.length, 2);
      const dup = await app.call('POST', `/api/overlay-layouts/${id}/duplicate`, { user: A });
      assert.equal(dup.status, 201, JSON.stringify(dup.json));
      assert.notEqual(dup.json.publicId, publicId);
      assert.equal(dup.json.publishedRev, 0);
      assert.equal((await app.call('POST', `/api/overlay-layouts/${id}/lock`, { user: A })).json.productionLocked, true);
      assert.equal((await app.call('PUT', `/api/overlay-layouts/${id}`, { user: A, body: { expectedRev: rs.json.draftRev, name: 'y' } })).status, 423);
      assert.equal((await app.call('DELETE', `/api/overlay-layouts/${id}`, { user: A })).status, 423);
      await app.call('POST', `/api/overlay-layouts/${id}/unlock`, { user: A });
      assert.equal((await app.call('DELETE', `/api/overlay-layouts/${dup.json._id}`, { user: A })).status, 204);
    });

    await t.test('custom themes on Mongo', async () => {
      const t9 = await app.call('POST', '/api/custom-themes', { user: A, body: {} });
      assert.equal(t9.status, 201, JSON.stringify(t9.json));
      assert.equal(t9.json.number, 9);
      const t10 = (await app.call('POST', '/api/custom-themes', { user: A, body: {} })).json;
      assert.equal(t10.number, 10);
      let s = await app.call('PUT', `/api/custom-themes/${t9.json._id}/slots/Lower`, { user: A, body: { layoutId: id } });
      assert.equal(s.status, 200, JSON.stringify(s.json));
      assert.deepEqual(s.json.slots.map((x) => [x.viewKey, x.publishedRev]), [['Lower', 1]]);
      s = await app.call('PUT', `/api/custom-themes/${t10._id}/slots/Alerts`, { user: A, body: { layoutId: id } });
      assert.deepEqual(s.json.slots.map((x) => x.viewKey), ['Alerts']);
      const list = (await app.call('GET', '/api/custom-themes', { user: A })).json;
      assert.equal(list.find((x) => x.number === 9).slots.length, 0, 'moved out of Theme9');
      assert.equal((await app.call('DELETE', `/api/overlay-layouts/${id}`, { user: A })).status, 204);
      const after = (await app.call('GET', '/api/custom-themes', { user: A })).json;
      assert.equal(after.find((x) => x.number === 10).slots.length, 0, 'deleted layout cleared from its slot');
    });

    await t.test('cache on Mongo: cached lookups survive serialisation, 304 without the draft, fresh after a write', async () => {
      const l = (await app.call('POST', '/api/overlay-layouts', { user: A, body: { name: 'Cached', draft: { ...schema.createEmptyLayout(), elements: [el] } } })).json;
      await app.call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: A, body: {} });
      const r1 = await app.call('GET', `/api/overlay-render/${l.publicId}`);
      const r2 = await app.call('GET', `/api/overlay-render/${l.publicId}`); // from the cache
      assert.equal(r1.status, 200);
      assert.deepEqual(r2.json, r1.json);
      assert.equal((await app.call('GET', `/api/overlay-render/${l.publicId}`, { headers: { 'if-none-match': r1.headers.get('etag') } })).status, 304);

      const full = await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: A });
      const etag = full.headers.get('etag');
      assert.equal((await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: A, headers: { 'if-none-match': etag } })).status, 304);
      assert.equal((await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: B, headers: { 'if-none-match': etag } })).status, 404);

      const list1 = (await app.call('GET', '/api/overlay-layouts', { user: A })).json;
      const list2 = (await app.call('GET', '/api/overlay-layouts', { user: A })).json; // cached
      assert.deepEqual(list2, list1);
      await app.call('PUT', `/api/overlay-layouts/${l._id}`, { user: A, body: { expectedRev: full.json.draftRev, name: 'Cached 2' } });
      assert.ok((await app.call('GET', '/api/overlay-layouts', { user: A })).json.some((x) => x.name === 'Cached 2'), 'the list is fresh after a save');
      assert.equal((await app.call('GET', `/api/overlay-layouts/${l._id}`, { user: A, headers: { 'if-none-match': etag } })).status, 200);
      assert.equal((await app.call('GET', `/api/overlay-layouts/${l._id}/revisions`, { user: A })).json.length, 1);
      assert.equal((await app.call('DELETE', `/api/overlay-layouts/${l._id}`, { user: A })).status, 204);
      assert.equal((await app.call('GET', `/api/overlay-render/${l.publicId}`)).status, 404, 'a deleted overlay is not served from the cache');
    });

    await t.test('fonts on Mongo: bytes round-trip, unique name, publish snapshot', async () => {
      // A real shipped .woff2 if the front checkout is beside us, else a synthetic header.
      const real = require('node:path').join(__dirname, '..', '..', '..', 'front', 'src', 'assets', 'fonts', 'Bebas.woff2');
      let bytes;
      try { bytes = require('node:fs').readFileSync(real); } catch {
        bytes = Buffer.alloc(64, 7);
        bytes.writeUInt32BE(0x774f4632, 0);
        bytes.writeUInt32BE(64, 8);
      }
      const post = (name, user) => fetch(`${app.base}/api/overlay-fonts?name=${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'content-type': 'font/woff2', 'x-test-user': user }, body: bytes,
      });
      const up = await post('IT Font', A);
      assert.equal(up.status, 201);
      const font = await up.json();
      assert.equal(font.size, bytes.length);
      assert.equal((await post('it font', A)).status, 409, 'unique per owner, case-insensitive');
      assert.equal((await post('IT Font', B)).status, 201);

      const list = (await app.call('GET', '/api/overlay-fonts', { user: A })).json;
      assert.deepEqual(list.map((f) => [f._id, f.family, f.data]), [[font._id, 'IT Font', undefined]]);

      const file = await fetch(`${app.base}/api/overlay-fonts/file/${font._id}`);
      assert.equal(file.headers.get('content-type'), 'font/woff2');
      assert.ok(Buffer.from(await file.arrayBuffer()).equals(bytes), 'bytes survive the Mongo round-trip');

      const l = (await app.call('POST', '/api/overlay-layouts', { user: A, body: { name: 'F', draft: schema.createEmptyLayout() } })).json;
      assert.equal((await app.call('POST', `/api/overlay-layouts/${l._id}/publish`, { user: A, body: {} })).status, 200);
      assert.deepEqual((await app.call('GET', `/api/overlay-render/${l.publicId}`)).json.fonts, [{ id: font._id, family: 'IT Font' }]);

      assert.equal((await app.call('DELETE', `/api/overlay-fonts/${font._id}`, { user: B })).status, 404);
      assert.equal((await app.call('DELETE', `/api/overlay-fonts/${font._id}`, { user: A })).status, 204);
      assert.equal((await fetch(`${app.base}/api/overlay-fonts/file/${font._id}`)).status, 404);
    });
  } finally {
    await app.close();
    await conn.db.dropDatabase();
    await conn.close();
  }
});

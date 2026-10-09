'use strict';
// Builds the Designer API (layouts + render + custom themes) on an ephemeral
// port with a stand-in for index.js's JWT shim (x-test-user header). Used by
// the memory-store suites and the real-Mongo integration suite.

const http = require('node:http');
const express = require('express');
const requireAuth = require('../../authMiddleware.js');
const { createOverlayLayoutRouters } = require('../../route/overlayLayout.route.js');
const { createCustomThemeRouter } = require('../../route/customTheme.route.js');
const { createOverlayFontRouter } = require('../../route/overlayFont.route.js');
const { createMemoryFontStore } = require('../../services/overlayFontStore.js');
const { createOverlayAssetRouter } = require('../../route/overlayAsset.route.js');
const { createMemoryAssetStore } = require('../../services/overlayAssetStore.js');
const { createOverlayCategoryRouter } = require('../../route/overlayCategory.route.js');
const { createMemoryCategoryStore } = require('../../services/overlayCategoryStore.js');

async function startDesignerApp({
  layoutStore, themeStore, fontStore = createMemoryFontStore(),
  assetStore = createMemoryAssetStore(), categoryStore = createMemoryCategoryStore(), overlayAvailable = () => true,
}) {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use((req, res, next) => {
    req.session = {};
    if (req.headers['x-test-user']) req.session.userId = req.headers['x-test-user'];
    next();
  });
  const routers = createOverlayLayoutRouters({ store: layoutStore, auth: requireAuth, themeStore, fontStore, assetStore, categoryStore });
  app.use('/api/overlay-assets', createOverlayAssetRouter({ assetStore, layoutStore, auth: requireAuth, available: overlayAvailable }));
  app.use('/api/overlay-categories', createOverlayCategoryRouter({ categoryStore, layoutStore, auth: requireAuth, available: overlayAvailable }));
  app.use('/api/overlay-layouts', routers.layouts);
  app.use('/api/overlay-render', routers.render);
  app.use('/api/overlay-fonts', createOverlayFontRouter({ fontStore, auth: requireAuth }));
  app.use('/api/custom-themes', createCustomThemeRouter({ themeStore, layoutStore, fontStore, assetStore, auth: requireAuth }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, url, { user, body, headers = {} } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(user ? { 'x-test-user': user } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  }

  return { base, call, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { startDesignerApp };

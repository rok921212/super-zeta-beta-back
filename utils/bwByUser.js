// Per-account egress attribution.
//
// [bw][rollup] and [bw][sockets] say how many bytes left the process, not
// WHOSE they were — so "two operators live at once costs 10x one operator"
// could not be pinned on an account, a client kind or a route. This keeps one
// row per owner key since the last reset:
//
//   <userId>          an authenticated request / socket
//   t:<tournamentId>  an anonymous public request / round-room socket (the
//                     relay and OBS overlays carry no login); folded onto the
//                     tournament's owner when the admin endpoint reads it
//   anon              anything else
//
// Hot-path calls are plain map bumps — no DB, no async.

const MAX_ROUTES_PER_OWNER = 100;
const OBJECT_ID_RE = /[a-f0-9]{24}/i;
const OBJECT_ID_RE_G = /[a-f0-9]{24}/gi;
const USER_ID_RE = /^[a-f0-9]{24}$/i;

const owners = new Map(); // owner key -> row
let since = Date.now();

function rowOf(key) {
  let r = owners.get(key);
  if (!r) {
    r = { httpWire: 0, httpReqs: 0, routes: new Map(), cacheWrite: 0, wsWire: 0, wsByKind: new Map(), wsConnects: new Map() };
    owners.set(key, r);
  }
  return r;
}

function bump(map, key, n = 1) {
  map.set(key, (map.get(key) || 0) + n);
}

function httpOwner(req) {
  const uid = req.session?.userId;
  if (uid) return String(uid);
  const url = req.originalUrl || req.url || '';
  if (url.startsWith('/api/public/')) {
    const m = OBJECT_ID_RE.exec(url);
    if (m) return `t:${m[0].toLowerCase()}`;
  }
  return 'anon';
}

// A cache scope is a userId, `round:<tid>:<rid>`, `public:tournament:<tid>`,
// an express sessionID or 'anon' (see middleware/cache.js).
function scopeOwner(scope) {
  const s = String(scope || '');
  if (USER_ID_RE.test(s)) return s;
  const m = /(?:^round:|tournament:)([a-f0-9]{24})/i.exec(s);
  return m ? `t:${m[1].toLowerCase()}` : 'anon';
}

function addHttp(req, bytes) {
  const r = rowOf(httpOwner(req));
  r.httpWire += bytes;
  r.httpReqs++;
  const path = (req.originalUrl || req.url || '').split('?')[0].replace(OBJECT_ID_RE_G, ':id');
  const route = `${req.method} ${path}`;
  const key = r.routes.has(route) || r.routes.size < MAX_ROUTES_PER_OWNER ? route : '(other)';
  let e = r.routes.get(key);
  if (!e) { e = { count: 0, bytes: 0 }; r.routes.set(key, e); }
  e.count++;
  e.bytes += bytes;
}

function addCacheWrite(scope, bytes) {
  rowOf(scopeOwner(scope)).cacheWrite += bytes;
}

function addWs(owner, kind, bytes) {
  const r = rowOf(owner || 'anon');
  r.wsWire += bytes;
  bump(r.wsByKind, kind, bytes);
}

function addWsConnect(owner, kind) {
  bump(rowOf(owner || 'anon').wsConnects, kind);
}

function snapshot() {
  const rows = [];
  for (const [owner, r] of owners) {
    rows.push({
      owner,
      httpWire: r.httpWire,
      httpReqs: r.httpReqs,
      cacheWrite: r.cacheWrite,
      wsWire: r.wsWire,
      wsByKind: Object.fromEntries(r.wsByKind),
      wsConnects: Object.fromEntries(r.wsConnects),
      routes: [...r.routes.entries()].map(([route, v]) => ({ route, ...v })),
    });
  }
  return { since, rows };
}

function reset() {
  owners.clear();
  since = Date.now();
}

module.exports = { addHttp, addCacheWrite, addWs, addWsConnect, snapshot, reset };

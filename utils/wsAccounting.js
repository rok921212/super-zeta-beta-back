// Per-socket / per-event WebSocket egress accounting.
//
// Why this exists: [bw][rollup]'s ws_fanout only counts the emits that go
// through roomEmit.js (+ the user: delta), pre-perMessageDeflate, and says
// nothing about WHICH client received the bytes. That left a Render
// "~100 MB WebSocket response per match session" unexplainable from logs.
//
// Two independent measurements per socket:
//   - wire bytes : delta of the raw TCP socket's bytesWritten — the actual
//                  post-deflate bytes incl. framing + engine.io ping/pong.
//                  TLS terminates at Render's proxy, so this is the metered
//                  WS response traffic.
//   - event bytes: socket.io packet sizes (pre-deflate) tallied by event
//                  name via engine.io 'packetCreate'. Sees EVERY outbound
//                  packet — room broadcasts, socket.emit, acks — including
//                  the ones addWsFanout never counted.
//
// Client kind comes from the handshake query `client=` (relay | hub |
// overlay | dashboard), with registerRelay-authenticated sockets reclassified
// to `fetcher` via markKind(). Old builds that send nothing are `unknown`
// (JWT-bearing -> `unknown-auth`).

const WINDOW_MS = 60000;
const TOP_N = 8;

const sockets = new Map(); // socket.id -> entry

function zeroTotals() {
  return { wire: 0, events: new Map(), byKind: new Map(), connects: new Map(), disconnects: new Map() };
}
let windowTotals = zeroTotals();
const sinceBoot = zeroTotals();
const bootedAt = Date.now();

function bump(map, key, n = 1) {
  map.set(key, (map.get(key) || 0) + n);
}

function bumpEvent(map, kind, event, bytes) {
  const key = `${kind}|${event}`;
  let e = map.get(key);
  if (!e) { e = { count: 0, bytes: 0, max: 0 }; map.set(key, e); }
  e.count++;
  e.bytes += bytes;
  if (bytes > e.max) e.max = bytes;
}

function rawSocketOf(socket) {
  return socket.conn?.request?.socket || null;
}

function classify(socket) {
  const q = socket.handshake?.query?.client;
  if (typeof q === 'string' && q) return String(q).slice(0, 24);
  return socket.handshake?.auth?.token ? 'unknown-auth' : 'unknown';
}

// socket.io v4 text packet: `<type>[<attachments>-][<nsp>,][<ackId>]<json>`.
// Types 2=EVENT 3=ACK 5=BINARY_EVENT 6=BINARY_ACK.
function parseTextPacket(str) {
  const type = str.charCodeAt(0) - 48;
  let attachments = 0;
  if (type === 5 || type === 6) {
    const dash = str.indexOf('-');
    if (dash > 0) attachments = Number(str.slice(1, dash)) || 0;
  }
  if (type === 3 || type === 6) return { name: 'ack', attachments };
  if (type === 2 || type === 5) {
    const m = /\["([^"]{1,64})"/.exec(str.slice(0, 200));
    return { name: m ? m[1] : 'event?', attachments };
  }
  if (type === 0) return { name: 'sio:connect', attachments: 0 };
  if (type === 1) return { name: 'sio:disconnect', attachments: 0 };
  return { name: `sio:type${type}`, attachments: 0 };
}

function track(socket) {
  const kind = classify(socket);
  const raw = rawSocketOf(socket);
  const entry = {
    id: socket.id,
    kind,
    view: null,
    connectedAt: Date.now(),
    recovered: !!socket.recovered,
    transport: socket.conn?.transport?.name,
    raw,
    lastWritten: raw ? raw.bytesWritten : 0,
    windowWire: 0,
    totalWire: 0,
    pendingEvent: null,
    pendingAttachments: 0,
  };
  sockets.set(socket.id, entry);
  bump(windowTotals.connects, kind);
  bump(sinceBoot.connects, kind);

  socket.conn.on('packetCreate', (packet) => {
    let name;
    let bytes = 0;
    if (packet.type !== 'message') {
      name = `eio:${packet.type}`;
      bytes = 1;
    } else if (typeof packet.data === 'string') {
      const parsed = parseTextPacket(packet.data);
      name = parsed.name;
      bytes = Buffer.byteLength(packet.data);
      entry.pendingEvent = parsed.attachments > 0 ? name : null;
      entry.pendingAttachments = parsed.attachments;
    } else {
      // Binary attachment of the preceding BINARY_EVENT.
      name = entry.pendingAttachments > 0 ? entry.pendingEvent : 'binary?';
      if (entry.pendingAttachments > 0) entry.pendingAttachments--;
      bytes = packet.data?.byteLength ?? packet.data?.length ?? 0;
    }
    bumpEvent(windowTotals.events, entry.kind, name, bytes);
    bumpEvent(sinceBoot.events, entry.kind, name, bytes);
  });

  // Transport upgrade (polling -> websocket) swaps the underlying request.
  socket.conn.on('upgrade', () => {
    sampleWire(entry);
    entry.raw = rawSocketOf(socket);
    entry.lastWritten = entry.raw ? entry.raw.bytesWritten : 0;
    entry.transport = socket.conn?.transport?.name;
  });

  socket.on('disconnect', (reason) => {
    sampleWire(entry);
    bump(windowTotals.disconnects, entry.kind);
    bump(sinceBoot.disconnects, entry.kind);
    const lifetimeS = Math.round((Date.now() - entry.connectedAt) / 1000);
    console.log(`[ws] DISCONNECT socket=${entry.id} kind=${entry.kind} view=${entry.view ?? '-'} reason=${reason} lifetime=${lifetimeS}s wire=${entry.totalWire}`);
    sockets.delete(socket.id);
  });

  console.log(`[ws] CONNECT socket=${socket.id} kind=${kind} transport=${entry.transport}${entry.recovered ? ' (recovered)' : ''}`);
}

function sampleWire(entry) {
  const raw = entry.raw;
  if (!raw) return;
  const now = raw.bytesWritten;
  const d = Math.max(0, now - entry.lastWritten);
  entry.lastWritten = now;
  entry.windowWire += d;
  entry.totalWire += d;
  windowTotals.wire += d;
  sinceBoot.wire += d;
  bump(windowTotals.byKind, entry.kind, d);
  bump(sinceBoot.byKind, entry.kind, d);
}

function markKind(socketId, kind) {
  const e = sockets.get(socketId);
  if (e) e.kind = kind;
}

function setView(socketId, view) {
  const e = sockets.get(socketId);
  if (e) e.view = view;
}

function eventTable(map, limit) {
  return [...map.entries()]
    .map(([key, v]) => { const [kind, event] = key.split('|'); return { kind, event, ...v, avg: Math.round(v.bytes / v.count) }; })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

function activeByKind() {
  const out = {};
  for (const e of sockets.values()) out[e.kind] = (out[e.kind] || 0) + 1;
  return out;
}

setInterval(() => {
  for (const e of sockets.values()) sampleWire(e);
  const w = windowTotals;
  if (w.wire > 0 || w.events.size > 0) {
    const kinds = [...w.byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(',');
    const top = [...sockets.values()]
      .sort((a, b) => b.windowWire - a.windowWire)
      .slice(0, TOP_N)
      .filter((e) => e.windowWire > 0)
      .map((e) => `${e.id}:${e.kind}:${e.view ?? '-'}:${e.windowWire}`)
      .join(' ');
    const events = eventTable(w.events, TOP_N).map((r) => `${r.kind}/${r.event}:n=${r.count}:b=${r.bytes}`).join(' ');
    console.log(
      `[bw][sockets] window=60s wire=${w.wire} active=${JSON.stringify(activeByKind())} ` +
      `by_kind={${kinds}} connects=${JSON.stringify(Object.fromEntries(w.connects))} ` +
      `disconnects=${JSON.stringify(Object.fromEntries(w.disconnects))}`
    );
    console.log(`[bw][sockets] top_sockets ${top || '(none)'}`);
    console.log(`[bw][sockets] top_events(pre-deflate) ${events || '(none)'}`);
  }
  for (const e of sockets.values()) e.windowWire = 0;
  windowTotals = zeroTotals();
}, WINDOW_MS).unref();

function report() {
  for (const e of sockets.values()) sampleWire(e);
  return {
    since: new Date(bootedAt).toISOString(),
    uptimeSec: Math.round((Date.now() - bootedAt) / 1000),
    wireBytesTotal: sinceBoot.wire,
    wireByKind: Object.fromEntries(sinceBoot.byKind),
    connectsByKind: Object.fromEntries(sinceBoot.connects),
    disconnectsByKind: Object.fromEntries(sinceBoot.disconnects),
    active: activeByKind(),
    sockets: [...sockets.values()]
      .map((e) => ({
        id: e.id, kind: e.kind, view: e.view, transport: e.transport, recovered: e.recovered,
        lifetimeSec: Math.round((Date.now() - e.connectedAt) / 1000), wireBytes: e.totalWire,
      }))
      .sort((a, b) => b.wireBytes - a.wireBytes),
    eventsPreDeflate: eventTable(sinceBoot.events, 50),
  };
}

module.exports = { track, markKind, setView, report };

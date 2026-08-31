// Shared per-socket-format-split emit helper for the public overlay's
// round:${tid}:${rid}:matchData / :overall sub-rooms. Used by
// pubgApiMatchData.controller.js, matchData.controller.js, and
// overall.controller.js — all three emit liveMatchUpdate/overallDataUpdate
// to these rooms and need to agree on the same split logic.
//
// Splits the room's sockets by their negotiated wire format
// (socketFormatRegistry) and encodes ONCE PER FORMAT GROUP per tick, not
// once per socket — the whole point of a room broadcast. If protobuf
// mapping/encoding throws (a mapper bug, an unexpected payload shape), logs
// loudly and falls back to msgpack for that group rather than silently
// dropping the tick for every protobuf-negotiated client.
const { getSocketWireFormat } = require('./socketFormatRegistry');
const { encodeMsgpack } = require('./msgpackCodec');
const { encodeProtobuf } = require('./protobufCodec');
const { addWsFanout } = require('./bwCounters');

// Current joined-socket count for a room, 0 if the room doesn't exist.
// Callers use this to skip building/encoding a payload for a room nobody
// has joined (emitToRoomSplitByFormat already no-ops on an empty room, but
// the caller still pays for the payload object + any per-team transform it
// passes in).
function roomSize(io, roomName) {
  const ids = io.sockets.adapter.rooms.get(roomName);
  return ids ? ids.size : 0;
}

// Sockets in a room that are NOT the desktop relay's own connection. The
// relay registers via registerRelay (which sets socket.data.userId) and
// never listens for liveMatchUpdate, so it must not count as a live-data
// consumer of the user:<id> room.
function countNonRelaySockets(io, roomName) {
  const ids = io.sockets.adapter.rooms.get(roomName);
  if (!ids) return 0;
  let n = 0;
  for (const id of ids) {
    const s = io.sockets.sockets.get(id);
    if (s && !s.data?.userId) n++;
  }
  return n;
}

// `target` is either a room name (string, the original/common case — every
// existing call site) or an explicit iterable of socket IDs (used by
// joinRoundRoom's just-joined-socket hydration, which wants to address
// exactly one socket without waiting for/relying on room membership timing).
// Socket.IO gives every socket its own id-named room by default, so
// io.to(<array of socket ids>) already addresses them individually with no
// extra plumbing.
function emitToRoomSplitByFormat(io, target, event, { protoMessageName, mapToProto, data, volatile = true }) {
  const isRoom = typeof target === 'string';
  const socketIds = isRoom ? io.sockets.adapter.rooms.get(target) : target;
  const size = socketIds ? (socketIds.size ?? socketIds.length ?? 0) : 0;
  const label = isRoom ? target : `[hydrate ${size} socket(s)]`;

  if (!socketIds || size === 0) {
    console.log(`[bw][emit] ${event} -> ${label}: ${isRoom ? 'room empty' : 'no sockets'}, skipping encode`);
    return;
  }

  const protobufIds = [];
  const msgpackIds = [];
  for (const id of socketIds) {
    if (getSocketWireFormat(id) === 'protobuf') protobufIds.push(id);
    else msgpackIds.push(id);
  }
  console.log(`[bw][emit] ${event} -> ${label}: sockets=${size} protobuf=${protobufIds.length} msgpack=${msgpackIds.length}`);

  const emitTo = (ids) => (volatile ? io.to(ids).volatile : io.to(ids));

  if (protobufIds.length) {
    try {
      const encoded = encodeProtobuf(protoMessageName, mapToProto(data));
      emitTo(protobufIds).emit(event, encoded);
      addWsFanout(encoded.length * protobufIds.length);
      console.log(`[bw][emit] ${event} -> ${label} (protobuf): ${encoded.length} bytes x ${protobufIds.length} socket(s) = ${encoded.length * protobufIds.length} (pre-deflate)`);
    } catch (err) {
      console.error(`[bw][emit] protobuf encode FAILED for ${event} -> ${label}: ${err.message} — falling back to msgpack for these ${protobufIds.length} socket(s) this tick`, err.stack);
      const fallback = encodeMsgpack(data);
      emitTo(protobufIds).emit(event, fallback);
      addWsFanout(fallback.length * protobufIds.length);
    }
  }
  if (msgpackIds.length) {
    const encoded = encodeMsgpack(data);
    emitTo(msgpackIds).emit(event, encoded);
    addWsFanout(encoded.length * msgpackIds.length);
    console.log(`[bw][emit] ${event} -> ${label} (msgpack): ${encoded.length} bytes x ${msgpackIds.length} socket(s) = ${encoded.length * msgpackIds.length} (pre-deflate)`);
  }
}

module.exports = { emitToRoomSplitByFormat, roomSize, countNonRelaySockets };

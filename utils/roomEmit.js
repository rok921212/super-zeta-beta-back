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
      console.log(`[bw][emit] ${event} -> ${label} (protobuf): ${encoded.length} bytes to ${protobufIds.length} socket(s)`);
    } catch (err) {
      console.error(`[bw][emit] protobuf encode FAILED for ${event} -> ${label}: ${err.message} — falling back to msgpack for these ${protobufIds.length} socket(s) this tick`, err.stack);
      const fallback = encodeMsgpack(data);
      emitTo(protobufIds).emit(event, fallback);
    }
  }
  if (msgpackIds.length) {
    const encoded = encodeMsgpack(data);
    emitTo(msgpackIds).emit(event, encoded);
    console.log(`[bw][emit] ${event} -> ${label} (msgpack): ${encoded.length} bytes to ${msgpackIds.length} socket(s)`);
  }
}

module.exports = { emitToRoomSplitByFormat };

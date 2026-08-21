// Per-socket wire-format negotiation, shared across every controller that
// emits liveMatchUpdate/overallDataUpdate to a round:${tid}:${rid}:* room
// (pubgApiMatchData.controller.js, matchData.controller.js,
// overall.controller.js) so they all agree on who gets protobuf vs.
// msgpack without importing each other.
//
// Absence in this map means msgpack (today's format) — this is a
// PERMANENT negotiated default, not a migration flag meant to be deleted
// once everyone's upgraded. The public overlay room is joined by anonymous
// OBS Browser Sources that can be mid-broadcast during any deploy, and
// desktop-app has no auto-updater, so an old/unreloaded client must keep
// working forever, not just during a transition window.
const socketWireFormat = new Map();

function setSocketWireFormat(socketId, format) {
  socketWireFormat.set(socketId, format);
  console.log(`[bw][wire-format] socket ${socketId} negotiated format=${format}`);
}

function getSocketWireFormat(socketId) {
  return socketWireFormat.get(socketId) || 'msgpack';
}

function clearSocketWireFormat(socketId) {
  if (socketWireFormat.delete(socketId)) {
    console.log(`[bw][wire-format] cleared negotiated format for disconnected socket ${socketId}`);
  }
}

module.exports = { setSocketWireFormat, getSocketWireFormat, clearSocketWireFormat };

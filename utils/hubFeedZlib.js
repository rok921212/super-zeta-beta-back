// The desktop hub's socket library (rust_socketio 0.6 on tungstenite 0.21)
// cannot negotiate permessage-deflate, so socket.js's perMessageDeflate never
// applies to it: every liveMatchUpdate reached it as raw msgpack (~62 KB on a
// full tick, every ~2s, per account). A hub build that sends `zfeed=1` in its
// handshake inflates a zlib-wrapped binary payload itself (hub.rs sniffs the
// 0x78 zlib header — a msgpack map can never start with that byte), so those
// sockets get the same bytes deflated here. Everyone else is untouched.
//
// Kill switch: HUB_FEED_ZLIB=false sends raw msgpack to every socket again.
const zlib = require('zlib');

const ENABLED = process.env.HUB_FEED_ZLIB !== 'false';

function wantsZFeed(socket) {
  return ENABLED && socket?.handshake?.query?.zfeed === '1';
}

// Splits socket ids into [plain, zlib] by each socket's handshake.
function splitZFeedTargets(io, ids) {
  const plain = [];
  const z = [];
  for (const id of ids) {
    const s = io.sockets.sockets.get(id);
    if (s && wantsZFeed(s)) z.push(id);
    else plain.push(id);
  }
  return { plain, z };
}

function deflateFeed(buf) {
  return zlib.deflateSync(buf, { level: 6 });
}

module.exports = { wantsZFeed, splitZFeedTargets, deflateFeed, HUB_FEED_ZLIB_ENABLED: ENABLED };

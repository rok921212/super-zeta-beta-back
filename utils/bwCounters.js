// Shared byte counters for the periodic [bw][rollup] line.
//
// - httpWire   : real post-compression HTTP bytes, fed from the res.write/
//                res.end patch in index.js (registered before compression()).
// - wsFanout   : encoded payload length x recipient count, fed from
//                utils/roomEmit.js. This is PRE-perMessageDeflate — the
//                deflated wire cost is roughly a third of it (see socket.js
//                benchmark note), so the rollup also prints a ~/3 estimate.
// - upstashOut : value bytes uploaded to Upstash by setCache (after its
//                brotli step) — service-initiated egress.
// - mongoOut   : BSON size of every command sent to MongoDB, fed from the
//                driver's commandStarted events — service-initiated egress,
//                pre wire-compression, so the real figure is lower.
//
// Deliberately tiny: a few numbers and a read-and-reset, no history, no deps.
let httpWire = 0;
let wsFanout = 0;
let upstashOut = 0;
let mongoOut = 0;

module.exports = {
  addHttpWire: (n) => { httpWire += Number(n) || 0; },
  addWsFanout: (n) => { wsFanout += Number(n) || 0; },
  addUpstashOut: (n) => { upstashOut += Number(n) || 0; },
  addMongoOut: (n) => { mongoOut += Number(n) || 0; },
  readAndReset: () => {
    const out = { httpWire, wsFanout, upstashOut, mongoOut };
    httpWire = 0;
    wsFanout = 0;
    upstashOut = 0;
    mongoOut = 0;
    return out;
  },
};

// Hook a MongoClient (connected with `monitorCommands: true`) into mongoOut.
// Idempotent per client.
const metered = new WeakSet();
module.exports.meterMongoCommands = (client) => {
  if (!client || metered.has(client)) return;
  metered.add(client);
  const { BSON } = require('mongodb');
  client.on('commandStarted', (ev) => {
    try { mongoOut += BSON.calculateObjectSize(ev.command); } catch { /* best effort */ }
  });
};

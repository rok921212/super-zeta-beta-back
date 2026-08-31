// Shared byte counters for the periodic [bw][rollup] line.
//
// - httpWire   : real post-compression HTTP bytes, fed from the res.write/
//                res.end patch in index.js (registered before compression()).
// - wsFanout   : encoded payload length x recipient count, fed from
//                utils/roomEmit.js. This is PRE-perMessageDeflate — the
//                deflated wire cost is roughly a third of it (see socket.js
//                benchmark note), so the rollup also prints a ~/3 estimate.
//
// Deliberately tiny: three numbers and a read-and-reset, no history, no deps.
let httpWire = 0;
let wsFanout = 0;

module.exports = {
  addHttpWire: (n) => { httpWire += Number(n) || 0; },
  addWsFanout: (n) => { wsFanout += Number(n) || 0; },
  readAndReset: () => {
    const out = { httpWire, wsFanout };
    httpWire = 0;
    wsFanout = 0;
    return out;
  },
};

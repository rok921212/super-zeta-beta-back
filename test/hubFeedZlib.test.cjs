const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { encodeMsgpack } = require('../utils/msgpackCodec');
const { wantsZFeed, splitZFeedTargets, deflateFeed } = require('../utils/hubFeedZlib');

const sock = (query) => ({ handshake: { query } });

test('only sockets with zfeed=1 get the zlib feed', () => {
  assert.equal(wantsZFeed(sock({ client: 'hub', zfeed: '1' })), true);
  assert.equal(wantsZFeed(sock({ client: 'hub' })), false);
  assert.equal(wantsZFeed(sock({ client: 'dashboard' })), false);
  assert.equal(wantsZFeed(undefined), false);
});

test('splitZFeedTargets separates by handshake; unknown ids stay plain', () => {
  const sockets = new Map([
    ['a', sock({ client: 'hub', zfeed: '1' })],
    ['b', sock({ client: 'dashboard' })],
    ['c', sock({ client: 'hub' })],
  ]);
  const io = { sockets: { sockets } };
  assert.deepEqual(splitZFeedTargets(io, ['a', 'b', 'c', 'gone']), { plain: ['b', 'c', 'gone'], z: ['a'] });
});

test('deflated feed starts with the 0x78 zlib byte, round-trips, and is smaller', () => {
  const teams = Array.from({ length: 20 }, (_, t) => ({
    _id: `team${t}`,
    teamName: `Team ${t}`,
    players: Array.from({ length: 4 }, (_, p) => ({ _id: `p${t}-${p}`, uId: `${5000000000 + t * 10 + p}`, playerName: `Player${p}`, survivalTime: 300 + p, health: 100, killNum: p })),
  }));
  const encoded = encodeMsgpack({ matchId: 'm1', seq: 7, teams });
  // A top-level msgpack map never starts with 0x78 — the hub's sniff relies on it.
  assert.notEqual(encoded[0], 0x78);
  const deflated = deflateFeed(encoded);
  assert.equal(deflated[0], 0x78);
  assert.ok(deflated.length < encoded.length / 3, `${deflated.length} vs ${encoded.length}`);
  assert.deepEqual(zlib.inflateSync(deflated), Buffer.from(encoded));
});

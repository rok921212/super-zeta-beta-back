// socket.js

const jwt = require('jsonwebtoken');
const config = require('./config');
const { isOriginAllowed } = require('./config/corsOrigins.js');

let ioInstance = null;

function initializeSocket(server) {
  if (ioInstance) {
    console.warn('Socket.IO is already initialized.');
    return ioInstance;
  }
  const { Server } = require('socket.io');
  ioInstance = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          console.warn('⚠️ Socket.IO CORS blocked origin:', origin);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST'],
      allowedHeaders: ["Content-Type", "Authorization"],
    },
    allowEIO3: true, // Allow Engine.IO v3 clients
    // Benchmarked via scripts/benchmark-deflate.js (2026-08-17) against a
    // realistic 20-team/80-player live-tick payload — the previous comment
    // here claiming msgpack payloads are "high-entropy, gain little from
    // deflate" was wrong: deflate level 6 cut msgpack by 87.3% (62.3KB ->
    // 7.9KB) and protobuf by a further 66.9% even on top of protobuf's own
    // much smaller baseline (17.1KB -> 5.6KB), at ~0.2-0.5ms/op — negligible
    // against the ~2s live-tick cadence. threshold matches `ws`'s own
    // default (1024 bytes) so small control events (matchCreated,
    // pollingStatusUpdated, etc.) skip compression entirely.
    perMessageDeflate: {
      threshold: 1024,
      zlibDeflateOptions: { level: 6 },
    },
  });

  // JWT handshake auth: populates socket.request.session = { userId } from
  // the token the client passed as `auth: { token }` on connect — the same
  // shape `pubgApiMatchData.controller.js`'s dashboard-room auto-join
  // (`socket.request.session?.userId`) already expects, so that code needs
  // no changes. Deliberately never rejects the handshake on a missing/
  // invalid token (never calls next(new Error(...))): the public/anonymous
  // OBS overlay viewers share this exact same connection with no login at
  // all, and must keep connecting — an absent/bad token just means the
  // socket never gets a userId and so never auto-joins a user:<id> room,
  // identical to today's "no session cookie" behavior.
  ioInstance.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const payload = jwt.verify(token, config.JWT_SECRET);
        socket.request.session = { userId: payload.userId };
      } catch (err) {
        console.warn(`[socket] invalid/expired JWT on handshake ${socket.id}: ${err.message}`);
      }
    }
    next();
  });

  // DIAGNOSTIC (2026-08-23): Engine.IO-level connection failures (bad
  // handshake, transport error before a socket.io Socket even exists) never
  // reach io.on('connection', ...) or any per-socket handler — this is the
  // only place they're observable at all. Paired with the per-socket
  // socket.conn.on('close'/'error') logging added in
  // pubgApiMatchData.controller.js's io.on('connection', ...) for failures
  // that occur AFTER a socket exists.
  ioInstance.engine.on('connection_error', (err) => {
    console.error(
      `[engine] connection_error code=${err.code} message=${err.message} context=${JSON.stringify(err.context)} url=${err.req?.url}`
    );
  });

  console.log('✅ Socket.IO initialized with CORS');

  return ioInstance;
}

function getSocket() {
  if (!ioInstance) {
    throw new Error('Socket.IO not initialized. Call initializeSocket first.');
  }
  return ioInstance;
}

module.exports = { initializeSocket, getSocket };
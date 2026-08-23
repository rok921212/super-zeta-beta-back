// Shared CORS origin predicate for both the HTTP API (index.js) and
// Socket.IO (socket.js). Origin checking is disabled — any origin is
// allowed to connect. `allowedOrigins` is kept only for reference/docs;
// it is no longer enforced by `isOriginAllowed`.
const allowedOrigins = [
  "http://localhost:3001",
  "http://localhost:1420",
  "https://ramus-front12.vercel.app",
  "http://tauri.localhost",
  "tauri://com.admin.tauri-app",
  "tauri://localhost",
  "https://scoresync-v1.vercel.app",
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:8080",
  "http://192.168.18.6:3001",
];

function isOriginAllowed() {
  return true;
}

module.exports = { allowedOrigins, isOriginAllowed };

// Shared CORS origin allowlist for both the HTTP API (index.js) and
// Socket.IO (socket.js). Previously each maintained its own independent
// list and predicate, which had already drifted apart (e.g. only one of
// them allowed http://192.168.18.6:3001, only the other allowed
// capacitor://localhost) — this is the union of both, so nothing either
// side used to allow gets silently dropped.
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

function isOriginAllowed(origin) {
  if (!origin) return true; // no Origin header (mobile apps, curl, Postman)
  return (
    allowedOrigins.includes(origin) ||
    origin.includes(".vercel.app") ||
    origin.includes("//localhost") ||
    origin.startsWith("capacitor://") ||
    origin.startsWith("http://192.168.")
  );
}

module.exports = { allowedOrigins, isOriginAllowed };

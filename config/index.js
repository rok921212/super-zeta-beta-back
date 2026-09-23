const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

let envVars = {};

// Try to load embedded config first (for production)
try {
  // This will be replaced during build
  const embeddedConfig = require('./env.config');
  envVars = { ...embeddedConfig };
} catch (e) {
  // Fall back to .env file in development
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    envVars = { ...process.env };
  }
}

// Default configuration
const config = {
  // Server
  PORT: envVars.PORT || 3000,
  NODE_ENV: envVars.NODE_ENV || 'production',
  
  // Security
  ADMIN_CODE: envVars.ADMIN_CODE || process.env.ADMIN_CODE,
  // SECURITY: no fallback. The embedded config/env.config.js does NOT carry a
  // JWT_SECRET, so `|| 'your-secret-key'` meant production tokens were signed
  // with a publicly-known string (every JWT forgeable). Take it from the
  // embedded config if present, otherwise from the real environment
  // (.env is loaded by index.js / dotenv, Render injects its dashboard vars).
  // Enforced as required below.
  JWT_SECRET: envVars.JWT_SECRET || process.env.JWT_SECRET,
  SESSION_SECRET: envVars.SESSION_SECRET || process.env.SESSION_SECRET, // legacy/unused (no express-session)
  
// Database
  // SECURITY: no hardcoded fallbacks — these used to bake live Mongo/Upstash
  // credentials directly into a tracked source file. Real environment (the
  // embedded config if present, otherwise Render's dashboard vars) only.
  MONGODB_URI: envVars.MONGODB_URI || process.env.MONGODB_URI,
  UPSTASH_REDIS_REST_URL: envVars.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: envVars.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  
  // Logging
  LOG_LEVEL: envVars.LOG_LEVEL || 'info',
  LOG_TO_FILE: envVars.LOG_TO_FILE === 'true' || false,
};

// Validate required configuration
const requiredConfigs = ['ADMIN_CODE', 'JWT_SECRET', 'MONGODB_URI', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
for (const key of requiredConfigs) {
  if (!config[key] && process.env.NODE_ENV !== 'test') {
    console.error(`❌ Missing required config: ${key}`);
    process.exit(1);
  }
}

module.exports = config;
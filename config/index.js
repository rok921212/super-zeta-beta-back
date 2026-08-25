const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

let envVars = {};

// Prioritize process.env (Render env vars) first, then embedded, then .env
envVars = { ...process.env };

// Try embedded config second (build-time)
try {
  const embeddedConfig = require('./env.config');
  envVars = { ...envVars, ...embeddedConfig };
} catch (e) {
  console.log('No embedded config found (normal for dev)');
}

// Fall back to .env for local dev
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  envVars = { ...envVars, ...process.env };
}

// Default configuration
const config = {
  // Server
  PORT: envVars.PORT || 3000,
  NODE_ENV: envVars.NODE_ENV || 'production',
  
  // Security
  ADMIN_CODE: envVars.ADMIN_CODE,
  // No insecure fallback here — an unset JWT_SECRET must fail the
  // requiredConfigs check below loudly at startup, not silently sign
  // tokens with a guessable default.
  JWT_SECRET: envVars.JWT_SECRET,
  
// Database
  MONGODB_URI: envVars.MONGODB_URI || 'mongodb+srv://sskk64585_db_user:MtOjbjd1W1c0rwQq@cluster0.5kyow6x.mongodb.net/?appName=Cluster0',
  UPSTASH_REDIS_REST_URL: envVars.UPSTASH_REDIS_REST_URL || 'https://aware-martin-160095.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: envVars.UPSTASH_REDIS_REST_TOKEN || 'gQAAAAAAAnFfAAIgcDIxOWQ2ZTQwOWJjMDQ0Y2RjOTU1NzE0ODkzYjQyNGY0OQ',
  
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
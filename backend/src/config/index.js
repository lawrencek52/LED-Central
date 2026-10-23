import dotenv from 'dotenv';

dotenv.config();

const DEFAULTS = {
  nodeEnv: 'development',
  host: '0.0.0.0',
  port: 3001,
  apiTimeoutMs: 30000,
  effectDatabasePath: './data/led-central.db',
  soundsDirectory: './media/sounds',
  publicBaseUrl: '',
  authToken: '',
  logLevel: 'info',
  corsOrigins: ['*']
};

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function integer(value, name, { min, max }) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

function origins(value) {
  const values = String(value ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error('CORS_ORIGIN must contain at least one origin');
  }

  return values.length === 1 && values[0] === '*' ? ['*'] : values;
}

export function loadConfig(environment = process.env) {
  const nodeEnv = environment.NODE_ENV?.trim() || DEFAULTS.nodeEnv;
  const logLevel = environment.LOG_LEVEL?.trim() || DEFAULTS.logLevel;

  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(
      `LOG_LEVEL must be one of: ${Array.from(LOG_LEVELS).join(', ')}`
    );
  }

  return Object.freeze({
    nodeEnv,
    host: environment.HOST?.trim() || DEFAULTS.host,
    port: integer(environment.PORT ?? DEFAULTS.port, 'PORT', {
      min: 1,
      max: 65535
    }),
    apiTimeoutMs: integer(
      environment.API_TIMEOUT ?? DEFAULTS.apiTimeoutMs,
      'API_TIMEOUT',
      { min: 100, max: 300000 }
    ),
    effectDatabasePath: environment.EFFECT_DATABASE_PATH?.trim() || DEFAULTS.effectDatabasePath,
    // Sound clips served at /sounds for the LAN audio streamers to fetch (media/sounds,
    // checked in - CC0 clips only). PUBLIC_BASE_URL overrides the http://<LAN IPv4>:<port> they're
    // told to fetch from, if auto-detection picks the wrong interface.
    soundsDirectory: environment.SOUNDS_DIRECTORY?.trim() || DEFAULTS.soundsDirectory,
    publicBaseUrl: environment.PUBLIC_BASE_URL?.trim() || DEFAULTS.publicBaseUrl,
    authToken: environment.AUTH_TOKEN?.trim() || DEFAULTS.authToken,
    logLevel,
    corsOrigins: origins(environment.CORS_ORIGIN ?? DEFAULTS.corsOrigins.join(','))
  });
}

export const config = loadConfig();

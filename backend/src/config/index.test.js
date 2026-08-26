import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './index.js';

test('loads defaults for an empty environment', () => {
  assert.deepEqual(loadConfig({}), {
    nodeEnv: 'development',
    host: '127.0.0.1',
    port: 3001,
    apiTimeoutMs: 30000,
    effectDatabasePath: './data/effects.db',
    logLevel: 'info',
    corsOrigins: ['http://localhost:5173']
  });
});

test('parses and normalizes configured values', () => {
  assert.deepEqual(
    loadConfig({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '8080',
      API_TIMEOUT: '5000',
      LOG_LEVEL: 'warn',
      CORS_ORIGIN: 'https://led.example, https://admin.example'
    }),
    {
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 8080,
      apiTimeoutMs: 5000,
      effectDatabasePath: './data/effects.db',
      logLevel: 'warn',
      corsOrigins: ['https://led.example', 'https://admin.example']
    }
  );
});

test('rejects invalid numeric settings', () => {
  assert.throws(
    () => loadConfig({ PORT: '70000' }),
    /PORT must be an integer between 1 and 65535/
  );
  assert.throws(
    () => loadConfig({ API_TIMEOUT: '10' }),
    /API_TIMEOUT must be an integer between 100 and 300000/
  );
});

test('rejects unsupported log levels and empty CORS origins', () => {
  assert.throws(
    () => loadConfig({ LOG_LEVEL: 'verbose' }),
    /LOG_LEVEL must be one of/
  );
  assert.throws(
    () => loadConfig({ CORS_ORIGIN: ' , ' }),
    /CORS_ORIGIN must contain at least one origin/
  );
});

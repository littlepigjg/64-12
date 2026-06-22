import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '4873', 10),
  storageDir: process.env.STORAGE_DIR || path.resolve(process.cwd(), '..', 'storage'),
  dataDir: process.env.DATA_DIR || path.resolve(process.cwd(), '..', 'data'),
  npm: {
    upstream: process.env.NPM_UPSTREAM || 'https://registry.npmjs.org',
    privateScopes: (process.env.NPM_PRIVATE_SCOPES || '@local,@private').split(','),
  },
  pypi: {
    upstream: process.env.PYPI_UPSTREAM || 'https://pypi.org',
    simpleUpstream: process.env.PYPI_SIMPLE_UPSTREAM || 'https://pypi.org/simple',
  },
  cache: {
    maxSizeGB: parseFloat(process.env.CACHE_MAX_SIZE_GB || '50'),
    maxAgeDays: parseInt(process.env.CACHE_MAX_AGE_DAYS || '90', 10),
    autoClean: process.env.CACHE_AUTO_CLEAN !== 'false',
    evictionStrategy: (process.env.CACHE_EVICTION_STRATEGY || 'heat-based') as 'time-based' | 'heat-based',
    frequencyWeight: parseFloat(process.env.CACHE_FREQUENCY_WEIGHT || '0.5'),
    recencyWeight: parseFloat(process.env.CACHE_RECENCY_WEIGHT || '0.5'),
    heatHalfLifeDays: parseInt(process.env.CACHE_HEAT_HALF_LIFE_DAYS || '30', 10),
  },
  auth: {
    requireAuth: process.env.REQUIRE_AUTH === 'true',
    adminToken: process.env.ADMIN_TOKEN || 'admin-token-change-me',
  },
};

export type AppConfig = typeof config;

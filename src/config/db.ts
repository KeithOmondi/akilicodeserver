// src/config/db.ts
import { Pool, PoolConfig } from 'pg';
import config from './env';

// 1. Determine if we are running in production
// (Assuming your env.ts or .env has a NODE_ENV variable)
const isProduction = process.env.NODE_ENV === 'production';

const poolConfig: PoolConfig = {
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 10000, // release idle connections before Neon closes them
  keepAlive: true,
  connectionTimeoutMillis: 10000,
  
  // 2. Apply SSL logic dynamically
  ssl: (isProduction || /sslmode=|neon\.tech/.test(config.DATABASE_URL))
    ? { rejectUnauthorized: isProduction } // production: verify the server certificate (Neon's is publicly trusted)
    : false,                         // Local Development
};

const pool = new Pool(poolConfig);

// Listen for pool events for better debugging
pool.on('error', (err) => {
  // Neon (and any pooler) closes idle connections on purpose. The pool drops the dead client and opens
  // a new one on the next query, so this must NOT stop the server.
  console.warn('Idle PostgreSQL client dropped (will reconnect on next query):', err.message);
});

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export default pool;
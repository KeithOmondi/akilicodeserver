// src/config/db.ts
import { Pool, PoolConfig } from 'pg';
import config from './env';

// 1. Determine if we are running in production
// (Assuming your env.ts or .env has a NODE_ENV variable)
const isProduction = process.env.NODE_ENV === 'production';

const poolConfig: PoolConfig = {
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  
  // 2. Apply SSL logic dynamically
  ssl: isProduction 
    ? { rejectUnauthorized: false } // Production/Cloud (Supabase, Render, etc.)
    : false,                         // Local Development
};

const pool = new Pool(poolConfig);

// Listen for pool events for better debugging
pool.on('connect', () => {
  console.log('🐘 PostgreSQL Pool connected');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export default pool;
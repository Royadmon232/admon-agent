import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,               // reuse up to 10 conns
  idleTimeoutMillis: 30000,
  ssl:
    process.env.DATABASE_URL?.includes('localhost')
      ? false
      : { rejectUnauthorized: false }
});

export default pool; 
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,               // reuse up to 10 conns
  ssl: {
    rejectUnauthorized: false
  }
});

export default pool; 
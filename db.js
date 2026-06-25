const path = require('path');

// Railway fallback: if DATABASE_URL env var isn't set but we're on Railway, use direct PG config
if (!process.env.DATABASE_URL && process.env.RAILWAY_SERVICE_ID) {
  process.env.DATABASE_URL = 'postgresql://postgres:rMbTWsolbqoswuTvhpcCbifSpUGVTaQA@postgres.railway.internal:5432/railway';
}

let db;

if (process.env.DATABASE_URL) {
  // PostgreSQL (production)
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  
  class PgStmt {
    constructor(sql) { 
      // Convert ? placeholders to $1, $2, ... for PostgreSQL
      let idx = 0;
      this.sql = sql.replace(/\?/g, () => `$${++idx}`)
                    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
    }
    async get(...params) {
      const r = await pool.query(this.sql, params.length > 0 && params[0] !== undefined ? params : undefined);
      return r.rows[0] || null;
    }
    async all(...params) {
      const r = await pool.query(this.sql, params.length > 0 && params[0] !== undefined ? params : undefined);
      return r.rows;
    }
    async run(...params) {
      const r = await pool.query(this.sql, params.length > 0 && params[0] !== undefined ? params : undefined);
      return { lastInsertRowid: r.rows[0]?.id, changes: r.rowCount };
    }
  }

  db = {
    prepare(sql) { return new PgStmt(sql); },
    exec(sql) { return pool.query(sql); },
    transaction(fn) {
      return async (...args) => {
        await pool.query('BEGIN');
        try {
          const result = await fn(...args);
          await pool.query('COMMIT');
          return result;
        } catch (e) {
          await pool.query('ROLLBACK');
          throw e;
        }
      };
    },
    _pool: pool,
    _isPg: true
  };



} else {
  // SQLite (local development)
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, 'chama.db');
  const sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  db = sqliteDb;
}

module.exports = db;

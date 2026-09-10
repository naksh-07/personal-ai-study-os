import DatabaseConstructor from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { Kysely } from 'kysely';
import { Database, D1Database, createD1FromBetterSqlite3, createKyselyD1 } from '@personal-os/db';

export interface TestContext {
  sqlite: any;
  d1: D1Database;
  db: Kysely<Database>;
}

/**
 * Creates an in-memory SQLite database with foreign keys enabled,
 * runs the authoritative 24-table migration, and wraps it as a D1Database and Kysely instance.
 */
export function createTestDatabase(): TestContext {
  const sqlite = new DatabaseConstructor(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Load migration SQL from apps/worker/migrations/0001_initial_schema.sql
  const migrationPath = path.resolve(__dirname, '../apps/worker/migrations/0001_initial_schema.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // Execute migration
  sqlite.exec(migrationSql);

  const d1 = createD1FromBetterSqlite3(sqlite);
  const db = createKyselyD1(d1);

  return { sqlite, d1, db };
}

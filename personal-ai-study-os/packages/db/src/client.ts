import {
  Kysely,
  Dialect,
  Driver,
  DatabaseConnection,
  QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  CompiledQuery,
} from 'kysely';
import { Database } from './tables';
import { DomainError } from '@personal-os/domain';

// ============================================================================
// Cloudflare D1 Type Definitions
// ============================================================================

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
  error?: string;
}

export interface D1Response {
  success: boolean;
  meta: Record<string, unknown>;
  error?: string;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Response>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

// ============================================================================
// Prohibited Transaction Guard
// ============================================================================

const FORBIDDEN_TX_REGEX = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i;

function assertNoInteractiveTransaction(sql: string): void {
  if (FORBIDDEN_TX_REGEX.test(sql.trim())) {
    throw new DomainError(
      'BATCH_EXECUTION_FAILED',
      'Explicit BEGIN/COMMIT/ROLLBACK transaction handling is strictly prohibited on Cloudflare D1. Use db.batch() atomic batches instead.'
    );
  }
}

// ============================================================================
// D1 Kysely Driver & Dialect
// ============================================================================

class D1Connection implements DatabaseConnection {
  constructor(private readonly d1: D1Database) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    assertNoInteractiveTransaction(compiledQuery.sql);

    const stmt = this.d1
      .prepare(compiledQuery.sql)
      .bind(...(compiledQuery.parameters as unknown[]));

    const result = await stmt.all<R>();

    return {
      rows: result.results || [],
    };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new DomainError(
      'BATCH_EXECUTION_FAILED',
      'Streaming queries are not supported on Cloudflare D1.'
    );
  }
}

class D1Driver implements Driver {
  constructor(private readonly d1: D1Database) {}

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new D1Connection(this.d1);
  }

  async beginTransaction(): Promise<void> {
    throw new DomainError(
      'BATCH_EXECUTION_FAILED',
      'Interactive transactions (BEGIN/COMMIT/ROLLBACK) are strictly prohibited on Cloudflare D1. Coordinated atomic writes must use db.batch().'
    );
  }

  async commitTransaction(): Promise<void> {
    throw new DomainError(
      'BATCH_EXECUTION_FAILED',
      'Interactive transactions (BEGIN/COMMIT/ROLLBACK) are strictly prohibited on Cloudflare D1. Coordinated atomic writes must use db.batch().'
    );
  }

  async rollbackTransaction(): Promise<void> {
    throw new DomainError(
      'BATCH_EXECUTION_FAILED',
      'Interactive transactions (BEGIN/COMMIT/ROLLBACK) are strictly prohibited on Cloudflare D1. Coordinated atomic writes must use db.batch().'
    );
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

export class D1Dialect implements Dialect {
  constructor(private readonly d1: D1Database) {}

  createAdapter(): SqliteAdapter {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    return new D1Driver(this.d1);
  }

  createIntrospector(db: Kysely<unknown>): SqliteIntrospector {
    return new SqliteIntrospector(db);
  }

  createQueryCompiler(): SqliteQueryCompiler {
    return new SqliteQueryCompiler();
  }
}

// ============================================================================
// Factory & Batch Operations
// ============================================================================

export function createKyselyD1(d1: D1Database): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new D1Dialect(d1),
  });
}

export type Compilable =
  | { compile(): CompiledQuery }
  | CompiledQuery
  | D1PreparedStatement;

/**
 * Executes a list of Kysely queries or D1 statements in a single atomic D1 batch via db.batch().
 * Enforces zero BEGIN/COMMIT/ROLLBACK.
 */
export async function executeD1Batch(
  d1: D1Database,
  queries: Compilable[]
): Promise<D1Result[]> {
  if (queries.length === 0) return [];

  const statements: D1PreparedStatement[] = [];

  for (const q of queries) {
    if ('bind' in q && typeof (q as any).bind === 'function' && 'first' in q) {
      statements.push(q as D1PreparedStatement);
    } else {
      const compiled: CompiledQuery =
        'compile' in q && typeof (q as any).compile === 'function'
          ? (q as any).compile()
          : (q as CompiledQuery);
      assertNoInteractiveTransaction(compiled.sql);
      const stmt = d1.prepare(compiled.sql).bind(...(compiled.parameters as unknown[]));
      statements.push(stmt);
    }
  }

  return await d1.batch(statements);
}

// ============================================================================
// In-Memory SQLite Adapter for Testing (Matches D1Database Contract)
// ============================================================================

class BetterSqlite3PreparedStatement implements D1PreparedStatement {
  constructor(
    private readonly sqlite: any,
    public readonly query: string,
    public readonly params: unknown[] = []
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new BetterSqlite3PreparedStatement(this.sqlite, this.query, values);
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    assertNoInteractiveTransaction(this.query);
    const stmt = this.sqlite.prepare(this.query);
    const row = stmt.get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) return (row[colName] as T) ?? null;
    return row as unknown as T;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    assertNoInteractiveTransaction(this.query);
    const stmt = this.sqlite.prepare(this.query);
    const isSelect = /^\s*(SELECT|PRAGMA)\b/i.test(this.query);
    if (isSelect) {
      const rows = stmt.all(...this.params) as T[];
      return { results: rows, success: true, meta: {} };
    } else {
      const info = stmt.run(...this.params);
      return {
        results: [],
        success: true,
        meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
      };
    }
  }

  async run<T = unknown>(): Promise<D1Response> {
    assertNoInteractiveTransaction(this.query);
    const stmt = this.sqlite.prepare(this.query);
    const info = stmt.run(...this.params);
    return {
      success: true,
      meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
    };
  }

  async raw<T = unknown>(): Promise<T[]> {
    assertNoInteractiveTransaction(this.query);
    const stmt = this.sqlite.prepare(this.query);
    stmt.raw(true);
    return stmt.all(...this.params) as T[];
  }
}

export function createD1FromBetterSqlite3(sqlite: any): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      assertNoInteractiveTransaction(query);
      return new BetterSqlite3PreparedStatement(sqlite, query);
    },

    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const runBatch = sqlite.transaction(() => {
        const results: D1Result<T>[] = [];
        for (const s of statements) {
          const stmtWrapper = s as BetterSqlite3PreparedStatement;
          assertNoInteractiveTransaction(stmtWrapper.query);
          const stmt = sqlite.prepare(stmtWrapper.query);
          const isSelect = /^\s*(SELECT|PRAGMA)\b/i.test(stmtWrapper.query);
          if (isSelect) {
            const rows = stmt.all(...stmtWrapper.params) as T[];
            results.push({ results: rows, success: true, meta: {} });
          } else {
            const info = stmt.run(...stmtWrapper.params);
            results.push({
              results: [],
              success: true,
              meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
            });
          }
        }
        return results;
      });

      return runBatch();
    },

    async exec(query: string): Promise<D1ExecResult> {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
  };
}

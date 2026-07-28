import { type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core';

// Driver-agnostic drizzle surface: both drizzle-orm/node-postgres and
// drizzle-orm/pglite instances (and their transactions) are assignable to it.
export type Orm = PgDatabase<PgQueryResultHKT>;
export type Tx = Orm;

export interface QueryResultRow {
  readonly [column: string]: unknown;
}

export interface QueryResult {
  readonly rows: QueryResultRow[];
}

// Raw escape hatch for migrations: multi-statement .sql files cannot go through
// drizzle on PGlite (its query path is single-statement extended protocol).
export interface QueryRunner {
  query(text: string, params?: readonly unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
}

export interface Database extends QueryRunner {
  readonly orm: Orm;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  rawTransaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>;
}

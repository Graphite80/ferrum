import { drizzle } from 'drizzle-orm/node-postgres';
import { type Pool, type PoolClient, type QueryResultRow as PgQueryResultRow } from 'pg';
import { type Database, type QueryResult, type QueryRunner } from './db.ts';

type Queryable = Pool | PoolClient;

function runnerFor(client: Queryable): QueryRunner {
  return {
    query: async (text, params): Promise<QueryResult> => {
      const result = await client.query<PgQueryResultRow>(
        text,
        params === undefined ? undefined : [...params]
      );
      return { rows: result.rows };
    },
    exec: async sql => {
      await client.query(sql);
    },
  };
}

export function pgDatabase(pool: Pool): Database {
  const base = runnerFor(pool);
  // Custom transaction handling instead of drizzle's: on a failed rollback the
  // connection must be destroyed, not recycled into a session PgBouncer still
  // considers mid-transaction (drizzle's own transaction() releases it as-is).
  async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      client.release();
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
        client.release();
      } catch {
        client.release(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }
  return {
    orm: drizzle(pool),
    query: (text, params) => base.query(text, params),
    exec: sql => base.exec(sql),
    transaction: fn => withClient(client => fn(drizzle(client))),
    rawTransaction: fn => withClient(client => fn(runnerFor(client))),
  };
}

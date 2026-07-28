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
  return {
    query: (text, params) => base.query(text, params),
    exec: sql => base.exec(sql),
    async transaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(runnerFor(client));
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

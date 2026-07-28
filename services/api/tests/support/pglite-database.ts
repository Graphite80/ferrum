import { type PGlite, type Transaction } from '@electric-sql/pglite';
import {
  type Database,
  type QueryResult,
  type QueryResultRow,
  type QueryRunner,
} from '../../src/db.ts';

function runnerFor(client: Pick<PGlite | Transaction, 'query' | 'exec'>): QueryRunner {
  return {
    query: async (text, params): Promise<QueryResult> => {
      const result = await client.query<QueryResultRow>(
        text,
        params === undefined ? undefined : [...params]
      );
      return { rows: result.rows };
    },
    exec: async sql => {
      await client.exec(sql);
    },
  };
}

export function pgliteDatabase(pglite: PGlite): Database {
  const base = runnerFor(pglite);
  return {
    query: base.query,
    exec: base.exec,
    async transaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T> {
      const result = await pglite.transaction(tx => fn(runnerFor(tx)));
      return result as T;
    },
  };
}

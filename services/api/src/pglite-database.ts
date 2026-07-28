import { drizzle } from 'drizzle-orm/pglite';
import { type PGlite, type Transaction } from '@electric-sql/pglite';
import { type Database, type QueryResult, type QueryResultRow, type QueryRunner } from './db.ts';

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
  const orm = drizzle(pglite);
  const base = runnerFor(pglite);
  return {
    orm,
    query: (text, params) => base.query(text, params),
    exec: sql => base.exec(sql),
    transaction: fn => orm.transaction(tx => fn(tx)),
    rawTransaction: fn => pglite.transaction(tx => fn(runnerFor(tx))),
  };
}

export interface QueryResultRow {
  readonly [column: string]: unknown;
}

export interface QueryResult {
  readonly rows: QueryResultRow[];
}

export interface QueryRunner {
  query(text: string, params?: readonly unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
}

export interface Database extends QueryRunner {
  transaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>;
}

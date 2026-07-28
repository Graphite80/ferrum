import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Database } from './db.ts';

const migrationsDir = fileURLToPath(new URL('./migrations/', import.meta.url));

export async function migrate(db: Database): Promise<void> {
  await db.exec(
    'create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())'
  );
  const files = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) {
    const version = Number.parseInt(name, 10);
    if (!Number.isInteger(version)) {
      throw new Error(`Migration file "${name}" must start with a number`);
    }
    const sql = await readFile(path.join(migrationsDir, name), 'utf8');
    await db.transaction(async tx => {
      // Transaction-scoped advisory lock: two pods booting together must not
      // race the same file. The _xact_ variant releases at commit, which keeps
      // it safe under PgBouncer transaction pooling.
      await tx.query('select pg_advisory_xact_lock($1)', [872364]);
      const applied = await tx.query('select version from schema_migrations where version = $1', [
        version,
      ]);
      if (applied.rows.length > 0) return;
      await tx.exec(sql);
      await tx.query('insert into schema_migrations (version) values ($1)', [version]);
    });
  }
}

import { createHash } from 'node:crypto';
import { serve } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { extractTelegram, libraryResolver } from '@ferrum/importers';
import { createApp } from './app.ts';
import { importForUser } from './bot/imports.ts';
import { parseShorthand } from './bot/shorthand.ts';
import { migrate } from './migrate.ts';
import { pgliteDatabase } from './pglite-database.ts';

const port = Number(process.env.PORT ?? '3100');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a valid port number, received "${process.env.PORT ?? ''}"`);
}

const dataDir = process.env.PGLITE_DIR;
const pglite = dataDir === undefined || dataDir === '' ? new PGlite() : new PGlite(dataDir);
const db = pgliteDatabase(pglite);
await migrate(db);

const app = createApp({ db, enableDevRoutes: true });

interface BotImportBody {
  readonly lines: readonly string[];
  readonly messageId: number;
  readonly date: number;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'string') return null;
    items.push(item);
  }
  return items;
}

function parseBotImportBody(value: unknown): BotImportBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const lines = stringArray(record['lines']);
  const messageId = record['messageId'];
  const date = record['date'];
  if (lines === null || lines.length === 0) return null;
  if (typeof messageId !== 'number' || !Number.isInteger(messageId)) return null;
  if (typeof date !== 'number' || !Number.isFinite(date)) return null;
  return { lines, messageId, date };
}

// Dev-only drill hook: drives the REAL bot import path (parseShorthand ->
// extractTelegram -> importForUser) for the bearer user, exactly as a Telegram
// message would, so e2e tests can converge a bot write into a PWA replica.
app.post('/dev/bot-import', async c => {
  const header = c.req.header('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice('bearer '.length).trim()
    : '';
  if (token.length === 0) return c.json({ error: 'unauthorized' }, 401);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const found = await db.query('select user_id from auth_tokens where token_hash = $1', [
    tokenHash,
  ]);
  const row = found.rows[0];
  if (row === undefined) return c.json({ error: 'unauthorized' }, 401);
  const userId = String(row.user_id);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const body = parseBotImportBody(raw);
  if (body === null) return c.json({ error: 'invalid_body' }, 400);

  const parsed = parseShorthand(body.lines.join('\n'));
  if (parsed.lines.length === 0 || parsed.rejectedLines.length > 0) {
    return c.json({ error: 'unparseable_lines', rejectedLines: parsed.rejectedLines }, 400);
  }

  const extraction = extractTelegram({
    messageId: body.messageId,
    chatId: 0,
    date: new Date(body.date * 1000).toISOString().slice(0, 10),
    tzOffsetMinutes: 0,
    lines: parsed.lines,
  });
  const outcome = await importForUser(
    db,
    userId,
    extraction,
    libraryResolver(loadExerciseLibrary())
  );
  return c.json({
    accepted: outcome.accepted,
    duplicates: outcome.duplicates,
    setsImported: outcome.result.report.setsImported,
    unresolved: outcome.result.unresolved.length,
  });
});

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, info => {
  console.log(
    `ferrum dev api (pglite${dataDir ? `: ${dataDir}` : ', in-memory'}) on :${info.port}`
  );
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    void pglite.close().finally(() => {
      process.exit(0);
    });
  });
}

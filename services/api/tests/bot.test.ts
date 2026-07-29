import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import { type Bot } from 'grammy';
import { type Update } from 'grammy/types';
import {
  EVENT_SCHEMA_VERSION,
  allSets,
  buildEvent,
  comparisonSignature,
  instant,
  kilograms,
  localDate,
  type DomainEvent,
  type EventId,
  type ProgressionRuleId,
  type SessionExerciseId,
  type SessionId,
  type SetPrescriptionSnapshot,
  type UserId,
  type DeviceId,
  type WorkoutSetId,
} from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { extractLifeAsCode, libraryResolver, runImport } from '@ferrum/importers';
import { isProtocolError, parsePullResponse } from '@ferrum/sync-protocol';
import { createApp } from '../src/app.ts';
import { createTelegramBot } from '../src/bot/index.ts';
import { type Database } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { loadUserEvents, pushBatch } from '../src/sync.ts';
import { pgliteDatabase } from '../src/pglite-database.ts';

const TOKEN = '12345:TEST';
const WEBHOOK_SECRET = 'hook-secret';
const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/importers/tests/fixtures'
);
const REAL_HISTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/real-history-2026-06-15_2026-07-25.json'
);

interface ApiCall {
  readonly method: string;
  readonly payload: Record<string, unknown>;
}

let db: Database;
let bot: Bot;
let server: ServerType;
let fileServer: http.Server;
let baseUrl = '';
const outbox: ApiCall[] = [];
const servedFiles = new Map<string, string>();
let nextId = 1;

function canned(method: string, payload: Record<string, unknown>): unknown {
  if (method === 'sendMessage' || method === 'sendDocument' || method === 'editMessageText') {
    return {
      message_id: (nextId += 1),
      date: 1,
      chat: { id: payload['chat_id'] ?? 0, type: 'private' },
      text: typeof payload['text'] === 'string' ? payload['text'] : '',
    };
  }
  if (method === 'getFile') {
    return {
      file_id: payload['file_id'],
      file_unique_id: 'u',
      file_path: String(payload['file_id']),
    };
  }
  return true;
}

beforeAll(async () => {
  db = pgliteDatabase(new PGlite());
  await migrate(db);

  fileServer = http.createServer((request, response) => {
    const filePath = (request.url ?? '').replace(`/file/bot${TOKEN}/`, '');
    const content = servedFiles.get(filePath);
    if (content === undefined) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/csv' });
    response.end(content);
  });
  const filePort = await new Promise<number>(resolve => {
    fileServer.listen(0, '127.0.0.1', () => {
      const address = fileServer.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });

  bot = createTelegramBot({
    token: TOKEN,
    db,
    fileApiRoot: `http://127.0.0.1:${filePort}`,
    botInfo: {
      id: 424242,
      is_bot: true,
      first_name: 'ferrum-test',
      username: 'ferrum_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });
  bot.api.config.use((_prev, method, payload) => {
    outbox.push({ method, payload });
    return Promise.resolve({
      ok: true as const,
      result: canned(method, payload as Record<string, unknown>),
    } as never);
  });

  const app = createApp({
    db,
    enableDevRoutes: true,
    telegram: { bot, webhookSecret: WEBHOOK_SECRET },
  });
  await new Promise<void>(resolve => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, info => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  fileServer.close();
});

beforeEach(() => {
  outbox.length = 0;
});

function tgFrom(id: number): { id: number; is_bot: false; first_name: string } {
  return { id, is_bot: false, first_name: `user-${id}` };
}

function textUpdate(userId: number, text: string, unixDate = 1_753_600_000): Update {
  const entities = text.startsWith('/')
    ? [{ type: 'bot_command', offset: 0, length: (text.split(' ')[0] ?? text).length }]
    : [];
  return {
    update_id: (nextId += 1),
    message: {
      message_id: (nextId += 1),
      date: unixDate,
      chat: { id: userId, type: 'private' },
      from: tgFrom(userId),
      text,
      entities,
    },
  } as Update;
}

function documentUpdate(userId: number, fileId: string, fileName: string): Update {
  return {
    update_id: (nextId += 1),
    message: {
      message_id: (nextId += 1),
      date: 1_753_600_000,
      chat: { id: userId, type: 'private' },
      from: tgFrom(userId),
      document: { file_id: fileId, file_unique_id: 'u', file_name: fileName },
    },
  } as Update;
}

function callbackUpdate(userId: number, data: string): Update {
  return {
    update_id: (nextId += 1),
    callback_query: {
      id: String((nextId += 1)),
      from: tgFrom(userId),
      chat_instance: 'ci',
      data,
      message: {
        message_id: (nextId += 1),
        date: 1_753_600_000,
        chat: { id: userId, type: 'private' },
        text: 'prompt',
      },
    },
  } as Update;
}

function sentMessages(): ApiCall[] {
  return outbox.filter(call => call.method === 'sendMessage' || call.method === 'editMessageText');
}

function lastText(): string {
  const last = sentMessages()[sentMessages().length - 1];
  const text = last?.payload['text'];
  return typeof text === 'string' ? text : '';
}

interface KeyboardButton {
  readonly text: string;
  readonly callback_data: string;
}

function lastKeyboard(): KeyboardButton[][] {
  const last = sentMessages()[sentMessages().length - 1];
  const markup = last?.payload['reply_markup'] as
    { inline_keyboard: KeyboardButton[][] } | undefined;
  return markup?.inline_keyboard ?? [];
}

async function chatUser(tgChatId: number): Promise<string> {
  const found = await db.query('select user_id from telegram_chats where tg_chat_id = $1', [
    tgChatId,
  ]);
  return String(found.rows[0]?.user_id);
}

async function authTokenFor(userId: string): Promise<string> {
  const token = `test-token-${userId}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await db.query(
    'insert into auth_tokens (token_hash, user_id) values ($1, $2) on conflict (token_hash) do nothing',
    [tokenHash, userId]
  );
  return token;
}

async function pullEvents(userId: string): Promise<DomainEvent[]> {
  const token = await authTokenFor(userId);
  const events: DomainEvent[] = [];
  let after = 0;
  for (;;) {
    const response = await fetch(`${baseUrl}/sync/pull?after=${after}&limit=200`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const parsed = parsePullResponse(await response.json());
    if (isProtocolError(parsed)) throw new Error(parsed.message);
    events.push(...parsed.events);
    if (!parsed.hasMore) return events;
    after = parsed.cursor;
  }
}

describe('/start', () => {
  it('creates user, identity and chat idempotently', async () => {
    await bot.handleUpdate(textUpdate(111, '/start'));
    const firstUser = await chatUser(111);
    expect(lastText()).toContain('/summary');

    await bot.handleUpdate(textUpdate(111, '/start'));
    expect(await chatUser(111)).toBe(firstUser);

    const identities = await db.query(
      "select user_id from user_identities where provider = 'telegram' and provider_uid = '111'"
    );
    expect(identities.rows).toHaveLength(1);
    const chats = await db.query('select 1 from telegram_chats where tg_chat_id = 111');
    expect(chats.rows).toHaveLength(1);
  });

  it('binds the telegram identity to an existing account through a one-time link token', async () => {
    const created = await fetch(`${baseUrl}/dev/token`, { method: 'POST' });
    const { userId, token } = (await created.json()) as { userId: string; token: string };

    const unauthorized = await fetch(`${baseUrl}/link/token`, { method: 'POST' });
    expect(unauthorized.status).toBe(401);

    const minted = await fetch(`${baseUrl}/link/token`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(minted.status).toBe(200);
    const link = (await minted.json()) as { token: string };

    await bot.handleUpdate(textUpdate(222, `/start ${link.token}`));
    expect(lastText()).toContain('Linked');
    expect(await chatUser(222)).toBe(userId);

    await bot.handleUpdate(textUpdate(223, `/start ${link.token}`));
    expect(lastText()).toContain('invalid');
  });
});

describe('webhook', () => {
  it('rejects a wrong secret and accepts the configured one', async () => {
    const body = JSON.stringify(textUpdate(333, '/start'));
    const wrong = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'wrong',
      },
      body,
    });
    expect(wrong.status).toBe(401);
    expect(await chatUser(333)).toBe('undefined');

    const right = await fetch(`${baseUrl}/telegram/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
      },
      body: JSON.stringify(textUpdate(333, '/start')),
    });
    expect(right.status).toBe(200);
    expect(await chatUser(333)).not.toBe('undefined');
  });
});

describe('CSV document import', () => {
  it('imports a real Hevy export end to end and reports it', async () => {
    await bot.handleUpdate(textUpdate(444, '/start'));
    servedFiles.set('documents/hevy.csv', readFileSync(path.join(FIXTURES, 'hevy-kg.csv'), 'utf8'));

    await bot.handleUpdate(documentUpdate(444, 'documents/hevy.csv', 'hevy.csv'));
    const report = lastText();
    expect(report).toContain('hevy:workouts-csv-v1');
    expect(report).toContain('Sessions: 1');
    expect(report).toContain('Sets: 5');

    const userId = await chatUser(444);
    const events = await pullEvents(userId);
    const sets = allSets(events);
    expect(sets).toHaveLength(5);
    expect(new Set(sets.map(set => set.provenance?.source))).toEqual(new Set(['hevy']));
  });

  it('flags every row as a duplicate on a second upload of the same file', async () => {
    await bot.handleUpdate(documentUpdate(444, 'documents/hevy.csv', 'hevy.csv'));
    const report = lastText();
    expect(report).toContain('Sets: 0');
    expect(report).toContain('Duplicate rows skipped: 5');

    const userId = await chatUser(444);
    expect(allSets(await pullEvents(userId))).toHaveLength(5);
  });

  it('refuses a file that is not a workout export, helpfully', async () => {
    servedFiles.set('documents/junk.csv', 'just,some,columns\n1,2,3\n');
    await bot.handleUpdate(documentUpdate(444, 'documents/junk.csv', 'junk.csv'));
    expect(lastText()).toContain('does not look like a Hevy or Strong workout export');
  });
});

describe('shorthand capture', () => {
  it('previews a parsed set and imports it on confirm with telegram provenance', async () => {
    await bot.handleUpdate(textUpdate(555, '/start'));
    await bot.handleUpdate(textUpdate(555, 'bench press barbell 100x5 @2'));

    expect(lastText()).toContain('Bench Press (Barbell) 100 kg × 5 @RIR 2');
    const [row] = lastKeyboard();
    expect(row?.[0]?.text).toBe('Confirm');
    const confirmData = row?.[0]?.callback_data ?? '';
    expect(confirmData.startsWith('ok:')).toBe(true);

    await bot.handleUpdate(callbackUpdate(555, confirmData));
    expect(lastText()).toContain('telegram:shorthand-v1');
    expect(lastText()).toContain('Sets: 1');

    const userId = await chatUser(555);
    const sets = allSets(await pullEvents(userId));
    expect(sets).toHaveLength(1);
    const set = sets[0];
    expect(set?.provenance?.source).toBe('telegram');
    expect(set?.provenance?.sourceRecordId).toMatch(/^msg\d+#0$/);
    expect(set?.measurements.canonicalExternalLoadKg).toBe(100);
    expect(set?.measurements.reps).toBe(5);
    expect(set?.measurements.rirEntered).toBe(2);
    expect(set?.comparisonSignature).toContain('ex:bench_press_barbell');
  });

  it('cancels without logging anything', async () => {
    await bot.handleUpdate(textUpdate(556, '/start'));
    await bot.handleUpdate(textUpdate(556, 'push up 0x10'));
    const cancel = lastKeyboard()
      .flat()
      .find(button => button.text === 'Cancel');
    await bot.handleUpdate(callbackUpdate(556, cancel?.callback_data ?? ''));
    expect(lastText()).toContain('Cancelled');

    const userId = await chatUser(556);
    const events = await loadUserEvents(db, userId);
    expect(events).toHaveLength(0);
  });

  it('offers top-3 suggestions for an unknown name and logs the tapped one', async () => {
    await bot.handleUpdate(textUpdate(666, '/start'));
    await bot.handleUpdate(textUpdate(666, 'bench 80x8'));

    expect(lastText()).toContain('I do not know "bench"');
    const keyboard = lastKeyboard();
    expect(keyboard.length).toBe(4);
    const first = keyboard[0]?.[0];
    expect(first?.callback_data).toContain(':bench_press_barbell');

    await bot.handleUpdate(callbackUpdate(666, first?.callback_data ?? ''));
    expect(lastText()).toContain('Sets: 1');

    const userId = await chatUser(666);
    const sets = allSets(await pullEvents(userId));
    expect(sets).toHaveLength(1);
    expect(sets[0]?.comparisonSignature).toContain('ex:bench_press_barbell');
    expect(sets[0]?.provenance?.source).toBe('telegram');
  });

  it('rejects a message with an unreadable line without logging anything', async () => {
    await bot.handleUpdate(textUpdate(556, 'bench press barbell 100x5\nwat???'));
    expect(lastText()).toContain('could not read');
    const userId = await chatUser(556);
    expect(await loadUserEvents(db, userId)).toHaveLength(0);
  });
});

describe('/summary', () => {
  it('renders the most recent finished session as a card', async () => {
    await bot.handleUpdate(textUpdate(444, '/summary'));
    const card = lastText();
    expect(card).toContain('Evening Workout');
    expect(card).toContain('2025-12-05');
    expect(card).toContain('Bench Press (Barbell)');
    expect(card).toContain('Total volume:');
  });

  it('says so when nothing is finished yet', async () => {
    await bot.handleUpdate(textUpdate(557, '/start'));
    await bot.handleUpdate(textUpdate(557, '/summary'));
    expect(lastText()).toContain('No finished workout yet');
  });

  it('skips a tombstoned session and reports it after restore', async () => {
    await bot.handleUpdate(textUpdate(559, '/start'));
    const userId = await chatUser(559);
    const sessionId = 'ses-tombstone-1' as SessionId;
    const day = localDate('2026-07-27');
    const base = Date.parse('2026-07-27T10:00:00Z');
    const envelope = (eventId: string, tick: number) => ({
      eventId: eventId as EventId,
      aggregateId: sessionId,
      userId: userId as UserId,
      deviceId: 'seed' as DeviceId,
      schemaVersion: EVENT_SCHEMA_VERSION,
      hlc: { wallMillis: base + tick, counter: 0, nodeId: 'seed' },
      clientCreatedAt: instant(base + tick),
      serverReceivedAt: null,
      serverSequence: null,
    });
    const push = (events: DomainEvent[]) =>
      db.transaction(tx => pushBatch(tx, userId, { deviceId: 'seed', events }, Date.now()));

    await push([
      buildEvent(
        'SessionStarted',
        {
          sessionId,
          startedAt: instant(base),
          localDate: day,
          tzOffsetMinutes: 0,
          title: 'Ghost Day',
        },
        envelope('evt-t1', 0)
      ),
      buildEvent(
        'SessionFinished',
        { sessionId, finishedAt: instant(base + 1) },
        envelope('evt-t2', 1)
      ),
    ]);
    await bot.handleUpdate(textUpdate(559, '/summary'));
    expect(lastText()).toContain('Ghost Day');

    await push([
      buildEvent('SessionDeleted', { sessionId, reason: 'mislogged' }, envelope('evt-t3', 2)),
    ]);
    await bot.handleUpdate(textUpdate(559, '/summary'));
    expect(lastText()).toContain('No finished workout yet');

    await push([buildEvent('SessionRestored', { sessionId }, envelope('evt-t4', 3))]);
    await bot.handleUpdate(textUpdate(559, '/summary'));
    expect(lastText()).toContain('Ghost Day');
  });
});

describe('/next', () => {
  const library = loadExerciseLibrary();

  async function seedRealHistory(userId: string): Promise<void> {
    const document = JSON.parse(readFileSync(REAL_HISTORY, 'utf8')) as unknown;
    const result = runImport(extractLifeAsCode(document), {
      importBatchId: 'seed-real-history',
      userId: userId as UserId,
      deviceId: 'seed' as DeviceId,
      resolver: libraryResolver(library),
    });
    expect(result.report.setsImported).toBe(121);
    await db.transaction(tx =>
      pushBatch(tx, userId, { deviceId: 'seed', events: result.events }, Date.now())
    );
  }

  function prescribedBenchSession(userId: string): DomainEvent[] {
    const bench = library.byId.get('bench_press_barbell' as never);
    if (bench === undefined) throw new Error('bench definition missing');
    const signature = comparisonSignature(bench, null);
    const sessionId = 'ses-prescribed-1' as SessionId;
    const sessionExerciseId = 'sxe-p1' as SessionExerciseId;
    const day = localDate('2026-07-26');
    const base = Date.parse('2026-07-26T10:00:00Z');
    const envelope = (eventId: string, tick: number) => ({
      eventId: eventId as EventId,
      aggregateId: sessionId,
      userId: userId as UserId,
      deviceId: 'seed' as DeviceId,
      schemaVersion: EVENT_SCHEMA_VERSION,
      hlc: { wallMillis: base + tick, counter: 0, nodeId: 'seed' },
      clientCreatedAt: instant(base + tick),
      serverReceivedAt: null,
      serverSequence: null,
    });
    const snapshot: SetPrescriptionSnapshot = {
      prescriptionVersion: 1,
      setType: 'working',
      targetLoadKg: kilograms(100),
      targetRepMin: 5,
      targetRepMax: 8,
      targetRir: [1, 3],
      targetRpe: null,
      ruleId: 'rule-bench-dp' as ProgressionRuleId,
      ruleVersion: 1,
      explanationContext: null,
    };
    return [
      buildEvent(
        'SessionStarted',
        { sessionId, startedAt: instant(base), localDate: day, tzOffsetMinutes: 0, title: 'Push' },
        envelope('evt-p1', 0)
      ),
      buildEvent(
        'ExerciseAddedToSession',
        {
          sessionExerciseId,
          sessionId,
          exerciseDefinitionId: bench.id,
          equipmentInstanceId: null,
          orderIndex: 0,
          supersetGroupId: null,
          supersetOrder: null,
        },
        envelope('evt-p2', 1)
      ),
      buildEvent(
        'SetLogged',
        {
          setId: 'set-p1' as WorkoutSetId,
          sessionExerciseId,
          orderIndex: 0,
          setType: 'working',
          measurements: {
            enteredLoad: 100,
            enteredUnit: 'kg',
            canonicalExternalLoadKg: kilograms(100),
            reps: 8,
            durationSeconds: null,
            distanceMeters: null,
            rirEntered: 2,
            rpeEntered: null,
            actualRestSeconds: null,
          },
          qualifiers: {
            tempo: null,
            rangeOfMotionNote: null,
            painFlag: 0,
            formFlag: false,
            note: null,
          },
          equipmentInstanceId: null,
          bodyweightKgSnapshot: null,
          bodyweightSource: null,
          bodyweightAgeDays: null,
          prescriptionSnapshot: snapshot,
          exerciseRevisionSnapshot: 1,
          comparisonSignature: signature,
          provenance: null,
          performedAt: instant(base + 2),
          localDate: day,
          tzOffsetMinutes: 0,
        },
        envelope('evt-p3', 2)
      ),
      buildEvent(
        'SessionFinished',
        { sessionId, finishedAt: instant(base + 3) },
        envelope('evt-p4', 3)
      ),
    ];
  }

  it('shows last performances when history exists but nothing was ever prescribed', async () => {
    await bot.handleUpdate(textUpdate(777, '/start'));
    const userId = await chatUser(777);
    await seedRealHistory(userId);

    await bot.handleUpdate(textUpdate(777, '/next bench press barbell'));
    const reply = lastText();
    expect(reply).toContain('Bench Press (Barbell)');
    expect(reply).toContain('no prescription exists yet');
    expect(reply).toMatch(/kg × \d+/);
  });

  it('returns an explained recommendation once a prescribed session exists', async () => {
    const userId = await chatUser(777);
    await db.transaction(tx =>
      pushBatch(
        tx,
        userId,
        { deviceId: 'seed', events: prescribedBenchSession(userId) },
        Date.now()
      )
    );

    await bot.handleUpdate(textUpdate(777, '/next bench press barbell'));
    const reply = lastText();
    expect(reply).toContain('Bench Press (Barbell)');
    expect(reply).toContain('Reasons:');
    expect(reply).toContain('Confidence:');
  });

  it('says which exercise it assumed when only search matches', async () => {
    await bot.handleUpdate(textUpdate(777, '/next bench'));
    expect(lastText()).toContain('Assuming you mean Bench Press (Barbell)');

    await bot.handleUpdate(textUpdate(777, '/next benchh'));
    expect(lastText()).toContain('could not match');
  });
});

describe('/export', () => {
  it('sends the full event log as a JSON document', async () => {
    await bot.handleUpdate(textUpdate(444, '/export'));
    const sent = outbox.find(call => call.method === 'sendDocument');
    expect(sent).toBeDefined();
    expect(sent?.payload['document']).toBeDefined();
  });
});

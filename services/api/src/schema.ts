import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  type DeviceId,
  type DomainEvent,
  type DomainEventType,
  type EventId,
  type SessionId,
  type UserId,
} from '@ferrum/domain';

// Mirrors src/migrations/*.sql exactly. The SQL files remain the source of truth
// for DDL (applied by migrate.ts); this schema is the typed query layer over it.

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
});

export const userIdentities = pgTable(
  'user_identities',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerUid: text('provider_uid').notNull(),
  },
  table => [unique().on(table.provider, table.providerUid)]
);

export const authTokens = pgTable('auth_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const events = pgTable(
  'events',
  {
    userId: uuid('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: text('event_id').$type<EventId>().notNull(),
    aggregateId: text('aggregate_id').$type<SessionId>().notNull(),
    eventType: text('event_type').$type<DomainEventType>().notNull(),
    schemaVersion: integer('schema_version').notNull(),
    hlc: text('hlc').notNull(),
    deviceId: text('device_id').$type<DeviceId>().notNull(),
    payload: jsonb('payload').$type<DomainEvent['payload']>().notNull(),
    clientCreatedAt: timestamp('client_created_at', { withTimezone: true, mode: 'date' }).notNull(),
    serverReceivedAt: timestamp('server_received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    serverSequence: bigint('server_sequence', { mode: 'number' })
      .notNull()
      .generatedAlwaysAsIdentity(),
  },
  table => [
    primaryKey({ columns: [table.userId, table.eventId] }),
    index('events_user_sequence_idx').on(table.userId, table.serverSequence),
  ]
);

export const purgedAggregates = pgTable(
  'purged_aggregates',
  {
    userId: uuid('user_id')
      .$type<UserId>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    aggregateId: text('aggregate_id').$type<SessionId>().notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    purgeSequence: bigint('purge_sequence', { mode: 'number' })
      .notNull()
      .generatedAlwaysAsIdentity(),
  },
  table => [
    primaryKey({ columns: [table.userId, table.aggregateId] }),
    index('purged_aggregates_user_sequence_idx').on(table.userId, table.purgeSequence),
  ]
);

export const deviceClocks = pgTable(
  'device_clocks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    wallMillis: bigint('wall_millis', { mode: 'number' }).notNull(),
    counter: integer('counter').notNull(),
  },
  table => [primaryKey({ columns: [table.userId, table.deviceId] })]
);

export const telegramChats = pgTable('telegram_chats', {
  tgChatId: bigint('tg_chat_id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  tzOffsetMinutes: integer('tz_offset_minutes').notNull().default(0),
});

export const linkTokens = pgTable('link_tokens', {
  token: text('token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export interface PendingShorthand {
  readonly kind: 'shorthand';
  readonly messageId: number;
  readonly chatId: number;
  readonly date: string;
  readonly tzOffsetMinutes: number;
  readonly lines: readonly {
    readonly ordinal: number;
    readonly rawExerciseName: string;
    readonly loadKg: number;
    readonly reps: number;
    readonly rir: number | null;
  }[];
  readonly overrides: Readonly<Record<string, string>>;
}

export const botPending = pgTable('bot_pending', {
  id: text('id').primaryKey(),
  tgChatId: bigint('tg_chat_id', { mode: 'number' }).notNull(),
  payload: jsonb('payload').$type<PendingShorthand>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

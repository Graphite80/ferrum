import { randomUUID } from 'node:crypto';
import { type Database, type QueryRunner } from '../db.ts';

const TELEGRAM_PROVIDER = 'telegram';

export async function findOrCreateTelegramUser(db: Database, providerUid: string): Promise<string> {
  return db.transaction(async tx => {
    const existing = await findTelegramUser(tx, providerUid);
    if (existing != null) return existing;
    const created = await tx.query('insert into users default values returning id');
    const userId = String(created.rows[0]?.id);
    await tx.query(
      `insert into user_identities (user_id, provider, provider_uid)
       values ($1, $2, $3)
       on conflict (provider, provider_uid) do nothing`,
      [userId, TELEGRAM_PROVIDER, providerUid]
    );
    const settled = await findTelegramUser(tx, providerUid);
    return settled ?? userId;
  });
}

async function findTelegramUser(tx: QueryRunner, providerUid: string): Promise<string | null> {
  const found = await tx.query(
    'select user_id from user_identities where provider = $1 and provider_uid = $2',
    [TELEGRAM_PROVIDER, providerUid]
  );
  const row = found.rows[0];
  return row === undefined ? null : String(row.user_id);
}

export async function bindTelegramIdentity(
  db: Database,
  userId: string,
  providerUid: string
): Promise<void> {
  await db.query(
    `insert into user_identities (user_id, provider, provider_uid)
     values ($1, $2, $3)
     on conflict (provider, provider_uid) do update set user_id = excluded.user_id`,
    [userId, TELEGRAM_PROVIDER, providerUid]
  );
}

export async function upsertChat(db: Database, tgChatId: number, userId: string): Promise<void> {
  await db.query(
    `insert into telegram_chats (tg_chat_id, user_id)
     values ($1, $2)
     on conflict (tg_chat_id) do update set user_id = excluded.user_id`,
    [tgChatId, userId]
  );
}

export async function chatTzOffsetMinutes(db: Database, tgChatId: number): Promise<number> {
  const result = await db.query(
    'select tz_offset_minutes from telegram_chats where tg_chat_id = $1',
    [tgChatId]
  );
  return Number(result.rows[0]?.tz_offset_minutes ?? 0);
}

export async function setChatTzOffsetMinutes(
  db: Database,
  tgChatId: number,
  offsetMinutes: number
): Promise<void> {
  await db.query('update telegram_chats set tz_offset_minutes = $2 where tg_chat_id = $1', [
    tgChatId,
    offsetMinutes,
  ]);
}

export async function userForChat(db: Database, tgChatId: number): Promise<string | null> {
  const found = await db.query('select user_id from telegram_chats where tg_chat_id = $1', [
    tgChatId,
  ]);
  const row = found.rows[0];
  return row === undefined ? null : String(row.user_id);
}

export const LINK_TOKEN_TTL_MINUTES = 15;

export async function mintLinkToken(
  db: Database,
  userId: string
): Promise<{ token: string; expiresAt: string }> {
  const token = randomUUID();
  const inserted = await db.query(
    `insert into link_tokens (token, user_id, expires_at)
     values ($1, $2, now() + make_interval(mins => $3))
     returning expires_at`,
    [token, userId, LINK_TOKEN_TTL_MINUTES]
  );
  return { token, expiresAt: String(inserted.rows[0]?.expires_at) };
}

export async function consumeLinkToken(db: Database, token: string): Promise<string | null> {
  const consumed = await db.query(
    `update link_tokens set used_at = now()
     where token = $1 and used_at is null and expires_at > now()
     returning user_id`,
    [token]
  );
  const row = consumed.rows[0];
  return row === undefined ? null : String(row.user_id);
}

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

export async function savePending(
  db: Database,
  id: string,
  tgChatId: number,
  payload: PendingShorthand
): Promise<void> {
  await db.query(
    `insert into bot_pending (id, tg_chat_id, payload)
     values ($1, $2, $3)
     on conflict (id) do update set payload = excluded.payload`,
    [id, tgChatId, JSON.stringify(payload)]
  );
}

export async function loadPending(
  db: Database,
  id: string,
  tgChatId: number
): Promise<PendingShorthand | null> {
  const found = await db.query(
    'select payload from bot_pending where id = $1 and tg_chat_id = $2',
    [id, tgChatId]
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  const payload = row.payload;
  return (typeof payload === 'string' ? JSON.parse(payload) : payload) as PendingShorthand;
}

export async function deletePending(db: Database, id: string): Promise<void> {
  await db.query('delete from bot_pending where id = $1', [id]);
}

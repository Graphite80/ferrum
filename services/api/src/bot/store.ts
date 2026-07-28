import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Database, type Tx } from '../db.ts';
import {
  botPending,
  linkTokens,
  telegramChats,
  userIdentities,
  users,
  type PendingShorthand,
} from '../schema.ts';

export { type PendingShorthand } from '../schema.ts';

const TELEGRAM_PROVIDER = 'telegram';

export async function findOrCreateTelegramUser(db: Database, providerUid: string): Promise<string> {
  return db.transaction(async tx => {
    const existing = await findTelegramUser(tx, providerUid);
    if (existing != null) return existing;
    const created = await tx.insert(users).values({}).returning({ id: users.id });
    const userId = created[0]?.id;
    if (userId === undefined) throw new Error('user insert returned no row');
    await tx
      .insert(userIdentities)
      .values({ userId, provider: TELEGRAM_PROVIDER, providerUid })
      .onConflictDoNothing({ target: [userIdentities.provider, userIdentities.providerUid] });
    const settled = await findTelegramUser(tx, providerUid);
    return settled ?? userId;
  });
}

async function findTelegramUser(tx: Tx, providerUid: string): Promise<string | null> {
  const found = await tx
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, TELEGRAM_PROVIDER),
        eq(userIdentities.providerUid, providerUid)
      )
    );
  return found[0]?.userId ?? null;
}

export async function bindTelegramIdentity(
  db: Database,
  userId: string,
  providerUid: string
): Promise<void> {
  await db.orm
    .insert(userIdentities)
    .values({ userId, provider: TELEGRAM_PROVIDER, providerUid })
    .onConflictDoUpdate({
      target: [userIdentities.provider, userIdentities.providerUid],
      set: { userId: sql`excluded.user_id` },
    });
}

export async function upsertChat(db: Database, tgChatId: number, userId: string): Promise<void> {
  await db.orm
    .insert(telegramChats)
    .values({ tgChatId, userId })
    .onConflictDoUpdate({
      target: telegramChats.tgChatId,
      set: { userId: sql`excluded.user_id` },
    });
}

export async function chatTzOffsetMinutes(db: Database, tgChatId: number): Promise<number> {
  const found = await db.orm
    .select({ tzOffsetMinutes: telegramChats.tzOffsetMinutes })
    .from(telegramChats)
    .where(eq(telegramChats.tgChatId, tgChatId));
  return found[0]?.tzOffsetMinutes ?? 0;
}

export async function setChatTzOffsetMinutes(
  db: Database,
  tgChatId: number,
  offsetMinutes: number
): Promise<void> {
  await db.orm
    .update(telegramChats)
    .set({ tzOffsetMinutes: offsetMinutes })
    .where(eq(telegramChats.tgChatId, tgChatId));
}

export async function userForChat(db: Database, tgChatId: number): Promise<string | null> {
  const found = await db.orm
    .select({ userId: telegramChats.userId })
    .from(telegramChats)
    .where(eq(telegramChats.tgChatId, tgChatId));
  return found[0]?.userId ?? null;
}

export const LINK_TOKEN_TTL_MINUTES = 15;

export async function mintLinkToken(
  db: Database,
  userId: string
): Promise<{ token: string; expiresAt: string }> {
  const token = randomUUID();
  const inserted = await db.orm
    .insert(linkTokens)
    .values({
      token,
      userId,
      expiresAt: sql`now() + make_interval(mins => ${LINK_TOKEN_TTL_MINUTES})`,
    })
    .returning({ expiresAt: linkTokens.expiresAt });
  return { token, expiresAt: String(inserted[0]?.expiresAt) };
}

export async function consumeLinkToken(db: Database, token: string): Promise<string | null> {
  const consumed = await db.orm
    .update(linkTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(linkTokens.token, token),
        isNull(linkTokens.usedAt),
        gt(linkTokens.expiresAt, sql`now()`)
      )
    )
    .returning({ userId: linkTokens.userId });
  return consumed[0]?.userId ?? null;
}

export async function savePending(
  db: Database,
  id: string,
  tgChatId: number,
  payload: PendingShorthand
): Promise<void> {
  await db.orm
    .insert(botPending)
    .values({ id, tgChatId, payload })
    .onConflictDoUpdate({ target: botPending.id, set: { payload: sql`excluded.payload` } });
}

export async function loadPending(
  db: Database,
  id: string,
  tgChatId: number
): Promise<PendingShorthand | null> {
  const found = await db.orm
    .select({ payload: botPending.payload })
    .from(botPending)
    .where(and(eq(botPending.id, id), eq(botPending.tgChatId, tgChatId)));
  return found[0]?.payload ?? null;
}

export async function deletePending(db: Database, id: string): Promise<void> {
  await db.orm.delete(botPending).where(eq(botPending.id, id));
}

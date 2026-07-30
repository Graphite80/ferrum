import { and, eq } from 'drizzle-orm';
import { type Database, type Tx } from './db.ts';
import { userIdentities, users } from './schema.ts';

// One account per external identity, whichever provider brought it in. The
// insert races against a second device signing in at the same moment, so the
// conflict is absorbed and the row re-read rather than trusted blind.
export async function findOrCreateUserByIdentity(
  db: Database,
  provider: string,
  providerUid: string
): Promise<string> {
  return db.transaction(async tx => {
    const existing = await findUserByIdentity(tx, provider, providerUid);
    if (existing != null) return existing;
    const created = await tx.insert(users).values({}).returning({ id: users.id });
    const userId = created[0]?.id;
    if (userId === undefined) throw new Error('user insert returned no row');
    await tx
      .insert(userIdentities)
      .values({ userId, provider, providerUid })
      .onConflictDoNothing({ target: [userIdentities.provider, userIdentities.providerUid] });
    const settled = await findUserByIdentity(tx, provider, providerUid);
    return settled ?? userId;
  });
}

export async function findUserByIdentity(
  tx: Tx,
  provider: string,
  providerUid: string
): Promise<string | null> {
  const found = await tx
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(and(eq(userIdentities.provider, provider), eq(userIdentities.providerUid, providerUid)));
  return found[0]?.userId ?? null;
}

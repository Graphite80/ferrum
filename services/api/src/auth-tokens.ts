import { createHash, randomUUID } from 'node:crypto';
import { type Database } from './db.ts';
import { authTokens, users } from './schema.ts';

// Bearer tokens are stored hashed: a read of the auth_tokens table must not be
// a read of every user's credential.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function mintToken(db: Database): Promise<{ userId: string; token: string }> {
  const created = await db.orm.insert(users).values({}).returning({ id: users.id });
  const userId = created[0]?.id;
  if (userId === undefined) throw new Error('user insert returned no row');
  return mintTokenForUser(db, userId);
}

export async function mintTokenForUser(
  db: Database,
  userId: string
): Promise<{ userId: string; token: string }> {
  const token = randomUUID();
  await db.orm.insert(authTokens).values({ tokenHash: hashToken(token), userId });
  return { userId, token };
}

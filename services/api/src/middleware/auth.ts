import { and, eq, isNull } from 'drizzle-orm';
import { type MiddlewareHandler } from 'hono';
import { hashToken } from '../auth-tokens.ts';
import { type Database } from '../db.ts';
import { authTokens } from '../schema.ts';

export type AppEnv = { Variables: { userId: string } };

export function requireAuth(db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization');
    if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const token = header.slice('bearer '.length).trim();
    if (token.length === 0) return c.json({ error: 'unauthorized' }, 401);
    const found = await db.orm
      .select({ userId: authTokens.userId })
      .from(authTokens)
      .where(and(eq(authTokens.tokenHash, hashToken(token)), isNull(authTokens.revokedAt)));
    const row = found[0];
    if (row === undefined) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', row.userId);
    await next();
  };
}

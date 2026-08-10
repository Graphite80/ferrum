import { db, type VariantChoiceRecord, withDatabaseRecovery } from '../db/ferrum-db.ts';

export async function listVariantChoices(): Promise<readonly VariantChoiceRecord[]> {
  return withDatabaseRecovery(() => db.variantChoices.toArray());
}

export async function rememberVariant(
  groupId: string,
  definitionId: string,
  nowMillis: number
): Promise<void> {
  await withDatabaseRecovery(() =>
    db.variantChoices.put({ groupId, definitionId, atMillis: nowMillis })
  );
}

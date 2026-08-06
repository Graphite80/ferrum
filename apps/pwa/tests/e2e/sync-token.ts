import { expect, type Page } from '@playwright/test';

// Settings has no token field: a lifter signs in with the hub, and nobody outside
// this suite has a token to paste. The suite still needs one — /dev/token is how it
// gets a synced account without a hub — so it writes the same `settings` record
// `saveSyncConfig` writes and reloads, because the live client reads its token at
// start-up. That reload is not a workaround: it is what a linked device does on
// every launch, so installing a token this way exercises the path production uses.
const SETTINGS_KEY = 'syncConfig';

async function readRecord(page: Page): Promise<{ syncToken: string | null } | null> {
  return page.evaluate(
    key =>
      new Promise<{ syncToken: string | null } | null>((resolve, reject) => {
        const open = indexedDB.open('ferrum');
        open.onerror = () => {
          reject(new Error('could not open the ferrum database'));
        };
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains('settings')) {
            database.close();
            resolve(null);
            return;
          }
          const request = database
            .transaction('settings', 'readonly')
            .objectStore('settings')
            .get(key);
          request.onerror = () => {
            database.close();
            reject(new Error('could not read the settings store'));
          };
          request.onsuccess = () => {
            database.close();
            resolve((request.result as { syncToken: string | null } | undefined) ?? null);
          };
        };
      }),
    SETTINGS_KEY
  );
}

export async function storedSyncToken(page: Page): Promise<string | null> {
  return (await readRecord(page))?.syncToken ?? null;
}

export async function expectNoStoredToken(page: Page): Promise<void> {
  expect(await storedSyncToken(page)).toBeNull();
}

export async function expectStoredToken(page: Page): Promise<void> {
  expect(await storedSyncToken(page)).not.toBeNull();
}

export async function installSyncToken(page: Page, token: string): Promise<void> {
  await page.evaluate(
    ([key, value]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('ferrum');
        open.onerror = () => {
          reject(new Error('could not open the ferrum database'));
        };
        open.onsuccess = () => {
          const database = open.result;
          const request = database
            .transaction('settings', 'readwrite')
            .objectStore('settings')
            .put({ key, syncToken: value });
          request.onerror = () => {
            database.close();
            reject(new Error('could not write the settings store'));
          };
          request.onsuccess = () => {
            database.close();
            resolve();
          };
        };
      }),
    [SETTINGS_KEY, token] as const
  );
  await page.reload();
}

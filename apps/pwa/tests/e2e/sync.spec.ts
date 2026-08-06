import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { installSyncToken } from './sync-token.ts';

// The app is served by the sync server itself, the way production serves it:
// sync targets the origin the page came from, so a preview server with no API
// behind it cannot exercise a single sync path.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const apiDir = path.join(repoRoot, 'services/api');
const staticDir = path.join(repoRoot, 'apps/pwa/dist');
const tsxCli = path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const SYNC_PORT = 3411;
const syncServerUrl = `http://127.0.0.1:${SYNC_PORT}`;

let serverProcess: ChildProcess | null = null;
let dataDir = '';

async function waitForHealth(timeoutMillis = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  for (;;) {
    try {
      const response = await fetch(`${syncServerUrl}/health`);
      if (response.ok) return;
    } catch {
      // still booting
    }
    if (Date.now() > deadline) throw new Error('sync dev server did not become healthy');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

async function startSyncServer(): Promise<void> {
  serverProcess = spawn(process.execPath, [tsxCli, 'src/dev-server.ts'], {
    cwd: apiDir,
    env: { ...process.env, PORT: String(SYNC_PORT), PGLITE_DIR: dataDir, STATIC_DIR: staticDir },
    stdio: 'ignore',
  });
  await waitForHealth();
}

async function stopSyncServer(): Promise<void> {
  const child = serverProcess;
  if (child === null) return;
  serverProcess = null;
  const exited = new Promise<void>(resolve =>
    child.once('exit', () => {
      resolve();
    })
  );
  child.kill('SIGTERM');
  await exited;
}

async function mintToken(): Promise<string> {
  const response = await fetch(`${syncServerUrl}/dev/token`, { method: 'POST' });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function configureSync(page: Page, token: string): Promise<void> {
  await page.goto(syncServerUrl);
  await installSyncToken(page, token);
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('sync-last-success')).not.toHaveText('never', { timeout: 15_000 });
  await page.getByTestId('settings-back').click();
}

async function logWorkout(page: Page, sets: number): Promise<void> {
  await page.getByTestId('start-routine').click();
  for (let i = 0; i < sets; i += 1) {
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText(
      `${String(i + 1)} ${i === 0 ? 'set' : 'sets'}`
    );
  }
  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('workout-summary')).toBeVisible();
  await page.getByTestId('summary-home').click();
}

async function syncNowExpectDrained(page: Page): Promise<void> {
  await page.getByTestId('open-settings').click();
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('sync-pending')).toHaveText('0', { timeout: 15_000 });
  await page.getByTestId('settings-back').click();
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'ferrum-sync-e2e-'));
  await startSyncServer();
});

test.afterAll(async () => {
  await stopSyncServer();
});

test.describe('sync across devices', () => {
  test('a workout logged on device A reaches device B byte-identical, and B flows back', async ({
    browser,
  }) => {
    const token = await mintToken();

    const deviceA = await browser.newContext();
    const pageA = await deviceA.newPage();
    await configureSync(pageA, token);
    await logWorkout(pageA, 2);
    await syncNowExpectDrained(pageA);

    await pageA.getByTestId('open-history').click();
    await expect(pageA.getByTestId('pending-events')).toContainText('0 events not yet synced');
    await pageA.getByTestId('history-item').click();
    await expect(pageA.getByTestId('detail-set-values')).toHaveCount(2);
    const valuesA = await pageA.getByTestId('detail-set-values').allTextContents();
    await pageA.getByTestId('detail-back').click();
    await pageA.getByTestId('back-home').click();

    // Device B is a fresh browser context: empty IndexedDB, its own device id.
    const deviceB = await browser.newContext();
    const pageB = await deviceB.newPage();
    await configureSync(pageB, token);

    await pageB.getByTestId('open-history').click();
    await expect(pageB.getByTestId('history-item')).toHaveCount(1);
    await pageB.getByTestId('history-item').click();
    await expect(pageB.getByTestId('detail-set-values')).toHaveCount(2);
    const valuesB = await pageB.getByTestId('detail-set-values').allTextContents();
    expect(valuesB).toEqual(valuesA);
    await pageB.getByTestId('detail-back').click();
    await pageB.getByTestId('back-home').click();

    await logWorkout(pageB, 1);
    await syncNowExpectDrained(pageB);

    await syncNowExpectDrained(pageA);
    await pageA.getByTestId('open-history').click();
    await expect(pageA.getByTestId('history-item')).toHaveCount(2);
    await expect(pageA.getByTestId('pending-events')).toContainText('0 events not yet synced');

    await deviceA.close();
    await deviceB.close();
  });

  test('a deletion on device A reaches device B and hides the workout there too', async ({
    browser,
  }) => {
    const token = await mintToken();

    const deviceA = await browser.newContext();
    const pageA = await deviceA.newPage();
    await configureSync(pageA, token);
    await logWorkout(pageA, 1);
    await syncNowExpectDrained(pageA);

    const deviceB = await browser.newContext();
    const pageB = await deviceB.newPage();
    await configureSync(pageB, token);
    await pageB.getByTestId('open-history').click();
    await expect(pageB.getByTestId('history-item')).toHaveCount(1);
    await pageB.getByTestId('back-home').click();

    await pageA.getByTestId('open-history').click();
    await pageA.getByTestId('history-item').click();
    await pageA.getByTestId('delete-workout').click();
    await pageA.getByTestId('confirm-delete-workout').click();
    await expect(pageA.getByTestId('history-item')).toHaveCount(0);
    await pageA.getByTestId('back-home').click();
    await syncNowExpectDrained(pageA);

    await syncNowExpectDrained(pageB);
    await pageB.getByTestId('open-history').click();
    await expect(pageB.getByTestId('history-item')).toHaveCount(0);
    await expect(pageB.getByTestId('show-deleted-toggle')).toHaveText('Show deleted (1)');

    await deviceA.close();
    await deviceB.close();
  });

  test('erasing on device A destroys the workout on the server and on device B', async ({
    browser,
  }) => {
    const token = await mintToken();

    const deviceA = await browser.newContext();
    const pageA = await deviceA.newPage();
    await configureSync(pageA, token);
    await logWorkout(pageA, 1);
    await syncNowExpectDrained(pageA);

    const deviceB = await browser.newContext();
    const pageB = await deviceB.newPage();
    await configureSync(pageB, token);
    await pageB.getByTestId('open-history').click();
    await expect(pageB.getByTestId('history-item')).toHaveCount(1);
    await pageB.getByTestId('back-home').click();

    await pageA.getByTestId('open-history').click();
    await pageA.getByTestId('history-item').click();
    await pageA.getByTestId('delete-workout').click();
    await pageA.getByTestId('confirm-delete-workout').click();
    await pageA.getByTestId('show-deleted-toggle').click();
    await pageA.getByTestId('purge-session').click();
    await pageA.getByTestId('confirm-purge-session').click();
    await expect(pageA.getByTestId('history-empty')).toBeVisible();
    await pageA.getByTestId('back-home').click();
    await syncNowExpectDrained(pageA);

    // Device B learns from the purge journal, not from an event: the log it holds
    // has no record of this, and the server has nothing left to send.
    await syncNowExpectDrained(pageB);
    await pageB.getByTestId('open-history').click();
    await expect(pageB.getByTestId('history-empty')).toBeVisible();
    await expect(pageB.getByTestId('show-deleted-toggle')).toHaveCount(0);
    await pageB.getByTestId('back-home').click();

    // And it stays erased: another round trip must not resurrect it from either side.
    await syncNowExpectDrained(pageA);
    await syncNowExpectDrained(pageB);
    await pageA.getByTestId('open-history').click();
    await expect(pageA.getByTestId('history-empty')).toBeVisible();

    await deviceA.close();
    await deviceB.close();
  });

  test('a bot import converges into the device and the folded clock keeps pushing cleanly', async ({
    browser,
  }) => {
    const token = await mintToken();
    const context = await browser.newContext();
    const page = await context.newPage();
    await configureSync(page, token);
    await logWorkout(page, 2);
    await syncNowExpectDrained(page);

    // A Telegram shorthand message lands server-side through the real bot
    // import path, on a day of its own so the session is unmistakable.
    const botDay = '2026-07-20';
    const importResponse = await fetch(`${syncServerUrl}/dev/bot-import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        lines: ['barbell bench press 100x5 @2'],
        messageId: 4242,
        date: Math.floor(Date.parse(`${botDay}T12:00:00Z`) / 1000),
      }),
    });
    expect(importResponse.status).toBe(200);
    const outcome = (await importResponse.json()) as {
      accepted: number;
      setsImported: number;
      unresolved: number;
    };
    expect(outcome.setsImported).toBe(1);
    expect(outcome.unresolved).toBe(0);
    expect(outcome.accepted).toBeGreaterThan(0);

    await syncNowExpectDrained(page);
    await page.getByTestId('open-history').click();
    await expect(page.getByTestId('history-item')).toHaveCount(2, { timeout: 15_000 });
    const botSession = page.getByTestId('history-item').filter({ hasText: botDay });
    await expect(botSession).toHaveCount(1);
    await botSession.click();
    await expect(page.getByTestId('detail-date')).toHaveText(botDay);
    await expect(page.getByTestId('detail-exercise')).toContainText('Bench Press (Barbell)');
    await expect(page.getByTestId('detail-set-values')).toHaveText('100 kg × 5');
    await expect(page.getByTestId('history-detail')).toContainText('RIR 2');
    await page.getByTestId('detail-back').click();
    await page.getByTestId('back-home').click();

    // The wire truth, not the UI: the bot envelope carries its own device id
    // and the set says where it came from.
    const pullResponse = await fetch(`${syncServerUrl}/sync/pull?after=0&limit=500`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pullResponse.status).toBe(200);
    const pulled = (await pullResponse.json()) as {
      events: {
        deviceId: string;
        eventType: string;
        payload: { provenance?: { source?: string } | null };
      }[];
    };
    const botEvents = pulled.events.filter(event => event.deviceId === 'tg-import');
    expect(botEvents.length).toBeGreaterThan(0);
    const botSets = botEvents.filter(event => event.eventType === 'SetLogged');
    expect(botSets).toHaveLength(1);
    expect(botSets[0]?.payload.provenance?.source).toBe('telegram');

    // After folding the bot's clock on pull, a fresh local workout must still
    // produce an ordering the server accepts — drained, no drift, no error.
    await logWorkout(page, 1);
    await syncNowExpectDrained(page);
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('sync-error')).toHaveCount(0);
    await expect(page.getByTestId('sync-drift-warning')).toHaveCount(0);
    await page.getByTestId('settings-back').click();

    const afterPush = await fetch(`${syncServerUrl}/sync/pull?after=0&limit=500`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const afterEvents = (await afterPush.json()) as { events: { deviceId: string }[] };
    expect(afterEvents.events.length).toBeGreaterThan(pulled.events.length);

    await context.close();
  });

  test('a dead server never touches logging; pending grows offline and drains on recovery', async ({
    browser,
  }) => {
    const token = await mintToken();
    const context = await browser.newContext();
    const page = await context.newPage();
    await configureSync(page, token);

    await stopSyncServer();

    // Logging is local-first: the whole workout must complete with no server at all.
    await logWorkout(page, 2);
    await page.getByTestId('open-history').click();
    await expect(page.getByTestId('history-item')).toHaveCount(1);
    const pendingText = (await page.getByTestId('pending-events').textContent()) ?? '0';
    expect(Number.parseInt(pendingText, 10)).toBeGreaterThan(0);
    await page.getByTestId('back-home').click();

    // Same data directory, so users and tokens survive the restart.
    await startSyncServer();
    await syncNowExpectDrained(page);

    await page.getByTestId('open-history').click();
    await expect(page.getByTestId('pending-events')).toContainText('0 events not yet synced');

    await context.close();
  });
});

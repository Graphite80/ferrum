import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const apiDir = path.join(repoRoot, 'services/api');
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
    env: { ...process.env, PORT: String(SYNC_PORT), PGLITE_DIR: dataDir },
    stdio: 'ignore',
  });
  await waitForHealth();
}

async function stopSyncServer(): Promise<void> {
  const child = serverProcess;
  if (child === null) return;
  serverProcess = null;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
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
  await page.goto('/');
  await page.getByTestId('open-settings').click();
  await page.getByTestId('sync-server-url').fill(syncServerUrl);
  await page.getByTestId('sync-token').fill(token);
  await page.getByTestId('sync-save').click();
  await expect(page.getByTestId('sync-last-success')).not.toHaveText('never', { timeout: 15_000 });
  await page.getByTestId('settings-back').click();
}

async function logWorkout(page: Page, sets: number): Promise<void> {
  await page.getByTestId('start-routine').click();
  for (let i = 0; i < sets; i += 1) {
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText(`${String(i + 1)} sets`);
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

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// An imported workout carries no title of its own — the source has none — so
// without a derived name a history of hundreds of them reads as the same word
// repeated, which is the state this drill exists to keep out.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const apiDir = path.join(repoRoot, 'services/api');
const staticDir = path.join(repoRoot, 'apps/pwa/dist');
const tsxCli = path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const PORT = 3413;
const serverUrl = `http://127.0.0.1:${String(PORT)}`;

let serverProcess: ChildProcess | null = null;
let dataDir = '';

async function waitForHealth(timeoutMillis = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  for (;;) {
    try {
      if ((await fetch(`${serverUrl}/health`)).ok) return;
    } catch {
      // still booting
    }
    if (Date.now() > deadline) throw new Error('naming dev server did not become healthy');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'ferrum-naming-e2e-'));
  serverProcess = spawn(process.execPath, [tsxCli, 'src/dev-server.ts'], {
    cwd: apiDir,
    env: { ...process.env, PORT: String(PORT), PGLITE_DIR: dataDir, STATIC_DIR: staticDir },
    stdio: 'ignore',
  });
  await waitForHealth();
});

test.afterAll(async () => {
  const child = serverProcess;
  if (child === null) return;
  serverProcess = null;
  const exited = new Promise<void>(resolve => {
    child.once('exit', () => {
      resolve();
    });
  });
  child.kill('SIGTERM');
  await exited;
});

async function mintToken(): Promise<string> {
  const response = await fetch(`${serverUrl}/dev/token`, { method: 'POST' });
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function botImport(token: string, day: string, lines: readonly string[]): Promise<void> {
  const response = await fetch(`${serverUrl}/dev/bot-import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      lines,
      messageId: Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000),
      date: Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000),
    }),
  });
  expect(response.status).toBe(200);
}

async function configureSync(page: Page, token: string): Promise<void> {
  await page.goto(serverUrl);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('sync-token').fill(token);
  await page.getByTestId('sync-save').click();
  await expect(page.getByTestId('sync-last-success')).not.toHaveText('never', { timeout: 15_000 });
  await page.getByTestId('settings-back').click();
}

test.describe('naming an imported workout', () => {
  test('a session with no title of its own is named after what it trained', async ({ page }) => {
    const token = await mintToken();
    // Two days that must NOT end up with the same name, which is the whole
    // complaint a list of identical rows produces.
    await botImport(token, '2026-07-19', ['barbell bench press 100x5 @2']);
    await botImport(token, '2026-07-18', ['barbell squat 120x5 @2']);

    await configureSync(page, token);
    await page.getByTestId('open-history').click();

    await expect(page.getByTestId('history-item')).toHaveCount(2);
    const names = await page
      .getByTestId('history-item')
      .evaluateAll(items => items.map(item => item.querySelector('span')?.textContent.trim()));

    // Two different names, and neither is the fallback — the exact complaint a
    // list of identical rows produces.
    expect(names).toContain('Push');
    expect(names).toContain('Legs');
    expect(names).not.toContain('Workout');
  });

  // The seeded routine's exercise ids were hyphenated while the library's are
  // underscored, and history is looked up by that id — so a lifter with five
  // years of squats opened the starter routine and every exercise read "no
  // previous set". The drill is the whole point of importing at all.
  test('the starter routine finds the history that was imported for it', async ({ page }) => {
    const token = await mintToken();
    await botImport(token, '2026-07-16', [
      'squat machine 100x8 @2',
      'lat pulldown 70x10 @2',
      'triceps pushdown 35x12 @2',
    ]);

    await configureSync(page, token);
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();

    const labels = page.getByTestId('previous-label');
    await expect(labels.first()).toContainText('Last time', { timeout: 15_000 });
    const texts = await labels.allTextContents();
    expect(texts.filter(text => text.includes('Last time')).length).toBeGreaterThanOrEqual(3);
    // The number carried over, not just the words.
    expect(texts.some(text => text.includes('100'))).toBe(true);
  });

  // The source records a date, not a clock, so an imported session starts and
  // finishes on the same instant. That used to render as "0 s", which claims a
  // workout that took no time rather than one whose length was never recorded.
  test('an imported workout claims no duration it never had', async ({ page }) => {
    const token = await mintToken();
    await botImport(token, '2026-07-17', ['barbell squat 120x5 @2']);

    await configureSync(page, token);
    await page.getByTestId('open-history').click();
    await page.getByTestId('history-item').first().click();

    await expect(page.getByTestId('history-detail')).toBeVisible();
    await expect(page.getByTestId('detail-date')).toHaveText('2026-07-17');
    await expect(page.getByTestId('detail-duration')).toHaveCount(0);
  });
});

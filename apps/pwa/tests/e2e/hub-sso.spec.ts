import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The hub's identity cookie only reaches ferrum because the two are served from
// hosts of one registrable domain — so this drill runs the PWA off the API's own
// origin, the way production does, rather than off the preview server.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const apiDir = path.join(repoRoot, 'services/api');
const staticDir = path.join(repoRoot, 'apps/pwa/dist');
const tsxCli = path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs');

const PORT = 3412;
const appUrl = `http://127.0.0.1:${PORT}`;
const SIGNING_KEY = 'an-e2e-signing-key-of-adequate-length'; // gitleaks:allow

function ticketFor(subject: string, name: string, lifetimeSeconds = 600): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'life-as-code',
    aud: 'life-as-code-apps',
    sub: subject,
    name,
    iat: issuedAt,
    exp: issuedAt + lifetimeSeconds,
  });
  const signature = createHmac('sha256', SIGNING_KEY)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

let serverProcess: ChildProcess | null = null;
let dataDir = '';

async function waitForHealth(timeoutMillis = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMillis;
  for (;;) {
    try {
      const response = await fetch(`${appUrl}/health`);
      if (response.ok) return;
    } catch {
      // still booting
    }
    if (Date.now() > deadline) throw new Error('hub-sso dev server did not become healthy');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'ferrum-sso-e2e-'));
  serverProcess = spawn(process.execPath, [tsxCli, 'src/dev-server.ts'], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      PGLITE_DIR: dataDir,
      STATIC_DIR: staticDir,
      SSO_SIGNING_KEY: SIGNING_KEY,
    },
    stdio: 'ignore',
  });
  await waitForHealth();
});

test.afterAll(async () => {
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
});

test.describe('signing in from the life-as-code hub', () => {
  test('a device that arrives with the hub cookie is synced without touching settings', async ({
    context,
    page,
  }) => {
    await context.addCookies([{ name: 'lac-sso', value: ticketFor('7', 'nikolay'), url: appUrl }]);

    await page.goto(appUrl);
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('sync-server-url')).toHaveValue(appUrl);
    await expect(page.getByTestId('sync-last-success')).not.toHaveText('never', {
      timeout: 15_000,
    });
  });

  test('a device with no hub cookie is left offline, and can sign in later', async ({
    context,
    page,
  }) => {
    await page.goto(appUrl);
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('sync-server-url')).toHaveValue('');

    await page.getByTestId('hub-sign-in').click();
    await expect(page.getByTestId('hub-sign-in-message')).toContainText('Not signed in');
    await expect(page.getByTestId('sync-server-url')).toHaveValue('');

    await context.addCookies([{ name: 'lac-sso', value: ticketFor('9', 'nikolay'), url: appUrl }]);
    await page.getByTestId('hub-sign-in').click();
    await expect(page.getByTestId('hub-sign-in-message')).toContainText('Signed in');
    await expect(page.getByTestId('sync-server-url')).toHaveValue(appUrl);
    await expect(page.getByTestId('sync-last-success')).not.toHaveText('never', {
      timeout: 15_000,
    });
  });

  test('a forged cookie buys nothing', async ({ context, page }) => {
    const ticket = ticketFor('1', 'attacker');
    const forged = `${ticket.slice(0, -4)}AAAA`;
    await context.addCookies([{ name: 'lac-sso', value: forged, url: appUrl }]);

    await page.goto(appUrl);
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('sync-server-url')).toHaveValue('');
    await page.getByTestId('hub-sign-in').click();
    await expect(page.getByTestId('hub-sign-in-message')).toContainText('Not signed in');
  });
});

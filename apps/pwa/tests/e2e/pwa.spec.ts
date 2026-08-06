import { expect, test } from '@playwright/test';

const MANIFEST_ICONS = [
  '/icons/ferrum-icon-192.png',
  '/icons/ferrum-icon-512.png',
  '/icons/ferrum-icon-512-maskable.png',
];

test.describe('pwa plumbing', () => {
  test('every icon the manifest references is actually served', async ({ page }) => {
    const manifestResponse = await page.request.get('/manifest.webmanifest');
    expect(manifestResponse.status()).toBe(200);
    const manifest = (await manifestResponse.json()) as {
      icons: { src: string }[];
    };
    expect(manifest.icons.map(icon => icon.src).sort()).toStrictEqual([...MANIFEST_ICONS].sort());

    for (const src of MANIFEST_ICONS) {
      const response = await page.request.get(src);
      expect(response.status(), src).toBe(200);
      expect(response.headers()['content-type'], src).toContain('image/png');
      const body = await response.body();
      expect(body.subarray(0, 4).toString('hex'), src).toBe('89504e47');
    }
  });

  // A missing assetlinks.json does not 404: the single-page fallback answers it with
  // index.html and a 200, and the Android app degrades to a Custom Tab with a URL bar
  // across the top of every screen. Asserting the content type is what catches that.
  test('the Android app link verification file is served as JSON', async ({ page }) => {
    const response = await page.request.get('/.well-known/assetlinks.json');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const statements = (await response.json()) as {
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }[];
    const android = statements.find(statement => statement.target.namespace === 'android_app');
    expect(android?.relation).toContain('delegate_permission/common.handle_all_urls');
    expect(android?.target.package_name).toBe('com.ferrum.app');
    expect(android?.target.sha256_cert_fingerprints[0]).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  });
});

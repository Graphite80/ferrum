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
});

import { expect, test, type Page } from '@playwright/test';

interface StoredMeasurements {
  enteredLoad: number | null;
  enteredUnit: string;
  canonicalExternalLoadKg: number | null;
}

async function loggedMeasurements(page: Page): Promise<StoredMeasurements[]> {
  return page.evaluate<StoredMeasurements[]>(async () => {
    const open = indexedDB.open('ferrum');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(open.error ?? new Error('failed to open ferrum'));
      };
    });
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction('events', 'readonly').objectStore('events').getAll();
      request.onsuccess = () => {
        resolve(request.result as unknown[]);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('failed to read events'));
      };
    });
    database.close();
    return rows
      .map(
        row =>
          row as {
            envelope: {
              eventType: string;
              payload: { measurements?: StoredMeasurements };
            };
          }
      )
      .filter(row => row.envelope.eventType === 'SetLogged')
      .map(row => row.envelope.payload.measurements as StoredMeasurements);
  });
}

test.describe('display units', () => {
  test('the lb toggle converts every display and a set logged in lb stores canonical kilograms', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('open-settings').click();
    await page.getByTestId('unit-lb').click();
    await page.getByTestId('settings-back').click();

    // Seed target of 80 kg reads as pounds everywhere once the toggle flips.
    await expect(page.getByTestId('routine-card').first()).toContainText('176.4 lb');

    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('set-0-load').first()).toContainText('lb');
    await expect(page.getByTestId('target-label').first()).toContainText('176.4 lb');

    await page.getByTestId('set-0-load').first().click();
    await page.getByTestId('set-0-load-stepper-input').first().fill('100');
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);
    await expect(page.getByTestId('logged-set-values').first()).toContainText('100 lb');

    // The event stores what the user typed AND the canonical kilograms; history
    // never becomes unit-dependent.
    const measurements = await loggedMeasurements(page);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]).toStrictEqual({
      enteredLoad: 100,
      enteredUnit: 'lb',
      canonicalExternalLoadKg: 45.359,
      reps: 8,
      durationSeconds: null,
      distanceMeters: null,
      rirEntered: 3,
      rpeEntered: null,
      actualRestSeconds: null,
    });

    // The unit choice survives a reload.
    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('logged-set-values').first()).toContainText('100 lb');

    // Switching back to kg re-reads the same canonical value, no drift.
    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('workout-summary')).toBeVisible();
    await page.getByTestId('summary-home').click();
    await page.getByTestId('open-settings').click();
    await page.getByTestId('unit-kg').click();
    await page.getByTestId('settings-back').click();
    await page.getByTestId('open-history').click();
    await page.getByTestId('history-item').click();
    await expect(page.getByTestId('detail-set-values').first()).toContainText('45.4 kg');
  });
});

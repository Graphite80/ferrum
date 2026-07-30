import { expect, test, type Page } from '@playwright/test';

// A warmup is not a lighter working set: it is excluded from volume, from the
// PR baseline and from what the next session prefills. So the drill checks the
// consequence, not just the badge.

async function startWorkout(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
}

async function finishAndOpenSummary(page: Page): Promise<void> {
  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('workout-summary')).toBeVisible();
}

test.describe('warmup and working sets', () => {
  test('a set logged as a warmup is marked, survives a reload, and stays out of the volume', async ({
    page,
  }) => {
    await startWorkout(page);

    await page.getByTestId('set-0-warmup').first().click();
    await expect(page.getByTestId('set-0-warmup').first()).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('warmup-marker').first()).toBeVisible();

    // The toggle is per set, not a mode: the next set starts working again.
    await expect(page.getByTestId('set-0-warmup').first()).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(2);
    await expect(page.getByTestId('warmup-marker')).toHaveCount(1);

    await page.reload();
    await expect(page.getByTestId('warmup-marker')).toHaveCount(1);

    await finishAndOpenSummary(page);
    // Two sets were logged; only the working one counts.
    await expect(page.getByTestId('summary-total-sets')).toHaveText('1');
  });

  test('a working set can be reclassified as a warmup afterwards, and back again', async ({
    page,
  }) => {
    await startWorkout(page);
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('warmup-marker')).toHaveCount(0);

    await page.getByTestId('logged-set-summary').first().click();
    await page.getByTestId('toggle-warmup').click();
    await expect(page.getByTestId('warmup-marker')).toHaveCount(1);

    await page.reload();
    await expect(page.getByTestId('warmup-marker')).toHaveCount(1);

    await page.getByTestId('logged-set-summary').first().click();
    await page.getByTestId('toggle-warmup').click();
    await expect(page.getByTestId('warmup-marker')).toHaveCount(0);
  });

  // Imported history lands in finished sessions, so this is the screen where a
  // heuristic's guess actually has to be correctable.
  test('a finished workout can be reclassified from history, and it is recorded as an amendment', async ({
    page,
  }) => {
    await startWorkout(page);
    await page.getByTestId('set-0-done').first().click();
    await finishAndOpenSummary(page);
    await page.getByTestId('summary-home').click();

    await page.getByTestId('open-history').click();
    await page.getByTestId('history-item').first().click();
    await expect(page.getByTestId('history-detail')).toBeVisible();
    await expect(page.getByTestId('detail-warmup-marker')).toHaveCount(0);

    await page.getByTestId('detail-warmup-toggle').first().click();
    await expect(page.getByTestId('detail-warmup-marker')).toHaveCount(1);
    await expect(page.getByTestId('detail-amendments')).toBeVisible();

    // A reload returns to Home rather than restoring the detail screen, so the
    // persistence check walks back in the way a user would.
    await page.reload();
    await page.getByTestId('open-history').click();
    await page.getByTestId('history-item').first().click();
    await expect(page.getByTestId('detail-warmup-marker')).toHaveCount(1);
  });
});

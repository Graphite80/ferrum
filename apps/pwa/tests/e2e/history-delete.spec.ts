import { expect, test, type Page } from '@playwright/test';

async function finishWorkout(page: Page, sets: number): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
  for (let i = 0; i < sets; i += 1) {
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText(`${String(i + 1)} sets`);
  }
  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('workout-summary')).toBeVisible();
  await page.getByTestId('summary-home').click();
}

async function deleteFromDetail(page: Page): Promise<void> {
  await page.getByTestId('open-history').click();
  await page.getByTestId('history-item').click();
  await expect(page.getByTestId('history-detail')).toBeVisible();
  await page.getByTestId('delete-workout').click();
  await page.getByTestId('confirm-delete-workout').click();
  // The toggle is the positive signal that the tombstone committed. An empty
  // list is not: it also renders while the replay is still loading, so
  // asserting absence would let the next step race the append.
  await expect(page.getByTestId('show-deleted-toggle')).toBeVisible();
}

test.describe('workout deletion', () => {
  test('delete from detail tombstones the workout and restore brings it back', async ({ page }) => {
    await finishWorkout(page, 2);

    await page.getByTestId('open-history').click();
    await page.getByTestId('history-item').click();
    await expect(page.getByTestId('history-detail')).toBeVisible();

    // The confirm step is cancellable and cancelling changes nothing.
    await page.getByTestId('delete-workout').click();
    await page.getByTestId('cancel-delete-workout').click();
    await expect(page.getByTestId('confirm-delete-workout')).toHaveCount(0);
    await expect(page.getByTestId('delete-workout')).toBeVisible();

    // Confirming deletes and navigates back to the History list.
    await page.getByTestId('delete-workout').click();
    await page.getByTestId('confirm-delete-workout').click();
    await expect(page.getByTestId('history-item')).toHaveCount(0);

    // Hidden by default, revealed struck-through by the quiet toggle.
    await expect(page.getByTestId('show-deleted-toggle')).toHaveText('Show deleted (1)');
    await expect(page.getByTestId('deleted-history-item')).toHaveCount(0);
    await page.getByTestId('show-deleted-toggle').click();
    await expect(page.getByTestId('deleted-history-item')).toHaveCount(1);
    await expect(page.getByTestId('deleted-history-item').locator('.line-through')).toBeVisible();

    // Restore is a tombstone flip, not a re-import: the workout returns intact.
    await page.getByTestId('restore-session').click();
    await expect(page.getByTestId('history-item')).toHaveCount(1);
    await expect(page.getByTestId('deleted-history-item')).toHaveCount(0);
    await expect(page.getByTestId('show-deleted-toggle')).toHaveCount(0);
    await page.getByTestId('history-item').click();
    await expect(page.getByTestId('detail-set-values')).toHaveCount(2);
  });

  test('a deletion survives a reload: the tombstone replays, the workout stays hidden', async ({
    page,
  }) => {
    await finishWorkout(page, 1);
    await deleteFromDetail(page);
    await expect(page.getByTestId('history-item')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('booting')).toHaveCount(0);
    await expect(page.getByTestId('start-routine')).toBeVisible();
    await page.getByTestId('open-history').click();
    await expect(page.getByTestId('history-item')).toHaveCount(0);
    await expect(page.getByTestId('show-deleted-toggle')).toHaveText('Show deleted (1)');
  });

  test('a deleted-but-unfinished session never hijacks boot auto-resume', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 sets');

    // Leave the workout running and delete it from history detail.
    await page.goBack();
    await expect(page.getByTestId('start-routine')).toBeVisible({ timeout: 15_000 });
    await deleteFromDetail(page);
    await expect(page.getByTestId('history-item')).toHaveCount(0);

    // Boot must land on Home: the active session is tombstoned, not resumable.
    await page.reload();
    await expect(page.getByTestId('booting')).toHaveCount(0);
    await expect(page.getByTestId('start-routine')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('session-title')).toHaveCount(0);
  });
});

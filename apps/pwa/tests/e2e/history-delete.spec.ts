import { expect, test, type Page } from '@playwright/test';

async function finishWorkout(page: Page, sets: number): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
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

    // A reload lands back on History, because the screen owns a URL now — so
    // this covers the tombstone replaying AND the address surviving.
    await page.reload();
    await expect(page.getByTestId('booting')).toHaveCount(0);
    await expect(page.getByTestId('history')).toBeVisible();
    await expect(page.getByTestId('history-item')).toHaveCount(0);
    await expect(page.getByTestId('show-deleted-toggle')).toHaveText('Show deleted (1)');
  });

  test('a deleted-but-unfinished session never hijacks boot auto-resume', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 set');

    // Leave the workout running and delete it from history detail.
    await page.goBack();
    await expect(page.getByTestId('start-routine')).toBeVisible({ timeout: 15_000 });
    await deleteFromDetail(page);
    await expect(page.getByTestId('history-item')).toHaveCount(0);

    // Boot from the root is what the auto-resume path answers, so this asks it
    // directly instead of depending on where a reload happens to land.
    await page.goto('/');
    await expect(page.getByTestId('booting')).toHaveCount(0);
    await expect(page.getByTestId('start-routine')).toBeVisible({ timeout: 15_000 });
    // Neither resumed into it, nor offered as resumable: it is tombstoned.
    await expect(page.getByTestId('session-title')).toHaveCount(0);
    await expect(page.getByTestId('resume-workout')).toHaveCount(0);
  });
});

test.describe('discarding a workout in progress', () => {
  test('the confirm step names the cost, cancelling changes nothing, and the sets come back', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 set');

    // Cancelling leaves the workout exactly as it was, still accepting sets.
    await page.getByTestId('discard-session').click();
    await expect(page.getByTestId('discard-warning')).toContainText('1 logged set');
    await page.getByTestId('cancel-discard-session').click();
    await expect(page.getByTestId('confirm-discard-session')).toHaveCount(0);
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('2 sets');

    await page.getByTestId('discard-session').click();
    await expect(page.getByTestId('discard-warning')).toContainText('2 logged sets');
    await page.getByTestId('confirm-discard-session').click();

    // No summary for a discarded workout, and back must not walk into it again.
    await expect(page.getByTestId('start-routine')).toBeVisible();
    await expect(page.getByTestId('workout-summary')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByTestId('session-title')).toHaveCount(0);

    // A discarded session is not resumable, and it is not in the live history either.
    await page.reload();
    await expect(page.getByTestId('booting')).toHaveCount(0);
    await expect(page.getByTestId('start-routine')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('session-title')).toHaveCount(0);

    // Discard is a tombstone: restore hands both sets back.
    await page.getByTestId('open-history').click();
    await expect(page.getByTestId('history-item')).toHaveCount(0);
    await page.getByTestId('show-deleted-toggle').click();
    await page.getByTestId('restore-session').click();
    await page.getByTestId('history-item').click();
    await expect(page.getByTestId('detail-set-values')).toHaveCount(2);
  });

  test('a workout discarded in another tab stops accepting sets in this one', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 set');

    const other = await page.context().newPage();
    await other.goto('/');
    // The other tab resumes the same active session and discards it there.
    await expect(other.getByTestId('session-title')).toBeVisible({ timeout: 15_000 });
    await other.getByTestId('discard-session').click();
    await other.getByTestId('confirm-discard-session').click();
    await expect(other.getByTestId('start-routine')).toBeVisible();

    await expect(page.getByTestId('workout-discarded')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('set-0-done')).toHaveCount(0);
    await page.getByTestId('leave-discarded-workout').click();
    await expect(page.getByTestId('start-routine')).toBeVisible();
    await other.close();
  });
});

test.describe('erasing a deleted workout for good', () => {
  test('the confirm step is cancellable, and erasing survives a reload', async ({ page }) => {
    await finishWorkout(page, 2);
    await deleteFromDetail(page);
    await page.getByTestId('show-deleted-toggle').click();
    await expect(page.getByTestId('deleted-history-item')).toHaveCount(1);

    // Restore stays one tap; erasing asks first, and cancelling changes nothing.
    await page.getByTestId('purge-session').click();
    await expect(page.getByTestId('restore-session')).toHaveCount(0);
    await page.getByTestId('cancel-purge-session').click();
    await expect(page.getByTestId('restore-session')).toBeVisible();
    await expect(page.getByTestId('deleted-history-item')).toHaveCount(1);

    await page.getByTestId('purge-session').click();
    await page.getByTestId('confirm-purge-session').click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
    await expect(page.getByTestId('show-deleted-toggle')).toHaveCount(0);

    // Nothing replays it back: the events are gone, not tombstoned.
    await page.reload();
    await expect(page.getByTestId('booting')).toHaveCount(0);
    await expect(page.getByTestId('history-empty')).toBeVisible();
    await expect(page.getByTestId('pending-events')).toContainText('0 events not yet synced');
  });
});

test.describe('a deleted workout stops counting', () => {
  test('its sets no longer prefill the next session', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();

    // Log a deliberately wrong load, the reason someone deletes a workout.
    await page.getByTestId('set-0-load').first().click();
    await page.getByTestId('set-0-load-stepper-input').first().fill('200');
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 set');
    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('workout-summary')).toBeVisible();
    await page.getByTestId('summary-home').click();

    await deleteFromDetail(page);
    await page.getByTestId('back-home').click();

    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('previous-label').first()).toHaveText('no previous set');
    await expect(page.getByTestId('set-0-load').first()).toContainText('80');
  });
});

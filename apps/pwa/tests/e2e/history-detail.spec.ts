import { expect, test } from '@playwright/test';

test.describe('history detail', () => {
  test('a finished session opens read-only with amended and deleted sets visible', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();

    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);

    // Amend the logged set so the detail screen has a corrected value to show.
    await page.getByTestId('logged-set-summary').first().click();
    await page.getByTestId('amend-load-input').fill('82.5');
    await page.getByTestId('amend-reps-input').fill('9');
    await page.getByTestId('save-set-edit').click();
    await expect(page.getByTestId('logged-set-values').first()).toContainText('82.5 kg × 9');

    // Log a second set and tombstone it so the detail screen shows a deletion.
    await page.getByTestId('set-1-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(2);
    await page.getByTestId('logged-set-summary').nth(1).click();
    await page.getByTestId('delete-set').click();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);

    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('workout-summary')).toBeVisible();
    await page.getByTestId('summary-home').click();
    await page.getByTestId('open-history').click();
    await page.getByTestId('history-item').click();

    await expect(page.getByTestId('history-detail')).toBeVisible();
    await expect(page.getByTestId('detail-date')).not.toBeEmpty();
    // A duration is shown only when there was one, and this scripted workout
    // may well finish inside a second — so the element is legitimately absent
    // or present depending on the machine. Read it as a list: whatever is
    // there, a workout that took no time is never reported as taking 0 s.
    expect(await page.getByTestId('detail-duration').allTextContents()).not.toContain('0 s');

    const squat = page.getByTestId('detail-exercise').filter({ hasText: 'Squat' });
    await expect(squat.getByTestId('detail-set')).toHaveCount(1);
    await expect(squat.getByTestId('detail-set-values').first()).toContainText('82.5 kg × 9');
    await expect(squat.getByTestId('detail-set-deleted')).toHaveCount(1);

    // One amendment was recorded and the projection keeps it auditable.
    await expect(page.getByTestId('detail-amendments')).toContainText('1 amendment');

    await page.getByTestId('detail-back').click();
    await expect(page.getByTestId('history-list')).toBeVisible();
  });
});

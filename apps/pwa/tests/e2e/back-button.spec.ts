import { expect, test } from '@playwright/test';

test.describe('hardware back navigation', () => {
  test('back pops in-app screens and never kills an active workout', async ({ page }) => {
    // Produce one finished session so history has something to open.
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 sets');
    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('workout-summary')).toBeVisible();
    await page.getByTestId('summary-home').click();

    // Home → History → detail, then back twice: detail → History → Home.
    await page.getByTestId('open-history').click();
    await expect(page.getByTestId('history-list')).toBeVisible();
    await page.getByTestId('history-item').first().click();
    await expect(page.getByTestId('history-detail')).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('history-list')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('open-history')).toBeVisible();

    // Mid-workout back returns to Home without finishing or losing the session.
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 sets');

    await page.goBack();
    await expect(page.getByTestId('start-routine')).toBeVisible();

    // The session is still active: a reload resumes straight into it, set intact.
    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('set-count')).toContainText('1 sets');
  });
});

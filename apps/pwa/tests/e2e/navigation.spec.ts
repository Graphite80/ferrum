import { expect, test, type Page } from '@playwright/test';

// Every screen has to be leavable and addressable. An installed PWA has no
// browser chrome, so a screen whose only exit is the platform back gesture is a
// screen a user can be stuck on.

async function startWorkout(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
}

test.describe('getting out of every screen', () => {
  test('a running workout can be left and resumed without ending it', async ({ page }) => {
    await startWorkout(page);
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 set');

    // The only exits used to be finish and discard — both of which end the
    // workout. Leaving must not.
    await page.getByTestId('workout-home').click();
    await expect(page.getByTestId('start-routine')).toBeVisible();

    const resume = page.getByTestId('resume-workout');
    await expect(resume).toBeVisible();
    await expect(resume).toContainText('1 set');

    await resume.click();
    await expect(page.getByTestId('session-title')).toBeVisible();
    // The set is still there: leaving was navigation, not an ending.
    await expect(page.getByTestId('set-count')).toContainText('1 set');
  });

  test('home offers no resume when nothing is running', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('start-routine')).toBeVisible();
    await expect(page.getByTestId('resume-workout')).toHaveCount(0);
  });

  for (const [name, open, shell, back] of [
    ['settings', 'open-settings', 'settings', 'settings-back'],
    ['history', 'open-history', 'history', 'back-home'],
  ] as const) {
    test(`${name} can be opened and left again`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId(open).click();
      await expect(page.getByTestId(shell)).toBeVisible();
      await page.getByTestId(back).click();
      await expect(page.getByTestId('start-routine')).toBeVisible();
    });
  }

  test('each screen owns an address that survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('open-settings').click();
    expect(new URL(page.url()).pathname).toBe('/settings');
    await page.reload();
    await expect(page.getByTestId('settings')).toBeVisible();

    await page.goto('/history');
    await expect(page.getByTestId('history')).toBeVisible();
  });

  test('an unknown path lands on home instead of a blank screen', async ({ page }) => {
    await page.goto('/nothing-here');
    await expect(page.getByTestId('start-routine')).toBeVisible();
  });
});

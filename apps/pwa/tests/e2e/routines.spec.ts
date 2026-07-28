import { expect, test, type Page } from '@playwright/test';

async function addExerciseInBuilder(page: Page, query: string, name: string): Promise<void> {
  await page.getByTestId('builder-add-exercise').click();
  await page.getByTestId('exercise-search-input').fill(query);
  await page.getByTestId('exercise-search-result').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('exercise-search')).toBeHidden();
}

test.describe('routine management', () => {
  test('a routine built from scratch drives a workout to the finish summary', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('routine-card')).toHaveCount(1);

    await page.getByTestId('new-routine').click();
    await page.getByTestId('routine-name-input').fill('Push day');
    await addExerciseInBuilder(page, 'bench press barbell', 'Bench Press (Barbell)');
    await expect(page.getByTestId('builder-slot')).toHaveCount(1);

    await page.getByTestId('slot-0-sets-down').click();
    await expect(page.getByTestId('slot-0-sets-input')).toHaveValue('2');
    await page.getByTestId('slot-0-set-target').click();
    await page.getByTestId('slot-0-target-input').fill('60');
    await page.getByTestId('builder-save').click();

    await expect(page.getByTestId('routine-card')).toHaveCount(2);
    const pushDay = page.getByTestId('routine-card').filter({ hasText: 'Push day' });
    await expect(pushDay.getByTestId('routine-name')).toHaveText('Push day');

    await pushDay.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toHaveText('Push day');
    await expect(page.getByTestId('exercise-section')).toHaveCount(1);
    await expect(page.getByTestId('target-label')).toContainText('60 kg × 8–12');

    // The routine's target load prefills the entry row.
    await expect(page.getByTestId('set-0-load')).toContainText('60 kg');
    await page.getByTestId('set-0-done').click();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);

    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('workout-summary')).toBeVisible();
    await expect(page.getByTestId('summary-total-sets')).toHaveText('1');
    await expect(page.getByTestId('summary-volume')).toContainText('480 kg');
    const line = page.getByTestId('summary-exercise').filter({ hasText: 'Bench Press' });
    await expect(line.getByTestId('summary-prescribed')).toContainText('2 × 8–12 @ 60 kg');
    await expect(line.getByTestId('summary-actual')).toContainText('1 set · top 60 kg × 8');
    await expect(line.getByTestId('summary-pr-badge')).toBeVisible();

    await page.getByTestId('summary-home').click();
    await expect(page.getByTestId('routine-card')).toHaveCount(2);
  });

  test('routine edits, including reorder, persist across a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('edit-routine').click();
    await expect(page.getByTestId('builder-slot')).toHaveCount(4);

    await page.getByTestId('routine-name-input').fill('Full body A+');
    await page.getByTestId('slot-0-sets-up').click();
    await expect(page.getByTestId('slot-0-sets-input')).toHaveValue('4');
    await page.getByTestId('slot-0-down').click();
    await expect(page.getByTestId('builder-slot').first()).toContainText('Lat Pulldown');
    await page.getByTestId('builder-save').click();
    await expect(page.getByTestId('routine-name')).toHaveText('Full body A+');

    await page.reload();
    await expect(page.getByTestId('routine-name')).toHaveText('Full body A+');
    await page.getByTestId('edit-routine').click();
    await expect(page.getByTestId('routine-name-input')).toHaveValue('Full body A+');
    await expect(page.getByTestId('builder-slot').first()).toContainText('Lat Pulldown');
    await expect(page.getByTestId('builder-slot').nth(1)).toContainText('Squat');
    await expect(page.getByTestId('slot-1-sets-input')).toHaveValue('4');
  });

  test('deleting a routine requires a confirm and empties the home list', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('edit-routine').click();
    await page.getByTestId('builder-delete').click();
    await page.getByTestId('builder-delete-confirm').click();

    await expect(page.getByTestId('routine-card')).toHaveCount(0);
    await expect(page.getByTestId('new-routine')).toBeVisible();

    // The seed is inserted only into an empty first boot, never resurrected.
    await page.reload();
    await expect(page.getByTestId('new-routine')).toBeVisible();
    await expect(page.getByTestId('routine-card')).toHaveCount(0);
  });
});

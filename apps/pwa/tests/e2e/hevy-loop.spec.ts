import { expect, test, type Page } from '@playwright/test';
import { pickExercise } from './pick-exercise.ts';

async function startRoutine(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
}

async function addExerciseViaSearch(
  page: Page,
  query: string,
  groupName: string,
  variantLabel?: string
): Promise<void> {
  await page.getByTestId('add-exercise').click();
  await pickExercise(page, query, groupName, variantLabel);
}

test.describe('the mid-workout logging loop', () => {
  test('every logged set shows as a row under its exercise', async ({ page }) => {
    await startRoutine(page);

    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);
    await expect(page.getByTestId('logged-set-values').first()).toContainText('80 kg × 8');

    await page.getByTestId('set-1-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(2);
    await expect(page.getByTestId('exercise-set-count').first()).toContainText('2/3');
  });

  test('editing a logged set persists the amended values across a reload', async ({ page }) => {
    await startRoutine(page);
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);

    await page.getByTestId('logged-set-summary').first().click();
    await page.getByTestId('amend-load-input').fill('82.5');
    await page.getByTestId('amend-reps-input').fill('9');
    await page.getByTestId('save-set-edit').click();
    await expect(page.getByTestId('logged-set-values').first()).toContainText('82.5 kg × 9');

    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('logged-set-values').first()).toContainText('82.5 kg × 9');
  });

  test('deleting a specific set tombstones it and restore survives a reload', async ({ page }) => {
    await startRoutine(page);
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);

    await page.getByTestId('set-1-load').first().click();
    await page.getByTestId('set-1-load-stepper-input').first().fill('90');
    await page.getByTestId('set-1-done').first().click();
    await expect(page.getByTestId('logged-set')).toHaveCount(2);

    // Delete the first set, not the last: this is targeted deletion, not undo.
    await page.getByTestId('logged-set-summary').first().click();
    await page.getByTestId('delete-set').click();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);
    await expect(page.getByTestId('logged-set-values').first()).toContainText('90 kg');

    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('logged-set')).toHaveCount(1);

    await page.getByTestId('restore-deleted-set').click();
    await expect(page.getByTestId('logged-set')).toHaveCount(2);
    await expect(page.getByTestId('logged-set-values').first()).toContainText('80 kg');
  });

  test('the prescribed set count does not block logging beyond it', async ({ page }) => {
    await startRoutine(page);

    await page.getByTestId('set-0-done').first().click();
    await page.getByTestId('set-1-done').first().click();
    await page.getByTestId('set-2-done').first().click();
    await expect(page.getByTestId('add-set').first()).toBeVisible();

    await page.getByTestId('add-set').first().click();
    await page.getByTestId('set-3-done').first().click();
    await expect(page.getByTestId('exercise-set-count').first()).toContainText('4/3');
    await expect(page.getByTestId('set-count')).toContainText('4 sets');
  });

  test('an exercise added via search mid-workout takes sets and survives a reload', async ({
    page,
  }) => {
    await startRoutine(page);
    await expect(page.getByTestId('exercise-section')).toHaveCount(4);

    await addExerciseViaSearch(page, 'bench press', 'Bench Press', 'Barbell');
    await expect(page.getByTestId('exercise-section')).toHaveCount(5);

    const added = page.getByTestId('exercise-section').last();
    await expect(added.getByTestId('exercise-title')).toContainText('Bench Press (Barbell)');
    await added.getByTestId('set-0-done').click();
    await expect(added.getByTestId('logged-set')).toHaveCount(1);

    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('exercise-section')).toHaveCount(5);
    await expect(page.getByTestId('exercise-section').last().getByTestId('logged-set')).toHaveCount(
      1
    );
  });

  test('an exercise with no live sets can be removed, one with sets cannot', async ({ page }) => {
    await startRoutine(page);
    await addExerciseViaSearch(page, 'goblet squat', 'Goblet Squat (Dumbbell)');
    await expect(page.getByTestId('exercise-section')).toHaveCount(5);

    const added = page.getByTestId('exercise-section').last();
    await added.getByTestId('exercise-menu').click();
    await added.getByTestId('remove-exercise').click();
    await expect(page.getByTestId('exercise-section')).toHaveCount(4);

    await page.getByTestId('set-0-done').first().click();
    await expect(
      page.getByTestId('exercise-section').first().getByTestId('exercise-menu')
    ).toBeHidden();
  });

  test('an empty workout is built from search and finishes end to end', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-empty-workout').click();
    await expect(page.getByTestId('session-title')).toContainText('Workout');
    await expect(page.getByTestId('exercise-section')).toHaveCount(0);

    await addExerciseViaSearch(page, 'goblet squat', 'Goblet Squat (Dumbbell)');
    await expect(page.getByTestId('exercise-section')).toHaveCount(1);

    await page.getByTestId('set-0-done').click();
    await page.getByTestId('set-1-done').click();
    await expect(page.getByTestId('set-count')).toContainText('2 sets');

    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('set-count')).toContainText('2 sets');

    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('workout-summary')).toBeVisible();
    await page.getByTestId('summary-home').click();
    await page.getByTestId('open-history').click();
    await expect(page.getByTestId('history-item')).toHaveCount(1);
  });

  test('undo still works after a reload', async ({ page }) => {
    await startRoutine(page);
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 set');

    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();

    // Regression: the undo target used to live in component state and vanished
    // on reload. It must be derived from the projection.
    await page.getByTestId('undo-last-set').click();
    await expect(page.getByTestId('set-count')).toContainText('0 sets');
    await expect(page.getByTestId('restore-deleted-set')).toBeVisible();
  });

  test('a new session prefills the first set from the last finished session', async ({ page }) => {
    await startRoutine(page);
    await page.getByTestId('set-0-load').first().click();
    await page.getByTestId('set-0-load-stepper-input').first().fill('87.5');
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 set');
    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('workout-summary')).toBeVisible();

    await page.getByTestId('summary-home').click();
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();

    await expect(page.getByTestId('previous-label').first()).toContainText(
      'Last time: 87.5 kg × 8'
    );
    await expect(page.getByTestId('set-0-load').first()).toContainText('87.5 kg');
  });
});

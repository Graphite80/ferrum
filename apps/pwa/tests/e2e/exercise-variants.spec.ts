import { expect, test } from '@playwright/test';
import { groupTile, pickExercise } from './pick-exercise.ts';

// One tile per family is a change to what the picker shows, never to what the log
// records. These drills hold both halves: the family collapses six rows into one,
// and the variant chosen inside it still keeps its own name and its own history.

test.describe('choosing a variant', () => {
  test('a family is one tile whose variants are chosen inside it', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await page.getByTestId('add-exercise').click();
    await page.getByTestId('exercise-search-input').fill('bench press');

    const tiles = groupTile(page, 'Bench Press');
    await expect(tiles).toHaveCount(1);
    await expect(page.getByTestId('exercise-variant-list')).toHaveCount(0);

    await tiles.first().click();
    await expect(page.getByTestId('exercise-variant-option')).toHaveCount(6);

    await page.getByTestId('exercise-variant-option').filter({ hasText: 'Dumbbell' }).click();
    await expect(page.getByTestId('exercise-search')).toBeHidden();
    await expect(page.getByTestId('exercise-section').last()).toContainText(
      'Bench Press (Dumbbell)'
    );
  });

  test('the variant used last is the one offered first next time', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await page.getByTestId('add-exercise').click();
    await pickExercise(page, 'bench press', 'Bench Press', 'Dumbbell');

    await page.getByTestId('add-exercise').click();
    await page.getByTestId('exercise-search-input').fill('bench press');
    await groupTile(page, 'Bench Press').click();

    const marked = page
      .getByTestId('exercise-variant-option')
      .filter({ has: page.getByTestId('exercise-variant-last-used') });
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText('Dumbbell');
  });

  // The reason the definitions were never merged: the two variants mean different
  // things by the number entered, so their previous-set lines must not cross.
  test('two variants of one family keep separate histories', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-empty-workout').click();

    await page.getByTestId('add-exercise').click();
    await pickExercise(page, 'bench press', 'Bench Press', 'Barbell');
    const barbell = page.getByTestId('exercise-section').last();
    await barbell.getByTestId('set-0-load').click();
    await barbell.getByTestId('set-0-load-stepper-input').fill('75');
    await barbell.getByTestId('set-0-done').click();

    await page.getByTestId('add-exercise').click();
    await pickExercise(page, 'bench press', 'Bench Press', 'Dumbbell');
    const dumbbell = page.getByTestId('exercise-section').last();
    await expect(dumbbell.getByTestId('exercise-title')).toContainText('Bench Press (Dumbbell)');
    await expect(dumbbell.getByTestId('previous-label').first()).toContainText('no previous set');
  });

  test('the low cable crossover the library used to be missing can be logged', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-empty-workout').click();
    await page.getByTestId('add-exercise').click();
    await pickExercise(page, 'crossover', 'Chest Fly', 'Crossover (Low to High)');

    await expect(page.getByTestId('exercise-section').last()).toContainText(
      'Cable Crossover (Low to High)'
    );
  });
});

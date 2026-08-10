import { expect, test } from '@playwright/test';

test.describe('technique demo', () => {
  test('every exercise in a session carries a figure that opens a demo', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await expect(page.getByTestId('session-title')).toBeVisible();

    const sections = page.getByTestId('exercise-section');
    const count = await sections.count();
    expect(count).toBeGreaterThan(0);
    await expect(page.getByTestId('exercise-figure')).toHaveCount(count);

    await page.getByTestId('open-exercise-demo').first().click();
    const demo = page.getByTestId('exercise-demo');
    await expect(demo).toBeVisible();
    await expect(demo.getByTestId('exercise-figure')).toBeVisible();
    await expect(demo.getByTestId('muscle-map-front')).toBeVisible();
    await expect(demo.getByTestId('muscle-map-back')).toBeVisible();
    await expect(demo.getByTestId('exercise-cue')).not.toBeEmpty();

    // Scrubbing has to move the drawing, otherwise the control is decoration.
    const figure = demo.getByTestId('exercise-figure');
    await demo.getByTestId('toggle-demo-playback').click();
    const contracted = await figure.innerHTML();
    await demo.getByTestId('demo-scrub').fill('0');
    await expect
      .poll(async () => (await figure.innerHTML()) === contracted, { timeout: 3000 })
      .toBe(false);

    await demo.getByTestId('close-exercise-demo').click();
    await expect(demo).toBeHidden();
  });

  test('the exercise picker shows a figure for every result', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('start-routine').click();
    await page.getByTestId('add-exercise').click();
    await page.getByTestId('exercise-search-input').fill('row');

    const picker = page.getByTestId('exercise-search');
    const results = picker.getByTestId('exercise-search-result');
    await expect(results.first()).toBeVisible();
    const count = await results.count();
    await expect(picker.getByTestId('exercise-figure')).toHaveCount(count);

    // A family tile carries its demo on the variant rows, so the one exercise that
    // stands alone is where the tile itself offers it.
    await page.getByTestId('exercise-search-input').fill('inverted row');

    // Scoped to the picker on purpose: the workout screen behind it carries the same
    // control for each of its own exercises.
    await picker.getByTestId('open-exercise-demo').first().click();
    await expect(page.getByTestId('exercise-demo')).toBeVisible();
    await page.getByTestId('close-exercise-demo').click();

    // Closing the demo must leave the picker where it was, not unwind the whole flow.
    await expect(page.getByTestId('exercise-search')).toBeVisible();
    await results.first().click();
    await expect(page.getByTestId('exercise-search')).toBeHidden();
  });
});

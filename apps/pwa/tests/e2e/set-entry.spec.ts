import { expect, test, type Page } from '@playwright/test';

// The editor a set is typed into. Every drill here is a thing a thumb does that
// fill() cannot express — deleting a digit, tapping an arrow, putting the panel
// away — which is exactly why none of it was covered while all three were broken.
// The first slot of the seeded routine is Squat (Machine) with a 5 kg increment.

async function startWorkout(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
}

async function openEditor(page: Page): Promise<void> {
  await page.getByTestId('set-0-load').first().click();
  await expect(page.getByTestId('set-0-editor').first()).toBeVisible();
}

test.describe('typing a set', () => {
  test('the last digit can be deleted, and what is typed after it is what gets logged', async ({
    page,
  }) => {
    await startWorkout(page);
    await openEditor(page);

    const load = page.getByTestId('set-0-load-stepper-input').first();
    await load.click();
    // End first: focusing selects the value, and the bug was about the caret
    // sitting after the last digit with nothing left to delete.
    await load.press('ArrowRight');
    await load.press('Backspace');
    await expect(load).toHaveValue('8');
    await load.press('Backspace');
    await expect(load).toHaveValue('');

    // "72." is a state a number input cannot hold; typing through it used to eat
    // the decimal point.
    await load.pressSequentially('72.');
    await expect(load).toHaveValue('72.');
    await load.pressSequentially('5');
    await expect(load).toHaveValue('72.5');

    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('logged-set-values').first()).toContainText('72.5');
  });

  test('an empty field falls back to the last value it held rather than to zero', async ({
    page,
  }) => {
    await startWorkout(page);
    await openEditor(page);

    const reps = page.getByTestId('set-0-reps-stepper-input').first();
    await reps.fill('9');
    await reps.press('ArrowRight');
    await reps.press('Backspace');
    await expect(reps).toHaveValue('');

    await page.getByTestId('set-0-load-stepper-input').first().click();
    await expect(reps).toHaveValue('9');

    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('logged-set-values').first()).toContainText('× 9');
  });
});

test.describe('the increment arrows', () => {
  test('land on multiples of the step whatever was typed', async ({ page }) => {
    await startWorkout(page);
    await openEditor(page);

    const load = page.getByTestId('set-0-load-stepper-input').first();
    await load.fill('47');
    await page.getByTestId('set-0-load-stepper-up').first().click();
    await expect(load).toHaveValue('50');
    await page.getByTestId('set-0-load-stepper-up').first().click();
    await expect(load).toHaveValue('55');

    await load.fill('47');
    await page.getByTestId('set-0-load-stepper-down').first().click();
    await expect(load).toHaveValue('45');
  });

  test('keep reps whole and RIR inside its scale', async ({ page }) => {
    await startWorkout(page);
    await openEditor(page);

    // Half a rep is not a rep count: it rounds the moment the field is left, and
    // the arrows then move whole reps from the rounded value.
    const reps = page.getByTestId('set-0-reps-stepper-input').first();
    await reps.fill('8.5');
    await page.getByTestId('set-0-reps-stepper-down').first().click();
    await expect(reps).toHaveValue('8');
    await page.getByTestId('set-0-reps-stepper-up').first().click();
    await expect(reps).toHaveValue('9');

    const rir = page.getByTestId('set-0-rir-stepper-input').first();
    await rir.fill('10');
    await page.getByTestId('set-0-rir-stepper-up').first().click();
    await expect(rir).toHaveValue('10');
    await rir.fill('0');
    await page.getByTestId('set-0-rir-stepper-down').first().click();
    await expect(rir).toHaveValue('0');
  });
});

test.describe('putting the editor away', () => {
  test('a second tap on the value closes it without logging anything', async ({ page }) => {
    await startWorkout(page);
    await openEditor(page);
    await expect(page.getByTestId('set-0-load').first()).toHaveAttribute('aria-expanded', 'true');

    await page.getByTestId('set-0-load').first().click();
    await expect(page.getByTestId('set-0-editor')).toHaveCount(0);
    await expect(page.getByTestId('logged-set')).toHaveCount(0);
  });

  test('Done closes it, and the next set still prefills from the one just logged', async ({
    page,
  }) => {
    await startWorkout(page);
    await openEditor(page);

    await page.getByTestId('set-0-load-stepper-input').first().fill('62.5');
    await page.getByTestId('set-0-done').first().click();

    await expect(page.getByTestId('set-0-editor')).toHaveCount(0);
    await expect(page.getByTestId('logged-set')).toHaveCount(1);
    await expect(page.getByTestId('set-1-load').first()).toContainText('62.5');
  });
});

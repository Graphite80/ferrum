import { expect, test, type Page } from '@playwright/test';

async function startWorkout(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
}

async function addMachine(page: Page, name: string, manufacturer: string): Promise<void> {
  await page.getByTestId('open-equipment-picker').first().click();
  await expect(page.getByTestId('equipment-picker')).toBeVisible();
  await page.getByTestId('equipment-name').fill(name);
  await page.getByTestId('equipment-manufacturer').fill(manufacturer);
  await page.getByTestId('save-equipment').click();
  await expect(page.getByTestId('equipment-picker')).toBeHidden();
}

test.describe('machine identity', () => {
  test('a machine can be named, is remembered, and survives a reload', async ({ page }) => {
    await startWorkout(page);

    const chip = page.getByTestId('open-equipment-picker').first();
    await expect(chip).toContainText('Which machine?');

    await addMachine(page, 'Squat rig', 'Hammer Strength');
    await expect(chip).toContainText('Hammer Strength Squat rig');

    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    await expect(page.getByTestId('open-equipment-picker').first()).toContainText(
      'Hammer Strength Squat rig'
    );
  });

  // The whole point of recording the machine: a stack marking from one machine must not
  // be presented as this machine's history.
  test('history from another machine is labelled instead of passed off as last time', async ({
    page,
  }) => {
    await startWorkout(page);
    await addMachine(page, 'Club press', 'Technogym');
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('rest-timer')).toBeVisible();
    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('workout-summary')).toBeVisible();
    await page.getByTestId('summary-home').click();

    // Second workout, same exercise, a different machine in a different gym.
    await startWorkout(page);
    await page.getByTestId('open-equipment-picker').first().click();
    await page.getByTestId('equipment-name').fill('Hotel press');
    await page.getByTestId('equipment-manufacturer').fill('Life Fitness');
    await page.getByTestId('save-equipment').click();
    await expect(page.getByTestId('equipment-picker')).toBeHidden();

    await expect(page.getByTestId('previous-label').first()).toContainText('Other machine');

    // Switching back to the first machine restores it as genuine history.
    await page.getByTestId('open-equipment-picker').first().click();
    await page.getByTestId('equipment-option').filter({ hasText: 'Technogym' }).click();
    await expect(page.getByTestId('equipment-picker')).toBeHidden();
    await expect(page.getByTestId('previous-label').first()).toContainText('Last time');
  });

  test('free weights are never asked about', async ({ page }) => {
    await startWorkout(page);
    await page.getByTestId('add-exercise').click();
    await page.getByTestId('exercise-search-input').fill('Bench Press (Barbell)');
    await page.getByTestId('exercise-search-result').first().click();

    const sections = page.getByTestId('exercise-section');
    const barbell = sections.filter({ hasText: 'Bench Press (Barbell)' });
    await expect(barbell).toBeVisible();
    await expect(barbell.getByTestId('open-equipment-picker')).toHaveCount(0);
  });
});

// The production case the first two tests missed: history logged BEFORE any machine was
// named carries the routine's signature, and naming a machine afterwards must surface
// that history as another machine's rather than hiding it.
test('history logged before any machine existed is still surfaced', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
  await page.getByTestId('set-0-done').first().click();
  await expect(page.getByTestId('rest-timer')).toBeVisible();
  await page.getByTestId('finish-session').click();
  await expect(page.getByTestId('workout-summary')).toBeVisible();
  await page.getByTestId('summary-home').click();

  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
  await expect(page.getByTestId('previous-label').first()).toContainText('Last time');

  await page.getByTestId('open-equipment-picker').first().click();
  await page.getByTestId('equipment-name').fill('Named later');
  await page.getByTestId('save-equipment').click();
  await expect(page.getByTestId('equipment-picker')).toBeHidden();

  await expect(page.getByTestId('previous-label').first()).toContainText('Other machine');
});

// A placeholder is not an accessible name once the field has content. The repo has
// already shipped this bug once on the RIR field (4ac27df); this is the guard.
test('every field in the machine form is labelled, not just placeholdered', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await page.getByTestId('open-equipment-picker').first().click();
  const picker = page.getByTestId('equipment-picker');
  await expect(picker).toBeVisible();

  // getByLabel resolves the accessible name the way the platform does, so this fails if
  // the label is decorative markup that no assistive technology would associate.
  for (const [testId, label] of [
    ['equipment-name', 'Name'],
    ['equipment-manufacturer', 'Manufacturer'],
    ['equipment-increment', 'Plate increment in kg'],
  ] as const) {
    const field = picker.getByLabel(label);
    await expect(field, `${testId} is not reachable by its label`).toHaveAttribute(
      'data-testid',
      testId
    );
    await field.fill('7');
    await expect(field).toHaveValue('7');
  }
});

test('forgetting a machine takes two taps and says what it costs', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await page.getByTestId('open-equipment-picker').first().click();
  await page.getByTestId('equipment-name').fill('Mis-tap rig');
  await page.getByTestId('save-equipment').click();
  await expect(page.getByTestId('equipment-picker')).toBeHidden();

  await page.getByTestId('open-equipment-picker').first().click();
  await expect(page.getByTestId('equipment-option')).toHaveCount(1);

  // One tap must not destroy anything: the machine id is inside every signature logged
  // against it, and a re-added machine gets a new id that never rejoins those sets.
  await page.getByTestId('forget-equipment').click();
  await expect(page.getByTestId('equipment-option')).toHaveCount(1);
  await expect(page.getByTestId('forget-warning')).toBeVisible();

  await page.getByTestId('confirm-forget-equipment').click();
  await expect(page.getByTestId('equipment-empty')).toBeVisible();
});

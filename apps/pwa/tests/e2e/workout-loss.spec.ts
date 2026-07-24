import { expect, test, type Page } from '@playwright/test';

async function startWorkout(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-routine').click();
  await expect(page.getByTestId('session-title')).toBeVisible();
}

async function logFirstSet(page: Page): Promise<void> {
  await page.getByTestId('set-0-done').first().click();
  await expect(page.getByTestId('rest-timer')).toBeVisible();
}

async function setCount(page: Page): Promise<number> {
  const text = (await page.getByTestId('set-count').textContent()) ?? '0 sets';
  return Number.parseInt(text, 10);
}

test.describe('workout survival', () => {
  test('the vertical path holds: start, log, timer, restart, finish, history', async ({ page }) => {
    await startWorkout(page);
    await logFirstSet(page);
    expect(await setCount(page)).toBe(1);

    await page.reload();

    // Resume must be automatic. Landing on the home screen after a crash would
    // tell the user their workout is gone even though the events are on disk.
    await expect(page.getByTestId('session-title')).toBeVisible();
    expect(await setCount(page)).toBe(1);
    await expect(page.getByTestId('rest-timer')).toBeVisible();

    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('history-list')).toBeVisible();
    await expect(page.getByTestId('history-item')).toHaveCount(1);
  });

  test('a reload after every single action loses nothing', async ({ page }) => {
    await startWorkout(page);

    for (let i = 0; i < 4; i += 1) {
      await page.getByTestId('set-0-done').first().click();
      await expect(page.getByTestId('set-count')).toContainText(`${String(i + 1)} sets`);
      await page.reload();
      await expect(page.getByTestId('session-title')).toBeVisible();
      expect(await setCount(page)).toBe(i + 1);
    }
  });

  test('a workout logged fully offline survives and finishes', async ({ page, context }) => {
    await startWorkout(page);
    await context.setOffline(true);

    // The counter only moves once the append transaction has committed, so waiting
    // on it is waiting on durability rather than on a repaint.
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 sets');
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('2 sets');

    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    expect(await setCount(page)).toBe(2);

    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('history-item')).toHaveCount(1);

    await context.setOffline(false);
  });

  test('an edited set is recorded at the edited value, not the prefilled one', async ({ page }) => {
    await startWorkout(page);

    await page.getByTestId('set-0-load').first().click();
    const loadInput = page.getByTestId('set-0-load-stepper-input').first();
    await loadInput.fill('87.5');
    await page.getByTestId('set-0-done').first().click();
    await expect(page.getByTestId('set-count')).toContainText('1 sets');

    await page.reload();
    await expect(page.getByTestId('previous-label').first()).toContainText('87.5 kg');
  });

  test('undo tombstones a set and restore brings it back, across a reload', async ({ page }) => {
    await startWorkout(page);
    await logFirstSet(page);

    await page.getByTestId('undo-last-set').click();
    await expect(page.getByTestId('set-count')).toContainText('0 sets');

    await page.reload();
    await expect(page.getByTestId('session-title')).toBeVisible();
    expect(await setCount(page)).toBe(0);

    // The deleted set is a reversible tombstone, not a removal, so it is still
    // there to restore after a restart.
    await page.getByTestId('restore-deleted-set').click();
    await expect(page.getByTestId('set-count')).toContainText('1 sets');
  });

  test('the rest timer is derived from its end time, not from ticks', async ({ page }) => {
    await startWorkout(page);
    await logFirstSet(page);

    const before = await page.getByTestId('rest-timer-value').textContent();

    // Freezing the page the way backgrounding does, then reading the clock again,
    // must produce a timer that moved by real elapsed time.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2500)));
    await page.reload();
    await expect(page.getByTestId('rest-timer')).toBeVisible();
    const after = await page.getByTestId('rest-timer-value').textContent();

    expect(after).not.toBe(before);
  });

  test('a second workout does not disturb the first', async ({ page }) => {
    await startWorkout(page);
    await logFirstSet(page);
    await page.getByTestId('finish-session').click();
    await expect(page.getByTestId('history-item')).toHaveCount(1);

    await page.getByTestId('back-home').click();
    await page.getByTestId('start-routine').click();
    await page.getByTestId('set-0-done').first().click();
    await page.getByTestId('finish-session').click();

    await expect(page.getByTestId('history-item')).toHaveCount(2);
    await expect(page.getByTestId('pending-events')).toContainText('events not yet synced');
  });
});

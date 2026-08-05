import { expect, test, type Page } from '@playwright/test';

// Two tabs of an installed web app share one IndexedDB, so they share the device
// id and the hybrid logical clock. The failure this guards against is the common
// one: a node id minted per tab, after which concurrent events never order against
// each other and both tabs believe they are in sync while holding different data.
test.describe('two tabs of the same app', () => {
  test("converge on one session without losing either tab's sets", async ({ context }) => {
    const first = await context.newPage();
    await first.goto('/');
    await first.getByTestId('start-routine').click();
    await expect(first.getByTestId('session-title')).toBeVisible();

    await first.getByTestId('set-0-done').first().click();
    await expect(first.getByTestId('set-count')).toContainText('1 set');

    const second = await context.newPage();
    await second.goto('/');
    // The second tab must resume the same active session, not offer to start a new one.
    await expect(second.getByTestId('session-title')).toBeVisible();
    await expect(second.getByTestId('set-count')).toContainText('1 set');

    await second.getByTestId('set-0-done').first().click();
    await expect(second.getByTestId('set-count')).toContainText('2 sets');

    await first.reload();
    await expect(first.getByTestId('set-count')).toContainText('2 sets');

    await first.getByTestId('set-0-done').first().click();
    await expect(first.getByTestId('set-count')).toContainText('3 sets');

    await second.reload();
    await expect(second.getByTestId('set-count')).toContainText('3 sets');

    const [firstEvents, secondEvents] = await Promise.all([
      readEventKeys(first),
      readEventKeys(second),
    ]);

    expect(firstEvents).toStrictEqual(secondEvents);
    expect(new Set(firstEvents.map(entry => entry.eventId)).size).toBe(firstEvents.length);
    expect(new Set(firstEvents.map(entry => entry.orderKey)).size).toBe(firstEvents.length);
    expect(new Set(firstEvents.map(entry => entry.deviceId)).size).toBe(1);

    // A total order is only a total order if it is strictly increasing.
    const sorted = [...firstEvents].map(entry => entry.orderKey).sort();
    expect(firstEvents.map(entry => entry.orderKey)).toStrictEqual(sorted);

    await first.close();
    await second.close();
  });
});

interface EventKey {
  eventId: string;
  orderKey: string;
  deviceId: string;
}

async function readEventKeys(page: Page): Promise<EventKey[]> {
  return page.evaluate<EventKey[]>(async () => {
    const open = indexedDB.open('ferrum');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(open.error ?? new Error('failed to open ferrum'));
      };
    });

    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction('events', 'readonly').objectStore('events').getAll();
      request.onsuccess = () => {
        resolve(request.result as unknown[]);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('failed to read events'));
      };
    });

    database.close();

    return rows
      .map(row => row as { eventId: string; orderKey: string; envelope: { deviceId: string } })
      .map(row => ({
        eventId: row.eventId,
        orderKey: row.orderKey,
        deviceId: row.envelope.deviceId,
      }))
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
  });
}

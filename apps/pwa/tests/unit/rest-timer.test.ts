import { describe, expect, test } from 'vitest';
import { type RestTimerRecord } from '../../src/db/ferrum-db.ts';
import { REST_ABANDONED_AFTER_SECONDS, formatClock, viewTimer } from '../../src/data/rest-timer.ts';

const START = 1_700_000_000_000;

function record(durationSeconds: number): RestTimerRecord {
  return {
    sessionId: 'ses_rest',
    startedAtMillis: START,
    endsAtMillis: START + durationSeconds * 1000,
    durationSeconds,
    status: 'running',
  };
}

describe('the rest timer reads its end time, never a tick count', () => {
  test('counts down while resting and reports nothing overdue', () => {
    const view = viewTimer(record(180), START + 60_000);
    expect(view).not.toBeNull();
    expect(view?.finished).toBe(false);
    expect(view?.remainingSeconds).toBe(120);
    expect(view?.overdueSeconds).toBe(0);
  });

  test('the instant it lands is finished, not one tick short of it', () => {
    const view = viewTimer(record(180), START + 180_000);
    expect(view?.finished).toBe(true);
    expect(view?.remainingSeconds).toBe(0);
    expect(view?.overdueSeconds).toBe(0);
  });

  test('a suspended tab comes back to the truth, not to where it stopped ticking', () => {
    // No interval fired for four minutes; the view is still exact.
    const view = viewTimer(record(180), START + 420_000);
    expect(view?.finished).toBe(true);
    expect(view?.overdueSeconds).toBe(240);
  });

  test('a workout walked away from stops claiming to be a rest', () => {
    const timer = record(180);
    const stillShown = 180 + REST_ABANDONED_AFTER_SECONDS;
    expect(viewTimer(timer, START + stillShown * 1000)).not.toBeNull();
    // One second past the bound the banner is gone rather than showing a
    // six-day overdue count that formatClock cannot even express.
    expect(viewTimer(timer, START + (stillShown + 1) * 1000)).toBeNull();
    expect(viewTimer(timer, START + 6 * 24 * 3_600 * 1000)).toBeNull();
  });

  test('every value the banner can show stays inside mm:ss', () => {
    const timer = record(180);
    for (let second = 0; second <= 180 + REST_ABANDONED_AFTER_SECONDS; second += 7) {
      const view = viewTimer(timer, START + second * 1000);
      expect(view).not.toBeNull();
      const shown = view!.finished ? view!.overdueSeconds : view!.remainingSeconds;
      expect(formatClock(shown)).toMatch(/^\d{1,2}:[0-5]\d$/);
    }
  });
});

import { useEffect, useState } from 'react';
import { type SessionId, type SessionProjection } from '@ferrum/domain';
import { listSessionIds, loadSession, unacknowledgedCount } from './db/event-store.ts';
import { startEmptySession, startSession } from './features/workout/session-controller.ts';
import { SEED_ROUTINE } from './features/workout/routine.ts';
import { WorkoutScreen } from './features/workout/WorkoutScreen.tsx';
import { SpikeA } from './features/spike/SpikeA.tsx';
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, EYEBROW, MONO } from './ui.ts';

type Screen = { name: 'home' } | { name: 'workout'; sessionId: SessionId } | { name: 'history' };

// Reached at /#spike on the device under test; it is diagnostics, not a feature,
// so it deliberately has no entry point in the normal navigation. Split at the top
// so the two trees never share a hook order.
export function App() {
  if (window.location.hash === '#spike') return <SpikeA />;
  return <WorkoutApp />;
}

function WorkoutApp() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [booted, setBooted] = useState(false);

  // Resuming happens before anything is painted. A user who force-quit mid-workout
  // must land back inside that workout, not on a home screen that implies it is gone.
  useEffect(() => {
    void (async () => {
      for (const sessionId of await listSessionIds()) {
        const projection = await loadSession(sessionId);
        if (projection.session?.status === 'active') {
          setScreen({ name: 'workout', sessionId });
          break;
        }
      }
      setBooted(true);
    })();
  }, []);

  if (!booted) {
    return (
      <main className="p-6 text-ash" data-testid="booting">
        Restoring…
      </main>
    );
  }

  switch (screen.name) {
    case 'home':
      return <HomeScreen onNavigate={setScreen} />;
    case 'workout':
      return (
        <WorkoutScreen
          sessionId={screen.sessionId}
          onFinished={() => {
            setScreen({ name: 'history' });
          }}
        />
      );
    case 'history':
      return <HistoryScreen onNavigate={setScreen} />;
  }
}

function HomeScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const [starting, setStarting] = useState(false);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-4">
      <h1 className="border-b border-seam pb-3 font-display text-4xl font-bold tracking-[0.04em] uppercase">
        Ferrum
      </h1>
      <div className={`${CARD} p-4`}>
        <p className={EYEBROW}>Routine</p>
        <p className="mt-1 font-display text-xl font-semibold uppercase">{SEED_ROUTINE.name}</p>
        <ul className="mt-3 flex flex-col gap-2 border-t border-seam pt-3 text-sm">
          {SEED_ROUTINE.slots.map(slot => (
            <li key={slot.exerciseDefinitionId} className="flex items-baseline justify-between">
              <span>{slot.name}</span>
              <span className={`${MONO} text-sm font-medium text-ash`}>
                {slot.sets} × {slot.targetRepMin}–{slot.targetRepMax}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        disabled={starting}
        className={`${BTN_PRIMARY} w-full text-lg`}
        data-testid="start-routine"
        onClick={() => {
          setStarting(true);
          void (async () => {
            const sessionId = await startSession(SEED_ROUTINE, Date.now());
            onNavigate({ name: 'workout', sessionId });
          })();
        }}
      >
        Start {SEED_ROUTINE.name}
      </button>
      <button
        type="button"
        disabled={starting}
        className="tap-target rounded-md border border-chalk/35 text-base text-chalk disabled:opacity-50"
        data-testid="start-empty-workout"
        onClick={() => {
          setStarting(true);
          void (async () => {
            const sessionId = await startEmptySession(Date.now());
            onNavigate({ name: 'workout', sessionId });
          })();
        }}
      >
        Start empty workout
      </button>
      <button
        type="button"
        className={BTN_SECONDARY}
        data-testid="open-history"
        onClick={() => {
          onNavigate({ name: 'history' });
        }}
      >
        History
      </button>
    </main>
  );
}

function HistoryScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const [sessions, setSessions] = useState<SessionProjection[] | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void (async () => {
      const ids = await listSessionIds();
      setSessions(await Promise.all(ids.map(id => loadSession(id))));
      setPending(await unacknowledgedCount());
    })();
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-3 p-4">
      <header className="flex items-center justify-between border-b border-seam pb-3">
        <h1 className="font-display text-2xl font-bold tracking-[0.04em] uppercase">History</h1>
        <button
          type="button"
          className={`${BTN_QUIET} px-4`}
          data-testid="back-home"
          onClick={() => {
            onNavigate({ name: 'home' });
          }}
        >
          Home
        </button>
      </header>

      <p className="text-xs text-ash" data-testid="pending-events">
        <span className={`${MONO} font-medium`}>{pending}</span> events not yet synced
      </p>

      {sessions == null ? (
        <p className="text-ash">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-ash" data-testid="history-empty">
          No sessions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="history-list">
          {sessions.map(projection => (
            <li key={projection.sessionId} className={`${CARD} p-3`} data-testid="history-item">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-display text-base font-semibold uppercase">
                  {projection.session?.title ?? 'Workout'}
                </span>
                <span className={`${MONO} text-xs font-medium text-ash`}>
                  {projection.session?.localDate}
                </span>
              </div>
              <div className={`${MONO} mt-1 text-xs font-medium text-ash`}>
                {projection.sets.length} sets · {projection.session?.status}
                {projection.session?.amendedAfterFinish === true && ' · edited after finish'}
                {projection.deletedSets.length > 0 &&
                  ` · ${String(projection.deletedSets.length)} deleted`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

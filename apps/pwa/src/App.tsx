import { useEffect, useState } from 'react';
import { type SessionId, type SessionProjection } from '@ferrum/domain';
import { listSessionIds, loadSession, unacknowledgedCount } from './db/event-store.ts';
import { startEmptySession, startSession } from './features/workout/session-controller.ts';
import { SEED_ROUTINE } from './features/workout/routine.ts';
import { WorkoutScreen } from './features/workout/WorkoutScreen.tsx';
import { SpikeA } from './features/spike/SpikeA.tsx';

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
      <main className="p-6 text-neutral-400" data-testid="booting">
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
      <h1 className="text-2xl font-bold">Ferrum</h1>
      <p className="text-sm text-neutral-400">{SEED_ROUTINE.name}</p>
      <ul className="text-sm text-neutral-300">
        {SEED_ROUTINE.slots.map(slot => (
          <li key={slot.exerciseDefinitionId} className="py-1">
            {slot.name} — {slot.sets} × {slot.targetRepMin}–{slot.targetRepMax}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={starting}
        className="tap-target rounded-xl bg-accent text-lg font-bold text-black disabled:opacity-50"
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
        className="tap-target rounded-xl border border-edge text-base disabled:opacity-50"
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
        className="tap-target rounded-xl border border-edge text-base"
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
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">History</h1>
        <button
          type="button"
          className="tap-target rounded-lg border border-edge px-4 text-sm"
          data-testid="back-home"
          onClick={() => {
            onNavigate({ name: 'home' });
          }}
        >
          Home
        </button>
      </header>

      <p className="text-xs text-neutral-500" data-testid="pending-events">
        {pending} events not yet synced
      </p>

      {sessions == null ? (
        <p className="text-neutral-400">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-neutral-400" data-testid="history-empty">
          No sessions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="history-list">
          {sessions.map(projection => (
            <li
              key={projection.sessionId}
              className="rounded-xl border border-edge bg-surface p-3"
              data-testid="history-item"
            >
              <div className="flex justify-between text-sm">
                <span>{projection.session?.title ?? 'Workout'}</span>
                <span className="text-neutral-400">{projection.session?.localDate}</span>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
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

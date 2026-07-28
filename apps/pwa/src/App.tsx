import { useEffect, useState } from 'react';
import { type SessionId, type WeightUnit } from '@ferrum/domain';
import { listSessionIds, loadSession } from './db/event-store.ts';
import { HistoryDetailScreen } from './features/history/HistoryDetailScreen.tsx';
import { HistoryScreen } from './features/history/HistoryScreen.tsx';
import { WorkoutSummaryScreen } from './features/history/WorkoutSummaryScreen.tsx';
import { HomeScreen } from './features/routines/HomeScreen.tsx';
import { RoutineBuilderScreen } from './features/routines/RoutineBuilderScreen.tsx';
import { ensureSeedRoutine } from './features/routines/routine-store.ts';
import { SettingsScreen } from './features/settings/SettingsScreen.tsx';
import { loadUnit } from './features/settings/settings-store.ts';
import { SpikeA } from './features/spike/SpikeA.tsx';
import { WorkoutScreen } from './features/workout/WorkoutScreen.tsx';
import { applyUpdate, subscribeUpdateReady } from './platform/sw-update.ts';
import { BTN_PRIMARY } from './ui.ts';

type Screen =
  | { name: 'home' }
  | { name: 'workout'; sessionId: SessionId }
  | { name: 'summary'; sessionId: SessionId }
  | { name: 'history' }
  | { name: 'historyDetail'; sessionId: SessionId }
  | { name: 'routineBuilder'; routineId: string | null }
  | { name: 'settings' };

// Reached at /#spike on the device under test; it is diagnostics, not a feature,
// so it deliberately has no entry point in the normal navigation. Split at the top
// so the two trees never share a hook order.
export function App() {
  if (window.location.hash === '#spike') return <SpikeA />;
  return <WorkoutApp />;
}

function WorkoutApp() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [booted, setBooted] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  // Resuming happens before anything is painted. A user who force-quit mid-workout
  // must land back inside that workout, not on a home screen that implies it is gone.
  useEffect(() => {
    void (async () => {
      await ensureSeedRoutine(Date.now());
      setUnit(await loadUnit());
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

  useEffect(() => subscribeUpdateReady(setUpdateReady), []);

  if (!booted) {
    return (
      <main className="p-6 text-ash" data-testid="booting">
        Restoring…
      </main>
    );
  }

  // The update toast never shows over an open workout: applying an update reloads
  // the page, and mid-workout is exactly the wrong moment to offer that.
  const showUpdateToast = updateReady && screen.name !== 'workout';

  return (
    <>
      <CurrentScreen screen={screen} unit={unit} onNavigate={setScreen} onUnitChanged={setUnit} />
      {showUpdateToast && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-seam bg-forged p-4"
          data-testid="sw-update-toast"
        >
          <span className="text-sm text-chalk">Update ready</span>
          <button
            type="button"
            className={`${BTN_PRIMARY} px-4`}
            data-testid="sw-update-restart"
            onClick={applyUpdate}
          >
            Restart
          </button>
        </div>
      )}
    </>
  );
}

function CurrentScreen({
  screen,
  unit,
  onNavigate,
  onUnitChanged,
}: {
  screen: Screen;
  unit: WeightUnit;
  onNavigate: (screen: Screen) => void;
  onUnitChanged: (unit: WeightUnit) => void;
}) {
  switch (screen.name) {
    case 'home':
      return (
        <HomeScreen
          unit={unit}
          onWorkoutStarted={sessionId => {
            onNavigate({ name: 'workout', sessionId });
          }}
          onEditRoutine={routineId => {
            onNavigate({ name: 'routineBuilder', routineId });
          }}
          onNewRoutine={() => {
            onNavigate({ name: 'routineBuilder', routineId: null });
          }}
          onOpenHistory={() => {
            onNavigate({ name: 'history' });
          }}
          onOpenSettings={() => {
            onNavigate({ name: 'settings' });
          }}
        />
      );
    case 'workout':
      return (
        <WorkoutScreen
          sessionId={screen.sessionId}
          unit={unit}
          onFinished={() => {
            onNavigate({ name: 'summary', sessionId: screen.sessionId });
          }}
        />
      );
    case 'summary':
      return (
        <WorkoutSummaryScreen
          sessionId={screen.sessionId}
          unit={unit}
          onHome={() => {
            onNavigate({ name: 'home' });
          }}
        />
      );
    case 'history':
      return (
        <HistoryScreen
          onHome={() => {
            onNavigate({ name: 'home' });
          }}
          onOpenSession={sessionId => {
            onNavigate({ name: 'historyDetail', sessionId });
          }}
        />
      );
    case 'historyDetail':
      return (
        <HistoryDetailScreen
          sessionId={screen.sessionId}
          unit={unit}
          onBack={() => {
            onNavigate({ name: 'history' });
          }}
        />
      );
    case 'routineBuilder':
      return (
        <RoutineBuilderScreen
          routineId={screen.routineId}
          unit={unit}
          onDone={() => {
            onNavigate({ name: 'home' });
          }}
        />
      );
    case 'settings':
      return (
        <SettingsScreen
          unit={unit}
          onUnitChanged={onUnitChanged}
          onBack={() => {
            onNavigate({ name: 'home' });
          }}
        />
      );
  }
}

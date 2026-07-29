import { useEffect, useState } from 'react';
import { type SessionId, type WeightUnit } from '@ferrum/domain';
import { listSessionIds, loadSession } from './db/event-store.ts';
import { HistoryDetailScreen } from './features/history/HistoryDetailScreen.tsx';
import { HistoryScreen } from './features/history/HistoryScreen.tsx';
import { WorkoutSummaryScreen } from './features/history/WorkoutSummaryScreen.tsx';
import { HomeScreen } from './features/routines/HomeScreen.tsx';
import { RoutineBuilderScreen } from './features/routines/RoutineBuilderScreen.tsx';
import { ensureSeedRoutine } from './data/routine-store.ts';
import { SettingsScreen } from './features/settings/SettingsScreen.tsx';
import { loadUnit } from './data/settings-store.ts';
import { SpikeA } from './features/spike/SpikeA.tsx';
import { WorkoutScreen } from './features/workout/WorkoutScreen.tsx';
import { applyUpdate, subscribeUpdateReady } from './platform/sw-update.ts';
import { initSync } from './sync/sync-client.ts';
import { button } from './ui.ts';

type Screen =
  | { name: 'home' }
  | { name: 'workout'; sessionId: SessionId }
  | { name: 'summary'; sessionId: SessionId }
  | { name: 'history' }
  | { name: 'historyDetail'; sessionId: SessionId }
  | { name: 'routineBuilder'; routineId: string | null }
  | { name: 'settings' }
  // Diagnostics, not a feature: reached at /#spike on the device under test, with
  // no entry point in the normal navigation.
  | { name: 'spike' };

function initialScreen(): Screen {
  return window.location.hash === '#spike' ? { name: 'spike' } : { name: 'home' };
}

function urlFor(screen: Screen): string {
  const base = window.location.pathname + window.location.search;
  return screen.name === 'spike' ? `${base}#spike` : base;
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [booted, setBooted] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  // Every in-app navigation pushes a history entry, so the Android back gesture
  // walks back through screens instead of exiting the app. Back from the entry
  // screen leaves the app — that one is the platform's exit affordance.
  const navigate = (next: Screen) => {
    setScreen(next);
    history.pushState({ screen: next }, '', urlFor(next));
  };

  // For a screen that must not be reachable again by going back — the entry it sits on
  // describes a session that no longer accepts sets.
  const replace = (next: Screen) => {
    setScreen(next);
    history.replaceState({ screen: next }, '', urlFor(next));
  };

  useEffect(() => {
    history.replaceState({ screen: initialScreen() }, '', urlFor(initialScreen()));
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { screen?: Screen } | null;
      setScreen(state?.screen ?? initialScreen());
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Resuming happens before anything is painted. A user who force-quit mid-workout
  // must land back inside that workout, not on a home screen that implies it is gone.
  useEffect(() => {
    void (async () => {
      await ensureSeedRoutine(Date.now());
      setUnit(await loadUnit());
      if (window.location.hash !== '#spike') {
        for (const sessionId of await listSessionIds()) {
          const projection = await loadSession(sessionId);
          // A deleted-but-unfinished session must never hijack boot: its tombstone
          // makes it not-active for resume purposes, however its status reads.
          if (projection.session?.status === 'active' && !projection.session.deleted) {
            // Pushed, not replaced: back from a resumed workout lands on Home
            // instead of exiting, and the session stays active either way.
            const resumed: Screen = { name: 'workout', sessionId };
            setScreen(resumed);
            history.pushState({ screen: resumed }, '', urlFor(resumed));
            break;
          }
        }
      }
      setBooted(true);
      // Sync starts strictly after boot: it must never delay the resume path, and
      // it stays a no-op until a server and token are configured in Settings.
      await initSync();
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
      <CurrentScreen
        screen={screen}
        unit={unit}
        onNavigate={navigate}
        onReplace={replace}
        onUnitChanged={setUnit}
      />
      {showUpdateToast && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-seam bg-forged p-4"
          data-testid="sw-update-toast"
        >
          <span className="text-sm text-chalk">Update ready</span>
          <button
            type="button"
            className={button({ className: 'px-4' })}
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
  onReplace,
  onUnitChanged,
}: {
  screen: Screen;
  unit: WeightUnit;
  onNavigate: (screen: Screen) => void;
  onReplace: (screen: Screen) => void;
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
          // A discarded workout has no summary worth showing, and back must not walk
          // into the tombstoned session either: replace the workout entry instead of
          // pushing Home on top of it.
          onDiscarded={() => {
            onReplace({ name: 'home' });
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
    case 'spike':
      return <SpikeA />;
  }
}

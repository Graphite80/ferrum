import { type ReactNode, useEffect, useState } from 'react';
import { type SessionId, type WeightUnit } from '@ferrum/domain';
import { activeSession, listSessionIds, loadSession } from './db/event-store.ts';
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
import { initSync } from './sync/sync-client.ts';
import { BottomNav, type Tab } from './components/BottomNav.tsx';
import { useLiveData } from './components/live-data.ts';

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

// Every screen owns a path. Before this they all shared one, so the address bar
// never described where you were: a reload dropped you on Home whatever you had
// open, and nothing could be linked to.
function urlFor(screen: Screen): string {
  const search = window.location.search;
  switch (screen.name) {
    case 'home':
      return `/${search}`;
    case 'workout':
      return `/workout/${screen.sessionId}${search}`;
    case 'summary':
      return `/summary/${screen.sessionId}${search}`;
    case 'history':
      return `/history${search}`;
    case 'historyDetail':
      return `/history/${screen.sessionId}${search}`;
    case 'routineBuilder':
      return `/routine/${screen.routineId ?? 'new'}${search}`;
    case 'settings':
      return `/settings${search}`;
    case 'spike':
      return `/${search}#spike`;
  }
}

function screenForPath(pathname: string): Screen | null {
  const [, head = '', tail] = pathname.split('/');
  switch (head) {
    case 'workout':
      return tail == null || tail === '' ? null : { name: 'workout', sessionId: tail as SessionId };
    case 'summary':
      return tail == null || tail === '' ? null : { name: 'summary', sessionId: tail as SessionId };
    case 'history':
      return tail == null || tail === ''
        ? { name: 'history' }
        : { name: 'historyDetail', sessionId: tail as SessionId };
    case 'routine':
      return tail == null || tail === ''
        ? null
        : { name: 'routineBuilder', routineId: tail === 'new' ? null : tail };
    case 'settings':
      return { name: 'settings' };
    default:
      return null;
  }
}

function initialScreen(): Screen {
  if (window.location.hash === '#spike') return { name: 'spike' };
  return screenForPath(window.location.pathname) ?? { name: 'home' };
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [booted, setBooted] = useState(false);

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
      // Only when the address bar does not already say where to be. A force-quit
      // mid-workout now leaves /workout/<id> behind, which resumes by itself;
      // this stays as the answer for a cold start on / — and it must not drag a
      // user who reloaded on /history back into a workout they had left.
      if (window.location.hash !== '#spike' && screenForPath(window.location.pathname) === null) {
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
      // Isolated too — this runs after the app is painted, so an unhandled
      // rejection here would be a silent failure of everything downstream of it.
      await initSync().catch((error: unknown) => {
        console.error('sync failed to start', error);
      });
    })();
  }, []);

  if (!booted) {
    return (
      <main className="p-6 text-ash" data-testid="booting">
        Restoring…
      </main>
    );
  }

  return (
    <CurrentScreen
      screen={screen}
      unit={unit}
      onNavigate={navigate}
      onReplace={replace}
      onUnitChanged={setUnit}
    />
  );
}

// Bottom padding so content is not hidden under the fixed nav bar.
const TAB_SCREEN_NAMES: Screen['name'][] = ['home', 'history', 'settings'];
void TAB_SCREEN_NAMES;

function tabFor(screen: Screen): Tab | null {
  if (screen.name === 'home') return 'home';
  if (screen.name === 'history') return 'history';
  if (screen.name === 'settings') return 'settings';
  if (screen.name === 'workout') return 'workout';
  // Secondary screens keep the nav visible, highlighting their parent tab.
  if (screen.name === 'summary') return 'home';
  if (screen.name === 'routineBuilder') return 'home';
  if (screen.name === 'historyDetail') return 'history';
  return null;
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
  const activeTab = tabFor(screen);
  const running = useLiveData(activeSession);
  const hasActiveWorkout = running?.session?.status === 'active' && running.session.deleted !== true;

  const handleTabSelect = (tab: Tab) => {
    if (tab === 'workout' && running?.session != null) {
      onNavigate({ name: 'workout', sessionId: running.session.id });
      return;
    }
    const target: Screen =
      tab === 'home' ? { name: 'home' }
      : tab === 'history' ? { name: 'history' }
      : { name: 'settings' };
    onNavigate(target);
  };

  let content: ReactNode;
  switch (screen.name) {
    case 'home':
      content = (
        <HomeScreen
          unit={unit}
          onWorkoutStarted={sessionId => {
            onNavigate({ name: 'workout', sessionId });
          }}
          onResumeWorkout={sessionId => {
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
      break;
    case 'workout':
      // Workout screen shows BottomNav with 4th active-workout tab
      content = (
        <WorkoutScreen
          sessionId={screen.sessionId}
          unit={unit}
          onFinished={() => {
            onNavigate({ name: 'summary', sessionId: screen.sessionId });
          }}
          onDiscarded={() => {
            onReplace({ name: 'home' });
          }}
          onLeave={() => {
            onReplace({ name: 'home' });
          }}
        />
      );
      break;
    case 'summary':
      content = (
        <WorkoutSummaryScreen
          sessionId={screen.sessionId}
          unit={unit}
          onHome={() => {
            onNavigate({ name: 'home' });
          }}
          onSaveAsRoutine={routineId => {
            onNavigate({ name: 'routineBuilder', routineId });
          }}
        />
      );
      break;
    case 'history':
      content = (
        <HistoryScreen
          onHome={() => {
            onNavigate({ name: 'home' });
          }}
          onOpenSession={sessionId => {
            onNavigate({ name: 'historyDetail', sessionId });
          }}
        />
      );
      break;
    case 'historyDetail':
      content = (
        <HistoryDetailScreen
          sessionId={screen.sessionId}
          unit={unit}
          onBack={() => {
            onNavigate({ name: 'history' });
          }}
        />
      );
      break;
    case 'routineBuilder':
      content = (
        <RoutineBuilderScreen
          routineId={screen.routineId}
          unit={unit}
          onDone={() => {
            onNavigate({ name: 'home' });
          }}
        />
      );
      break;
    case 'settings':
      content = (
        <SettingsScreen
          unit={unit}
          onUnitChanged={onUnitChanged}
          onBack={() => {
            onNavigate({ name: 'home' });
          }}
        />
      );
      break;
    case 'spike':
      return <SpikeA />;
    default:
      return null;
  }

  // Tab screens + workout: render with bottom nav and bottom padding.
  return (
    <div className="pb-24">
      {content}
      {activeTab != null && (
        <BottomNav active={activeTab} hasActiveWorkout={hasActiveWorkout} onSelect={handleTabSelect} />
      )}
    </div>
  );
}

import { AthleteIcon, ProfileIcon } from './icons.tsx';

export type Tab = 'home' | 'history' | 'settings' | 'workout';

interface BottomNavProps {
  readonly active: Tab;
  readonly hasActiveWorkout?: boolean;
  readonly onSelect: (tab: Tab) => void;
}

// Active tab: red fill, black content. Inactive: dark fill, red content.
function tabClass(active: boolean, shape: 'square' | 'pill'): string {
  return [
    'flex h-14 items-center justify-center rounded-[20px] transition-colors',
    shape === 'square' ? 'w-14' : 'px-5',
    active ? 'bg-plate-red text-black' : 'bg-[#1a1a1a] text-plate-red',
  ].join(' ');
}

export function BottomNav({ active, hasActiveWorkout = false, onSelect }: BottomNavProps) {
  return (
    <>
      {/* Scroll fade: content dims to black behind the floating nav. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-32 bg-gradient-to-t from-black via-black/80 to-transparent" />
      <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-[env(safe-area-inset-bottom,8px)] pointer-events-none">
        <nav
          className="pointer-events-auto mb-2 flex items-center gap-2 rounded-[29px] border-2 border-seam bg-black p-2.5"
          aria-label="Main navigation"
        >
        {hasActiveWorkout && (
          <button
            type="button"
            aria-label="Active workout"
            aria-current={active === 'workout' ? 'page' : undefined}
            className={tabClass(active === 'workout', 'square')}
            onClick={() => { onSelect('workout'); }}
          >
            <AthleteIcon />
          </button>
        )}
        <button
          type="button"
          aria-current={active === 'home' ? 'page' : undefined}
          className={tabClass(active === 'home', 'pill')}
          onClick={() => { onSelect('home'); }}
        >
          <span className="font-display text-sm uppercase tracking-normal">Workouts</span>
        </button>
        <button
          type="button"
          aria-current={active === 'history' ? 'page' : undefined}
          className={tabClass(active === 'history', 'pill')}
          onClick={() => { onSelect('history'); }}
        >
          <span className="font-display text-sm uppercase tracking-normal">History</span>
        </button>
        <button
          type="button"
          aria-label="Profile"
          aria-current={active === 'settings' ? 'page' : undefined}
          className={tabClass(active === 'settings', 'square')}
          onClick={() => { onSelect('settings'); }}
        >
          <ProfileIcon />
        </button>
      </nav>
      </div>
    </>
  );
}

export type WakeLockSupport =
  | { readonly kind: 'supported' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'silently_broken'; readonly iosVersion: string };

export interface WakeLockState {
  readonly support: WakeLockSupport;
  readonly held: boolean;
  readonly lastError: string | null;
}

function parseIosVersion(userAgent: string): [number, number] | null {
  const match = /OS (\d+)[_.](\d+)(?:[_.]\d+)? like Mac OS X/.exec(userAgent);
  if (match?.[1] == null || match[2] == null) return null;
  return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)];
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as { standalone?: boolean }).standalone;
  return iosStandalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

// From iOS 16.4 to 18.3.1 a home-screen web app got a resolved promise and a
// WakeLockSentinel with released === false, and the screen dimmed anyway
// (WebKit bug 254545, fixed in 18.4). No feature test can see that, so version
// sniffing is the only honest detection and the user gets told the truth instead
// of a lock that silently does nothing.
export function detectWakeLockSupport(
  userAgent: string = navigator.userAgent,
  standalone: boolean = isStandalone()
): WakeLockSupport {
  if (!('wakeLock' in navigator)) return { kind: 'absent' };

  const ios = parseIosVersion(userAgent);
  if (ios == null || !standalone) return { kind: 'supported' };

  const [major, minor] = ios;
  if (major < 18 || (major === 18 && minor < 4)) {
    return { kind: 'silently_broken', iosVersion: `${String(major)}.${String(minor)}` };
  }
  return { kind: 'supported' };
}

export class WakeLockController {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private lastError: string | null = null;

  constructor(private readonly onChange: (state: WakeLockState) => void) {}

  get state(): WakeLockState {
    return {
      support: detectWakeLockSupport(),
      held: this.sentinel != null && !this.sentinel.released,
      lastError: this.lastError,
    };
  }

  // Must be called from a user gesture the first time: WebKit demands transient
  // activation even though the specification does not. Authorization is sticky for
  // the document afterwards, which is what makes the visibilitychange re-acquire work.
  async request(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  async release(): Promise<void> {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel != null && !sentinel.released) await sentinel.release();
    this.onChange(this.state);
  }

  handleVisibilityChange(): void {
    if (!this.wanted || document.visibilityState !== 'visible') return;
    void this.acquire();
  }

  private async acquire(): Promise<void> {
    if (detectWakeLockSupport().kind === 'absent') return;
    if (document.visibilityState !== 'visible') return;
    if (this.sentinel != null && !this.sentinel.released) return;

    try {
      const sentinel = await navigator.wakeLock.request('screen');
      this.sentinel = sentinel;
      this.lastError = null;
      sentinel.addEventListener('release', () => {
        this.onChange(this.state);
      });
    } catch (error) {
      this.sentinel = null;
      this.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    this.onChange(this.state);
  }
}

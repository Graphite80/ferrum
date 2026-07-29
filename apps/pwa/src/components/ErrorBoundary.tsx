import { Component, type ErrorInfo, type ReactNode } from 'react';
import { button, card } from '../ui.ts';

interface ErrorBoundaryState {
  readonly failed: boolean;
}

// The last line of defence for the workout screen: a render-time throw must show
// a way back instead of a blank page. Nothing is lost when this fires — the log
// is already committed to IndexedDB, so reloading replays it.
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render failed', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-4">
        <h1 className="font-display text-3xl font-bold tracking-[0.04em] uppercase">Ferrum</h1>
        <div className={`${card()} p-4`}>
          <p className="text-sm text-ash">
            The screen could not be drawn. Your workout is safe on this device — reloading replays
            it from the log.
          </p>
        </div>
        <button
          type="button"
          className={button()}
          data-testid="error-reload"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload
        </button>
      </main>
    );
  }
}

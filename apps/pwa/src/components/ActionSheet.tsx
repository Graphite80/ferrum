import { type ReactNode } from 'react';

export interface ActionSheetAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly destructive?: boolean;
}

// iOS-style action sheet: slides up from the bottom, sits above the tab bar,
// dims the screen behind it.
export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  readonly title?: string;
  readonly actions: readonly ActionSheetAction[];
  readonly onClose: () => void;
}): ReactNode {
  const normalActions = actions.filter(a => !a.destructive);
  const destructiveActions = actions.filter(a => a.destructive);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/60"
      data-testid="action-sheet"
      onClick={onClose}
    >
      <div
        className="mx-auto mb-24 flex w-full max-w-md flex-col gap-2 px-3"
        onClick={e => { e.stopPropagation(); }}
      >
        <div className="overflow-hidden rounded-[20px] bg-[#1a1a1a]">
          {title != null && (
            <div className="border-b-2 border-seam px-4 py-3 text-center font-display text-sm uppercase tracking-normal text-ash">
              {title}
            </div>
          )}
          {normalActions.map((action, i) => (
            <button
              key={action.label}
              type="button"
              className={`tap-target w-full font-display text-base uppercase tracking-normal text-chalk${
                i > 0 || title != null ? ' border-t-2 border-seam' : ''
              }`}
              data-testid={`action-${action.label.toLowerCase()}`}
              onClick={() => { action.onClick(); onClose(); }}
            >
              {action.label}
            </button>
          ))}
        </div>

        {destructiveActions.length > 0 && (
          <div className="overflow-hidden rounded-[20px] bg-plate-red">
            {destructiveActions.map((action, i) => (
              <button
                key={action.label}
                type="button"
                className={`tap-target w-full font-display text-base uppercase tracking-normal text-white${
                  i > 0 ? ' border-t-2 border-white/20' : ''
                }`}
                data-testid={`action-${action.label.toLowerCase()}`}
                onClick={() => { action.onClick(); onClose(); }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

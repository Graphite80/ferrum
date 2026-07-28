import { type ReactNode } from 'react';
import { tv } from 'tailwind-variants';
import { eyebrow } from '../ui.ts';

const shell = tv({ base: 'mx-auto flex min-h-full max-w-md flex-col gap-4 p-4' });
const shellHeader = tv({
  base: 'border-b border-seam pb-3',
  variants: {
    layout: {
      row: 'flex items-center justify-between',
      stack: '',
    },
  },
  defaultVariants: { layout: 'row' },
});
const shellTitle = tv({
  base: 'font-display text-2xl font-bold tracking-[0.04em] uppercase',
});

export interface ScreenShellProps {
  readonly title: ReactNode;
  readonly action?: ReactNode;
  readonly eyebrowText?: string;
  readonly testId?: string;
  readonly className?: string;
  readonly headerClassName?: string;
  readonly titleClassName?: string;
  readonly titleTestId?: string;
  readonly children: ReactNode;
}

export function ScreenShell(props: ScreenShellProps) {
  return (
    <main className={shell({ className: props.className })} data-testid={props.testId}>
      <header
        className={shellHeader({
          layout: props.eyebrowText == null ? 'row' : 'stack',
          className: props.headerClassName,
        })}
      >
        {props.eyebrowText != null && <p className={eyebrow()}>{props.eyebrowText}</p>}
        <h1
          className={shellTitle({ className: props.titleClassName })}
          data-testid={props.titleTestId}
        >
          {props.title}
        </h1>
        {props.action}
      </header>
      {props.children}
    </main>
  );
}

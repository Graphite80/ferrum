import { type ReactNode, useEffect, useRef, useState } from 'react';
import { tv } from 'tailwind-variants';
import { eyebrow } from '../ui.ts';
import { useIsScrolled } from '../platform/use-scrolled.ts';

const shell = tv({ base: 'mx-auto flex min-h-full max-w-md flex-col gap-4 p-4' });
const shellHeader = tv({
  base: 'sticky top-0 z-10 bg-ingot border-b border-seam pb-3',
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
  const headerRef = useRef<HTMLElement>(null);
  const [gradTop, setGradTop] = useState(56);
  const scrolled = useIsScrolled();

  // Measure header height after paint so the gradient sits exactly below it.
  useEffect(() => {
    if (headerRef.current) setGradTop(headerRef.current.offsetHeight);
  }, [props.title, props.eyebrowText, props.action]);

  return (
    <main className={shell({ className: props.className })} data-testid={props.testId}>
      <header
        ref={headerRef}
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
      {/* Zero-height sticky anchor: inner div overflows downward with no layout impact */}
      <div className="pointer-events-none sticky z-[9] overflow-visible" style={{ top: gradTop, height: 0 }} aria-hidden>
        <div className={`h-22 w-full bg-gradient-to-b from-black to-transparent transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-0'}`} />
      </div>
      {props.children}
    </main>
  );
}

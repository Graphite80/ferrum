import { type ReactNode } from 'react';
import { card, eyebrow, mono } from '../ui.ts';

export interface StatCardProps {
  readonly label: string;
  readonly value?: string;
  readonly valueTestId?: string;
  readonly description?: string;
  readonly testId?: string;
  readonly className?: string;
  readonly children?: ReactNode;
}

export function StatCard(props: StatCardProps) {
  return (
    <div
      className={card({ className: `flex flex-col gap-1 p-3 ${props.className ?? ''}` })}
      data-testid={props.testId}
    >
      <span className={eyebrow()}>{props.label}</span>
      {props.value != null && (
        <span
          className={mono({ className: 'text-lg leading-none font-bold text-chalk' })}
          data-testid={props.valueTestId}
        >
          {props.value}
        </span>
      )}
      {props.description != null && <p className="text-xs text-ash">{props.description}</p>}
      {props.children}
    </div>
  );
}

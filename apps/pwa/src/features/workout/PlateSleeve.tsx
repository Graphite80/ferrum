import { useEffect, useRef } from 'react';

export interface PlateSleeveProps {
  readonly completed: number;
  readonly target: number | null;
}

export function PlateSleeve(props: PlateSleeveProps) {
  const previousCompleted = useRef(props.completed);
  useEffect(() => {
    previousCompleted.current = props.completed;
  }, [props.completed]);
  const animateFrom = previousCompleted.current;

  const target = props.target ?? 0;
  const slots = Math.max(target, props.completed);
  if (slots === 0) return null;

  return (
    <div className="relative flex h-6 items-center gap-[3px] pr-4" aria-hidden="true">
      <div className="absolute top-1/2 right-0 left-0 h-[2px] -translate-y-1/2 rounded-full bg-seam" />
      <div className="relative h-4 w-[3px] rounded-[1px] bg-ash" />
      {Array.from({ length: slots }, (_, index) => {
        if (index < props.completed) {
          const isExtra = props.target != null && index >= target;
          return (
            <div
              key={index}
              className={`relative h-6 w-2 rounded-[2px] ${
                isExtra ? 'border border-chalk/70 bg-chalk/15' : 'bg-plate-green'
              } ${index >= animateFrom ? 'plate-in' : ''}`}
            />
          );
        }
        return <div key={index} className="relative h-6 w-2 rounded-[2px] border border-ash/40" />;
      })}
    </div>
  );
}

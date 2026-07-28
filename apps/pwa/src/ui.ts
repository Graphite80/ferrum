import { tv } from 'tailwind-variants';

export const button = tv({
  base: 'tap-target rounded-md',
  variants: {
    intent: {
      primary:
        'bg-plate-red font-medium text-white active:bg-plate-red-pressed active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.45)] disabled:opacity-50',
      secondary: 'border border-seam text-chalk disabled:opacity-50',
      quiet: 'border border-seam text-ash',
    },
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    },
  },
  defaultVariants: { intent: 'primary', size: 'md' },
  compoundVariants: [{ intent: 'quiet', class: 'text-sm' }],
});

export const card = tv({ base: 'rounded-md border border-seam bg-forged' });

export const eyebrow = tv({
  base: 'font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-ash',
});

export const mono = tv({ base: 'font-mono tabular-nums' });

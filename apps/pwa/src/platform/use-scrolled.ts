import { useEffect, useState } from 'react';

// Returns true once window.scrollY exceeds the threshold — used to show the header fade gradient.
export function useIsScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => { setScrolled(window.scrollY > threshold); };
    window.addEventListener('scroll', handler, { passive: true });
    handler();
    return () => { window.removeEventListener('scroll', handler); };
  }, [threshold]);
  return scrolled;
}

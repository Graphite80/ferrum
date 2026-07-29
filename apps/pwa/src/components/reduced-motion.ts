import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

// A looping figure is decoration; anyone who has asked the system to stop moving things
// gets the still frame and the scrubber instead.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const update = () => {
      setReduced(media.matches);
    };
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);

  return reduced;
}

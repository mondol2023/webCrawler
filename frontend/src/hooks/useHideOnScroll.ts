import { useEffect, useRef, useState } from 'react';

interface HideOnScrollState {
  /** True when the bar should slide out of view. */
  hidden: boolean;
  /** True once the page has scrolled at all — used to add a shadow/blur. */
  scrolled: boolean;
}

/**
 * technext.it-style navbar behaviour: the bar slides away as you scroll down
 * and snaps back the moment you scroll up, so navigation is always one flick
 * away without permanently eating vertical space.
 *
 * Reads are batched into a rAF because scroll fires far more often than the
 * browser paints.
 */
export function useHideOnScroll(threshold = 80): HideOnScrollState {
  const [state, setState] = useState<HideOnScrollState>({ hidden: false, scrolled: false });
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    lastY.current = window.scrollY;

    const evaluate = () => {
      ticking.current = false;
      const y = window.scrollY;
      const delta = y - lastY.current;

      // Ignore sub-pixel jitter and bounce at the top of the page.
      if (Math.abs(delta) < 6) return;

      setState({
        hidden: delta > 0 && y > threshold,
        scrolled: y > 4,
      });
      lastY.current = y;
    };

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(evaluate);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return state;
}

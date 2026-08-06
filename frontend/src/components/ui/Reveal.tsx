import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface RevealProps {
  children: ReactNode;
  /** Stagger index — multiplied by `step` to offset the animation. */
  index?: number;
  /** Milliseconds between staggered siblings. Kept short so lists never drag. */
  step?: number;
  /** Extra delay on top of the stagger. */
  delay?: number;
  direction?: 'up' | 'left' | 'scale';
  as?: ElementType;
  className?: string;
}

/**
 * Plays a one-shot entrance animation when the element scrolls into view.
 *
 * Uses IntersectionObserver + CSS rather than an animation library: the app has
 * no motion dependency, and a class toggle is cheaper than a React re-render
 * per frame. `once` behaviour is deliberate — re-animating on every scroll pass
 * is the thing that makes reveal effects feel cheap.
 */
export function Reveal({
  children,
  index = 0,
  step = 70,
  delay = 0,
  direction = 'up',
  as: Tag = 'div',
  className,
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  // No observer (old browser, jsdom) — show the content rather than hide it.
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const node = ref.current;
    if (!node || revealed) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      // Start slightly before the element is fully on screen.
      { threshold: 0.05, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <Tag
      ref={ref}
      className={cn(
        'reveal',
        direction === 'left' && 'reveal-left',
        direction === 'scale' && 'reveal-scale',
        revealed && 'is-revealed',
        className
      )}
      style={{ ['--reveal-delay' as string]: `${index * step + delay}ms` }}
    >
      {children}
    </Tag>
  );
}

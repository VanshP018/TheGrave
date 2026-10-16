import { motion, useReducedMotion } from 'framer-motion';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

// The Spline runtime is large: only fetched when the 3D scene will actually render.
const Spline = lazy(() => import('@splinetool/react-spline'));

export const SPLINE_SCENE = 'https://prod.spline.design/Slk6b8kz3LRlKiyk/scene.splinecode';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Static gold-glow backdrop: the fallback while the scene loads, and the whole background on phones. */
function Backdrop() {
  return (
    <div className="absolute inset-0 bg-hero-bg" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_70%_35%,rgb(212_175_55/0.16),transparent_70%)]" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #d4af37 1px, transparent 1px), linear-gradient(to bottom, #d4af37 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 60% 40%, black, transparent 75%)',
        }}
      />
    </div>
  );
}

/**
 * Full-bleed interactive 3D scene behind the hero (decision.md D-054). Rendered only on wide screens
 * without reduced motion; it fades in once loaded so there is never a blank flash.
 */
export function SplineBackground() {
  const reduceMotion = useReducedMotion();
  const wide = useMediaQuery('(min-width: 768px)');
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The Spline canvas swallows wheel events (camera zoom), which would trap the page on a full-screen hero.
  // Stopping them in the capture phase keeps them from reaching the canvas, so the browser scrolls normally.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop, { capture: true, passive: true });
    return () => el.removeEventListener('wheel', stop, { capture: true });
  }, []);

  return (
    <div ref={ref} className="absolute inset-0">
      <Backdrop />
      {wide && !reduceMotion && (
        <Suspense fallback={null}>
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: loaded ? 1 : 0 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            // The scene's accent glow is green (hue ~119°); rotating hue maps it to gold (~44°). The cubes are
            // not pure grey but faintly blue, which the same rotation would turn green, so most colour is
            // stripped first: the faint tint drops to ~0 while the saturated glow survives and is re-boosted.
            style={{ filter: 'grayscale(0.8) hue-rotate(-75deg) saturate(2.5)' }}
          >
            <Spline scene={SPLINE_SCENE} className="h-full w-full" onLoad={() => setLoaded(true)} />
          </motion.div>
        </Suspense>
      )}
    </div>
  );
}

import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

const GRID = 64;

/** The 64 px line grid in light blue at the given opacity. */
const grid = (alpha: number) => ({
  backgroundImage: `linear-gradient(to right, rgb(168 219 255 / ${alpha}) 1px, transparent 1px), linear-gradient(to bottom, rgb(168 219 255 / ${alpha}) 1px, transparent 1px)`,
  backgroundSize: `${GRID}px ${GRID}px`,
  backgroundPosition: 'center top',
});
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A random point (in % of the viewport) for a glow to drift to. */
const spot = () => ({ x: `${rand(-10, 70)}vw`, y: `${rand(-10, 60)}vh` });

/**
 * One soft blue light that wanders: every leg picks a fresh random point and a fresh duration, so the
 * path never visibly repeats. Under reduced motion it simply stays where it started.
 */
function Glow({ size, color, still }: { size: string; color: string; still: boolean }) {
  const [start] = useState(spot);
  const [target, setTarget] = useState(start);
  const [duration, setDuration] = useState(() => rand(5, 9));
  return (
    <motion.div
      className="absolute left-0 top-0 rounded-full blur-[90px] will-change-transform"
      style={{ width: size, height: size, background: color }}
      initial={start}
      animate={still ? start : { ...target, scale: rand(0.85, 1.2) }}
      transition={{ duration, ease: 'easeInOut' }}
      onAnimationComplete={() => {
        if (still) return;
        setTarget(spot());
        setDuration(rand(5, 9));
      }}
    />
  );
}

/**
 * Landing page background (decision.md D-060, D-061): the auth page's grid, half sharp and half blurred
 * under heavy shadow, with blue lights drifting randomly behind it. Fixed to the viewport so the content scrolls over it.
 */
export function GridBackground() {
  const reduceMotion = !!useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-hero-bg">
      <Glow size="44rem" color="rgb(92 184 255 / 0.42)" still={reduceMotion} />
      <Glow size="34rem" color="rgb(43 127 217 / 0.42)" still={reduceMotion} />
      <Glow size="26rem" color="rgb(168 219 255 / 0.26)" still={reduceMotion} />

      {/* The grid sits over the lights, so they show through the lines and glow in the cells. It is drawn
          twice for a depth-of-field look: crisp in a band across the upper middle, softly blurred (and a
          touch brighter, so it reads as haze) everywhere else. */}
      <div
        className="absolute inset-0"
        style={{
          ...grid(0.14),
          maskImage: 'radial-gradient(ellipse 60% 45% at 55% 35%, black 30%, transparent 75%)',
        }}
      />
      <div
        className="absolute inset-0 blur-[2.5px]"
        style={{
          ...grid(0.2),
          maskImage: 'radial-gradient(ellipse 60% 45% at 55% 35%, transparent 35%, black 80%)',
        }}
      />

      {/* Shadows: a heavy vignette, the top and bottom sinking into black, and a faint film of darkness
          over the whole grid so the lights look like they are coming from under it. */}
      <div className="absolute inset-0 bg-black/25" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_70%_at_50%_40%,transparent_30%,rgb(0_0_0/0.85))]" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/80 to-transparent" />
    </div>
  );
}

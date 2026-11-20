import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fadeUp } from '../../lib/motion';
import { useAuth } from '../../stores/auth';
import { ArrowRightIcon } from './icons';

const TAUNTS = [
  'turn their codebase into ashes.',
  'bury their rating six feet under.',
  'make their test cases fail in silence.',
  'win before they finish compiling.',
  'leave nothing but a stack trace.',
  'ship the fix before they find the bug.',
];

/** A terminal prompt that types a taunt, holds it, erases it and moves on. Static under reduced motion. */
function Taunt() {
  const reduceMotion = useReducedMotion();
  const [i, setI] = useState(0);
  const [len, setLen] = useState(0);
  const [erasing, setErasing] = useState(false);
  const text = TAUNTS[i]!;

  useEffect(() => {
    if (reduceMotion) return;
    const full = len === text.length;
    const delay = erasing ? 22 : full ? 1900 : 48;
    const t = setTimeout(() => {
      if (!erasing && full) setErasing(true);
      else if (erasing && len === 0) {
        setErasing(false);
        setI((n) => (n + 1) % TAUNTS.length);
      } else setLen((n) => n + (erasing ? -1 : 1));
    }, delay);
    return () => clearTimeout(t);
  }, [len, erasing, text, reduceMotion]);

  return (
    <p
      className="flex min-h-7 items-center gap-2 font-mono text-[clamp(0.875rem,1.4vw,1.0625rem)] text-azure-light"
      aria-label={`Battle, and ${TAUNTS[0]}`}
    >
      <span className="text-azure" aria-hidden>
        &gt;
      </span>
      <span aria-hidden>
        {reduceMotion ? TAUNTS[0] : text.slice(0, len)}
        <span className="ml-0.5 inline-block h-[1.1em] w-[0.55ch] translate-y-[0.15em] bg-azure motion-safe:animate-pulse" />
      </span>
    </p>
  );
}

// ---- Hero --------------------------------------------------------------------------------------

/** Full-screen hero. The background is not in here: it is fixed behind the whole page (see LandingPage). */
export function Hero() {
  const signedIn = useAuth((s) => s.status === 'authenticated');

  return (
    <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden px-6 pb-12 pt-32 md:px-10 md:pb-16 lg:px-16">
      {/* Shadow pooled where the copy sits; masked out at the bottom so there's no seam. */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top_right,rgb(5_5_5/0.92),rgb(5_5_5/0.3)_55%,transparent)] [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" />

      <motion.div initial="hidden" animate="show" className="relative">
        <motion.p
          variants={fadeUp}
          custom={0.1}
          className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.25em] text-ash-300 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
          Ranked 1v1 · Season 01
        </motion.p>

        {/* The wordmark spans the width; the copy splits into two columns beneath it. */}
        <motion.h1
          variants={fadeUp}
          custom={0.2}
          className="text-[clamp(3.5rem,14.5vw,13.5rem)] font-bold uppercase leading-[0.85] tracking-[-0.065em] text-ink drop-shadow-[0_10px_40px_rgb(0_0_0/0.8)]"
        >
          The
          <span className="bg-gradient-to-br from-azure-light via-azure to-azure-deep bg-clip-text text-transparent">
            grave
          </span>
        </motion.h1>

        <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:items-end lg:gap-20">
          <div>
            <motion.p
              variants={fadeUp}
              custom={0.35}
              className="text-balance text-[clamp(1.5rem,3vw,2.5rem)] font-light leading-tight text-ink/90"
            >
              Two coders. One problem. One walks away.
            </motion.p>
            <motion.div variants={fadeUp} custom={0.45} className="mt-5">
              <Taunt />
            </motion.div>
          </div>

          <div className="lg:max-w-lg lg:justify-self-end">
            <motion.p
              variants={fadeUp}
              custom={0.55}
              className="text-pretty text-[clamp(0.9375rem,1.4vw,1.125rem)] font-light leading-relaxed text-ash-300"
            >
              Race a friend or a stranger on algorithms, or fix the same broken codebase before they
              do. Matched by rating, judged in a locked-down sandbox, settled on a clock only the
              server controls.
            </motion.p>
            <motion.div
              variants={fadeUp}
              custom={0.7}
              className="mt-8 flex flex-wrap gap-3 font-semibold"
            >
              <Link
                to={signedIn ? '/play' : '/register'}
                className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-md bg-azure px-7 text-sm text-hero-bg shadow-[0_0_50px_-10px_rgb(92_184_255/0.8)] transition-all duration-200 hover:brightness-110 active:scale-[0.97]"
              >
                {signedIn ? 'Find a match' : 'Enter the arena'}
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex min-h-12 cursor-pointer items-center rounded-md bg-white/[0.05] px-7 text-sm text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-sm transition-all duration-200 hover:bg-white/[0.09] active:scale-[0.97]"
              >
                How it works
              </a>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

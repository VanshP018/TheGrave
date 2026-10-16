import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { fadeUp } from '../../lib/motion';
import { useAuth } from '../../stores/auth';
import { ArrowRightIcon } from './icons';

/**
 * Full-screen hero, content anchored bottom-left. The 3D scene is not in here: it is fixed behind the
 * whole page (see LandingPage), and the hero is transparent and pointer-events-none so the scene behind
 * it stays interactive; the CTAs opt back in.
 */
export function Hero() {
  const signedIn = useAuth((s) => s.status === 'authenticated');

  return (
    <section className="pointer-events-none relative flex min-h-[100svh] items-end overflow-hidden">
      {/* Darken toward the bottom-left where the copy sits; scrolls away with the hero. The mask fades it
          out at the bottom so there's no hard seam against the continuous scene behind the sections. */}
      <div className="absolute inset-0 bg-[linear-gradient(to_top_right,rgb(10_10_10/0.9),rgb(10_10_10/0.2)_55%,transparent)] [mask-image:linear-gradient(to_bottom,black_65%,transparent)]" />

      <motion.div
        initial="hidden"
        animate="show"
        className="pointer-events-none relative z-10 w-full max-w-[90%] px-6 pb-12 pt-32 sm:max-w-md md:px-10 md:pb-14 lg:max-w-2xl"
      >
        <motion.h1
          variants={fadeUp}
          custom={0.2}
          className="mb-2 text-[clamp(3rem,8vw,6rem)] font-bold uppercase leading-[1.05] tracking-[-0.05em] text-ink md:mb-4"
        >
          The
          <span className="bg-gradient-to-br from-gold-light via-gold to-gold-deep bg-clip-text text-transparent">
            grave
          </span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          custom={0.4}
          className="mb-3 text-balance text-[clamp(1.125rem,2.5vw,1.875rem)] font-light text-ink/85 md:mb-6"
        >
          Two coders. One problem. One walks away.
        </motion.p>

        <motion.p
          variants={fadeUp}
          custom={0.55}
          className="mb-5 text-pretty text-[clamp(0.9375rem,1.5vw,1.25rem)] font-light leading-relaxed text-ash-300 md:mb-8"
        >
          Real-time 1v1 algorithm battles. Matched by rating, judged in a locked-down sandbox,
          settled on a clock only the server controls. The first fully accepted solution wins.
        </motion.p>

        <motion.div variants={fadeUp} custom={0.7} className="flex flex-wrap gap-3 font-semibold">
          <Link
            to={signedIn ? '/play' : '/register'}
            className="pointer-events-auto inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-sm bg-gold px-6 py-3 text-sm text-hero-bg shadow-[0_0_40px_-8px_rgb(212_175_55/0.6)] transition-all duration-200 hover:brightness-110 active:scale-[0.97] md:px-8 md:py-4"
          >
            {signedIn ? 'Find a match' : 'Enter the arena'}
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <a
            href="#how"
            className="pointer-events-auto inline-flex min-h-11 cursor-pointer items-center rounded-sm bg-ink px-6 py-3 text-sm text-hero-bg transition-all duration-200 hover:brightness-90 active:scale-[0.97] md:px-8 md:py-4"
          >
            How it works
          </a>
        </motion.div>

        <motion.p
          variants={fadeUp}
          custom={0.85}
          className="mt-5 text-xs font-light text-ash-400 md:mt-6"
        >
          30 problems · Python &amp; C++ · Glicko-2 ranked
        </motion.p>
      </motion.div>
    </section>
  );
}

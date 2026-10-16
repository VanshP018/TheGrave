import { motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router';
import { EASE_OUT_EXPO } from '../../lib/motion';
import { useAuth } from '../../stores/auth';

const LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'Arena', href: '#arena' },
  { label: 'Ranked', href: '#ranked' },
];

/** Floats transparently over the hero, gains a blurred backdrop once the page scrolls. */
export function LandingNav() {
  const signedIn = useAuth((s) => s.status === 'authenticated');
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 24));

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
      className={`fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-5 transition-colors duration-300 lg:px-16 ${
        solid
          ? 'border-b border-ash-700/60 bg-hero-bg/75 backdrop-blur-md'
          : 'border-b border-transparent'
      }`}
    >
      <Link to="/" className="text-xl font-semibold tracking-tight text-ink">
        THE<span className="text-gold">GRAVE</span>
      </Link>

      <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="text-xs uppercase tracking-widest text-ash-300 transition-colors duration-200 hover:text-ink"
          >
            {l.label}
          </a>
        ))}
        <Link
          to="/leaderboard"
          className="text-xs uppercase tracking-widest text-ash-300 transition-colors duration-200 hover:text-ink"
        >
          Leaderboard
        </Link>
      </nav>

      {/* Unlike the section links, the CTA stays visible on phones: it is the only way in from the nav. */}
      <Link
        to={signedIn ? '/play' : '/login'}
        className="inline-flex min-h-11 items-center rounded-lg border border-ash-700 bg-ash-800/80 px-5 text-xs uppercase tracking-widest text-ink transition-all duration-200 hover:border-gold/50 hover:bg-ash-800 active:scale-[0.97]"
      >
        {signedIn ? 'Enter arena' : 'Sign in'}
      </Link>
    </motion.header>
  );
}

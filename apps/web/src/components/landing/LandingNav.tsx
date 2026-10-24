import { motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router';
import { EASE_OUT_EXPO } from '../../lib/motion';
import { useAuth } from '../../stores/auth';
import { NAV_ACTIONS, NAV_BRAND, NAV_LINKS, NAV_ROW, navLink } from '../nav';
import { Wordmark } from '../ui';

/** Same three destinations as the signed-in app's nav (D-079): two scroll to their section, one is a page. */
const SECTIONS = [
  { label: 'DSA', href: '#dsa' },
  { label: 'Programming', href: '#programming' },
];

/** Floats transparently over the hero, gains a blurred backdrop and a rule once the page scrolls. */
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
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
        solid
          ? 'border-ash-700/60 bg-hero-bg/75 backdrop-blur-md'
          : 'border-transparent bg-transparent'
      }`}
    >
      <div className={NAV_ROW}>
        <Wordmark className={NAV_BRAND} />

        <nav aria-label="Sections" className={NAV_LINKS}>
          {SECTIONS.map((l) => (
            <a key={l.href} href={l.href} className={navLink()}>
              {l.label}
            </a>
          ))}
          <Link to="/leaderboard" className={navLink()}>
            Leaderboard
          </Link>
        </nav>

        {/* Unlike the section links, the CTA stays visible on phones: it is the only way in from the nav. */}
        <div className={NAV_ACTIONS}>
          <Link
            to={signedIn ? '/play' : '/login'}
            className="inline-flex h-9 items-center rounded-full bg-white/[0.06] px-5 text-xs uppercase tracking-widest text-ink transition-all duration-200 hover:bg-white/[0.1] active:scale-[0.97]"
          >
            {signedIn ? 'Enter arena' : 'Sign in'}
          </Link>
        </div>
      </div>
    </motion.header>
  );
}

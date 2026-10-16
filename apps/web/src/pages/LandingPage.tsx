import { MotionConfig, motion, useScroll, useTransform } from 'framer-motion';
import { Hero } from '../components/landing/Hero';
import { LandingNav } from '../components/landing/LandingNav';
import { Arena, FinalCta, Footer, HowItWorks, Ranked } from '../components/landing/Sections';
import { SplineBackground } from '../components/landing/SplineBackground';

/**
 * Dims the fixed scene as the page scrolls: light over the hero, deeper once the reader is in the
 * sections, so text stays readable while the scene keeps moving behind it.
 */
function ScrollDim() {
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [0, window.innerHeight * 0.9], [0.3, 0.72]);
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-black"
      style={{ opacity }}
    />
  );
}

/** Public landing page (black + grey + gold, Sora). Works signed in or out; CTAs adapt. */
export default function LandingPage() {
  return (
    // reducedMotion="user": with the OS setting on, transforms are skipped and content simply fades in.
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen bg-hero-bg font-sora text-ink antialiased selection:bg-gold/30">
        {/* The scene is pinned to the viewport; everything below scrolls over it (decision.md D-055). */}
        <div className="fixed inset-0 z-0">
          <SplineBackground />
          <ScrollDim />
        </div>

        <div className="relative z-10">
          <LandingNav />
          <main>
            <Hero />
            <HowItWorks />
            <Arena />
            <Ranked />
            <FinalCta />
          </main>
          <Footer />
        </div>
      </div>
    </MotionConfig>
  );
}

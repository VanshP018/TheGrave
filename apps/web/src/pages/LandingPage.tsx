import { MotionConfig } from 'framer-motion';
import { GridBackground } from '../components/landing/GridBackground';
import { Hero } from '../components/landing/Hero';
import { LandingNav } from '../components/landing/LandingNav';
import {
  Arena,
  FinalCta,
  Footer,
  HowItWorks,
  Manifesto,
  Ranked,
} from '../components/landing/Sections';

/** Public landing page (black + grey + light blue, Sora). Works signed in or out; CTAs adapt. */
export default function LandingPage() {
  return (
    // reducedMotion="user": with the OS setting on, transforms are skipped and content simply fades in.
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-x-clip bg-hero-bg font-sora text-ink antialiased selection:bg-azure/30">
        {/* The background is pinned to the viewport; everything below scrolls over it (decision.md D-060). */}
        <div className="fixed inset-0 z-0">
          <GridBackground />
        </div>

        <div className="relative z-10">
          <LandingNav />
          <main>
            <Hero />
            <HowItWorks />
            <Arena />
            <Ranked />
            <Manifesto />
            <FinalCta />
          </main>
          <Footer />
        </div>
      </div>
    </MotionConfig>
  );
}

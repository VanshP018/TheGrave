import { motion, useInView } from 'framer-motion';
import { useRef, type ComponentType, type SVGProps } from 'react';
import { Link } from 'react-router';
import { EASE_OUT_EXPO, fadeUp, revealOnce } from '../../lib/motion';
import { useAuth } from '../../stores/auth';
import {
  ArrowRightIcon,
  ClockIcon,
  EyeOffIcon,
  PlugIcon,
  SandboxIcon,
  ScaleIcon,
  TrendIcon,
} from './icons';

function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: string;
}) {
  return (
    <motion.div {...revealOnce} variants={fadeUp} className="max-w-2xl">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-gold">{eyebrow}</p>
      <h2 className="mt-3 text-balance text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-tight tracking-[-0.03em] text-ink">
        {title}
      </h2>
      {children && (
        <p className="mt-4 text-base font-light leading-relaxed text-ash-300 md:text-lg">
          {children}
        </p>
      )}
    </motion.div>
  );
}

// ---- How it works ------------------------------------------------------------------------------

const STEPS = [
  {
    title: 'Queue',
    body: 'Matched with a player near your rating. The window starts at ±50 and widens the longer you wait.',
  },
  {
    title: 'Accept',
    body: 'Both players confirm within 10 seconds. Decline, and your opponent keeps their place in line.',
  },
  {
    title: 'Battle',
    body: 'The problem is revealed to both at once. You see their progress, never their code.',
  },
  {
    title: 'Ranked',
    body: 'Glicko-2 updates both ratings the moment the match ends, in the same transaction.',
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 px-6 py-24 md:px-10 md:py-32 lg:px-16">
      <SectionHeading eyebrow="How it works" title="From queue to verdict in one sitting." />
      {/* The list owns the in-view trigger; children inherit it through variants. (The rule starts at
          scaleX 0, a zero-width box an IntersectionObserver can't reliably see, so it can't trigger itself.) */}
      <motion.ol {...revealOnce} className="relative mt-14 grid gap-10 md:grid-cols-4 md:gap-6">
        {/* The one choreographed element here: a gold rule drawing across the steps. */}
        <motion.span
          aria-hidden
          className="absolute left-0 right-0 top-5 hidden h-px origin-left bg-gradient-to-r from-gold via-gold/40 to-transparent md:block"
          variants={{
            hidden: { scaleX: 0 },
            show: { scaleX: 1, transition: { duration: 1.2, ease: EASE_OUT_EXPO, delay: 0.2 } },
          }}
        />
        {STEPS.map((s, i) => (
          <motion.li key={s.title} variants={fadeUp} custom={0.15 * i} className="relative">
            <span className="relative z-10 grid h-10 w-10 place-items-center rounded-full border border-gold/50 bg-hero-bg text-sm font-semibold text-gold">
              {i + 1}
            </span>
            <h3 className="mt-5 text-lg font-semibold text-ink">{s.title}</h3>
            <p className="mt-2 text-sm font-light leading-relaxed text-ash-300">{s.body}</p>
          </motion.li>
        ))}
      </motion.ol>
    </section>
  );
}

// ---- Arena features ----------------------------------------------------------------------------

const FEATURES: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  {
    icon: SandboxIcon,
    title: 'A sandbox you cannot escape',
    body: 'Every submission runs in a throwaway container: no network, read-only filesystem, capped memory and processes.',
  },
  {
    icon: ScaleIcon,
    title: 'Fair to the millisecond',
    body: 'First accepted by submission time, not by which verdict came back first. Judging luck never decides a match.',
  },
  {
    icon: ClockIcon,
    title: 'One clock: the server’s',
    body: 'Start and end times live on the server and survive restarts. Your countdown is corrected for your clock’s drift.',
  },
  {
    icon: PlugIcon,
    title: 'Disconnects forgiven',
    body: 'Lose your connection and you have 30 seconds to come back. A page reload drops you right back into the fight.',
  },
  {
    icon: TrendIcon,
    title: 'Ratings that know what they don’t know',
    body: 'New players move fast, veterans move steadily, and a rating you haven’t defended slowly grows uncertain.',
  },
  {
    icon: EyeOffIcon,
    title: 'Never a problem you’ve seen',
    body: 'Battles pick a problem neither player has opened, so practice never becomes a pre-solved advantage.',
  },
];

export function Arena() {
  return (
    <section
      id="arena"
      className="scroll-mt-24 border-t border-ash-800 px-6 py-24 md:px-10 md:py-32 lg:px-16"
    >
      <SectionHeading eyebrow="The arena" title="Built so the only variable is you.">
        Everything that could make a match unfair (clocks, judging order, flaky connections, leaked
        problems) is handled by the server, not left to luck.
      </SectionHeading>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <motion.article
            key={f.title}
            {...revealOnce}
            variants={fadeUp}
            custom={0.08 * (i % 3)}
            className="group rounded-xl border border-ash-700 bg-ash-800/50 p-6 transition-colors duration-300 hover:border-gold/40 hover:bg-ash-800"
          >
            <f.icon className="h-6 w-6 text-gold transition-transform duration-300 group-hover:-translate-y-0.5" />
            <h3 className="mt-5 text-base font-semibold text-ink">{f.title}</h3>
            <p className="mt-2 text-sm font-light leading-relaxed text-ash-300">{f.body}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

// ---- Ranked: a judged submission, line by line ---------------------------------------------------

const VERDICT_LINES = [
  { text: '$ submit  python3 · sum-of-array', tone: 'text-ash-300' },
  { text: '  sample 1 ........ passed   18ms', tone: 'text-ash-300' },
  { text: '  sample 2 ........ passed   17ms', tone: 'text-ash-300' },
  { text: '  hidden 1–7 ...... passed   ≤42ms', tone: 'text-ash-300' },
  { text: '  ACCEPTED  9/9', tone: 'text-ink font-semibold' },
  { text: '  rating  1500 → 1662  (+162)', tone: 'text-gold font-semibold' },
];

function VerdictStream() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-120px' });
  return (
    <div
      ref={ref}
      className="overflow-x-auto rounded-xl border border-ash-700 bg-ash-800/70 p-5 font-mono text-[13px] leading-7 shadow-[0_0_80px_-30px_rgb(212_175_55/0.35)]"
    >
      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-widest text-ash-400">
        <span>Judge</span>
        <span>Example: a new player’s first win</span>
      </div>
      {VERDICT_LINES.map((l, i) => (
        <motion.div
          key={i}
          className={`whitespace-pre ${l.tone}`}
          initial={{ opacity: 0, x: -6 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay: 0.25 + i * 0.32 }}
        >
          {l.text}
        </motion.div>
      ))}
    </div>
  );
}

export function Ranked() {
  return (
    <section
      id="ranked"
      className="scroll-mt-24 border-t border-ash-800 px-6 py-24 md:px-10 md:py-32 lg:px-16"
    >
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <SectionHeading eyebrow="Ranked" title="Every rating starts at 1500.">
          Glicko-2 tracks not just how good you are but how sure it is. Your first games move you
          hundreds of points; by the time you are on the leaderboard, every win is earned.
        </SectionHeading>
        <motion.div {...revealOnce} variants={fadeUp} custom={0.15}>
          <VerdictStream />
        </motion.div>
      </div>
    </section>
  );
}

// ---- Closing CTA + footer ----------------------------------------------------------------------

export function FinalCta() {
  const signedIn = useAuth((s) => s.status === 'authenticated');
  return (
    <section className="border-t border-ash-800 px-6 py-24 md:px-10 md:py-32 lg:px-16">
      <motion.div
        {...revealOnce}
        variants={fadeUp}
        className="relative overflow-hidden rounded-2xl border border-gold/25 bg-ash-800/60 px-6 py-16 text-center md:px-16"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgb(212_175_55/0.14),transparent_70%)]"
        />
        <h2 className="relative text-[clamp(1.75rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-ink">
          The arena is open.
        </h2>
        <p className="relative mx-auto mt-4 max-w-lg font-light text-ash-300">
          Pick Python or C++, queue up, and find out who walks away.
        </p>
        <Link
          to={signedIn ? '/play' : '/register'}
          className="relative mt-8 inline-flex min-h-11 items-center gap-2 rounded-sm bg-gold px-8 py-4 text-sm font-semibold text-hero-bg transition-all duration-200 hover:brightness-110 active:scale-[0.97]"
        >
          {signedIn ? 'Find a match' : 'Create your account'}
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </motion.div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="flex flex-col items-center justify-between gap-3 border-t border-ash-800 px-6 py-8 text-xs text-ash-400 md:flex-row md:px-10 lg:px-16">
      <span className="font-semibold tracking-tight text-ash-300">
        THE<span className="text-gold">GRAVE</span>
      </span>
      <span>Real-time 1v1 coding battles.</span>
    </footer>
  );
}

import { animate, motion, useInView, useReducedMotion } from 'framer-motion';
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react';
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

/** Giant faded type, like the footer's wordmark. */
export const ghost =
  'select-none bg-gradient-to-b from-ash-700 to-transparent bg-clip-text font-bold text-transparent';

/** A section sits on a band of shadow that fades in and out: separation without any rule. */
export function Band({
  id,
  children,
  className = '',
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-24 px-6 py-28 md:px-10 md:py-36 lg:px-16 ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-[#050505]/85 to-transparent"
      />
      {children}
    </section>
  );
}

export function SectionHeading(props: {
  index: string;
  eyebrow: string;
  title: string;
  kicker?: string;
  children?: string;
}) {
  const { index, eyebrow, title, kicker, children } = props;
  return (
    <motion.div {...revealOnce} variants={fadeUp} className="relative max-w-2xl">
      <span
        aria-hidden
        className={`${ghost} absolute -left-1 -top-16 text-[8rem] leading-none md:-top-20 md:text-[10rem]`}
      >
        {index}
      </span>
      <p className="relative flex items-center gap-3 text-xs font-medium uppercase tracking-[0.3em] text-azure">
        <span className="h-px w-8 bg-gradient-to-r from-azure to-transparent" aria-hidden />
        {eyebrow}
      </p>
      <h2 className="relative mt-4 text-balance text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-ink">
        {title}
      </h2>
      {kicker && <p className="relative mt-3 font-mono text-sm text-azure-light/80">// {kicker}</p>}
      {children && (
        <p className="relative mt-5 text-base font-light leading-relaxed text-ash-300 md:text-lg">
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
    tag: '±50 → wider',
  },
  {
    title: 'Accept',
    body: 'Both players confirm within 10 seconds. Decline, and your opponent keeps their place in line.',
    tag: '10 s ready check',
  },
  {
    title: 'Battle',
    body: 'The problem is revealed to both at once. You see their progress, never their code.',
    tag: 'Same problem, same second',
  },
  {
    title: 'Bury',
    body: 'Glicko-2 updates both ratings the moment the match ends, in the same transaction.',
    tag: 'Rated instantly',
  },
];

export function HowItWorks() {
  return (
    <Band id="how">
      <SectionHeading
        index="05"
        eyebrow="How it works"
        title="From queue to verdict in one sitting."
        kicker="queue. accept. code. bury."
      />
      {/* A text-only sequence: each step hangs off a giant ghost numeral, no boxes. */}
      <ol className="mt-20 grid gap-x-12 gap-y-16 sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s, i) => (
          <motion.li key={s.title} {...revealOnce} variants={fadeUp} custom={0.1 * i}>
            <span
              aria-hidden
              className={`${ghost} block text-[6.5rem] leading-[0.8] tracking-tighter`}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="-mt-4 text-3xl font-semibold tracking-tight text-ink">{s.title}</h3>
            <p className="mt-4 text-[15px] font-light leading-relaxed text-ash-300">{s.body}</p>
            <p className="mt-5 font-mono text-xs text-azure">{s.tag}</p>
          </motion.li>
        ))}
      </ol>
    </Band>
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
    <Band id="arena">
      {/* Editorial split: the heading stays pinned while the guarantees scroll past it. */}
      <div className="grid gap-16 lg:grid-cols-[0.85fr_1.15fr] lg:gap-24">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <SectionHeading
            index="06"
            eyebrow="The arena"
            title="Built so the only variable is you."
            kicker="no lag to blame. no luck to thank."
          >
            Everything that could make a match unfair (clocks, judging order, flaky connections,
            leaked problems) is handled by the server, not left to luck.
          </SectionHeading>
        </div>
        <div className="grid gap-x-12 gap-y-14 sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <motion.article
              key={f.title}
              {...revealOnce}
              variants={fadeUp}
              custom={0.08 * (i % 2)}
              className="group"
            >
              <f.icon className="h-7 w-7 text-azure drop-shadow-[0_0_12px_rgb(92_184_255/0.7)] transition-transform duration-300 group-hover:-translate-y-0.5" />
              <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">{f.title}</h3>
              <p className="mt-3 text-[15px] font-light leading-relaxed text-ash-300">{f.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </Band>
  );
}

// ---- Ranked: one rating swing, told in type -----------------------------------------------------

/** Counts from `from` to `to` once it scrolls into view (jumps straight there under reduced motion). */
function CountUp({ from, to }: { from: number; to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });
  const reduceMotion = useReducedMotion();
  const [n, setN] = useState(from);
  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) return setN(to);
    const c = animate(from, to, {
      duration: 1.6,
      ease: EASE_OUT_EXPO,
      delay: 0.3,
      onUpdate: (v) => setN(Math.round(v)),
    });
    return () => c.stop();
  }, [inView, reduceMotion, from, to]);
  return <span ref={ref}>{n}</span>;
}

function RatingSwing() {
  return (
    <motion.div {...revealOnce} variants={fadeUp} custom={0.15} className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-16 -z-10 bg-[radial-gradient(ellipse_at_center,rgb(92_184_255/0.16),transparent_65%)]"
      />
      <p className="text-[11px] uppercase tracking-[0.3em] text-ash-400">
        A new player’s first win
      </p>
      <p className="mt-6 font-mono text-sm text-emerald-400">ACCEPTED · 9/9 tests · ≤42 ms</p>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-2 font-mono">
        <span className="text-3xl text-ash-400 line-through decoration-ash-600 md:text-4xl">
          1500
        </span>
        <span className="text-2xl text-ash-400" aria-hidden>
          →
        </span>
        <span className="bg-gradient-to-b from-azure-light via-azure to-azure-deep bg-clip-text text-[clamp(4.5rem,10vw,8rem)] font-bold leading-none tracking-tighter text-transparent">
          <CountUp from={1500} to={1662} />
        </span>
      </div>
      <p className="mt-2 font-mono text-xl font-semibold text-azure">+162</p>
      <p className="mt-10 font-mono text-sm text-ash-400">
        opponent <span className="text-ash-300">1500 → 1338</span> · rest in peace.
      </p>
    </motion.div>
  );
}

const RATING_FACTS = [
  { value: '1500', label: 'Where everyone starts' },
  { value: '±350', label: 'Starting uncertainty' },
  { value: '2', label: 'Global + campus' },
];

export function Ranked() {
  return (
    <Band id="ranked">
      <div className="grid items-center gap-20 lg:grid-cols-2">
        <div>
          <SectionHeading
            index="07"
            eyebrow="Ranked"
            title="Every rating starts at 1500."
            kicker="every win is carved into someone else’s rating."
          >
            Glicko-2 tracks not just how good you are but how sure it is. Your first games move you
            hundreds of points. Then climb the global board, or the one for your own school or
            college, where you only have to beat your campus.
          </SectionHeading>
          <motion.dl
            {...revealOnce}
            variants={fadeUp}
            custom={0.15}
            className="mt-12 grid grid-cols-3 gap-6"
          >
            {RATING_FACTS.map((f) => (
              <div key={f.label} className="flex flex-col-reverse">
                <dt className="mt-1 text-[11px] uppercase leading-snug tracking-[0.15em] text-ash-400">
                  {f.label}
                </dt>
                <dd className="bg-gradient-to-b from-ink to-ash-400 bg-clip-text font-mono text-2xl font-semibold text-transparent md:text-3xl">
                  {f.value}
                </dd>
              </div>
            ))}
          </motion.dl>
        </div>
        <RatingSwing />
      </div>
    </Band>
  );
}

// ---- Manifesto: the one loud moment ------------------------------------------------------------

export function Manifesto() {
  return (
    <section className="relative overflow-hidden px-6 py-32 text-center md:px-10 md:py-44 lg:px-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgb(92_184_255/0.10),transparent_70%)]"
      />
      <motion.p
        {...revealOnce}
        variants={fadeUp}
        className="text-[clamp(2.5rem,7.5vw,6.25rem)] font-bold uppercase leading-[0.95] tracking-[-0.05em] text-ink"
      >
        Every match
        <br />
        ends in a funeral.
      </motion.p>
      <motion.p
        {...revealOnce}
        variants={fadeUp}
        custom={0.2}
        className="mt-2 bg-gradient-to-b from-azure-light via-azure to-azure-deep bg-clip-text text-[clamp(2.5rem,7.5vw,6.25rem)] font-bold uppercase leading-[0.95] tracking-[-0.05em] text-transparent"
      >
        Make sure it isn’t yours.
      </motion.p>
      <motion.p
        {...revealOnce}
        variants={fadeUp}
        custom={0.35}
        className="mt-10 text-[11px] uppercase tracking-[0.4em] text-ash-400"
      >
        TheGrave · where ratings go to die
      </motion.p>
    </section>
  );
}

// ---- Closing CTA + footer ----------------------------------------------------------------------

export function FinalCta() {
  const signedIn = useAuth((s) => s.status === 'authenticated');
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-8 text-center md:px-10 lg:px-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-full bg-[radial-gradient(ellipse_50%_70%_at_50%_100%,rgb(92_184_255/0.18),transparent_70%)]"
      />
      <motion.div {...revealOnce} variants={fadeUp} className="relative">
        <span
          aria-hidden
          className={`${ghost} pointer-events-none absolute inset-x-0 -top-10 text-[clamp(7rem,24vw,20rem)] uppercase leading-none tracking-[-0.06em] opacity-50`}
        >
          1v1
        </span>
        <p className="relative pt-16 text-xs uppercase tracking-[0.3em] text-azure">Your move</p>
        <h2 className="relative mt-4 text-[clamp(2.25rem,6vw,5rem)] font-semibold tracking-[-0.04em] text-ink">
          The arena is open.
        </h2>
        <p className="relative mx-auto mt-4 max-w-lg text-lg font-light text-ash-300">
          Somebody just queued. Pick an algorithm or a broken codebase and make it their worst
          match.
        </p>
        <div className="relative mt-10 flex flex-wrap justify-center gap-3">
          <Link
            to={signedIn ? '/play' : '/register'}
            className="inline-flex min-h-12 items-center gap-2 rounded-md bg-azure px-8 text-sm font-semibold text-hero-bg shadow-[0_0_50px_-10px_rgb(92_184_255/0.8)] transition-all duration-200 hover:brightness-110 active:scale-[0.97]"
          >
            {signedIn ? 'Find a match' : 'Create your account'}
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <Link
            to="/leaderboard"
            className="inline-flex min-h-12 items-center rounded-md bg-white/[0.05] px-8 text-sm font-semibold text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] transition-all duration-200 hover:bg-white/[0.09] active:scale-[0.97]"
          >
            See who’s on top
          </Link>
        </div>
      </motion.div>
    </section>
  );
}

const FOOTER_LINKS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '#how' },
      { label: 'DSA battles', href: '#dsa' },
      { label: 'Programming', href: '#programming' },
      { label: 'AI coach', href: '#coach' },
      { label: 'Leaderboard', href: '/leaderboard' },
    ],
  },
  {
    title: 'Play',
    links: [
      { label: 'Find a match', href: '/play' },
      { label: 'Create an account', href: '/register' },
      { label: 'Log in', href: '/login' },
    ],
  },
];

const STACK = [
  'Python, C++17 & Node.js',
  'Docker-sandboxed judge',
  'Glicko-2 ratings',
  'Claude-powered hint coach',
];

const footLink =
  'text-sm text-ash-300 transition-colors duration-200 hover:text-azure focus-visible:text-azure focus-visible:outline-none';

/** Closing footer: solid dark, a soft fade instead of a rule, link columns and an oversized wordmark. */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-32 bg-[#050505]">
      {/* Fades up into the page instead of a hard line. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-64 h-64 bg-gradient-to-b from-transparent via-[#050505]/60 to-[#050505]"
      />

      <div className="relative px-6 pb-10 pt-20 md:px-10 md:pt-24 lg:px-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <Link to="/" className="text-2xl font-bold tracking-tight text-ink">
              THE<span className="text-azure">GRAVE</span>
            </Link>
            <p className="mt-4 text-sm font-light leading-relaxed text-ash-300">
              Real-time 1v1 battles on algorithms and broken codebases. Two coders, one clock the
              server controls. The first full pass wins.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-ash-800/80 px-3 py-1.5 text-xs text-ash-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              The arena is open
            </p>
          </div>

          {FOOTER_LINKS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ash-400">
                {col.title}
              </p>
              <ul className="mt-5 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.href.startsWith('#') ? (
                      <a href={l.href} className={footLink}>
                        {l.label}
                      </a>
                    ) : (
                      <Link to={l.href} className={footLink}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ash-400">
              Under the hood
            </p>
            <ul className="mt-5 space-y-3">
              {STACK.map((s) => (
                <li key={s} className="text-sm text-ash-300">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Oversized wordmark, fading into the floor. */}
        <p
          aria-hidden
          className="mt-20 select-none bg-gradient-to-b from-ash-700 to-transparent bg-clip-text text-center text-[clamp(4rem,17vw,16rem)] font-bold uppercase leading-[0.8] tracking-[-0.06em] text-transparent"
        >
          The
          <span className="bg-gradient-to-b from-azure/40 to-transparent bg-clip-text">grave</span>
        </p>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 text-xs text-ash-400 md:flex-row">
          <span>© {year} TheGrave. All rights reserved.</span>
          <span>Built for people who like a clock in their face.</span>
        </div>
      </div>
    </footer>
  );
}

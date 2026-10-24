import { motion } from 'framer-motion';
import { fadeUp, revealOnce } from '../../lib/motion';
import { Band, ghost, SectionHeading } from './Sections';

// The platform's four ways to play (decision.md D-079), told in type: no boxes, one language with the rest
// of the page (ghost numerals, mono kickers, thin rules).

/** A short rule, a title and a line of body: the unit of every list in these sections. */
function Point({ title, body, i = 0 }: { title: string; body: string; i?: number }) {
  return (
    <motion.li {...revealOnce} variants={fadeUp} custom={0.08 * (i % 2)} className="list-none">
      <span aria-hidden className="block h-px w-8 bg-gradient-to-r from-azure to-transparent" />
      <h3 className="mt-4 text-lg font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-2 text-[15px] font-light leading-relaxed text-ash-300">{body}</p>
    </motion.li>
  );
}

// ---- DSA ---------------------------------------------------------------------------------------

const DSA_POINTS = [
  {
    title: '30 problems, easy to hard',
    body: 'From array basics to graphs and dynamic programming. A battle picks one neither of you has opened, so nobody walks in having solved it.',
  },
  {
    title: 'Python or C++',
    body: 'Write in the language you think in. Time limits are scaled per language, so Python is never punished for being Python.',
  },
  {
    title: 'Judged in a sandbox',
    body: 'Every submission runs in a throwaway container with no network and capped memory. Each hidden test spins, then flips to pass or fail.',
  },
  {
    title: 'Won by the clock',
    body: 'The first fully accepted solution wins, ordered by when it was submitted, not when the verdict came back. Time up? Most tests passed.',
  },
];

export function DsaMode() {
  return (
    <Band id="dsa">
      <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
        <SectionHeading
          index="01"
          eyebrow="DSA battles"
          title="Algorithms, head to head."
          kicker="same problem. same second. one verdict."
        >
          Two players get the same problem the moment the countdown ends. Run against the examples,
          then submit to the hidden tests, with the opponent’s progress ticking beside yours but
          never their code.
        </SectionHeading>
        <ul className="grid gap-x-12 gap-y-12 sm:grid-cols-2">
          {DSA_POINTS.map((p, i) => (
            <Point key={p.title} {...p} i={i} />
          ))}
        </ul>
      </div>
    </Band>
  );
}

// ---- Programming ----------------------------------------------------------------------------------

const TICKETS = [
  {
    who: '#4411 · Warehouse',
    text: '“We had 3 laptop stands on the shelf and 5 customers got order confirmations.”',
  },
  {
    who: '#4420 · Alert',
    text: '“Checkouts are being cancelled while customers are still typing their card number.”',
  },
  {
    who: '#4431 · Security',
    text: '“I can read other people’s orders just by changing the id in the URL.”',
  },
];

const WORKSPACE = [
  ['File explorer', 'A real project tree: docs, services, tests.'],
  ['Tabbed editor', 'Find and replace, multi-cursor, one history per file.'],
  ['A real terminal', 'Run the demo, the tests, anything, in the same sandbox.'],
  ['Hidden tests', 'Submit when you think it’s fixed. The suite decides.'],
] as const;

export function ProgrammingMode() {
  return (
    <Band id="programming">
      <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
        <SectionHeading
          index="02"
          eyebrow="Programming"
          title="Debug a real codebase."
          kicker="the bug reports are real. the fix is yours."
        >
          Five projects, up to two dozen files each, with bugs planted in them. You don’t get a
          problem statement, you get what a team would: the tickets that came in this week.
        </SectionHeading>

        {/* The incident queue: what the player actually reads. */}
        <motion.ol
          {...revealOnce}
          variants={fadeUp}
          custom={0.1}
          className="space-y-7 border-l border-ash-700/70 pl-7"
          aria-label="Example incident reports"
        >
          {TICKETS.map((t) => (
            <li key={t.who}>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-azure/80">{t.who}</p>
              <p className="mt-2 text-lg font-light leading-snug text-ink/90">{t.text}</p>
            </li>
          ))}
        </motion.ol>
      </div>

      <dl className="mt-20 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {WORKSPACE.map(([term, def], i) => (
          <motion.div key={term} {...revealOnce} variants={fadeUp} custom={0.08 * i}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ash-400">
              {term}
            </dt>
            <dd className="mt-2 text-[15px] font-light leading-relaxed text-ash-300">{def}</dd>
          </motion.div>
        ))}
      </dl>
      <p className="mt-10 font-mono text-xs text-ash-600">
        Python · Node.js · easy to hard · ranked battles on the same codebase
      </p>
    </Band>
  );
}

// ---- The coach --------------------------------------------------------------------------------------

const CHAT = [
  { who: 'You', text: 'Where should I start looking?' },
  {
    who: 'Coach',
    text: 'Reproduce the first ticket with the demo, then compare what you see with the rules in docs/.',
  },
  { who: 'You', text: 'Is it the inventory file? Just tell me the line.' },
  {
    who: 'Coach',
    text: 'Not that one. But what does available() return right after an order is placed?',
  },
];

const COACH_RULES = [
  'Only about the challenge you’re on',
  'Short nudges, never the fix',
  'Switched off during battles',
];

export function CoachMode() {
  return (
    <Band id="coach">
      <div className="grid items-center gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
        <div>
          <SectionHeading
            index="03"
            eyebrow="AI coach"
            title="Stuck? Ask the coach."
            kicker="hints, never answers."
          >
            Every practice challenge has a coach that has read the tickets and your code. It points
            you toward the cause and holds back the fix, so the lightbulb is still yours.
          </SectionHeading>
          <ul className="mt-8 space-y-2 font-mono text-sm text-ash-300">
            {COACH_RULES.map((r) => (
              <li key={r} className="flex items-center gap-3">
                <span aria-hidden className="h-1 w-1 rounded-full bg-azure" />
                {r}
              </li>
            ))}
          </ul>
        </div>

        <motion.div
          {...revealOnce}
          variants={fadeUp}
          custom={0.1}
          className="space-y-6"
          role="group"
          aria-label="An example conversation with the coach"
        >
          {CHAT.map((m, i) => (
            <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-4">
              <p
                className={`pt-1 font-mono text-[11px] uppercase tracking-[0.2em] ${
                  m.who === 'Coach' ? 'text-azure' : 'text-ash-400'
                }`}
              >
                {m.who}
              </p>
              <p
                className={`text-lg leading-snug ${
                  m.who === 'Coach' ? 'font-normal text-ink' : 'font-light text-ash-300'
                }`}
              >
                {m.text}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </Band>
  );
}

// ---- Rooms -------------------------------------------------------------------------------------------

const ROOM_STEPS = [
  'Create a room and share its six-character code, or just the invite link.',
  'Your friend joins and readies up. You pick DSA or Programming, and the difficulty.',
  'It’s a friendly match: it never moves anyone’s rating.',
];

export function RoomsMode() {
  return (
    <Band id="rooms">
      <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-24">
        {/* The code as the page's hero object. */}
        <motion.div {...revealOnce} variants={fadeUp} className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-10 -z-10 bg-[radial-gradient(ellipse_at_center,rgb(92_184_255/0.12),transparent_65%)]"
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ash-400">
            Room code
          </p>
          <p
            className="mt-3 bg-gradient-to-b from-ink via-azure-light to-azure/70 bg-clip-text font-mono text-[clamp(3rem,9vw,6.5rem)] font-bold leading-none tracking-[0.12em] text-transparent"
            aria-label="Example room code: X F 5 A A C"
          >
            XF5AAC
          </p>
          <span
            aria-hidden
            className={`${ghost} mt-2 block text-[clamp(2rem,6vw,4rem)] leading-none`}
          >
            VS
          </span>
        </motion.div>

        <div>
          <SectionHeading
            index="04"
            eyebrow="Private rooms"
            title="Bring a friend."
            kicker="a code, a link, a private match."
          />
          <ol className="mt-10 space-y-5">
            {ROOM_STEPS.map((s, i) => (
              <motion.li
                key={s}
                {...revealOnce}
                variants={fadeUp}
                custom={0.08 * i}
                className="grid grid-cols-[2rem_1fr] gap-3 text-[15px] font-light leading-relaxed text-ash-300"
              >
                <span className="font-mono text-xs text-azure">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {s}
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </Band>
  );
}

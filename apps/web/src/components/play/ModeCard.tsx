import type { ReactNode } from 'react';
import { focusRing } from '../ui';

/** Which line art sits behind the card, like the court markings on a scoreboard. */
export type Art = 'arena' | 'rooms' | 'code' | 'pair';

/** Faint white line art, big and cropped by the card edge. */
function CardArt({ kind, className = '' }: { kind: Art; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 320 220"
      fill="none"
      stroke="rgb(255 255 255 / 0.13)"
      strokeWidth="3"
      strokeLinecap="round"
      className={`pointer-events-none absolute ${className}`}
    >
      {kind === 'arena' ? (
        <>
          <circle cx="170" cy="110" r="100" />
          <circle cx="170" cy="110" r="58" />
          <circle cx="170" cy="110" r="10" fill="rgb(255 255 255 / 0.13)" />
          <path d="M170 0v220M20 110h300" />
          <path d="M320 40h-60v140h60" />
        </>
      ) : kind === 'code' ? (
        <>
          <path d="M120 50 40 110l80 60M220 50l80 60-80 60" />
          <path d="M190 30 150 190" />
          <path d="M20 205h140M200 205h100" />
        </>
      ) : kind === 'pair' ? (
        <>
          <rect x="20" y="25" width="140" height="170" rx="18" />
          <rect x="175" y="25" width="140" height="170" rx="18" />
          <path d="M45 65h60M45 95h90M45 125h40M200 65h90M200 95h50M200 125h80" />
          <path d="M160 110h15" />
        </>
      ) : (
        <>
          <rect x="30" y="30" width="150" height="150" rx="26" />
          <rect x="140" y="60" width="150" height="150" rx="26" />
          <path d="M105 105h0M215 135h0" strokeWidth="14" />
          <path d="M170 0v30M170 190v30" />
        </>
      )}
    </svg>
  );
}

const TONES = {
  // The action you came here for: azure, the site accent.
  azure: {
    card: 'bg-gradient-to-br from-[#2b7fd9] via-[#1d5a9e] to-[#0e2f52] shadow-[inset_0_0_0_1px_rgb(168_219_255/0.3),0_24px_50px_-28px_rgb(43_127_217/0.8)] enabled:hover:shadow-[inset_0_0_0_1px_rgb(168_219_255/0.55),0_28px_60px_-26px_rgb(92_184_255/0.8)]',
    badge: 'bg-white/15 text-white ring-1 ring-inset ring-white/30',
    sub: 'text-white/75',
  },
  // Programming's primary: emerald, so the debugging page reads as its own place.
  emerald: {
    card: 'bg-gradient-to-br from-[#2f9e6e] via-[#1f6b4c] to-[#0c2e22] shadow-[inset_0_0_0_1px_rgb(134_239_172/0.3),0_24px_50px_-28px_rgb(47_158_110/0.8)] enabled:hover:shadow-[inset_0_0_0_1px_rgb(134_239_172/0.55),0_28px_60px_-26px_rgb(52_211_153/0.7)]',
    badge: 'bg-white/15 text-white ring-1 ring-inset ring-white/30',
    sub: 'text-white/75',
  },
  // Programming's second action: deep forest slate.
  forest: {
    card: 'bg-gradient-to-br from-[#1f2f2a] via-[#141d1a] to-[#0a0e0d] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_24px_50px_-30px_rgb(0_0_0)] enabled:hover:shadow-[inset_0_0_0_1px_rgb(52_211_153/0.5),0_28px_60px_-28px_rgb(52_211_153/0.3)]',
    badge: 'bg-white/[0.08] text-emerald-300 ring-1 ring-inset ring-white/15',
    sub: 'text-ash-300',
  },
  // The second action: graphite with an azure edge, so the pair reads as one family.
  graphite: {
    card: 'bg-gradient-to-br from-[#26303b] via-[#171d24] to-[#0c0f13] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_24px_50px_-30px_rgb(0_0_0)] enabled:hover:shadow-[inset_0_0_0_1px_rgb(92_184_255/0.5),0_28px_60px_-28px_rgb(92_184_255/0.35)]',
    badge: 'bg-white/[0.08] text-azure-light ring-1 ring-inset ring-white/15',
    sub: 'text-ash-300',
  },
} as const;

/**
 * One of the two big actions on a play page. The whole card is the button (the title's `::after` stretches
 * over it, so the accessible name is just `title`); anything in `footer` sits above it and stays clickable
 * on its own: a language picker, a code field, a cancel button.
 */
export function ModeCard(props: {
  tone: keyof typeof TONES;
  art: Art;
  /** Top-left pill, e.g. the connection state. */
  pill: ReactNode;
  /** Top-right label. */
  tag: string;
  title: string;
  subtitle: string;
  footer?: ReactNode;
  /** Replaces the title block with live content (a room, a match to accept) inside the same card. */
  body?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  const { tone, art, pill, tag, title, subtitle, footer, body, onClick, disabled, hint } = props;
  const t = TONES[tone];
  return (
    <div
      className={`group relative isolate flex min-h-60 flex-col overflow-hidden rounded-2xl p-5 transition-all duration-300 sm:p-6 ${t.card} ${
        body
          ? ''
          : disabled
            ? 'opacity-60'
            : 'hover:-translate-y-0.5 has-[button:active]:scale-[0.99]'
      }`}
      data-disabled={disabled || undefined}
    >
      <CardArt
        kind={art}
        className="-bottom-8 -right-10 h-[115%] w-auto transition-transform duration-500 group-hover:scale-105"
      />
      <div className="relative flex items-start justify-between gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${t.badge}`}
        >
          {pill}
        </span>
        <span className={`pt-1 text-sm ${t.sub}`}>{tag}</span>
      </div>

      {body ? (
        <div className="relative mt-auto pt-6">{body}</div>
      ) : (
        <div className="relative mt-auto pt-8">
          <h2 className="text-[clamp(1.9rem,4vw,2.6rem)] font-bold uppercase leading-none tracking-tight text-white">
            <button
              type="button"
              onClick={onClick}
              disabled={disabled}
              title={hint}
              className={`cursor-pointer text-left uppercase after:absolute after:inset-0 after:content-[''] disabled:cursor-not-allowed ${focusRing} after:rounded-2xl`}
            >
              {title}
            </button>
          </h2>
          <p className={`mt-2 text-sm ${t.sub}`}>{subtitle}</p>
          {footer && <div className="relative z-10 mt-4">{footer}</div>}
        </div>
      )}
    </div>
  );
}

/** A pulsing dot: says "listening", and holds still under reduced motion. */
export function Dot({ on = true, ping = false }: { on?: boolean; ping?: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {ping && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 motion-safe:animate-ping" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-amber-300'}`}
      />
    </span>
  );
}

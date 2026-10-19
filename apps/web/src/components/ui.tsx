import type { ReactNode } from 'react';
import { Link } from 'react-router';

/*
 * The app's shared look (black + grey + light blue, decision.md D-056/D-059). Plain class strings rather than a
 * component library: these are the only button/card/input styles the app has.
 */

export const btnPrimary =
  'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-sm bg-azure px-5 text-sm font-semibold text-hero-bg shadow-[0_0_32px_-10px_rgb(92_184_255/0.6)] transition-all duration-200 hover:brightness-110 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100 disabled:active:scale-100';

export const btnSecondary =
  'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-sm border border-ash-600 px-4 text-sm text-ink transition-colors duration-200 hover:border-azure/50 hover:bg-ash-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-ash-600 disabled:hover:bg-transparent';

export const card = 'rounded-xl border border-ash-700 bg-ash-900';

export const input =
  'w-full rounded-sm border border-ash-600 bg-ash-900 px-3 py-2.5 text-ink outline-none transition-colors duration-200 placeholder:text-ash-400 focus:border-azure focus:ring-2 focus:ring-azure/20';

export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-azure/60 focus-visible:ring-offset-2 focus-visible:ring-offset-hero-bg';

export function Wordmark({ to = '/', className = '' }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={`font-semibold tracking-tight text-ink ${focusRing} ${className}`}>
      THE<span className="text-azure">GRAVE</span>
    </Link>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">{children}</p>;
}

/** Page title block used by every signed-in page. */
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-2 text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-tight tracking-[-0.03em] text-ink">
        {title}
      </h1>
      {children && <div className="mt-2 text-sm font-light text-ash-300">{children}</div>}
    </div>
  );
}

/**
 * A quieter, static version of the landing page's grid + blue glow, with no moving lights: the app's pages are
 * for focus (D-056). `fixed` pins it behind scrolling pages; otherwise it fills its positioned parent.
 */
export function GlowBackdrop({
  fixed = false,
  className = '',
}: {
  fixed?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none inset-0 ${fixed ? 'fixed' : 'absolute'} ${className}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_70%_0%,rgb(92_184_255/0.12),transparent_70%)]" />
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #5cb8ff 1px, transparent 1px), linear-gradient(to bottom, #5cb8ff 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 60% 0%, black, transparent 75%)',
        }}
      />
    </div>
  );
}

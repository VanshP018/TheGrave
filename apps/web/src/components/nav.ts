import { focusRing } from './ui';

/**
 * One set of navbar measurements for the landing page and the signed-in app (decision.md D-079), so the two
 * can't drift apart again: same height, same side padding, same brand size, and the same three-column
 * layout on desktop (brand far left, links centred on the page, actions far right).
 */
export const NAV_ROW =
  'flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 sm:px-6 lg:px-16 md:grid md:h-16 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-y-0 md:py-0';

export const NAV_BRAND = 'text-xl md:justify-self-start';

/** The centred link group; drops to its own full-width row on phones. */
export const NAV_LINKS =
  'order-last flex w-full justify-center gap-x-6 md:order-none md:w-auto md:gap-x-9';

export const NAV_ACTIONS = 'ml-auto flex items-center gap-4 md:ml-0 md:justify-self-end';

const linkBase = `relative flex h-10 items-center text-xs uppercase tracking-widest transition-colors duration-200 md:h-16 ${focusRing}`;

/** A section link; the active underline sits on the header's bottom edge, whatever the row height. */
export const navLink = (active = false) =>
  `${linkBase} ${
    active
      ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-azure'
      : 'text-ash-300 hover:text-ink'
  }`;

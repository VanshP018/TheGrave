import type { Transition, Variants } from 'framer-motion';

/** Expo-out: fast start, long soft landing. The landing page's single easing curve. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/** Fade up 20px while un-blurring. `custom` is the delay in seconds, for staggers. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20, filter: 'blur(4px)' },
  show: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.7, ease: EASE_OUT_EXPO, delay } satisfies Transition,
  }),
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: (delay: number = 0) => ({
    opacity: 1,
    transition: { duration: 0.5, ease: 'easeOut', delay },
  }),
};

/** Scroll-reveal: animate once, a little before the element is fully on screen. */
export const revealOnce = {
  initial: 'hidden',
  whileInView: 'show',
  viewport: { once: true, margin: '-80px' },
} as const;

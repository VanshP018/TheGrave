import type { Verdict } from '@thegrave/shared';

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong answer',
  TLE: 'Time limit exceeded',
  MLE: 'Memory limit exceeded',
  RUNTIME_ERROR: 'Runtime error',
  COMPILE_ERROR: 'Compile error',
};

/** Verdicts are status: green for accepted, red for anything else (always next to the text label). */
export const verdictTone = (v: Verdict | null | undefined) =>
  v === 'ACCEPTED' ? 'text-emerald-400' : v ? 'text-red-400' : 'text-ash-300';

export const ago = (ms: number, now: number) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
};

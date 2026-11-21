import type { Config } from '../config.js';

type KeyEnv = Pick<Config, 'INTERVIEW_GROQ_API_KEY' | 'GROQ_API_KEY' | 'INTERVIEW_MODEL'>;

/**
 * The Groq key interviews use: INTERVIEW_GROQ_API_KEY (an optional override, e.g. a separate Groq org) or else
 * the hint coach's GROQ_API_KEY, so production needs no new secret. Empty strings (compose passes unset values
 * that way) count as unset.
 */
export function interviewGroqKey(env: Pick<KeyEnv, 'INTERVIEW_GROQ_API_KEY' | 'GROQ_API_KEY'>) {
  return env.INTERVIEW_GROQ_API_KEY || env.GROQ_API_KEY || undefined;
}

/** Interviews are on when a Groq key is available, or INTERVIEW_MODEL=fake (tests and local dev). */
export function interviewsEnabled(env: KeyEnv): boolean {
  return env.INTERVIEW_MODEL === 'fake' || interviewGroqKey(env) !== undefined;
}

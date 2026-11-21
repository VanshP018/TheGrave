import { afterAll, describe, expect, it } from 'vitest';
import { redis } from '../src/lib/redis.js';
import { TIER_PROFILES } from '../src/interviews/budget.js';
import { createInterviewLlm } from '../src/interviews/create-llm.js';
import { interviewGroqKey, interviewsEnabled } from '../src/interviews/enabled.js';

afterAll(() => redis.quit());

const base = {
  INTERVIEW_GROQ_API_KEY: undefined,
  GROQ_API_KEY: undefined,
  INTERVIEW_MODEL: 'openai/gpt-oss-120b',
};

describe('interview Groq key resolution', () => {
  it('is enabled with only the hint coach GROQ_API_KEY, so no new secret is needed', () => {
    expect(interviewsEnabled({ ...base, GROQ_API_KEY: 'gsk_coach' })).toBe(true);
    expect(interviewGroqKey({ ...base, GROQ_API_KEY: 'gsk_coach' })).toBe('gsk_coach');
  });

  it('prefers INTERVIEW_GROQ_API_KEY when set, and treats empty strings as unset', () => {
    const both = { ...base, GROQ_API_KEY: 'gsk_coach', INTERVIEW_GROQ_API_KEY: 'gsk_own' };
    expect(interviewGroqKey(both)).toBe('gsk_own');
    expect(
      interviewGroqKey({ ...base, GROQ_API_KEY: 'gsk_coach', INTERVIEW_GROQ_API_KEY: '' }),
    ).toBe('gsk_coach');
    expect(interviewsEnabled({ ...base, GROQ_API_KEY: '' })).toBe(false);
  });

  it('is disabled without any key, enabled for INTERVIEW_MODEL=fake', () => {
    expect(interviewsEnabled(base)).toBe(false);
    expect(interviewsEnabled({ ...base, INTERVIEW_MODEL: 'fake' })).toBe(true);
  });

  it('createInterviewLlm builds a Groq LLM from GROQ_API_KEY alone and null without a key', () => {
    const env = {
      ...base,
      INTERVIEW_TRIAGE_MODEL: 'openai/gpt-oss-20b',
      INTERVIEW_CRITIQUE_MODEL: 'openai/gpt-oss-20b',
      INTERVIEW_JSON_MODE: 'auto' as const,
      GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
    };
    expect(
      createInterviewLlm({ ...env, GROQ_API_KEY: 'gsk_coach' }, TIER_PROFILES.developer),
    ).not.toBeNull();
    expect(createInterviewLlm(env, TIER_PROFILES.developer)).toBeNull();
  });
});

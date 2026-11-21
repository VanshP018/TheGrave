/** Secret redaction (plan.md 6.4). Line count and line numbers are never changed. */
export const REDACTED = '[REDACTED]';

const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{60,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bgsk_[A-Za-z0-9]{20,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9]{32,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g,
];

const URL_CREDENTIALS = /(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g;
const ASSIGNMENT =
  /\b(api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|client[_-]?secret)\b(\s*[:=]\s*)(['"])([^'"\n]{8,})\3/gi;
const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;

export function redactSecrets(input: string): { text: string; redactions: number } {
  let redactions = 0;
  const count = () => {
    redactions++;
    return REDACTED;
  };

  // Private key blocks first: every inner line becomes [REDACTED], markers stay.
  const lines = input.split('\n');
  let inKey = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inKey && PRIVATE_KEY_BEGIN.test(line)) {
      inKey = true;
      redactions++;
      continue;
    }
    if (inKey) {
      if (PRIVATE_KEY_END.test(line)) inKey = false;
      else lines[i] = REDACTED;
    }
  }
  let text = lines.join('\n');

  for (const re of TOKEN_PATTERNS) text = text.replace(re, count);
  text = text.replace(URL_CREDENTIALS, (_m, scheme: string) => `${scheme}${count()}@`);
  text = text.replace(ASSIGNMENT, (m, key: string, sep: string, q: string, value: string) =>
    value === REDACTED ? m : `${key}${sep}${q}${count()}${q}`,
  );
  return { text, redactions };
}

import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets } from '../src/interviews/redact.js';

// Built by concatenation so secret scanners stay quiet.
const secrets: [string, string][] = [
  ['AWS access key', 'AKIA' + 'IOSFODNN7EXAMPLE'],
  ['AWS temporary key', 'ASIA' + 'IOSFODNN7EXAMPLE'],
  ['GitHub token', 'ghp_' + 'a'.repeat(36)],
  ['GitHub fine-grained', 'github_pat_' + 'A1'.repeat(35)],
  ['Slack token', 'xoxb-' + '1234567890-abcdef'],
  ['Stripe key', 'sk_live_' + 'a1b2c3d4e5f6g7h8i9'],
  ['Groq key', 'gsk_' + 'Ab12'.repeat(8)],
  ['Anthropic key', 'sk-ant-' + 'api03-abcdefghij1234567890'],
  ['OpenAI key', 'sk-' + 'A1b2'.repeat(10)],
  ['Google key', 'AIza' + 'Sy'.repeat(17) + 'x'],
  ['JWT', 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkw' + '.' + 'abcdefghijklmnop'],
];

describe('redactSecrets', () => {
  it.each(secrets)('redacts a %s', (_name, secret) => {
    const r = redactSecrets(`line one\nuse ${secret} here\nline three`);
    expect(r.text).not.toContain(secret);
    expect(r.text).toContain(REDACTED);
    expect(r.redactions).toBe(1);
  });

  it('redacts private key blocks line by line and keeps the line count', () => {
    const src = [
      'before',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEpAIBAAKCAQEA1234',
      'abcdefghijklmnop',
      '-----END RSA PRIVATE KEY-----',
      'after',
    ].join('\n');
    const r = redactSecrets(src);
    expect(r.text.split('\n')).toHaveLength(6);
    expect(r.text).not.toContain('MIIEpAIBAAKCAQEA1234');
    expect(r.text).toContain('-----BEGIN RSA PRIVATE KEY-----');
    expect(r.text.split('\n')[2]).toBe(REDACTED);
    expect(r.redactions).toBe(1);
  });

  it('redacts credentials in URLs and quoted assignments', () => {
    const r = redactSecrets(
      'const u = "postgres://app:hunter2hunter2@db:5432/x";\nconst password = "correct-horse-battery";\napi_key: \'abcdefgh12345678\'',
    );
    expect(r.text).toContain('postgres://[REDACTED]@db:5432/x');
    expect(r.text).toContain(`password = "${REDACTED}"`);
    expect(r.text).toContain(`api_key: '${REDACTED}'`);
    expect(r.text).not.toContain('hunter2');
    expect(r.text).not.toContain('correct-horse');
    expect(r.redactions).toBe(3);
  });

  it('keeps line count and does not touch ordinary code', () => {
    const code = [
      'const token = getToken();',
      'password: z.string(),',
      'const secret = process.env.SECRET;',
      'const short = { token: "abc" };',
      'if (a && b) { go(); }',
    ].join('\n');
    const r = redactSecrets(code);
    expect(r.text).toBe(code);
    expect(r.redactions).toBe(0);
  });

  it('never changes the number of lines and is idempotent', () => {
    const src = `a\nconst token = "abcdefghijkl"\n${'AKIA' + 'IOSFODNN7EXAMPLE'}\nb`;
    const once = redactSecrets(src);
    expect(once.text.split('\n')).toHaveLength(4);
    expect(redactSecrets(once.text)).toEqual({ text: once.text, redactions: 0 });
  });
});

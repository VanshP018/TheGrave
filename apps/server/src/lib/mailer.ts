import { createTransport } from 'nodemailer';
import { config } from '../config.js';
import { redis } from './redis.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport = createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });

  async send(msg: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: config.MAIL_FROM, ...msg });
  }
}

/** Development without SMTP: the code shows up in the server console. Never used in production. */
export class ConsoleMailer implements Mailer {
  async send(msg: MailMessage): Promise<void> {
    const bar = '='.repeat(60);
    console.log(
      `\n${bar}\n[mail] no SMTP_HOST set, not sending. Message below.\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n${bar}\n`,
    );
  }
}

export const OUTBOX_KEY = 'test:outbox';

/** NODE_ENV=test: tests (vitest and Playwright) read the code from this Redis list, newest first. */
export class OutboxMailer implements Mailer {
  async send(msg: MailMessage): Promise<void> {
    const entry = JSON.stringify({
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      at: Date.now(),
    });
    await redis.multi().lpush(OUTBOX_KEY, entry).ltrim(OUTBOX_KEY, 0, 199).exec();
  }
}

export function createMailer(): Mailer {
  if (config.NODE_ENV === 'test') return new OutboxMailer();
  if (config.SMTP_HOST) return new SmtpMailer();
  return new ConsoleMailer();
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The registration code email (decision.md D-076). */
export function verificationEmail(to: string, username: string, code: string): MailMessage {
  const ttl = '10 minutes';
  const text = `Hi ${username},

Your TheGrave verification code is: ${code}

It expires in ${ttl}.

If you didn't request this, ignore this email.`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0b0b0f;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e5e5ea;">
  <div style="max-width:420px;margin:0 auto;padding:28px;background:#14141a;border:1px solid #26262e;border-radius:8px;">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#8a8a96;">TheGrave</p>
    <p style="margin:0 0 20px;font-size:16px;">Hi ${escapeHtml(username)}, here is your verification code:</p>
    <p style="margin:0 0 20px;padding:16px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:.35em;color:#ffffff;background:#0b0b0f;border-radius:6px;">${code}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#b4b4be;">This code expires in ${ttl}.</p>
    <p style="margin:0;font-size:13px;color:#8a8a96;">If you didn't request this, ignore this email.</p>
  </div>
</body></html>`;
  return { to, subject: 'Your TheGrave verification code', text, html };
}

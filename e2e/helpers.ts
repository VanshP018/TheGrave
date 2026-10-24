import { expect, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';

/** The newest 6-digit code emailed to an address, read from the backend's test outbox. */
export async function emailedCode(email: string): Promise<string> {
  const redis = new Redis(E2E_REDIS_URL);
  try {
    for (let i = 0; i < 50; i++) {
      for (const raw of await redis.lrange('test:outbox', 0, -1)) {
        const msg = JSON.parse(raw) as { to: string; text: string };
        if (msg.to === email) return /\b(\d{6})\b/.exec(msg.text)![1]!;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    redis.disconnect();
  }
  throw new Error(`No email for ${email} arrived in the outbox`);
}

/** Fills the registration form and submits it, stopping at the "Check your email" step. */
export async function startRegistrationViaUi(
  page: Page,
  username: string,
  opts: { institution?: string } = {},
) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@e2e.test`);
  await page.getByLabel('School / College').fill(opts.institution ?? 'Grave Academy');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

/** Registers through the UI, including the emailed code, and returns once the user is signed in. */
export async function registerViaUi(
  page: Page,
  username: string,
  opts: { institution?: string } = {},
) {
  await startRegistrationViaUi(page, username, opts);
  const code = await emailedCode(`${username}@e2e.test`);
  await page.getByLabel('Digit 1').focus();
  await page.keyboard.type(code); // auto-advances and submits on the sixth digit
  await expect(page).not.toHaveURL(/\/register/);
}

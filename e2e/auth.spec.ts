import { expect, test } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';
import { emailedCode, startRegistrationViaUi } from './helpers';

// Registration only creates the account after the emailed code is verified (decision.md D-076).
test.beforeEach(async () => {
  const redis = new Redis(E2E_REDIS_URL);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

test('register: emailed code step, wrong code, resend countdown, then school on the profile', async ({
  page,
}) => {
  const username = `otp${Date.now() % 100000}`;
  await startRegistrationViaUi(page, username, { institution: 'IIT Delhi' });
  await expect(page.getByText(`${username}@e2e.test`)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Resend in \d+:\d\d$/ })).toBeDisabled();

  // A wrong code is rejected with the attempts left.
  const code = await emailedCode(`${username}@e2e.test`);
  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel('Digit 1').focus();
  await page.keyboard.type(wrong);
  await expect(page.getByRole('alert')).toContainText('Incorrect code. 4 attempts left.');
  await expect(page).toHaveURL(/\/register$/);

  // The right one (pasted) signs the user in.
  await page.getByLabel('Digit 1').focus();
  await page.keyboard.type(code);
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();

  await page.getByRole('link', { name: 'Your profile' }).click();
  await expect(page.getByRole('heading', { name: username, level: 1 })).toBeVisible();
  await expect(page.getByText('IIT Delhi')).toBeVisible();
});

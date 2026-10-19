import { expect, test } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';

// Registers a user, so reset the per-IP auth rate limits like battle.spec does.
test.beforeEach(async () => {
  const redis = new Redis(E2E_REDIS_URL);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

test('landing: anonymous visitor reaches the arena through the hero CTA', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/thegrave/i);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('link', { name: 'Enter the arena' }).click();
  await expect(page).toHaveURL(/\/register$/);
});

test('landing: section links scroll in-page and a signed-in user is offered the arena', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Arena' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Built so the only variable is you.' }),
  ).toBeInViewport();

  const username = `land${Date.now() % 100000}`;
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@e2e.test`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL(/\/play$/); // the lobby moved from / to /play
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Enter arena' })).toHaveAttribute('href', '/play');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('keeps the background still and shows every section', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('canvas')).toHaveCount(0);
    for (const title of [
      'From queue to verdict in one sitting.',
      'Every rating starts at 1500.',
      'The arena is open.',
    ]) {
      const heading = page.getByRole('heading', { name: title });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
    }
  });
});

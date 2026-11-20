import { expect, test } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';
import { registerViaUi } from './helpers';

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

test('landing: section links scroll in-page and a signed-in user never sees the landing page', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Programming' })
    .click();
  await expect(page.getByRole('heading', { name: 'Debug a real codebase.' })).toBeInViewport();

  const username = `land${Date.now() % 100000}`;
  await registerViaUi(page, username);
  await expect(page).toHaveURL(/\/play$/); // the lobby moved from / to /play
  // Signed in: the landing page is never shown, "/" and the logo both land on the play area.
  await page.goto('/');
  await expect(page).toHaveURL(/\/play$/);
  await page.getByRole('link', { name: 'Your profile' }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${username}$`));
  await expect(page.getByRole('link', { name: 'Grave home' }).first()).toHaveAttribute(
    'href',
    '/play',
  );
  await page.getByRole('link', { name: 'Grave home' }).first().click();
  await expect(page).toHaveURL(/\/play$/);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('keeps the background still and shows every section', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('canvas')).toHaveCount(0);
    for (const title of [
      'Algorithms, head to head.',
      'Debug a real codebase.',
      'Stuck? Ask the coach.',
      'Bring a friend.',
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

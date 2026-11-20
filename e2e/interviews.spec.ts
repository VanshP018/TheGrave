import { expect, test } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';
import { registerViaUi } from './helpers';

test.beforeEach(async () => {
  const redis = new Redis(E2E_REDIS_URL);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

test('the Interviews link sits in the nav with a drifting light and opens a coming-soon page', async ({
  page,
}) => {
  await registerViaUi(page, `intv${Date.now() % 100000}`);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText([
    'DSA',
    'Programming',
    'Interviews',
    'Leaderboard',
  ]);

  const link = nav.getByRole('link', { name: 'Interviews' });
  await expect(link).toHaveClass(/nav-wave/);

  await link.click();
  await expect(page).toHaveURL(/\/interviews$/);
  await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
  // the shimmer stops once you are on the page, like the other links' active state
  await expect(link).not.toHaveClass(/nav-wave/);
});

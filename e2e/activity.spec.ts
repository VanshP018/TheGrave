import { expect, test } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';
import { registerViaUi } from './helpers';

// Problems solved: the profile's heat map and the points leaderboard (1 easy, 3 medium, 5 hard).
test.beforeEach(async () => {
  const redis = new Redis(E2E_REDIS_URL);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

test('a new player has an empty heat map, and the leaderboard switches between rating and problems', async ({
  page,
}) => {
  const username = `act${Date.now() % 100000}`;
  await registerViaUi(page, username);

  await page.goto(`/u/${username}`);
  const section = page.getByTestId('activity-section');
  await expect(section.getByRole('heading', { name: 'Problems solved' })).toBeVisible();
  await expect(page.getByTestId('activity-stats')).toContainText('0'); // points
  await expect(page.getByTestId('activity-stats')).toContainText('solve a problem to be ranked');
  // 53 whole weeks of squares, none lit yet
  await expect(page.locator('[data-testid=activity-heatmap] rect')).toHaveCount(371);
  await expect(page.locator('[data-testid=activity-heatmap] rect[data-level="0"]')).toHaveCount(
    371,
  );
  await section.getByRole('button', { name: 'Programming' }).click();
  await expect(section.getByRole('button', { name: 'Programming' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.goto('/leaderboard');
  await page
    .getByRole('group', { name: 'Leaderboard type' })
    .getByRole('button', { name: 'Problems' })
    .click();
  await expect(page).toHaveURL(/metric=problems/);
  await expect(page.getByTestId('my-rank')).toHaveText('Solve a problem to get ranked.');
  await expect(page.getByRole('columnheader', { name: 'Points' })).toBeVisible();

  await page.getByRole('button', { name: 'My university' }).click();
  await expect(page).toHaveURL(/metric=problems&scope=university/);
  await expect(page.getByText('Nobody from Grave Academy is ranked yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Rating' }).click();
  await expect(page).toHaveURL(/^(?!.*metric=).*scope=university/);
  await expect(page.getByRole('columnheader', { name: 'Rating' })).toBeVisible();
});

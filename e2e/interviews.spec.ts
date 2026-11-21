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

test('the Interviews link sits in the nav and opens the form', async ({ page }) => {
  await registerViaUi(page, `intv${Date.now() % 100000}`);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText([
    'DSA',
    'Programming',
    'Interviews',
    'Leaderboard',
  ]);

  const link = nav.getByRole('link', { name: 'Interviews' });
  await link.click();
  await expect(page).toHaveURL(/\/interviews$/);
  await expect(
    page.getByRole('heading', { name: 'Interview questions from your own code' }),
  ).toBeVisible();
  // the "new" shimmer stops once you are on the page, like the other links' active state
  await expect(link).not.toHaveClass(/nav-wave/);
});

test('analyse a repo: progress, question cards, history, delete; docs-only repo fails cleanly', async ({
  page,
}) => {
  await registerViaUi(page, `intv${Date.now() % 100000}`);
  await page.goto('/interviews');

  // invalid URL: inline error, nothing sent
  const field = page.getByLabel('GitHub repository URL');
  await field.fill('https://example.com/nope');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByText('Enter a public GitHub repository URL.')).toBeVisible();

  // happy path
  await field.fill('https://github.com/grave-fixtures/express-api');
  await page.getByRole('button', { name: 'Senior' }).click();
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page).toHaveURL(/\/interviews\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'grave-fixtures/express-api' })).toBeVisible();

  const cards = page.getByTestId('question-card');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(5);
  const first = cards.first();
  await expect(first.locator('pre')).toBeVisible();
  await expect(first.getByRole('link', { name: /on GitHub/ })).toHaveAttribute(
    'href',
    /github\.com\/grave-fixtures\/express-api\/blob\//,
  );
  await first.getByText('What a strong answer covers').click();
  await expect(first.locator('li').first()).toBeVisible();

  // history shows it as done
  await page.getByRole('link', { name: '← All analyses' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'grave-fixtures/express-api' });
  await expect(row).toContainText('Done');

  // delete (inline two-step confirm)
  await row.getByRole('button', { name: /^Delete/ }).click();
  await row.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Paste a public GitHub repo')).toBeVisible();

  // a repo with only docs ends in the error card
  await field.fill('grave-fixtures/docs-only');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('alert')).toContainText("didn't find source code", {
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';
import { registerViaUi } from './helpers';

// Profiles (decision.md D-071): bio, social links and an uploaded avatar.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async () => {
  const redis = new Redis(E2E_REDIS_URL);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

test('edit bio and links, upload and remove an avatar', async ({ page }) => {
  const username = `prof${Date.now() % 100000}`;
  await registerViaUi(page, username);
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();

  await page.getByRole('link', { name: 'Your profile' }).click();
  await expect(page.getByRole('heading', { name: username, level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit profile' });
  await dialog.getByPlaceholder('What do you build?').fill('Breaks things for a living.');
  await dialog.getByLabel('GitHub').fill('https://gitlab.com/nope');
  await expect(dialog.getByText('not a valid github link')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await dialog.getByLabel('GitHub').fill(`https://github.com/${username}`);
  await dialog.getByLabel('Website').fill('https://example.dev');
  await dialog.getByRole('button', { name: 'Save profile' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByText('Breaks things for a living.')).toBeVisible();
  await expect(page.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
    'href',
    `https://github.com/${username}`,
  );
  await expect(page.getByRole('link', { name: /Website/ })).toHaveAttribute('rel', /noopener/);

  // Upload: cropped and re-encoded in the browser, then shown on the page and in the navbar.
  await page
    .getByTestId('avatar-input')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();
  const navImg = page.getByRole('link', { name: 'Your profile' }).locator('img');
  await expect(navImg).toHaveAttribute('src', new RegExp(`/api/users/${username}/avatar\\?v=\\d+`));
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(navImg).toHaveCount(0);
});

test('navbar search finds a player; their chart rings the peak', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('veteran@e2e.test');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, veteran' })).toBeVisible();

  const search = page.getByRole('combobox', { name: 'Search players' });
  await search.fill('RIV');
  const options = page.getByRole('listbox', { name: 'Players' }).getByRole('option');
  await expect(options).toHaveCount(4); // rival0–3, best rated first
  await expect(options.first()).toContainText('rival0');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/u\/rival0$/);
  await expect(page.getByRole('heading', { name: 'rival0', level: 1 })).toBeVisible();

  await search.fill('vet');
  await options.first().click();
  await expect(page).toHaveURL(/\/u\/veteran$/);
  await expect(page.getByTestId('chart-peak')).toContainText('Peak 1986');
  await expect(page.getByTestId('profile-stats')).not.toContainText('Peak');
});

import { expect, test, type Browser, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';
import { registerViaUi } from './helpers';

// Private rooms (decision.md D-065): create, share an invite link, ready up, start an unrated battle.
const SOLVES = 'import sys;d=sys.stdin.read().split();print(sum(map(int,d[1:])))';

test.beforeEach(async () => {
  const redis = new Redis(E2E_REDIS_URL);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

let seq = 0;
async function player(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  const username = `${name}${Date.now() % 100000}${seq++}`;
  await registerViaUi(page, username);
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();
  await expect(page.getByText('Connected')).toBeVisible();
  return page;
}

test('private room: invite link → ready → host starts a friendly, unrated battle', async ({
  browser,
}) => {
  const host = await player(browser, 'host');
  const guest = await player(browser, 'guest');

  await host.getByRole('button', { name: 'Create room' }).click();
  const code = (await host.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  // Ranked is off while you sit in a room.
  await expect(host.getByRole('button', { name: 'Find match' })).toBeDisabled();
  await expect(host.getByRole('button', { name: 'Start battle' })).toBeDisabled();

  await guest.goto(`/play?room=${code}`);
  await expect(guest.getByTestId('room-code')).toHaveText(code);
  await expect(host.getByText(/Not ready/)).toBeVisible();
  await guest.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(host.getByText('Ready', { exact: true })).toBeVisible();

  await host.getByRole('button', { name: 'Start battle' }).click();
  for (const p of [host, guest]) {
    await p.waitForURL(/\/battle\/[0-9a-f-]+$/);
    await expect(p.getByText('Friendly · unrated')).toBeVisible();
    await expect(p.getByTestId('problem-title')).toHaveText('Sum of Array');
  }

  await host.locator('.monaco-editor .view-lines').click();
  await host.keyboard.press('Control+A');
  await host.keyboard.press('Delete');
  await host.keyboard.insertText(SOLVES);
  await host.getByRole('button', { name: 'Submit' }).click();

  await expect(host.getByTestId('battle-result')).toHaveText('You won!');
  await expect(guest.getByTestId('battle-result')).toHaveText('You lost');
  for (const p of [host, guest]) {
    await expect(p.getByText('Friendly match: ratings are unchanged.')).toBeVisible();
    await expect(p.getByTestId('rating-change')).toHaveCount(0);
  }
  await host.getByRole('link', { name: 'Back to lobby' }).click();
  await expect(host.getByText('1500', { exact: true })).toBeVisible();
});

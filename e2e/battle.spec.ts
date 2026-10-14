import { expect, test, type Browser, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';

// Exit criterion for Phase 4: win, time-out, draw and disconnect-forfeit, each with two browser contexts.
// The only seeded problem is "Sum of Array" (9 tests: 2 samples + 7 hidden), judged by the real Docker sandbox.
const SOLVES = 'import sys;d=sys.stdin.read().split();print(sum(map(int,d[1:])))';
const PASSES_ONE = 'print(15)'; // only the first sample's answer

test.describe.configure({ mode: 'serial' });

let seq = 0;
test.beforeEach(async () => {
  // Every scenario registers two users; reset the per-IP auth rate limits between scenarios.
  const redis = new Redis(E2E_REDIS_URL);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

async function player(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  const username = `${name}${Date.now() % 100000}${seq++}`;
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@e2e.test`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();
  await expect(page.getByText('Connected')).toBeVisible();
  return page;
}

/** Both players queue, accept the ready check, land on the battle and wait for the problem. */
async function battle(browser: Browser): Promise<[Page, Page]> {
  const [a, b] = [await player(browser, 'alice'), await player(browser, 'bob')];
  for (const p of [a, b]) await p.getByRole('button', { name: 'Find match' }).click();
  for (const p of [a, b]) {
    await expect(p.getByRole('dialog', { name: 'Match found' })).toBeVisible();
    await p.getByRole('button', { name: 'Accept' }).click();
  }
  for (const p of [a, b]) {
    await p.waitForURL(/\/battle\/[0-9a-f-]+$/);
    await expect(p.getByTestId('problem-title')).toHaveText('Sum of Array');
  }
  return [a, b];
}

async function submit(page: Page, code: string) {
  await page.locator('.monaco-editor .view-lines').click();
  // The "Desktop Chrome" device has a Windows user agent, so Monaco binds select-all to Ctrl+A on any host.
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
  await page.getByRole('button', { name: 'Submit' }).click();
}

const result = (page: Page) => page.getByTestId('battle-result');
const reason = (page: Page) => page.getByTestId('battle-result-reason');

test('win: first full ACCEPTED wins, and a reload mid-battle resyncs', async ({ browser }) => {
  const [a, b] = await battle(browser);

  // Reload: the socket resync brings the player straight back into the live battle.
  const battleUrl = a.url();
  await a.reload();
  await expect(a.getByTestId('problem-title')).toHaveText('Sum of Array');
  expect(a.url()).toBe(battleUrl);

  await submit(a, SOLVES);
  await expect(result(a)).toHaveText('You won!');
  await expect(reason(a)).toContainText('first to solve every test');
  await expect(result(b)).toHaveText('You lost');
  // The loser saw progress only: the winner's score, never their code.
  await expect(b.getByTestId('opponent-progress-passed')).toHaveText('9/9 tests');
  await expect(b.getByText(SOLVES)).toHaveCount(0);
});

test('time-out: most tests passed wins when the clock runs out', async ({ browser }) => {
  const [a, b] = await battle(browser);
  await submit(a, PASSES_ONE);
  await expect(a.getByTestId('my-submissions')).toContainText('Wrong answer');
  await expect(b.getByTestId('opponent-progress-passed')).toHaveText('1/9 tests');
  await expect(result(a)).toHaveText('You won!', { timeout: 30_000 });
  await expect(reason(a)).toContainText('tests passed when time ran out');
  await expect(result(b)).toHaveText('You lost');
});

test('draw: nobody passes anything', async ({ browser }) => {
  const [a, b] = await battle(browser);
  await expect(result(a)).toHaveText('Draw', { timeout: 30_000 });
  await expect(result(b)).toHaveText('Draw');
});

test('disconnect-forfeit: a player gone past the grace period loses', async ({ browser }) => {
  const [a, b] = await battle(browser);
  await b.context().close();
  await expect(a.getByTestId('opponent-progress')).toContainText('away');
  await expect(result(a)).toHaveText('You won!', { timeout: 15_000 });
  await expect(reason(a)).toContainText('opponent disconnected');
});

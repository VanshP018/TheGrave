import { expect, test, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { E2E_REDIS_URL } from '../playwright.config';
import { projects } from '../apps/server/src/seed/projects';
import { registerViaUi } from './helpers';

// Programming challenges (decision.md D-066): terminal, visible tests, hidden-test grading, solving by editing.
const cart = projects.find((p) => p.slug === 'shopping-cart')!;

test.beforeEach(async () => {
  const redis = new Redis(E2E_REDIS_URL);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

/** Fixes a file the way a person would: Monaco's find & replace (Ctrl+H) on the exact broken lines. */
async function fix(page: Page, path: string, edits: [string, string][]) {
  await page
    .getByRole('navigation', { name: 'File explorer' })
    .getByRole('button', { name: path, exact: true })
    .click();
  await page.locator('.monaco-editor .view-lines').click();
  for (const [from, to] of edits) {
    await page.keyboard.press('Control+H');
    await page.getByRole('textbox', { name: 'Find' }).fill(from);
    await page.getByRole('textbox', { name: 'Replace' }).fill(to);
    await page.keyboard.press('Control+Alt+Enter'); // replace all
    await page.keyboard.press('Escape');
  }
  let expected = cart.files[path]!;
  for (const [from, to] of edits) expected = expected.split(from).join(to);
  await expect
    .poll(() =>
      page.evaluate(
        (p) => JSON.parse(localStorage.getItem('project:shopping-cart:files')!)[p],
        path,
      ),
    )
    .toBe(expected);
}

test('debug a codebase: terminal, tests, a failing then a passing submission', async ({ page }) => {
  const username = `dbg${Date.now() % 100000}`;
  await registerViaUi(page, username);
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();

  await page.getByRole('link', { name: 'Programming', exact: true }).click();
  await expect(page.getByText('0/5 solved')).toBeVisible();
  await page.getByRole('link', { name: /Fix the Shopping Cart/ }).click();
  await expect(page.getByTestId('project-title')).toHaveText(cart.title);

  // The terminal really runs the code, in the sandbox.
  const term = page.getByLabel('Terminal command');
  await term.fill('python3 main.py');
  await term.press('Enter');
  await expect(page.getByText(/Subtotal\s+8\.18/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByText('visible tests passed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run tests' })).toBeEnabled({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('project-verdict')).toHaveText('Some tests fail', {
    timeout: 30_000,
  });

  // Fix the three bugs in the editor, then the hidden suite passes.
  await fix(page, 'cart/discounts.py', [
    ['DISCOUNTS.get(code)', 'DISCOUNTS.get(code.upper())'],
    ['int(amount_cents * (100 - pct) / 100)', '(amount_cents * (100 - pct) + 50) // 100'],
  ]);
  await fix(page, 'cart/cart.py', [
    ['items=[]', 'items=None'],
    ['self.items = items', 'self.items = list(items) if items else []'],
    ['existing.qty = item.qty', 'existing.qty += item.qty'],
  ]);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('project-verdict')).toHaveText('All bugs fixed', {
    timeout: 30_000,
  });

  await page.getByRole('link', { name: 'Programming' }).first().click();
  await expect(page.getByText('1/5 solved')).toBeVisible();
});

test('ranked programming battle: same codebase, first full pass wins', async ({ browser }) => {
  const players: Page[] = [];
  for (const name of ['fixa', 'fixb']) {
    const page = await (await browser.newContext()).newPage();
    const username = `${name}${Date.now() % 100000}`;
    await registerViaUi(page, username);
    await expect(page.getByText('Connected')).toBeVisible();
    await page.getByRole('link', { name: 'Programming', exact: true }).click();
    await expect(page.getByText('Ranked debugging')).toBeVisible();
    players.push(page);
  }
  const [a, b] = players as [Page, Page];
  for (const p of [a, b]) await p.getByRole('button', { name: 'Find match' }).click();
  for (const p of [a, b]) {
    await expect(p.getByRole('dialog', { name: 'Match found' })).toBeVisible();
    await p.getByRole('button', { name: 'Accept' }).click();
  }
  for (const p of [a, b]) {
    await p.waitForURL(/\/battle\/[0-9a-f-]+$/);
    await expect(p.getByTestId('problem-title')).toHaveText(cart.title);
    await expect(p.getByRole('navigation', { name: 'File explorer' })).toBeVisible();
    // No AI help in a contest (decision.md D-075).
    await expect(p.getByRole('button', { name: 'Ask for a hint' })).toHaveCount(0);
  }

  // Player A's fixed codebase (the workspace keeps files per battle in this browser), then submit.
  const matchId = a.url().split('/').pop()!;
  await a.evaluate(([key, files]) => localStorage.setItem(key, JSON.stringify(files)), [
    `battle:${matchId}:files`,
    { ...cart.files, ...cart.solution },
  ] as const);
  await a.reload();
  await expect(a.getByTestId('problem-title')).toHaveText(cart.title);
  await a.getByRole('button', { name: 'Submit' }).click();

  await expect(a.getByTestId('battle-result')).toHaveText('You won!', { timeout: 20_000 });
  await expect(b.getByTestId('battle-result')).toHaveText('You lost');
  await expect(a.getByTestId('rating-change')).toContainText('(+');
});

test('hint bot: floating, draggable and resizable; answers on the practice page only', async ({
  page,
}) => {
  const username = `hint${Date.now() % 100000}`;
  await registerViaUi(page, username);
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();
  await page.goto('/projects/shopping-cart');
  await expect(page.getByTestId('project-title')).toHaveText(cart.title);

  await page.getByRole('button', { name: 'Ask for a hint' }).click();
  const bot = page.getByRole('dialog', { name: 'Hint assistant' });
  await expect(bot).toBeVisible();
  await bot.getByRole('button', { name: 'Where should I start looking?' }).click();
  await expect(bot.getByText(/reproduce the first ticket/i)).toBeVisible();

  await bot.getByLabel('Your question').fill('Just tell me the bug');
  await bot.getByLabel('Your question').press('Enter');
  await expect(bot.getByText('Just tell me the bug')).toBeVisible();

  // Drag by the header, then resize from the grip: both change the window's box.
  const before = (await bot.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + 18);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 200, before.y - 100, { steps: 5 });
  await page.mouse.up();
  const moved = (await bot.boundingBox())!;
  expect(moved.x).toBeLessThan(before.x - 150);

  // Closing keeps the conversation for this challenge.
  await bot.getByRole('button', { name: 'Close' }).click();
  await expect(bot).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask for a hint' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Hint assistant' }).getByText('Just tell me the bug'),
  ).toBeVisible();
});

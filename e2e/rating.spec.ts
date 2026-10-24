import { expect, test } from '@playwright/test';

// Phase 5: leaderboard, profile, rating graph. Uses the veteran + rivals seeded by test/e2e/setup.ts.
test('leaderboard ranks the seeded players and the profile shows W/L/D, graph and history', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('veteran@e2e.test');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, veteran' })).toBeVisible();

  await page.getByRole('link', { name: 'Leaderboard' }).click();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(5); // veteran + 4 rivals; brand-new battle players are not ranked yet
  await expect(rows.first().locator('td').first()).toHaveText('1');
  const ratings = (await rows.locator('td:nth-child(3)').allTextContents()).map((t) =>
    parseInt(t, 10),
  );
  expect(ratings).toEqual([...ratings].sort((x, y) => y - x));
  await expect(page.getByTestId('my-rank')).toContainText(/You are #\d+ of \d+/);

  // The same board limited to the viewer's school or college (decision.md D-079). Everyone seeded here
  // is from one school, so it matches the global board, and it names that school.
  await page.getByRole('button', { name: 'My university' }).click();
  await expect(page).toHaveURL(/scope=university/);
  await expect(page.getByTestId('my-rank')).toContainText(/You are #\d+ of \d+ at Grave Academy/);
  await expect(rows).toHaveCount(5);
  await page.getByRole('button', { name: 'Global' }).click();
  await expect(page).not.toHaveURL(/scope=/);
  await expect(page.locator('tr[aria-current="true"]')).toContainText('veteran');
  await page.screenshot({ path: 'test-results/leaderboard.png', fullPage: true });

  await page.getByRole('link', { name: 'veteran', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'veteran' })).toBeVisible();
  const stats = page.getByTestId('profile-stats');
  await expect(stats).toContainText('Games30');
  const chart = page.getByRole('img', { name: /Rating over 30 games/ });
  await expect(chart).toBeVisible();

  // Crosshair tooltip on hover, and the same data in the table view.
  await chart.scrollIntoViewIfNeeded(); // the profile hero is tall: the chart starts below the fold
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.getByRole('status')).toContainText(/after game \d+/);
  await page.screenshot({ path: 'test-results/profile.png', fullPage: true });
  await page.getByText('Show as table').click();
  await expect(page.locator('details tbody tr')).toHaveCount(31);

  // Keyset-paginated match history: 15 + 15.
  const history = page.getByTestId('match-history').locator('li');
  await expect(history).toHaveCount(15);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(history).toHaveCount(30);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

  // Phone width: the chart re-measures and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chart).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/profile-mobile.png' });
});

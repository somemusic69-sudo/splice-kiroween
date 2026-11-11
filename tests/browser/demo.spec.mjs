import { test, expect } from '@playwright/test';

test('explores a sample incident using WASM and reviews the patch', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine')).toHaveText('Log tools ready');
  await expect(page.locator('#log-count')).toHaveText('6 / 6 lines');
  await page.getByLabel('Log level').selectOption('ERROR');
  await expect(page.locator('#log-count')).toHaveText('3 / 6 lines');
  await page.getByLabel('Search logs').fill('BEFORE UPSTREAM');
  await expect(page.locator('#log-count')).toHaveText('2 / 6 lines');
  await page.getByLabel('Search logs').fill('[');
  await expect(page.locator('#log-count')).toHaveText('0 / 6 lines');
  await page.getByLabel('Use regex').check();
  await expect(page.locator('#log-results')).toContainText('Invalid regex');
  await page.getByLabel('Search logs').fill('before upstream');
  await expect(page.locator('#log-count')).toHaveText('2 / 6 lines');
  await expect(page.locator('.log-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Use matching lines' }).click();
  await page.getByRole('button', { name: 'Review clues' }).click();
  await expect(page.getByLabel('Clues to review')).toHaveValue(/retry fired before upstream cooldown/);
  await page.getByRole('button', { name: 'Reveal the cause' }).click();
  await page.getByRole('button', { name: 'Review the fix' }).click();
  await expect(page.locator('#diff')).toBeHidden();
  await page.getByText('See code changes', { exact: true }).click();
  await expect(page.locator('#diff')).toContainText('delaySeconds * 1000');
  await page.getByRole('button', { name: 'Test the fix' }).click();
  await expect(page.locator('#patch-status')).toHaveText('Test passed. The server now waits 2,000 ms before retrying, up from 2 ms.');
  await expect(page.locator('.xterm-rows')).toContainText('retry succeeded after upstream cooldown');
  await expect(page.getByRole('button', { name: 'Test the fix' })).toBeDisabled();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('#log-count')).toHaveText('6 / 6 lines');
  await page.getByRole('link', { name: 'Local setup' }).click();
  await expect(page.getByRole('heading', { name: 'Run Splice on Windows 11' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps the controls inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Find the clues' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  const tools = await page.getByRole('tablist').boundingBox();
  const terminal = await page.getByRole('heading', { name: 'Server replay', exact: true }).boundingBox();
  expect(tools.y).toBeLessThan(terminal.y);
});

test('guides a first-time judge from the incident to verified logs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Find the clues' }).click();
  await expect(page.locator('#log-count')).toHaveText('3 / 6 lines');
  await page.getByRole('button', { name: 'Review clues' }).click();
  await expect(page.getByLabel('Clues to review')).toHaveValue(/retry budget exhausted/);
  await page.getByRole('button', { name: 'Edit clues' }).click();
  await expect(page.getByLabel('Clues for Kiro')).toBeFocused();
  await expect(page.locator('#log-count')).toHaveText('3 / 6 lines');
  await page.getByRole('button', { name: 'Review clues' }).click();
  await page.getByRole('button', { name: 'Reveal the cause' }).click();
  await page.getByRole('button', { name: 'Review the fix', exact: true }).click();
  await expect(page.locator('#patch-changes')).toHaveText('+1 / −1');
  await page.getByRole('button', { name: 'Test the fix' }).click();
  await expect(page.locator('#incident-state')).toContainText('Verified fix');
  await page.getByRole('button', { name: 'See the server recover' }).click();
  await expect(page.getByRole('heading', { name: 'Server replay', exact: true })).toBeFocused();
  await expect(page.locator('.xterm-rows')).toContainText('retry succeeded after upstream cooldown');
});

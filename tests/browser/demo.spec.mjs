import { test, expect } from '@playwright/test';

test('explores a sample incident using WASM and reviews the patch', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine')).toHaveText('WASM ready');
  await expect(page.locator('#log-count')).toHaveText('6 / 6 lines');
  await page.getByLabel('Severity').selectOption('ERROR');
  await expect(page.locator('#log-count')).toHaveText('3 / 6 lines');
  await page.getByLabel('Regex').fill('[');
  await expect(page.locator('#log-results')).toContainText('Invalid regex');
  await page.getByLabel('Regex').fill('before upstream');
  await expect(page.locator('#log-count')).toHaveText('2 / 6 lines');
  await expect(page.locator('.log-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Use filtered lines' }).click();
  await page.getByRole('button', { name: 'Review for Kiro' }).click();
  await expect(page.getByLabel('Context preview')).toHaveValue(/retry fired before upstream cooldown/);
  await page.getByRole('button', { name: 'Show sample diagnosis' }).click();
  await page.getByRole('button', { name: 'Review patch' }).click();
  await expect(page.locator('#diff')).toContainText('delaySeconds * 1000');
  await page.getByRole('button', { name: 'Apply and test sample patch' }).click();
  await expect(page.locator('#patch-status')).toHaveText('Regression passed. The retry delay changed from 2 ms to 2,000 ms.');
  await expect(page.locator('.xterm-rows')).toContainText('retry succeeded after upstream cooldown');
  await expect(page.getByRole('button', { name: 'Apply and test sample patch' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset sample incident' }).click();
  await expect(page.locator('#log-count')).toHaveText('6 / 6 lines');
  await page.getByRole('link', { name: 'Local setup' }).click();
  await expect(page.getByRole('heading', { name: 'Run Splice on Windows 11' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps the controls inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reset sample incident' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  const tools = await page.getByRole('tablist').boundingBox();
  const terminal = await page.getByRole('heading', { name: 'Terminal', exact: true }).boundingBox();
  expect(tools.y).toBeLessThan(terminal.y);
});

test('guides a first-time judge from the incident to verified logs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Review error logs' }).click();
  await expect(page.locator('#log-count')).toHaveText('3 / 6 lines');
  await page.getByRole('button', { name: 'Review for Kiro' }).click();
  await expect(page.getByLabel('Context preview')).toHaveValue(/retry budget exhausted/);
  await page.getByRole('button', { name: 'Edit excerpt' }).click();
  await expect(page.getByLabel('Excerpt for Kiro')).toBeFocused();
  await expect(page.locator('#log-count')).toHaveText('3 / 6 lines');
  await page.getByRole('button', { name: 'Review for Kiro' }).click();
  await page.getByRole('button', { name: 'Show sample diagnosis' }).click();
  await page.getByRole('button', { name: 'Review patch', exact: true }).click();
  await expect(page.locator('#patch-changes')).toHaveText('+1 / −1');
  await page.getByRole('button', { name: 'Apply and test sample patch' }).click();
  await expect(page.locator('#incident-state')).toContainText('Verified fix');
  await page.getByRole('button', { name: 'See terminal verification' }).click();
  await expect(page.getByRole('heading', { name: 'Terminal', exact: true })).toBeFocused();
  await expect(page.locator('.xterm-rows')).toContainText('retry succeeded after upstream cooldown');
});

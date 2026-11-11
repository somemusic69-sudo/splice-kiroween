import { test, expect } from '@playwright/test';

test('explores a sample incident using WASM and reviews the patch', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine')).toHaveText('WASM ready');
  await page.getByRole('button', { name: 'Load sample incident' }).click();
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
  await page.getByRole('button', { name: 'Apply sample patch' }).click();
  await expect(page.locator('#patch-status')).toContainText('Sample patch applied');
  await expect(page.getByRole('button', { name: 'Apply sample patch' })).toBeDisabled();
  await page.getByRole('link', { name: 'Local setup' }).click();
  await expect(page.getByRole('heading', { name: 'Run Splice on Windows 11' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps the controls inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Load sample incident' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});

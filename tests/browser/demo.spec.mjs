import { test, expect } from '@playwright/test';

test('explores a sample incident using WASM and reviews the patch', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine')).toHaveText('Log tools ready');
  const original = page.getByRole('button', { name: 'Original run' });
  const recovery = page.getByRole('button', { name: 'Recovery run' });
  await expect(original).toHaveAttribute('aria-pressed', 'true');
  await expect(recovery).toBeDisabled();
  await expect(page.locator('#retry-track-value')).toHaveText('2 ms');
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
  await expect(page.getByLabel('Log excerpt')).toHaveValue(/retry fired before upstream cooldown/);
  await page.getByRole('button', { name: 'View diagnosis' }).click();
  await expect(page.getByRole('heading', { name: 'Sample Kiro diagnosis' })).toBeVisible();
  await expect(page.locator('#diff')).toBeHidden();
  await page.getByText('View code change', { exact: true }).click();
  await expect(page.locator('#diff')).toContainText('delaySeconds * 1000');
  await page.getByRole('button', { name: 'Test fix' }).click();
  await expect(page.locator('#patch-status')).toHaveText('Test passed · 2 ms → 2,000 ms');
  await expect(page.locator('.xterm-rows')).toContainText('retry succeeded after upstream cooldown');
  await expect(recovery).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#retry-track-value')).toHaveText('2,000 ms');
  await original.click();
  await expect(page.locator('.xterm-rows')).toContainText('retry budget exhausted');
  await expect(page.locator('.xterm-rows')).not.toContainText('retry succeeded after upstream cooldown');
  await recovery.click();
  await expect(page.locator('.xterm-rows')).toContainText('retry succeeded after upstream cooldown');
  await expect(page.getByRole('button', { name: 'Test fix' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.locator('#log-count')).toHaveText('6 / 6 lines');
  await expect(page.getByLabel('Log excerpt')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'View diagnosis' })).toBeDisabled();
  await expect(recovery).toBeDisabled();
  await expect(page.locator('#retry-track-value')).toHaveText('2 ms');
  await page.getByRole('link', { name: 'Local setup' }).click();
  await expect(page.getByRole('heading', { name: 'Run Splice on Windows 11' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps the controls inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Review errors' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  const tools = await page.getByRole('tablist').boundingBox();
  const terminal = await page.getByRole('heading', { name: 'Server log replay', exact: true }).boundingBox();
  expect(tools.y).toBeLessThan(terminal.y);
});

test('explains how to use Kiro with an imported log', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import').setInputFiles({
    name: 'service.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('ERROR request failed\n'),
  });
  await expect(page.locator('#log-count')).toHaveText('1 / 1 lines');
  await page.getByRole('button', { name: 'Use matching lines' }).click();
  await expect(page.getByRole('button', { name: 'View diagnosis' })).toBeDisabled();
  await expect(page.locator('#import-hint')).toContainText('Run Splice locally');
  await page.getByRole('button', { name: 'Review errors' }).click();
  await expect(page.getByRole('button', { name: 'View diagnosis' })).toBeEnabled();
  await expect(page.locator('#import-hint')).toBeHidden();
});

test('guides a first-time judge from the incident to verified logs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Review errors' })).toBeEnabled();
  await page.getByRole('button', { name: 'Review errors' }).press('Enter');
  await expect(page.locator('#log-count')).toHaveText('3 / 6 lines');
  const logs = page.getByRole('tab', { name: 'Logs', exact: true });
  const diagnosis = page.getByRole('tab', { name: 'Diagnosis & fix' });
  await expect(logs).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(diagnosis).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(logs).toBeFocused();
  const excerpt = page.getByLabel('Log excerpt');
  await expect(excerpt).toHaveValue(/retry budget exhausted/);
  await excerpt.fill('ERROR retry budget exhausted');
  await page.getByRole('button', { name: 'View diagnosis' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Sample Kiro diagnosis' })).toBeVisible();
  await page.getByRole('button', { name: 'Test fix' }).press('Enter');
  await expect(page.locator('#patch-status')).toHaveText('Test passed · 2 ms → 2,000 ms');
  await page.getByRole('button', { name: 'View recovery logs' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Server log replay', exact: true })).toBeFocused();
  await expect(page.locator('.xterm-rows')).toContainText('retry succeeded after upstream cooldown');
});

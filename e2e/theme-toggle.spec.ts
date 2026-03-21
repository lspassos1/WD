import { expect, test, type Page } from '@playwright/test';

async function runSearchCommand(page: Page, query: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k');
  const searchInput = page.locator('.search-overlay .search-input');
  await expect(searchInput).toBeVisible();
  await searchInput.fill(query);
  await page.keyboard.press('Enter');
  await expect(page.locator('.search-overlay')).toHaveCount(0);
}

test.describe('theme controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__theme_e2e_init__') === '1') {
        return;
      }
      localStorage.removeItem('worldmonitor-theme');
      sessionStorage.setItem('__theme_e2e_init__', '1');
    });
  });

  test('uses variant default theme when no preference is stored', async ({ page }) => {
    await page.goto('/');

    const state = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      variant: document.documentElement.dataset.variant || 'full',
    }));

    const expectedTheme = state.variant === 'happy' ? 'light' : 'dark';
    expect(state.theme).toBe(expectedTheme);
  });

  test('can switch themes from command search and persist preference', async ({ page }) => {
    await page.goto('/');

    await runSearchCommand(page, 'switch to light mode');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('worldmonitor-theme'))).toBe('light');

    await runSearchCommand(page, 'switch to dark mode');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('worldmonitor-theme'))).toBe('dark');
  });

  test('stored theme preference survives reload', async ({ page }) => {
    await page.goto('/');

    await runSearchCommand(page, 'switch to light mode');
    await page.reload();

    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('worldmonitor-theme'))).toBe('light');
  });

  test('preload script applies stored theme before first render', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('worldmonitor-theme', 'dark');
    });

    await page.goto('/');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
  });
});

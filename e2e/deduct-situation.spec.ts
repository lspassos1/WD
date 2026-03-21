import { expect, test } from '@playwright/test';

test.describe('Deduct Situation Panel Options', () => {
    test('It successfully requests deduction from the intelligence API', async ({ page }) => {
        await page.goto('/?view=global');

        // MOCK the backend deduct-situation RPC response UNLESS testing real LLM flows
        if (!process.env.TEST_REAL_LLM) {
            await page.route('**/api/intelligence/v1/deduct-situation', async (route) => {
                const json = {
                    analysis: '### Mocked AI Analysis\n- This is a simulated response.\n- Situation is stable.',
                    model: 'mocked-e2e-model',
                    provider: 'groq',
                };
                await route.fulfill({ json });
            });
        }

        // Open CMD palette and search for deduction panel
        await page.keyboard.press('ControlOrMeta+k');
        await page.waitForSelector('.search-overlay');
        await page.fill('.search-overlay .search-input', 'deduct');
        const deductCommand = page.locator('.search-result-item.command-item:has-text("Deduct Situation")');
        if (await deductCommand.count() === 0) {
            test.skip(true, 'Deduct Situation panel command is not available in this runtime.');
        }
        await deductCommand.first().click();

        // Ensure the panel is visible and ready
        const panel = page.locator('.panel', { hasText: 'Deduct Situation' });
        await expect(panel).toBeVisible();

        // Fill in the text area query
        const textarea = panel.locator('textarea').first();
        await textarea.fill('What is the geopolitical status of the Pacific?');

        // Click analyze
        const analyzeBtn = panel.locator('button', { hasText: 'Analyze' });
        await analyzeBtn.click();

        // Verify loading state
        await expect(panel.locator('text="Analyzing timeline and impact..."')).toBeVisible();

        // Verify the resolved output is rendered
        if (!process.env.TEST_REAL_LLM) {
            await expect(panel.locator('text="Mocked AI Analysis"')).toBeVisible({ timeout: 10000 });
            await expect(panel.locator('text="Situation is stable."')).toBeVisible();
        } else {
            // If testing against a real local LLM or cloud, just expect some markdown output block to appear
            // The API might take a while depending on local hardware / provider limits
            await expect(panel.locator('.deduction-result')).not.toBeEmpty({ timeout: 30000 });
        }
    });
});

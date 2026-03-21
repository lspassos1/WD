import { expect, test } from '@playwright/test';

test.describe('Deduct Situation Panel Options', () => {
    test('It successfully requests deduction from the intelligence API', async ({ page }) => {
        await page.goto('/?view=global');

        const deductionPanel = page.locator('[data-panel="deduction"]');
        if (await deductionPanel.count() === 0) {
            test.skip(true, 'Deduction panel is only available in desktop runtime.');
            return;
        }

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

        // Open search modal and jump to deduction panel command
        await page.keyboard.press('ControlOrMeta+k');
        const searchInput = page.locator('.search-overlay .search-input');
        await expect(searchInput).toBeVisible();
        await searchInput.fill('deduct');
        await page.keyboard.press('Enter');

        // Ensure the panel is visible and ready
        const panel = page.locator('[data-panel="deduction"]');
        await expect(panel).toBeVisible();

        // Fill in the text area query
        const textarea = panel.locator('textarea.deduction-input').first();
        await textarea.fill('What is the geopolitical status of the Pacific?');

        // Click analyze
        const analyzeBtn = panel.locator('button.deduction-submit-btn', { hasText: 'Analyze' });
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

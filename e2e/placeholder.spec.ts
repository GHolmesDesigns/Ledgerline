import { expect, test } from '@playwright/test';

test('placeholder dashboard page loads against the local API', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /your next place/i })).toBeVisible();
  await expect(page.getByText('Sample data — not real listings')).toBeVisible();
});

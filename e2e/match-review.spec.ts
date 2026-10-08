import { expect, test } from '@playwright/test';

const fixture = (id: number, street: string) => ({
  id,
  reason: 'same street address; unit missing on existing record',
  incoming: {
    street,
    unit: '1204',
    city: 'Miami Beach',
    zip: '33139',
    mode: 'rent',
    price: 3400,
    provider: 'mock',
    lastSeen: '2026-10-06',
  },
  candidate: { id: `prop_existing_${id}`, street, unit: null, city: 'Miami Beach', zip: '33139' },
  candidateListings: [{ mode: 'sale', price: 285000, lastSeen: '2026-10-07' }],
  noteCount: 1,
});

test('match review supports Link, Keep separate, and Undo', async ({ page }) => {
  const actions: string[] = [];
  await page.route('**/api/match-reviews**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: { items: [fixture(1, '1500 Bay Rd'), fixture(2, '1600 Bay Rd')] },
      });
    } else {
      actions.push(new URL(route.request().url()).pathname.split('/').at(-1)!);
      await route.fulfill({ json: { item: {} } });
    }
  });

  await page.goto('/settings');
  const first = page.locator('article').filter({ hasText: '1500 Bay Rd' });
  const second = page.locator('article').filter({ hasText: '1600 Bay Rd' });
  await first.getByRole('button', { name: 'Link to existing' }).click();
  await expect(page.locator('[aria-labelledby="match-review-heading"] .review-count')).toHaveText(
    '1 pending',
  );
  await second.getByRole('button', { name: 'Keep separate' }).click();
  await expect(page.locator('[aria-labelledby="match-review-heading"] .review-count')).toHaveText(
    '0 pending',
  );
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(actions).toEqual(['link', 'keep-separate', 'undo', 'undo']);
  await expect(page.getByRole('heading', { name: 'Property match review' })).toBeVisible();
});

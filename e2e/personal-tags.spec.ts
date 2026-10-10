import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

test('personal tags can be managed from a card and Property page and appear in Compare', async ({
  page,
}) => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-tags-'));
  const databasePath = join(directory, 'ledgerline.sqlite');
  let api: Api | null = null;
  try {
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    await routeApiTo(page, () => api!);
    await page.goto('/');
    const firstCard = page.locator('article.listing-card').first();
    const propertyLink = firstCard.getByRole('link').first();
    const propertyUrl = await propertyLink.getAttribute('href');

    await firstCard.locator('.personal-tag-picker summary').click();
    await firstCard.getByRole('button', { name: 'Pool' }).click();
    await expect(firstCard.locator('.personal-tag-chip').filter({ hasText: 'Pool' })).toBeVisible();
    await firstCard.getByLabel('Add custom tag').fill('Rooftop deck');
    await firstCard.getByRole('button', { name: 'Add custom tag' }).click();
    await expect(
      firstCard.locator('.personal-tag-chip').filter({ hasText: 'Rooftop deck' }),
    ).toBeVisible();

    const secondCard = page.locator('article.listing-card').nth(1);
    await secondCard.locator('.personal-tag-picker summary').click();
    await expect(secondCard.getByRole('button', { name: 'Rooftop deck' })).toBeVisible();
    await secondCard.getByRole('button', { name: 'Rooftop deck' }).click();
    await expect(
      secondCard.locator('.personal-tag-chip').filter({ hasText: 'Rooftop deck' }),
    ).toBeVisible();

    await page.goto(propertyUrl!);
    await expect(page.locator('.personal-tag-chip').filter({ hasText: 'Pool' })).toBeVisible();
    await page.locator('.personal-tag-picker summary').click();
    await page.getByRole('button', { name: 'Pool' }).click();
    await expect(page.locator('.personal-tag-chip').filter({ hasText: 'Pool' })).toHaveCount(0);
    await expect(
      page.locator('.personal-tag-chip').filter({ hasText: 'Rooftop deck' }),
    ).toBeVisible();

    await page.goto('/');
    await page
      .locator('article.listing-card')
      .first()
      .getByRole('button', { name: /^Compare/ })
      .click();
    await page.goto('/compare');
    await expect(page.locator('.compare-table')).toContainText('Rooftop deck');
  } finally {
    if (api) await api.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

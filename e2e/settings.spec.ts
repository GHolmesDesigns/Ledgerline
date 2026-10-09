import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

let root: string;
let api: Api;
let palmBeachPropertyId: string;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledgerline-settings-e2e-'));
  const databasePath = join(root, 'data', 'ledgerline.sqlite');
  seedDatabase(databasePath);
  api = await startApi(databasePath);
  const results = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
    items: Array<{ property: { id: string; county: string | null } }>;
  };
  palmBeachPropertyId = results.items.find((item) => item.property.county === 'Palm Beach')!
    .property.id;
});

test.afterAll(async () => {
  await api?.stop();
  rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await routeApiTo(page, () => api);
});

test('Settings lists sections in the default order and hash links focus their target', async ({
  page,
}) => {
  const sections = [
    ['appearance', 'Appearance'],
    ['ranking-weights', 'Ranking weights'],
    ['assumptions', 'Assumptions'],
    ['saved-searches', 'Saved searches'],
    ['personal-tags', 'Personal tags'],
    ['rentcast-usage', 'RentCast usage'],
    ['keys', 'Keys'],
    ['property-match-review', 'Property match review'],
    ['backup-restore', 'Backup and restore'],
    ['about', 'About'],
  ];
  await page.goto('/settings#saved-searches');
  const sectionNav = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(sectionNav.getByRole('link')).toHaveText(sections.map(([, title]) => title));
  await expect(page.locator('#saved-searches')).toBeFocused();
  await expect(page.locator('#saved-searches')).toBeInViewport();
  await expect(page.locator('body')).not.toContainText('Ranking & data');

  await page.getByRole('link', { name: 'Keys', exact: true }).click();
  await expect(page).toHaveURL(/\/settings#keys$/);
  await expect(page.locator('#keys')).toBeFocused();
});

test('Search, Compare, and Property link settings edits to the matching section', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.locator('a.local-rates-prompt[href="/settings#assumptions"]').first(),
  ).toBeVisible();

  await page.goto(`/compare?properties=${palmBeachPropertyId}`);
  await expect(page.getByRole('link', { name: 'Edit personal assumptions' })).toHaveAttribute(
    'href',
    '/settings#assumptions',
  );
  await expect(page.getByRole('link', { name: 'Edit local rates' })).toHaveAttribute(
    'href',
    '/settings#assumptions',
  );

  await page.goto(`/property/${palmBeachPropertyId}`);
  await expect(page.locator('a[href="/settings#assumptions"]').first()).toBeVisible();
});

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

test('Settings sections reorder by mouse drag and persist after reload', async ({ page }) => {
  await page.goto('/settings');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  const first = page.getByRole('button', { name: 'Reorder Appearance' });
  const target = page.locator('[data-settings-section="assumptions"]');
  const from = await first.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(nav.getByRole('link').first()).toHaveText('Ranking weights');
  await expect(page.locator('#assumptions')).toBeVisible();
  await page.reload();
  await expect(nav.getByRole('link').first()).toHaveText('Ranking weights');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ledgerline.settings-section-order')!),
    ),
  ).toContain('assumptions');
});

test('Settings sections reorder with keyboard, announce position, and Escape restores the order', async ({
  page,
}) => {
  await page.goto('/settings');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  const handle = page.getByRole('button', { name: 'Reorder Appearance' });
  await handle.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('status').filter({ hasText: 'Appearance, position 2 of 10' }),
  ).toBeAttached();
  await page.keyboard.press('Enter');
  await expect(nav.getByRole('link').nth(1)).toHaveText('Appearance');
  await page.keyboard.press('Tab');
  const assumptions = page.getByRole('button', { name: 'Reorder Assumptions' });
  await assumptions.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(nav.getByRole('link').nth(2)).toHaveText('Assumptions');
});

test('phone Move up and Move down reorder sections; reset restores the C38 default order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await page.getByRole('button', { name: 'Move Ranking weights down' }).click();
  await expect(nav.getByRole('link').nth(0)).toHaveText('Appearance');
  await expect(nav.getByRole('link').nth(1)).toHaveText('Assumptions');
  await page.getByRole('button', { name: 'Move Assumptions up' }).click();
  await expect(nav.getByRole('link').first()).toHaveText('Assumptions');
  await page.getByRole('button', { name: 'Reset order' }).click();
  await expect(nav.getByRole('link').first()).toHaveText('Appearance');
  await expect(nav.getByRole('link').nth(1)).toHaveText('Ranking weights');
});

test('JSON backup excludes the local Settings section order', async ({ page }) => {
  await page.goto('/settings');
  await page.evaluate(() =>
    localStorage.setItem(
      'ledgerline.settings-section-order',
      JSON.stringify(['about', 'appearance']),
    ),
  );
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export personal data' }).click();
  const download = await downloadPromise;
  const { readFileSync } = await import('node:fs');
  const backup = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<string, unknown>;
  expect(backup).not.toHaveProperty('settingsSectionOrder');
  expect(backup).not.toHaveProperty('settingsOrder');
});

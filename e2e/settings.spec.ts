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

  await sectionNav.getByRole('link', { name: 'Keys', exact: true }).click();
  await expect(page).toHaveURL(/\/settings#keys$/);
  await expect(page.locator('#keys')).toBeFocused();
});

test('Settings shows tag counts, renames custom tags, and confirms deletion without deleting properties', async ({
  page,
}) => {
  const created = await fetch(api.url('/api/personal-tags'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'C50 test tag' }),
  });
  const { tag } = (await created.json()) as { tag: { id: string; name: string } };
  const results = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
    items: Array<{ property: { id: string } }>;
  };
  const propertyId = results.items[0]!.property.id;
  await fetch(api.url(`/api/properties/${propertyId}/tags`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: tag.name, enabled: true }),
  });

  await page.goto('/settings#personal-tags');
  const panel = page.locator('#personal-tags');
  await expect(panel.getByRole('textbox', { name: 'Rename C50 test tag' })).toBeVisible();
  await expect(panel.getByText('1 property', { exact: true })).toBeVisible();
  const standard = panel.locator('li').filter({ hasText: 'Pool' }).first();
  await expect(standard.getByRole('button')).toHaveCount(0);

  await panel.getByRole('textbox', { name: 'Rename C50 test tag' }).fill('C50 renamed tag');
  await panel
    .getByRole('button', { name: 'Rename' })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(panel.getByText('Renamed to “C50 renamed tag”.')).toBeVisible();
  expect(
    ((await (await fetch(api.url(`/api/properties/${propertyId}`))).json()) as { tags: string[] })
      .tags,
  ).toContain('C50 renamed tag');

  await panel
    .getByRole('button', { name: 'Delete', exact: true })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(panel.getByRole('group', { name: 'Confirm delete C50 renamed tag' })).toContainText(
    '1 property will lose this tag',
  );
  await panel
    .getByRole('button', { name: 'Confirm delete' })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expect(
    panel.getByText('Deleted “C50 renamed tag”. The tag was removed from 1 property.'),
  ).toBeVisible();
  expect(
    (
      (await (await fetch(api.url(`/api/properties/${propertyId}`))).json()) as {
        property: { id: string };
        tags: string[];
      }
    ).tags,
  ).not.toContain('C50 renamed tag');
  expect(
    (
      (await (await fetch(api.url(`/api/properties/${propertyId}`))).json()) as {
        property: { id: string };
      }
    ).property.id,
  ).toBe(propertyId);
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

test('RentCast usage edits show matched requests and unexplained dashboard gap in Settings and header', async ({
  page,
}) => {
  await page.goto('/settings#rentcast-usage');
  const section = page.locator('#rentcast-usage');
  await expect(section.getByRole('heading', { name: 'RentCast usage' })).toBeVisible();
  const current = (await (await fetch(api.url('/api/request-budget'))).json()) as {
    used: number;
    ceiling: number;
  };
  const today = new Date().toISOString().slice(0, 10);
  await section.getByLabel('Billing day').fill('7');
  await section.getByLabel('Plan included requests').fill('50');
  await section.getByLabel('Local request ceiling').fill(String(current.ceiling));
  await section.getByLabel('Dashboard used').fill(String(current.used + 16));
  await section.getByLabel('Dashboard read date').fill(today);
  await section.getByRole('button', { name: 'Save usage settings' }).click();
  await section.getByLabel('Request date').fill(today);
  await section.getByLabel('Request count').fill('15');
  await section.getByLabel('Note').fill('Milestone 0 pull');
  await section.getByRole('button', { name: 'Add outside requests' }).click();
  await expect(section).toContainText(`Matched total: ${current.used + 15}`);
  await expect(section).toContainText('Unexplained difference: 1 more on dashboard');
  await expect(page.getByLabel('Provider request usage')).toContainText(
    `${current.used + 15} of ${current.ceiling} ceiling · 50 included`,
  );
  await expect(page.getByLabel('Provider request usage')).toContainText(
    '1 unexplained more on dashboard',
  );
  await section.getByRole('button', { name: `Remove 15 outside requests from ${today}` }).click();
});

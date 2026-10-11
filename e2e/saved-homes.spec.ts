import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

type Item = { property: { id: string; street: string } };
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p0cAAAAASUVORK5CYII=',
  'base64',
);

async function withSeededApi(run: (api: Api, items: Item[]) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-saved-homes-e2e-'));
  const databasePath = join(root, 'ledgerline.sqlite');
  let api: Api | undefined;
  try {
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    const listings = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
      items: Item[];
    };
    await run(api, listings.items);
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

test('Saved Homes lists homes saved from Search and Compare, and removing one un-saves it', async ({
  page,
}) => {
  await withSeededApi(async (api, items) => {
    await routeApiTo(page, () => api);
    await page.goto('/saved');
    await expect(page.getByRole('heading', { level: 1, name: 'Saved Homes' })).toBeVisible();
    await expect(page.getByText('No saved homes yet.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '0 saved homes' })).toBeVisible();

    // Save one from a Search card.
    await page.goto('/?mode=sale');
    const first = items[0]!.property;
    await page
      .getByRole('button', { name: new RegExp(`^Save ${first.street}.*to saved homes$`) })
      .click();
    await expect(
      page.getByRole('button', { name: new RegExp(`^Remove ${first.street}.*from saved homes$`) }),
    ).toBeVisible();

    // Save another from Compare.
    const second = items[1]!.property;
    await page.goto(`/compare?properties=${second.id}`);
    await page.getByRole('button', { name: /^Save .* to saved homes$/ }).click();
    await expect(page.getByRole('button', { name: /^Remove .* from saved homes$/ })).toBeVisible();

    // Both show up on Saved Homes, newest save first.
    await page.getByRole('link', { name: 'Saved Homes' }).first().click();
    await expect(page).toHaveURL(/\/saved$/);
    await expect(page.getByRole('status').filter({ hasText: '2 saved homes' })).toBeVisible();
    const cards = page.locator('.saved-home-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByRole('link', { name: second.street })).toBeVisible();
    await expect(cards.nth(1).getByRole('link', { name: first.street })).toBeVisible();
    await expect(cards.nth(0).getByRole('list', { name: 'Listings' })).toContainText('Buy $');

    // The home saved from Compare is still in the Compare set; the button toggles it from here.
    const compareButton = cards.nth(0).getByRole('button', { name: /from Compare$|to Compare$/ });
    await expect(compareButton).toHaveText('In Compare');
    await compareButton.click();
    await expect(compareButton).toHaveText('Compare');
    await compareButton.click();
    await expect(compareButton).toHaveText('In Compare');

    // Remove from saved takes it off the list and un-saves it everywhere.
    await cards
      .nth(0)
      .getByRole('button', { name: /^Remove .* from Saved Homes$/ })
      .click();
    await expect(cards).toHaveCount(1);
    await expect(page.locator('.saved-homes-screen').getByRole('status')).toContainText(
      'removed from Saved Homes',
    );
    const saved = (await (await fetch(api.url('/api/saved-homes'))).json()) as {
      items: Array<{ propertyId: string }>;
    };
    expect(saved.items.map((entry) => entry.propertyId)).toEqual([first.id]);
  });
});

test('Saved Homes previews the primary uploaded photo and omits the frame when none is available', async ({
  page,
}) => {
  await withSeededApi(async (api, items) => {
    await routeApiTo(page, () => api);
    const withPhoto = items[0]!.property;
    const withoutPhoto = items[1]!.property;
    const upload = async (propertyId: string) => {
      const response = await fetch(api.url(`/api/properties/${propertyId}/photos`), {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: tinyPng,
      });
      expect(response.ok).toBe(true);
      return (await response.json()) as { photo: { url: string } };
    };
    const primary = await upload(withPhoto.id);
    await upload(withPhoto.id);

    for (const propertyId of [withPhoto.id, withoutPhoto.id]) {
      const response = await fetch(api.url(`/api/properties/${propertyId}/favorite`), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ saved: true }),
      });
      expect(response.ok).toBe(true);
    }

    await page.goto('/saved');
    const cards = page.locator('.saved-home-card');
    await expect(cards).toHaveCount(2);
    const photoCard = cards.filter({ hasText: withPhoto.street });
    const noPhotoCard = cards.filter({ hasText: withoutPhoto.street });
    await expect(photoCard.locator('img.saved-home-photo')).toHaveAttribute(
      'src',
      primary.photo.url,
    );
    await expect(photoCard.locator('img.saved-home-photo')).toHaveAttribute(
      'alt',
      `${withPhoto.street} primary property photo`,
    );
    await expect(photoCard.locator('img.saved-home-photo')).toHaveCount(1);
    await expect(noPhotoCard.locator('img.saved-home-photo')).toHaveCount(0);
  });
});

test('Search opens on Rent, with Rent first in the switch', async ({ page }) => {
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/');
  const modes = page.getByRole('group', { name: 'Listing mode' }).getByRole('button');
  await expect(modes).toHaveText(['Rent', 'Buy']);
  await expect(modes.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/mode=rent/);
  await page.reload();
  await expect(modes.first()).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/?mode=sale');
  await expect(modes.nth(1)).toHaveAttribute('aria-pressed', 'true');
});

test('Property type and Status are multi-select dropdowns kept in the address', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ json: { items: [] } });
  });
  await page.goto('/?mode=sale');
  const type = page.getByRole('button', { name: 'Property type', exact: true });
  await expect(type).toContainText('Any type');
  await type.click();
  const typeList = page.getByRole('group', { name: 'Property type', exact: true });
  await typeList.getByLabel('Condo').check();
  await typeList.getByLabel('Townhome').check();
  await expect(type).toContainText('Townhome, Condo');
  await expect(page).toHaveURL(/propertyType=townhome%2Ccondo/);
  await expect(page.getByRole('button', { name: /Townhome, Condo/ }).first()).toBeVisible();
  await typeList.getByRole('button', { name: 'Clear' }).click();
  await expect(type).toContainText('Any type');
  await typeList.getByRole('button', { name: 'Done' }).click();
  await expect(typeList).toBeHidden();

  await page.getByRole('button', { name: 'Listing status', exact: true }).click();
  const statusList = page.getByRole('group', { name: 'Listing status', exact: true });
  await statusList.getByLabel('Pending').check();
  await expect(page).toHaveURL(/status=active%2Cpending/);
  await expect.poll(() => requests.some((url) => /status=active%2Cpending/.test(url))).toBe(true);
});

test('secondary buttons share the grey style, the shape of the primary button, and 44 px height', async ({
  page,
}) => {
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.goto('/?mode=sale');
  const saveSearch = page.getByRole('button', { name: 'Save current search' });
  const style = await saveSearch.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      background: css.backgroundColor,
      color: css.color,
      height: element.getBoundingClientRect().height,
      radius: css.borderTopLeftRadius,
    };
  });
  // Light theme grey (#e4e8eb) with dark text (#101820).
  expect(style.background).toBe('rgb(228, 232, 235)');
  expect(style.color).toBe('rgb(16, 24, 32)');
  expect(style.height).toBeGreaterThanOrEqual(44);
  expect(style.radius).toBe('8px');
});

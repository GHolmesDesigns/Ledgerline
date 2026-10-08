import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';
import { pressWithKeyboard, sweepTabOrder, tabTo } from './support/keyboard';

// Wave 1 keyboard pass (C15). The sweeps are read-only; the workflow at the end changes
// data, so the file runs in order on one API with a seeded temporary database.
test.describe.configure({ mode: 'serial' });

let root: string;
let api: Api;
let propertyId: string;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-keyboard-'));
  const databasePath = join(root, 'data', 'ledgerline.sqlite');
  seedDatabase(databasePath);
  api = await startApi(databasePath);
  const found = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
    items: Array<{ property: { id: string; street: string } }>;
  };
  propertyId = found.items.find((item) => item.property.street.includes('Brickell'))!.property.id;
});

test.afterAll(async () => {
  await api?.stop();
  rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await routeApiTo(page, () => api);
});

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 900 } },
  { name: 'mobile', size: { width: 390, height: 844 } },
];

for (const viewport of viewports) {
  test.describe(`${viewport.name} tab order`, () => {
    test.use({ viewport: viewport.size });

    for (const [name, path, ready] of [
      ['Search', '/', 'Search'],
      ['Compare', '/compare', 'Compare'],
      ['Property detail', '/property/{id}', 'Property facts'],
      ['Ranking & data', '/settings', 'Backup and restore'],
    ]) {
      test(`${name}: every control is reachable and shows focus`, async ({ page }) => {
        await page.goto(path.replace('{id}', propertyId));
        await expect(page.getByRole('heading', { name: ready }).first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        const { stops, withoutIndicator, unreached } = await sweepTabOrder(page);
        expect(stops).toBeGreaterThan(5);
        expect(withoutIndicator).toEqual([]);
        expect(unreached).toEqual([]);
      });
    }
  });
}

test('mobile Map view: pins and zoom controls are reachable and show focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  await pressWithKeyboard(page, page.getByRole('button', { name: 'Map', exact: true }), 'Space');
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  const { withoutIndicator, unreached } = await sweepTabOrder(page);
  expect(withoutIndicator).toEqual([]);
  expect(unreached).toEqual([]);
});

test('keyboard only: search, save, compare, note, match review, and export', async ({ page }) => {
  await page.goto('/');
  const results = page.getByRole('group', { name: 'Search results' });
  await expect(results.getByRole('article').first()).toBeVisible();

  // Search.
  const location = page.getByLabel('City or ZIP');
  await tabTo(page, location);
  await page.keyboard.type('Brickell');
  await expect(results.getByRole('article')).toHaveCount(1);
  const card = results.getByRole('article');

  // Save, then add to Compare with the space bar.
  await pressWithKeyboard(page, card.getByRole('button', { name: /to saved homes$/ }));
  await expect(card.getByRole('button', { name: /from saved homes$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await pressWithKeyboard(
    page,
    card.getByRole('button', { name: /^Compare /, exact: false }),
    'Space',
  );
  await expect(card.getByRole('button', { name: /from Compare$/ })).toBeVisible();

  // Compare.
  await pressWithKeyboard(page, page.getByRole('link', { name: 'View Compare' }));
  await expect(page).toHaveURL(/\/compare\?properties=/);
  await expect(page.getByRole('heading', { name: 'Compare' }).first()).toBeVisible();

  // Property detail, then a note.
  await pressWithKeyboard(page, page.getByRole('link', { name: /Brickell Bay Dr/ }).first());
  await expect(page).toHaveURL(new RegExp(`/property/${propertyId}`));
  const noteField = page.getByLabel('Add a note');
  await tabTo(page, noteField);
  await page.keyboard.type('Ask about the special assessment');
  await pressWithKeyboard(page, page.getByRole('button', { name: 'Add note', exact: true }));
  await expect(page.getByText('Ask about the special assessment')).toBeVisible();

  // Property match review.
  await pressWithKeyboard(
    page,
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Ranking & data' }),
  );
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText('1 pending')).toBeVisible();
  await pressWithKeyboard(page, page.getByRole('button', { name: 'Link to existing' }));
  await expect(page.getByText('No property matches need review.')).toBeVisible();

  // Export.
  const downloaded = page.waitForEvent('download');
  await pressWithKeyboard(page, page.getByRole('button', { name: 'Export personal data' }));
  expect((await downloaded).suggestedFilename()).toMatch(/^ledgerline-backup-/);

  // What the keyboard did was saved.
  const saved = (await (await fetch(api.url('/api/listings?mode=sale&savedOnly=true'))).json()) as {
    items: Array<{ property: { id: string } }>;
  };
  expect(saved.items.map((item) => item.property.id)).toEqual([propertyId]);
  const detail = (await (await fetch(api.url(`/api/properties/${propertyId}`))).json()) as {
    notes: Array<{ body: string }>;
  };
  expect(detail.notes.map((note) => note.body)).toEqual(['Ask about the special assessment']);
});

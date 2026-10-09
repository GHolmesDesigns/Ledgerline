import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

let root: string;
let api: Api;
let propertyId: string;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledgerline-appearance-'));
  const databasePath = join(root, 'data', 'ledgerline.sqlite');
  seedDatabase(databasePath);
  api = await startApi(databasePath);
  const found = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
    items: Array<{ property: { id: string; street: string } }>;
  };
  propertyId = found.items.find((item) => item.property.street === '2207 NE 32nd Ct')!.property.id;
  const detail = await fetch(api.url(`/api/properties/${propertyId}`));
  if (!detail.ok) throw new Error(`Could not load seeded appearance-test property: ${propertyId}`);
});

test.afterAll(async () => {
  await api?.stop();
  rmSync(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await routeApiTo(page, () => api);
});

test('Light, Dark, and System apply immediately and persist; System follows OS changes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings#appearance');
  const theme = page.getByRole('combobox', { name: 'Color theme' });
  await expect(theme).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(theme).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await theme.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

const routes = [
  { name: 'Search', path: () => '/', ready: 'Search' },
  { name: 'Compare', path: (id: string) => `/compare?properties=${id}`, ready: 'Compare' },
  { name: 'Property', path: (id: string) => `/property/${id}`, ready: 'Property facts' },
  { name: 'Settings', path: () => '/settings', ready: 'Backup and restore' },
];

async function open(page: Page, path: string, ready: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: ready }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

for (const theme of ['light', 'dark'] as const) {
  for (const route of routes) {
    test(`axe has no color contrast violations on ${route.name} in ${theme} mode`, async ({
      page,
    }) => {
      await page.addInitScript((choice) => localStorage.setItem('ledgerline.theme', choice), theme);
      await open(page, route.path(propertyId), route.ready);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const violations = (await new AxeBuilder({ page }).withRules(['color-contrast']).analyze())
        .violations;
      expect(
        violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        })),
      ).toEqual([]);
    });
  }
}

test('theme stays a display preference outside the personal-data backup', async ({ page }) => {
  await page.goto('/settings');
  const backup = await page.evaluate(async () => {
    const response = await fetch('/api/backup/export');
    return (await response.json()) as Record<string, unknown>;
  });
  expect(JSON.stringify(backup).toLowerCase()).not.toContain('theme');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    document.documentElement.dataset.grayscale = 'true';
    document.documentElement.style.filter = 'grayscale(1)';
  });
  await expect(
    page.locator('.total-status-tag').filter({ hasText: 'Estimate' }).first(),
  ).toBeVisible();
});

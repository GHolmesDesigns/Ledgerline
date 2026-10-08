import { expect, test } from '@playwright/test';

const routes = [
  { path: '/', title: 'Search' },
  { path: '/compare', title: 'Compare' },
  { path: '/property/sample-property', title: 'Property detail' },
  { path: '/settings', title: 'Ranking & data' },
];

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`${viewport.name} app shell`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of routes) {
      test(`loads ${route.path} directly and after reload`, async ({ page }) => {
        await page.goto(route.path);
        await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Sample data' })).toHaveText(
          'Sample data — not real listings',
        );
        await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
          'href',
          '#main-content',
        );

        if (viewport.name === 'desktop') {
          await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
        } else {
          await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
        }

        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Sample data' })).toHaveText(
          'Sample data — not real listings',
        );
      });
    }
  });
}

test('screen navigation keeps the sample data local', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    if (/rentcast|realty|provider/i.test(request.url())) providerRequests.push(request.url());
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Compare', exact: true }).first().click();
  await expect(page).toHaveURL(/\/compare$/);
  await page.getByRole('link', { name: 'Ranking & data', exact: true }).first().click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(providerRequests).toEqual([]);
});

test('navigation can be reached with the keyboard and has a visible focus style', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Ledgerline home' })).toBeFocused();
});

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const routes = [
  { path: '/', title: 'Search' },
  { path: '/compare', title: 'Compare' },
  { path: '/property/sample-property', title: 'Property detail' },
  { path: '/settings', title: 'Settings' },
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
    if (
      /rentcast|realty|provider/i.test(request.url()) &&
      !request.url().endsWith('/api/provider-credentials')
    ) {
      providerRequests.push(request.url());
    }
  });

  await page.goto('/');
  await page.getByRole('link', { name: 'Compare', exact: true }).first().click();
  await expect(page).toHaveURL(/\/compare$/);
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(providerRequests).toEqual([]);
});

test('the desktop sidebar toggles by keyboard, keeps link names, and remembers its state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const sidebar = page.locator('.desktop-sidebar');
  const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.focus();
  await expect(toggle).toBeFocused();
  expect(await toggle.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    'none',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(sidebar).toHaveClass(/is-collapsed/);
  for (const name of ['Search', 'Compare', 'Settings']) {
    const link = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', {
      name,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('title', name);
  }
  await page.reload();
  await expect(page.locator('.desktop-sidebar')).toHaveClass(/is-collapsed/);
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.reload();
  await expect(page.locator('.desktop-sidebar')).not.toHaveClass(/is-collapsed/);
});

test('the package version appears in the sidebar and Settings About section', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/settings');
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  await expect(page.locator('.sidebar-version')).toHaveText(`v${version}`);
  await expect(page.getByRole('region', { name: 'About' })).toContainText(`v${version}`);
});

test('the sidebar is hidden on phones and the bottom Settings tab remains available', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.desktop-sidebar')).toBeHidden();
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test('navigation can be reached with the keyboard and has a visible focus style', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.locator('.desktop-sidebar').getByRole('link', { name: 'Ledgerline home' }),
  ).toBeFocused();
});

test('the web server forwards /api requests to the local API', async ({ request }) => {
  // Without the Vite proxy, /api requests get the app's HTML page instead of API data.
  const response = await request.get('/api/health');
  expect(response.headers()['content-type']).toContain('application/json');
  expect(await response.json()).toEqual({ status: 'ok' });
});

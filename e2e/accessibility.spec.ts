import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

// Wave 1 accessibility (C15): axe on every route, 44 px touch targets, and no empty image
// boxes with the mock provider. Runs against the real API on a seeded temporary database.
let root: string;
let api: Api;
let propertyId: string;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-a11y-'));
  const databasePath = join(root, 'data', 'ledgerline.sqlite');
  seedDatabase(databasePath);
  api = await startApi(databasePath);
  const found = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
    items: Array<{ property: { id: string; street: string } }>;
  };
  propertyId = found.items.find((item) => item.property.street === '2207 NE 32nd Ct')!.property.id;
});

test.afterAll(async () => {
  await api?.stop();
  rmSync(root, { recursive: true, force: true });
});

test('axe reports no serious or critical issues with the desktop sidebar collapsed', async ({
  page,
}) => {
  await routeApiTo(page, () => api);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  expect(
    (await seriousViolations(page)).map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
    })),
  ).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  await routeApiTo(page, () => api);
});

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 900 } },
  { name: 'mobile', size: { width: 390, height: 844 } },
];

const routes = (id: string) => [
  { name: 'Search', path: '/', ready: 'Search' },
  { name: 'Compare', path: `/compare?properties=${id}`, ready: 'Compare' },
  { name: 'Property detail', path: `/property/${id}`, ready: 'Property facts' },
  { name: 'Settings', path: '/settings', ready: 'Backup and restore' },
];

async function open(page: Page, path: string, ready: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: ready }).first()).toBeVisible();
  // Let result cards, the map, and panels finish loading.
  await page.waitForLoadState('networkidle');
}

for (const viewport of viewports) {
  test.describe(`${viewport.name} viewport`, () => {
    test.use({ viewport: viewport.size });

    test('Rent Search notice is visible and passes axe', async ({ page }) => {
      await open(page, '/?mode=rent', 'Search');
      await expect(
        page.getByRole('status').filter({ hasText: 'Rent data may be incomplete' }),
      ).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('Search this address keeps readable contrast in every interaction state', async ({
      page,
    }) => {
      await open(page, `/property/${propertyId}`, 'Property facts');
      const link = page.locator(
        viewport.name === 'desktop'
          ? '.property-desktop-actions a.button-link.secondary-button'
          : '.property-mobile-actions a',
      );
      const contrastViolations = (
        await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
      ).violations
        .flatMap((violation) => violation.nodes)
        .filter((node) =>
          node.target.some(
            (target) =>
              target.includes('.button-link.secondary-button') ||
              target.includes('.property-mobile-actions a'),
          ),
        );
      expect(contrastViolations).toEqual([]);

      const contrastRatio = async () =>
        link.evaluate((element) => {
          const parse = (color: string) =>
            color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number);
          const luminance = (color: string) => {
            const rgb = parse(color).map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
          };
          const style = getComputedStyle(element);
          const foreground = luminance(style.color);
          const background = luminance(style.backgroundColor);
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        });

      const secondaryButtonColors = await page
        .locator('.property-desktop-actions button.secondary-button')
        .first()
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, backgroundColor: style.backgroundColor };
        });
      expect(secondaryButtonColors).toEqual({
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(16, 24, 32)',
      });

      expect(await contrastRatio()).toBeGreaterThanOrEqual(4.5);
      await link.hover();
      expect(await contrastRatio()).toBeGreaterThanOrEqual(4.5);
      await link.focus();
      expect(await contrastRatio()).toBeGreaterThanOrEqual(4.5);
      await page.mouse.down();
      expect(await contrastRatio()).toBeGreaterThanOrEqual(4.5);
      await page.mouse.up();
    });

    for (const route of ['Search', 'Compare', 'Property detail', 'Settings']) {
      test(`axe reports no serious or critical issues on ${route}`, async ({ page }) => {
        const entry = routes(propertyId).find((item) => item.name === route)!;
        await open(page, entry.path, entry.ready);
        expect(
          (await seriousViolations(page)).map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            summary: violation.nodes.slice(0, 5).map((node) => node.failureSummary),
            targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
          })),
        ).toEqual([]);
      });

      test(`every control on ${route} is at least 44 px`, async ({ page }) => {
        const entry = routes(propertyId).find((item) => item.name === route)!;
        await open(page, entry.path, entry.ready);
        const small = await page.evaluate(() => {
          const controls = document.querySelectorAll<HTMLElement>(
            'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
          );
          const result: string[] = [];
          for (const element of controls) {
            // Map pins are SVG; each has an equivalent 44 px "Select ... on map" button on its card
            // (WCAG 2.5.8 equivalent-control exception).
            if (element instanceof SVGElement) continue;
            // A checkbox or radio is operated through its label, so the label is the target.
            const target =
              element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
                ? (element.closest('label') ?? element)
                : element;
            const box = target.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (box.width === 0 || box.height === 0 || style.visibility === 'hidden') continue;
            if (element.classList.contains('skip-link')) continue;
            // Text links inside a sentence are exempt (WCAG 2.5.8 inline exception).
            const parent = element.parentElement;
            if (
              element instanceof HTMLAnchorElement &&
              parent &&
              ['P', 'LI', 'SPAN', 'TD'].includes(parent.tagName) &&
              (parent.textContent ?? '').trim() !== (element.textContent ?? '').trim()
            ) {
              continue;
            }
            if (box.width < 43.5 || box.height < 43.5) {
              const label =
                element.getAttribute('aria-label') ||
                (element.textContent ?? '').trim().slice(0, 40) ||
                element.getAttribute('type') ||
                element.tagName;
              result.push(
                `${element.tagName.toLowerCase()}.${element.className} "${label}" ${Math.round(box.width)}x${Math.round(box.height)}`,
              );
            }
          }
          return result;
        });
        expect(small).toEqual([]);
      });
    }
  });
}

// Serious and critical axe violations. The sticky mobile tab bar covers whatever scrolls under
// it, so axe would count a control that happens to sit at the screen's bottom edge as
// "partially obscured", and which control that is depends on font metrics. With the bar
// showing, the page is checked with it hidden and then the bar on its own. Scroll padding keeps
// focused controls clear of the bar, and a test below checks it never covers the end of a page.
async function seriousViolations(page: Page) {
  const scan = async (builder: AxeBuilder) =>
    (
      await builder
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze()
    ).violations;
  let violations: Awaited<ReturnType<typeof scan>>;
  if (await page.locator('.mobile-nav').isVisible()) {
    const hideBar = await page.addStyleTag({
      content: '.mobile-nav { visibility: hidden !important; }',
    });
    violations = await scan(new AxeBuilder({ page }));
    await hideBar.evaluate((element) => element.remove());
    violations.push(...(await scan(new AxeBuilder({ page }).include('.mobile-nav'))));
  } else {
    violations = await scan(new AxeBuilder({ page }));
  }
  return violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

async function expectNoSeriousViolations(page: Page) {
  expect(
    (await seriousViolations(page)).map((violation) => ({
      id: violation.id,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}

test('axe: Compare with two properties side by side', async ({ page }) => {
  const found = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
    items: Array<{ property: { id: string } }>;
  };
  const ids = found.items.slice(0, 2).map((item) => item.property.id);
  await open(page, `/compare?properties=${ids.join(',')}`, 'Compare');
  await expect(page.getByRole('table')).toBeVisible();
  await expectNoSeriousViolations(page);
});

test('axe: mobile Search in Map view with a selected pin', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/', 'Search');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  // Pins are small and overlap at phone width; the keyboard selects one reliably.
  await page.getByRole('button', { name: /map pin 1 of/ }).focus();
  await page.keyboard.press('Enter');
  const selectedCard = page.locator('.map-selected-card');
  await expect(selectedCard).toBeVisible();
  // Keep the card clear of the fixed bottom tab bar while scanning. Selecting a pin also
  // scrolls the page smoothly, so retry until the card has settled above the bar.
  await expect(async () => {
    await selectedCard.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    const clearance = await page.evaluate(
      () =>
        document.querySelector('.mobile-nav')!.getBoundingClientRect().top -
        document.querySelector('.map-selected-card')!.getBoundingClientRect().bottom,
    );
    expect(clearance).toBeGreaterThan(8);
  }).toPass();
  await expectNoSeriousViolations(page);
});

test('no card or page shows an empty image box with the mock provider', async ({ page }) => {
  const imageBoxes = 'img, picture, video, canvas, [style*="url("]';
  for (const [path, ready] of [
    ['/', 'Search'],
    [`/compare?properties=${propertyId}`, 'Compare'],
    [`/property/${propertyId}`, 'Property facts'],
    ['/settings', 'Backup and restore'],
  ]) {
    await open(page, path, ready);
    await expect(page.locator(imageBoxes), `${path} has no image boxes`).toHaveCount(0);
  }

  // Every result card reads completely without a photo.
  await open(page, '/', 'Search');
  const cards = page.getByRole('group', { name: 'Search results' }).getByRole('article');
  expect(await cards.count()).toBeGreaterThanOrEqual(5);
  for (const card of await cards.all()) {
    await expect(card.locator('.listing-price')).toContainText(/\$\d/);
    await expect(card.locator('.listing-status')).not.toBeEmpty();
    await expect(card.locator('h2 a')).not.toBeEmpty();
    await expect(card.locator('.listing-location')).toContainText(/\d{5}/);
    await expect(card.locator('.listing-facts')).toContainText('bd');
  }
});

test('the fixed mobile tab bar never covers the end of a page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, ready] of [
    ['/', 'Search'],
    [`/compare?properties=${propertyId}`, 'Compare'],
    [`/property/${propertyId}`, 'Property facts'],
    ['/settings', 'Backup and restore'],
  ]) {
    await open(page, path, ready);
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    const { footerBottom, navTop } = await page.evaluate(() => ({
      footerBottom: document.querySelector('.site-footer')!.getBoundingClientRect().bottom,
      navTop: document.querySelector('.mobile-nav')!.getBoundingClientRect().top,
    }));
    expect(footerBottom, `${path}: footer ends above the tab bar`).toBeLessThanOrEqual(navTop + 1);
  }
});

test('axe: Search with the save-search form open', async ({ page }) => {
  await open(page, '/', 'Search');
  await page.getByRole('button', { name: 'Save current search' }).click();
  await expect(page.getByLabel('Saved search name')).toBeVisible();
  await expectNoSeriousViolations(page);
});

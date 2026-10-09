import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDatabase, routeApiTo, seedDatabase, startApi, type Api } from './support/api';

type WeightSet = { mode: string; updatedAt: string | null; weights: Record<string, number> };

// Weights live in the local API's database. Tests that change them keep their own copy, so a
// saved weight never leaks into another test.
async function mockRankingWeights(page: Page) {
  const sets: Record<string, WeightSet> = {
    sale: {
      mode: 'sale',
      updatedAt: null,
      weights: { price: 25, cost: 20, flood: 20, hoa: 15, ins: 10, size: 10 },
    },
    rent: { mode: 'rent', updatedAt: null, weights: { price: 40, flood: 25, lease: 20, size: 15 } },
  };
  await page.route('**/api/ranking-weights', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        mode: string;
        weights: WeightSet['weights'];
      };
      sets[body.mode] = { mode: body.mode, updatedAt: '2026-10-09T12:00:00.000Z', ...body };
    }
    await route.fulfill({ json: { weights: sets } });
  });
}

const sale = (price: number, street: string): object => ({
  property: {
    id: street,
    street,
    unit: null,
    city: 'Fort Lauderdale',
    zip: '33308',
    county: 'Broward',
    propertyType: 'single_family',
    beds: 3,
    bathsTotal: 2,
    livingAreaSqft: 1850,
    yearBuilt: 1964,
  },
  listing: {
    id: street,
    mode: 'sale',
    price,
    pricePeriod: 'total',
    status: 'active',
    provider: 'mock',
    providerLastSeenDate: '2026-10-06',
  },
});
const rent = {
  property: {
    id: 'rent-home',
    street: '2207 NE 32nd Ct',
    unit: null,
    city: 'Fort Lauderdale',
    zip: '33308',
    county: 'Broward',
    propertyType: 'single_family',
    beds: 3,
    bathsTotal: 2,
    livingAreaSqft: 1850,
    yearBuilt: 1964,
  },
  listing: {
    id: 'rent-home',
    mode: 'rent',
    price: 5200,
    pricePeriod: 'month',
    status: 'active',
    provider: 'mock',
    providerLastSeenDate: '2026-10-06',
  },
};

test('Buy and Rent switch preserve separate price ranges and the URL', async ({ page }) => {
  await page.route('**/api/listings/capabilities', (route) =>
    route.fulfill({ json: { waterfront: false, yearBuilt: false, hoaFee: false } }),
  );
  await page.route('**/api/listings?**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: {
        items: url.searchParams.get('mode') === 'rent' ? [rent] : [sale(849000, '2207 NE 32nd Ct')],
      },
    });
  });

  await page.goto('/');
  await page.getByLabel('Price minimum').fill('250000');
  await expect(page).toHaveURL(/priceMin=250000/);
  await page.getByRole('button', { name: 'Rent', exact: true }).click();
  await expect(page.getByLabel('Rent minimum')).toHaveValue('');
  await page.getByLabel('Rent minimum').fill('3000');
  await expect(page.locator('.listing-card .listing-price')).toHaveText('$5,200/mo');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByLabel('Price minimum')).toHaveValue('250000');
  await expect(page).toHaveURL(/mode=sale.*priceMin=250000/);
});

test('price sorting changes the query and shows full photo-free result cards', async ({ page }) => {
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: {
        items:
          url.searchParams.get('sort') === 'price'
            ? [sale(285000, '3250 NE 2nd Ave'), sale(389000, '2801 N Ocean Dr')]
            : [sale(389000, '2801 N Ocean Dr'), sale(285000, '3250 NE 2nd Ave')],
      },
    });
  });

  await page.goto('/');
  await page.getByLabel('Sort listings').selectOption('price');
  await expect(page).toHaveURL(/sort=price/);
  await expect(page.locator('.listing-price').first()).toHaveText('$285,000');
  await expect(
    page.locator('.listing-card').getByRole('link', { name: 'NE 2nd Ave' }),
  ).toBeVisible();
  await expect(page.locator('.listing-facts').first()).toContainText('3 bd');
  await expect(page.locator('.listing-facts').first()).toContainText('1,850 sq ft');
});

test('score ranks stay attached to listings when the display sort changes', async ({ page }) => {
  const high = sale(800000, 'High price home') as {
    property: { floodZone?: string | null };
  };
  const low = sale(200000, 'Low price home') as {
    property: { floodZone?: string | null };
  };
  high.property.floodZone = 'X';
  low.property.floodZone = 'X';
  await mockRankingWeights(page);
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  // The API orders Newest and Price; "Your score" asks it for Newest and reorders by rank.
  await page.route('**/api/listings?**', (route) =>
    route.fulfill({
      json: {
        items:
          new URL(route.request().url()).searchParams.get('sort') === 'price'
            ? [low, high]
            : [high, low],
      },
    }),
  );

  await page.goto('/?sort=score');
  const cards = page.locator('.listing-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('.listing-price')).toHaveText('$200,000');
  await expect(cards.nth(0).locator('.ranking-summary strong')).toContainText('#1');
  await expect(cards.nth(1).locator('.ranking-summary strong')).toContainText('#2');
  // The top-ranked card is the one selected first.
  await expect(cards.nth(0)).toHaveClass(/is-selected/);

  // Newest puts the #2 home first without changing either label.
  await page.getByLabel('Sort listings').selectOption('newest');
  await expect(page).toHaveURL(/sort=newest/);
  await expect(cards.nth(0).locator('.listing-price')).toHaveText('$800,000');
  await expect(cards.nth(0).locator('.ranking-summary strong')).toContainText('#2');
  await expect(cards.nth(1).locator('.ranking-summary strong')).toContainText('#1');

  await page.getByLabel('Sort listings').selectOption('price');
  await expect(page).toHaveURL(/sort=price/);
  await expect(cards.nth(0).locator('.listing-price')).toHaveText('$200,000');
  await expect(cards.nth(0).locator('.ranking-summary strong')).toContainText('#1');
  await expect(cards.nth(1).locator('.ranking-summary strong')).toContainText('#2');
});

test('changing a ranking weight updates scores and rank order', async ({ page }) => {
  const small = sale(200000, 'Smaller home') as {
    property: { livingAreaSqft?: number; floodZone?: string | null };
  };
  const large = sale(800000, 'Larger home') as {
    property: { livingAreaSqft?: number; floodZone?: string | null };
  };
  small.property.livingAreaSqft = 1000;
  large.property.livingAreaSqft = 4000;
  small.property.floodZone = 'X';
  large.property.floodZone = 'X';
  await mockRankingWeights(page);
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) =>
    route.fulfill({ json: { items: [small, large] } }),
  );

  await page.goto('/');
  const cards = page.locator('.listing-card');
  await expect(cards.first().getByRole('link', { name: 'Smaller home' })).toBeVisible();
  await page.goto('/settings');
  const panel = page.getByRole('region', { name: 'Ranking weights' });
  const live = panel.getByRole('listitem');
  await expect(live.first()).toContainText('Smaller home');
  for (const factor of ['price', 'own-vs-rent cost', 'flood', 'HOA', 'insurance'])
    await panel.getByLabel(`${factor} weight`).fill('0');
  await panel.getByLabel('living area weight').fill('100');
  // The live ranking follows the edits before they are saved.
  await expect(live.first()).toContainText('Larger home');
  await panel.getByRole('button', { name: 'Save Buy weights' }).click();
  await expect(panel.getByRole('status')).toHaveText('Saved');

  await page.goto('/?sort=score');
  await expect(cards.first().getByRole('link', { name: 'Larger home' })).toBeVisible();
  await expect(cards.first().locator('.ranking-summary strong')).toContainText('#1');
  const breakdown = cards.first().getByRole('list', { name: 'Score breakdown' });
  await expect(breakdown.getByRole('listitem').filter({ hasText: 'living area' })).toContainText(
    '100 pts · 100/100',
  );
  await expect(breakdown.getByRole('listitem').filter({ hasText: 'price' })).toContainText('0 pts');
});

test('sample listings show computed ranks and provisional reasons from local data only', async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-ranking-'));
  const databasePath = join(root, 'ledgerline.sqlite');
  let api: Api | undefined;
  try {
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    await routeApiTo(page, () => api!);
    await page.goto('/?sort=price');
    const card = (name: string) =>
      page.locator('.listing-card').filter({ has: page.getByRole('link', { name }) });

    // Acceptance 3.8 and 3.9: the reasons appear on the card, not only in the breakdown.
    await expect(card('1460 NE 135th St').locator('.provisional-tag')).toHaveText(
      'Provisional · 1 factor unknown: comparable rent',
    );
    const miami = card('3250 NE 2nd Ave, Unit 507');
    await expect(miami.locator('.provisional-tag')).toContainText('check price per sq ft');
    await miami.getByRole('button', { name: 'Select 3250 NE 2nd Ave on map' }).click();
    await expect(
      miami
        .getByRole('list', { name: 'Score breakdown' })
        .getByRole('listitem')
        .filter({ hasText: 'living area' }),
    ).toContainText('Unknown · scored 0');

    // Rank labels follow score order, whatever the sort.
    for (const sort of ['price', 'newest', 'score']) {
      await page.getByLabel('Sort listings').selectOption(sort);
      await expect(page).toHaveURL(new RegExp(`sort=${sort}`));
      const ranked = (await page.locator('.ranking-summary strong').allTextContents())
        .map((text) => /#(\d+) · score (\d+)/.exec(text)!)
        .map((match) => ({ rank: Number(match[1]), score: Number(match[2]) }))
        .sort((left, right) => left.rank - right.rank);
      expect(ranked.map((item) => item.rank)).toEqual(ranked.map((_, index) => index + 1));
      expect(ranked.map((item) => item.score)).toEqual(
        ranked.map((item) => item.score).sort((left, right) => right - left),
      );
    }

    // Ranking and sorting read local data only.
    const database = await readDatabase(databasePath);
    expect(database.rows('SELECT COUNT(*) AS n FROM provider_request_logs')).toEqual([{ n: 0 }]);
    database.close();
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('purchase cards show cost, certainty, comparable-rent gap, and risk labels in grayscale', async ({
  page,
}) => {
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...sale(849000, '2207 NE 32nd Ct'),
            property: {
              ...sale(849000, '2207 NE 32nd Ct').property,
              floodZone: 'AE',
              riskDetails: { roofYear: 2020, specialAssessment: null },
            },
            comparableRent: {
              figure: { value: 5200 },
              label: 'same home · listed Sep 28',
              stale: false,
            },
            costEstimate: {
              lines: [
                {
                  key: 'flood',
                  label: 'Flood insurance',
                  monthly: 180,
                  state: 'Est.',
                  note: 'Enter a quote',
                },
              ],
              totalStatus: 'Estimate',
              statusLabel: 'Estimate · needs flood quote',
              totalLabel: '$7,171/mo',
              monthlyTotal: 7171,
              knownSubtotal: 7171,
              upfrontCash: 169800,
              upfrontLabel: '$169,800',
            },
          },
        ],
      },
    }),
  );

  await page.goto('/');
  await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });
  const card = page.locator('.listing-card');
  await expect(card.getByText('Est. monthly to own')).toBeVisible();
  await expect(card.getByText('$7,171/mo')).toBeVisible();
  await expect(card.getByText('Estimate · needs flood quote')).toBeVisible();
  await expect(card.getByText('≈ +$1,971/mo')).toBeVisible();
  await expect(card.getByText('Flood zone AE')).toBeVisible();
  await expect(card.getByText('Roof 2020')).toBeVisible();
});

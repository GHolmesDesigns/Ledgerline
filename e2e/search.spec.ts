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
  await expect(
    page.getByRole('status').filter({ hasText: 'Rent data may be incomplete' }),
  ).toHaveCount(0);
  await page.getByLabel('Price minimum').fill('250000');
  await expect(page).toHaveURL(/priceMin=250000/);
  await page.getByRole('button', { name: 'Rent', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Rent data may be incomplete' }),
  ).toBeVisible();
  await expect(page.getByLabel('Rent minimum')).toHaveValue('');
  await page.getByLabel('Rent minimum').fill('3000');
  await expect(page.locator('.listing-card .listing-price')).toHaveText('$5,200/mo');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Rent data may be incomplete' }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Price minimum')).toHaveValue('250000');
  await expect(page).toHaveURL(/mode=sale.*priceMin=250000/);
});

test('Rent data notice stays visible on mobile with no matching listings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mode=rent&location=00000');
  await expect(page.getByText('No listings match these filters.')).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Rent data may be incomplete' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Rent data may be incomplete' }),
  ).toHaveCount(0);
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

test('lot size, year, and days filters persist in the URL and saved searches', async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.route('**/api/saved-searches', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      saved = {
        ...body,
        id: 8,
        pairedSearchId: null,
        lastSuccessfulRefreshAt: null,
        lastRefreshAttemptAt: null,
        lastRefreshError: null,
      };
      await route.fulfill({ status: 201, json: { item: saved } });
      return;
    }
    await route.fulfill({ json: { items: saved ? [saved] : [] } });
  });
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: [] } }));

  await page.goto('/');
  await page.getByLabel('Minimum lot size').fill('4000');
  await page.getByLabel('Maximum lot size').fill('9000');
  await page.getByLabel('Year built minimum').fill('1990');
  await page.getByLabel('Year built maximum').fill('2020');
  await page.getByLabel('Listed within days').fill('30');
  await expect(page).toHaveURL(/minLotSize=4000/);
  await expect(page).toHaveURL(/maxLotSize=9000/);
  await expect(page).toHaveURL(/yearBuiltMin=1990/);
  await expect(page).toHaveURL(/yearBuiltMax=2020/);
  await expect(page).toHaveURL(/daysOnMarket=30/);
  await expect(page.getByRole('button', { name: 'Remove Lot ≥ 4,000 sq ft' })).toBeVisible();

  await page.getByRole('button', { name: 'Save current search' }).click();
  await page.getByLabel('Saved search name').fill('Recent homes');
  await page.getByRole('button', { name: 'Save search' }).click();
  await expect
    .poll(() => saved)
    .toMatchObject({
      filters: {
        minLotSize: '4000',
        maxLotSize: '9000',
        yearBuiltMin: '1990',
        yearBuiltMax: '2020',
        daysOnMarket: '30',
      },
    });
  await page.reload();
  await page.getByLabel('Open saved search').selectOption('8');
  await expect(page.getByLabel('Minimum lot size')).toHaveValue('4000');
  await expect(page.getByLabel('Year built maximum')).toHaveValue('2020');
  await expect(page.getByLabel('Listed within days')).toHaveValue('30');
});

test('personal tag filters require every selected tag and persist through reload and saved searches', async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-tag-filter-e2e-'));
  const databasePath = join(root, 'ledgerline.sqlite');
  let api: Api | undefined;
  try {
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    const catalog = (await (await fetch(api.url('/api/personal-tags'))).json()) as {
      customTags: string[];
    };
    if (!catalog.customTags.includes('Near water')) {
      await fetch(api.url('/api/personal-tags'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Near water' }),
      });
    }
    const results = (await (await fetch(api.url('/api/listings?mode=sale'))).json()) as {
      items: Array<{ property: { id: string; city: string } }>;
    };
    const [first, second] = results.items;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    for (const [item, tags] of [
      [first!, ['Pool', 'Near water']],
      [second!, ['Pool']],
    ] as const) {
      for (const tag of tags)
        await fetch(api.url(`/api/properties/${item.property.id}/tags`), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: tag, enabled: true }),
        });
    }
    await routeApiTo(page, () => api!);
    await page.goto('/');
    await page.getByLabel('City or ZIP').fill(first!.property.city);
    await page
      .getByLabel('Pool', { exact: true })
      .evaluate((element) => (element as HTMLInputElement).click());
    await expect(page.getByLabel('Pool', { exact: true })).toBeChecked();
    await page
      .getByLabel('Near water', { exact: true })
      .evaluate((element) => (element as HTMLInputElement).click());
    await expect(page.getByLabel('Near water', { exact: true })).toBeChecked();
    await expect(page).toHaveURL(/tag=Pool/);
    await expect(page).toHaveURL(/tag=Near\+water|tag=Near%20water/);
    await expect(page.locator('.listing-card')).toHaveCount(1);
    await page.reload();
    await expect(page.getByLabel('Pool', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Near water', { exact: true })).toBeChecked();
    await expect(page.locator('.listing-card')).toHaveCount(1);

    await page.getByRole('button', { name: 'Save current search' }).click();
    await page.getByLabel('Saved search name').fill('Pool with water');
    await page.getByRole('button', { name: 'Save search' }).click();
    await expect(page.getByLabel('Open saved search')).not.toHaveValue('');
    const savedSearchId = await page.getByLabel('Open saved search').inputValue();
    const savedSearches = (await (await fetch(api.url('/api/saved-searches'))).json()) as {
      items: Array<{ id: number; filters: Record<string, unknown> }>;
    };
    expect(
      savedSearches.items.find((item) => String(item.id) === savedSearchId)?.filters.selectedTags,
    ).toEqual(['Pool', 'Near water']);
    await page
      .getByLabel('Pool', { exact: true })
      .evaluate((element) => (element as HTMLInputElement).click());
    await page
      .getByLabel('Near water', { exact: true })
      .evaluate((element) => (element as HTMLInputElement).click());
    await page.getByLabel('Open saved search').selectOption('');
    await page.getByLabel('Open saved search').selectOption(savedSearchId);
    await expect(page).toHaveURL(/tag=Pool/);
    await expect(page).toHaveURL(/tag=Near\+water|tag=Near%20water/);
    await expect(page.locator('.listing-card')).toHaveCount(1);
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('inverted filter ranges show inline errors without requesting listings', async ({ page }) => {
  let searches = 0;
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', async (route) => {
    searches += 1;
    await route.fulfill({ json: { items: [] } });
  });
  await page.goto('/');
  await page.getByLabel('Minimum lot size').fill('9000');
  await page.getByLabel('Maximum lot size').fill('1000');
  const callsAtInvalidRange = searches;
  await expect(page.getByText('Minimum lot size cannot exceed maximum.')).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Correct the filter values' }),
  ).toBeVisible();
  await page.waitForTimeout(100);
  expect(searches).toBe(callsAtInvalidRange);
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
  const price = panel.getByRole('slider', { name: 'price weight' });
  await price.focus();
  await price.press('ArrowRight');
  await expect(price.locator('..').locator('.ranking-weight-value')).toHaveText('26');
  for (const factor of ['price', 'own-vs-rent cost', 'flood', 'HOA', 'insurance']) {
    const slider = panel.getByRole('slider', { name: `${factor} weight` });
    await slider.focus();
    await slider.press('Home');
    await expect(slider.locator('..').locator('.ranking-weight-value')).toHaveText('0');
  }
  const size = panel.getByRole('slider', { name: 'living area weight' });
  await size.focus();
  await size.press('End');
  await expect(size.locator('..').locator('.ranking-weight-value')).toHaveText('100');
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

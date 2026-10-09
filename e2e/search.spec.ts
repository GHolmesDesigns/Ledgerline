import { expect, test } from '@playwright/test';

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
  await expect(page.getByText('3250 NE 2nd Ave')).toBeVisible();
  await expect(page.locator('.listing-facts').first()).toContainText('3 bd');
  await expect(page.locator('.listing-facts').first()).toContainText('1,850 sq ft');
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

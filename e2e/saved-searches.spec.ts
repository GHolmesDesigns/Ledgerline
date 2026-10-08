import { expect, test } from '@playwright/test';

test('saves and reopens a search profile with its filters', async ({ page }) => {
  const saved: Array<Record<string, unknown>> = [];
  let nextId = 1;
  await page.route('**/api/saved-searches**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') return route.fulfill({ json: { items: saved } });
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      const item = { ...body, id: nextId++, pairedSearchId: null };
      saved.push(item);
      return route.fulfill({ status: 201, json: { item } });
    }
    const segments = url.pathname.split('/');
    const id = Number(segments.at(-1) === 'pair' ? segments.at(-2) : segments.at(-1));
    if (request.method() === 'PATCH') {
      const item = saved.find((search) => search.id === id);
      const body = request.postDataJSON() as Record<string, unknown>;
      if (url.pathname.endsWith('/pair')) {
        const paired = saved.find((search) => search.id === body.pairedSearchId);
        if (item && paired) {
          item.pairedSearchId = paired.id;
          paired.pairedSearchId = item.id;
        }
      } else if (item) Object.assign(item, body);
      return route.fulfill({ json: { item } });
    }
    if (request.method() === 'DELETE') {
      const index = saved.findIndex((search) => search.id === id);
      if (index >= 0) saved.splice(index, 1);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', (route) => route.fulfill({ json: { items: [] } }));

  await page.goto('/?mode=sale&location=Miami+33131&priceMin=250000&priceMax=900000&beds=2');
  await page.getByRole('button', { name: 'Save current search' }).click();
  await page.getByLabel('Saved search name').fill('Miami two bedroom');
  await page.getByLabel('Saved search refresh interval').selectOption('7');
  await page.getByRole('button', { name: 'Save search', exact: true }).click();
  await expect(page.getByLabel('Open saved search')).toHaveValue('1');

  await page.goto('/');
  await page.getByLabel('Open saved search').selectOption('1');
  await expect(page.getByLabel('City or ZIP')).toHaveValue('Miami 33131');
  await expect(page.getByLabel('Price minimum')).toHaveValue('250000');
  await expect(page.getByLabel('Price maximum')).toHaveValue('900000');
  await expect(page.getByLabel('Minimum bedrooms')).toHaveValue('2');
  await page.reload();
  await page.getByLabel('Open saved search').selectOption('1');
  await expect(page.getByLabel('City or ZIP')).toHaveValue('Miami 33131');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add Rent search' }).click();
  await expect(page.getByText('Paired Rent search on · Miami 33131 · Rent')).toBeVisible();
  await page.goto('/');
  await page.getByLabel('Open saved search').selectOption('1');
  await expect(page.getByText(/Paired Rent search on · needed for local comps/)).toBeVisible();
});

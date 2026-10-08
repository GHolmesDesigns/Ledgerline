import { expect, test } from '@playwright/test';

test('property save, dismissal, and notes persist across a restart', async ({ page }) => {
  const property = {
    id: 'prop_1',
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
    latitude: 26.15,
    longitude: -80.12,
  };
  const listings = [
    {
      id: 'sale-1',
      mode: 'sale',
      price: 849000,
      pricePeriod: 'total',
      status: 'active',
      provider: 'mock',
      providerLastSeenDate: '2026-10-06',
    },
    {
      id: 'rent-1',
      mode: 'rent',
      price: 5200,
      pricePeriod: 'month',
      status: 'active',
      provider: 'mock',
      providerLastSeenDate: '2026-10-06',
    },
  ];
  let saved = false;
  let dismissed = false;
  let nextNoteId = 1;
  const notes: Array<{
    id: number;
    propertyId: string;
    body: string;
    createdAt: string;
    updatedAt: string;
  }> = [];

  await page.route('**/api/listings/capabilities', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/listings?**', async (route) => {
    const url = new URL(route.request().url());
    const listing = listings.find((item) => item.mode === url.searchParams.get('mode'))!;
    const visible =
      (!dismissed || url.searchParams.get('showDismissed') === 'true') &&
      (!url.searchParams.has('savedOnly') || saved);
    await route.fulfill({
      json: { items: visible ? [{ property, listing, saved, dismissed }] : [] },
    });
  });
  await page.route('**/api/properties/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      return route.fulfill({ json: { property, listings, notes, saved, dismissed } });
    }
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { saved?: boolean; dismissed?: boolean };
      if (body.saved !== undefined) saved = body.saved;
      if (body.dismissed !== undefined) dismissed = body.dismissed;
      return route.fulfill({ json: { saved, dismissed } });
    }
    if (url.pathname.endsWith('/notes') && request.method() === 'POST') {
      const body = request.postDataJSON() as { body: string };
      const timestamp = new Date().toISOString();
      const note = {
        id: nextNoteId++,
        propertyId: property.id,
        body: body.body,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      notes.push(note);
      return route.fulfill({ status: 201, json: { note } });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  await page.route('**/api/notes/**', async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    if (route.request().method() === 'PATCH') {
      const note = notes.find((entry) => entry.id === id)!;
      note.body = (route.request().postDataJSON() as { body: string }).body;
      note.updatedAt = new Date().toISOString();
      return route.fulfill({ json: { updated: true } });
    }
    if (route.request().method() === 'DELETE') {
      const index = notes.findIndex((entry) => entry.id === id);
      if (index >= 0) notes.splice(index, 1);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Save 2207 NE 32nd Ct/ }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Dismiss 2207 NE 32nd Ct/ }).click();
  await expect(page.getByText('No listings match these filters.')).toBeVisible();
  await page.getByLabel('Show dismissed').check();
  await expect(
    page.getByRole('button', { name: /Undo dismissal for 2207 NE 32nd Ct/ }),
  ).toBeVisible();
  await page.getByLabel('Saved only').check();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.goto('/property/prop_1');
  await expect(page.getByRole('heading', { name: '2207 NE 32nd Ct' })).toBeVisible();
  await expect(page.getByText('Buy', { exact: true })).toBeVisible();
  await expect(page.getByText('Rent', { exact: true })).toBeVisible();
  await page.getByLabel('Add a note').fill('Ask about the roof');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Ask about the roof')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit note 1').fill('Roof is 2020');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Roof is 2020')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Roof is 2020')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo dismissal' })).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeApiTo, seedDatabase, startApi, type Api } from './support/api';

test('edits local rates and saves them with a source and date', async ({ page }) => {
  const root = mkdtempSync(join(tmpdir(), 'ledgerline-e2e-assumptions-'));
  let api: Api | undefined;
  try {
    const databasePath = join(root, 'ledgerline.sqlite');
    seedDatabase(databasePath);
    api = await startApi(databasePath);
    await routeApiTo(page, () => api!);
    await page.goto('/settings');

    await expect(page.getByText('Not set · Set local rates')).toBeVisible();
    const broward = page.getByRole('form', { name: 'Broward local assumptions' });
    await broward.getByLabel('Millage').fill('18.75');
    await broward.getByLabel('Source').fill('Broward tax collector');
    await broward.getByLabel('Date set').fill('2026-10-09');
    await expect(broward.getByLabel('Millage')).toHaveValue('18.75');
    await expect(broward.getByLabel('Source')).toHaveValue('Broward tax collector');
    await broward.getByRole('button', { name: 'Save local rates' }).click();
    await expect(broward.getByRole('status')).toContainText('Saved');
    await expect(broward.getByText('Broward tax collector · set 2026-10-09')).toBeVisible();

    const rates = (await (await fetch(api.url('/api/assumptions'))).json()) as {
      local: Array<{
        county: string;
        millage: number | null;
        source: string | null;
        setOn: string | null;
        sample: boolean;
      }>;
    };
    expect(rates.local.find((item) => item.county === 'Broward')).toMatchObject({
      millage: 18.75,
      source: 'Broward tax collector',
      setOn: '2026-10-09',
      sample: false,
    });
  } finally {
    await api?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

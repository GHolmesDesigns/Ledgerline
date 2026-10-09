import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LocalAssumptions, PersonalAssumptions, Store } from './store.js';

const fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/sample-data.json', import.meta.url)),
    'utf8',
  ),
) as {
  personalAssumptions: PersonalAssumptions;
  localAssumptions: Array<{
    county: string;
    set: boolean;
    sample?: boolean;
    pricePerSqftMin?: number;
    pricePerSqftMax?: number;
    millage?: number;
    typicalNonAdValoremPerYear?: number;
    homeownersDefaultMonthly?: number;
    ho6DefaultMonthly?: number;
    floodDefaultMonthly?: Record<string, number>;
    source?: string;
    setOn?: string;
  }>;
};

export const defaultPersonalAssumptions = fixtures.personalAssumptions;

export function seedAssumptions(store: Store) {
  let searches: ReturnType<Store['listSavedSearches']>;
  let localRows: ReturnType<Store['listLocalAssumptions']>;
  try {
    searches = store.listSavedSearches();
    localRows = store.listLocalAssumptions();
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table')) return;
    throw error;
  }
  for (const search of searches) {
    if (!store.getPersonalAssumptions(search.id)) {
      store.setPersonalAssumptions(search.id, defaultPersonalAssumptions);
    }
  }
  const existing = new Map(localRows.map((item) => [item.county.toLocaleLowerCase('en-US'), item]));
  for (const row of fixtures.localAssumptions) {
    const assumption: LocalAssumptions = {
      county: row.county,
      set: row.set,
      millage: row.millage ?? null,
      typicalNonAdValoremPerYear: row.typicalNonAdValoremPerYear ?? null,
      homeownersDefaultMonthly: row.homeownersDefaultMonthly ?? null,
      ho6DefaultMonthly: row.ho6DefaultMonthly ?? null,
      floodDefaultMonthly: row.floodDefaultMonthly ?? {},
      source: row.source ?? null,
      setOn: row.setOn ?? null,
      sample: row.sample === true,
      pricePerSqftMin: row.pricePerSqftMin ?? null,
      pricePerSqftMax: row.pricePerSqftMax ?? null,
    };
    const current = existing.get(assumption.county.toLocaleLowerCase('en-US'));
    if (!current) {
      store.setLocalAssumption(assumption);
    } else if (
      // A sample row the user never edited follows the fixture's sample range.
      current.sample &&
      assumption.pricePerSqftMin != null &&
      assumption.pricePerSqftMax != null &&
      (current.pricePerSqftMin !== assumption.pricePerSqftMin ||
        current.pricePerSqftMax !== assumption.pricePerSqftMax)
    ) {
      store.setLocalAssumption({
        ...current,
        pricePerSqftMin: assumption.pricePerSqftMin,
        pricePerSqftMax: assumption.pricePerSqftMax,
      });
    }
  }
}

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
  for (const search of store.listSavedSearches()) {
    if (!store.getPersonalAssumptions(search.id)) {
      store.setPersonalAssumptions(search.id, defaultPersonalAssumptions);
    }
  }
  const existing = new Set(
    store.listLocalAssumptions().map((item) => item.county.toLocaleLowerCase('en-US')),
  );
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
    };
    if (!existing.has(assumption.county.toLocaleLowerCase('en-US')))
      store.setLocalAssumption(assumption);
  }
}

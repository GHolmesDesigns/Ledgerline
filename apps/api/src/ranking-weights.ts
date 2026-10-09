import type { ListingMode } from './store.js';

// Personal ranking weights (C35). The factors and defaults are fixed by plan 2.8; the browser
// scores listings from these weights, and only the weights themselves are stored here.

export const rankingFactors = {
  sale: ['price', 'cost', 'flood', 'hoa', 'ins', 'size'],
  rent: ['price', 'flood', 'lease', 'size'],
} as const satisfies Record<ListingMode, readonly string[]>;

export type RankingWeights = Record<string, number>;

export const defaultRankingWeights: Record<ListingMode, RankingWeights> = {
  sale: { price: 25, cost: 20, flood: 20, hoa: 15, ins: 10, size: 10 },
  rent: { price: 40, flood: 25, lease: 20, size: 15 },
};

/** The mode's weights as whole numbers from 0 to 100, or null if any factor is missing or invalid. */
export function readRankingWeights(mode: ListingMode, value: unknown): RankingWeights | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const weights: RankingWeights = {};
  for (const factor of rankingFactors[mode]) {
    const amount = record[factor];
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > 100)
      return null;
    weights[factor] = amount;
  }
  return weights;
}

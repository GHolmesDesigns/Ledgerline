export type RankingMode = 'sale' | 'rent';
export type RankingFactor = 'price' | 'cost' | 'flood' | 'hoa' | 'ins' | 'lease' | 'size';
export type RankingWeights = Record<RankingFactor, number>;

// The factors each mode scores, in breakdown order (plan 2.8).
export const rankingFactors: Record<RankingMode, RankingFactor[]> = {
  sale: ['price', 'cost', 'flood', 'hoa', 'ins', 'size'],
  rent: ['price', 'flood', 'lease', 'size'],
};

// The plan's defaults. The local API stores the weights in use; these are the same values.
export const defaultRankingWeights: Record<RankingMode, RankingWeights> = {
  sale: { price: 25, cost: 20, flood: 20, hoa: 15, ins: 10, lease: 0, size: 10 },
  rent: { price: 40, cost: 0, flood: 25, hoa: 0, ins: 0, lease: 20, size: 15 },
};

export const rankingFactorLabels: Record<RankingFactor, string> = {
  price: 'price',
  cost: 'own-vs-rent cost',
  flood: 'flood',
  hoa: 'HOA',
  ins: 'insurance',
  lease: 'lease fit',
  size: 'living area',
};

export type RankingInput = {
  property: {
    id: string;
    propertyType?: string | null;
    beds?: number | null;
    livingAreaSqft?: number | null;
    floodZone?: string | null;
  };
  listing: {
    id: string;
    mode: RankingMode;
    price: number | null;
    pricePeriod?: string | null;
    hoaFee?: number | null;
    implausibleFlags?: Array<{ field: string; reason: string; resolved?: boolean }>;
  };
  comparableRent?: { figure: { value: number | null; source?: string } } | null;
  costEstimate?: {
    totalStatus: 'Calculated' | 'Estimate' | 'Incomplete';
    monthlyTotal: number | null;
    lines: Array<{ key: string; monthly: number | null; state: string }>;
  } | null;
};

export type FactorScore = { score: number; unknown: boolean; weightedPoints: number };
export type ListingRanking = {
  score: number;
  rank: number;
  factors: Partial<Record<RankingFactor, FactorScore>>;
  provisional: boolean;
  provisionalReason: string | null;
};

function normalizedRent(price: number | null, period?: string | null) {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (period === 'week') return (price * 52) / 12;
  if (period === 'year') return price / 12;
  return price;
}

function floodScore(zone: string | null | undefined) {
  const normalized = zone?.trim().toUpperCase();
  if (normalized === 'X') return 100;
  if (normalized === 'X500') return 80;
  if (['A', 'AE', 'AH', 'AO'].includes(normalized ?? '')) return 40;
  if (['V', 'VE'].includes(normalized ?? '')) return 10;
  return null;
}

export function rankListings<T extends RankingInput>(
  items: T[],
  mode: RankingMode,
  weights: RankingWeights = defaultRankingWeights[mode],
): Map<string, ListingRanking> {
  const factors = rankingFactors[mode];
  const raw = items.map((item) => {
    const price = normalizedRent(item.listing.price, item.listing.pricePeriod);
    const rent = item.comparableRent?.figure.value ?? null;
    const cost =
      item.costEstimate?.totalStatus === 'Incomplete'
        ? null
        : (item.costEstimate?.monthlyTotal ?? null);
    const hoaLine = item.costEstimate?.lines.find((line) => line.key.toLowerCase() === 'hoa');
    const insuranceLine = item.costEstimate?.lines.find((line) =>
      ['homeowners', 'ho6', 'insurance'].includes(line.key.toLowerCase()),
    );
    const sizeIsFlagged =
      item.listing.implausibleFlags?.some(
        (flag) => !flag.resolved && flag.field === 'livingAreaSqft',
      ) ?? false;
    return {
      item,
      base: {
        price,
        cost:
          cost != null && rent != null && rent > 0
            ? Math.max(0, Math.min(100, 200 - (100 * cost) / rent))
            : null,
        flood: floodScore(item.property.floodZone),
        hoa:
          item.listing.hoaFee ??
          (hoaLine?.state === 'Not applicable' || hoaLine?.state === 'N/A'
            ? 0
            : (hoaLine?.monthly ?? null)),
        ins: insuranceLine?.monthly ?? null,
        lease: null,
        size:
          !sizeIsFlagged && item.property.livingAreaSqft != null && item.property.livingAreaSqft > 0
            ? item.property.livingAreaSqft
            : null,
      } as Record<RankingFactor, number | null>,
      hasFlag: (item.listing.implausibleFlags ?? []).some((flag) => !flag.resolved),
      flagReasons: [
        ...new Set(
          (item.listing.implausibleFlags ?? [])
            .filter((flag) => !flag.resolved)
            .map((flag) => flag.reason),
        ),
      ],
    };
  });
  const lowerIsBetter = new Set<RankingFactor>(['price', 'hoa', 'ins']);
  const normalized = raw.map(({ base }) => {
    const result: Partial<Record<RankingFactor, FactorScore>> = {};
    for (const factor of factors) {
      const value = base[factor];
      if (value == null || !Number.isFinite(value)) {
        result[factor] = { score: 0, unknown: true, weightedPoints: 0 };
        continue;
      }
      if (factor === 'cost' || factor === 'flood') {
        result[factor] = { score: Math.round(value), unknown: false, weightedPoints: 0 };
        continue;
      }
      const values = raw
        .map(({ base: candidate }) => candidate[factor])
        .filter(
          (candidate): candidate is number => candidate != null && Number.isFinite(candidate),
        );
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const score =
        minimum === maximum
          ? 100
          : lowerIsBetter.has(factor)
            ? (100 * (maximum - value)) / (maximum - minimum)
            : (100 * (value - minimum)) / (maximum - minimum);
      result[factor] = {
        score: Math.round(Math.max(0, Math.min(100, score))),
        unknown: false,
        weightedPoints: 0,
      };
    }
    return result;
  });
  const ranked = raw.map(({ item, hasFlag, flagReasons }, index) => {
    const itemFactors = normalized[index]!;
    const activeWeight = factors.reduce((total, factor) => total + weights[factor], 0) || 1;
    for (const factor of factors) {
      const result = itemFactors[factor];
      if (result)
        result.weightedPoints = Number(
          ((result.score * weights[factor]) / activeWeight).toFixed(1),
        );
    }
    const score = Math.round(
      factors.reduce(
        (total, factor) => total + (itemFactors[factor]?.score ?? 0) * weights[factor],
        0,
      ) / activeWeight,
    );
    const unknownFactors = factors.filter((factor) => itemFactors[factor]?.unknown);
    const reasons = [
      ...(unknownFactors.length
        ? [
            `${unknownFactors.length} factor${unknownFactors.length === 1 ? '' : 's'} unknown: ${unknownFactors
              .map((factor) => {
                if (factor === 'cost') {
                  if (item.costEstimate?.totalStatus === 'Incomplete')
                    return 'own-vs-rent gap (incomplete total)';
                  if (item.comparableRent?.figure.value == null) return 'comparable rent';
                }
                return rankingFactorLabels[factor];
              })
              .join(', ')}`,
          ]
        : []),
      ...flagReasons.map((reason) =>
        /\$[\d,]+\/sq ft/i.test(reason) ? 'check price per sq ft' : reason,
      ),
    ];
    return {
      id: item.listing.id,
      result: {
        score,
        rank: 0,
        factors: itemFactors,
        provisional: reasons.length > 0 || hasFlag,
        provisionalReason: reasons.join(' · ') || null,
      } satisfies ListingRanking,
    };
  });
  [...ranked]
    .sort(
      (left, right) => right.result.score - left.result.score || left.id.localeCompare(right.id),
    )
    .forEach(({ result }, index) => {
      result.rank = index + 1;
    });
  return new Map(ranked.map(({ id, result }) => [id, result]));
}

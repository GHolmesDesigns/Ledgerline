import type { Store } from '../store.js';
import type { ListingProvider } from './listing-provider.js';
import type { RequestBudget } from './request-budget.js';

export class RentEstimateUnavailableError extends Error {}

/**
 * Requests a provider rent estimate for one property. It costs 1 request against the same
 * monthly ceiling as refreshes, checked before anything is sent.
 */
export async function requestRentEstimate(
  store: Store,
  provider: ListingProvider,
  budget: RequestBudget,
  propertyId: string,
) {
  const property = store.getProperty(propertyId);
  if (!property) throw new Error('Property not found.');
  if (!provider.estimateRent) {
    throw new RentEstimateUnavailableError(`${provider.name} does not provide rent estimates.`);
  }
  budget.assertCanSend(1, 'Rent estimate');
  const logId = store.beginProviderRequest({
    provider: provider.name,
    propertyId,
    purpose: 'rent-estimate',
    page: 1,
  });
  try {
    const estimate = await provider.estimateRent({ property });
    store.finishProviderRequest(logId, { status: 'succeeded', resultCount: 1 });
    const computedAt = new Date().toISOString();
    store.saveComparableRentFigure({
      propertyId,
      source: 'rent_estimate',
      value: estimate.value,
      low: estimate.low,
      high: estimate.high,
      reason: null,
      compCount: estimate.comps.length,
      maxDistanceMi:
        estimate.comps.length && estimate.comps.every((comp) => comp.distanceMi != null)
          ? Math.max(...estimate.comps.map((comp) => comp.distanceMi!))
          : null,
      compIds: estimate.comps.map((comp) => comp.id),
      estimateComps: estimate.comps.map(({ address, rent, distanceMi }) => ({
        address,
        rent,
        distanceMi,
      })),
      computedAt,
    });
    return estimate;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rent estimate failed.';
    store.finishProviderRequest(logId, { status: 'failed', errorMessage: message });
    throw error;
  }
}

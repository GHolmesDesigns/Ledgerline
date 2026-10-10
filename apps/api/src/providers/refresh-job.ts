import type { SavedSearch, Store } from '../store.js';
import { importProviderRecords, type ImportResult } from './import-listings.js';
import type { ListingProvider, ProviderListing, SearchCriteria } from './listing-provider.js';
import { RequestBudget, RequestCeilingError, type BudgetDecision } from './request-budget.js';
import { redactCredential } from '../provider-credentials.js';

export interface RefreshResult {
  searchId: number;
  imported?: ImportResult;
  error?: string;
  /** Set when the monthly ceiling stopped the refresh; no further request was sent. */
  blocked?: BudgetDecision;
}

function criteriaFor(search: SavedSearch): SearchCriteria {
  const filters = search.filters;
  const statuses = filters.statuses ?? filters.status;
  const numberFilter = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      return Number(value);
    return undefined;
  };
  return {
    mode: search.mode,
    location: search.location,
    priceMin: search.priceMin,
    priceMax: search.priceMax,
    beds: numberFilter(filters.beds),
    baths: numberFilter(filters.baths),
    propertyType: typeof filters.propertyType === 'string' ? filters.propertyType : undefined,
    minSqft: numberFilter(filters.minSqft),
    statuses: Array.isArray(statuses)
      ? statuses.filter((value): value is string => typeof value === 'string')
      : typeof statuses === 'string' && statuses.length > 0
        ? statuses
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined,
  };
}

export class RefreshJob {
  private readonly running = new Set<number>();

  constructor(
    private readonly store: Store,
    readonly provider: ListingProvider,
    readonly budget: RequestBudget = new RequestBudget(store),
    private readonly providerCredential: () => string | null = () => null,
  ) {}

  private safeErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : 'Refresh failed.';
    return redactCredential(message, this.providerCredential());
  }

  async refresh(searchId: number): Promise<RefreshResult> {
    if (this.running.has(searchId)) throw new Error('This saved search is already refreshing.');
    const search = this.store.getSavedSearch(searchId);
    if (!search) throw new Error('Saved search not found.');
    if (
      search.filters.locationMode === 'radius' &&
      this.provider.capabilities.radiusSearch !== true
    ) {
      const error =
        'Provider radius search is not verified; this saved radius search was not refreshed.';
      this.store.markRefreshFailed(searchId, error);
      return { searchId, error };
    }
    if (
      this.provider.name.toLocaleLowerCase('en-US') === 'rentcast' &&
      !this.providerCredential()
    ) {
      const error = 'No RentCast key set';
      this.store.markRefreshFailed(searchId, error);
      return { searchId, error };
    }
    const projected = this.budget.check(this.budget.projectedRefresh(searchId), 'Refresh');
    if (!projected.allowed) {
      // Show the reason on the search, without writing again on every scheduler tick.
      if (search.lastRefreshError !== projected.message) {
        this.store.markRefreshFailed(searchId, projected.message!);
      }
      return { searchId, error: projected.message!, blocked: projected };
    }
    this.running.add(searchId);
    const records: ProviderListing[] = [];
    try {
      this.store.markRefreshStarted(searchId);
      for (let page = 1; ; page += 1) {
        // Each page is a request, and a long result can need more than projected.
        this.budget.assertCanSend(1, 'Refresh');
        const logId = this.store.beginProviderRequest({
          provider: this.provider.name,
          savedSearchId: search.id,
          purpose: 'saved-search-refresh',
          page,
        });
        try {
          const batch = await this.provider.search(criteriaFor(search), page);
          this.store.finishProviderRequest(logId, {
            status: 'succeeded',
            resultCount: batch.length,
          });
          if (batch.length === 0) break;
          records.push(...batch);
          if (this.provider.pageSize != null && batch.length < this.provider.pageSize) break;
        } catch (error) {
          const message = this.safeErrorMessage(error);
          this.store.finishProviderRequest(logId, { status: 'failed', errorMessage: message });
          throw error;
        }
      }
      const imported = this.store.transaction(() => {
        const result = importProviderRecords(this.provider, this.store, records);
        this.store.markRefreshSucceeded(search.id);
        return result;
      });
      return { searchId, imported };
    } catch (error) {
      const message = this.safeErrorMessage(error);
      this.store.markRefreshFailed(search.id, message);
      return {
        searchId,
        error: message,
        ...(error instanceof RequestCeilingError ? { blocked: error.decision } : {}),
      };
    } finally {
      this.running.delete(searchId);
    }
  }

  /** Refreshes one shortlisted provider listing through the same budget and log path. */
  async getListing(sourceId: string): Promise<ProviderListing | null> {
    if (!this.provider.getListing)
      throw new Error(`${this.provider.name} cannot fetch one listing.`);
    if (
      this.provider.name.toLocaleLowerCase('en-US') === 'rentcast' &&
      !this.providerCredential()
    ) {
      throw new Error('No RentCast key set');
    }
    this.budget.assertCanSend(1, 'Listing refresh');
    const logId = this.store.beginProviderRequest({
      provider: this.provider.name,
      purpose: 'listing-refresh',
      page: 1,
    });
    try {
      const listing = await this.provider.getListing(sourceId);
      this.store.finishProviderRequest(logId, {
        status: 'succeeded',
        resultCount: listing ? 1 : 0,
      });
      return listing;
    } catch (error) {
      const message = this.safeErrorMessage(error);
      this.store.finishProviderRequest(logId, { status: 'failed', errorMessage: message });
      throw new Error(message);
    }
  }

  async refreshDue(): Promise<RefreshResult[]> {
    const results: RefreshResult[] = [];
    for (const search of this.store.listDueSavedSearches()) {
      try {
        results.push(await this.refresh(search.id));
      } catch (error) {
        results.push({
          searchId: search.id,
          error: error instanceof Error ? error.message : 'Refresh failed.',
        });
      }
    }
    return results;
  }
}

export function startRefreshScheduler(job: RefreshJob, intervalMs = 60_000) {
  const timer = setInterval(() => void job.refreshDue().catch(() => undefined), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

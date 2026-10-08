import type { Database } from 'sql.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createStore,
  type ListingSearchCriteria,
  type SavedSearchInput,
  type ReviewListingInput,
  type Store,
} from './store.js';
import { mockProviderCapabilities } from './providers/mock-provider.js';

export function createApp(database: Database, store: Store = createStore(database)) {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && request.url === '/api/health') {
      let databaseReady = true;
      try {
        database.exec('SELECT 1');
      } catch {
        databaseReady = false;
      }
      json(databaseReady ? 200 : 503, { status: databaseReady ? 'ok' : 'unavailable' });
      return;
    }

    const readBody = async (): Promise<Record<string, unknown>> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Request body must be a JSON object.');
      }
      return value as Record<string, unknown>;
    };
    const savedSearchInput = (body: Record<string, unknown>, partial = false) => {
      const result: Partial<SavedSearchInput> = {};
      const has = (key: string) => Object.hasOwn(body, key);
      if (!partial || has('name')) {
        if (typeof body.name !== 'string' || body.name.trim().length === 0) {
          throw new Error('Name is required.');
        }
        result.name = body.name.trim();
      }
      if (!partial || has('mode')) {
        if (body.mode !== 'sale' && body.mode !== 'rent')
          throw new Error('Mode must be sale or rent.');
        result.mode = body.mode;
      }
      if (!partial || has('location')) {
        if (typeof body.location !== 'string' || body.location.trim().length === 0) {
          throw new Error('Location is required.');
        }
        result.location = body.location.trim();
      }
      if (!partial || has('filters')) {
        if (
          body.filters !== undefined &&
          (body.filters === null || typeof body.filters !== 'object' || Array.isArray(body.filters))
        ) {
          throw new Error('Filters must be a JSON object.');
        }
        result.filters = (body.filters ?? {}) as Record<string, unknown>;
      }
      for (const key of ['priceMin', 'priceMax'] as const) {
        if (!partial || has(key)) {
          const value = body[key];
          if (
            value !== undefined &&
            value !== null &&
            (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
          ) {
            throw new Error(`${key} must be a non-negative number or null.`);
          }
          result[key] = value as number | null | undefined;
        }
      }
      if (!partial || has('refreshIntervalDays')) {
        const value = body.refreshIntervalDays;
        if (
          value !== undefined &&
          value !== null &&
          (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
        ) {
          throw new Error('Refresh interval must be a positive whole number of days or null.');
        }
        result.refreshIntervalDays = value as number | null | undefined;
      }
      return result;
    };

    if (request.method === 'GET' && request.url === '/api/saved-searches') {
      json(200, { items: store.listSavedSearches() });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/saved-searches') {
      try {
        const input = savedSearchInput(await readBody()) as SavedSearchInput;
        if (input.priceMin != null && input.priceMax != null && input.priceMin > input.priceMax) {
          throw new Error('Minimum price cannot exceed maximum price.');
        }
        json(201, { item: store.createSavedSearch(input) });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Unable to save search.' });
      }
      return;
    }
    const savedSearchAction = request.url?.match(/^\/api\/saved-searches\/(\d+)(?:\/(pair))?$/);
    if (savedSearchAction && request.method === 'PATCH') {
      try {
        const searchId = Number(savedSearchAction[1]);
        if (savedSearchAction[2] === 'pair') {
          const body = await readBody();
          if (body.pairedSearchId === null) {
            store.unpairSavedSearch(searchId);
          } else if (
            typeof body.pairedSearchId === 'number' &&
            Number.isInteger(body.pairedSearchId)
          ) {
            store.pairSavedSearches(searchId, body.pairedSearchId);
          } else {
            throw new Error('pairedSearchId must be a search ID or null.');
          }
          json(200, { items: store.listSavedSearches() });
        } else {
          const item = store.updateSavedSearch(searchId, savedSearchInput(await readBody(), true));
          json(200, { item });
        }
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to update saved search.',
        });
      }
      return;
    }
    if (savedSearchAction && request.method === 'DELETE' && !savedSearchAction[2]) {
      try {
        store.deleteSavedSearch(Number(savedSearchAction[1]));
        response.writeHead(204);
        response.end();
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to delete saved search.',
        });
      }
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/api/listings')) {
      if (request.url === '/api/listings/capabilities') {
        json(200, mockProviderCapabilities);
        return;
      }
      try {
        const url = new URL(request.url, 'http://localhost');
        const mode = url.searchParams.get('mode') ?? 'sale';
        if (mode !== 'sale' && mode !== 'rent') throw new Error('Mode must be sale or rent.');
        const numberParam = (name: string) => {
          const value = url.searchParams.get(name);
          if (value === null || value === '') return undefined;
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0)
            throw new Error(`${name} must be a non-negative number.`);
          return parsed;
        };
        const statuses = url.searchParams
          .getAll('status')
          .flatMap((value) => value.split(','))
          .map((value) => value.trim().toLocaleLowerCase('en-US'))
          .filter(Boolean);
        const criteria: ListingSearchCriteria = {
          mode,
          location: url.searchParams.get('location') ?? undefined,
          priceMin: numberParam('priceMin'),
          priceMax: numberParam('priceMax'),
          beds: numberParam('beds'),
          baths: numberParam('baths'),
          propertyType: url.searchParams.get('propertyType') || undefined,
          minSqft: numberParam('minSqft'),
          statuses: statuses.length ? statuses : ['active'],
          sort: url.searchParams.get('sort') === 'price' ? 'price' : 'newest',
        };
        if (
          criteria.priceMin !== undefined &&
          criteria.priceMax !== undefined &&
          criteria.priceMin > criteria.priceMax
        ) {
          throw new Error('Minimum price cannot exceed maximum price.');
        }
        json(200, { items: store.searchListings(criteria), criteria });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Unable to search listings.' });
      }
      return;
    }

    if (request.method === 'GET' && request.url === '/api/match-reviews') {
      const items = store.listPendingMatchReviews().map((review) => {
        const incoming = review.incomingListing as ReviewListingInput;
        const candidate = store.getProperty(review.candidatePropertyId);
        return {
          id: review.id,
          reason: review.reason,
          incoming: {
            ...incoming.property,
            mode: incoming.listing.mode,
            price: incoming.listing.price,
            provider: incoming.provider,
            lastSeen: incoming.listing.providerLastSeenDate,
          },
          candidate,
          candidateListings: store.listListings(review.candidatePropertyId).map((listing) => ({
            mode: listing.mode,
            price: listing.price,
            lastSeen: listing.providerLastSeenDate,
          })),
          noteCount: store.listNotes(review.candidatePropertyId).length,
        };
      });
      json(200, { items });
      return;
    }

    const reviewAction = request.url?.match(
      /^\/api\/match-reviews\/(\d+)\/(link|keep-separate|undo)$/,
    );
    if (request.method === 'POST' && reviewAction) {
      try {
        const reviewId = Number(reviewAction[1]);
        const action = reviewAction[2];
        const item =
          action === 'undo'
            ? store.undoMatchReview(reviewId)
            : store.decideMatchReview(reviewId, action === 'link' ? 'link' : 'keep_separate');
        json(200, { item });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to update match review',
        });
      }
      return;
    }

    json(404, { error: 'Not found' });
  });
}

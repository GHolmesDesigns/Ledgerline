import type { Database } from 'sql.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createStore,
  type ListingSearchCriteria,
  type ReviewListingInput,
  type Store,
} from './store.js';
import { mockProviderCapabilities } from './providers/mock-provider.js';

export function createApp(database: Database, store: Store = createStore(database)) {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
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

import type { Database } from 'sql.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createStore, type ReviewListingInput, type Store } from './store.js';

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

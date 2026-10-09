import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App, RequestUsageHeader } from './App';

describe('app shell', () => {
  const routes = [
    { path: '/', title: 'Search' },
    { path: '/compare', title: 'Compare' },
    { path: '/property/sample-property', title: 'Property detail' },
    { path: '/settings', title: 'Ranking &amp; data' },
  ];

  for (const route of routes) {
    it(`renders the shell and sample notice on ${route.path}`, () => {
      const html = renderToStaticMarkup(<App initialPath={route.path} />);
      assert.match(html, /Ledgerline/);
      assert.match(html, new RegExp(`<h1>${route.title}<\\/h1>`));
      assert.match(html, /Sample data — not real listings/);
      assert.match(html, /aria-label="Main navigation"/);
      assert.match(html, /aria-label="Mobile navigation"/);
    });
  }

  it('provides a skip link, keyboard focus targets, and active route navigation', () => {
    const html = renderToStaticMarkup(<App initialPath="/compare" />);
    assert.match(html, /href="#main-content"/);
    assert.match(html, /aria-current="page" class="nav-link" href="\/compare"/);
    assert.match(html, /id="main-content" tabindex="-1"/);
  });
});

describe('request usage header', () => {
  it('shows the active provider, tier, request count, last refresh, and local browsing note', () => {
    const html = renderToStaticMarkup(
      <RequestUsageHeader
        initialData={{
          ceiling: 45,
          used: 23,
          remaining: 22,
          provider: 'RentCast',
          tier: 'Developer',
          lastSuccessfulRefreshAt: '2026-10-08T12:00:00.000Z',
          requestsPerRefreshAll: 6,
          rentEstimatesUsed: 1,
          recommendedTier: 'Foundation · $74/mo',
          projections: {
            weekly: { remainingRuns: 3, projected: 42, overCeiling: false },
            daily: { remainingRuns: 24, projected: 168, overCeiling: true },
          },
          searches: [],
        }}
      />,
    );
    assert.match(html, /RentCast · Developer · 23 \/ 45 requests/);
    assert.match(html, /Last refresh/);
    assert.match(html, /Browsing uses no requests/);
    assert.match(html, /aria-label="23 of 45 provider requests used"/);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abbreviatedCostState,
  App,
  lowestCompleteCostPropertyId,
  RequestUsageHeader,
  shouldShowSampleNotice,
  type PropertyDetailData,
} from './App';

describe('app shell', () => {
  const routes = [
    { path: '/', title: 'Search' },
    { path: '/compare', title: 'Compare' },
    { path: '/property/sample-property', title: 'Property detail' },
    { path: '/settings', title: 'Settings' },
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

  it('shows the global sample notice only for mock or unknown provider status', () => {
    assert.equal(shouldShowSampleNotice('mock'), true);
    assert.equal(shouldShowSampleNotice(null), true);
    assert.equal(shouldShowSampleNotice(undefined), true);
    assert.equal(shouldShowSampleNotice('rentcast'), false);
  });

  it('provides a skip link, keyboard focus targets, and active route navigation', () => {
    const html = renderToStaticMarkup(<App initialPath="/compare" />);
    assert.match(html, /href="#main-content"/);
    assert.match(
      html,
      /aria-current="page" aria-label="Compare" class="sidebar-nav-link" href="\/compare"/,
    );
    assert.match(html, /id="main-content" tabindex="-1"/);
  });

  it('provides a password field for the optional local RentCast key', () => {
    const html = renderToStaticMarkup(<App initialPath="/settings" />);
    assert.match(html, /RentCast key/);
    assert.match(html, /name="rentCastApiKey"/);
    assert.match(html, /type="password"/);
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
          nextReset: '2026-11-01T00:00:00.000Z',
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

describe('Compare cost display rules', () => {
  const item = (
    id: string,
    totalStatus: 'Calculated' | 'Estimate' | 'Incomplete',
    monthlyTotal: number | null,
  ) =>
    ({
      property: { id },
      listings: [{ id: `${id}-sale`, mode: 'sale' }],
      costEstimate: {
        lines: [],
        totalStatus,
        statusLabel: totalStatus,
        totalLabel: '',
        monthlyTotal,
        knownSubtotal: monthlyTotal ?? 0,
        upfrontCash: 0,
        upfrontLabel: '$0',
      },
    }) as unknown as PropertyDetailData;

  it('marks the lowest complete total and ignores Incomplete totals', () => {
    assert.equal(
      lowestCompleteCostPropertyId([
        item('incomplete-low', 'Incomplete', null),
        item('estimate', 'Estimate', 4600),
        item('calculated', 'Calculated', 4525),
      ]),
      'calculated',
    );
    assert.equal(
      lowestCompleteCostPropertyId([item('a', 'Incomplete', null), item('b', 'Incomplete', null)]),
      undefined,
    );
  });

  it('uses the compact text state tags in the table legend', () => {
    assert.deepEqual(
      ['Listing', 'Calculated', 'Quote', 'Doc', 'Not applicable', 'Est.', 'Unknown'].map(
        abbreviatedCostState,
      ),
      ['Listing', 'Calc', 'Quote', 'Doc', 'N/A', 'Est.', 'Unknown'],
    );
  });
});

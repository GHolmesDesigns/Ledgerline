import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from './App';

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

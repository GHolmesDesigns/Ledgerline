import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from './App';

describe('placeholder page', () => {
  it('labels the fictional data and presents the local dashboard welcome', () => {
    const html = renderToStaticMarkup(<App />);
    assert.match(html, /Sample data — not real listings/);
    assert.match(html, /Your next place/);
    assert.match(html, /local only/);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeSettingsOrder, moveSettingsSection } from './settingsOrder.js';

describe('Settings section order', () => {
  it('keeps saved items and inserts sections added later at their default position', () => {
    assert.deepEqual(
      mergeSettingsOrder(
        ['appearance', 'weights', 'new-section', 'assumptions'],
        ['assumptions', 'appearance', 'weights', 'old'],
      ),
      ['assumptions', 'appearance', 'weights', 'new-section'],
    );
  });

  it('reorders one item without changing the other item order', () => {
    assert.deepEqual(moveSettingsSection(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveSettingsSection(['a', 'b'], -1, 1), ['a', 'b']);
  });
});

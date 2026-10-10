import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addressMatches,
  distanceMiles,
  isValidCoordinates,
  isValidZip,
  isWithinRadius,
  propertyIsWithinRadius,
} from './search-area.js';

describe('stored search areas', () => {
  it('validates exact ZIPs and geographic coordinate bounds', () => {
    assert.equal(isValidZip('33308'), true);
    assert.equal(isValidZip('3330'), false);
    assert.equal(isValidZip('33308-1234'), false);
    assert.equal(isValidCoordinates({ latitude: 90, longitude: -180 }), true);
    assert.equal(isValidCoordinates({ latitude: 90.1, longitude: 0 }), false);
    assert.equal(isValidCoordinates({ latitude: 0, longitude: 180.1 }), false);
  });

  it('measures straight-line distance and includes the requested boundary', () => {
    const center = { latitude: 26.19, longitude: -80.115 };
    assert.equal(distanceMiles(center, center), 0);
    const boundary = {
      latitude: 26.19,
      longitude: -80.115 + 1 / (69 * Math.cos((26.19 * Math.PI) / 180)),
    };
    const distance = distanceMiles(center, boundary);
    assert.ok(distance > 0.9 && distance < 1.1);
    assert.equal(isWithinRadius(center, boundary, distance), true);
    assert.equal(isWithinRadius(center, boundary, distance - 0.0001), false);
    assert.equal(propertyIsWithinRadius(center, null, null, 25), false);
  });

  it('resolves normalized stored address text including state abbreviations and suffixes', () => {
    assert.equal(
      addressMatches('2207 N.E. 32nd Court, Fort Lauderdale, FL 33308', {
        street: '2207 NE 32nd Ct',
        unit: null,
        city: 'Fort Lauderdale',
        zip: '33308',
      }),
      true,
    );
    assert.equal(
      addressMatches('2207 NE 32nd Ct, Miami, FL 33308', {
        street: '2207 NE 32nd Ct',
        unit: null,
        city: 'Fort Lauderdale',
        zip: '33308',
      }),
      false,
    );
  });
});

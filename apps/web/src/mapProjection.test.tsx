import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createGeoProjection } from './mapProjection.js';
import { resultBounds } from './mapData.js';

it('places Florida property coordinates in geographic order inside the county viewport', () => {
  const project = createGeoProjection(
    { minLon: -80.5, maxLon: -79.9, minLat: 25.6, maxLat: 26.5 },
    600,
    520,
    34,
  );
  const fortLauderdale = project(-80.115, 26.19);
  const miami = project(-80.19, 25.76);
  const bocaRaton = project(-80.083, 26.35);

  assert.ok(fortLauderdale.x > miami.x, 'eastward longitude moves the pin right');
  assert.ok(fortLauderdale.y < miami.y, 'northward latitude moves the pin up');
  assert.ok(bocaRaton.y < fortLauderdale.y);
  for (const point of [fortLauderdale, miami, bocaRaton]) {
    assert.ok(point.x >= 34 && point.x <= 566);
    assert.ok(point.y >= 34 && point.y <= 486);
  }
});

it('frames current result coordinates and pads a single pin', () => {
  const bounds = resultBounds([
    { longitude: -80.115, latitude: 26.19 },
    { longitude: -80.19, latitude: 25.76 },
  ])!;
  assert.ok(bounds.minLon > -80.3);
  assert.ok(bounds.maxLon < -80);
  assert.ok(bounds.minLat > 25.6);
  assert.ok(bounds.maxLat < 26.3);
  const single = resultBounds([{ longitude: -80.115, latitude: 26.19 }])!;
  assert.ok(single.maxLon > single.minLon);
  assert.ok(single.maxLat > single.minLat);
  assert.equal(resultBounds([]), null);
});

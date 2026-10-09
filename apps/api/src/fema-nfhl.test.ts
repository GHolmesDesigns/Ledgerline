import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFemaNfhlLookup } from './fema-nfhl.js';

describe('FEMA NFHL lookup', () => {
  it('queries the recorded hazard-zone response using property coordinates', async () => {
    let requested: URL | undefined;
    const lookup = createFemaNfhlLookup(async (input) => {
      requested = new URL(String(input));
      return Response.json({ features: [{ attributes: { FLD_ZONE: ' ae ' } }] });
    });

    assert.equal(await lookup(26.1224, -80.1373), 'AE');
    assert.ok(requested);
    assert.equal(requested.searchParams.get('geometry'), '-80.1373,26.1224');
    assert.equal(requested.searchParams.get('geometryType'), 'esriGeometryPoint');
    assert.equal(requested.searchParams.get('inSR'), '4326');
    assert.equal(requested.searchParams.get('outFields'), 'FLD_ZONE');
  });

  it('rejects no mapped zone and service errors instead of inventing a result', async () => {
    const noMatch = createFemaNfhlLookup(async () => Response.json({ features: [] }));
    await assert.rejects(noMatch(26, -80), /no mapped flood zone/);

    const serviceError = createFemaNfhlLookup(async () =>
      Response.json({ error: { message: 'Service unavailable' } }),
    );
    await assert.rejects(serviceError(26, -80), /Service unavailable/);
  });
});

export const FEMA_NFHL_QUERY_URL =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

type NfhlQueryResponse = {
  error?: { message?: string };
  features?: Array<{ attributes?: { FLD_ZONE?: unknown } }>;
};

export type FloodZoneLookup = (latitude: number, longitude: number) => Promise<string>;

export function createFemaNfhlLookup(
  request: typeof fetch = fetch,
  endpoint = FEMA_NFHL_QUERY_URL,
): FloodZoneLookup {
  return async (latitude, longitude) => {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      f: 'json',
      geometry: `${longitude},${latitude}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'FLD_ZONE',
      returnGeometry: 'false',
      resultRecordCount: '10',
    }).toString();

    const response = await request(url);
    if (!response.ok) throw new Error(`FEMA NFHL returned HTTP ${response.status}.`);
    const result = (await response.json()) as NfhlQueryResponse;
    if (result.error) throw new Error(result.error.message || 'FEMA NFHL query failed.');
    const zones = (result.features ?? [])
      .map((feature) => feature.attributes?.FLD_ZONE)
      .filter((zone): zone is string => typeof zone === 'string' && zone.trim().length > 0)
      .map((zone) => zone.trim().toUpperCase());
    const uniqueZones = [...new Set(zones)];
    if (!uniqueZones.length)
      throw new Error('FEMA NFHL has no mapped flood zone at these coordinates.');
    if (uniqueZones.length > 1)
      throw new Error('FEMA NFHL returned multiple zones at this point; verify the zone manually.');
    return uniqueZones[0]!;
  };
}

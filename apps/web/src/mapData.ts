import type { GeoBounds } from './mapProjection';

export type CountyFeature = {
  type: 'Feature';
  properties: { GEOID: string; NAME: string };
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };
};
export type CountyFeatureCollection = { type: 'FeatureCollection'; features: CountyFeature[] };

const cityCenters: Record<string, [number, number]> = {
  'fort lauderdale': [-80.137, 26.122],
  miramar: [-80.232, 25.987],
  miami: [-80.192, 25.762],
  'north miami': [-80.186, 25.891],
  'boca raton': [-80.128, 26.368],
  hollywood: [-80.149, 26.011],
};

export function countyCenter(feature: CountyFeature): [number, number] {
  const ring =
    feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates[0]
      : (feature.geometry.coordinates[0]?.[0] ?? []);
  const points = ring.slice(0, -1);
  const longitude = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const latitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return [longitude, latitude];
}

export type MapProperty = {
  latitude: number | null;
  longitude: number | null;
  city: string;
  county: string | null;
};

export function pinCoordinates(
  property: MapProperty,
  index: number,
  boundaries: CountyFeatureCollection,
) {
  const exact = property.latitude !== null && property.longitude !== null;
  const city = property.city.trim().toLocaleLowerCase('en-US');
  const [baseLongitude, baseLatitude] = exact
    ? [property.longitude!, property.latitude!]
    : (cityCenters[city] ??
      (() => {
        const county = boundaries.features.find(
          (feature) =>
            feature.properties.NAME.replace(/ County$/i, '').toLocaleLowerCase('en-US') ===
            (property.county ?? '').toLocaleLowerCase('en-US'),
        );
        return county ? countyCenter(county) : [-80.2, 26.1];
      })());
  const jitter = exact ? 0 : ((index % 5) - 2) * 0.009;
  return {
    longitude: baseLongitude + jitter,
    latitude: baseLatitude + jitter * 0.45,
    approximate: !exact,
  };
}

export function resultBounds(points: { longitude: number; latitude: number }[]): GeoBounds | null {
  if (points.length === 0) return null;
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const lonPad = Math.max(0.02, (maxLon - minLon) * 0.12);
  const latPad = Math.max(0.02, (maxLat - minLat) * 0.12);
  return {
    minLon: minLon - lonPad,
    maxLon: maxLon + lonPad,
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
  };
}

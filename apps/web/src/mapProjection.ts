export type GeoBounds = { minLon: number; maxLon: number; minLat: number; maxLat: number };

// Longitude distances shrink with latitude. Apply the same projection to county
// paths and pins so a stored coordinate lands on its point within the border.
export function createGeoProjection(
  bounds: GeoBounds,
  width: number,
  height: number,
  padding: number,
) {
  const longitudeScale = Math.cos(((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180));
  const minX = bounds.minLon * longitudeScale;
  const maxX = bounds.maxLon * longitudeScale;
  const scale = Math.min(
    (width - padding * 2) / (maxX - minX),
    (height - padding * 2) / (bounds.maxLat - bounds.minLat),
  );
  const mapWidth = (maxX - minX) * scale;
  const mapHeight = (bounds.maxLat - bounds.minLat) * scale;
  return (longitude: number, latitude: number) => ({
    x: (width - mapWidth) / 2 + (longitude * longitudeScale - minX) * scale,
    y: (height - mapHeight) / 2 + (bounds.maxLat - latitude) * scale,
  });
}

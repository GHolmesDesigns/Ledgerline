import { useEffect, useRef, useState } from 'react';
import { pinCoordinates, resultBounds, type CountyFeatureCollection } from './mapData';
import {
  loadMaps,
  subscribeMapsAuthFailure,
  type MapInstance,
  type MapsApi,
  type MapsEvent,
  type CircleInstance,
  type MarkerInstance,
  type PolygonInstance,
} from './googleMapsLoader';

type MapItem = {
  property: {
    id: string;
    street: string;
    city: string;
    county: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  listing: { id: string; price: number | null; mode: 'sale' | 'rent' };
};
type SearchRadius = { latitude: number; longitude: number; miles: number; label: string };

export function GoogleResultsMap({
  apiKey,
  boundaries,
  items,
  selectedId,
  onSelect,
  onFailure,
  radius,
}: {
  apiKey: string;
  boundaries: CountyFeatureCollection;
  items: MapItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFailure: () => void;
  radius?: SearchRadius;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const markers = useRef<MarkerInstance[]>([]);
  const polygons = useRef<PolygonInstance[]>([]);
  const searchCircle = useRef<CircleInstance | null>(null);
  const centerMarker = useRef<MarkerInstance | null>(null);
  const listeners = useRef<MapsEvent[]>([]);
  const [maps, setMaps] = useState<MapsApi | null>(null);

  useEffect(() => {
    let active = true;
    const authFailed = () => {
      if (active) onFailure();
    };
    const unsubscribe = subscribeMapsAuthFailure(authFailed);
    window.addEventListener('offline', authFailed);
    if (navigator.onLine === false) {
      onFailure();
      return () => {
        unsubscribe();
        window.removeEventListener('offline', authFailed);
      };
    }
    void loadMaps(apiKey)
      .then((loaded) => {
        if (active) setMaps(loaded);
      })
      .catch(() => {
        if (active) onFailure();
      });
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('offline', authFailed);
    };
  }, [apiKey, onFailure]);

  useEffect(() => {
    if (!maps || !container.current) return;
    const instance = new maps.Map(container.current, {
      center: { lat: 26.1, lng: -80.2 },
      zoom: 10,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    map.current = instance;
    for (const feature of boundaries.features) {
      const polygonsForFeature =
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      for (const polygon of polygonsForFeature) {
        const paths = polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
        polygons.current.push(
          new maps.Polygon({
            map: instance,
            paths,
            strokeColor: '#49636c',
            strokeOpacity: 0.9,
            strokeWeight: 2,
            fillColor: '#72c5d0',
            fillOpacity: 0.07,
            clickable: false,
          }),
        );
      }
    }
    return () => {
      listeners.current.forEach((listener) => listener.remove());
      listeners.current = [];
      markers.current.forEach((marker) => marker.setMap(null));
      markers.current = [];
      polygons.current.forEach((polygon) => polygon.setMap(null));
      polygons.current = [];
      searchCircle.current?.setMap(null);
      searchCircle.current = null;
      centerMarker.current?.setMap(null);
      centerMarker.current = null;
      map.current = null;
    };
  }, [maps, boundaries]);

  useEffect(() => {
    if (!maps || !map.current) return;
    listeners.current.forEach((listener) => listener.remove());
    listeners.current = [];
    markers.current.forEach((marker) => marker.setMap(null));
    const instance = map.current;
    const points = items.map((item, index) => pinCoordinates(item.property, index, boundaries));
    markers.current = items.map((item, index) => {
      const point = points[index];
      const marker = new maps.Marker({
        map: instance,
        position: { lat: point.latitude, lng: point.longitude },
        title: `${item.property.street}, ${item.property.city}${point.approximate ? ' (approximate city location)' : ''}`,
        clickable: true,
        label: {
          text:
            item.listing.price === null
              ? '—'
              : item.listing.mode === 'sale'
                ? `$${Math.round(item.listing.price / 1000)}k`
                : `$${item.listing.price.toLocaleString('en-US')}`,
          color: '#101820',
          fontSize: '12px',
          fontWeight: '600',
        },
      });
      listeners.current.push(marker.addListener('click', () => onSelect(item.listing.id)));
      return marker;
    });
    const bounds = resultBounds(points);
    if (bounds) {
      const viewport = new maps.LatLngBounds();
      viewport.extend({ lat: bounds.minLat, lng: bounds.minLon });
      viewport.extend({ lat: bounds.maxLat, lng: bounds.maxLon });
      instance.fitBounds(viewport);
    }
  }, [maps, boundaries, items, onSelect]);

  useEffect(() => {
    if (!maps || !map.current) return;
    searchCircle.current?.setMap(null);
    searchCircle.current = null;
    centerMarker.current?.setMap(null);
    centerMarker.current = null;
    if (!radius) return;
    const instance = map.current;
    const center = { lat: radius.latitude, lng: radius.longitude };
    searchCircle.current = new maps.Circle({
      map: instance,
      center,
      radius: radius.miles * 1609.344,
      strokeColor: '#00aebc',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: '#00c2d1',
      fillOpacity: 0.12,
      clickable: false,
    });
    centerMarker.current = new maps.Marker({
      map: instance,
      position: center,
      title: radius.label,
      label: { text: 'C', color: '#ffffff', fontWeight: '700' },
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#101820',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
      clickable: false,
    });
    const latitudeDelta = radius.miles / 69;
    const longitudeDelta = radius.miles / (69 * Math.cos((radius.latitude * Math.PI) / 180));
    const viewport = new maps.LatLngBounds();
    viewport.extend({
      lat: radius.latitude - latitudeDelta,
      lng: radius.longitude - longitudeDelta,
    });
    viewport.extend({
      lat: radius.latitude + latitudeDelta,
      lng: radius.longitude + longitudeDelta,
    });
    map.current.fitBounds(viewport);
  }, [maps, radius?.latitude, radius?.longitude, radius?.miles]);

  useEffect(() => {
    markers.current.forEach((marker, index) => {
      const selected = items[index]?.listing.id === selectedId;
      marker.setZIndex(selected ? 1000 : 1);
      marker.setIcon({
        path: maps?.SymbolPath.CIRCLE,
        scale: selected ? 27 : 23,
        fillColor: selected ? '#101820' : '#00c2d1',
        fillOpacity: 1,
        strokeColor: '#101820',
        strokeWeight: 2,
      });
      const item = items[index];
      const price = item?.listing.price;
      marker.setLabel({
        text:
          price === null || price === undefined
            ? '—'
            : item?.listing.mode === 'sale'
              ? `$${Math.round(price / 1000)}k`
              : `$${price.toLocaleString('en-US')}`,
        color: selected ? '#ffffff' : '#101820',
        fontSize: '12px',
        fontWeight: '600',
      });
    });
  }, [items, selectedId, maps]);

  const selected = items.find((item) => item.listing.id === selectedId);
  return (
    <section aria-label="Results map" className="map-panel google-map-panel">
      <div className="map-panel-heading">
        <div>
          <p className="screen-eyebrow">Google Maps</p>
          <h2>Results near South Florida</h2>
        </div>
        <span>{items.length} pins</span>
      </div>
      <div
        aria-label="Google map of current results"
        className="google-map-canvas"
        ref={container}
      />
      <p className="map-attribution">
        County boundaries: U.S. Census Bureau TIGERweb, 2026. Pins without listing coordinates show
        approximate city locations.
      </p>
      <div aria-label="Map pins" className="google-map-pin-list" role="group">
        {items.map((item, index) => (
          <button
            aria-label={`Select ${item.property.street}, ${item.property.city}; map pin ${index + 1} of ${items.length}`}
            aria-pressed={item.listing.id === selectedId}
            key={item.listing.id}
            onClick={() => onSelect(item.listing.id)}
            type="button"
          >
            {index + 1}. {item.property.street}
          </button>
        ))}
      </div>
      {selected && (
        <div aria-live="polite" className="map-selected-card">
          <div>
            <strong>
              {selected.listing.price === null
                ? 'Price unavailable'
                : `$${selected.listing.price.toLocaleString('en-US')}${selected.listing.mode === 'rent' ? '/mo' : ''}`}
            </strong>
            <span>
              {selected.property.street} · {selected.property.city}
            </span>
          </div>
          <a href={`/property/${selected.property.id}`}>View details</a>
        </div>
      )}
    </section>
  );
}

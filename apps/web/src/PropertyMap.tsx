import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  loadMaps,
  subscribeMapsAuthFailure,
  type MapInstance,
  type MapsApi,
  type MarkerInstance,
} from './googleMapsLoader';
import { createGeoProjection } from './mapProjection';
import type { CountyFeatureCollection } from './mapData';

type Location = { latitude: number; longitude: number; address: string };

function GooglePropertyMap({
  apiKey,
  location,
  onFailure,
}: {
  apiKey: string;
  location: Location;
  onFailure: Dispatch<SetStateAction<boolean>>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [maps, setMaps] = useState<MapsApi | null>(null);

  useEffect(() => {
    let active = true;
    const fail = () => {
      if (active) onFailure(true);
    };
    const unsubscribe = subscribeMapsAuthFailure(fail);
    window.addEventListener('offline', fail);
    if (navigator.onLine === false) fail();
    else {
      void loadMaps(apiKey)
        .then((loaded) => {
          if (active) setMaps(loaded);
        })
        .catch(fail);
    }
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('offline', fail);
    };
  }, [apiKey, onFailure]);

  useEffect(() => {
    if (!maps || !container.current) return;
    const point = { lat: location.latitude, lng: location.longitude };
    const map: MapInstance = new maps.Map(container.current, {
      center: point,
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    const marker: MarkerInstance = new maps.Marker({
      map,
      position: point,
      title: location.address,
    });
    return () => marker.setMap(null);
  }, [maps, location.latitude, location.longitude, location.address]);

  return (
    <div
      aria-label={`Google map of ${location.address}`}
      className="google-map-canvas property-map-canvas"
      ref={container}
    />
  );
}

function LocalPropertyMap({ location }: { location: Location }) {
  const [boundaries, setBoundaries] = useState<CountyFeatureCollection | null>(null);
  useEffect(() => {
    let active = true;
    void fetch('/geo/florida-counties.geojson')
      .then(async (response) => {
        if (!response.ok) throw new Error('County boundaries unavailable.');
        return (await response.json()) as CountyFeatureCollection;
      })
      .then((features) => {
        if (active) setBoundaries(features);
      })
      .catch(() => {
        // Keep the property's pin visible even when the local boundary file is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  const width = 600;
  const height = 360;
  const project = createGeoProjection(
    {
      minLon: location.longitude - 0.06,
      maxLon: location.longitude + 0.06,
      minLat: location.latitude - 0.04,
      maxLat: location.latitude + 0.04,
    },
    width,
    height,
    0,
  );
  const paths = boundaries?.features.flatMap((feature) => {
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    return polygons.flatMap((polygon) =>
      polygon.map(
        (ring) =>
          ring
            .map(([longitude, latitude], index) => {
              const point = project(longitude, latitude);
              return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
            })
            .join(' ') + ' Z',
      ),
    );
  });
  const pin = project(location.longitude, location.latitude);
  return (
    <>
      <div className="county-map-canvas property-map-canvas">
        <svg
          aria-label={`Local map showing ${location.address} at its stored coordinates`}
          className="county-map"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {paths?.map((path, index) => (
            <path className="county-shape" d={path} key={index} />
          ))}
          <circle className="property-map-pin" cx={pin.x} cy={pin.y} r="13" />
          <circle className="property-map-pin-center" cx={pin.x} cy={pin.y} r="4" />
        </svg>
      </div>
      <p className="map-attribution">
        <a href="/settings#keys">Add a Google Maps key in Settings</a> to show the street map.
        County boundaries: U.S. Census Bureau TIGERweb, 2026.
      </p>
    </>
  );
}

export function PropertyMap({ location }: { location: Location }) {
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/google-maps-key')
      .then(async (response) => {
        if (!response.ok) throw new Error('Maps key unavailable.');
        const result = (await response.json()) as { key?: string | null };
        if (active) setKey(typeof result.key === 'string' ? result.key : null);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-label="Property map" className="map-panel property-map-panel">
      {!ready ? (
        <p>Loading property map…</p>
      ) : key && !failed ? (
        <GooglePropertyMap apiKey={key} location={location} onFailure={setFailed} />
      ) : (
        <LocalPropertyMap location={location} />
      )}
    </section>
  );
}

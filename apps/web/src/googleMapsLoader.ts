export type Point = { lat: number; lng: number };
export type MapsEvent = { remove: () => void };
export type BoundsInstance = { extend: (point: Point) => void };
export type MapInstance = {
  fitBounds: (bounds: BoundsInstance) => void;
};
export type MarkerInstance = {
  setMap: (map: MapInstance | null) => void;
  setZIndex: (index: number) => void;
  setIcon: (icon: object) => void;
  setLabel: (label: object) => void;
  addListener: (event: string, handler: () => void) => MapsEvent;
};
export type PolygonInstance = { setMap: (map: MapInstance | null) => void };
export type MapsApi = {
  Map: new (element: HTMLElement, options: object) => MapInstance;
  LatLngBounds: new () => BoundsInstance;
  Marker: new (options: object) => MarkerInstance;
  Polygon: new (options: object) => PolygonInstance;
  SymbolPath: { CIRCLE: number };
};

declare global {
  interface Window {
    google?: { maps?: MapsApi };
    gm_authFailure?: () => void;
    __ledgerlineMapsReady?: () => void;
  }
}

let mapsLoad: Promise<MapsApi> | null = null;
const authFailureSubscribers = new Set<() => void>();

export function subscribeMapsAuthFailure(callback: () => void) {
  authFailureSubscribers.add(callback);
  return () => {
    authFailureSubscribers.delete(callback);
  };
}

/** One script and one map API load per page, shared by current and later map screens. */
export function loadMaps(key: string): Promise<MapsApi> {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (mapsLoad) return mapsLoad;
  mapsLoad = new Promise<MapsApi>((resolve, reject) => {
    const script = document.createElement('script');
    const previousAuthFailure = window.gm_authFailure;
    let finished = false;
    const finish = (maps?: MapsApi) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      delete window.__ledgerlineMapsReady;
      if (maps) resolve(maps);
      else {
        window.gm_authFailure = previousAuthFailure;
        script.remove();
        mapsLoad = null;
        reject(new Error('Google Maps is unavailable.'));
      }
    };
    const timer = window.setTimeout(() => finish(), 12000);
    window.__ledgerlineMapsReady = () => finish(window.google?.maps);
    window.gm_authFailure = () => {
      finish();
      authFailureSubscribers.forEach((subscriber) => subscriber());
    };
    script.onerror = () => finish();
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=__ledgerlineMapsReady`;
    document.head.append(script);
  });
  return mapsLoad;
}

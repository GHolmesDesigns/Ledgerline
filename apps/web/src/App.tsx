import { useEffect, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react';

type Route = { title: string; eyebrow: string; path: string };

type MatchReview = {
  id: number;
  reason: string;
  incoming: {
    street: string;
    unit: string | null;
    city: string;
    zip: string;
    mode: string;
    price: number | null;
    provider: string;
    lastSeen: string | null;
  };
  candidate: { id: string; street: string; unit: string | null; city: string; zip: string };
  candidateListings: Array<{ mode: string; price: number | null; lastSeen: string | null }>;
  noteCount: number;
};

const routes: Route[] = [
  { title: 'Search', eyebrow: 'Find your next place', path: '/' },
  { title: 'Compare', eyebrow: 'Side by side', path: '/compare' },
  { title: 'Ranking & data', eyebrow: 'Make it yours', path: '/settings' },
];

function currentPage(pathname: string) {
  if (pathname === '/compare') return routes[1];
  if (pathname === '/settings') return routes[2];
  if (pathname.startsWith('/property/')) {
    return { title: 'Property detail', eyebrow: 'Home details', path: pathname };
  }
  return routes[0];
}

function BrandMark() {
  return (
    <span aria-hidden="true" className="brand-mark">
      <i />
      <i />
      <i />
    </span>
  );
}

function Navigation({ pathname }: { pathname: string }) {
  const page = currentPage(pathname);
  return (
    <nav aria-label="Main navigation" className="primary-nav">
      {routes.map((route) => (
        <a
          aria-current={page.path === route.path ? 'page' : undefined}
          className="nav-link"
          href={route.path}
          key={route.path}
        >
          {route.title}
        </a>
      ))}
    </nav>
  );
}

function MatchReviewPanel() {
  const [items, setItems] = useState<MatchReview[]>([]);
  const [decided, setDecided] = useState<MatchReview[]>([]);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const response = await fetch('/api/match-reviews');
      if (!response.ok) throw new Error('Could not load match reviews.');
      const data = (await response.json()) as { items: MatchReview[] };
      setItems(data.items);
      setError('');
    } catch {
      setError('Match review is unavailable. Start the local API and try again.');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const decide = async (item: MatchReview, action: 'link' | 'keep-separate') => {
    const response = await fetch(`/api/match-reviews/${item.id}/${action}`, { method: 'POST' });
    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? 'Could not save the decision.');
      return;
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setDecided((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
  };

  const undo = async (item: MatchReview) => {
    const response = await fetch(`/api/match-reviews/${item.id}/undo`, { method: 'POST' });
    if (!response.ok) {
      setError('Could not undo the last decision.');
      return;
    }
    setDecided((current) => current.filter((entry) => entry.id !== item.id));
    setItems((current) => [item, ...current]);
  };

  const address = (record: { street: string; unit: string | null; city: string; zip: string }) =>
    `${record.street}${record.unit ? `, Unit ${record.unit}` : ''} · ${record.city} ${record.zip}`;

  return (
    <section aria-labelledby="match-review-heading" className="match-review-panel">
      <div className="panel-heading">
        <div>
          <p className="screen-eyebrow">Property matching</p>
          <h2 id="match-review-heading">Property match review</h2>
        </div>
        <span className="review-count">{items.length} pending</span>
      </div>
      <p className="panel-intro">
        Listings with an unclear address match wait here. Choose where each listing belongs.
      </p>
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 && !error && (
        <p className="review-empty">No property matches need review.</p>
      )}
      <div className="review-list">
        {items.map((item) => (
          <article className="review-card" key={item.id}>
            <p className="review-reason">{item.reason}</p>
            <div className="review-records">
              <div>
                <h3>Incoming listing</h3>
                <p>{address(item.incoming)}</p>
                <p>
                  {item.incoming.mode === 'sale' ? 'Buy' : 'Rent'} ·{' '}
                  {item.incoming.price == null
                    ? 'Price unavailable'
                    : `$${item.incoming.price.toLocaleString()}`}{' '}
                  · {item.incoming.provider}
                </p>
                <p>Last seen: {item.incoming.lastSeen ?? 'Unknown'}</p>
              </div>
              <div>
                <h3>Existing property</h3>
                <p>{address(item.candidate)}</p>
                {item.candidateListings.length === 0 ? (
                  <p>No listings on file</p>
                ) : (
                  item.candidateListings.map((listing, index) => (
                    <p key={`${listing.mode}-${index}`}>
                      {listing.mode === 'sale' ? 'Buy' : 'Rent'} ·{' '}
                      {listing.price == null
                        ? 'Price unavailable'
                        : `$${listing.price.toLocaleString()}`}{' '}
                      · Last seen: {listing.lastSeen ?? 'Unknown'}
                    </p>
                  ))
                )}
                <p>
                  {item.noteCount} {item.noteCount === 1 ? 'note' : 'notes'} attached
                </p>
              </div>
            </div>
            <div className="review-actions">
              <button onClick={() => void decide(item, 'link')} type="button">
                Link to existing
              </button>
              <button
                className="secondary-button"
                onClick={() => void decide(item, 'keep-separate')}
                type="button"
              >
                Keep separate
              </button>
            </div>
          </article>
        ))}
      </div>
      {decided.length > 0 && (
        <div className="review-undo-list">
          <h3>Recent decisions</h3>
          {decided.map((item) => (
            <div className="review-undo-row" key={item.id}>
              <span>{address(item.incoming)}</span>
              <button className="text-button" onClick={() => void undo(item)} type="button">
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type BackupCounts = {
  properties: number;
  notes: number;
  saved: number;
  dismissed: number;
  savedSearches: number;
  matchDecisions: number;
};

type BackupReport = {
  migratedFromVersion: number | null;
  added: BackupCounts;
  alreadyPresent: BackupCounts;
  skipped: Array<{ section: string; label: string; reason: string }>;
};

const backupCountLabels: Array<[keyof BackupCounts, string, string]> = [
  ['notes', 'note', 'notes'],
  ['saved', 'saved home', 'saved homes'],
  ['dismissed', 'dismissed home', 'dismissed homes'],
  ['savedSearches', 'saved search', 'saved searches'],
  ['matchDecisions', 'match decision', 'match decisions'],
  ['properties', 'property', 'properties'],
];

const describeBackupCounts = (counts: BackupCounts) =>
  backupCountLabels
    .filter(([key]) => counts[key] > 0)
    .map(([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`)
    .join(', ');

function BackupPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [exported, setExported] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<BackupReport | null>(null);

  const exportData = async () => {
    setBusy('export');
    setError('');
    setExported('');
    setReport(null);
    try {
      const response = await fetch('/api/backup/export');
      if (!response.ok) throw new Error('The export failed.');
      const name =
        /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
        'ledgerline-backup.json';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExported(name);
    } catch {
      setError('Could not export your data. Start the local API and try again.');
    } finally {
      setBusy(null);
    }
  };

  const importData = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy('import');
    setError('');
    setExported('');
    setReport(null);
    try {
      const response = await fetch('/api/backup/import', {
        method: 'POST',
        body: await file.text(),
      });
      const result = (await response.json()) as { report?: BackupReport; error?: string };
      if (!response.ok || !result.report) {
        setError(result.error ?? 'The import failed and nothing was changed.');
      } else {
        setReport(result.report);
      }
    } catch {
      setError('Could not import the file. Start the local API and try again.');
    } finally {
      setBusy(null);
    }
  };

  const added = report ? describeBackupCounts(report.added) : '';
  const present = report ? describeBackupCounts(report.alreadyPresent) : '';

  return (
    <section aria-labelledby="backup-heading" className="match-review-panel backup-panel">
      <div className="panel-heading">
        <div>
          <p className="screen-eyebrow">Your data</p>
          <h2 id="backup-heading">Backup and restore</h2>
        </div>
      </div>
      <p className="panel-intro">
        Export your notes, saved and dismissed homes, saved searches, and property match decisions
        to one JSON file. Importing merges a file into this database by address and unit and never
        creates duplicates. Listings, prices, and provider keys are not included; Refresh fetches
        listings again. The file stays on this computer.
      </p>
      <div className="backup-actions">
        <button disabled={busy !== null} onClick={() => void exportData()} type="button">
          {busy === 'export' ? 'Exporting…' : 'Export personal data'}
        </button>
      </div>
      <form className="backup-import" onSubmit={(event) => void importData(event)}>
        <label className="backup-file">
          <span>Backup file (.json)</span>
          <input
            accept="application/json,.json"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setReport(null);
              setError('');
            }}
            type="file"
          />
        </label>
        <button className="secondary-button" disabled={!file || busy !== null} type="submit">
          {busy === 'import' ? 'Importing…' : 'Import personal data'}
        </button>
      </form>
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
      <div aria-live="polite" role="status">
        {exported && <p className="backup-result">Exported your personal data to {exported}.</p>}
        {report && (
          <div className="backup-result">
            <p>
              {added ? `Imported ${added}.` : 'Nothing new to import.'}
              {present ? ` Already here: ${present}.` : ''}
              {report.migratedFromVersion !== null
                ? ` Upgraded from backup format ${report.migratedFromVersion}.`
                : ''}
            </p>
            {report.skipped.length > 0 && (
              <>
                <h3>
                  {report.skipped.length} {report.skipped.length === 1 ? 'item' : 'items'} skipped
                </h3>
                <ul>
                  {report.skipped.map((entry, index) => (
                    <li key={index}>
                      {entry.label}: {entry.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

type SearchListing = {
  property: {
    id: string;
    street: string;
    unit: string | null;
    city: string;
    zip: string;
    county: string | null;
    propertyType: string | null;
    beds: number | null;
    bathsTotal: number | null;
    livingAreaSqft: number | null;
    yearBuilt: number | null;
    latitude: number | null;
    longitude: number | null;
  };
  listing: {
    id: string;
    mode: 'sale' | 'rent';
    price: number | null;
    pricePeriod: string;
    status: string;
    provider: string;
    providerLastSeenDate: string | null;
  };
  saved?: boolean;
  dismissed?: boolean;
};

type CountyFeature = {
  type: 'Feature';
  properties: { GEOID: string; NAME: string };
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };
};

type CountyFeatureCollection = { type: 'FeatureCollection'; features: CountyFeature[] };

type SearchFilters = {
  mode: 'sale' | 'rent';
  location: string;
  priceMin: string;
  priceMax: string;
  beds: string;
  baths: string;
  propertyType: string;
  minSqft: string;
  status: string;
  sort: 'newest' | 'price';
  savedOnly: boolean;
  showDismissed: boolean;
};
type SearchTextFilter = Exclude<keyof SearchFilters, 'savedOnly' | 'showDismissed'>;

type SavedSearch = {
  id: number;
  name: string;
  mode: 'sale' | 'rent';
  location: string;
  filters: Record<string, unknown>;
  priceMin: number | null;
  priceMax: number | null;
  pairedSearchId: number | null;
  refreshIntervalDays: number | null;
};

const profileFromSearch = (search: SavedSearch): SearchFilters => ({
  ...emptyFilters(search.mode),
  location: search.location,
  priceMin: search.priceMin?.toString() ?? '',
  priceMax: search.priceMax?.toString() ?? '',
  beds: String(search.filters.beds ?? ''),
  baths: String(search.filters.baths ?? ''),
  propertyType: String(search.filters.propertyType ?? ''),
  minSqft: String(search.filters.minSqft ?? ''),
  status: String(search.filters.status ?? 'active'),
  sort: search.filters.sort === 'price' ? 'price' : 'newest',
  savedOnly: search.filters.savedOnly === true,
  showDismissed: search.filters.showDismissed === true,
});

const searchUrl = (search: SavedSearch) => {
  const filters = profileFromSearch(search);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
  return `/?${query.toString()}`;
};

const intervalLabel = (days: number | null) =>
  days === null ? 'Not set' : days === 1 ? 'Daily' : days === 7 ? 'Weekly' : `Every ${days} days`;

function SavedSearchPanel() {
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      const response = await fetch('/api/saved-searches');
      if (!response.ok) throw new Error('Could not load saved searches.');
      setItems(((await response.json()) as { items: SavedSearch[] }).items);
      setError('');
    } catch {
      setError('Saved searches are unavailable. Start the local API and try again.');
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const update = async (id: number, form: HTMLFormElement) => {
    const data = new FormData(form);
    const interval = String(data.get('interval') ?? '');
    const response = await fetch(`/api/saved-searches/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: String(data.get('name') ?? ''),
        refreshIntervalDays: interval ? Number(interval) : null,
      }),
    });
    if (!response.ok)
      throw new Error(
        ((await response.json()) as { error?: string }).error ?? 'Could not update saved search.',
      );
    await refresh();
  };

  const addRentPair = async (search: SavedSearch) => {
    setBusy(true);
    try {
      const filters = { ...search.filters };
      delete filters.priceMin;
      delete filters.priceMax;
      const response = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${search.location} · Rent`,
          mode: 'rent',
          location: search.location,
          filters,
          refreshIntervalDays: search.refreshIntervalDays,
        }),
      });
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { error?: string }).error ?? 'Could not create Rent search.',
        );
      const rent = ((await response.json()) as { item: SavedSearch }).item;
      const pairResponse = await fetch(`/api/saved-searches/${search.id}/pair`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairedSearchId: rent.id }),
      });
      if (!pairResponse.ok)
        throw new Error(
          ((await pairResponse.json()) as { error?: string }).error ?? 'Could not pair searches.',
        );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create a paired Rent search.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (search: SavedSearch) => {
    const response = await fetch(`/api/saved-searches/${search.id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Could not delete saved search.');
      return;
    }
    await refresh();
  };

  const groups = new Map<string, SavedSearch[]>();
  for (const item of items) {
    const key = item.location.trim().toLocaleLowerCase('en-US');
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <section
      aria-labelledby="saved-searches-heading"
      className="match-review-panel saved-search-panel"
    >
      <div className="panel-heading">
        <div>
          <p className="screen-eyebrow">Search profiles</p>
          <h2 id="saved-searches-heading">Saved searches</h2>
        </div>
        <span className="review-count">{items.length} saved</span>
      </div>
      <p className="panel-intro">
        Saved searches keep their filters on this computer. Opening and filtering searches the local
        database only.
      </p>
      {error && (
        <p role="alert" className="search-error">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="review-empty">No saved searches yet. Save one from Search.</p>
      ) : (
        <div className="saved-search-groups">
          {[...groups.values()].map((group) => (
            <section
              className="saved-search-group"
              key={group[0].location.toLocaleLowerCase('en-US')}
              aria-label={`${group[0].location} saved searches`}
            >
              <h3>{group[0].location}</h3>
              {group.map((search) => {
                const paired = items.find((item) => item.id === search.pairedSearchId);
                return (
                  <form
                    className="saved-search-row"
                    key={search.id}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void update(search.id, event.currentTarget).catch((reason: unknown) =>
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : 'Could not update saved search.',
                        ),
                      );
                    }}
                  >
                    <div className="saved-search-summary">
                      <strong>
                        {search.mode === 'sale' ? 'Buy' : 'Rent'} · {search.name}
                      </strong>
                      <span>
                        {search.priceMin != null || search.priceMax != null
                          ? `$${search.priceMin?.toLocaleString() ?? '0'}–$${search.priceMax?.toLocaleString() ?? 'any'}`
                          : 'No price range'}{' '}
                        · {intervalLabel(search.refreshIntervalDays)}
                      </span>
                      {search.mode === 'sale' && (
                        <span>
                          {paired
                            ? `Paired Rent search on · ${paired.name}`
                            : 'No Rent search · local comps unavailable'}
                        </span>
                      )}
                    </div>
                    <label className="saved-search-edit">
                      Name
                      <input
                        name="name"
                        aria-label={`${search.name} name`}
                        defaultValue={search.name}
                      />
                    </label>
                    <label className="saved-search-edit">
                      Refresh interval
                      <select
                        name="interval"
                        aria-label={`${search.name} refresh interval`}
                        defaultValue={search.refreshIntervalDays?.toString() ?? ''}
                      >
                        <option value="">Not set</option>
                        <option value="1">Daily</option>
                        <option value="7">Weekly</option>
                        <option value="14">Every 14 days</option>
                        <option value="30">Every 30 days</option>
                      </select>
                    </label>
                    <div className="saved-search-actions">
                      <a className="text-button" href={searchUrl(search)}>
                        Open
                      </a>
                      <button className="text-button" type="submit">
                        Save changes
                      </button>
                      {search.mode === 'sale' && !paired && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void addRentPair(search)}
                          type="button"
                        >
                          Add Rent search
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => void remove(search)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </form>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

const emptyFilters = (mode: 'sale' | 'rent'): SearchFilters => ({
  mode,
  location: '',
  priceMin: '',
  priceMax: '',
  beds: '',
  baths: '',
  propertyType: '',
  minSqft: '',
  status: 'active',
  sort: 'newest',
  savedOnly: false,
  showDismissed: false,
});

function searchFromUrl(): SearchFilters {
  if (typeof window === 'undefined') return emptyFilters('sale');
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') === 'rent' ? 'rent' : 'sale';
  return {
    ...emptyFilters(mode),
    location: params.get('location') ?? '',
    priceMin: params.get('priceMin') ?? '',
    priceMax: params.get('priceMax') ?? '',
    beds: params.get('beds') ?? '',
    baths: params.get('baths') ?? '',
    propertyType: params.get('propertyType') ?? '',
    minSqft: params.get('minSqft') ?? '',
    status: params.get('status') ?? 'active',
    sort: params.get('sort') === 'price' ? 'price' : 'newest',
    savedOnly: params.get('savedOnly') === 'true',
    showDismissed: params.get('showDismissed') === 'true',
  };
}

const cityCenters: Record<string, [number, number]> = {
  'fort lauderdale': [-80.137, 26.122],
  miramar: [-80.232, 25.987],
  miami: [-80.192, 25.762],
  'north miami': [-80.186, 25.891],
  'boca raton': [-80.128, 26.368],
  hollywood: [-80.149, 26.011],
};

function CountyMap({
  boundaries,
  items,
  selectedId,
  onSelect,
}: {
  boundaries: CountyFeatureCollection;
  items: SearchListing[];
  selectedId: string | null;
  onSelect: (listingId: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const width = 600;
  const height = 520;
  const coordinates = boundaries.features.flatMap((feature) =>
    feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates.flat()
      : feature.geometry.coordinates.flat(2),
  );
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  const bounds = {
    minLon: Math.min(...longitudes),
    maxLon: Math.max(...longitudes),
    minLat: Math.min(...latitudes),
    maxLat: Math.max(...latitudes),
  };
  const padding = 34;
  const longitudeScale = Math.cos(((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180));
  const adjustedMinLon = bounds.minLon * longitudeScale;
  const adjustedMaxLon = bounds.maxLon * longitudeScale;
  const mapScale = Math.min(
    (width - padding * 2) / (adjustedMaxLon - adjustedMinLon),
    (height - padding * 2) / (bounds.maxLat - bounds.minLat),
  );
  const mapWidth = (adjustedMaxLon - adjustedMinLon) * mapScale;
  const mapHeight = (bounds.maxLat - bounds.minLat) * mapScale;
  const project = (longitude: number, latitude: number) => ({
    x: (width - mapWidth) / 2 + (longitude * longitudeScale - adjustedMinLon) * mapScale,
    y: (height - mapHeight) / 2 + (bounds.maxLat - latitude) * mapScale,
  });
  const pathFor = (rings: number[][][][]) =>
    rings
      .flatMap((polygon) =>
        polygon.map(
          (ring) =>
            ring
              .map(([longitude, latitude], index) => {
                const point = project(longitude, latitude);
                return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
              })
              .join(' ') + ' Z',
        ),
      )
      .join(' ');
  const centroid = (feature: CountyFeature) => {
    const ring =
      feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates[0]
        : (feature.geometry.coordinates[0]?.[0] ?? []);
    const points = ring.slice(0, -1);
    const longitude = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const latitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    return project(longitude, latitude);
  };
  const mapPin = (item: SearchListing, index: number) => {
    const city = item.property.city.trim().toLocaleLowerCase('en-US');
    const exact = item.property.latitude !== null && item.property.longitude !== null;
    const [longitude, latitude] = exact
      ? [item.property.longitude!, item.property.latitude!]
      : (cityCenters[city] ??
        (() => {
          const county = boundaries.features.find(
            (feature) =>
              feature.properties.NAME.replace(/ County$/i, '').toLocaleLowerCase('en-US') ===
              (item.property.county ?? '').toLocaleLowerCase('en-US'),
          );
          if (!county) return [-80.2, 26.1];
          const center = centroid(county);
          const lon =
            (adjustedMinLon + (center.x - (width - mapWidth) / 2) / mapScale) / longitudeScale;
          const lat = bounds.maxLat - (center.y - (height - mapHeight) / 2) / mapScale;
          return [lon, lat];
        })());
    const jitter = exact ? 0 : ((index % 5) - 2) * 0.009;
    return { ...project(longitude + jitter, latitude + jitter * 0.45), approximate: !exact };
  };
  const selected = items.find((item) => item.listing.id === selectedId);
  const priceFor = (item: SearchListing) =>
    item.listing.price == null
      ? 'Price unavailable'
      : item.listing.mode === 'rent'
        ? `$${item.listing.price.toLocaleString('en-US')}/mo`
        : `$${item.listing.price.toLocaleString('en-US')}`;
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPan({
      x: dragStart.panX + (event.clientX - dragStart.x) * (width / rect.width),
      y: dragStart.panY + (event.clientY - dragStart.y) * (height / rect.height),
    });
  };

  return (
    <section aria-label="Results map" className="map-panel">
      <div className="map-panel-heading">
        <div>
          <p className="screen-eyebrow">Local map</p>
          <h2>Results near South Florida</h2>
        </div>
        <span>{items.length} pins</span>
      </div>
      <div
        className="county-map-canvas"
        onPointerDown={(event) =>
          setDragStart({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y })
        }
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragStart(null)}
        onPointerCancel={() => setDragStart(null)}
      >
        <svg
          aria-label="Map of Miami-Dade, Broward, and Palm Beach county boundaries"
          className="county-map"
          role="group"
          viewBox={`0 0 ${width} ${height}`}
        >
          <g
            transform={`translate(${pan.x} ${pan.y}) translate(${width / 2} ${height / 2}) scale(${zoom}) translate(${-width / 2} ${-height / 2})`}
          >
            {boundaries.features.map((feature) => {
              const polygonRings =
                feature.geometry.type === 'Polygon'
                  ? [feature.geometry.coordinates]
                  : feature.geometry.coordinates;
              const center = centroid(feature);
              return (
                <g key={feature.properties.GEOID}>
                  <path
                    aria-label={feature.properties.NAME}
                    className="county-shape"
                    d={pathFor(polygonRings)}
                  />
                  <text className="county-label" x={center.x} y={center.y}>
                    {feature.properties.NAME.replace(/ County$/i, '')}
                  </text>
                </g>
              );
            })}
            {items.map((item, index) => {
              const pin = mapPin(item, index);
              const isSelected = item.listing.id === selectedId;
              return (
                <g
                  aria-label={`Select ${priceFor(item)}, ${item.property.street}, ${item.property.city}${pin.approximate ? ', approximate city location' : ''}; map pin ${index + 1} of ${items.length}`}
                  aria-pressed={isSelected}
                  className={`map-pin${isSelected ? ' selected' : ''}`}
                  key={item.listing.id}
                  onClick={() => onSelect(item.listing.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(item.listing.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <circle cx={pin.x} cy={pin.y} r={isSelected ? 15 : 12} />
                  <text x={pin.x} y={pin.y + 4}>
                    {index + 1}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div
          className="map-zoom-controls"
          aria-label="Map zoom controls"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Zoom in"
            onClick={() => setZoom((current) => Math.min(2.5, current + 0.25))}
            type="button"
          >
            +
          </button>
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((current) => Math.max(0.75, current - 0.25))}
            type="button"
          >
            −
          </button>
        </div>
      </div>
      <p className="map-attribution">
        County boundaries: U.S. Census Bureau TIGERweb, 2026. Pins without listing coordinates show
        approximate city locations.
      </p>
      {selected && (
        <div aria-live="polite" className="map-selected-card">
          <div>
            <strong>{priceFor(selected)}</strong>
            <span>
              {selected.property.street}
              {selected.property.unit ? `, Unit ${selected.property.unit}` : ''} ·{' '}
              {selected.property.city}
            </span>
          </div>
          <a href={`/property/${selected.property.id}`}>View details</a>
        </div>
      )}
    </section>
  );
}

type PropertyNote = {
  id: number;
  propertyId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};
type PropertyDetailData = {
  property: SearchListing['property'] & {
    lotSizeSqft: number | null;
    bathsFull: number | null;
    bathsHalf: number | null;
    parcelId: string | null;
  };
  listings: Array<
    SearchListing['listing'] & {
      mlsName: string | null;
      mlsNumber: string | null;
      sourceUrl: string | null;
      agentName: string | null;
      agentPhone: string | null;
      agentEmail: string | null;
      officeName: string | null;
      officePhone: string | null;
      officeEmail: string | null;
      providerListedDate: string | null;
      providerRemovedDate: string | null;
      firstFetchedAt: string;
      lastFetchedAt: string;
      fieldQuality: Record<string, string>;
      providerHistory: Array<{ date: string; price: number | null; status: string | null }>;
      localSnapshots: Array<{
        id: number;
        fetchedAt: string;
        price: number | null;
        status: string;
      }>;
    }
  >;
  notes: PropertyNote[];
  saved: boolean;
  dismissed: boolean;
};

const compareStorageKey = 'ledgerline.compare-properties';
const compareChangedEvent = 'ledgerline:compare-changed';

function readCompareIds() {
  if (typeof window === 'undefined') return [] as string[];
  const queryIds = new URLSearchParams(window.location.search).get('properties');
  if (window.location.pathname === '/compare' && queryIds !== null) {
    return [...new Set(queryIds.split(',').filter(Boolean))].slice(0, 4);
  }
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(compareStorageKey) ?? '[]');
    return Array.isArray(saved)
      ? [...new Set(saved.filter((value): value is string => typeof value === 'string'))].slice(
          0,
          4,
        )
      : [];
  } catch {
    return [];
  }
}

function saveCompareIds(ids: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(compareStorageKey, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent(compareChangedEvent, { detail: ids }));
}

function useCompareSet() {
  const [ids, setIds] = useState<string[]>(readCompareIds);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<string[]>).detail;
      if (Array.isArray(detail)) setIds(detail);
    };
    const restore = () => setIds(readCompareIds());
    window.addEventListener(compareChangedEvent, receive);
    window.addEventListener('popstate', restore);
    return () => {
      window.removeEventListener(compareChangedEvent, receive);
      window.removeEventListener('popstate', restore);
    };
  }, []);
  return { ids, save: saveCompareIds };
}

function PropertyDetailScreen({ propertyId }: { propertyId: string }) {
  const compare = useCompareSet();
  const [data, setData] = useState<PropertyDetailData | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [error, setError] = useState('');
  const [compareMessage, setCompareMessage] = useState('');

  const toggleCompare = () => {
    if (compare.ids.includes(propertyId)) {
      compare.save(compare.ids.filter((id) => id !== propertyId));
      setCompareMessage('Removed from Compare.');
    } else if (compare.ids.length >= 4) {
      setCompareMessage('Compare is full. Remove a property before adding another.');
    } else {
      compare.save([...compare.ids, propertyId]);
      setCompareMessage('Added to Compare.');
    }
  };

  const refresh = async () => {
    try {
      const response = await fetch(`/api/properties/${propertyId}`);
      const result = (await response.json()) as PropertyDetailData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Property details are unavailable.');
      setData(result);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Property details are unavailable.');
    }
  };
  useEffect(() => {
    void refresh();
  }, [propertyId]);

  const toggle = async (field: 'favorite' | 'dismissal') => {
    if (!data) return;
    const key = field === 'favorite' ? 'saved' : 'dismissed';
    const value = !data[key];
    const response = await fetch(`/api/properties/${propertyId}/${field}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    if (!response.ok) {
      setError('Could not update this property.');
      return;
    }
    setData({ ...data, [key]: value });
  };

  const addNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`/api/properties/${propertyId}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: noteBody }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? 'Could not add note.');
      return;
    }
    setNoteBody('');
    await refresh();
  };

  const saveEdit = async (noteId: number) => {
    const response = await fetch(`/api/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: editingBody }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? 'Could not update note.');
      return;
    }
    setEditingId(null);
    setEditingBody('');
    await refresh();
  };

  const deleteNote = async (noteId: number) => {
    const response = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Could not delete note.');
      return;
    }
    await refresh();
  };

  if (!data)
    return (
      <section className="property-detail-panel" aria-label="Property details">
        {error ? <p role="alert">{error}</p> : <p>Loading property details…</p>}
      </section>
    );
  const { property, listings, notes } = data;
  const missingFields = [
    ['Property type', property.propertyType],
    ['Bedrooms', property.beds],
    ['Bathrooms', property.bathsTotal],
    ['Living area', property.livingAreaSqft],
    ['Lot size', property.lotSizeSqft],
    ['Year built', property.yearBuilt],
  ].filter(([, value]) => value == null);
  const addressQuery = encodeURIComponent(
    `${property.street}${property.unit ? ` ${property.unit}` : ''}, ${property.city}, FL ${property.zip}`,
  );
  const streetView =
    property.latitude != null && property.longitude != null
      ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${property.latitude},${property.longitude}`
      : null;
  const priceText = (price: number | null, mode: 'sale' | 'rent') =>
    price == null
      ? 'Price unavailable'
      : `$${price.toLocaleString()}${mode === 'rent' ? '/mo' : ''}`;
  return (
    <section className="property-detail-panel" aria-label="Property details">
      <div className="property-detail-heading">
        <div>
          <p className="screen-eyebrow">
            {property.city} · {property.county ?? 'Florida'} County, {property.zip}
          </p>
          <h2>
            {property.street}
            {property.unit ? `, Unit ${property.unit}` : ''}
          </h2>
          <p>
            {property.beds ?? '—'} bd · {property.bathsTotal ?? '—'} ba ·{' '}
            {property.livingAreaSqft?.toLocaleString() ?? '—'} sq ft ·{' '}
            {property.yearBuilt ?? 'Year unknown'}
          </p>
        </div>
        <div className="property-actions property-desktop-actions">
          <button aria-pressed={data.saved} onClick={() => void toggle('favorite')} type="button">
            {data.saved ? 'Saved' : 'Save property'}
          </button>
          <button
            aria-pressed={data.dismissed}
            className="secondary-button"
            onClick={() => void toggle('dismissal')}
            type="button"
          >
            {data.dismissed ? 'Undo dismissal' : 'Dismiss property'}
          </button>
          <button className="secondary-button" onClick={toggleCompare} type="button">
            {compare.ids.includes(property.id) ? 'Remove from Compare' : 'Compare'}
          </button>
          <a className="button-link secondary-button" href={`/?location=${addressQuery}`}>
            Search this address
          </a>
        </div>
      </div>
      {error && (
        <p role="alert" className="search-error">
          {error}
        </p>
      )}
      {compareMessage && <p role="status">{compareMessage}</p>}
      <section aria-labelledby="property-listings-heading" className="property-detail-section">
        <h3 id="property-listings-heading">Listings</h3>
        <ul className="property-listing-list">
          {listings.map((listing) => (
            <li key={listing.id}>
              <strong>{listing.mode === 'sale' ? 'Buy' : 'Rent'}</strong>
              <span>{priceText(listing.price, listing.mode)}</span>
              <span>{listing.status}</span>
              <span>{listing.provider}</span>
              <span>Last seen {listing.providerLastSeenDate ?? 'unknown'}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="property-facts-heading" className="property-detail-section">
        <h3 id="property-facts-heading">Property facts</h3>
        <dl className="property-facts-grid">
          <div>
            <dt>Type</dt>
            <dd>{property.propertyType?.replaceAll('_', ' ') ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Bedrooms</dt>
            <dd>{property.beds ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Bathrooms</dt>
            <dd>
              {property.bathsTotal ?? 'Unknown'}
              {property.bathsFull != null
                ? ` (${property.bathsFull} full${property.bathsHalf ? `, ${property.bathsHalf} half` : ''})`
                : ''}
            </dd>
          </div>
          <div>
            <dt>Living area</dt>
            <dd>{property.livingAreaSqft?.toLocaleString() ?? 'Unknown'} sq ft</dd>
          </div>
          <div>
            <dt>Lot size</dt>
            <dd>{property.lotSizeSqft?.toLocaleString() ?? 'Unknown'} sq ft</dd>
          </div>
          <div>
            <dt>Year built</dt>
            <dd>{property.yearBuilt ?? 'Unknown'}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="property-history-heading" className="property-detail-section">
        <h3 id="property-history-heading">Price and status history</h3>
        {listings.map((listing) => (
          <div className="property-history-listing" key={listing.id}>
            <h4>
              {listing.mode === 'sale' ? 'Buy' : 'Rent'} · {listing.provider}
            </h4>
            <div className="history-columns">
              <section aria-label={`${listing.mode} provider history`}>
                <h5>Provider history</h5>
                {(listing.providerHistory ?? []).length === 0 ? (
                  <p>Not supplied by this provider.</p>
                ) : (
                  <ul>
                    {listing.providerHistory.map((entry, index) => (
                      <li key={`${entry.date}-${index}`}>
                        <time dateTime={entry.date}>{entry.date}</time> ·{' '}
                        {priceText(entry.price, listing.mode)} · {entry.status ?? 'Status unknown'}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-label={`${listing.mode} local snapshots`}>
                <h5>Local snapshots</h5>
                {(listing.localSnapshots ?? []).length === 0 ? (
                  <p>No local snapshots yet.</p>
                ) : (
                  <ul>
                    {listing.localSnapshots.map((entry) => (
                      <li key={entry.id}>
                        <time dateTime={entry.fetchedAt}>
                          {new Date(entry.fetchedAt).toLocaleDateString()}
                        </time>{' '}
                        · {priceText(entry.price, listing.mode)} · {entry.status}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        ))}
      </section>
      <section aria-labelledby="verification-heading" className="property-detail-section">
        <h3 id="verification-heading">Verify listing by hand</h3>
        <p>The app does not open or fetch listing pages for you.</p>
        <ul className="verification-list">
          {listings.map((listing) => (
            <li key={listing.id}>
              <h4>
                {listing.mode === 'sale' ? 'Buy' : 'Rent'} · {listing.provider}
              </h4>
              {listing.sourceUrl && (
                <a href={listing.sourceUrl} target="_blank" rel="noreferrer">
                  Open provider listing
                </a>
              )}
              {(listing.mlsName || listing.mlsNumber) && (
                <p>MLS: {[listing.mlsName, listing.mlsNumber].filter(Boolean).join(' ')}</p>
              )}
              {(listing.agentName || listing.agentPhone || listing.agentEmail) && (
                <p>
                  Agent:{' '}
                  {[listing.agentName, listing.agentPhone, listing.agentEmail]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {(listing.officeName || listing.officePhone || listing.officeEmail) && (
                <p>
                  Office:{' '}
                  {[listing.officeName, listing.officePhone, listing.officeEmail]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${addressQuery}`}
                target="_blank"
                rel="noreferrer"
              >
                Search this address
              </a>
            </li>
          ))}
        </ul>
        {streetView && (
          <a href={streetView} target="_blank" rel="noreferrer">
            Open Street View
          </a>
        )}
      </section>
      <section aria-labelledby="data-quality-heading" className="property-detail-section">
        <h3 id="data-quality-heading">Data quality and freshness</h3>
        <p>
          {missingFields.length
            ? `Missing property fields: ${missingFields.map(([label]) => label).join(', ')}.`
            : 'All core property facts are present.'}
        </p>
        {listings.map((listing) => {
          const seen = listing.providerLastSeenDate
            ? new Date(`${listing.providerLastSeenDate}T00:00:00`).getTime()
            : Number.NaN;
          const staleListing =
            !Number.isFinite(seen) || Date.now() - seen > 7 * 24 * 60 * 60 * 1000;
          const flagged = Object.entries(listing.fieldQuality ?? {}).filter(
            ([, value]) => value && value !== 'ok',
          );
          return (
            <div className="freshness-row" key={listing.id}>
              <strong>{listing.mode === 'sale' ? 'Buy' : 'Rent'}</strong>
              <span>
                {staleListing ? 'Stale' : 'Current'} · provider last seen{' '}
                {listing.providerLastSeenDate ?? 'unknown'}
              </span>
              <span>
                Last local refresh{' '}
                {listing.lastFetchedAt
                  ? new Date(listing.lastFetchedAt).toLocaleString()
                  : 'unknown'}
              </span>
              {flagged.length > 0 && (
                <span>
                  Check fields: {flagged.map(([field, value]) => `${field} (${value})`).join(', ')}
                </span>
              )}
            </div>
          );
        })}
      </section>
      <section aria-labelledby="property-notes-heading" className="property-detail-section">
        <h3 id="property-notes-heading">Notes</h3>
        {notes.length === 0 ? (
          <p className="review-empty">No notes yet.</p>
        ) : (
          <ul className="property-notes-list">
            {notes.map((note) => (
              <li key={note.id}>
                {editingId === note.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEdit(note.id);
                    }}
                  >
                    <label>
                      Edit note
                      <textarea
                        aria-label={`Edit note ${note.id}`}
                        value={editingBody}
                        onChange={(event) => setEditingBody(event.target.value)}
                        required
                      />
                    </label>
                    <div className="property-actions">
                      <button type="submit">Save note</button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p>{note.body}</p>
                    <time dateTime={note.updatedAt}>
                      {note.updatedAt === note.createdAt ? 'Added' : 'Updated'}{' '}
                      {new Date(note.updatedAt).toLocaleString()}
                    </time>
                    <div className="property-actions">
                      <button
                        className="text-button"
                        onClick={() => {
                          setEditingId(note.id);
                          setEditingBody(note.body);
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="text-button"
                        onClick={() => void deleteNote(note.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form className="property-note-form" onSubmit={(event) => void addNote(event)}>
          <label htmlFor="new-property-note">Add a note</label>
          <textarea
            id="new-property-note"
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            required
            rows={3}
          />
          <button type="submit">Add note</button>
        </form>
      </section>
      <nav aria-label="Property actions" className="property-mobile-actions">
        <button aria-pressed={data.saved} onClick={() => void toggle('favorite')} type="button">
          {data.saved ? 'Saved' : 'Save'}
        </button>
        <button onClick={toggleCompare} type="button">
          {compare.ids.includes(property.id) ? 'Remove' : 'Compare'}
        </button>
        <a href={`/?location=${addressQuery}`}>Search this address</a>
      </nav>
    </section>
  );
}

function CompareScreen() {
  const compare = useCompareSet();
  const [properties, setProperties] = useState<PropertyDetailData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches,
  );
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  useEffect(() => {
    const updateViewport = () => setMobile(window.matchMedia('(max-width: 700px)').matches);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    const search = compare.ids.length
      ? `?${new URLSearchParams({ properties: compare.ids.join(',') }).toString()}`
      : '';
    const nextUrl = `${window.location.pathname}${search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
    saveCompareIds(compare.ids);
  }, [compare.ids]);

  useEffect(() => {
    setLeftId((current) => (compare.ids.includes(current) ? current : (compare.ids[0] ?? '')));
    setRightId((current) =>
      compare.ids.includes(current) ? current : (compare.ids[1] ?? compare.ids[0] ?? ''),
    );
  }, [compare.ids]);

  useEffect(() => {
    let cancelled = false;
    if (compare.ids.length === 0) {
      setProperties([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    void Promise.all(
      compare.ids.map(async (id) => {
        const response = await fetch(`/api/properties/${id}`);
        const result = (await response.json()) as PropertyDetailData & { error?: string };
        if (!response.ok) throw new Error(result.error ?? `Could not load ${id}.`);
        return result;
      }),
    )
      .then((items) => {
        if (!cancelled) {
          setProperties(items);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setProperties([]);
          setError(reason instanceof Error ? reason.message : 'Compare is unavailable.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compare.ids]);

  const remove = (propertyId: string) =>
    compare.save(compare.ids.filter((id) => id !== propertyId));
  const displayColumns = mobile
    ? [
        properties.find((item) => item.property.id === leftId),
        properties.find((item) => item.property.id === rightId),
      ]
        .filter((item): item is PropertyDetailData => item != null)
        .filter(
          (item, index, all) =>
            all.findIndex((other) => other.property.id === item.property.id) === index,
        )
    : properties;
  const addressOf = (item: PropertyDetailData) =>
    `${item.property.street}${item.property.unit ? `, Unit ${item.property.unit}` : ''}`;
  const listingPrice = (item: PropertyDetailData) =>
    item.listings.length
      ? item.listings
          .map((listing) => {
            const price =
              listing.price == null ? 'Price unavailable' : `$${listing.price.toLocaleString()}`;
            return `${listing.mode === 'sale' ? 'Buy' : 'Rent'}: ${price}${listing.mode === 'rent' ? '/mo' : ''}`;
          })
          .join(' · ')
      : 'No listings on file';
  const listingStatus = (item: PropertyDetailData) =>
    item.listings
      .map((listing) => `${listing.mode === 'sale' ? 'Buy' : 'Rent'}: ${listing.status}`)
      .join(' · ') || 'No listings on file';
  const addressSearch = (item: PropertyDetailData) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${addressOf(item)}, ${item.property.city}, FL ${item.property.zip}`)}`;
  const rows: Array<[string, (item: PropertyDetailData) => ReactNode]> = [
    ['Price', listingPrice],
    ['Status', listingStatus],
    ['Type', (item) => item.property.propertyType?.replaceAll('_', ' ') ?? 'Unknown'],
    [
      'Beds / baths / area',
      (item) =>
        `${item.property.beds ?? '—'} bd · ${item.property.bathsTotal ?? '—'} ba · ${item.property.livingAreaSqft?.toLocaleString() ?? '—'} sq ft`,
    ],
    ['Year built', (item) => item.property.yearBuilt ?? 'Unknown'],
    [
      'Notes',
      (item) =>
        item.notes.length ? (
          <ul className="compare-notes">
            {item.notes.map((note) => (
              <li key={note.id}>{note.body}</li>
            ))}
          </ul>
        ) : (
          'No notes'
        ),
    ],
    [
      'Verify',
      (item) => (
        <div className="compare-verification">
          {item.listings.map((listing) => (
            <div key={listing.id}>
              {listing.sourceUrl ? (
                <a href={listing.sourceUrl} target="_blank" rel="noreferrer">
                  Open {listing.mode === 'sale' ? 'Buy' : 'Rent'} source
                </a>
              ) : (
                <span>
                  {listing.mlsName || listing.mlsNumber
                    ? `MLS ${[listing.mlsName, listing.mlsNumber].filter(Boolean).join(' ')}`
                    : 'No MLS details supplied'}
                </span>
              )}
              {(listing.agentName || listing.officeName) && (
                <span>{[listing.agentName, listing.officeName].filter(Boolean).join(' · ')}</span>
              )}
            </div>
          ))}
          <a href={addressSearch(item)} target="_blank" rel="noreferrer">
            Search address
          </a>
        </div>
      ),
    ],
  ];

  if (compare.ids.length === 0) {
    return (
      <section aria-label="Compare properties" className="compare-empty empty-panel">
        <div>
          <h2>No properties to compare yet</h2>
          <p>Add up to four properties from Search to see them side by side.</p>
          <a href="/">Go to Search</a>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Compare properties" className="compare-screen">
      <div className="compare-heading-row">
        <p>{compare.ids.length} of 4 properties selected</p>
        <a href="/">Add properties from Search</a>
      </div>
      {mobile && (
        <div className="compare-selectors">
          <label>
            Left property
            <select
              aria-label="Left property"
              value={leftId}
              onChange={(event) => setLeftId(event.target.value)}
            >
              {properties.map((item) => (
                <option key={item.property.id} value={item.property.id}>
                  {addressOf(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Right property
            <select
              aria-label="Right property"
              value={rightId}
              onChange={(event) => setRightId(event.target.value)}
            >
              {properties.map((item) => (
                <option key={item.property.id} value={item.property.id}>
                  {addressOf(item)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p aria-live="polite">Loading saved properties…</p>
      ) : (
        !error && (
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col">Property</th>
                  {displayColumns.map((item) => (
                    <th data-property-id={item.property.id} key={item.property.id} scope="col">
                      <div className="compare-property-heading">
                        <a href={`/property/${item.property.id}`}>{addressOf(item)}</a>
                        <span>
                          {item.property.city} · {item.property.zip}
                        </span>
                        <button
                          aria-label={`Remove ${addressOf(item)} from Compare`}
                          onClick={() => remove(item.property.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {displayColumns.map((item) => (
                      <td data-property-id={item.property.id} key={item.property.id}>
                        {value(item)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}

function SearchScreen() {
  const compare = useCompareSet();
  const [filters, setFilters] = useState<SearchFilters>(searchFromUrl);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [selectedSearchId, setSelectedSearchId] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveInterval, setSaveInterval] = useState('');
  const [ranges, setRanges] = useState({ sale: { min: '', max: '' }, rent: { min: '', max: '' } });
  const [items, setItems] = useState<SearchListing[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [boundaries, setBoundaries] = useState<CountyFeatureCollection | null>(null);
  const [boundaryError, setBoundaryError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [compareMessage, setCompareMessage] = useState('');

  const refreshSavedSearches = async () => {
    try {
      const response = await fetch('/api/saved-searches');
      if (response.ok)
        setSavedSearches(((await response.json()) as { items: SavedSearch[] }).items);
    } catch {
      /* The search page remains usable if saved searches are unavailable. */
    }
  };

  useEffect(() => {
    void refreshSavedSearches();
  }, []);

  const savedSearchPayload = (name: string) => ({
    name: name.trim(),
    mode: filters.mode,
    location: filters.location.trim(),
    filters: {
      beds: filters.beds,
      baths: filters.baths,
      propertyType: filters.propertyType,
      minSqft: filters.minSqft,
      status: filters.status,
      sort: filters.sort,
      savedOnly: filters.savedOnly,
      showDismissed: filters.showDismissed,
    },
    priceMin: filters.priceMin ? Number(filters.priceMin) : null,
    priceMax: filters.priceMax ? Number(filters.priceMax) : null,
    refreshIntervalDays: saveInterval ? Number(saveInterval) : null,
  });

  const saveSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const response = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(savedSearchPayload(saveName)),
      });
      const data = (await response.json()) as { item?: SavedSearch; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error ?? 'Could not save search.');
      await refreshSavedSearches();
      setSelectedSearchId(String(data.item.id));
      setSaveName('');
      setSaveInterval('');
      setShowSaveForm(false);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save search.');
    }
  };

  const updateCurrentSearch = async () => {
    const search = savedSearches.find((item) => item.id === Number(selectedSearchId));
    if (!search) return;
    const response = await fetch(`/api/saved-searches/${search.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(savedSearchPayload(search.name)),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? 'Could not update saved search.');
      return;
    }
    await refreshSavedSearches();
    setError('');
  };

  useEffect(() => {
    let cancelled = false;
    void fetch('/geo/florida-counties.geojson')
      .then(async (response) => {
        if (!response.ok) throw new Error('Local county data unavailable.');
        const data = (await response.json()) as CountyFeatureCollection;
        if (!cancelled) setBoundaries(data);
      })
      .catch(() => {
        if (!cancelled) setBoundaryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setRanges((current) => ({
      ...current,
      [filters.mode]: { min: filters.priceMin, max: filters.priceMax },
    }));
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
    const search = query.toString();
    if (window.location.search !== (search ? `?${search}` : '')) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`,
      );
    }
    let cancelled = false;
    setLoading(true);
    const fetchResults = async () => {
      try {
        const response = await fetch(`/api/listings?${search}`);
        const data = (await response.json()) as { items?: SearchListing[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Could not load listings.');
        if (!cancelled) {
          setItems(data.items ?? []);
          setError('');
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setError('Search is unavailable. Start the local API and try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchResults();
    void fetch('/api/listings/capabilities')
      .then(async (response) => {
        if (response.ok) setCapabilities((await response.json()) as Record<string, boolean>);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    const restore = () => setFilters(searchFromUrl());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((item) => item.listing.id === selectedId)) {
      setSelectedId(items[0].listing.id);
    }
  }, [items, selectedId]);

  useEffect(() => {
    if (!selectedId || (window.matchMedia('(max-width: 700px)').matches && mobileView === 'map'))
      return;
    document
      .getElementById(`listing-${selectedId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId, mobileView]);

  const update = (key: SearchTextFilter, value: string) =>
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === 'priceMin' || key === 'priceMax') {
        const range = {
          min: key === 'priceMin' ? value : current.priceMin,
          max: key === 'priceMax' ? value : current.priceMax,
        };
        setRanges((previous) => ({ ...previous, [current.mode]: range }));
      }
      return next;
    });

  const mutateProperty = async (
    propertyId: string,
    field: 'favorite' | 'dismissal',
    value: boolean,
  ) => {
    const key = field === 'favorite' ? 'saved' : 'dismissed';
    try {
      const response = await fetch(`/api/properties/${propertyId}/${field}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not update this property.');
      setItems((current) =>
        current
          .map((entry) => (entry.property.id === propertyId ? { ...entry, [key]: value } : entry))
          .filter(
            (entry) =>
              !(
                entry.property.id === propertyId &&
                value &&
                field === 'dismissal' &&
                !filters.showDismissed
              ),
          )
          .filter(
            (entry) =>
              !(
                entry.property.id === propertyId &&
                field === 'favorite' &&
                !value &&
                filters.savedOnly
              ),
          ),
      );
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update this property.');
    }
  };

  const toggleCompare = (propertyId: string) => {
    if (compare.ids.includes(propertyId)) {
      compare.save(compare.ids.filter((id) => id !== propertyId));
      setCompareMessage('Property removed from Compare.');
    } else if (compare.ids.length >= 4) {
      setCompareMessage('Compare is full. Remove a property before adding another.');
    } else {
      compare.save([...compare.ids, propertyId]);
      setCompareMessage('Property added to Compare.');
    }
  };

  const switchMode = (mode: 'sale' | 'rent') =>
    setFilters((current) => ({
      ...current,
      mode,
      priceMin: ranges[mode].min,
      priceMax: ranges[mode].max,
    }));
  const clear = (key: keyof SearchFilters) => {
    if (key === 'savedOnly' || key === 'showDismissed') {
      setFilters((current) => ({ ...current, [key]: false }));
      return;
    }
    update(key, key === 'status' ? 'active' : key === 'sort' ? 'newest' : '');
  };
  const formatPrice = (price: number | null, mode: string, period: string) => {
    if (price === null) return 'Price unavailable';
    const amount = `$${price.toLocaleString('en-US')}`;
    return mode === 'rent' ? `${amount}${period === 'month' ? '/mo' : `/${period}`}` : amount;
  };
  const stale = (date: string | null) => {
    if (!date) return true;
    return Date.now() - new Date(`${date}T23:59:59`).getTime() > 7 * 86400000;
  };
  const chips = (
    [
      ['location', filters.location],
      ['priceMin', filters.priceMin ? `Min $${Number(filters.priceMin).toLocaleString()}` : ''],
      ['priceMax', filters.priceMax ? `Max $${Number(filters.priceMax).toLocaleString()}` : ''],
      ['beds', filters.beds ? `${filters.beds}+ beds` : ''],
      ['baths', filters.baths ? `${filters.baths}+ baths` : ''],
      ['propertyType', filters.propertyType],
      ['minSqft', filters.minSqft ? `${filters.minSqft}+ sq ft` : ''],
      ['status', filters.status !== 'active' ? filters.status : ''],
      ['savedOnly', filters.savedOnly ? 'Saved only' : ''],
      ['showDismissed', filters.showDismissed ? 'Show dismissed' : ''],
    ] as Array<[keyof SearchFilters, string]>
  ).filter((chip) => chip[1]);

  return (
    <section aria-label="Search listings" className="search-screen">
      <div className="search-topline">
        <div className="mode-switch" aria-label="Listing mode">
          <button
            aria-pressed={filters.mode === 'sale'}
            onClick={() => switchMode('sale')}
            type="button"
          >
            Buy
          </button>
          <button
            aria-pressed={filters.mode === 'rent'}
            onClick={() => switchMode('rent')}
            type="button"
          >
            Rent
          </button>
        </div>
        <p className="browse-note">Browsing uses no provider requests</p>
      </div>
      <div className="search-profile-toolbar">
        <label>
          Saved search
          <select
            aria-label="Open saved search"
            value={selectedSearchId}
            onChange={(event) => {
              setSelectedSearchId(event.target.value);
              const selected = savedSearches.find((item) => item.id === Number(event.target.value));
              if (selected) {
                setFilters(profileFromSearch(selected));
                setError('');
              }
            }}
          >
            <option value="">Current filters</option>
            {savedSearches.map((search) => (
              <option key={search.id} value={search.id}>
                {search.name} · {search.mode === 'sale' ? 'Buy' : 'Rent'}
              </option>
            ))}
          </select>
        </label>
        <div className="search-profile-actions">
          <button
            className="secondary-button"
            onClick={() => {
              setShowSaveForm((shown) => !shown);
              setSaveName(
                filters.location
                  ? `${filters.location} · ${filters.mode === 'sale' ? 'Buy' : 'Rent'}`
                  : '',
              );
            }}
            type="button"
          >
            Save current search
          </button>
          {selectedSearchId && (
            <button
              className="text-button"
              onClick={() => void updateCurrentSearch()}
              type="button"
            >
              Update saved search
            </button>
          )}
        </div>
        {filters.mode === 'sale' &&
          filters.location &&
          (() => {
            const current = savedSearches.find((item) => item.id === Number(selectedSearchId));
            const paired = current?.pairedSearchId
              ? savedSearches.find((item) => item.id === current.pairedSearchId)
              : undefined;
            return (
              <p className="paired-search-note">
                {paired ? (
                  `Paired Rent search on · needed for local comps (${paired.name})`
                ) : (
                  <>
                    No Rent search · local comps unavailable ·{' '}
                    <a href="/settings">Add Rent search</a>
                  </>
                )}
              </p>
            );
          })()}
      </div>
      {showSaveForm && (
        <form className="save-search-form" onSubmit={(event) => void saveSearch(event)}>
          <label>
            Name
            <input
              aria-label="Saved search name"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              required
            />
          </label>
          <label>
            Refresh interval
            <select
              aria-label="Saved search refresh interval"
              value={saveInterval}
              onChange={(event) => setSaveInterval(event.target.value)}
            >
              <option value="">Not set</option>
              <option value="1">Daily</option>
              <option value="7">Weekly</option>
              <option value="14">Every 14 days</option>
              <option value="30">Every 30 days</option>
            </select>
          </label>
          <button type="submit">Save search</button>
          <button className="text-button" onClick={() => setShowSaveForm(false)} type="button">
            Cancel
          </button>
        </form>
      )}
      <div className="filter-panel" aria-label="Search filters">
        <label className="filter-field location-field">
          Location
          <input
            aria-label="City or ZIP"
            placeholder="City or ZIP"
            value={filters.location}
            onChange={(event) => update('location', event.target.value)}
          />
        </label>
        <label className="filter-field">
          {filters.mode === 'rent' ? 'Rent min' : 'Price min'}
          <input
            aria-label={filters.mode === 'rent' ? 'Rent minimum' : 'Price minimum'}
            inputMode="numeric"
            type="number"
            min="0"
            value={filters.priceMin}
            onChange={(event) => update('priceMin', event.target.value)}
          />
        </label>
        <label className="filter-field">
          {filters.mode === 'rent' ? 'Rent max' : 'Price max'}
          <input
            aria-label={filters.mode === 'rent' ? 'Rent maximum' : 'Price maximum'}
            inputMode="numeric"
            type="number"
            min="0"
            value={filters.priceMax}
            onChange={(event) => update('priceMax', event.target.value)}
          />
        </label>
        <label className="filter-field">
          Beds
          <select
            aria-label="Minimum bedrooms"
            value={filters.beds}
            onChange={(event) => update('beds', event.target.value)}
          >
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}+
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          Baths
          <select
            aria-label="Minimum bathrooms"
            value={filters.baths}
            onChange={(event) => update('baths', event.target.value)}
          >
            <option value="">Any</option>
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value}+
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          Property type
          <select
            aria-label="Property type"
            value={filters.propertyType}
            onChange={(event) => update('propertyType', event.target.value)}
          >
            <option value="">Any type</option>
            {[
              ['single_family', 'Single family'],
              ['townhome', 'Townhome'],
              ['condo', 'Condo'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          Min sq ft
          <input
            aria-label="Minimum square feet"
            inputMode="numeric"
            type="number"
            min="0"
            value={filters.minSqft}
            onChange={(event) => update('minSqft', event.target.value)}
          />
        </label>
        <label className="filter-field">
          Status
          <select
            aria-label="Listing status"
            value={filters.status}
            onChange={(event) => update('status', event.target.value)}
          >
            <option value="active">Active only</option>
            <option value="active,pending">Include pending</option>
            <option value="active,under_contract">Include under contract</option>
            <option value="active,pending,under_contract">
              Include pending and under contract
            </option>
          </select>
        </label>
        <label className="filter-field filter-toggle">
          <input
            aria-label="Saved only"
            checked={filters.savedOnly}
            onChange={(event) =>
              setFilters((current) => ({ ...current, savedOnly: event.target.checked }))
            }
            type="checkbox"
          />
          Saved only
        </label>
        <label className="filter-field filter-toggle">
          <input
            aria-label="Show dismissed"
            checked={filters.showDismissed}
            onChange={(event) =>
              setFilters((current) => ({ ...current, showDismissed: event.target.checked }))
            }
            type="checkbox"
          />
          Show dismissed
        </label>
        {capabilities.waterfront && (
          <label className="filter-field">
            <input type="checkbox" /> Waterfront
          </label>
        )}
        {capabilities.yearBuilt && (
          <label className="filter-field">
            Year built
            <input type="number" />
          </label>
        )}
        {capabilities.hoaFee && (
          <label className="filter-field">
            Max HOA
            <input type="number" />
          </label>
        )}
      </div>
      <div className="search-toolbar">
        <div className="filter-chips" aria-label="Active filters">
          {chips.map(([key, label]) => (
            <button className="filter-chip" key={key} onClick={() => clear(key)} type="button">
              {label}
              <span aria-hidden="true"> ×</span>
              <span className="sr-only">Remove {label}</span>
            </button>
          ))}
        </div>
        <label className="sort-control">
          Sort
          <select
            aria-label="Sort listings"
            value={filters.sort}
            onChange={(event) => update('sort', event.target.value as 'newest' | 'price')}
          >
            <option value="newest">Newest</option>
            <option value="price">Price</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="search-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="search-state" aria-live="polite">
          Loading local listings…
        </p>
      ) : items.length === 0 && !error ? (
        <p className="search-state" aria-live="polite">
          No listings match these filters.
        </p>
      ) : (
        <>
          <p className="result-count" aria-live="polite">
            {items.length} {filters.mode === 'sale' ? 'homes to buy' : 'homes to rent'}
          </p>
          <div className="compare-shortcut">
            <span>{compare.ids.length} of 4 properties selected</span>
            <a
              href={
                compare.ids.length ? `/compare?properties=${compare.ids.join(',')}` : '/compare'
              }
            >
              View Compare
            </a>
          </div>
          {compareMessage && <p role="status">{compareMessage}</p>}
          <div className="mobile-map-toggle" aria-label="Results view">
            <button
              aria-pressed={mobileView === 'list'}
              onClick={() => setMobileView('list')}
              type="button"
            >
              List
            </button>
            <button
              aria-pressed={mobileView === 'map'}
              onClick={() => setMobileView('map')}
              type="button"
            >
              Map
            </button>
          </div>
          <div
            className={`search-results-layout ${mobileView === 'map' ? 'mobile-map-active' : ''}`}
          >
            <div className="listing-grid" aria-label="Search results">
              {items.map(({ property, listing, saved = false, dismissed = false }, index) => (
                <article
                  className={`listing-card${selectedId === listing.id ? ' is-selected' : ''}`}
                  id={`listing-${listing.id}`}
                  key={listing.id}
                  onClick={() => setSelectedId(listing.id)}
                >
                  <div className="listing-card-heading">
                    <div>
                      <p className="listing-price">
                        {formatPrice(listing.price, listing.mode, listing.pricePeriod)}
                      </p>
                      <p className="listing-status">{listing.status.replaceAll('_', ' ')}</p>
                    </div>
                    <div className="listing-card-tools">
                      <span className="listing-mode-label">
                        {listing.mode === 'sale' ? 'BUY' : 'RENT'}
                      </span>
                      <button
                        aria-pressed={selectedId === listing.id}
                        className="select-listing"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(listing.id);
                        }}
                        type="button"
                        aria-label={`Select ${property.street} on map`}
                      >
                        Pin {index + 1}
                      </button>
                    </div>
                  </div>
                  <h2>
                    <a href={`/property/${property.id}`}>
                      {property.street}
                      {property.unit ? `, Unit ${property.unit}` : ''}
                    </a>
                  </h2>
                  <p className="listing-location">
                    {property.city} · {property.county ?? 'Florida'} County, {property.zip}
                  </p>
                  <p className="listing-facts">
                    {property.beds ?? '—'} bd <span>·</span> {property.bathsTotal ?? '—'} ba{' '}
                    <span>·</span> {property.livingAreaSqft?.toLocaleString() ?? '—'} sq ft{' '}
                    <span>·</span> {property.yearBuilt ?? 'Year unknown'}
                  </p>
                  <div className="property-actions">
                    <button
                      aria-label={`${saved ? 'Remove' : 'Save'} ${property.street}${property.unit ? ` unit ${property.unit}` : ''} ${saved ? 'from saved homes' : 'to saved homes'}`}
                      aria-pressed={saved}
                      onClick={(event) => {
                        event.stopPropagation();
                        void mutateProperty(property.id, 'favorite', !saved);
                      }}
                      type="button"
                    >
                      {saved ? 'Saved' : 'Save'}
                    </button>
                    <button
                      aria-pressed={compare.ids.includes(property.id)}
                      className="secondary-button"
                      aria-label={`${compare.ids.includes(property.id) ? 'Remove' : 'Compare'} ${property.street}${property.unit ? ` unit ${property.unit}` : ''}${compare.ids.includes(property.id) ? ' from Compare' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCompare(property.id);
                      }}
                      type="button"
                    >
                      {compare.ids.includes(property.id) ? 'In Compare' : 'Compare'}
                    </button>
                    <button
                      aria-label={`${dismissed ? 'Undo dismissal for' : 'Dismiss'} ${property.street}${property.unit ? ` unit ${property.unit}` : ''}`}
                      className="secondary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void mutateProperty(property.id, 'dismissal', !dismissed);
                      }}
                      type="button"
                    >
                      {dismissed ? 'Undo dismissal' : 'Dismiss'}
                    </button>
                  </div>
                  <div className="listing-card-footer">
                    <span>
                      {listing.provider} · last seen {listing.providerLastSeenDate ?? 'unknown'}
                    </span>
                    {stale(listing.providerLastSeenDate) && (
                      <span className="stale-tag">Stale</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div className="results-map-column">
              {boundaries ? (
                <CountyMap
                  boundaries={boundaries}
                  items={items}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ) : (
                <section aria-label="Results map" className="map-panel">
                  <h2>Results map</h2>
                  <p role={boundaryError ? 'alert' : undefined}>
                    {boundaryError
                      ? 'Local county boundaries could not be loaded.'
                      : 'Loading local county boundaries…'}
                  </p>
                </section>
              )}
            </div>
          </div>
        </>
      )}
      <p className="search-disclaimer">
        Results come from the local database. Filtering and sorting never contact a listing
        provider.
      </p>
    </section>
  );
}

export function App({ initialPath }: { initialPath?: string } = {}) {
  const [pathname, setPathname] = useState(
    () => initialPath ?? (typeof window === 'undefined' ? '/' : window.location.pathname),
  );
  const page = currentPage(pathname);

  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <a aria-label="Ledgerline home" className="brand" href="/">
          <BrandMark />
          <span className="brand-name">Ledgerline</span>
        </a>
        <Navigation pathname={pathname} />
        <span className="header-context">Florida home dashboard</span>
      </header>

      <div className="sample-notice" role="status">
        <span className="sample-notice-dot" aria-hidden="true" />
        Sample data — not real listings
      </div>

      <main className="screen-content" id="main-content" tabIndex={-1}>
        <div className="screen-heading">
          <p className="screen-eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
        </div>
        {page.path === '/settings' ? (
          <div className="settings-panels">
            <SavedSearchPanel />
            <MatchReviewPanel />
            <BackupPanel />
          </div>
        ) : page.path === '/' ? (
          <SearchScreen />
        ) : page.path === '/compare' ? (
          <CompareScreen />
        ) : page.path.startsWith('/property/') ? (
          <PropertyDetailScreen propertyId={page.path.slice('/property/'.length)} />
        ) : (
          <section aria-label={`${page.title} placeholder`} className="empty-panel">
            <span aria-hidden="true" className="empty-panel-mark">
              <BrandMark />
            </span>
            <p>Screen content is coming next.</p>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <span>Personal Florida home finder</span>
        <span>Built for one person, on this computer.</span>
      </footer>

      <nav aria-label="Mobile navigation" className="mobile-nav">
        {routes.map((route) => (
          <a
            aria-current={page.path === route.path ? 'page' : undefined}
            className="mobile-nav-link"
            href={route.path}
            key={route.path}
          >
            {route.title}
          </a>
        ))}
      </nav>
    </div>
  );
}

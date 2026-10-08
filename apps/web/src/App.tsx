import { useEffect, useState } from 'react';

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
};

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
};

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
  };
}

function SearchScreen() {
  const [filters, setFilters] = useState<SearchFilters>(searchFromUrl);
  const [ranges, setRanges] = useState({ sale: { min: '', max: '' }, rent: { min: '', max: '' } });
  const [items, setItems] = useState<SearchListing[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setRanges((current) => ({
      ...current,
      [filters.mode]: { min: filters.priceMin, max: filters.priceMax },
    }));
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
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

  const update = (key: keyof SearchFilters, value: string) =>
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

  const switchMode = (mode: 'sale' | 'rent') =>
    setFilters((current) => ({
      ...current,
      mode,
      priceMin: ranges[mode].min,
      priceMax: ranges[mode].max,
    }));
  const clear = (key: keyof SearchFilters) =>
    update(key, key === 'status' ? 'active' : key === 'sort' ? 'newest' : '');
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
          <div className="listing-grid">
            {items.map(({ property, listing }) => (
              <article className="listing-card" key={listing.id}>
                <div className="listing-card-heading">
                  <div>
                    <p className="listing-price">
                      {formatPrice(listing.price, listing.mode, listing.pricePeriod)}
                    </p>
                    <p className="listing-status">{listing.status.replaceAll('_', ' ')}</p>
                  </div>
                  <span className="listing-mode-label">
                    {listing.mode === 'sale' ? 'BUY' : 'RENT'}
                  </span>
                </div>
                <h2>
                  {property.street}
                  {property.unit ? `, Unit ${property.unit}` : ''}
                </h2>
                <p className="listing-location">
                  {property.city} · {property.county ?? 'Florida'} County, {property.zip}
                </p>
                <p className="listing-facts">
                  {property.beds ?? '—'} bd <span>·</span> {property.bathsTotal ?? '—'} ba{' '}
                  <span>·</span> {property.livingAreaSqft?.toLocaleString() ?? '—'} sq ft{' '}
                  <span>·</span> {property.yearBuilt ?? 'Year unknown'}
                </p>
                <div className="listing-card-footer">
                  <span>
                    {listing.provider} · last seen {listing.providerLastSeenDate ?? 'unknown'}
                  </span>
                  {stale(listing.providerLastSeenDate) && <span className="stale-tag">Stale</span>}
                </div>
              </article>
            ))}
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
          <MatchReviewPanel />
        ) : page.path === '/' ? (
          <SearchScreen />
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

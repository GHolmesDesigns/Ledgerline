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

type RequestUsage = {
  ceiling: number;
  used: number;
  remaining: number;
  provider: string;
  tier: string;
  lastSuccessfulRefreshAt: string | null;
  requestsPerRefreshAll: number;
  rentEstimatesUsed: number;
  recommendedTier: string | null;
  projections: Record<string, { remainingRuns: number; projected: number; overCeiling: boolean }>;
  searches: Array<{
    id: number;
    name: string;
    mode: 'sale' | 'rent';
    location: string;
    pairedSearchId: number | null;
    requestsPerRefresh: number;
    measured: boolean;
  }>;
};

async function fetchRequestUsage() {
  const response = await fetch('/api/request-budget');
  if (!response.ok) throw new Error('Request usage is unavailable.');
  return (await response.json()) as RequestUsage;
}

export function RequestUsageHeader({ initialData }: { initialData?: RequestUsage }) {
  const [usage, setUsage] = useState<RequestUsage | null>(initialData ?? null);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void fetchRequestUsage()
        .then((data) => active && setUsage(data))
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('provider-usage-updated', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('provider-usage-updated', refresh);
    };
  }, []);
  const used = usage?.used ?? 0;
  const ceiling = usage?.ceiling ?? 45;
  const lastRefresh = usage?.lastSuccessfulRefreshAt
    ? new Date(usage.lastSuccessfulRefreshAt).toLocaleString()
    : 'No successful refresh yet';
  return (
    <div className="request-usage-header" aria-label="Provider request usage">
      <div className="request-usage-heading">
        <strong>
          {usage?.provider ?? 'Provider'} · {usage?.tier ?? 'loading'} · {used} / {ceiling} requests
        </strong>
        <span>Last refresh · {lastRefresh}</span>
      </div>
      <progress
        aria-label={`${used} of ${ceiling} provider requests used`}
        max={ceiling || 1}
        value={Math.min(used, ceiling)}
      />
      <span className="request-usage-note">Browsing uses no requests</span>
    </div>
  );
}

function RequestBudgetPanel() {
  const [usage, setUsage] = useState<RequestUsage | null>(null);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      setUsage(await fetchRequestUsage());
      setError('');
    } catch {
      setError('Request usage is unavailable. Start the local API and try again.');
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const searchesByLocation = new Map<string, RequestUsage['searches']>();
  for (const search of usage?.searches ?? []) {
    const key = search.location.trim().toLocaleLowerCase('en-US');
    searchesByLocation.set(key, [...(searchesByLocation.get(key) ?? []), search]);
  }
  const projectionLabel = (period: 'weekly' | 'daily') => {
    const projection = usage?.projections[period];
    if (!projection) return '—';
    return `${projection.projected} requests${projection.overCeiling ? ` · over ceiling${usage.recommendedTier ? `, needs ${usage.recommendedTier}` : ''}` : ''}`;
  };
  return (
    <section aria-labelledby="request-budget-heading" className="request-budget-panel">
      <div className="panel-heading">
        <div>
          <p className="screen-eyebrow">Data source &amp; request budget</p>
          <h2 id="request-budget-heading">Provider usage</h2>
        </div>
        <strong>{usage ? `${usage.used} / ${usage.ceiling} this month` : 'Loading usage…'}</strong>
      </div>
      {error && (
        <p role="alert" className="search-error">
          {error}
        </p>
      )}
      {usage && (
        <>
          <progress
            aria-label={`${usage.used} of ${usage.ceiling} provider requests used`}
            max={usage.ceiling || 1}
            value={Math.min(usage.used, usage.ceiling)}
          />
          <p className="panel-intro">
            {usage.provider} · {usage.tier}. Browsing uses no requests. Rent estimates: +1 request
            each · {usage.rentEstimatesUsed} used this month.
          </p>
          <div className="request-projections" aria-label="Monthly request projections">
            <p>
              <strong>Weekly</strong>
              <span>{projectionLabel('weekly')}</span>
            </p>
            <p>
              <strong>Daily</strong>
              <span>{projectionLabel('daily')}</span>
            </p>
          </div>
          <p className="request-search-total">
            Refreshing all saved searches: {usage.requestsPerRefreshAll} requests per run.
          </p>
          {searchesByLocation.size > 0 && (
            <div className="request-search-groups">
              {[...searchesByLocation.values()].map((group) => (
                <section
                  key={group[0].location.toLocaleLowerCase('en-US')}
                  aria-label={`${group[0].location} request usage`}
                >
                  <h3>{group[0].location}</h3>
                  {group.map((search) => {
                    const paired = group.find(
                      (candidate) => candidate.id === search.pairedSearchId,
                    );
                    const buyOnly = search.mode === 'sale' && !paired;
                    return (
                      <p key={search.id}>
                        <span>
                          {search.mode === 'sale' ? 'Buy' : 'Rent'} · {search.name} · ~
                          {search.requestsPerRefresh} requests per refresh
                          {search.measured ? ' (measured)' : ' (estimated)'}
                        </span>
                        {buyOnly && (
                          <span>
                            No Rent search · local comps unavailable ·{' '}
                            <a href="/settings">Add Rent search</a>
                          </span>
                        )}
                      </p>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProviderCredentialsPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/api/provider-credentials')
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as { configured: boolean };
        setConfigured(data.configured);
      })
      .catch(() => setError('Provider credential settings are unavailable.'));
  }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const response = await fetch('/api/provider-credentials', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rentCastApiKey: formData.get('rentCastApiKey') }),
      });
      const data = (await response.json()) as { configured?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not save the key.');
      setConfigured(data.configured === true);
      setEditing(false);
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the key.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="provider-credentials-heading" className="provider-credentials-panel">
      <div className="panel-heading">
        <div>
          <p className="screen-eyebrow">Local API only</p>
          <h2 id="provider-credentials-heading">RentCast key</h2>
        </div>
        <strong role="status">
          {configured === null ? 'Checking…' : configured ? 'Key set' : 'No key set'}
        </strong>
      </div>
      <p className="panel-intro">
        The key is stored on this computer by the local API. It is never returned to the browser.
      </p>
      {configured && !editing ? (
        <button className="text-button" onClick={() => setEditing(true)} type="button">
          Replace key
        </button>
      ) : (
        <form className="provider-key-form" onSubmit={(event) => void save(event)}>
          <label>
            RentCast API key
            <input autoComplete="new-password" name="rentCastApiKey" required type="password" />
          </label>
          <button disabled={busy} type="submit">
            {busy ? 'Saving…' : configured ? 'Save new key' : 'Set key'}
          </button>
          {configured && (
            <button className="text-button" onClick={() => setEditing(false)} type="button">
              Cancel
            </button>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="search-error">
          {error}
        </p>
      )}
    </section>
  );
}

type PersonalAssumptions = {
  downPaymentPct: number;
  mortgageRatePct: number;
  termYears: number;
  maintenancePctPerYear: number;
};
type LocalAssumptions = {
  county: string;
  set: boolean;
  millage: number | null;
  typicalNonAdValoremPerYear: number | null;
  homeownersDefaultMonthly: number | null;
  ho6DefaultMonthly: number | null;
  floodDefaultMonthly: Record<string, number>;
  source: string | null;
  setOn: string | null;
  sample: boolean;
};
type AssumptionSearch = {
  id: number;
  name: string;
  mode: 'sale' | 'rent';
  location: string;
  personal: PersonalAssumptions;
};

function AssumptionsPanel() {
  const [searches, setSearches] = useState<AssumptionSearch[]>([]);
  const [local, setLocal] = useState<LocalAssumptions[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const load = async () => {
    const response = await fetch('/api/assumptions');
    if (!response.ok) throw new Error('Assumptions are unavailable.');
    const data = (await response.json()) as {
      searches: AssumptionSearch[];
      local: LocalAssumptions[];
    };
    setSearches(data.searches);
    setLocal(data.local);
  };
  useEffect(() => {
    void load().catch(() =>
      setErrors({ page: 'Assumptions are unavailable. Start the local API and try again.' }),
    );
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const updatePersonal = (id: number, key: keyof PersonalAssumptions, value: string) => {
    const numeric = value === '' ? 0 : Number(value);
    setSearches((items) =>
      items.map((item) =>
        item.id === id ? { ...item, personal: { ...item.personal, [key]: numeric } } : item,
      ),
    );
  };
  const savePersonal = async (event: FormEvent<HTMLFormElement>, item: AssumptionSearch) => {
    event.preventDefault();
    const key = `search-${item.id}`;
    setBusy(key);
    setErrors((items) => ({ ...items, [key]: '' }));
    try {
      const response = await fetch(`/api/saved-searches/${item.id}/assumptions`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item.personal),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Could not save assumptions.');
      setSaved((items) => ({ ...items, [key]: 'Saved' }));
    } catch (reason) {
      setErrors((items) => ({
        ...items,
        [key]: reason instanceof Error ? reason.message : 'Could not save assumptions.',
      }));
    } finally {
      setBusy(null);
    }
  };
  const updateLocal = (county: string, patch: Partial<LocalAssumptions>) =>
    setLocal((items) =>
      items.map((item) => (item.county === county ? { ...item, ...patch } : item)),
    );
  const saveLocal = async (event: FormEvent<HTMLFormElement>, item: LocalAssumptions) => {
    event.preventDefault();
    const key = `county-${item.county}`;
    setBusy(key);
    setErrors((items) => ({ ...items, [key]: '' }));
    try {
      const response = await fetch(`/api/local-assumptions/${encodeURIComponent(item.county)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...item,
          setOn: item.setOn || new Date().toISOString().slice(0, 10),
          source: item.source ?? '',
        }),
      });
      const data = (await response.json()) as { local?: LocalAssumptions; error?: string };
      if (!response.ok || !data.local) throw new Error(data.error ?? 'Could not save local rates.');
      updateLocal(item.county, data.local);
      setSaved((items) => ({ ...items, [key]: 'Saved' }));
    } catch (reason) {
      setErrors((items) => ({
        ...items,
        [key]: reason instanceof Error ? reason.message : 'Could not save local rates.',
      }));
    } finally {
      setBusy(null);
    }
  };
  const amountField = (
    label: string,
    value: number | null,
    onChange: (next: number | null) => void,
    suffix = '',
  ) => (
    <label className="assumption-field">
      {label}
      <span className="assumption-input-wrap">
        <input
          aria-label={label}
          min="0"
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
          step="any"
          type="number"
          value={value ?? ''}
        />
        <span>{suffix}</span>
      </span>
    </label>
  );
  return (
    <section aria-labelledby="assumptions-heading" className="assumptions-panel">
      <div className="panel-heading">
        <div>
          <p className="screen-eyebrow">Cost inputs</p>
          <h2 id="assumptions-heading">Assumptions</h2>
        </div>
      </div>
      {errors.page && (
        <p role="alert" className="search-error">
          {errors.page}
        </p>
      )}
      <details className="assumption-section" open={!mobile}>
        <summary>Personal assumptions</summary>
        <p className="panel-intro">
          Saved with each search profile. These defaults are used for Buy and Rent searches and can
          be changed separately.
        </p>
        <div className="assumption-groups">
          {searches.map((item) => {
            const key = `search-${item.id}`;
            return (
              <form
                aria-label={`Personal assumptions for ${item.name}`}
                className="assumption-card"
                key={item.id}
                onSubmit={(event) => void savePersonal(event, item)}
              >
                <h4>
                  {item.name} · {item.mode === 'sale' ? 'Buy' : 'Rent'}
                </h4>
                <div className="assumption-fields">
                  <label className="assumption-field">
                    Down payment %
                    <input
                      max="100"
                      min="0"
                      onChange={(event) =>
                        updatePersonal(item.id, 'downPaymentPct', event.target.value)
                      }
                      step="0.1"
                      type="number"
                      value={item.personal.downPaymentPct}
                    />
                  </label>
                  <label className="assumption-field">
                    Mortgage rate %
                    <input
                      max="100"
                      min="0"
                      onChange={(event) =>
                        updatePersonal(item.id, 'mortgageRatePct', event.target.value)
                      }
                      step="0.01"
                      type="number"
                      value={item.personal.mortgageRatePct}
                    />
                  </label>
                  <label className="assumption-field">
                    Term (years)
                    <input
                      max="100"
                      min="1"
                      onChange={(event) => updatePersonal(item.id, 'termYears', event.target.value)}
                      step="1"
                      type="number"
                      value={item.personal.termYears}
                    />
                  </label>
                  <label className="assumption-field">
                    Maintenance % / yr
                    <input
                      max="100"
                      min="0"
                      onChange={(event) =>
                        updatePersonal(item.id, 'maintenancePctPerYear', event.target.value)
                      }
                      step="0.1"
                      type="number"
                      value={item.personal.maintenancePctPerYear}
                    />
                  </label>
                </div>
                {errors[key] && (
                  <p className="search-error" role="alert">
                    {errors[key]}
                  </p>
                )}
                <div className="assumption-actions">
                  <button disabled={busy === key} type="submit">
                    {busy === key ? 'Saving…' : 'Save personal assumptions'}
                  </button>
                  {saved[key] && <span role="status">{saved[key]}</span>}
                </div>
              </form>
            );
          })}
          {searches.length === 0 && (
            <p>No saved searches yet. Save a search to set its personal assumptions.</p>
          )}
        </div>
      </details>
      <details className="assumption-section" open={!mobile}>
        <summary>Local assumptions</summary>
        <p className="panel-intro">
          Rates are specific to a county. Sample figures are placeholders from the fictional
          fixtures; enter local figures and a source when you have verified them.
        </p>
        <div className="assumption-groups">
          {local.map((item) => {
            const key = `county-${item.county}`;
            const setAmount = (field: keyof LocalAssumptions, value: number | null) =>
              updateLocal(item.county, { [field]: value } as Partial<LocalAssumptions>);
            return (
              <form
                aria-label={`${item.county} local assumptions`}
                className="assumption-card"
                key={item.county}
                onSubmit={(event) => void saveLocal(event, item)}
              >
                <div className="assumption-card-heading">
                  <h4>{item.county}</h4>
                  {item.set ? (
                    <span className="assumption-tag">{item.sample ? 'sample' : 'set'}</span>
                  ) : (
                    <strong>Not set · Set local rates</strong>
                  )}
                </div>
                <div className="assumption-fields">
                  {amountField(
                    'Millage',
                    item.millage,
                    (value) => setAmount('millage', value),
                    'mills',
                  )}
                  {amountField(
                    'Typical non-ad valorem / yr',
                    item.typicalNonAdValoremPerYear,
                    (value) => setAmount('typicalNonAdValoremPerYear', value),
                    '$',
                  )}
                  {amountField(
                    'Homeowners default (house) / mo',
                    item.homeownersDefaultMonthly,
                    (value) => setAmount('homeownersDefaultMonthly', value),
                    '$',
                  )}
                  {amountField(
                    'HO-6 default (condo) / mo',
                    item.ho6DefaultMonthly,
                    (value) => setAmount('ho6DefaultMonthly', value),
                    '$',
                  )}
                  {['X', 'X500', 'AE', 'AH', 'AO', 'V', 'VE'].map((zone) =>
                    amountField(
                      `Flood ${zone} / mo`,
                      item.floodDefaultMonthly[zone] ?? null,
                      (value) =>
                        updateLocal(item.county, {
                          floodDefaultMonthly: {
                            ...item.floodDefaultMonthly,
                            ...(value === null ? {} : { [zone]: value }),
                          },
                        }),
                      '$',
                    ),
                  )}
                  <label className="assumption-field">
                    Source
                    <input
                      onChange={(event) => updateLocal(item.county, { source: event.target.value })}
                      required
                      value={item.source ?? ''}
                    />
                  </label>
                  <label className="assumption-field">
                    Date set
                    <input
                      onChange={(event) => updateLocal(item.county, { setOn: event.target.value })}
                      required
                      type="date"
                      value={item.setOn ?? new Date().toISOString().slice(0, 10)}
                    />
                  </label>
                </div>
                {errors[key] && (
                  <p className="search-error" role="alert">
                    {errors[key]}
                  </p>
                )}
                <div className="assumption-actions">
                  <button disabled={busy === key} type="submit">
                    {busy === key ? 'Saving…' : item.set ? 'Save local rates' : 'Set local rates'}
                  </button>
                  {saved[key] && <span role="status">{saved[key]}</span>}
                  {item.set && (
                    <span>
                      {item.source} · set {item.setOn}
                    </span>
                  )}
                </div>
              </form>
            );
          })}
        </div>
      </details>
    </section>
  );
}

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
  costEntries: number;
  properties: number;
  personalAssumptions: number;
  localAssumptions: number;
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
  ['costEntries', 'cost record', 'cost records'],
  ['notes', 'note', 'notes'],
  ['saved', 'saved home', 'saved homes'],
  ['dismissed', 'dismissed home', 'dismissed homes'],
  ['savedSearches', 'saved search', 'saved searches'],
  ['matchDecisions', 'match decision', 'match decisions'],
  ['properties', 'property', 'properties'],
  ['personalAssumptions', 'personal assumption set', 'personal assumption sets'],
  ['localAssumptions', 'local rate set', 'local rate sets'],
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
        Export your notes, saved and dismissed homes, saved searches, personal and local
        assumptions, and property match decisions to one JSON file. Importing merges a file into
        this database by address and unit and never creates duplicates. Listings, prices, and
        provider keys are not included; Refresh fetches listings again. The file stays on this
        computer.
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
  lastSuccessfulRefreshAt: string | null;
  lastRefreshAttemptAt: string | null;
  lastRefreshError: string | null;
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
  const [requestCounts, setRequestCounts] = useState<
    Record<number, { count: number; measured: boolean }>
  >({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const refresh = async () => {
    try {
      const response = await fetch('/api/saved-searches');
      if (!response.ok) throw new Error('Could not load saved searches.');
      setItems(((await response.json()) as { items: SavedSearch[] }).items);
      const usage = await fetchRequestUsage();
      setRequestCounts(
        Object.fromEntries(
          usage.searches.map((search) => [
            search.id,
            { count: search.requestsPerRefresh, measured: search.measured },
          ]),
        ),
      );
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

  const refreshOne = async (search: SavedSearch) => {
    setRefreshingId(search.id);
    try {
      const response = await fetch(`/api/saved-searches/${search.id}/refresh`, { method: 'POST' });
      const data = (await response.json()) as { result?: { error?: string }; error?: string };
      if (!response.ok) throw new Error(data.result?.error ?? data.error ?? 'Refresh failed.');
      await refresh();
      window.dispatchEvent(new Event('provider-usage-updated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Refresh failed.');
      await refresh();
    } finally {
      setRefreshingId(null);
    }
  };

  const refreshDue = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/saved-searches/refresh-due', { method: 'POST' });
      if (!response.ok) throw new Error('Could not refresh due searches.');
      const data = (await response.json()) as { results: Array<{ error?: string }> };
      const failed = data.results.filter((result) => result.error).length;
      if (failed) setError(`${failed} saved search${failed === 1 ? '' : 'es'} failed to refresh.`);
      await refresh();
      window.dispatchEvent(new Event('provider-usage-updated'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh due searches.');
    } finally {
      setBusy(false);
    }
  };

  const refreshStatus = (search: SavedSearch) => {
    if (search.lastRefreshError) {
      const at = search.lastRefreshAttemptAt
        ? new Date(search.lastRefreshAttemptAt).toLocaleString()
        : 'time unavailable';
      return `Refresh failed · ${at}: ${search.lastRefreshError}`;
    }
    if (!search.lastSuccessfulRefreshAt) return 'Never refreshed';
    const at = new Date(search.lastSuccessfulRefreshAt).toLocaleString();
    const stale =
      search.refreshIntervalDays != null &&
      Date.now() - Date.parse(search.lastSuccessfulRefreshAt) >
        search.refreshIntervalDays * 86_400_000;
    return `${stale ? 'Stale · ' : 'Last refreshed · '}${at}`;
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
      {items.length > 0 && (
        <button
          className="text-button"
          disabled={busy || refreshingId !== null}
          onClick={() => void refreshDue()}
          type="button"
        >
          Refresh due searches
        </button>
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
                      <span role="status">{refreshStatus(search)}</span>
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
                      <button
                        aria-label="Refresh now"
                        className="text-button"
                        disabled={busy || refreshingId !== null}
                        onClick={() => void refreshOne(search)}
                        type="button"
                      >
                        {refreshingId === search.id
                          ? 'Refreshing…'
                          : `Refresh this search · ~${requestCounts[search.id]?.count ?? 1} request${(requestCounts[search.id]?.count ?? 1) === 1 ? '' : 's'} (${requestCounts[search.id]?.measured ? 'measured' : 'estimated'})`}
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
                  <path aria-hidden="true" className="county-shape" d={pathFor(polygonRings)} />
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
          role="group"
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
    floodZone?: string | null;
    riskDetails: {
      floodZoneSource: string | null;
      floodZoneDate: string | null;
      roofYear: number | null;
      windMitigation: string[];
      insuranceSource: string | null;
      insuranceDate: string | null;
      milestoneInspection: string | null;
      countyRecertification: string | null;
      reserveStudy: string | null;
      specialAssessment: string | null;
      assessmentAmount: number | null;
      assessmentPaymentType: 'one_time' | 'installments' | null;
      rentalRestrictions: string | null;
      approvalRestrictions: string | null;
      associationSource: string | null;
      associationDate: string | null;
    };
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
  costEntries?: Array<{
    id: number;
    kind: string;
    amount: number | null;
    state: string;
    source: string;
    date: string;
    amountUnknown: boolean;
    assessmentStatus: string | null;
    paymentType: string | null;
    sample: boolean;
  }>;
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
  const [costKind, setCostKind] = useState('homeowners_quote');
  const [costAmount, setCostAmount] = useState('');
  const [costSource, setCostSource] = useState('');
  const [costDate, setCostDate] = useState(new Date().toISOString().slice(0, 10));
  const [costState, setCostState] = useState('Quote');
  const [costAmountUnknown, setCostAmountUnknown] = useState(false);
  const [costAssessmentStatus, setCostAssessmentStatus] = useState('');
  const [costPaymentType, setCostPaymentType] = useState('');
  const [riskDraft, setRiskDraft] = useState<PropertyDetailData['property']['riskDetails'] | null>(
    null,
  );
  const [riskFloodZone, setRiskFloodZone] = useState('');
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskMessage, setRiskMessage] = useState('');
  const [carrierAgeLimit, setCarrierAgeLimit] = useState('');
  const fixedCostState =
    costKind === 'hoa_none' || costKind === 'flood_not_carried'
      ? 'N/A'
      : [
            'tax_bill',
            'tax_bill_cdd',
            'association_fee',
            'special_assessment',
            'assessments_none',
          ].includes(costKind)
        ? 'Doc'
        : null;

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
      setRiskDraft(
        result.property.riskDetails ?? {
          floodZoneSource: null,
          floodZoneDate: null,
          roofYear: null,
          windMitigation: [],
          insuranceSource: null,
          insuranceDate: null,
          milestoneInspection: null,
          countyRecertification: null,
          reserveStudy: null,
          specialAssessment: null,
          assessmentAmount: null,
          assessmentPaymentType: null,
          rentalRestrictions: null,
          approvalRestrictions: null,
          associationSource: null,
          associationDate: null,
        },
      );
      setRiskFloodZone(result.property.floodZone ?? '');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Property details are unavailable.');
    }
  };
  useEffect(() => {
    void refresh();
  }, [propertyId]);
  useEffect(() => {
    try {
      setCarrierAgeLimit(window.localStorage.getItem('ledgerline.carrier-age-limit-years') ?? '');
    } catch {
      setCarrierAgeLimit('');
    }
  }, []);

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

  const addCostEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await fetch(`/api/properties/${propertyId}/cost-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: costKind,
        amount: costAmountUnknown ? null : costAmount === '' ? null : Number(costAmount),
        source: costSource,
        date: costDate,
        state: fixedCostState ?? costState,
        amountUnknown: costAmountUnknown,
        assessmentStatus: costAssessmentStatus || null,
        paymentType: costPaymentType || null,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? 'Could not save cost record.');
      return;
    }
    setCostAmount('');
    setCostSource('');
    setCostAmountUnknown(false);
    setCostAssessmentStatus('');
    setCostPaymentType('');
    await refresh();
  };

  const saveRiskDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!riskDraft) return;
    setRiskBusy(true);
    setRiskMessage('');
    try {
      const response = await fetch(`/api/properties/${propertyId}/risk-details`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ riskDetails: riskDraft, floodZone: riskFloodZone || null }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not save property details.');
      setRiskMessage('Property details saved.');
      await refresh();
    } catch (reason) {
      setRiskMessage(reason instanceof Error ? reason.message : 'Could not save property details.');
    } finally {
      setRiskBusy(false);
    }
  };

  const updateRisk = (
    field: keyof PropertyDetailData['property']['riskDetails'],
    value: unknown,
  ) => {
    setRiskDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  if (!data)
    return (
      <section className="property-detail-panel" aria-label="Property details">
        {error ? <p role="alert">{error}</p> : <p>Loading property details…</p>}
      </section>
    );
  const { property, listings, notes } = data;
  const costEntries = data.costEntries ?? [];
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
      <section aria-labelledby="property-costs-heading" className="property-detail-section">
        <h3 id="property-costs-heading">Cost records and verification</h3>
        <ul aria-label="Cost verification checklist">
          {[
            [
              property.propertyType === 'condo' || property.propertyType === 'co-op'
                ? 'HO-6 quote'
                : 'Homeowners quote',
              property.propertyType === 'condo' || property.propertyType === 'co-op'
                ? 'ho6_quote'
                : 'homeowners_quote',
            ],
            ['Flood quote', 'flood_quote'],
            ['Tax bill', 'tax_bill'],
            ...(property.propertyType === 'single_family'
              ? [['HOA confirmation', 'hoa_none'] as [string, string]]
              : [['Association letter', 'association_fee'] as [string, string]]),
          ].map(([label, kind]) => {
            const entry =
              kind === 'hoa_none'
                ? costEntries.find(
                    (item) => item.kind === 'hoa_none' || item.kind === 'association_fee',
                  )
                : kind === 'association_fee'
                  ? costEntries.find(
                      (item) =>
                        item.kind === 'association_fee' || item.kind === 'special_assessment',
                    )
                  : costEntries.find((item) => item.kind === kind);
            return (
              <li key={kind}>
                {label}:{' '}
                {entry
                  ? `Done · ${entry.state}${entry.sample ? ' · Sample data — not real listings' : ''}`
                  : 'Not done'}
                {!entry && (
                  <button
                    type="button"
                    onClick={() => {
                      setCostKind(kind);
                      document
                        .getElementById('cost-entry-kind')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                  >
                    Enter {label.toLocaleLowerCase()}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <ul aria-label="Saved cost records">
          {costEntries.map((entry) => (
            <li key={entry.id}>
              {entry.kind.replaceAll('_', ' ')} · {entry.state}
              {entry.amount !== null
                ? ` $${entry.amount.toLocaleString()}`
                : entry.amountUnknown
                  ? ' · amount unknown'
                  : ''}{' '}
              · {entry.source} · {entry.date}
              {entry.sample ? ' · Sample data — not real listings' : ''}
            </li>
          ))}
        </ul>
        <form className="property-note-form" onSubmit={(event) => void addCostEntry(event)}>
          <label htmlFor="cost-entry-kind">Record type</label>
          <select
            id="cost-entry-kind"
            value={costKind}
            onChange={(event) => {
              setCostKind(event.target.value);
              if (event.target.value === 'assessments_none') setCostAmount('0');
              else if (costKind === 'assessments_none') setCostAmount('');
            }}
          >
            <option value="homeowners_quote">Homeowners quote</option>
            <option value="ho6_quote">HO-6 quote</option>
            <option value="flood_quote">Flood quote</option>
            <option value="tax_bill">Tax bill · CDD confirmed none</option>
            <option value="tax_bill_cdd">Annual CDD amount on tax bill</option>
            <option value="association_fee">Association letter / fee</option>
            <option value="special_assessment">Special assessment</option>
            <option value="assessments_none">Association letter · no special assessments</option>
            <option value="hoa_none">HOA confirmed none</option>
            {property.floodZone && !/^[av]/i.test(property.floodZone) && (
              <option value="flood_not_carried">Flood policy not carried</option>
            )}
          </select>
          <label htmlFor="cost-entry-amount">
            {costKind === 'tax_bill_cdd'
              ? 'Annual CDD amount'
              : costKind === 'assessments_none'
                ? 'Verified amount'
                : 'Amount'}
          </label>
          <input
            id="cost-entry-amount"
            inputMode="decimal"
            type="number"
            min="0"
            step="0.01"
            value={costAmount}
            onChange={(event) => setCostAmount(event.target.value)}
          />
          {['special_assessment', 'tax_bill_cdd'].includes(costKind) && (
            <label>
              <input
                type="checkbox"
                checked={costAmountUnknown}
                onChange={(event) => setCostAmountUnknown(event.target.checked)}
              />{' '}
              {costKind === 'special_assessment'
                ? 'Amount unknown'
                : 'CDD is known, amount unknown'}
            </label>
          )}
          {costKind === 'special_assessment' && (
            <>
              <label htmlFor="assessment-status">Assessment status</label>
              <select
                id="assessment-status"
                value={costAssessmentStatus}
                onChange={(event) => setCostAssessmentStatus(event.target.value)}
              >
                <option value="">Choose</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
              </select>
              <label htmlFor="assessment-payment">Payment</label>
              <select
                id="assessment-payment"
                value={costPaymentType}
                onChange={(event) => setCostPaymentType(event.target.value)}
              >
                <option value="">Choose</option>
                <option value="one_time">One-time</option>
                <option value="installments">Installments</option>
              </select>
            </>
          )}
          <label htmlFor="cost-entry-state">State</label>
          <select
            id="cost-entry-state"
            value={fixedCostState ?? costState}
            disabled={fixedCostState !== null}
            onChange={(event) => setCostState(event.target.value)}
          >
            <option>Quote</option>
            <option>Doc</option>
            <option>N/A</option>
          </select>
          <label htmlFor="cost-entry-source">Source or document</label>
          <input
            id="cost-entry-source"
            value={costSource}
            onChange={(event) => setCostSource(event.target.value)}
            required
          />
          <label htmlFor="cost-entry-date">Date</label>
          <input
            id="cost-entry-date"
            type="date"
            value={costDate}
            onChange={(event) => setCostDate(event.target.value)}
            required
          />
          <button type="submit">Save cost record</button>
        </form>
      </section>
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
            <dt>FEMA flood zone</dt>
            <dd>{property.floodZone ?? 'Unknown'}</dd>
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
      <section
        aria-labelledby="insurance-heading"
        className="property-detail-section risk-detail-card"
      >
        <h3 id="insurance-heading">Insurance</h3>
        <p>
          Roof {riskDraft?.roofYear ?? 'Unknown'} · built {property.yearBuilt ?? 'Unknown'}
          {riskDraft?.roofYear != null &&
          carrierAgeLimit !== '' &&
          new Date().getFullYear() - riskDraft.roofYear > Number(carrierAgeLimit)
            ? ' · may limit carriers'
            : ''}
        </p>
        <p>Wind mitigation: {riskDraft?.windMitigation.join(', ') || 'Not recorded'}</p>
        <p>
          Source: {riskDraft?.insuranceSource ?? 'Not recorded'} ·{' '}
          {riskDraft?.insuranceDate ?? 'date not recorded'}
        </p>
        <p>
          Flood zone source: {riskDraft?.floodZoneSource ?? 'Not recorded'} ·{' '}
          {riskDraft?.floodZoneDate ?? 'date not recorded'}
        </p>
        <form className="risk-detail-form" onSubmit={(event) => void saveRiskDetails(event)}>
          <label>
            FEMA flood zone
            <input
              value={riskFloodZone}
              maxLength={12}
              onChange={(event) => setRiskFloodZone(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Flood zone source
            <input
              value={riskDraft?.floodZoneSource ?? ''}
              onChange={(event) => updateRisk('floodZoneSource', event.target.value || null)}
            />
          </label>
          <label>
            Flood zone date
            <input
              type="date"
              value={riskDraft?.floodZoneDate ?? ''}
              onChange={(event) => updateRisk('floodZoneDate', event.target.value || null)}
            />
          </label>
          <label>
            Roof year
            <input
              type="number"
              min="1800"
              max={new Date().getFullYear() + 1}
              value={riskDraft?.roofYear ?? ''}
              onChange={(event) =>
                updateRisk('roofYear', event.target.value ? Number(event.target.value) : null)
              }
            />
          </label>
          <fieldset>
            <legend>Wind mitigation</legend>
            {['impact windows', 'shutters', 'other'].map((feature) => (
              <label key={feature}>
                <input
                  type="checkbox"
                  checked={riskDraft?.windMitigation.includes(feature) ?? false}
                  onChange={(event) =>
                    updateRisk(
                      'windMitigation',
                      event.target.checked
                        ? [...(riskDraft?.windMitigation ?? []), feature]
                        : (riskDraft?.windMitigation ?? []).filter((item) => item !== feature),
                    )
                  }
                />
                {feature}
              </label>
            ))}
          </fieldset>
          <label>
            Insurance details source
            <input
              value={riskDraft?.insuranceSource ?? ''}
              onChange={(event) => updateRisk('insuranceSource', event.target.value || null)}
            />
          </label>
          <label>
            Insurance details date
            <input
              type="date"
              value={riskDraft?.insuranceDate ?? ''}
              onChange={(event) => updateRisk('insuranceDate', event.target.value || null)}
            />
          </label>
          <label>
            Carrier review age limit (years)
            <input
              type="number"
              min="0"
              max="100"
              value={carrierAgeLimit}
              onChange={(event) => {
                const value = event.target.value;
                setCarrierAgeLimit(value);
                try {
                  if (value === '')
                    window.localStorage.removeItem('ledgerline.carrier-age-limit-years');
                  else window.localStorage.setItem('ledgerline.carrier-age-limit-years', value);
                } catch {
                  /* Local preference storage can be unavailable in private browsing. */
                }
              }}
            />
          </label>
          <p className="field-help">Set a threshold to show “may limit carriers” on older roofs.</p>
          <button disabled={riskBusy || !riskDraft} type="submit">
            {riskBusy ? 'Saving…' : 'Save insurance details'}
          </button>
        </form>
      </section>
      {['condo', 'co-op', 'coop', 'townhome'].includes(
        (property.propertyType ?? '').toLowerCase().replaceAll('_', '-'),
      ) && (
        <section
          aria-labelledby="association-heading"
          className="property-detail-section risk-detail-card"
        >
          <h3 id="association-heading">Condo &amp; association</h3>
          <dl className="property-facts-grid">
            <div>
              <dt>Milestone inspection</dt>
              <dd>{riskDraft?.milestoneInspection ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>County recertification</dt>
              <dd>{riskDraft?.countyRecertification ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Reserve study</dt>
              <dd>{riskDraft?.reserveStudy ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Special assessment</dt>
              <dd>
                {riskDraft?.specialAssessment == null
                  ? 'Not recorded'
                  : /^(pending|approved)$/i.test(riskDraft.specialAssessment) &&
                      riskDraft.assessmentAmount == null
                    ? `${riskDraft.specialAssessment}, amount unknown`
                    : riskDraft.specialAssessment}
                {riskDraft?.assessmentAmount != null
                  ? ` · $${riskDraft.assessmentAmount.toLocaleString()}`
                  : ''}
                {riskDraft?.assessmentPaymentType === 'one_time'
                  ? ' · one-time'
                  : riskDraft?.assessmentPaymentType === 'installments'
                    ? ' · installments'
                    : ''}
              </dd>
            </div>
            <div>
              <dt>Rental restrictions</dt>
              <dd>{riskDraft?.rentalRestrictions ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Approval restrictions</dt>
              <dd>{riskDraft?.approvalRestrictions ?? 'Not recorded'}</dd>
            </div>
          </dl>
          <p>
            Source: {riskDraft?.associationSource ?? 'Not recorded'} ·{' '}
            {riskDraft?.associationDate ?? 'date not recorded'}
          </p>
          <form className="risk-detail-form" onSubmit={(event) => void saveRiskDetails(event)}>
            <label>
              Milestone inspection
              <input
                value={riskDraft?.milestoneInspection ?? ''}
                onChange={(event) => updateRisk('milestoneInspection', event.target.value || null)}
              />
            </label>
            <label>
              County recertification
              <input
                value={riskDraft?.countyRecertification ?? ''}
                onChange={(event) =>
                  updateRisk('countyRecertification', event.target.value || null)
                }
              />
            </label>
            <label>
              Reserve study
              <input
                value={riskDraft?.reserveStudy ?? ''}
                onChange={(event) => updateRisk('reserveStudy', event.target.value || null)}
              />
            </label>
            <label>
              Special assessment status
              <select
                value={riskDraft?.specialAssessment ?? ''}
                onChange={(event) => updateRisk('specialAssessment', event.target.value || null)}
              >
                <option value="">Not recorded</option>
                <option value="not checked">Not checked</option>
                <option value="none">None</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
              </select>
            </label>
            <label>
              Assessment amount
              <input
                aria-label="Assessment amount"
                type="number"
                min="0"
                step="0.01"
                value={riskDraft?.assessmentAmount ?? ''}
                onChange={(event) =>
                  updateRisk(
                    'assessmentAmount',
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              />
            </label>
            <label>
              Assessment payment type
              <select
                value={riskDraft?.assessmentPaymentType ?? ''}
                onChange={(event) =>
                  updateRisk('assessmentPaymentType', event.target.value || null)
                }
              >
                <option value="">Not recorded</option>
                <option value="one_time">One-time</option>
                <option value="installments">Installments</option>
              </select>
            </label>
            <label>
              Rental restrictions
              <input
                value={riskDraft?.rentalRestrictions ?? ''}
                onChange={(event) => updateRisk('rentalRestrictions', event.target.value || null)}
              />
            </label>
            <label>
              Approval restrictions
              <input
                value={riskDraft?.approvalRestrictions ?? ''}
                onChange={(event) => updateRisk('approvalRestrictions', event.target.value || null)}
              />
            </label>
            <label>
              Association details source
              <input
                value={riskDraft?.associationSource ?? ''}
                onChange={(event) => updateRisk('associationSource', event.target.value || null)}
              />
            </label>
            <label>
              Association details date
              <input
                type="date"
                value={riskDraft?.associationDate ?? ''}
                onChange={(event) => updateRisk('associationDate', event.target.value || null)}
              />
            </label>
            <button disabled={riskBusy || !riskDraft} type="submit">
              {riskBusy ? 'Saving…' : 'Save association details'}
            </button>
          </form>
        </section>
      )}
      {riskMessage && <p role="status">{riskMessage}</p>}
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
        <div className="mode-switch" aria-label="Listing mode" role="group">
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
      <div className="filter-panel" aria-label="Search filters" role="group">
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
        <div className="filter-chips" aria-label="Active filters" role="group">
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
          <div className="mobile-map-toggle" aria-label="Results view" role="group">
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
            <div className="listing-grid" aria-label="Search results" role="group">
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
        <RequestUsageHeader />
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
            <AssumptionsPanel />
            <RequestBudgetPanel />
            <ProviderCredentialsPanel />
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

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import packageJson from '../../../package.json';
import {
  defaultRankingWeights,
  rankListings,
  rankingFactorLabels,
  rankingFactors,
  type ListingRanking,
  type RankingFactor,
  type RankingMode,
  type RankingWeights,
} from './ranking';
import {
  defaultSettingsSectionIds,
  moveSettingsSection,
  readSettingsOrder,
  SETTINGS_ORDER_KEY,
  type SettingsSectionId,
} from './settingsOrder';

type RankingWeightSets = Record<RankingMode, RankingWeights>;
type ThemeChoice = 'light' | 'dark' | 'system';
const THEME_KEY = 'ledgerline.theme';

function readThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  const saved = window.localStorage.getItem(THEME_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}
type RankingWeightsResponse = {
  weights?: Record<RankingMode, { weights: Partial<RankingWeights> }>;
  error?: string;
};

const toRankingWeightSets = (
  sets: NonNullable<RankingWeightsResponse['weights']>,
): RankingWeightSets => ({
  sale: { ...defaultRankingWeights.sale, ...sets.sale.weights },
  rent: { ...defaultRankingWeights.rent, ...sets.rent.weights },
});

// Weights are personal data in the local database, so every screen ranks with the saved
// values. They are null until loaded; screens show no rank before then.
function useRankingWeights() {
  const [weights, setWeights] = useState<RankingWeightSets | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/ranking-weights')
      .then(async (response) => {
        const data = (await response.json()) as RankingWeightsResponse;
        if (!response.ok || !data.weights)
          throw new Error(data.error ?? 'Ranking weights are unavailable.');
        if (!cancelled) setWeights(toRankingWeightSets(data.weights));
      })
      .catch(() => {
        if (!cancelled)
          setError('Ranking weights are unavailable. Start the local API and try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { weights, setWeights, error };
}

function ScoreBreakdown({ mode, score }: { mode: RankingMode; score: ListingRanking }) {
  return (
    <ul aria-label="Score breakdown" className="score-factor-list">
      {rankingFactors[mode].map((factor) => {
        const result = score.factors[factor];
        return (
          <li key={factor}>
            <span>{rankingFactorLabels[factor]}</span>
            <span>
              {!result || result.unknown
                ? 'Unknown · scored 0'
                : `${result.weightedPoints} pts · ${result.score}/100`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ScoreSummary({ score, children }: { score: ListingRanking; children?: ReactNode }) {
  return (
    <p className="ranking-summary">
      <strong>
        <span className="sr-only">Rank </span>#{score.rank} ·{' '}
        <span className="sr-only">score </span>
        {score.score}
      </strong>
      {children}
      {score.provisional && (
        <span className="provisional-tag">Provisional · {score.provisionalReason}</span>
      )}
    </p>
  );
}

type Route = { title: string; eyebrow: string; path: string; icon?: string };

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
  nextReset: string;
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

export function shouldShowSampleNotice(provider: string | null | undefined) {
  return provider == null || provider === 'mock';
}

function SampleDataNotice() {
  const [provider, setProvider] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void fetchRequestUsage()
        .then((usage) => active && setProvider(usage.provider))
        .catch(() => active && setProvider(null));
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('provider-usage-updated', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('provider-usage-updated', refresh);
    };
  }, []);
  if (!shouldShowSampleNotice(provider)) return null;
  return (
    <div className="sample-notice" role="status">
      <span className="sample-notice-dot" aria-hidden="true" />
      Sample data — not real listings
    </div>
  );
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
          <h2 id="request-budget-heading">RentCast usage</h2>
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
                            <a href="/settings#saved-searches">Add Rent search</a>
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
          <h2 id="provider-credentials-heading">Keys</h2>
        </div>
        <strong role="status">
          {configured === null ? 'Checking…' : configured ? 'Key set' : 'No key set'}
        </strong>
      </div>
      <p className="panel-intro">
        The key is stored on this computer by the local API. It is never returned to the browser.
      </p>
      <h3>RentCast key</h3>
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
  pricePerSqftMin: number | null;
  pricePerSqftMax: number | null;
  source: string | null;
  setOn: string | null;
  sample: boolean;
};
type ComparableRentRules = {
  sameType: boolean;
  sameBeds: boolean;
  livingAreaTolerancePct: number;
  radiusMi: number;
  seenWithinDays: number;
  minComps: number;
};
type ComparableRent = {
  figure: {
    source: 'same_home' | 'local_comps' | 'rent_estimate' | 'unavailable';
    value: number | null;
    low: number | null;
    high: number | null;
    reason: string | null;
    compCount: number;
    maxDistanceMi: number | null;
    compIds: string[];
    estimateComps?: Array<{ address: string; rent: number; distanceMi: number | null }>;
    computedAt: string;
  };
  label: string;
  stale: boolean;
  compsMedian: number | null;
  comps: Array<{
    listingId: string;
    propertyId: string;
    address: string;
    beds: number | null;
    livingAreaSqft: number | null;
    distanceMi: number | null;
    rent: number;
    lastSeen: string;
    stale: boolean;
  }>;
  estimateComps?: Array<{ address: string; rent: number; distanceMi: number | null }>;
};

type CostEstimate = {
  lines: Array<{
    key: string;
    label: string;
    monthly: number | null;
    state: string;
    note: string | null;
  }>;
  totalStatus: 'Calculated' | 'Estimate' | 'Incomplete';
  statusLabel: string;
  totalLabel: string;
  monthlyTotal: number | null;
  knownSubtotal: number;
  upfrontCash: number;
  upfrontLabel: string;
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
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/assumptions')
      .then(async (response) => {
        if (!response.ok) throw new Error('Assumptions are unavailable.');
        return (await response.json()) as {
          searches: AssumptionSearch[];
          local: LocalAssumptions[];
        };
      })
      .then((data) => {
        if (!cancelled) {
          setSearches(data.searches);
          setLocal(data.local);
        }
      })
      .catch(() => {
        if (!cancelled)
          setErrors({ page: 'Assumptions are unavailable. Start the local API and try again.' });
      });
    return () => {
      cancelled = true;
    };
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
          onInput={(event) =>
            onChange(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))
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
                  {amountField(
                    'Price / sq ft minimum',
                    item.pricePerSqftMin,
                    (value) => updateLocal(item.county, { pricePerSqftMin: value }),
                    '$',
                  )}
                  {amountField(
                    'Price / sq ft maximum',
                    item.pricePerSqftMax,
                    (value) => updateLocal(item.county, { pricePerSqftMax: value }),
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
                      onInput={(event) =>
                        updateLocal(item.county, { source: event.currentTarget.value })
                      }
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

function ComparableRentRulesPanel() {
  const [rules, setRules] = useState<ComparableRentRules | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/comparable-rent-rules')
      .then(async (response) => {
        const data = (await response.json()) as { rules?: ComparableRentRules; error?: string };
        if (!response.ok || !data.rules) throw new Error(data.error ?? 'Rules are unavailable.');
        if (!cancelled) setRules(data.rules);
      })
      .catch(() => {
        if (!cancelled)
          setError('Comparable-rent rules are unavailable. Start the local API and try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const update = (patch: Partial<ComparableRentRules>) => {
    setRules((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rules) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/comparable-rent-rules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rules),
      });
      const data = (await response.json()) as { rules?: ComparableRentRules; error?: string };
      if (!response.ok || !data.rules) throw new Error(data.error ?? 'Could not save rules.');
      setRules(data.rules);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save rules.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="comparable-rent-rules-heading" className="assumptions-panel">
      <div className="panel-heading">
        <div>
          <p className="screen-eyebrow">Rent comparison</p>
          <h2 id="comparable-rent-rules-heading">Comparable-rent rules</h2>
        </div>
      </div>
      <p className="panel-intro">
        Local comps come from active Rent-mode listings already stored on this computer. Dense Miami
        areas may need a smaller radius.
      </p>
      <form className="assumption-card" onSubmit={(event) => void save(event)}>
        {rules && (
          <>
            <div className="assumption-fields">
              <label className="assumption-field assumption-checkbox-field">
                <input
                  checked={rules.sameType}
                  onChange={(event) => update({ sameType: event.target.checked })}
                  type="checkbox"
                />{' '}
                <span>Same property type</span>
              </label>
              <label className="assumption-field assumption-checkbox-field">
                <input
                  checked={rules.sameBeds}
                  onChange={(event) => update({ sameBeds: event.target.checked })}
                  type="checkbox"
                />{' '}
                <span>Same bedrooms</span>
              </label>
              {(
                [
                  ['Living area tolerance (%)', 'livingAreaTolerancePct', 0, 100, 1],
                  ['Radius (mi)', 'radiusMi', 0.1, 100, 0.1],
                  ['Seen within (days)', 'seenWithinDays', 1, 365, 1],
                  ['Minimum comps', 'minComps', 1, 50, 1],
                ] as const
              ).map(([label, key, min, max, step]) => (
                <label className="assumption-field" key={key}>
                  {label}
                  <input
                    aria-label={label}
                    max={max}
                    min={min}
                    onChange={(event) => update({ [key]: Number(event.target.value) })}
                    step={step}
                    type="number"
                    value={rules[key]}
                  />
                </label>
              ))}
            </div>
            {error && (
              <p className="search-error" role="alert">
                {error}
              </p>
            )}
            <div className="assumption-actions">
              <button disabled={busy} type="submit">
                {busy ? 'Saving…' : 'Save comparable-rent rules'}
              </button>
              {saved && <span role="status">Saved</span>}
            </div>
          </>
        )}
      </form>
    </section>
  );
}

const routes: Route[] = [
  { title: 'Search', eyebrow: 'Find your next place', path: '/', icon: '⌂' },
  { title: 'Compare', eyebrow: 'Side by side', path: '/compare', icon: '⇄' },
  { title: 'Settings', eyebrow: 'Make it yours', path: '/settings', icon: '⚙' },
];

const appVersion = packageJson.version;

function currentPage(pathname: string) {
  if (pathname === '/compare') return routes[1];
  if (pathname === '/settings') return routes[2];
  if (pathname.startsWith('/property/')) {
    return { title: 'Property detail', eyebrow: 'Home details', path: pathname };
  }
  return routes[0];
}

function RankingPanel() {
  const [mode, setMode] = useState<RankingMode>('sale');
  const { weights, setWeights, error: loadError } = useRankingWeights();
  const [items, setItems] = useState<SearchListing[]>([]);
  const [listError, setListError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savedMode, setSavedMode] = useState<RankingMode | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/listings?mode=${mode}`)
      .then(async (response) => {
        const data = (await response.json()) as { items?: SearchListing[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Rankings are unavailable.');
        if (!cancelled) {
          setItems(data.items ?? []);
          setListError('');
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setListError(reason instanceof Error ? reason.message : 'Rankings are unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);
  const factors = rankingFactors[mode];
  const rankings = weights ? rankListings(items, mode, weights[mode]) : null;
  const ordered = rankings
    ? [...items].sort(
        (left, right) => rankings.get(left.listing.id)!.rank - rankings.get(right.listing.id)!.rank,
      )
    : [];
  const total = weights ? factors.reduce((sum, factor) => sum + weights[mode][factor], 0) : 0;
  const changeWeight = (factor: RankingFactor, value: string) => {
    const number = value === '' ? 0 : Math.max(0, Math.min(100, Math.round(Number(value))));
    setWeights((current) =>
      current ? { ...current, [mode]: { ...current[mode], [factor]: number } } : current,
    );
    setSavedMode(null);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!weights) return;
    setBusy(true);
    setSaveError('');
    try {
      const response = await fetch('/api/ranking-weights', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          weights: Object.fromEntries(factors.map((factor) => [factor, weights[mode][factor]])),
        }),
      });
      const data = (await response.json()) as RankingWeightsResponse;
      if (!response.ok || !data.weights)
        throw new Error(data.error ?? 'Could not save ranking weights.');
      const saved = toRankingWeightSets(data.weights);
      setWeights((current) => (current ? { ...current, [mode]: saved[mode] } : saved));
      setSavedMode(mode);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Could not save ranking weights.');
    } finally {
      setBusy(false);
    }
  };
  const modeName = mode === 'sale' ? 'Buy' : 'Rent';
  return (
    <section aria-labelledby="ranking-heading" className="assumptions-panel">
      <div className="panel-heading">
        <div>
          <p className="screen-eyebrow">Personal ranking</p>
          <h2 id="ranking-heading">Ranking weights</h2>
        </div>
        <div className="mode-switch" aria-label="Ranking mode" role="group">
          <button aria-pressed={mode === 'sale'} onClick={() => setMode('sale')} type="button">
            Buy
          </button>
          <button aria-pressed={mode === 'rent'} onClick={() => setMode('rent')} type="button">
            Rent
          </button>
        </div>
      </div>
      <p className="panel-intro">
        Each factor counts in proportion to its weight; the defaults add up to 100. Unknown factors
        score 0. Rank numbers follow score order on Search, whatever its sort.
      </p>
      {loadError && (
        <p className="search-error" role="alert">
          {loadError}
        </p>
      )}
      {weights && (
        <form className="assumption-card" onSubmit={(event) => void save(event)}>
          <div className="ranking-weight-grid">
            {factors.map((factor) => (
              <label className="assumption-field" key={factor}>
                {rankingFactorLabels[factor]} weight
                <span className="assumption-input-wrap">
                  <input
                    aria-label={`${rankingFactorLabels[factor]} weight`}
                    min="0"
                    max="100"
                    step="1"
                    type="number"
                    value={weights[mode][factor]}
                    onChange={(event) => changeWeight(factor, event.target.value)}
                  />
                  <span>%</span>
                </span>
              </label>
            ))}
          </div>
          <p>Total {total}</p>
          {saveError && (
            <p className="search-error" role="alert">
              {saveError}
            </p>
          )}
          <div className="assumption-actions">
            <button disabled={busy} type="submit">
              {busy ? 'Saving…' : `Save ${modeName} weights`}
            </button>
            {savedMode === mode && <span role="status">Saved</span>}
          </div>
        </form>
      )}
      <h3>Live ranking · active {modeName} listings on this computer</h3>
      {listError ? (
        <p role="alert" className="search-error">
          {listError}
        </p>
      ) : (
        <ol className="ranking-live-list">
          {ordered.map((item) => (
            <li key={item.listing.id}>
              <ScoreSummary score={rankings!.get(item.listing.id)!}>
                <span>
                  {item.property.street}
                  {item.property.unit ? `, Unit ${item.property.unit}` : ''} · {item.property.city}
                </span>
              </ScoreSummary>
            </li>
          ))}
          {weights && !ordered.length && <li>No {modeName} listings to rank yet.</li>}
        </ol>
      )}
    </section>
  );
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
    <nav aria-label="Main navigation" className="sidebar-nav">
      {routes.map((route) => (
        <a
          aria-current={page.path === route.path ? 'page' : undefined}
          aria-label={route.path === '/settings' ? 'Settings' : route.title}
          className="sidebar-nav-link"
          href={route.path}
          key={route.path}
          title={route.path === '/settings' ? 'Settings' : route.title}
        >
          <span aria-hidden="true" className="sidebar-nav-icon">
            {route.icon}
          </span>
          <span className="sidebar-nav-label">
            {route.path === '/settings' ? 'Settings' : route.title}
          </span>
        </a>
      ))}
    </nav>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('ledgerline.sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('ledgerline.sidebar-collapsed', String(collapsed));
    } catch {
      // The sidebar remains usable if browser storage is unavailable.
    }
  }, [collapsed]);

  return (
    <aside className={`desktop-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar-brand-row">
        <a aria-label="Ledgerline home" className="brand" href="/">
          <BrandMark />
          <span className="brand-name">Ledgerline</span>
        </a>
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="sidebar-toggle"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          type="button"
        >
          <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        </button>
      </div>
      <Navigation pathname={pathname} />
      <p className="sidebar-version">v{appVersion}</p>
    </aside>
  );
}

function AboutPanel() {
  return (
    <section aria-labelledby="about-heading" className="about-panel">
      <h2 id="about-heading">About</h2>
      <p>Ledgerline version</p>
      <strong>v{appVersion}</strong>
    </section>
  );
}

function AppearanceSettings({
  theme,
  onThemeChange,
}: {
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
}) {
  return (
    <section aria-labelledby="appearance-heading" className="appearance-panel">
      <h2 id="appearance-heading">Appearance</h2>
      <p>Choose how Ledgerline looks on this computer.</p>
      <label className="appearance-choice">
        Color theme
        <select
          aria-label="Color theme"
          onChange={(event) => onThemeChange(event.target.value as ThemeChoice)}
          value={theme}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </section>
  );
}

function PersonalTagsPlaceholder() {
  return (
    <section aria-labelledby="personal-tags-heading" className="settings-placeholder">
      <h2 id="personal-tags-heading">Personal tags</h2>
      <p>Personal tags will be available here.</p>
    </section>
  );
}

function AssumptionsSettingsSection() {
  return (
    <div className="settings-section-panels">
      <AssumptionsPanel />
      <ComparableRentRulesPanel />
    </div>
  );
}

const settingsSections = [
  { id: 'appearance', title: 'Appearance' },
  { id: 'ranking-weights', title: 'Ranking weights', component: RankingPanel },
  { id: 'assumptions', title: 'Assumptions', component: AssumptionsSettingsSection },
  { id: 'saved-searches', title: 'Saved searches', component: SavedSearchPanel },
  { id: 'personal-tags', title: 'Personal tags', component: PersonalTagsPlaceholder },
  { id: 'rentcast-usage', title: 'RentCast usage', component: RequestBudgetPanel },
  { id: 'keys', title: 'Keys', component: ProviderCredentialsPanel },
  { id: 'property-match-review', title: 'Property match review', component: MatchReviewPanel },
  { id: 'backup-restore', title: 'Backup and restore', component: BackupPanel },
  { id: 'about', title: 'About', component: AboutPanel },
] as const satisfies readonly {
  id: SettingsSectionId;
  title: string;
  component?: () => ReactNode;
}[];

function SettingsPage({
  theme,
  onThemeChange,
}: {
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
}) {
  const [order, setOrder] = useState<SettingsSectionId[]>(readSettingsOrder);
  const [announcement, setAnnouncement] = useState('');
  const keyboardDrag = useRef<{ id: SettingsSectionId; original: SettingsSectionId[] } | null>(
    null,
  );
  const pointerDrag = useRef<{ id: SettingsSectionId; original: SettingsSectionId[] } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_ORDER_KEY, JSON.stringify(order));
  }, [order]);

  const announcePosition = (id: SettingsSectionId, current: SettingsSectionId[]) => {
    const section = settingsSections.find((item) => item.id === id)!;
    setAnnouncement(`${section.title}, position ${current.indexOf(id) + 1} of ${current.length}`);
  };

  const move = (id: SettingsSectionId, to: number) => {
    setOrder((current) => {
      const next = moveSettingsSection(current, current.indexOf(id), to);
      if (next.some((value, index) => value !== current[index])) announcePosition(id, next);
      return next;
    });
  };

  const moveBy = (id: SettingsSectionId, amount: number) => {
    const index = order.indexOf(id);
    move(id, Math.max(0, Math.min(order.length - 1, index + amount)));
  };

  const finishKeyboardDrag = (id: SettingsSectionId) => {
    if (!keyboardDrag.current || keyboardDrag.current.id !== id) {
      keyboardDrag.current = { id, original: [...order] };
      setAnnouncement(
        `${settingsSections.find((item) => item.id === id)!.title} picked up. Use arrow keys to move, Enter or Space to drop, Escape to cancel.`,
      );
    } else {
      keyboardDrag.current = null;
      announcePosition(id, order);
    }
  };

  const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: SettingsSectionId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      finishKeyboardDrag(id);
    } else if (event.key === 'Escape' && keyboardDrag.current?.id === id) {
      event.preventDefault();
      setOrder(keyboardDrag.current.original);
      keyboardDrag.current = null;
      setAnnouncement('Move cancelled. Original section order restored.');
    } else if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      keyboardDrag.current?.id === id
    ) {
      event.preventDefault();
      moveBy(id, event.key === 'ArrowUp' ? -1 : 1);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, id: SettingsSectionId) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    pointerDrag.current = { id, original: [...order] };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const active = pointerDrag.current;
    if (!active || (event.buttons === 0 && event.pointerType === 'mouse')) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-settings-section]');
    const id = target?.dataset.settingsSection as SettingsSectionId | undefined;
    if (id && id !== active.id) move(active.id, order.indexOf(id));
  };

  const onPointerUp = (id: SettingsSectionId) => {
    if (!pointerDrag.current) return;
    pointerDrag.current = null;
    announcePosition(id, order);
  };

  const resetOrder = () => {
    const defaults = [...defaultSettingsSectionIds];
    setOrder(defaults);
    window.localStorage.removeItem(SETTINGS_ORDER_KEY);
    keyboardDrag.current = null;
    pointerDrag.current = null;
    setAnnouncement('Settings section order reset to default.');
  };

  useEffect(() => {
    const focusHashTarget = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    focusHashTarget();
    window.addEventListener('hashchange', focusHashTarget);
    return () => window.removeEventListener('hashchange', focusHashTarget);
  }, []);

  return (
    <>
      <nav aria-label="Settings sections" className="settings-section-nav">
        <div className="settings-section-order-list">
          {order.map((id) => {
            const section = settingsSections.find((item) => item.id === id)!;
            const index = order.indexOf(id);
            const grabbed = keyboardDrag.current?.id === id;
            return (
              <div className="settings-section-order-item" data-settings-section={id} key={id}>
                <a href={`/settings#${id}`}>{section.title}</a>
                <button
                  aria-label={`Reorder ${section.title}`}
                  aria-pressed={grabbed}
                  className="settings-drag-handle"
                  onKeyDown={(event) => onHandleKeyDown(event, id)}
                  onPointerDown={(event) => onPointerDown(event, id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={() => onPointerUp(id)}
                  onPointerCancel={() => {
                    pointerDrag.current = null;
                  }}
                  type="button"
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <div className="settings-mobile-move">
                  <button
                    aria-label={`Move ${section.title} up`}
                    disabled={index === 0}
                    onClick={() => moveBy(id, -1)}
                    type="button"
                  >
                    Move up
                  </button>
                  <button
                    aria-label={`Move ${section.title} down`}
                    disabled={index === order.length - 1}
                    onClick={() => moveBy(id, 1)}
                    type="button"
                  >
                    Move down
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button className="settings-reset-order" onClick={resetOrder} type="button">
          Reset order
        </button>
        <span aria-live="polite" className="sr-only" role="status">
          {announcement}
        </span>
      </nav>
      <div className="settings-panels">
        {order.map((id) => {
          const section = settingsSections.find((item) => item.id === id)!;
          const SectionComponent = 'component' in section ? section.component : undefined;
          return (
            <section className="settings-section" id={id} key={id} tabIndex={-1}>
              {id === 'appearance' ? (
                <AppearanceSettings onThemeChange={onThemeChange} theme={theme} />
              ) : SectionComponent ? (
                <SectionComponent />
              ) : null}
            </section>
          );
        })}
      </div>
    </>
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
  rankingWeights: number;
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
  ['rankingWeights', 'ranking weight set', 'ranking weight sets'],
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
        Export your notes, saved and dismissed homes, saved searches, ranking weights, personal and
        local assumptions, and property match decisions to one JSON file. Importing merges a file
        into this database by address and unit and never creates duplicates. Listings, prices, and
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
    floodZone?: string | null;
    riskDetails?: { roofYear: number | null; specialAssessment: string | null };
  };
  listing: {
    id: string;
    mode: 'sale' | 'rent';
    price: number | null;
    pricePeriod: string;
    hoaFee?: number | null;
    status: string;
    provider: string;
    providerLastSeenDate: string | null;
    implausibleFlags?: Array<{
      field: string;
      value: number | string | null;
      reason: string;
      resolved?: boolean;
    }>;
  };
  saved?: boolean;
  dismissed?: boolean;
  comparableRent?: ComparableRent | null;
  costEstimate?: CostEstimate | null;
};

function isSampleListing(provider: string) {
  return provider === 'mock';
}

function PropertyRankingBreakdowns({ data }: { data: PropertyDetailData }) {
  const modes = [...new Set(data.listings.map((listing) => listing.mode))];
  const [itemsByMode, setItemsByMode] = useState<Partial<Record<RankingMode, SearchListing[]>>>({});
  const { weights, error } = useRankingWeights();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all(
      modes.map(async (mode) => {
        // Dismissed homes still get a score here, so every active listing has one.
        const response = await fetch(`/api/listings?mode=${mode}&showDismissed=true`);
        const result = (await response.json()) as { items?: SearchListing[] };
        if (!response.ok) throw new Error('Rankings are unavailable.');
        return [mode, result.items ?? []] as const;
      }),
    )
      .then((results) => {
        if (!cancelled) setItemsByMode(Object.fromEntries(results));
      })
      .catch(() => {
        if (!cancelled) setItemsByMode({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.property.id, modes.join(',')]);

  return (
    <section aria-labelledby="property-ranking-heading" className="property-detail-section">
      <h3 id="property-ranking-heading">Personal ranking</h3>
      {error ? (
        <p className="search-error" role="alert">
          {error}
        </p>
      ) : loading || !weights ? (
        <p>Calculating score from local results…</p>
      ) : (
        data.listings.map((listing) => {
          const mode = listing.mode;
          const modeName = mode === 'sale' ? 'Buy' : 'Rent';
          const items = itemsByMode[mode] ?? [];
          const result = items.some((entry) => entry.listing.id === listing.id)
            ? rankListings(items, mode, weights[mode]).get(listing.id)
            : undefined;
          return (
            <div className="property-ranking-breakdown" key={listing.id}>
              <h4>{modeName} listing</h4>
              {result ? (
                <>
                  <ScoreSummary score={result} />
                  <p>
                    Ranked among all {items.length} active {modeName} listings on this computer;
                    Search ranks within its current results.
                  </p>
                  <ScoreBreakdown mode={mode} score={result} />
                </>
              ) : (
                <p>
                  Only active listings are ranked; this one is {listing.status.replaceAll('_', ' ')}
                  .
                </p>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

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
  sort: 'score' | 'newest' | 'price';
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
  sort:
    search.filters.sort === 'price' || search.filters.sort === 'score'
      ? search.filters.sort
      : 'newest',
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
    sort:
      params.get('sort') === 'price' || params.get('sort') === 'score'
        ? (params.get('sort') as SearchFilters['sort'])
        : 'newest',
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
export type PropertyDetailData = {
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
    valueOverrides: Record<
      string,
      { value: number | string | null; source: string; updatedAt: string }
    >;
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
      implausibleFlags: Array<{
        field: string;
        value: number | string | null;
        reason: string;
        resolved?: boolean;
      }>;
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
  comparableRent?: ComparableRent | null;
  costEstimate?: CostEstimate | null;
  costEstimates?: Array<CostEstimate & { listingId: string; price: number | null }>;
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

export function lowestCompleteCostPropertyId(items: PropertyDetailData[]) {
  return items
    .map((item) => ({
      id: item.property.id,
      estimate:
        item.costEstimates?.find((estimate) =>
          item.listings.some(
            (listing) => listing.id === estimate.listingId && listing.mode === 'sale',
          ),
        ) ?? item.costEstimate,
    }))
    .filter(
      (item): item is { id: string; estimate: CostEstimate } =>
        item.estimate != null &&
        item.estimate.totalStatus !== 'Incomplete' &&
        item.estimate.monthlyTotal != null,
    )
    .reduce<{ id: string; amount: number } | null>(
      (lowest, item) =>
        lowest == null || item.estimate.monthlyTotal! < lowest.amount
          ? { id: item.id, amount: item.estimate.monthlyTotal! }
          : lowest,
      null,
    )?.id;
}

export function abbreviatedCostState(state: string) {
  return (
    (
      {
        Calculated: 'Calc',
        'Not applicable': 'N/A',
        'Not Applicable': 'N/A',
        Estimate: 'Est.',
        Document: 'Doc',
      } as Record<string, string>
    )[state] ?? state
  );
}

function money(value: number | null | undefined) {
  return value == null ? '—' : `$${Math.round(value).toLocaleString()}`;
}

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
  const [floodLookupBusy, setFloodLookupBusy] = useState(false);
  const [riskMessage, setRiskMessage] = useState('');
  const [requestUsage, setRequestUsage] = useState<RequestUsage | null>(null);
  const [rentEstimateAvailable, setRentEstimateAvailable] = useState(false);
  const [rentEstimateBusy, setRentEstimateBusy] = useState(false);
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

  // Only the newest request may update the page. An older response that lands late would
  // otherwise reset the details form over what was typed after the newer one arrived.
  const latestRefresh = useRef(0);
  const refresh = async () => {
    const request = ++latestRefresh.current;
    try {
      const response = await fetch(`/api/properties/${propertyId}`);
      const result = (await response.json()) as PropertyDetailData & { error?: string };
      if (request !== latestRefresh.current) return;
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
      if (request !== latestRefresh.current) return;
      setError(reason instanceof Error ? reason.message : 'Property details are unavailable.');
    }
  };
  useEffect(() => {
    void refresh();
  }, [propertyId]);
  useEffect(() => {
    void fetchRequestUsage()
      .then(setRequestUsage)
      .catch(() => setRequestUsage(null));
    void fetch('/api/listings/capabilities')
      .then((response) => response.json() as Promise<Record<string, boolean>>)
      .then((capabilities) => setRentEstimateAvailable(capabilities.rentEstimates === true))
      .catch(() => setRentEstimateAvailable(false));
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

  const requestRentEstimate = async () => {
    if (!data) return;
    setRentEstimateBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/properties/${propertyId}/rent-estimate`, {
        method: 'POST',
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Rent estimate failed.');
      window.dispatchEvent(new Event('provider-usage-updated'));
      await Promise.all([
        refresh(),
        fetchRequestUsage()
          .then(setRequestUsage)
          .catch(() => setRequestUsage(null)),
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rent estimate failed.');
      fetchRequestUsage()
        .then(setRequestUsage)
        .catch(() => setRequestUsage(null));
    } finally {
      setRentEstimateBusy(false);
    }
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

  const resolveImplausible = async (event: FormEvent<HTMLFormElement>, listingId: string) => {
    event.preventDefault();
    const form = new FormData(
      event.currentTarget,
      (event.nativeEvent as SubmitEvent).submitter as HTMLElement,
    );
    const action = String(form.get('action'));
    const payload: Record<string, unknown> = { field: form.get('field'), action };
    if (action === 'correct') {
      payload.value = Number(form.get('value'));
      payload.source = String(form.get('source') ?? '');
    }
    const response = await fetch(`/api/listings/${listingId}/implausible`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? 'Could not update the flagged value.');
      return;
    }
    setError('Flag cleared.');
    await refresh();
  };

  const lookupFloodZone = async () => {
    setFloodLookupBusy(true);
    setRiskMessage('');
    try {
      const response = await fetch(`/api/properties/${propertyId}/flood-zone-lookup`, {
        method: 'POST',
      });
      const result = (await response.json()) as {
        property?: PropertyDetailData['property'];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? 'FEMA flood-zone lookup failed.');
      if (!result.property) throw new Error('FEMA flood-zone lookup returned no property.');
      setRiskFloodZone(result.property.floodZone ?? '');
      setRiskDraft(result.property.riskDetails);
      setData((current) => (current ? { ...current, property: result.property! } : current));
      setRiskMessage(`FEMA NFHL zone ${result.property.floodZone} saved.`);
    } catch (reason) {
      setRiskMessage(reason instanceof Error ? reason.message : 'FEMA flood-zone lookup failed.');
    } finally {
      setFloodLookupBusy(false);
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
  const saleListing = listings.find((listing) => listing.mode === 'sale');
  const costEstimate =
    data.costEstimates?.find((estimate) => estimate.listingId === saleListing?.id) ??
    data.costEstimate ??
    null;
  const rentValue = data.comparableRent?.figure.value;
  const gap =
    costEstimate?.monthlyTotal != null && rentValue != null
      ? costEstimate.monthlyTotal - rentValue
      : null;
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
        {costEstimate ? (
          <>
            <h4>Monthly cost to own</h4>
            <ul className="cost-breakdown" aria-label="Monthly cost breakdown">
              {costEstimate.lines.map((line) => (
                <li key={line.key}>
                  <span>{line.label}</span>
                  <span>
                    {line.monthly == null
                      ? 'Unknown'
                      : `$${Math.round(line.monthly).toLocaleString()}/mo`}{' '}
                    <span className="line-state-tag">{line.state}</span>
                    {line.note ? ` · ${line.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="cost-total">
              <strong>{costEstimate.totalLabel}</strong>{' '}
              <span className="total-status-tag">{costEstimate.statusLabel}</span>
            </p>
            {gap == null ? (
              <p className="cost-gap-muted">
                No own-vs-rent gap ·{' '}
                {costEstimate.totalStatus === 'Incomplete'
                  ? 'total incomplete'
                  : data.comparableRent?.figure.value == null
                    ? 'rent unavailable'
                    : 'rent unavailable'}
              </p>
            ) : (
              <p className="cost-gap">
                {costEstimate.totalStatus === 'Estimate' ? '≈ ' : ''}
                {gap >= 0 ? '+' : '−'}${Math.abs(Math.round(gap)).toLocaleString()}/mo vs.
                comparable rent
              </p>
            )}
            <p>Upfront cash: {costEstimate.upfrontLabel}</p>
            {costEstimate.lines.some(
              (line) => line.state === 'Unknown' && line.note === 'Local rates not set',
            ) && (
              <p className="local-rates-prompt">
                <a href="/settings#assumptions">Set local rates for {property.county} County</a>
              </p>
            )}
          </>
        ) : (
          <p>No purchase listing is available for a cost estimate.</p>
        )}
        <h4>Verification checklist</h4>
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
              {isSampleListing(listing.provider) && (
                <span className="sample-listing-tag">Sample data</span>
              )}
              <span>Last seen {listing.providerLastSeenDate ?? 'unknown'}</span>
            </li>
          ))}
        </ul>
      </section>
      <PropertyRankingBreakdowns data={data} />
      <section aria-labelledby="property-facts-heading" className="property-detail-section">
        <h3 id="property-facts-heading">Property facts</h3>
        <dl className="property-facts-grid">
          <div>
            <dt>Type</dt>
            <dd>{property.propertyType?.replaceAll('_', ' ') ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>FEMA flood zone</dt>
            <dd>
              {property.floodZone ?? 'Unknown'}
              {property.floodZone?.toUpperCase() === 'X' && (
                <p>Zone X doesn&apos;t mean no flood risk.</p>
              )}
            </dd>
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
            <dd>
              {property.livingAreaSqft?.toLocaleString() ?? 'Unknown'} sq ft
              {property.valueOverrides?.livingAreaSqft && (
                <small> · corrected from {property.valueOverrides.livingAreaSqft.source}</small>
              )}
            </dd>
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
          <div className="risk-detail-action">
            <button
              disabled={floodLookupBusy || property.latitude == null || property.longitude == null}
              onClick={() => void lookupFloodZone()}
              type="button"
            >
              {floodLookupBusy ? 'Looking up…' : 'Look up FEMA zone'}
            </button>
            {(property.latitude == null || property.longitude == null) && (
              <small>Add property coordinates to use the FEMA lookup.</small>
            )}
          </div>
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
      <section aria-labelledby="comparable-rent-heading" className="property-detail-section">
        <h3 id="comparable-rent-heading">Comparable rent</h3>
        {data.comparableRent ? (
          <>
            <p className="comparable-rent-value">
              {data.comparableRent.figure.value == null
                ? data.comparableRent.label
                : `$${data.comparableRent.figure.value.toLocaleString()}/mo · ${data.comparableRent.label}`}
              {data.comparableRent.stale ? ' · Stale' : ''}
            </p>
            {data.comparableRent.comps.length > 0 && (
              <details className="comparable-rent-comps" open>
                <summary>Local comps ({data.comparableRent.comps.length})</summary>
                <div className="table-scroll">
                  <table>
                    <caption>Stored rental listings used for the local median</caption>
                    <thead>
                      <tr>
                        <th scope="col">Address</th>
                        <th scope="col">Beds</th>
                        <th scope="col">Sq ft</th>
                        <th scope="col">Distance</th>
                        <th scope="col">Rent</th>
                        <th scope="col">Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.comparableRent.comps.map((comp) => (
                        <tr key={comp.listingId}>
                          <td>{comp.address}</td>
                          <td>{comp.beds ?? '—'}</td>
                          <td>{comp.livingAreaSqft?.toLocaleString() ?? '—'}</td>
                          <td>{comp.distanceMi?.toFixed(1) ?? '—'} mi</td>
                          <td>${comp.rent.toLocaleString()}/mo</td>
                          <td>
                            {comp.lastSeen.slice(0, 10)}
                            {comp.stale ? ' · Stale' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Median: ${data.comparableRent.compsMedian?.toLocaleString() ?? 'Unavailable'}/mo ·{' '}
                  {data.comparableRent.comps.length} comps
                </p>
              </details>
            )}
            {(data.comparableRent.estimateComps ?? []).length > 0 && (
              <details className="comparable-rent-comps">
                <summary>
                  RentCast estimate comps ({data.comparableRent.estimateComps!.length})
                </summary>
                <ul>
                  {data.comparableRent.estimateComps!.map((comp, index) => (
                    <li key={`${comp.address}-${index}`}>
                      {comp.address} · ${comp.rent.toLocaleString()}/mo
                      {comp.distanceMi == null ? '' : ` · ${comp.distanceMi.toFixed(1)} mi`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p>Unavailable · no rent data.</p>
        )}
        <p>
          {data.comparableRent?.figure.source === 'rent_estimate'
            ? `Requested from RentCast on ${new Date(data.comparableRent.figure.computedAt).toLocaleString()} · 1 provider request.`
            : `Computed ${data.comparableRent?.figure.computedAt ? new Date(data.comparableRent.figure.computedAt).toLocaleString() : '—'} from local listings · browsing uses no provider requests.`}
        </p>
        {data.saved &&
          rentEstimateAvailable &&
          (!data.comparableRent ||
            data.comparableRent.figure.source === 'unavailable' ||
            (data.comparableRent.figure.source === 'rent_estimate' &&
              data.comparableRent.stale)) && (
            <div className="rent-estimate-action">
              <button
                disabled={rentEstimateBusy || (requestUsage != null && requestUsage.remaining < 1)}
                onClick={() => void requestRentEstimate()}
                type="button"
              >
                {rentEstimateBusy
                  ? 'Requesting RentCast estimate…'
                  : `${data.comparableRent?.figure.source === 'rent_estimate' ? 'Refresh' : 'Get'} RentCast rent estimate · 1 request · ${requestUsage?.remaining ?? '…'} left this month`}
              </button>
              {requestUsage && requestUsage.remaining < 1 && (
                <p role="status">
                  Request ceiling reached. Resets{' '}
                  {new Date(requestUsage.nextReset).toLocaleDateString()}.
                </p>
              )}
            </div>
          )}
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
          const implausible = (listing.implausibleFlags ?? []).filter((flag) => !flag.resolved);
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
              {(flagged.length > 0 || implausible.length > 0) && (
                <div className="implausible-flags">
                  {implausible.map((flag) => (
                    <form
                      key={flag.field}
                      onSubmit={(event) => void resolveImplausible(event, listing.id)}
                    >
                      <strong>Check {flag.field}</strong>
                      <span>{flag.reason}</span>
                      <input type="hidden" name="field" value={flag.field} />
                      <label>
                        Correct value
                        <input
                          aria-label={`Correct ${flag.field}`}
                          name="value"
                          type="number"
                          min="0.01"
                          step="any"
                          defaultValue={typeof flag.value === 'number' ? flag.value : ''}
                        />
                      </label>
                      <label>
                        Source
                        <input
                          aria-label={`Source for ${flag.field}`}
                          name="source"
                          placeholder="e.g. listing disclosure"
                        />
                      </label>
                      <button name="action" value="confirm" type="submit">
                        Confirm listed value
                      </button>
                      <button name="action" value="correct" type="submit">
                        Correct value
                      </button>
                    </form>
                  ))}
                </div>
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
  const [assumptionSummary, setAssumptionSummary] = useState<{
    searches: AssumptionSearch[];
    local: LocalAssumptions[];
  } | null>(null);
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
    void fetch('/api/assumptions')
      .then(async (response) => {
        if (!response.ok) throw new Error('Assumptions unavailable');
        return (await response.json()) as {
          searches: AssumptionSearch[];
          local: LocalAssumptions[];
        };
      })
      .then((value) => !cancelled && setAssumptionSummary(value))
      .catch(() => !cancelled && setAssumptionSummary(null));
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
  const costFor = (item: PropertyDetailData) =>
    item.costEstimates?.find((estimate) =>
      item.listings.some((listing) => listing.id === estimate.listingId && listing.mode === 'sale'),
    ) ?? item.costEstimate;
  const lowestId = lowestCompleteCostPropertyId(properties);
  const selectedPersonal = assumptionSummary?.searches[0]?.personal;
  const personalLabel = selectedPersonal
    ? `${selectedPersonal.downPaymentPct}% down · ${selectedPersonal.mortgageRatePct.toFixed(2)}% ${selectedPersonal.termYears}-yr · maintenance ${selectedPersonal.maintenancePctPerYear}%/yr`
    : 'Assumptions not set';
  const counties = [...new Set(properties.map((item) => item.property.county).filter(Boolean))];
  const localLabel = counties.length
    ? counties
        .map((county) => {
          const local = assumptionSummary?.local.find(
            (item) => item.county.toLocaleLowerCase() === county?.toLocaleLowerCase(),
          );
          return `${county}${local?.sample ? ' (sample)' : local?.set ? '' : ' (not set)'}`;
        })
        .join(' · ')
    : 'Local rates not set';
  const costLines = [
    ['P&I', 'principalInterest'],
    ['Property tax', 'propertyTax'],
    ['Homeowners / HO-6', 'homeowners'],
    ['Flood', 'flood'],
    ['HOA', 'hoa'],
    ['Non-ad valorem / CDD', 'nonAdValorem'],
    ['Special assessment', 'specialAssessment'],
    ['Maintenance', 'maintenance'],
  ] as const;
  const costLineCell = (item: PropertyDetailData, key: string): ReactNode => {
    const line = costFor(item)?.lines.find((candidate) =>
      key === 'homeowners'
        ? candidate.key === 'homeowners' || candidate.key === 'ho6'
        : candidate.key === key,
    );
    if (!line) return 'No purchase estimate';
    return (
      <span className="compare-cost-cell">
        <strong>{money(line.monthly)}</strong>
        <span className="cost-state-tag">{abbreviatedCostState(line.state)}</span>
        {line.note && <small>{line.note}</small>}
      </span>
    );
  };
  const totalCell = (item: PropertyDetailData) => {
    const estimate = costFor(item);
    if (!estimate) return 'No purchase estimate';
    return (
      <span className="compare-cost-cell">
        <strong>
          {estimate.totalStatus === 'Incomplete'
            ? `at least ${money(estimate.knownSubtotal)}`
            : money(estimate.monthlyTotal)}
        </strong>
        <span className="total-status-tag">{estimate.statusLabel}</span>
        {lowestId === item.property.id && (
          <strong className="lowest-complete-tag">Lowest complete total</strong>
        )}
      </span>
    );
  };
  const comparableRentCell = (item: PropertyDetailData) => {
    const rent = item.comparableRent;
    if (!rent) return 'Unavailable · no comparable rent';
    return (
      <span className="compare-cost-cell">
        <strong>
          {rent.figure.value == null ? 'Unavailable' : `${money(rent.figure.value)}/mo`}
        </strong>
        <span>
          {rent.label}
          {rent.stale ? ' · Stale' : ''}
        </span>
      </span>
    );
  };
  const gapCell = (item: PropertyDetailData) => {
    const estimate = costFor(item);
    const rent = item.comparableRent;
    if (!estimate) return 'No purchase estimate';
    if (estimate.totalStatus === 'Incomplete') return `Hidden · ${estimate.statusLabel}`;
    if (rent?.figure.value == null || estimate.monthlyTotal == null)
      return `Hidden · ${rent?.label ?? 'Comparable rent unavailable'}`;
    const difference = estimate.monthlyTotal - rent.figure.value;
    return `${estimate.totalStatus === 'Estimate' ? '≈ ' : ''}${difference >= 0 ? '+' : '−'}${money(Math.abs(difference))}/mo`;
  };
  const riskDetails = (item: PropertyDetailData) =>
    item.property.riskDetails ?? {
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
    };
  const rows: Array<[string, (item: PropertyDetailData) => ReactNode]> = [
    [
      'Provider',
      (item) => (
        <span className="compare-provider-list">
          {item.listings.map((listing) => (
            <span key={listing.id}>
              {listing.mode === 'sale' ? 'Buy' : 'Rent'} · {listing.provider}
              {isSampleListing(listing.provider) && (
                <span className="sample-listing-tag">Sample data</span>
              )}
            </span>
          ))}
        </span>
      ),
    ],
    ['Price', listingPrice],
    ['Status', listingStatus],
    ['Type', (item) => item.property.propertyType?.replaceAll('_', ' ') ?? 'Unknown'],
    [
      'Beds / baths / area',
      (item) =>
        `${item.property.beds ?? '—'} bd · ${item.property.bathsTotal ?? '—'} ba · ${item.property.livingAreaSqft?.toLocaleString() ?? '—'} sq ft`,
    ],
    ['Year built', (item) => item.property.yearBuilt ?? 'Unknown'],
    ...costLines.map(
      ([label, key]) =>
        [label, (item: PropertyDetailData) => costLineCell(item, key)] as [
          string,
          (item: PropertyDetailData) => ReactNode,
        ],
    ),
    ['Total', totalCell],
    ['Comparable rent', comparableRentCell],
    ['Own vs. rent', gapCell],
    ['Upfront cash', (item) => costFor(item)?.upfrontLabel ?? 'No purchase estimate'],
    [
      'Flood zone',
      (item) => {
        const details = riskDetails(item);
        const zone = item.property.floodZone ?? 'Unknown';
        return `${zone} · ${details.floodZoneSource ?? 'source not recorded'} · ${details.floodZoneDate ?? 'date not recorded'}${zone.toUpperCase() === 'X' ? " · Zone X doesn't mean no flood risk." : ''}`;
      },
    ],
    [
      'Insurance & wind mitigation',
      (item) => {
        const details = riskDetails(item);
        return `Roof ${details.roofYear ?? 'unknown'} · built ${item.property.yearBuilt ?? 'unknown'} · ${details.windMitigation.length ? details.windMitigation.join(', ') : 'wind mitigation not recorded'} · ${details.insuranceSource ?? 'source not recorded'} · ${details.insuranceDate ?? 'date not recorded'}`;
      },
    ],
    [
      'Condo & association',
      (item) => {
        const type = item.property.propertyType?.toLocaleLowerCase() ?? '';
        if (!/(condo|co_op|townhome)/.test(type)) return 'Not a condo, co-op, or townhome';
        const details = riskDetails(item);
        return `Milestone ${details.milestoneInspection ?? 'not recorded'} · recertification ${details.countyRecertification ?? 'not recorded'} · reserves ${details.reserveStudy ?? 'not recorded'} · assessment ${details.specialAssessment ?? 'not recorded'}`;
      },
    ],
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
      <div className="compare-assumptions" aria-label="Cost assumptions">
        <p>
          <strong>Personal:</strong> {personalLabel}{' '}
          <a href="/settings#assumptions">Edit personal assumptions</a>
        </p>
        <p>
          <strong>Local:</strong> {localLabel} <a href="/settings#assumptions">Edit local rates</a>
        </p>
      </div>
      <p className="compare-cost-legend" aria-label="Cost line tag legend">
        Cost line tags: Listing · Calc · Quote · Doc · N/A · Est. · Unknown
      </p>
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
  const { weights: rankingWeights, error: rankingError } = useRankingWeights();

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

  // Ranks always come from score order within the current results. Newest and Price keep the
  // API's order; only "Your score" reorders the cards.
  const ranking = rankingWeights
    ? rankListings(items, filters.mode, rankingWeights[filters.mode])
    : null;
  const visibleItems =
    filters.sort === 'score' && ranking
      ? [...items].sort(
          (left, right) => ranking.get(left.listing.id)!.rank - ranking.get(right.listing.id)!.rank,
        )
      : items;
  const firstVisibleId = visibleItems[0]?.listing.id ?? null;
  const rankingSettled = rankingWeights !== null || rankingError !== '';

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    // Under "Your score", wait for the weights so the first card selected is the top-ranked one.
    if (filters.sort === 'score' && !rankingSettled) return;
    if (!selectedId || !items.some((item) => item.listing.id === selectedId)) {
      setSelectedId(firstVisibleId);
    }
  }, [items, selectedId, firstVisibleId, filters.sort, rankingSettled]);

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
                    <a href="/settings#saved-searches">Add Rent search</a>
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
            onChange={(event) => update('sort', event.target.value as SearchFilters['sort'])}
          >
            <option value="score">Your score</option>
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
              {visibleItems.map(
                (
                  {
                    property,
                    listing,
                    saved = false,
                    dismissed = false,
                    comparableRent,
                    costEstimate,
                  },
                  index,
                ) => {
                  const score = ranking?.get(listing.id);
                  return (
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
                      {score && <ScoreSummary score={score} />}
                      {score && selectedId === listing.id && (
                        <ScoreBreakdown mode={listing.mode} score={score} />
                      )}
                      {listing.mode === 'sale' && comparableRent && (
                        <p className="listing-comparable-rent">
                          <strong>Comparable rent</strong>{' '}
                          {comparableRent.figure.value == null
                            ? comparableRent.label
                            : `$${comparableRent.figure.value.toLocaleString()}/mo · ${comparableRent.label}`}
                          {comparableRent.stale ? ' · Stale' : ''}
                        </p>
                      )}
                      {listing.mode === 'sale' && costEstimate && (
                        <div className="listing-cost-summary" aria-label="Monthly cost to own">
                          <p>
                            <strong>Est. monthly to own</strong> {costEstimate.totalLabel}{' '}
                            <span className="total-status-tag">{costEstimate.statusLabel}</span>
                          </p>
                          {costEstimate.monthlyTotal != null &&
                          comparableRent?.figure.value != null ? (
                            <p className="cost-gap">
                              {costEstimate.totalStatus === 'Estimate' ? '≈ ' : ''}
                              {costEstimate.monthlyTotal >= comparableRent.figure.value ? '+' : '−'}
                              $
                              {Math.abs(
                                Math.round(costEstimate.monthlyTotal - comparableRent.figure.value),
                              ).toLocaleString()}
                              /mo
                            </p>
                          ) : (
                            <p className="cost-gap-muted">
                              No own-vs-rent gap ·{' '}
                              {costEstimate.totalStatus === 'Incomplete'
                                ? 'total incomplete'
                                : 'rent unavailable'}
                            </p>
                          )}
                          {costEstimate.lines.some(
                            (line) =>
                              line.state === 'Unknown' && line.note === 'Local rates not set',
                          ) && (
                            <a className="local-rates-prompt" href="/settings#assumptions">
                              Set local rates for {property.county} County
                            </a>
                          )}
                        </div>
                      )}
                      <div className="property-risk-chips" aria-label="Property risks" role="group">
                        {property.floodZone && (
                          <span>
                            Flood zone {property.floodZone}
                            {property.floodZone.toUpperCase() === 'X' &&
                              " · Zone X doesn't mean no flood risk."}
                          </span>
                        )}
                        {property.riskDetails?.roofYear && (
                          <span>Roof {property.riskDetails.roofYear}</span>
                        )}
                        {property.riskDetails?.specialAssessment && (
                          <span>Special assessment · {property.riskDetails.specialAssessment}</span>
                        )}
                      </div>
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
                        {isSampleListing(listing.provider) && (
                          <span className="sample-listing-tag">Sample data</span>
                        )}
                        {stale(listing.providerLastSeenDate) && (
                          <span className="stale-tag">Stale</span>
                        )}
                      </div>
                    </article>
                  );
                },
              )}
            </div>
            <div className="results-map-column">
              {boundaries ? (
                <CountyMap
                  boundaries={boundaries}
                  items={visibleItems}
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
      <p className="cost-assumptions-footer">
        Monthly costs use your personal assumptions (20% down, 6.50% 30-yr fixed, maintenance 1%/yr)
        and each county&apos;s local rates. Local rates shown are sample placeholders. Photos are
        ones you upload; the listing provider supplies none.
      </p>
    </section>
  );
}

export function App({ initialPath }: { initialPath?: string } = {}) {
  const [pathname, setPathname] = useState(
    () => initialPath ?? (typeof window === 'undefined' ? '/' : window.location.pathname),
  );
  const page = currentPage(pathname);
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    applyTheme();
    if (theme === 'system') media.addEventListener('change', applyTheme);
    return () => {
      media.removeEventListener('change', applyTheme);
    };
  }, [theme]);

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
      <Sidebar pathname={pathname} />
      <div className="app-content">
        <header className="site-header">
          <a aria-label="Ledgerline home" className="brand mobile-brand" href="/">
            <BrandMark />
            <span className="brand-name">Ledgerline</span>
          </a>
          <RequestUsageHeader />
        </header>

        <SampleDataNotice />

        <main className="screen-content" id="main-content" tabIndex={-1}>
          <div className="screen-heading">
            <p className="screen-eyebrow">{page.eyebrow}</p>
            <h1>{page.title}</h1>
          </div>
          {page.path === '/settings' ? (
            <SettingsPage onThemeChange={setTheme} theme={theme} />
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
      </div>

      <nav aria-label="Mobile navigation" className="mobile-nav">
        {routes.map((route) => (
          <a
            aria-current={page.path === route.path ? 'page' : undefined}
            className="mobile-nav-link"
            href={route.path}
            key={route.path}
            title={route.path === '/settings' ? 'Settings' : route.title}
          >
            {route.path === '/settings' ? 'Settings' : route.title}
          </a>
        ))}
      </nav>
    </div>
  );
}

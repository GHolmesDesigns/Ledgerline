import type { Database } from 'sql.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createStore,
  type ListingSearchCriteria,
  type SavedSearchInput,
  type LocalAssumptions,
  type PersonalAssumptions,
  type ReviewListingInput,
  type Store,
  type PropertyRiskDetails,
} from './store.js';
import { MockListingProvider } from './providers/mock-provider.js';
import { BackupError, exportBackup, importBackup } from './backup.js';
import { RefreshJob } from './providers/refresh-job.js';
import { RequestCeilingError } from './providers/request-budget.js';
import { RentEstimateUnavailableError, requestRentEstimate } from './providers/rent-estimate.js';
import { ProviderCredentials } from './provider-credentials.js';
import { defaultPersonalAssumptions, seedAssumptions } from './assumptions.js';
import { computeCostEstimate } from './cost-estimate.js';
import { normalizeAddress } from './providers/normalize-address.js';
import { defaultComparableRentRules } from './store.js';
import { findComparableRent } from './comparable-rent.js';
import { createFemaNfhlLookup, type FloodZoneLookup } from './fema-nfhl.js';
import { findImplausibleFlags } from './implausible.js';
import { readRankingWeights } from './ranking-weights.js';

function costEstimateFor(
  store: Store,
  property: ReturnType<Store['getProperty']>,
  saleListing: ReturnType<Store['listListings']>[number],
  personalAssumptions: PersonalAssumptions,
) {
  if (!property || saleListing.mode !== 'sale') return null;
  const localAssumption =
    store
      .listLocalAssumptions()
      .find(
        (item) =>
          item.county.toLocaleLowerCase('en-US') ===
          (property.county ?? '').toLocaleLowerCase('en-US'),
      ) ?? null;
  let sameBuildingHoaMonthly: number | null = null;
  if (
    ['condo', 'co-op', 'coop', 'townhome', 'townhouse'].includes(
      (property.propertyType ?? '').toLowerCase(),
    )
  ) {
    const address = normalizeAddress(property);
    const fees = store
      .listProperties()
      .flatMap((other) => {
        if (other.id === property.id) return [];
        const otherAddress = normalizeAddress(other);
        if (
          otherAddress.street !== address.street ||
          otherAddress.city !== address.city ||
          otherAddress.zip !== address.zip
        )
          return [];
        const recent = store
          .listListings(other.id)
          .filter(
            (listing) =>
              listing.mode === 'sale' &&
              listing.hoaFee != null &&
              Date.parse(listing.lastFetchedAt) >= Date.now() - 365 * 24 * 60 * 60 * 1000,
          )
          .sort((left, right) => right.lastFetchedAt.localeCompare(left.lastFetchedAt));
        return recent[0] ? [recent[0].hoaFee!] : [];
      })
      .sort((left, right) => left - right);
    if (fees.length >= 2) {
      const middle = Math.floor(fees.length / 2);
      sameBuildingHoaMonthly =
        fees.length % 2 ? fees[middle] : (fees[middle - 1] + fees[middle]) / 2;
    }
  }
  return computeCostEstimate({
    property,
    saleListing,
    entries: store.listCostEntries(property.id),
    localAssumption,
    personalAssumptions,
    sameBuildingHoaMonthly,
  });
}

// The listing's implausible values against its county's range. A flag the user already
// confirmed or corrected stays resolved.
function currentImplausibleFlags(
  store: Store,
  property: NonNullable<ReturnType<Store['getProperty']>>,
  listing: ReturnType<Store['listListings']>[number],
  localAssumptions = store.listLocalAssumptions(),
) {
  const assumptions = localAssumptions.find(
    (item) =>
      item.county?.toLocaleLowerCase('en-US') === property.county?.toLocaleLowerCase('en-US'),
  );
  const detected = findImplausibleFlags(
    property,
    listing,
    assumptions
      ? {
          min: assumptions.pricePerSqftMin ?? null,
          max: assumptions.pricePerSqftMax ?? null,
          sample: assumptions.sample,
        }
      : undefined,
  );
  const resolved = new Set(
    listing.implausibleFlags.filter((flag) => flag.resolved).map((flag) => flag.field),
  );
  return detected.map((flag) => ({ ...flag, resolved: resolved.has(flag.field) }));
}

const defaultCredentialPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');

export function createApp(
  database: Database,
  store: Store = createStore(database),
  refreshJob: RefreshJob = new RefreshJob(store, new MockListingProvider()),
  credentials: ProviderCredentials = new ProviderCredentials(defaultCredentialPath),
  floodZoneLookup: FloodZoneLookup = createFemaNfhlLookup(),
) {
  seedAssumptions(store);
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    const readBody = async (): Promise<Record<string, unknown>> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Request body must be a JSON object.');
      }
      return value as Record<string, unknown>;
    };
    if (request.method === 'GET' && request.url === '/api/health') {
      let databaseReady = true;
      try {
        database.exec('SELECT 1');
      } catch {
        databaseReady = false;
      }
      json(databaseReady ? 200 : 503, { status: databaseReady ? 'ok' : 'unavailable' });
      return;
    }

    const floodZoneAction = request.url?.match(
      /^\/api\/properties\/(prop_[A-Za-z0-9_-]+)\/flood-zone-lookup$/,
    );
    if (floodZoneAction && request.method === 'POST') {
      const property = store.getProperty(floodZoneAction[1]);
      if (!property) {
        json(404, { error: 'Property not found.' });
        return;
      }
      if (property.latitude == null || property.longitude == null) {
        json(400, { error: 'Add property coordinates before looking up its FEMA flood zone.' });
        return;
      }
      try {
        const floodZone = await floodZoneLookup(property.latitude, property.longitude);
        const riskDetails = {
          ...property.riskDetails,
          floodZoneSource: 'FEMA NFHL',
          floodZoneDate: new Date().toISOString().slice(0, 10),
        };
        const updated = store.updateRiskDetails(property.id, floodZone, riskDetails);
        json(200, { property: updated });
      } catch (error) {
        json(502, {
          error: error instanceof Error ? error.message : 'FEMA flood-zone lookup failed.',
        });
      }
      return;
    }

    if (request.method === 'GET' && request.url === '/api/assumptions') {
      seedAssumptions(store);
      json(200, {
        searches: store.listSavedSearches().map((search) => ({
          id: search.id,
          name: search.name,
          mode: search.mode,
          location: search.location,
          personal: store.getPersonalAssumptions(search.id) ?? defaultPersonalAssumptions,
        })),
        local: store.listLocalAssumptions(),
      });
      return;
    }
    if (request.url === '/api/ranking-weights' && request.method === 'GET') {
      json(200, {
        weights: { sale: store.getRankingWeights('sale'), rent: store.getRankingWeights('rent') },
      });
      return;
    }
    if (request.url === '/api/ranking-weights' && request.method === 'PUT') {
      try {
        const body = await readBody();
        if (body.mode !== 'sale' && body.mode !== 'rent')
          throw new Error('Mode must be sale or rent.');
        const weights = readRankingWeights(body.mode, body.weights);
        if (!weights) throw new Error('Each weight must be a whole number from 0 to 100.');
        store.setRankingWeights(body.mode, weights);
        json(200, {
          weights: { sale: store.getRankingWeights('sale'), rent: store.getRankingWeights('rent') },
        });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to save ranking weights.',
        });
      }
      return;
    }
    if (request.url === '/api/comparable-rent-rules' && request.method === 'GET') {
      json(200, { rules: store.getComparableRentRules() });
      return;
    }
    if (request.url === '/api/comparable-rent-rules' && request.method === 'PUT') {
      try {
        const body = await readBody();
        const rules = {
          sameType: body.sameType,
          sameBeds: body.sameBeds,
          livingAreaTolerancePct: body.livingAreaTolerancePct,
          radiusMi: body.radiusMi,
          seenWithinDays: body.seenWithinDays,
          minComps: body.minComps,
        };
        if (typeof rules.sameType !== 'boolean' || typeof rules.sameBeds !== 'boolean')
          throw new Error('Property type and bedroom matching must be on or off.');
        if (
          typeof rules.livingAreaTolerancePct !== 'number' ||
          !Number.isFinite(rules.livingAreaTolerancePct) ||
          rules.livingAreaTolerancePct < 0 ||
          rules.livingAreaTolerancePct > 100
        )
          throw new Error('Living area tolerance must be from 0 to 100 percent.');
        if (
          typeof rules.radiusMi !== 'number' ||
          !Number.isFinite(rules.radiusMi) ||
          rules.radiusMi <= 0 ||
          rules.radiusMi > 100
        )
          throw new Error('Radius must be greater than 0 and no more than 100 miles.');
        if (
          typeof rules.seenWithinDays !== 'number' ||
          !Number.isInteger(rules.seenWithinDays) ||
          rules.seenWithinDays < 1 ||
          rules.seenWithinDays > 365
        )
          throw new Error('Listing age must be 1 to 365 days.');
        if (
          typeof rules.minComps !== 'number' ||
          !Number.isInteger(rules.minComps) ||
          rules.minComps < 1 ||
          rules.minComps > 50
        )
          throw new Error('Minimum comps must be a whole number from 1 to 50.');
        json(200, {
          rules: store.setComparableRentRules(rules as typeof defaultComparableRentRules),
        });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to save comparable-rent rules.',
        });
      }
      return;
    }
    if (
      request.url?.match(/^\/api\/properties\/(prop_[A-Za-z0-9_-]+)\/comparable-rent$/) &&
      request.method === 'GET'
    ) {
      const propertyId = request.url.match(
        /^\/api\/properties\/(prop_[A-Za-z0-9_-]+)\/comparable-rent$/,
      )![1]!;
      const result = findComparableRent(store, propertyId, store.getComparableRentRules());
      if (!result) json(404, { error: 'Property not found.' });
      else json(200, result);
      return;
    }
    const personalAssumptionsAction = request.url?.match(
      /^\/api\/saved-searches\/(\d+)\/assumptions$/,
    );
    if (personalAssumptionsAction && request.method === 'PUT') {
      try {
        const body = await readBody();
        const value = body as unknown as PersonalAssumptions;
        if (
          [value.downPaymentPct, value.mortgageRatePct, value.maintenancePctPerYear].some(
            (number) =>
              typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 100,
          ) ||
          typeof value.termYears !== 'number' ||
          !Number.isInteger(value.termYears) ||
          value.termYears < 1 ||
          value.termYears > 100
        ) {
          throw new Error(
            'Enter percentages from 0 to 100 and a whole mortgage term from 1 to 100 years.',
          );
        }
        json(200, {
          personal: store.setPersonalAssumptions(Number(personalAssumptionsAction[1]), value),
        });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to save personal assumptions.',
        });
      }
      return;
    }
    const localAssumptionsAction = request.url?.match(/^\/api\/local-assumptions\/([^/]+)$/);
    if (localAssumptionsAction && request.method === 'PUT') {
      try {
        const body = await readBody();
        const county = decodeURIComponent(localAssumptionsAction[1]).trim();
        const nonNegative = (key: string) => {
          const value = body[key];
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
            throw new Error(`${key} must be a non-negative number.`);
          return value;
        };
        const flood = body.floodDefaultMonthly;
        if (
          !flood ||
          typeof flood !== 'object' ||
          Array.isArray(flood) ||
          Object.values(flood).some(
            (value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0,
          )
        ) {
          throw new Error('Flood defaults must be non-negative monthly amounts by zone.');
        }
        if (!county || typeof body.source !== 'string' || !body.source.trim())
          throw new Error('County and source are required.');
        if (
          typeof body.setOn !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.setOn) ||
          Number.isNaN(Date.parse(`${body.setOn}T00:00:00Z`))
        )
          throw new Error('Enter the date the local rates were set.');
        const input: LocalAssumptions = {
          county,
          set: true,
          millage: nonNegative('millage'),
          typicalNonAdValoremPerYear: nonNegative('typicalNonAdValoremPerYear'),
          homeownersDefaultMonthly: nonNegative('homeownersDefaultMonthly'),
          ho6DefaultMonthly: nonNegative('ho6DefaultMonthly'),
          floodDefaultMonthly: flood as Record<string, number>,
          source: body.source.trim(),
          setOn: body.setOn,
          sample: false,
          pricePerSqftMin: body.pricePerSqftMin == null ? null : nonNegative('pricePerSqftMin'),
          pricePerSqftMax: body.pricePerSqftMax == null ? null : nonNegative('pricePerSqftMax'),
        };
        if (
          (input.pricePerSqftMin == null) !== (input.pricePerSqftMax == null) ||
          (input.pricePerSqftMin != null && input.pricePerSqftMin >= input.pricePerSqftMax!)
        )
          throw new Error('Enter both price-per-square-foot bounds, with minimum below maximum.');
        json(200, { local: store.setLocalAssumption(input) });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to save local assumptions.',
        });
      }
      return;
    }

    if (request.method === 'GET' && request.url === '/api/backup/export') {
      const backup = exportBackup(store);
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="ledgerline-backup-${backup.exportedAt.slice(0, 10)}.json"`,
      });
      response.end(JSON.stringify(backup, null, 2));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/backup/import') {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        let backup: unknown;
        try {
          backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new BackupError('This file is not valid JSON. Nothing was changed.');
        }
        json(200, { report: importBackup(store, backup) });
      } catch (error) {
        if (error instanceof BackupError) json(400, { error: error.message });
        else json(500, { error: 'The import failed and nothing was changed.' });
      }
      return;
    }

    const savedSearchInput = (body: Record<string, unknown>, partial = false) => {
      const result: Partial<SavedSearchInput> = {};
      const has = (key: string) => Object.hasOwn(body, key);
      if (!partial || has('name')) {
        if (typeof body.name !== 'string' || body.name.trim().length === 0) {
          throw new Error('Name is required.');
        }
        result.name = body.name.trim();
      }
      if (!partial || has('mode')) {
        if (body.mode !== 'sale' && body.mode !== 'rent')
          throw new Error('Mode must be sale or rent.');
        result.mode = body.mode;
      }
      if (!partial || has('location')) {
        if (typeof body.location !== 'string' || body.location.trim().length === 0) {
          throw new Error('Location is required.');
        }
        result.location = body.location.trim();
      }
      if (!partial || has('filters')) {
        if (
          body.filters !== undefined &&
          (body.filters === null || typeof body.filters !== 'object' || Array.isArray(body.filters))
        ) {
          throw new Error('Filters must be a JSON object.');
        }
        result.filters = (body.filters ?? {}) as Record<string, unknown>;
      }
      for (const key of ['priceMin', 'priceMax'] as const) {
        if (!partial || has(key)) {
          const value = body[key];
          if (
            value !== undefined &&
            value !== null &&
            (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
          ) {
            throw new Error(`${key} must be a non-negative number or null.`);
          }
          result[key] = value as number | null | undefined;
        }
      }
      if (!partial || has('refreshIntervalDays')) {
        const value = body.refreshIntervalDays;
        if (
          value !== undefined &&
          value !== null &&
          (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
        ) {
          throw new Error('Refresh interval must be a positive whole number of days or null.');
        }
        result.refreshIntervalDays = value as number | null | undefined;
      }
      return result;
    };

    if (request.url === '/api/provider-credentials' && request.method === 'GET') {
      json(200, {
        configured: credentials.isRentCastConfigured(),
        googleMapsConfigured: credentials.isGoogleMapsConfigured(),
      });
      return;
    }
    if (request.url === '/api/google-maps-key' && request.method === 'GET') {
      // This is the sole runtime exception: Maps JavaScript runs in the browser.
      // Never include the value in general settings/status responses.
      response.setHeader('Cache-Control', 'no-store');
      json(200, { key: credentials.getGoogleMapsKey() });
      return;
    }
    if (request.url === '/api/google-maps-key' && request.method === 'PUT') {
      try {
        const body = await readBody();
        credentials.setGoogleMapsKey(body.googleMapsApiKey);
        json(200, { configured: true });
      } catch {
        json(400, { error: 'Unable to save the Google Maps key.' });
      }
      return;
    }
    if (request.url === '/api/provider-credentials' && request.method === 'PUT') {
      try {
        const body = await readBody();
        credentials.setRentCastKey(body.rentCastApiKey);
        json(200, { configured: true });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to save the RentCast key.',
        });
      }
      return;
    }

    if (request.url === '/api/request-budget' && request.method === 'GET') {
      const budget = refreshJob.budget.status();
      const searches = store.listSavedSearches();
      const measuredSearches = searches.map((search) => ({
        id: search.id,
        name: search.name,
        mode: search.mode,
        location: search.location,
        pairedSearchId: search.pairedSearchId,
        requestsPerRefresh: store.lastRefreshRequestCount(search.id) ?? 1,
        measured: store.lastRefreshRequestCount(search.id) !== null,
      }));
      const requestsPerRefreshAll = measuredSearches.reduce(
        (total, search) => total + search.requestsPerRefresh,
        0,
      );
      const requestLogs = store.listProviderRequestLogs();
      const rentEstimatesUsed = requestLogs.filter(
        (log) => log.purpose === 'rent-estimate' && log.requestedAt >= budget.periodStart,
      ).length;
      const latestRefresh = searches
        .map((search) => search.lastSuccessfulRefreshAt)
        .filter((at): at is string => at !== null)
        .sort()
        .at(-1);
      const daysRemaining = refreshJob.budget.daysUntilReset();
      const projections = Object.fromEntries(
        (
          [
            ['weekly', Math.floor(daysRemaining / 7)],
            ['daily', daysRemaining],
          ] as const
        ).map(([period, remainingRuns]) => {
          const projected = budget.used + remainingRuns * requestsPerRefreshAll + 1;
          return [period, { remainingRuns, projected, overCeiling: projected > budget.ceiling }];
        }),
      );
      json(200, {
        ...budget,
        outsideRequests: store.listOutsideProviderRequests(),
        provider: refreshJob.provider.name,
        tier: refreshJob.provider.name === 'mock' ? 'Local mock' : 'Developer',
        lastSuccessfulRefreshAt: latestRefresh ?? null,
        requestsPerRefreshAll,
        rentEstimatesUsed,
        searches: measuredSearches,
        projections,
        recommendedTier: refreshJob.provider.name === 'mock' ? null : 'Foundation · $74/mo',
      });
      return;
    }
    if (request.url === '/api/request-budget' && request.method === 'PUT') {
      try {
        const body = await readBody();
        json(
          200,
          refreshJob.budget.configure({
            ceiling: body.ceiling,
            billingDay: body.billingDay,
            includedRequests: body.includedRequests,
            dashboardUsed: body.dashboardUsed,
            dashboardReadDate: body.dashboardReadDate,
          }),
        );
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to save the request budget.',
        });
      }
      return;
    }
    if (request.url === '/api/outside-requests' && request.method === 'POST') {
      try {
        const body = await readBody();
        const id = refreshJob.budget.addOutsideRequest({
          requestDate: body.requestDate,
          count: body.count,
          note: body.note,
        });
        json(201, { id });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to add outside requests.',
        });
      }
      return;
    }
    const outsideRequestAction = request.url?.match(/^\/api\/outside-requests\/(\d+)$/);
    if (outsideRequestAction && request.method === 'DELETE') {
      json(store.deleteOutsideProviderRequest(Number(outsideRequestAction[1])) ? 200 : 404, {});
      return;
    }
    const rentEstimateAction = request.url?.match(
      /^\/api\/properties\/(prop_[A-Za-z0-9_-]+)\/rent-estimate$/,
    );
    if (rentEstimateAction && request.method === 'POST') {
      try {
        const propertyId = rentEstimateAction[1];
        if (!store.getProperty(propertyId)) throw new Error('Property not found.');
        if (!store.isFavorite(propertyId))
          throw new Error('Save this property before requesting a rent estimate.');
        const currentRent = findComparableRent(store, propertyId, store.getComparableRentRules());
        if (
          currentRent?.figure.source === 'same_home' ||
          currentRent?.figure.source === 'local_comps'
        ) {
          json(409, {
            error: 'A same-home listing or qualifying local comps already provide comparable rent.',
          });
          return;
        }
        const estimate = await requestRentEstimate(
          store,
          refreshJob.provider,
          refreshJob.budget,
          propertyId,
        );
        json(200, { estimate });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Rent estimate failed.';
        if (error instanceof RequestCeilingError)
          json(429, { error: message, blocked: error.decision });
        else if (error instanceof RentEstimateUnavailableError) json(501, { error: message });
        else if (message === 'Property not found.') json(404, { error: message });
        else if (message.startsWith('Save this property')) json(403, { error: message });
        else json(502, { error: message });
      }
      return;
    }

    const propertyAction = request.url?.match(
      /^\/api\/properties\/(prop_[A-Za-z0-9_-]+)(?:\/(notes|favorite|dismissal|risk-details))?(?:\?.*)?$/,
    );
    const implausibleAction = request.url?.match(
      /^\/api\/listings\/(lst_[A-Za-z0-9_-]+)\/implausible$/,
    );
    if (implausibleAction && request.method === 'POST') {
      try {
        const body = await readBody();
        if (typeof body.field !== 'string' || !body.field)
          throw new Error('Choose a flagged field.');
        if (body.action !== 'confirm' && body.action !== 'correct')
          throw new Error('Choose Confirm or Correct.');
        const correct = body.action === 'correct' ? body.value : undefined;
        if (
          correct !== undefined &&
          (typeof correct !== 'number' || !Number.isFinite(correct) || correct <= 0)
        )
          throw new Error('Enter a positive corrected value.');
        const listing = store.resolveImplausibleFlag(implausibleAction[1], body.field, {
          ...(correct === undefined ? {} : { correct }),
          ...(typeof body.source === 'string' ? { source: body.source } : {}),
        });
        json(200, { listing });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Unable to resolve flag.' });
      }
      return;
    }
    const costEntriesAction = request.url?.match(
      /^\/api\/properties\/(prop_[A-Za-z0-9_-]+)\/cost-entries$/,
    );
    if (costEntriesAction && request.method === 'POST') {
      try {
        const body = await readBody();
        const property = store.getProperty(costEntriesAction[1]);
        if (!property) throw new Error('Property not found.');
        const kinds = [
          'homeowners_quote',
          'ho6_quote',
          'flood_quote',
          'tax_bill',
          'tax_bill_cdd',
          'association_fee',
          'special_assessment',
          'assessments_none',
          'hoa_none',
          'flood_not_carried',
        ];
        if (!kinds.includes(String(body.kind)))
          throw new Error('Choose a supported cost record type.');
        if (!['Quote', 'Doc', 'N/A'].includes(String(body.state)))
          throw new Error('State must be Quote, Doc, or N/A.');
        if (typeof body.source !== 'string' || !body.source.trim())
          throw new Error('Source is required.');
        if (
          typeof body.date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
          Number.isNaN(Date.parse(`${body.date}T00:00:00Z`))
        )
          throw new Error('Enter a valid date.');
        const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
        if (amount !== null && (!Number.isFinite(amount) || amount < 0))
          throw new Error('Amount must be zero or greater.');
        const kind = String(body.kind);
        if (
          (kind === 'hoa_none' || kind === 'flood_not_carried') &&
          (body.state !== 'N/A' || amount !== null)
        )
          throw new Error('Confirmed absence records must use N/A and have no amount.');
        if (
          ['homeowners_quote', 'ho6_quote', 'flood_quote'].includes(kind) &&
          (body.state !== 'Quote' || amount === null)
        )
          throw new Error('Insurance quotes need an amount and Quote state.');
        if (
          ['tax_bill', 'association_fee'].includes(kind) &&
          (body.state !== 'Doc' || amount === null)
        )
          throw new Error('Tax bills and association fee records need an amount and Doc state.');
        if (
          kind === 'tax_bill_cdd' &&
          (body.state !== 'Doc' || (body.amountUnknown ? amount !== null : amount === null))
        )
          throw new Error(
            'CDD records need Doc state and either an annual amount or “amount unknown”.',
          );
        if (kind === 'assessments_none' && (body.state !== 'Doc' || amount !== 0))
          throw new Error('Confirmed no assessments needs a documented $0 amount.');
        if (
          kind === 'special_assessment' &&
          (body.state !== 'Doc' ||
            !['pending', 'approved'].includes(String(body.assessmentStatus)) ||
            !['one_time', 'installments'].includes(String(body.paymentType)) ||
            (body.amountUnknown ? amount !== null : amount === null))
        )
          throw new Error(
            'Association letters need a pending or approved assessment, payment type, and either an amount or “amount unknown”.',
          );
        if (body.kind === 'flood_not_carried' && /^[av]/i.test(property.floodZone?.trim() ?? ''))
          throw new Error(
            `Flood insurance cannot be marked not carried in FEMA zone ${property.floodZone}.`,
          );
        if (
          body.kind === 'flood_not_carried' &&
          (!property.floodZone || /^[av]/i.test(property.floodZone))
        )
          throw new Error(
            'Confirm the property is outside FEMA A and V zones before marking flood insurance not carried.',
          );
        const entry = store.addCostEntry(costEntriesAction[1], {
          kind: body.kind as import('./store.js').CostEntryKind,
          amount,
          state: body.state as import('./store.js').CostEntryState,
          source: body.source.trim(),
          date: body.date,
          assessmentStatus:
            body.assessmentStatus === 'pending' || body.assessmentStatus === 'approved'
              ? body.assessmentStatus
              : null,
          paymentType:
            body.paymentType === 'one_time' || body.paymentType === 'installments'
              ? body.paymentType
              : null,
          amountUnknown: body.amountUnknown === true,
          sample: false,
        });
        json(201, { entry });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to save cost record.',
        });
      }
      return;
    }
    if (propertyAction && request.method === 'GET' && !propertyAction[2]) {
      const propertyId = propertyAction[1];
      const property = store.getProperty(propertyId);
      if (!property) {
        json(404, { error: 'Property not found.' });
        return;
      }
      const listings = store
        .listListings(propertyId)
        .map((listing) =>
          store.setImplausibleFlags(listing.id, currentImplausibleFlags(store, property, listing)),
        );
      const comparableRent = findComparableRent(store, propertyId, store.getComparableRentRules());
      const saleListings = listings
        .filter((listing) => listing.mode === 'sale')
        .sort((left, right) => left.providerId.localeCompare(right.providerId));
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      const rawSearchId = requestUrl.searchParams.get('searchId');
      let personalAssumptions = defaultPersonalAssumptions;
      if (rawSearchId !== null) {
        const searchId = Number(rawSearchId);
        const search = Number.isInteger(searchId) ? store.getSavedSearch(searchId) : null;
        if (!search || search.mode !== 'sale') {
          json(400, { error: 'Choose an existing Buy saved search for its personal assumptions.' });
          return;
        }
        personalAssumptions = store.getPersonalAssumptions(searchId) ?? defaultPersonalAssumptions;
      }
      const costEstimates = saleListings.flatMap((saleListing) => {
        const estimate = costEstimateFor(store, property, saleListing, personalAssumptions);
        return estimate
          ? [
              {
                listingId: saleListing.id,
                provider: saleListing.provider,
                price: saleListing.price,
                ...estimate,
              },
            ]
          : [];
      });
      json(200, {
        property,
        listings: listings.map((listing) => ({
          ...listing,
          localSnapshots: store.listSnapshots(listing.id),
        })),
        notes: store.listNotes(propertyId),
        costEntries: store.listCostEntries(propertyId),
        costEstimates,
        costEstimate: costEstimates[0] ?? null,
        comparableRent,
        saved: store.isFavorite(propertyId),
        dismissed: store.isDismissed(propertyId),
      });
      return;
    }
    if (propertyAction && propertyAction[2] === 'risk-details' && request.method === 'PUT') {
      try {
        const body = await readBody();
        const raw = body.riskDetails;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error('Risk details must be an object.');
        }
        const values = raw as Record<string, unknown>;
        const textValue = (key: string) => {
          const value = values[key];
          if (value == null || value === '') return null;
          if (typeof value !== 'string' || value.trim().length > 300) {
            throw new Error(`${key} must be text up to 300 characters.`);
          }
          return value.trim() || null;
        };
        const dateValue = (key: string) => {
          const value = textValue(key);
          if (
            value !== null &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
          ) {
            throw new Error(`${key} must be a valid date.`);
          }
          return value;
        };
        const integerValue = (key: string, minimum: number) => {
          const value = values[key];
          if (value == null || value === '') return null;
          if (
            typeof value !== 'number' ||
            !Number.isInteger(value) ||
            value < minimum ||
            value > new Date().getFullYear() + 1
          ) {
            throw new Error(`${key} must be a whole number from ${minimum} to next year.`);
          }
          return value;
        };
        const amount = values.assessmentAmount;
        if (
          amount != null &&
          (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)
        ) {
          throw new Error('Assessment amount must be a non-negative number.');
        }
        const mitigation = values.windMitigation;
        if (
          !Array.isArray(mitigation) ||
          mitigation.some((item) => typeof item !== 'string' || item.length > 80)
        ) {
          throw new Error('Wind mitigation must be a list of text values.');
        }
        const paymentType = values.assessmentPaymentType;
        if (
          paymentType != null &&
          paymentType !== '' &&
          paymentType !== 'one_time' &&
          paymentType !== 'installments'
        ) {
          throw new Error('Assessment payment type must be one_time or installments.');
        }
        const riskDetails: PropertyRiskDetails = {
          floodZoneSource: textValue('floodZoneSource'),
          floodZoneDate: dateValue('floodZoneDate'),
          roofYear: integerValue('roofYear', 1800),
          windMitigation: [...new Set(mitigation as string[])],
          insuranceSource: textValue('insuranceSource'),
          insuranceDate: dateValue('insuranceDate'),
          milestoneInspection: textValue('milestoneInspection'),
          countyRecertification: textValue('countyRecertification'),
          reserveStudy: textValue('reserveStudy'),
          specialAssessment: textValue('specialAssessment'),
          assessmentAmount: amount as number | null,
          assessmentPaymentType: (paymentType ||
            null) as PropertyRiskDetails['assessmentPaymentType'],
          rentalRestrictions: textValue('rentalRestrictions'),
          approvalRestrictions: textValue('approvalRestrictions'),
          associationSource: textValue('associationSource'),
          associationDate: dateValue('associationDate'),
        };
        const floodZone =
          body.floodZone == null || body.floodZone === ''
            ? null
            : String(body.floodZone).trim().toUpperCase();
        if (floodZone && floodZone.length > 12)
          throw new Error('Flood zone must be 12 characters or fewer.');
        const property = store.updateRiskDetails(propertyAction[1], floodZone, riskDetails);
        json(200, { property });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to update property risk details.',
        });
      }
      return;
    }
    if (propertyAction && propertyAction[2] === 'notes' && request.method === 'POST') {
      try {
        const body = await readBody();
        if (typeof body.body !== 'string' || body.body.trim().length === 0) {
          throw new Error('Note cannot be empty.');
        }
        const note = store.addNote(propertyAction[1], body.body.trim());
        json(201, { note });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Unable to add note.' });
      }
      return;
    }
    if (
      propertyAction &&
      (propertyAction[2] === 'favorite' || propertyAction[2] === 'dismissal') &&
      request.method === 'PUT'
    ) {
      try {
        const body = await readBody();
        const key = propertyAction[2] === 'favorite' ? 'saved' : 'dismissed';
        if (typeof body[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
        if (propertyAction[2] === 'favorite')
          store.setFavorite(propertyAction[1], body.saved as boolean);
        else store.setDismissed(propertyAction[1], body.dismissed as boolean);
        json(200, {
          saved: store.isFavorite(propertyAction[1]),
          dismissed: store.isDismissed(propertyAction[1]),
        });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Unable to update property.' });
      }
      return;
    }
    const noteAction = request.url?.match(/^\/api\/notes\/(\d+)$/);
    if (noteAction && request.method === 'PATCH') {
      try {
        const body = await readBody();
        if (typeof body.body !== 'string' || body.body.trim().length === 0) {
          throw new Error('Note cannot be empty.');
        }
        store.updateNote(Number(noteAction[1]), body.body.trim());
        json(200, { updated: true });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Unable to update note.' });
      }
      return;
    }
    if (noteAction && request.method === 'DELETE') {
      try {
        store.deleteNote(Number(noteAction[1]));
        response.writeHead(204);
        response.end();
      } catch (error) {
        json(404, { error: error instanceof Error ? error.message : 'Unable to delete note.' });
      }
      return;
    }

    if (request.method === 'GET' && request.url === '/api/saved-searches') {
      json(200, { items: store.listSavedSearches() });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/saved-searches') {
      try {
        const input = savedSearchInput(await readBody()) as SavedSearchInput;
        if (input.priceMin != null && input.priceMax != null && input.priceMin > input.priceMax) {
          throw new Error('Minimum price cannot exceed maximum price.');
        }
        json(201, { item: store.createSavedSearch(input) });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Unable to save search.' });
      }
      return;
    }
    if (request.method === 'POST' && request.url === '/api/saved-searches/refresh-due') {
      const results = await refreshJob.refreshDue();
      json(200, { results });
      return;
    }
    const refreshAction = request.url?.match(/^\/api\/saved-searches\/(\d+)\/refresh$/);
    if (request.method === 'POST' && refreshAction) {
      try {
        const result = await refreshJob.refresh(Number(refreshAction[1]));
        json(result.blocked ? 429 : result.error ? 502 : 200, { result });
      } catch (error) {
        json(404, { error: error instanceof Error ? error.message : 'Unable to refresh search.' });
      }
      return;
    }
    const savedSearchAction = request.url?.match(/^\/api\/saved-searches\/(\d+)(?:\/(pair))?$/);
    if (savedSearchAction && request.method === 'PATCH') {
      try {
        const searchId = Number(savedSearchAction[1]);
        if (savedSearchAction[2] === 'pair') {
          const body = await readBody();
          if (body.pairedSearchId === null) {
            store.unpairSavedSearch(searchId);
          } else if (
            typeof body.pairedSearchId === 'number' &&
            Number.isInteger(body.pairedSearchId)
          ) {
            store.pairSavedSearches(searchId, body.pairedSearchId);
          } else {
            throw new Error('pairedSearchId must be a search ID or null.');
          }
          json(200, { items: store.listSavedSearches() });
        } else {
          const item = store.updateSavedSearch(searchId, savedSearchInput(await readBody(), true));
          json(200, { item });
        }
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to update saved search.',
        });
      }
      return;
    }
    if (savedSearchAction && request.method === 'DELETE' && !savedSearchAction[2]) {
      try {
        store.deleteSavedSearch(Number(savedSearchAction[1]));
        response.writeHead(204);
        response.end();
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to delete saved search.',
        });
      }
      return;
    }

    if (request.method === 'GET' && request.url?.startsWith('/api/listings')) {
      if (request.url === '/api/listings/capabilities') {
        json(200, refreshJob.provider.capabilities);
        return;
      }
      try {
        const url = new URL(request.url, 'http://localhost');
        const mode = url.searchParams.get('mode') ?? 'sale';
        if (mode !== 'sale' && mode !== 'rent') throw new Error('Mode must be sale or rent.');
        const numberParam = (name: string) => {
          const value = url.searchParams.get(name);
          if (value === null || value === '') return undefined;
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0)
            throw new Error(`${name} must be a non-negative number.`);
          return parsed;
        };
        const statuses = url.searchParams
          .getAll('status')
          .flatMap((value) => value.split(','))
          .map((value) => value.trim().toLocaleLowerCase('en-US'))
          .filter(Boolean);
        const criteria: ListingSearchCriteria = {
          mode,
          location: url.searchParams.get('location') ?? undefined,
          priceMin: numberParam('priceMin'),
          priceMax: numberParam('priceMax'),
          beds: numberParam('beds'),
          baths: numberParam('baths'),
          propertyType: url.searchParams.get('propertyType') || undefined,
          minSqft: numberParam('minSqft'),
          statuses: statuses.length ? statuses : ['active'],
          sort: url.searchParams.get('sort') === 'price' ? 'price' : 'newest',
          showDismissed: url.searchParams.get('showDismissed') === 'true',
          savedOnly: url.searchParams.get('savedOnly') === 'true',
        };
        if (
          criteria.priceMin !== undefined &&
          criteria.priceMax !== undefined &&
          criteria.priceMin > criteria.priceMax
        ) {
          throw new Error('Minimum price cannot exceed maximum price.');
        }
        const localAssumptions = store.listLocalAssumptions();
        const items = store.transaction(() =>
          store.searchListings(criteria).map((item) => ({
            ...item,
            // Detected for display and scoring only; property detail stores them.
            listing: {
              ...item.listing,
              implausibleFlags: currentImplausibleFlags(
                store,
                item.property,
                item.listing,
                localAssumptions,
              ),
            },
            comparableRent:
              mode === 'sale'
                ? findComparableRent(store, item.property.id, store.getComparableRentRules())
                : null,
            costEstimate:
              mode === 'sale'
                ? costEstimateFor(store, item.property, item.listing, defaultPersonalAssumptions)
                : null,
          })),
        );
        json(200, { items, criteria });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Unable to search listings.' });
      }
      return;
    }

    if (request.method === 'GET' && request.url === '/api/match-reviews') {
      const items = store.listPendingMatchReviews().map((review) => {
        const incoming = review.incomingListing as ReviewListingInput;
        const candidate = store.getProperty(review.candidatePropertyId);
        return {
          id: review.id,
          reason: review.reason,
          incoming: {
            ...incoming.property,
            mode: incoming.listing.mode,
            price: incoming.listing.price,
            provider: incoming.provider,
            lastSeen: incoming.listing.providerLastSeenDate,
          },
          candidate,
          candidateListings: store.listListings(review.candidatePropertyId).map((listing) => ({
            mode: listing.mode,
            price: listing.price,
            lastSeen: listing.providerLastSeenDate,
          })),
          noteCount: store.listNotes(review.candidatePropertyId).length,
        };
      });
      json(200, { items });
      return;
    }

    const reviewAction = request.url?.match(
      /^\/api\/match-reviews\/(\d+)\/(link|keep-separate|undo)$/,
    );
    if (request.method === 'POST' && reviewAction) {
      try {
        const reviewId = Number(reviewAction[1]);
        const action = reviewAction[2];
        const item =
          action === 'undo'
            ? store.undoMatchReview(reviewId)
            : store.decideMatchReview(reviewId, action === 'link' ? 'link' : 'keep_separate');
        json(200, { item });
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to update match review',
        });
      }
      return;
    }

    json(404, { error: 'Not found' });
  });
}

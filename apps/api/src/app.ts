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

const defaultCredentialPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');

export function createApp(
  database: Database,
  store: Store = createStore(database),
  refreshJob: RefreshJob = new RefreshJob(store, new MockListingProvider()),
  credentials: ProviderCredentials = new ProviderCredentials(defaultCredentialPath),
) {
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
        };
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
      json(200, { configured: credentials.isRentCastConfigured() });
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
          refreshJob.budget.configure({ ceiling: body.ceiling, billingDay: body.billingDay }),
        );
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Unable to save the request budget.',
        });
      }
      return;
    }
    const rentEstimateAction = request.url?.match(
      /^\/api\/properties\/(prop_[A-Za-z0-9_-]+)\/rent-estimate$/,
    );
    if (rentEstimateAction && request.method === 'POST') {
      try {
        const estimate = await requestRentEstimate(
          store,
          refreshJob.provider,
          refreshJob.budget,
          rentEstimateAction[1],
        );
        json(200, { estimate });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Rent estimate failed.';
        if (error instanceof RequestCeilingError)
          json(429, { error: message, blocked: error.decision });
        else if (error instanceof RentEstimateUnavailableError) json(501, { error: message });
        else if (message === 'Property not found.') json(404, { error: message });
        else json(502, { error: message });
      }
      return;
    }

    const propertyAction = request.url?.match(
      /^\/api\/properties\/(prop_[A-Za-z0-9_-]+)(?:\/(notes|favorite|dismissal|risk-details))?$/,
    );
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
          ['tax_bill', 'tax_bill_cdd', 'association_fee'].includes(kind) &&
          (body.state !== 'Doc' || amount === null)
        )
          throw new Error('Tax bills and association fee records need an amount and Doc state.');
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
      json(200, {
        property,
        listings: store.listListings(propertyId).map((listing) => ({
          ...listing,
          localSnapshots: store.listSnapshots(listing.id),
        })),
        notes: store.listNotes(propertyId),
        costEntries: store.listCostEntries(propertyId),
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
        json(200, { items: store.searchListings(criteria), criteria });
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

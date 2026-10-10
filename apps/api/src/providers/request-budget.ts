import type { Store } from '../store.js';

/** 5 below the free tier's 50 requests. */
export const DEFAULT_REQUEST_CEILING = 45;
export const DEFAULT_BILLING_DAY = 1;
export const DEFAULT_INCLUDED_REQUESTS = 50;

const CEILING_KEY = 'request_ceiling';
const BILLING_DAY_KEY = 'billing_day';
const INCLUDED_KEY = 'plan_included_requests';
const DASHBOARD_USED_KEY = 'dashboard_used';
const DASHBOARD_READ_DATE_KEY = 'dashboard_read_date';

export interface RequestBudgetStatus {
  ceiling: number;
  billingDay: number;
  includedRequests: number;
  appCount: number;
  outsideCount: number;
  errorCount: number;
  used: number;
  dashboardUsed: number | null;
  dashboardReadDate: string | null;
  unexplained: number | null;
  remaining: number;
  /** Start of the current billing month (UTC), inclusive. */
  periodStart: string;
  /** When the count resets (UTC). */
  nextReset: string;
  daysRemaining: number;
}

export interface BudgetDecision {
  allowed: boolean;
  used: number;
  ceiling: number;
  projected: number;
  nextReset: string;
  /** Names used, ceiling, and projected when the request is blocked. */
  message: string | null;
}

export class RequestCeilingError extends Error {
  constructor(readonly decision: BudgetDecision) {
    super(decision.message ?? 'Request ceiling reached.');
    this.name = 'RequestCeilingError';
  }
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The billing day, or the month's last day when the month is shorter (day 31 in April). */
function resetDate(year: number, month: number, billingDay: number) {
  return new Date(Date.UTC(year, month, Math.min(billingDay, daysInMonth(year, month))));
}

/** The billing month containing `at`: it starts on the latest reset on or before `at`. */
export function billingPeriod(at: Date, billingDay: number) {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const thisMonth = resetDate(year, month, billingDay);
  const start = at >= thisMonth ? thisMonth : resetDate(year, month - 1, billingDay);
  const next = at >= thisMonth ? resetDate(year, month + 1, billingDay) : thisMonth;
  return { start, next };
}

function wholeNumber(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function validDate(value: unknown, name: string): string {
  const parsed = typeof value === 'string' ? Date.parse(`${value}T00:00:00.000Z`) : NaN;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  )
    throw new Error(`${name} must be a valid YYYY-MM-DD date.`);
  return value;
}

/**
 * The monthly ceiling on provider requests. Every code path that can reach a provider
 * asks this first, so the rule holds for the UI, the scheduler, and direct API calls.
 */
export class RequestBudget {
  constructor(
    private readonly store: Store,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get ceiling(): number {
    const saved = this.store.getSetting(CEILING_KEY);
    return saved === null ? DEFAULT_REQUEST_CEILING : Number(saved);
  }

  get billingDay(): number {
    const saved = this.store.getSetting(BILLING_DAY_KEY);
    return saved === null ? DEFAULT_BILLING_DAY : Number(saved);
  }

  get includedRequests(): number {
    const saved = this.store.getSetting(INCLUDED_KEY);
    return saved === null ? DEFAULT_INCLUDED_REQUESTS : Number(saved);
  }

  configure(input: {
    ceiling?: unknown;
    billingDay?: unknown;
    includedRequests?: unknown;
    dashboardUsed?: unknown;
    dashboardReadDate?: unknown;
  }) {
    // Validate both before saving either.
    const ceiling =
      input.ceiling === undefined
        ? undefined
        : wholeNumber(input.ceiling, 'Request ceiling', 0, 1_000_000);
    const billingDay =
      input.billingDay === undefined
        ? undefined
        : wholeNumber(input.billingDay, 'Billing day', 1, 31);
    const included =
      input.includedRequests === undefined
        ? undefined
        : wholeNumber(input.includedRequests, 'Included requests', 0, 1_000_000);
    const dashboardUsed =
      input.dashboardUsed === undefined
        ? undefined
        : input.dashboardUsed === null
          ? null
          : wholeNumber(input.dashboardUsed, 'Dashboard used', 0, 1_000_000);
    const dashboardReadDate =
      input.dashboardReadDate === undefined
        ? undefined
        : input.dashboardReadDate === null
          ? null
          : validDate(input.dashboardReadDate, 'Dashboard read date');
    if (
      (dashboardUsed === undefined) !== (dashboardReadDate === undefined) ||
      (dashboardUsed === null) !== (dashboardReadDate === null)
    )
      throw new Error('Dashboard used and read date must be set or cleared together.');
    if (ceiling !== undefined) this.store.setSetting(CEILING_KEY, String(ceiling));
    if (billingDay !== undefined) this.store.setSetting(BILLING_DAY_KEY, String(billingDay));
    if (included !== undefined) this.store.setSetting(INCLUDED_KEY, String(included));
    if (dashboardUsed !== undefined)
      this.store.setSetting(
        DASHBOARD_USED_KEY,
        dashboardUsed === null ? '' : String(dashboardUsed),
      );
    if (dashboardReadDate !== undefined)
      this.store.setSetting(DASHBOARD_READ_DATE_KEY, dashboardReadDate ?? '');
    return this.status();
  }

  addOutsideRequest(input: { requestDate: unknown; count: unknown; note?: unknown }) {
    const requestDate = validDate(input.requestDate, 'Request date');
    if (requestDate > this.clock().toISOString().slice(0, 10))
      throw new Error('Request date cannot be in the future.');
    const count = wholeNumber(input.count, 'Outside request count', 1, 1_000_000);
    const note = input.note === undefined ? '' : input.note;
    if (typeof note !== 'string' || note.length > 500)
      throw new Error('Note must be text of at most 500 characters.');
    return this.store.addOutsideProviderRequest({ requestDate, count, note: note.trim() });
  }

  status(): RequestBudgetStatus {
    const billingDay = this.billingDay;
    const ceiling = this.ceiling;
    const { start, next } = billingPeriod(this.clock(), billingDay);
    const appCount = this.store.countProviderRequestsInPeriod(
      start.toISOString(),
      next.toISOString(),
    );
    const errorCount = this.store.countFailedProviderRequestsInPeriod(
      start.toISOString(),
      next.toISOString(),
    );
    const outsideRequests = this.store.listOutsideProviderRequests();
    const outsideCount = outsideRequests
      .filter(
        (entry) =>
          entry.requestDate >= start.toISOString().slice(0, 10) &&
          entry.requestDate < next.toISOString().slice(0, 10),
      )
      .reduce((sum, entry) => sum + entry.count, 0);
    // Failed calls are counted in the app ledger, but RentCast does not bill them.
    // Started calls remain counted until their result is known.
    const used = appCount - errorCount + outsideCount;
    const dashboardUsedValue = this.store.getSetting(DASHBOARD_USED_KEY);
    const dashboardReadDateValue = this.store.getSetting(DASHBOARD_READ_DATE_KEY);
    const dashboardUsed = dashboardUsedValue ? Number(dashboardUsedValue) : null;
    const dashboardReadDate = dashboardReadDateValue || null;
    const snapshotIsCurrent =
      dashboardReadDate !== null &&
      dashboardReadDate >= start.toISOString().slice(0, 10) &&
      dashboardReadDate < next.toISOString().slice(0, 10);
    const snapshotEnd = snapshotIsCurrent ? new Date(`${dashboardReadDate}T00:00:00.000Z`) : null;
    snapshotEnd?.setUTCDate(snapshotEnd.getUTCDate() + 1);
    const snapshotMatched =
      snapshotEnd && dashboardReadDate
        ? this.store.countProviderRequestsInPeriod(start.toISOString(), snapshotEnd.toISOString()) -
          this.store.countFailedProviderRequestsInPeriod(
            start.toISOString(),
            snapshotEnd.toISOString(),
          ) +
          outsideRequests
            .filter(
              (entry) =>
                entry.requestDate >= start.toISOString().slice(0, 10) &&
                entry.requestDate <= dashboardReadDate,
            )
            .reduce((sum, entry) => sum + entry.count, 0)
        : null;
    return {
      ceiling,
      billingDay,
      includedRequests: this.includedRequests,
      appCount,
      outsideCount,
      errorCount,
      used,
      dashboardUsed: snapshotIsCurrent ? dashboardUsed : null,
      dashboardReadDate: snapshotIsCurrent ? dashboardReadDate : null,
      unexplained:
        snapshotMatched !== null && dashboardUsed !== null ? dashboardUsed - snapshotMatched : null,
      remaining: Math.max(0, ceiling - used),
      periodStart: start.toISOString(),
      nextReset: next.toISOString(),
      daysRemaining: this.daysUntilReset(),
    };
  }

  daysUntilReset(): number {
    const now = this.clock();
    const { next } = billingPeriod(now, this.billingDay);
    return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 86_400_000));
  }

  /** Requests the next refresh of this search is expected to use: its last run, or 1. */
  projectedRefresh(searchId: number): number {
    return Math.max(1, this.store.lastRefreshRequestCount(searchId) ?? 1);
  }

  /** Blocked when used + projected would pass the ceiling. Reaching it exactly is allowed. */
  check(projected: number, action: string): BudgetDecision {
    const { used, ceiling, nextReset, outsideCount } = this.status();
    const allowed = used + projected <= ceiling;
    return {
      allowed,
      used,
      ceiling,
      projected,
      nextReset,
      message: allowed
        ? null
        : `${action} blocked: ${used} of ${ceiling} requests used this month${outsideCount ? `, including ${outsideCount} outside requests,` : ''} and it is projected at ${projected}, which would pass the ceiling. Nothing was sent. The count resets ${nextReset.slice(0, 10)}.`,
    };
  }

  /** Throws RequestCeilingError, so callers cannot send without passing the check. */
  assertCanSend(projected: number, action: string): BudgetDecision {
    const decision = this.check(projected, action);
    if (!decision.allowed) throw new RequestCeilingError(decision);
    return decision;
  }
}

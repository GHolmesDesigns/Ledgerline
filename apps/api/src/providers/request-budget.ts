import type { Store } from '../store.js';

/** 5 below the free tier's 50 requests. */
export const DEFAULT_REQUEST_CEILING = 45;
export const DEFAULT_BILLING_DAY = 1;

const CEILING_KEY = 'request_ceiling';
const BILLING_DAY_KEY = 'billing_day';

export interface RequestBudgetStatus {
  ceiling: number;
  billingDay: number;
  used: number;
  remaining: number;
  /** Start of the current billing month (UTC), inclusive. */
  periodStart: string;
  /** When the count resets (UTC). */
  nextReset: string;
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

  configure(input: { ceiling?: unknown; billingDay?: unknown }) {
    // Validate both before saving either.
    const ceiling =
      input.ceiling === undefined
        ? undefined
        : wholeNumber(input.ceiling, 'Request ceiling', 0, 1_000_000);
    const billingDay =
      input.billingDay === undefined
        ? undefined
        : wholeNumber(input.billingDay, 'Billing day', 1, 31);
    if (ceiling !== undefined) this.store.setSetting(CEILING_KEY, String(ceiling));
    if (billingDay !== undefined) this.store.setSetting(BILLING_DAY_KEY, String(billingDay));
    return this.status();
  }

  status(): RequestBudgetStatus {
    const billingDay = this.billingDay;
    const ceiling = this.ceiling;
    const { start, next } = billingPeriod(this.clock(), billingDay);
    const used = this.store.countProviderRequestsSince(start.toISOString());
    return {
      ceiling,
      billingDay,
      used,
      remaining: Math.max(0, ceiling - used),
      periodStart: start.toISOString(),
      nextReset: next.toISOString(),
    };
  }

  /** Requests the next refresh of this search is expected to use: its last run, or 1. */
  projectedRefresh(searchId: number): number {
    return Math.max(1, this.store.lastRefreshRequestCount(searchId) ?? 1);
  }

  /** Blocked when used + projected would pass the ceiling. Reaching it exactly is allowed. */
  check(projected: number, action: string): BudgetDecision {
    const { used, ceiling, nextReset } = this.status();
    const allowed = used + projected <= ceiling;
    return {
      allowed,
      used,
      ceiling,
      projected,
      nextReset,
      message: allowed
        ? null
        : `${action} blocked: ${used} of ${ceiling} requests used this month and it is projected at ${projected}, which would pass the ceiling. Nothing was sent. The count resets ${nextReset.slice(0, 10)}.`,
    };
  }

  /** Throws RequestCeilingError, so callers cannot send without passing the check. */
  assertCanSend(projected: number, action: string): BudgetDecision {
    const decision = this.check(projected, action);
    if (!decision.allowed) throw new RequestCeilingError(decision);
    return decision;
  }
}

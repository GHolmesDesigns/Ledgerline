import type {
  Listing,
  LocalAssumptions,
  PersonalAssumptions,
  Property,
  PropertyCostEntry,
} from './store.js';

export type CostLineState = 'Listing' | 'Calc' | 'Quote' | 'Doc' | 'N/A' | 'Est.' | 'Unknown';
export type CostLineKey =
  | 'principalInterest'
  | 'propertyTax'
  | 'homeowners'
  | 'ho6'
  | 'flood'
  | 'hoa'
  | 'nonAdValorem'
  | 'specialAssessment'
  | 'maintenance';

export interface CostLine {
  key: CostLineKey;
  label: string;
  monthly: number | null;
  state: CostLineState;
  note: string | null;
}

export interface CostEstimate {
  lines: CostLine[];
  totalStatus: 'Calculated' | 'Estimate' | 'Incomplete';
  statusLabel: string;
  totalLabel: string;
  monthlyTotal: number | null;
  knownSubtotal: number;
  upfrontCash: number;
  upfrontLabel: string;
  upfrontAssessmentUnknown: boolean;
}

export interface CostEstimateInput {
  property: Property;
  saleListing: Listing;
  entries: PropertyCostEntry[];
  localAssumption: LocalAssumptions | null;
  personalAssumptions: PersonalAssumptions;
  /** Median of at least two other units at this street address, when available. */
  sameBuildingHoaMonthly?: number | null;
}

const roundMoney = (value: number) => Math.round(value + Number.EPSILON);
const isAttached = (type: string | null) =>
  ['condo', 'co-op', 'coop', 'townhome', 'townhouse'].includes((type ?? '').toLowerCase());
const isCondo = (type: string | null) =>
  ['condo', 'co-op', 'coop'].includes((type ?? '').toLowerCase());

function latest(entries: PropertyCostEntry[], ...kinds: PropertyCostEntry['kind'][]) {
  return [...entries].reverse().find((entry) => kinds.includes(entry.kind));
}

function monthlyLine(
  key: CostLineKey,
  label: string,
  monthly: number | null,
  state: CostLineState,
  note: string | null = null,
): CostLine {
  return { key, label, monthly, state, note };
}

function money(value: number) {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function mortgagePayment(principal: number, annualRatePct: number, termYears: number) {
  const months = termYears * 12;
  const monthlyRate = annualRatePct / 100 / 12;
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

function floodDefault(local: LocalAssumptions, zone: string | null) {
  const defaults = local.floodDefaultMonthly;
  const normalized = zone?.trim().toUpperCase().replace(/\s+/g, '');
  if (normalized && defaults[normalized] != null) return defaults[normalized];
  // An unknown zone uses the local high-risk default, never a statewide figure.
  const highRisk = Object.keys(defaults).find((key) => /^[AV]/i.test(key));
  return highRisk ? defaults[highRisk] : null;
}

function incompleteReasons(lines: CostLine[], property: Property, local: LocalAssumptions | null) {
  const reasons: string[] = [];
  const byKey = new Map(lines.map((line) => [line.key, line]));
  if (byKey.get('specialAssessment')?.state === 'Unknown')
    reasons.push('special assessment amount unknown');
  if (
    byKey.get('nonAdValorem')?.state === 'Unknown' &&
    byKey.get('nonAdValorem')?.note === 'CDD amount unknown'
  )
    reasons.push('CDD amount unknown');
  if (byKey.get('hoa')?.state === 'Unknown' && isAttached(property.propertyType))
    reasons.push('HOA fee unknown');
  if (!local?.set) reasons.push(`no ${property.county ?? 'local'} rates`);
  return reasons;
}

/** Pure monthly cost calculation from normalized local records and assumptions. */
export function computeCostEstimate(input: CostEstimateInput): CostEstimate | null {
  const {
    property,
    saleListing,
    entries,
    localAssumption: local,
    personalAssumptions: personal,
  } = input;
  const price = saleListing.price;
  if (saleListing.mode !== 'sale' || price == null || !Number.isFinite(price) || price < 0)
    return null;
  const countySet = !!local?.set;
  const lines: CostLine[] = [];
  const principal = price * (1 - personal.downPaymentPct / 100);
  lines.push(
    monthlyLine(
      'principalInterest',
      'Principal & interest',
      roundMoney(mortgagePayment(principal, personal.mortgageRatePct, personal.termYears)),
      'Calc',
    ),
  );
  lines.push(
    countySet && local?.millage != null
      ? monthlyLine(
          'propertyTax',
          'Property tax',
          roundMoney((price * local.millage) / 1000 / 12),
          'Calc',
          'Purchase price × local millage',
        )
      : monthlyLine('propertyTax', 'Property tax', null, 'Unknown', 'Local rates not set'),
  );

  const insuranceKind = isCondo(property.propertyType) ? 'ho6_quote' : 'homeowners_quote';
  const insuranceKey = isCondo(property.propertyType) ? 'ho6' : 'homeowners';
  const insuranceLabel = isCondo(property.propertyType) ? 'HO-6 insurance' : 'Homeowners insurance';
  const insurance = latest(entries, insuranceKind);
  if (insurance)
    lines.push(
      monthlyLine(insuranceKey, insuranceLabel, insurance.amount, 'Quote', insurance.source),
    );
  else {
    const amount = countySet
      ? ((isCondo(property.propertyType)
          ? local?.ho6DefaultMonthly
          : local?.homeownersDefaultMonthly) ?? null)
      : null;
    lines.push(
      monthlyLine(
        insuranceKey,
        insuranceLabel,
        amount,
        amount == null ? 'Unknown' : 'Est.',
        amount == null
          ? 'Local rates not set'
          : isCondo(property.propertyType)
            ? 'HO-6 local default'
            : 'Homeowners local default',
      ),
    );
  }

  const floodQuote = latest(entries, 'flood_quote');
  const floodNotCarried = latest(entries, 'flood_not_carried');
  if (floodNotCarried)
    lines.push(monthlyLine('flood', 'Flood insurance', 0, 'N/A', floodNotCarried.source));
  else if (floodQuote)
    lines.push(
      monthlyLine('flood', 'Flood insurance', floodQuote.amount, 'Quote', floodQuote.source),
    );
  else {
    const amount = countySet ? floodDefault(local!, property.floodZone) : null;
    lines.push(
      monthlyLine(
        'flood',
        'Flood insurance',
        amount,
        amount == null ? 'Unknown' : 'Est.',
        amount == null
          ? 'Local rates not set'
          : property.floodZone
            ? `${property.floodZone} local default`
            : 'High-risk local default',
      ),
    );
  }

  const listingHoa = saleListing.hoaFee;
  const associationNone = latest(entries, 'hoa_none');
  const associationFee = latest(entries, 'association_fee');
  if (listingHoa != null)
    lines.push(monthlyLine('hoa', 'HOA / association fee', listingHoa, 'Listing'));
  else if (associationFee)
    lines.push(
      monthlyLine(
        'hoa',
        'HOA / association fee',
        associationFee.amount,
        'Doc',
        associationFee.source,
      ),
    );
  else if (associationNone)
    lines.push(monthlyLine('hoa', 'HOA / association fee', 0, 'N/A', associationNone.source));
  else if (input.sameBuildingHoaMonthly != null)
    lines.push(
      monthlyLine(
        'hoa',
        'HOA / association fee',
        input.sameBuildingHoaMonthly,
        'Est.',
        'Same-building median · confirm fee',
      ),
    );
  else if (isAttached(property.propertyType))
    lines.push(monthlyLine('hoa', 'HOA / association fee', null, 'Unknown', 'HOA fee unknown'));
  else lines.push(monthlyLine('hoa', 'HOA / association fee', 0, 'Est.', 'HOA not confirmed'));

  const cddDoc = latest(entries, 'tax_bill_cdd');
  const taxBill = latest(entries, 'tax_bill');
  if (cddDoc && !cddDoc.amountUnknown && cddDoc.amount != null)
    lines.push(
      monthlyLine(
        'nonAdValorem',
        'Non-ad valorem / CDD',
        roundMoney(cddDoc.amount / 12),
        'Doc',
        cddDoc.source,
      ),
    );
  else if (cddDoc?.amountUnknown)
    lines.push(
      monthlyLine('nonAdValorem', 'Non-ad valorem / CDD', null, 'Unknown', 'CDD amount unknown'),
    );
  else if (taxBill)
    lines.push(monthlyLine('nonAdValorem', 'Non-ad valorem / CDD', 0, 'Doc', taxBill.source));
  else if (!countySet)
    lines.push(
      monthlyLine('nonAdValorem', 'Non-ad valorem / CDD', null, 'Unknown', 'Local rates not set'),
    );
  else
    lines.push(
      monthlyLine(
        'nonAdValorem',
        'Non-ad valorem / CDD',
        local?.typicalNonAdValoremPerYear == null
          ? null
          : roundMoney(local.typicalNonAdValoremPerYear / 12),
        local?.typicalNonAdValoremPerYear == null ? 'Unknown' : 'Est.',
        'CDD not checked',
      ),
    );

  const assessment = latest(entries, 'special_assessment');
  const assessmentsNone = latest(entries, 'assessments_none');
  const riskAssessmentKnown = /pending|approved/i.test(
    property.riskDetails.specialAssessment ?? '',
  );
  let upfrontAssessmentUnknown = false;
  let oneTimeAssessment = 0;
  if (associationNone) {
    lines.push(
      monthlyLine('specialAssessment', 'Special assessments', 0, 'N/A', associationNone.source),
    );
  } else if (
    (assessment?.amountUnknown ?? false) ||
    (!assessment && riskAssessmentKnown && property.riskDetails.assessmentAmount == null)
  ) {
    lines.push(
      monthlyLine(
        'specialAssessment',
        'Special assessments',
        null,
        'Unknown',
        'Special assessment amount unknown',
      ),
    );
    const paymentType = assessment?.paymentType ?? property.riskDetails.assessmentPaymentType;
    upfrontAssessmentUnknown = paymentType !== 'installments';
  } else if (assessmentsNone) {
    lines.push(
      monthlyLine('specialAssessment', 'Special assessments', 0, 'Doc', assessmentsNone.source),
    );
  } else if (assessment?.amount != null || property.riskDetails.assessmentAmount != null) {
    const amount = assessment?.amount ?? property.riskDetails.assessmentAmount!;
    const paymentType = assessment?.paymentType ?? property.riskDetails.assessmentPaymentType;
    if (paymentType === 'one_time') {
      lines.push(
        monthlyLine(
          'specialAssessment',
          'Special assessments',
          0,
          'Doc',
          'One-time amount shown in upfront cash',
        ),
      );
      oneTimeAssessment = amount;
    } else lines.push(monthlyLine('specialAssessment', 'Special assessments', amount, 'Doc'));
  } else if (isAttached(property.propertyType) || associationFee || listingHoa != null)
    lines.push(
      monthlyLine('specialAssessment', 'Special assessments', 0, 'Est.', 'Assessments not checked'),
    );
  else
    lines.push(
      monthlyLine('specialAssessment', 'Special assessments', 0, 'Est.', 'Assessments not checked'),
    );

  lines.push(
    monthlyLine(
      'maintenance',
      'Maintenance reserve',
      roundMoney((price * personal.maintenancePctPerYear) / 100 / 12),
      'Calc',
    ),
  );

  const lineOrder: CostLineKey[] = [
    'principalInterest',
    'propertyTax',
    'homeowners',
    'ho6',
    'flood',
    'hoa',
    'specialAssessment',
    'nonAdValorem',
    'maintenance',
  ];
  lines.sort((left, right) => lineOrder.indexOf(left.key) - lineOrder.indexOf(right.key));

  const zone = property.floodZone?.trim().toUpperCase() ?? '';
  const highRiskFlood = !zone || /^[AV]/.test(zone);
  const orderedEstimates = lines
    .filter((line) => line.state === 'Est.')
    .map((line) => {
      let order = 99;
      let label = line.label;
      if (line.key === 'hoa' && line.monthly !== 0 && isAttached(property.propertyType)) {
        order = 0;
        label = 'HOA confirmation';
      } else if (line.key === 'homeowners') {
        order = 1;
        label = 'insurance quote';
      } else if (line.key === 'ho6') {
        order = 1;
        label = 'HO-6 quote';
      } else if (line.key === 'flood') {
        order = highRiskFlood ? 2 : 4;
        label = 'flood quote';
      } else if (line.key === 'specialAssessment') {
        order = isAttached(property.propertyType) ? 3 : 7;
        label = 'assessments not checked';
      } else if (line.key === 'nonAdValorem') {
        order = 5;
        label = 'CDD not checked';
      } else if (line.key === 'hoa') {
        order = 6;
        label = 'HOA not confirmed';
      }
      return { order, label };
    })
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.label);
  const estimates = orderedEstimates;
  const unknown = lines.some((line) => line.state === 'Unknown');
  const estimated = lines.some((line) => line.state === 'Est.');
  const knownSubtotal = lines.reduce((sum, line) => sum + (line.monthly ?? 0), 0);
  const totalStatus: CostEstimate['totalStatus'] = unknown
    ? 'Incomplete'
    : estimated
      ? 'Estimate'
      : 'Calculated';
  let statusLabel: string;
  if (unknown) {
    const reasons = incompleteReasons(lines, property, local);
    statusLabel = `Incomplete · ${reasons.join(', ')}`;
  } else if (estimated) {
    const named = estimates.slice(0, 2);
    const remaining = estimates.length - named.length;
    statusLabel = `Estimate · needs ${named.join(', ')}${remaining > 0 ? ` +${remaining}` : ''}`;
  } else statusLabel = 'Calculated';

  const reason = incompleteReasons(lines, property, local);
  const incompleteAdditions = reason.flatMap((item) => {
    if (item === 'special assessment amount unknown') return ['special assessment'];
    if (item === 'CDD amount unknown') return ['CDD'];
    if (item === 'HOA fee unknown') return ['HOA'];
    return [];
  });
  const totalLabel = unknown
    ? `at least ${money(knownSubtotal)}/mo${incompleteAdditions.length ? ` + ${incompleteAdditions.join(', ')}` : ''}`
    : `${money(knownSubtotal)}/mo`;
  const upfrontCash = (price * personal.downPaymentPct) / 100 + oneTimeAssessment;
  const upfrontLabel = `${money(upfrontCash)}${upfrontAssessmentUnknown ? ' + assessment (amount unknown)' : ''}`;

  return {
    lines,
    totalStatus,
    statusLabel,
    totalLabel,
    monthlyTotal: unknown ? null : knownSubtotal,
    knownSubtotal,
    upfrontCash,
    upfrontLabel,
    upfrontAssessmentUnknown,
  };
}

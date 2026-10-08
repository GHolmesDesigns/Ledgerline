# UI specification — Florida Home Dashboard

*Oct 7, 2026 · Follows `PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.md` version 2.6, which wins any conflict. Every number below is in `fixtures/sample-data.json`.*

Four desktop screens and four matching mobile screens: **Search**, **Compare**, **Property detail**, **Ranking & data**. Visual reference: `design/` (see `design/README.md` for which screens are current).

## 1. Rules on every screen

### Cost line tags
Every cost figure carries a short text tag. Tags must read without color.

| Tag | Meaning | Total effect |
|---|---|---|
| Listing | From the provider record | Firm |
| Calc | From price and the user's assumptions | Firm |
| Quote | Insurer quote the user entered | Firm |
| Doc | From a tax bill, association letter, or disclosure, including a verified $0 | Firm |
| N/A | Can't apply to this property; shown as "N/A", counts as $0 | Firm, ignored |
| Est. | Local default, same-building median, or an assumed $0 not yet checked | Total becomes Estimate |
| Unknown | Known, material cost with no usable figure | Total becomes Incomplete |

- "Doc $0" = verified none (e.g. "Doc $0 · no CDD on tax bill").
- Unchecked $0 = "Est. $0 · not checked" (assessments) or "Est. $0 · HOA not confirmed" (single-family HOA).
- Unchecked CDD = county typical non-ad valorem amount, "Est. · CDD not checked".
- **CDD line precedence:** Doc (tax bill amount or verified $0) → Unknown if a known CDD has no amount → "Unknown · no [county] rates" if the county isn't configured → Est. at the county typical.
- **A property's own Quote or Doc always beats county rates**, so verified lines stay firm even in an unconfigured county.
- **Townhomes use the house homeowners default**; condos use HO-6.

### Total status chip
Takes the weakest line:
- **Calculated** — every line is Listing, Calc, Quote, Doc, or N/A.
- **Estimate · needs [up to two items] +n** — any Est. line. Name up to two items; count every other Est. line as "+n". Examples: "Estimate · needs flood quote" (1 line); "Estimate · needs insurance quote, assessments not checked +1" (3 lines); "Estimate · needs HO-6 quote, flood quote +2" (4 lines).
  - Named in the plan's order: HOA confirmation (same-building median) → insurance or HO-6 quote → flood quote (A or V zone, or zone unknown) → assessments not checked (association exists) → flood quote (other zones) → CDD not checked → HOA not confirmed (single-family) → assessments not checked (no known association).
- **Incomplete · [what's missing]** — any Unknown line. Shows the known subtotal as "at least $X". Never shows an own-vs-rent gap. Never gets "Lowest".

**Incomplete happens only for four triggers:** an assessment pending or approved with no amount; a known CDD with no amount; a condo, co-op, or townhome with no HOA fee from the listing or same-building data; a county without local rates.

### Own-vs-rent gap
- Estimate total + rent available → "≈ +$1,971/mo" (≈ required).
- Calculated total + rent available → "+$X/mo".
- Incomplete total or rent Unavailable → hidden. Show a muted reason instead ("No own-vs-rent gap · total incomplete" / "· rent unavailable").

### Comparable rent
Always shows its source, using the first that applies:
1. "same home · listed [date]"
2. "[n] local comps · median · within [distance]" (comps viewable)
3. "RentCast estimate · range $low–$high · [date]" (on request only, 1 request)
4. "Unavailable · [reason]" — never fill in a weak number.

### Scores and ranks
- **Rank labels (#1, #2…) always follow score order**, whatever sort is selected. Price sort on the sample data shows: $285k #4, $389k #7, $465k #2, $529k #3, $560k #5, $615k #6, $849k #1.
- Unknown factors score as the worst value (0) and show "Unknown · scored 0" in the breakdown.
- **Provisional** badge whenever a factor is unknown or the listing has an implausible-value flag, with the reason ("1 factor unknown: comparable rent", "check price per sq ft"). Use a dashed border plus the word, not color alone.

### Assumptions
- **Personal:** down payment 20%, 6.50% 30-yr fixed, maintenance 1%/yr.
- **Local, per county:** millage, typical non-ad valorem $/yr, homeowners default (house), HO-6 default (condo), flood defaults for zones X / AE / VE, source and date. Sample values are tagged "sample".
- **No statewide rates anywhere.** No "18.5 mills" or any single Florida figure.

### Header
"RentCast · Developer · 23 / 45 requests" with a usage bar, last refresh time, and "browsing uses no requests". Refresh button: "Refresh this search · ~2 requests (measured)".

### Sample-data note
Keep "Sample data — not real listings" visible on every screen.

## 2. Sample listings (Buy)

| Rank · score | Listing | County | Total | Rent | Gap |
|---|---|---|---|---|---|
| #1 · 84 | $849,000 · Fort Lauderdale 33308 · single-family 3/2 · 1,850 sf · 1964 · roof 2020 · impact windows · zone AE | Broward | $7,171 · Estimate · needs flood quote | $5,200 · same home · listed Sep 28 | ≈ +$1,971 |
| #2 · 81 | $465,000 · Miramar 33027 · townhome 3/2.5 · 1,700 sf · 2016 · zone X · HOA $260 (Listing) · CDD Doc $2,400/yr | Broward | $4,525 · Estimate · needs insurance quote, assessments not checked +1 | $3,600 · 3 local comps · within 0.9 mi | ≈ +$925 |
| #3 · 78 | $529,000 · Brickell 33131 · high-rise condo 1/1 · 780 sf · 2008 · zone AE · HOA $890 · milestone filed · reserve study complete | Miami-Dade | $5,242 · Estimate · needs HO-6 quote, flood quote +2 | $3,100 · 4 local comps · within 0.3 mi | ≈ +$2,142 |
| #4 · 74 provisional | $285,000 · Miami 33137 · condo 2/2 · listed 2,900 sf · 1981 · zone X · HOA Est. $640 (median of 3 units in this building) · flag "$98/sq ft; this area runs about $450–$650 (sample)…" | Miami-Dade | $3,018 · Estimate · needs HOA confirmation, HO-6 quote +3 | $3,300 · 3 local comps | ≈ −$282 |
| #5 · 66 provisional | $560,000 · North Miami 33161 · single-family 3/2 · 1,400 sf · 1955 · roof 2006 (may limit carriers) · zone X · HOA Est. $0 not confirmed | Miami-Dade | $4,896 · Estimate · needs insurance quote, flood quote +3 | Unavailable · only 2 local comps | hidden |
| #6 · 60 provisional | $615,000 · Boca Raton 33432 · single-family 3/2 · 1,600 sf · 1978 · picked up by radius at Broward line | Palm Beach (not configured) | at least $3,623 · Incomplete · no Palm Beach rates (tax, insurance, flood, and CDD Unknown) + "Set local rates for Palm Beach County" prompt | Unavailable · no Rent search covers this area | hidden |
| #7 · 52 provisional | $389,000 · Hollywood 33019 · oceanfront condo 2/2 · 1,100 sf · 1972 · zone VE · HOA $1,150 · special assessment pending, amount unknown · milestone filed · 40-year recertification in progress · reserve study pending | Broward | at least $4,661 + special assessment · Incomplete | $2,900 · 5 local comps | hidden |

Line-by-line amounts and states are in the fixture file.

## 3. Screens

### Search (desktop `Main`, mobile `MobileSearch`)
- Buy/Rent switch, location field, saved search "Fort Lauderdale 33308 · Buy · $250k–$900k" with "Paired Rent search on · needed for local comps", removable filter chips, Sort: Your score / Newest / Price.
- Card: price, status, address, city · county, facts line; score block with rank and provisional badge; "Est. monthly to own" with its status chip; "Comparable rent" with its source line; gap row (or the hidden-gap reason); risk chips; implausible-value flag; selected card shows the score breakdown; footer with provider, last seen (stale after 7 days, highlighted), Save, Compare, Dismiss, Details & verify.
- Boca Raton card shows the "Set local rates for Palm Beach County" prompt inline.
- Map and list stay in sync; map shows county borders. Tile service is not chosen yet.
- Footer text: "Monthly costs use your personal assumptions (20% down, 6.50% 30-yr fixed, maintenance 1%/yr) and each county's local rates. Local rates shown are sample placeholders. No photos: the first candidate provider does not supply them."
- Mobile: List/Map toggle; map view shows a bottom card for the selected pin; bottom tab bar (Search, Compare, Ranking & data).

### Compare (desktop `Compare`, mobile `MobileCompare`)
- Shortlist: Fort Lauderdale (#1), Miramar (#2), North Miami (#5, provisional), Hollywood (#7, provisional).
- Header splits assumptions: "Personal: 20% down · 6.50% 30-yr · maintenance 1%/yr" and "Local: Miami-Dade (sample) · Broward (sample)", each with its own Edit link.
- Tag legend above the table.
- Rows: price, status, beds/baths/area, score; P&I, property tax, homeowners/HO-6, flood, HOA, **Non-ad valorem / CDD**, **Special assessment**, maintenance; **Total** with each column's status chip; comparable rent with source; own vs. rent; **Upfront cash** (down payment + one-time assessments); flood zone; insurance & wind mitigation; condo & association (milestone inspection, county recertification, reserve study, special assessment); notes; verify.
- "Lowest complete total" only on the lowest non-Incomplete total (Miramar).
- Mobile: two properties side by side, chosen with Left/Right selectors; same rows and rules.

### Property detail (desktop `Property`, mobile `MobileProperty`) — Fort Lauderdale 33308
- Two listings on file: for sale $849,000, for rent $5,200/mo.
- Cost breakdown, every line tagged:
  - P&I $4,293 Calc · $679,200 loan · 6.50% · 30 yr
  - Property tax $1,380 Calc · "Broward millage (sample) · set Oct 7 · from county tax collector"
  - Homeowners $610 Quote · entered Oct 5
  - Flood $180 "Est. · enter a quote"
  - HOA "N/A · no association (confirmed)"
  - Special assessments "N/A · no association (confirmed)"
  - Non-ad valorem / CDD "$0 · Doc · no CDD on tax bill"
  - Maintenance $708 Calc
  - Total $7,171 · "Estimate · needs flood quote"; gap "≈ +$1,971"; upfront cash $169,800
- **Verification checklist:** Tax bill checked ✓ · HOA confirmed none ✓ · Homeowners quote ✓ · Flood quote ☐ (the remaining item behind "Estimate"), with an "Enter flood quote" action.
- Rent panel: primary "same home · listed Sep 28"; expandable "Local comps (4)" table (address, beds, sq ft, distance, rent, last seen; median $5,225); button "Get RentCast rent estimate · 1 request · 22 left this month".
- Insurance card: roof 2020, built 1964, impact windows.
- Price history (provider history vs. local snapshots labeled), verification links (MLS #, agent, address search; the app never fetches these pages), notes, data quality.

### Ranking & data (desktop `Settings`, mobile `MobileSettings`)
- **Ranking weights** with live ranking of all 7 listings in score order, provisional badges and short reasons.
- **Personal assumptions** panel: down payment, rate, term, maintenance.
- **Local assumptions** table, one row per county: Miami-Dade, Broward, and Palm Beach ("Not set · Set local rates"). Columns: millage; typical non-ad valorem $/yr; homeowners default (house); HO-6 default (condo); flood default X / AE / VE; source and date. Every value tagged "sample".
- **Comparable-rent rules** (editable): same property type; same bedrooms; living area ±20%; radius 1 mi; seen within 30 days; minimum 3 comps. Note: "Dense Miami areas may need a smaller radius."
- **Data source & request budget:** saved searches as Buy/Rent pairs per area with measured requests per refresh (Broward 1+1, Miami 33131–33137 2+1); flagged Buy-only area "North Miami 33161 · No Rent search · local comps unavailable · Add Rent search"; "Rent estimates: +1 request each · 1 used this month"; weekly vs. daily projections against the 45 ceiling (weekly ≈ 42, daily ≈ 168 → over, needs Foundation $74/mo); over-ceiling warning.
- **Property match review:** "1500 Bay Rd, Unit 1204" (new rent listing) vs. "1500 Bay Rd (no unit)" (existing property with 1 note): Link / Keep separate / Undo.
- Backup: export/import personal data as JSON.

## 4. Mobile layout
390 px phone frames; bottom tab bar; 44 px minimum targets; no fake status bar. Compare is two-up with selectors. Property detail has a fixed bottom bar (Save, Compare, Search this address). Ranking & data uses collapsible sections. Same data and rules as desktop.

## 5. Decisions (Oct 7, 2026)
1. **CDD line in a county without local rates:** "Unknown · no [county] rates" unless the tax bill has been checked (then Doc). Adds no new Incomplete trigger; the county trigger already applies. Setting the county's rates turns it into "Est. · CDD not checked".
2. **Townhome insurance:** uses the county's house homeowners default.
3. **Status chip wording:** always "+n" for Est. lines beyond the two named; Miramar reads "Estimate · needs insurance quote, assessments not checked +1".

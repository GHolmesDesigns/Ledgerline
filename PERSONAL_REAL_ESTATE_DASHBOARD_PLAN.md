# Personal Florida Real Estate Dashboard — Planning Document

*Version: October 7, 2026 · Intended use: one person, running locally · Previous version: `PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.2026-10-06.md`*

**Changes in this version:** the provider data check now comes first (Milestone 0); provider calls happen only in a refresh job, never during browsing; properties and listings are separate records so personal data survives a provider switch; RentCast's confirmed field gaps (no photos, no source URL) are designed around; Florida cost and risk factors, rent-vs-buy comparison, and personal ranking move into the first usable version; provider pass/fail thresholds are set before testing.

**Second revision (same day), after UI draft review:** comparable rent now has defined sources, matching rules, labels, and an "Unavailable" state; every cost line shows its basis, and totals become "Estimate" or "Incomplete" instead of looking exact; rank numbers always follow score order; unknown factors and flagged listings make a score provisional; the provider test also checks whether "active" results are still available; assumptions are split into personal and local sets, with no statewide defaults; CDD fees and other non-ad valorem assessments are a separate cost line. The test market is set to Miami and Fort Lauderdale (Miami-Dade and Broward counties).

**Fourth revision (same day):** non-ad valorem lines in a county without local rates are Unknown unless the tax bill has been checked; a property's own Quote or Document always outranks county rates; townhomes use the house insurance default; Estimate labels count unnamed lines as "+n".

**Third revision (same day):** cost lines now have precise rules for when an amount is firm, an Estimate, a verified $0, Not applicable, or Unknown, so Incomplete totals are limited to four defined triggers; the provider test now has sampling, price-tolerance, not-found, rounding, per-county floor, and decision rules, so the Milestone 0 result can be reproduced.

## Goal

Create an easier way to discover and compare Florida homes for **rent or purchase**. The interface should work with realistic sample listings before any paid provider is selected. A replaceable data-source layer will allow provider trials without rebuilding the interface or losing personal notes and favorites.

### Why build this instead of using Zillow or Redfin plus a spreadsheet

Public listing sites already offer free search, maps, photos, favorites, and alerts with broad coverage. This dashboard is worth building only for what they don't do:

1. **Personal ranking:** results ordered by my own weighted criteria, not the site's.
2. **Rent vs. buy side by side:** an estimated monthly cost of owning a listed home next to comparable rents, with the source and certainty of every figure shown.
3. **Florida cost and risk in one view:** flood zone, insurance, HOA and condo assessment exposure, and a realistic post-purchase property tax estimate.
4. **Data I keep:** notes, dismissals, and observed price history that survive changing providers.

These are first-version features. If they don't hold up in use, the fallback is a public site plus a spreadsheet.

## Initial search profile

- Geography: Florida statewide. Start with a city, ZIP, or map area rather than loading the whole state at once.
- **Test market:** Miami and Fort Lauderdale, treated as two markets (Miami-Dade County and Broward County) for the provider test and for local tax, insurance, and flood assumptions. These are large, condo-heavy markets with many high-flood-risk zones, so they exercise the condo, assessment, and flood features well. Saved searches should be narrow enough (a ZIP, a radius, or tighter filters) that each returns under 500 listings per mode; a whole-city search here may take several requests per refresh.
- Modes: Buy and Rent, switched explicitly; keep separate price ranges and saved searches for each mode.
- Default results: active listings, newest updates first. Show pending/under-contract only when requested.
- Filters: location, price/rent, beds, baths, property type, minimum square footage, and optional waterfront, year built, and HOA fee when the provider supplies them.
- Personal workflow: save, dismiss, add notes, rank, compare, and open a verification link.

## Interface scope

### First usable version (Milestones 1–3)

1. **Search:** clear Buy/Rent switch; compact filters; visible filter chips; saved search profiles. Searching, filtering, and panning the map read the local database only and never spend provider requests.
2. **Results:** map and list views that stay in sync. Every card shows price, status, address, beds/baths, area, provider, and last-seen time. Cards must read well **without photos**, because the first candidate provider doesn't supply them; show photos only when a provider supplies licensed image URLs.
3. **Shortlist:** favorites, dismissed listings, personal notes, and a side-by-side comparison of up to four listings, including estimated monthly cost for purchase listings.
4. **Personal ranking:** adjustable weights for the factors I care about (see Open decisions); results can be sorted by score, and the score breakdown is visible on each card.
   - **Rank numbers (#1, #2, …) always reflect score order within the current results**, whatever sort is selected. Sorting by price or newest changes the card order, not the rank labels, so a #4 can appear at the top of a price-sorted list.
   - **Unknown factors never help a listing.** A factor with no data (for example, an own-vs-rent gap when comparable rent is unavailable or the cost total is incomplete) scores as the worst value for that factor.
   - **Provisional scores:** a score is labeled "provisional" when any factor is unknown or the listing has an implausible-value flag, with the reason shown in the score breakdown (for example "1 factor unknown: comparable rent" or "check price per sq ft").
5. **Rent vs. buy estimate:** for purchase listings, an estimated monthly cost of owning. The comparison must be usable for most listings, so **missing information with a reasonable local default is an Estimate, not Unknown.** Most totals are Estimates until I verify a shortlisted property; Incomplete is reserved for a known, material cost with no usable figure.

   **Line states:**

   | State | Meaning | Effect on the total |
   |---|---|---|
   | Listing | Amount from the provider record | Firm |
   | Calculated | From price and my assumptions | Firm |
   | Quote | A real quote I entered | Firm |
   | Document | An amount, including a verified $0, entered from a tax bill, association letter, or disclosure | Firm |
   | Not applicable | The charge cannot apply to this property | $0, firm |
   | Estimate | An unverified amount: a local default, a same-building median, or an assumed $0 not yet checked | Makes the total an Estimate |
   | Unknown | A cost known to exist, material, with no usable figure | Makes the total Incomplete |

   **Verified $0, Not applicable, or Estimate:**
   - *Not applicable* only when the charge structurally can't apply: association fees and association assessments on a property confirmed to have no association, or a flood policy I choose not to carry where it isn't required (see below).
   - *Document* $0 when the charge could exist and a document confirms it doesn't: the tax bill shows no CDD or other non-ad valorem charges, or an association letter confirms no pending assessments.
   - *Estimate* $0 when a charge is assumed absent but not yet checked. It is labeled "not checked", never shown as a verified $0.

   **Rules by cost line:**

   | Cost line | Firm when | Estimate when | Not applicable when | Unknown (total Incomplete) only when |
   |---|---|---|---|---|
   | Principal and interest | Always (Calculated) | — | — | — |
   | Property tax (millage-based) | Local millage is set (Calculated) | — | — | The county has no local rates set |
   | Non-ad valorem assessments, including CDD fees | Tax bill checked (Document, amount or $0) | Not yet checked: the county's typical non-ad valorem amount, labeled "CDD not checked" | — | The property is known to be in a CDD (listing, disclosure, or my note) and the amount isn't known; or the county has no local rates set and the tax bill hasn't been checked |
   | Homeowners (house or townhome) or HO-6 (condo) insurance | Quote | No quote: the local default for the property type (townhomes use the house default) | — | The county has no local rates set |
   | Flood insurance | Quote | No quote: the local default for the flood zone; if the zone isn't known yet, the local high-risk default | I choose not to carry it, allowed only outside FEMA high-risk zones (A and V zones), where federally backed mortgages require it | The county has no local rates set |
   | HOA / association fee | Listing amount, or Document | Condo, co-op, or townhome with no listing amount: median fee of at least 2 other units at the same street address seen in the last 12 months. Single-family with no listing amount: $0, labeled "HOA not confirmed" | Confirmed no association (Document or my own check) | Condo, co-op, or townhome with no listing amount and no same-building data |
   | Special assessments | Document (installment amount, or confirmed none) | An association exists or isn't ruled out, not yet checked: $0, labeled "assessments not checked" | The HOA line is Not applicable | An assessment is pending or approved and its amount isn't known |
   | Maintenance reserve | Always (Calculated) | — | — | — |

   A Quote or Document entry for a property always takes precedence over its county's local rates, so a verified line stays firm even where the county isn't configured. For non-ad valorem assessments the order is: Document (amount or verified $0); Unknown if a known CDD has no amount; Unknown if the county has no local rates; otherwise the county's typical amount as an Estimate labeled "CDD not checked".

   A one-time special assessment is shown as upfront cash beside the down payment, not in the monthly total; an assessment paid in installments uses the monthly installment.

   **Incomplete happens only for these triggers:** an assessment pending or approved with no amount; a known CDD with no amount; a condo, co-op, or townhome with no HOA amount from the listing or same-building data; or a county without local rates. A newly fetched single-family home in a configured county is never Incomplete. Milestone 0 measures how often condo and townhome listings lack an HOA fee, since that is the trigger most likely to be common.

   **Total status** is the weakest state among its lines (Not applicable lines are ignored):
   - All lines firm → **Calculated**.
   - Any Estimate line → **Estimate**, naming up to two lines to verify and counting the rest as "+n" (for example "Estimate · needs flood quote, CDD not checked +1"). The own-vs-rent difference is shown with "≈".
   - Any Unknown line → **Incomplete**, listing what's missing and showing the known subtotal as "at least $X". No own-vs-rent difference is shown, and the listing is not marked lowest-cost in comparisons.

   **Verification checklist** for shortlisted properties; each item moves a line from Estimate to firm: homeowners or HO-6 quote; flood quote; tax bill (non-ad valorem and CDD); association letter (fees, pending assessments, reserves); and, for single-family homes, confirmation of whether there is an HOA.

   **Assumptions come in two sets:**
   - **Personal**, one set saved with the search profile: down payment, mortgage rate and term, maintenance reserve percentage.
   - **Local**, one set per county or ZIP group, set up for each market I search: millage rate (from the county property appraiser or tax collector), typical non-ad valorem assessments, homeowners insurance default (house, also used for townhomes), HO-6 default (condo), and flood insurance defaults by flood zone.

   There are **no statewide defaults** for local figures. For a property outside every configured market, the tax, insurance, and flood lines are Unknown and the total is Incomplete, with a prominent "Set local rates for [county]" prompt. Sample values in design drafts (such as 18.5 mills) are layout placeholders only.
6. **Comparable rent:** shown beside each purchase listing's cost to own, from the first available source in this order:
   1. **Same home:** an active rental listing for the same property. Label: "same home · listed [date]".
   2. **Local comps:** active rental listings already stored from Rent-mode refreshes, so no extra requests. A comp must have the same property type and bedroom count, living area within 20%, be within 1 mile, and have been seen in the last 30 days. At least 3 comps are required; the value is their median. Label: "[n] local comps · median · within [distance]", with the comps viewable.
   3. **Provider rent estimate**, on request only, for shortlisted properties: RentCast's long-term rent estimate costs 1 request per property and counts against the request ceiling. Label: "RentCast estimate · range $[low]–$[high] · [date]".
   4. Otherwise, **Unavailable**. No rent figure is invented, and the own-vs-rent ranking factor is treated as unknown.

   Local comps only exist where a Rent-mode saved search covers the same area as the Buy-mode search, so each Buy area normally needs a matching Rent-mode search (see Request budget). Comps and estimates older than 30 days are labeled stale.
7. **Florida cost and risk fields** (per property, filled automatically where a source exists, otherwise entered by me):
   - **Flood zone** from FEMA's National Flood Hazard Layer, with a note that zone X does not mean no flood risk.
   - **Insurance:** quoted or estimated premium; roof age, year built, and wind-mitigation features (such as impact windows or shutters), which strongly affect insurability and cost.
   - **Condo association status:** milestone inspection and reserve-study status, recent or pending special assessments (amount, or "pending, amount unknown"), and rental or approval restrictions, entered from association documents. Florida's post-2021 condo safety laws have led to large special assessments at some older buildings. Miami-Dade and Broward also run their own building recertification programs; record that status too.
   - **Property tax estimate** based on the purchase price and the local millage rate, not the current owner's bill (see County property appraiser below).
   - **Non-ad valorem assessments, including CDD fees:** charges billed with property taxes but not based on millage, such as Community Development District fees, which are common in newer Florida communities and can be substantial. Taken from the property's tax bill or disclosures; until then, the county's typical amount is used as an Estimate labeled "CDD not checked" (see the rules by cost line).
8. **Trust cues:**
   - Flag missing fields and implausible values (for example: price per square foot far outside the area's range, 0 bedrooms on a single-family house, coordinates outside Florida). A flagged listing's score is provisional until I confirm or correct the value.
   - Label stale results using two timestamps: the provider's last-seen date (stale after 7 days by default) and my last local refresh (stale after the saved search's refresh interval).
   - **Verification links:** the provider's source URL when supplied; otherwise the MLS number and listing agent/office contact when supplied, plus an address search link I can click to check availability manually. The app never fetches those pages itself.
9. **Observed price and status history:** each refresh stores a snapshot of price and status, plus the provider's own history when supplied (RentCast includes a `history` field). Stored within the provider's retention terms.
10. **Local storage:** properties, listings, snapshots, rent figures, assumption sets, cost entries, search profiles, favorites, dismissals, and notes in a local SQLite database. Export/import personal data as JSON for backup.
11. **Accessibility:** keyboard navigation, clear labels, legible status colors, and a responsive layout.

### Later, after source validation

- Price-change alerts, if the provider permits and supports them.
- Selected county parcel and tax data integration, beyond links (see County property appraiser below).
- Travel-time or neighborhood overlays, each with its own data and cost review.
- A second simultaneous listing feed, with cross-provider de-duplication on top of the property matching that already exists in v1.

## Architecture and replaceable source layer

A local browser-based web app (for example, a React frontend and a small local API). The key rule: **the interface reads only from the local database; only the refresh job calls a provider.**

```text
Search UI ──> Query service ──> local SQLite
                                 ├─ properties   (stable local ID, normalized address + unit)
                                 ├─ listings     (provider record, mode, price, status, dates) + snapshots
                                 └─ personal     (notes, favorites, dismissals, saved searches, ranking weights)
                                        ▲
Refresh job ──> ListingProvider interface ──> Mock / RentCast / future provider
  (manual or scheduled per saved search; enforces the request ceiling; logs usage)
```

The refresh job runs each saved search against the provider, maps the results to the normalized model, matches them to properties, and stores a snapshot. Because browsing never calls the provider, request usage depends only on the number of saved searches and how often they refresh. Cached results remain viewable offline.

The provider interface supports `search(criteria, page)`, `getListing(sourceId)`, an optional `estimateRent(property)`, and a capability declaration listing which optional fields, filters, and methods it supplies (photos, source URL, waterfront, full/half bath split, history, HOA fee, rent estimates). `estimateRent` is called only when I request it for a shortlisted property, and it goes through the same request ceiling as the refresh job. The UI must not use provider-specific field names. Search results already contain full listing records, so `getListing` is used only to refresh a single shortlisted listing on request, never when a card is opened. A mock provider is the default during interface development; a real adapter maps external responses to the same normalized model.

### Data model: properties vs. listings

The same Florida home is often listed for sale and for rent at the same time, relisted after expiring, or listed by unit within a condo building. Personal data belongs to the **property**; price and status belong to the **listing**.

- **Property:** stable local ID; normalized address (street, unit, city, ZIP); coordinates; property type; beds; baths (total, plus full/half split when known); living area; lot size; year built; parcel ID when known; Florida cost and risk fields. Notes, favorites, dismissals, and ranking inputs are keyed here.
- **Listing:** internal ID; property ID; provider and provider ID; MLS name and number when supplied; sale/rent mode; price and price period; status; HOA fee; image URLs where supplied and licensed; source URL when supplied; listing agent and office contact when supplied; provider's listed/removed/last-seen dates; local first-fetched and last-fetched times; per-field quality flags.
- **Snapshot:** listing ID, fetch time, price, status.
- **Rent figure:** property ID; source (same home, local comps, or provider estimate); value and range; comp count and maximum distance; IDs of the comps used; calculated or fetched time.
- **Assumption sets:** one personal set per search profile; one local set per county or ZIP group (millage, typical non-ad valorem assessments, insurance and flood defaults), each with its source and the date it was set.
- **Cost entries:** per property, the figures and checks I enter (quotes, CDD and other assessments, special assessments, HOA confirmation, flood-policy choice, roof age), each with its state (including verified $0 and Not applicable), source, and date.
- **Raw payload:** stored separately for debugging, subject to the provider's retention terms.

**Property matching is part of v1**, because personal data surviving a provider switch depends on it. On import, normalize addresses (standard street suffix and unit designator abbreviations, case, and punctuation). An exact match on normalized address and unit links automatically. Ambiguous cases (same street address with a missing or different unit, or nearby coordinates with a different address) go to a review queue instead of being merged or duplicated silently.

### Security and cost controls

- Provider credentials remain on the local server, never in browser code or Git.
- A configurable monthly request ceiling is enforced in the app. A refresh that would exceed it is blocked and shown, because the provider may permit unlimited overages.
- Display request usage, the projected monthly total, and the timestamp of the latest successful refresh.
- Store results only within the provider's terms.

**Request budget:** one refresh of one saved search usually costs one request (RentCast returns up to 500 listings per request), plus one more per additional 500 results. Because local comparable rents come from Rent-mode data, each Buy area normally has a matching Rent-mode search, so saved searches come in pairs. The refresh interval therefore decides the plan tier:

| Setup | Requests/month (approx.) | RentCast tier |
|---|---:|---|
| 4 saved searches (one Miami-Dade and one Broward area × Buy and Rent), weekly refresh | ~17 | Developer (free, 50 included) |
| Same 4 saved searches, daily refresh | ~120 | Foundation ($74/month, 1,000 included) |
| 8 saved searches, daily refresh, some over 500 results | ~300 | Foundation |
| Provider rent estimates, on request | +1 per shortlisted property | Counts toward the same ceiling |

The table assumes each saved search returns under 500 listings. Whole-city searches in Miami or Fort Lauderdale may return several pages per refresh, so Milestone 0 records how many requests a typical search in each county actually takes, and the budget is recalculated from that.

## Data-source providers and costs

Plan prices below are published USD prices checked on **October 6, 2026**; RentCast's field list and billing terms were rechecked on **October 7, 2026**. Prices can change, and provider coverage in Florida has **not yet been tested**. "Cost" here excludes taxes, mapping services, optional enrichment, and hosting (the first version runs locally).

| Source | Role and fit | Published cost | Decision |
|---|---|---:|---|
| [RentCast API](https://www.rentcast.io/api) | Candidate primary feed. Separate sale and long-term rental listing searches with address, coordinates, property fields, HOA fee, status, listed/removed/last-seen dates, MLS name and number, listing agent and office contacts, and listing history; up to 500 listings per request. **Not included:** photos, a source listing URL, or a waterfront field; bathrooms come as a single decimal (for example 2.5), not a full/half split. Its [listing documentation](https://developers.rentcast.io/reference/property-listings) says data is not retrieved directly from MLS. Also offers a [long-term rent estimate](https://developers.rentcast.io/reference/rent-estimate-long-term) that returns an estimate, a range, and 5–25 comparable rentals with distance and last-seen date; each call is a request. | Developer: **$0/month, 50 requests**, then **$0.20/request**. Foundation: **$74/month, 1,000 requests**, then **$0.06/request**. Growth: **$199/month, 5,000 requests**, then **$0.03/request**. Scale: **$449/month, 25,000 requests**, then **$0.015/request**. | Test first on the free tier in Milestone 0. Its documentation says there are no hard usage caps, so enforce one locally. [Pricing/billing](https://developers.rentcast.io/reference/billing-and-pricing). |
| [Repliers](https://repliers.com/) | MLS-centered search API and UI tooling; useful comparison of capability, but its own FAQ says users need to be licensed real estate agents. | Preview with sample data **$0/month**; Standard **$199/month**, Professional **$299/month**, Advanced **$399/month** on monthly billing. MLS agreements may also be required. | Not a primary route for this personal, broker-independent project unless eligibility changes. |
| [ATTOM Developer Platform](https://api.developer.attomdata.com/dlpv2docs) | Potential property-record or valuation enrichment, not selected as the live listing feed. | Public self-service price for this exact use was **not verified**; obtain a quote before considering it. | Defer until a specific missing data need is proven. |
| [FEMA National Flood Hazard Layer](https://www.fema.gov/flood-maps/national-flood-hazard-layer) | Flood zone for a property's coordinates, via FEMA's GIS web services or the Flood Map Service Center address search. Flood zones do not capture all flood risk. | Free. | Use in v1 for shortlisted properties; confirm the web service's usage terms before automating lookups. |
| Florida county property appraiser, tax collector, and parcel sites (Miami-Dade and Broward first) | Parcel, tax, assessed value, millage rates, and ownership context for shortlisted properties. The tax bill also lists non-ad valorem assessments, such as CDD fees, which a millage calculation misses. These records do not establish live sale/rental availability. Availability and reuse methods vary by county. **Caution:** the current owner's tax bill usually reflects the homestead exemption and the Save Our Homes assessment cap; assessed value resets after a sale, so a buyer's bill can be much higher. Estimate taxes from the purchase price and the local millage rate instead. | Public lookup may be free; bulk/API access and permitted reuse must be checked county by county. | Add as source links first; integrate specific counties only after verifying access terms. |

RentCast's separate consumer "Pro" subscription is **not** its API subscription. The dashboard would use the API plan above. Avoid treating public real-estate websites as an automated feed: [Zillow](https://www.zillow.com/corporate/terms-of-use/) and [Realtor.com](https://www.realtor.com/terms-of-service/) restrict automated extraction and reuse. They remain useful for manual verification through links I click myself.

## Provider evaluation, before interface development

The data source is the biggest risk, and the free tier makes testing it cost nothing, so it comes first.

1. Choose one search area in each test-market county (Miami-Dade and Broward), such as a ZIP or a radius. Get a free RentCast API key.
2. Spend at most 40 of the 50 free requests (keep 10 in reserve) on sale and rental searches in those areas, including up to 5 rent-estimate calls on sample properties to compare against local comps. Save the raw responses locally within the provider's terms. Record which fields are actually populated (HOA fee, MLS number, agent contact, history), how often condo and townhome sale listings lack an HOA fee, and how many requests a typical search in each county takes.
3. **Coverage check (public → provider).** Within 24 hours of the provider pull, run the same area and filters on one public listing site. Number its active results in the order shown, remove duplicates and listings first published less than 48 hours before the pull (normal feed lag), and pick **10 per county and mode** with a random number generator, recording the seed.
   - **Found:** the provider's pulled data has the same property (normalized address and unit) in the same mode, in any status. Status and price are then compared separately.
   - A provider record with no unit counts as found only if beds and living area match the public listing; otherwise it is **not found**.
4. **Still-available check (provider → public).** Within 24 hours of the pull, have the app pick **10 of the provider's "active" results per county and mode** at random, recording the seed. Look each up by address, unit, and MLS number on at least two public listing sites and classify it:
   - **Available:** shown as active on a public site and not under contract.
   - **Not available:** pending, under contract, sold, rented, withdrawn, or expired.
   - **Not found:** no current listing on either site. **Counts as not available**, because the dashboard would send me after something I can't act on.
   - **Ambiguous:** can't tell which property or unit the record refers to. Counts as not available.

   No sampled listing is skipped or replaced.

   Steps 3 and 4 total 80 manual checks (10 × 2 counties × 2 modes × 2 directions). Record each in a sheet with: county, mode, direction, seed, address, unit, provider ID, public status, provider status, public price, provider price, classification, and time checked. The sheet is kept with the decision so the result can be re-scored.
5. **Scoring rules**, set now, before seeing results:
   - **Status agrees** when both sides fall in the same group: *Active*; *Under contract* (pending, contingent, accepting backup offers); *Off market* (sold, rented, withdrawn, expired).
   - **Price agrees** when the provider's price is within **1%** of the public price, in both modes. A larger gap, including a price change the provider hasn't picked up, is a disagreement.
   - Beds, baths, and HOA fee are recorded as field-quality notes, not scored.
   - **Required counts round up:** required = ceiling(threshold × number checked).
   - **Granularity:** 10 listings per county and mode is too small to judge each cell on a fine threshold, so sampled measures are judged **per mode with both counties pooled (20 listings)**, plus a **floor in each county-and-mode cell** so one county can't fail badly while hidden by the other. Measures computed over all pulled listings have enough data to be judged **in every county-and-mode cell**.

   | Measure | Computed over | Pass (per mode, counties pooled) | Floor (each county and mode) |
   |---|---|---|---|
   | Coverage | 20 sampled public listings | ≥ 16 found (80%) | ≥ 7 of 10 |
   | Still available | 20 sampled provider "active" results | ≥ 17 available (85%) | ≥ 8 of 10 |
   | Status agrees | Listings found in step 3 | ≥ 90% | — |
   | Price agrees, within 1% | Listings found in step 3 | ≥ 90% | — |
   | Freshness: last seen within 7 days | All pulled active listings | — | ≥ 90% in each cell |
   | Verification: MLS number or agent contact | All pulled active listings | — | ≥ 75% in each cell |

   **Borderline rule:** if a pooled sampled measure misses its required count by exactly one listing, check 10 more for that mode and direction (5 per county, new random picks) and judge on all 30 at the same percentage. This happens at most once per measure.
6. Decide explicitly whether a dashboard **without photos** is acceptable, given verification links to public pages.

**Decision rules:**

| Result | Decision |
|---|---|
| Every measure passes, in both modes, with every floor met | Go: build Milestones 1–3 on RentCast |
| Buy passes everything; Rent fails | Go for purchase listings. Rent-mode data may still feed local comps (a listing that has since been rented still shows market rent), but Rent-mode search is not relied on for finding rentals |
| One county fails a floor or a per-cell measure in a mode; the other county passes everything in that mode | Go in the passing county for that mode only, or test another provider for the failing county |
| Buy fails | The rent-vs-buy comparison needs purchase listings: test another provider, or fall back to **manual-add mode** (listings found elsewhere are entered by address; ranking, notes, rent-vs-buy, and Florida cost features still apply without a feed) |

**Synthetic fixtures:** after Milestone 0, build 30–50 synthetic Miami-Dade and Broward fixtures **shaped like the real responses**, covering:
- sale and rent; houses, and high-rise and older condos with units
- the same property listed for sale and rent at once
- status and price changes; missing fields; implausible values
- duplicate addresses and an ambiguous unit match
- flood zones X, AE, and VE
- a condo with a special assessment pending and no amount
- a purchase listing with fewer than 3 local rent comps
- a property outside the configured markets, with no local rates set
- a home in a CDD
- a single-family home with no HOA data (an Estimate total, not Incomplete)
- a condo with no HOA fee in its record but other units listed in the same building
- a verified $0 (tax bill shows no CDD) and a Not applicable line (no association)

(The current UI draft uses Tallahassee sample data; switch its samples to these.)

**Exit criterion:** the interface works fully with mock data; a real adapter can be swapped in by configuration; personal data survives the switch (tested with a property present in both the mock and live data); and the provider evaluation reports observed Florida results against the thresholds and actual request usage.

## Delivery milestones

| Milestone | Deliverable | Acceptance check |
|---|---|---|
| 0. Data check | Free-tier sample in Miami-Dade and Broward; populated-field inventory; requests per typical search; coverage and still-available checks; photo decision | Every measure scored with the scoring rules; decision taken from the decision table; record sheet and random seeds saved; request budget recalculated; $0 spent |
| 1. Interface and persistence | Buy/Rent search, map/list, shortlist, notes, comparison, saved searches, property/listing model with matching and review queue, JSON export/import, all on mock data in SQLite | Complete core flow without an external account or API call; restart the app and recover all personal state |
| 2. Refresh job and provider adapter | RentCast adapter behind `ListingProvider`, refresh job, snapshots, credentials stored locally, request ceiling and usage display | Same UI works with mock or live source by configuration; an over-budget refresh is blocked; notes survive switching from mock to live |
| 3. Florida cost and ranking | Rent-vs-buy estimate with basis labels, comparable rent sources, personal and local assumption sets, FEMA flood zone lookup, tax and CDD lines, insurance and condo fields, personal ranking weights | Every cost line and rent figure shows its state or source; a newly fetched single-family home in a configured county shows an Estimate total, never Incomplete; Incomplete appears only for the four defined triggers, with no own-vs-rent gap; fewer than 3 comps shows Unavailable; a property outside configured markets prompts for local rates; changing a weight reorders results; rank numbers match score order under every sort; unknown factors and flagged listings show provisional scores |
| 4. 30-day review | Actual requests vs. budget, stale rate, coverage gaps found in use | Decide to keep, upgrade the tier, replace, or supplement the provider |

## Decisions made

- **Local form:** browser-based app on this computer, not a packaged desktop app.
- **Offline:** cached results, history, and personal data are viewable offline; refreshing requires a connection.
- **Provider evaluation comes first** (Milestone 0), with thresholds, scoring rules, and decision rules fixed above.
- **Test market:** Miami and Fort Lauderdale (Miami-Dade and Broward counties).
- **No statewide cost defaults:** local tax, insurance, and flood figures are set per county or ZIP group.

## Open decisions

- **Search areas within the test market:** which ZIPs, radius, or neighborhoods in Miami-Dade and Broward, and the Buy price range and Rent budget for each. Needed before Milestone 0.
- **Refresh interval:** weekly fits the free tier; daily needs the $74/month Foundation tier (see Request budget). Recheck after Milestone 0 measures actual requests per search.
- **Ranking factors and weights:** which matter most beyond price and location (for example HOA fee, flood zone, insurance estimate, waterfront, parking, pets, lease term).
- **Personal assumptions:** down payment, mortgage rate and term, maintenance reserve percentage.
- **Local assumptions for Miami-Dade and Broward:** millage rate, typical non-ad valorem assessments, and homeowners and flood insurance defaults by zone. Insurance and flood defaults are best taken from one or two real quotes, since South Florida premiums vary widely.
- **Comparable-rent rules:** the defaults above (same type and bedrooms, area within 20%, within 1 mile, seen in 30 days, at least 3 comps) may need a tighter radius in dense Miami neighborhoods; adjust after Milestone 0.
- **Photo-less results:** decided at the end of Milestone 0.

# Provider evaluation: RentCast (Milestone 0)

**Result, recorded 2026-10-08.** RentCast passes every measure and floor for **purchase listings** in Miami-Dade and Broward. For **rentals** it fails the still-available measure (15 of 20, where 17 are required; Broward 7 of 10, where 8 are required). Decision-table **row 2**: go for purchase listings; Rent-mode search is not relied on for finding rentals. A dashboard without photos is **not acceptable**. Total spend is $0.

Follows plan version 2.6 (Provider evaluation, steps 1–6; Request budget). This doc holds counts, seeds, and rules only. No listing address, unit, or provider ID appears here. The record sheets and raw responses stay on Garnie's computer (`tools/rentcast-sample/local/`, git-ignored), and `node tools/rentcast-sample/cli.mjs score` re-scores them.

| Part | Result |
|---|---|
| Buy (both counties) | Every measure and floor passes |
| Rent | Still available fails (pooled and Broward floor); everything else passes |
| Decision-table row | 2, taken by Garnie (row 3 also matched; see Decision) |
| Photos | A dashboard without photos is not acceptable |
| Requests and spend | 15 of 50 free requests; $0 |
| Request budget | Recalculated: weekly ~22 a month, daily ~150 |

## Pull

Pulled on 2026-10-07 between 17:29:30 and 17:29:37 UTC with the free-tier key. Every search used `status=Active` and `limit=500`.

| County | Area | Mode | Filter | Active listings | Requests |
|---|---|---|---|---:|---:|
| Broward | ZIP 33009 | Buy | $250,000–$400,000 | 345 | 1 |
| Broward | ZIP 33009 | Rent | $1,500–$4,000 | 664 | 2 (500 + 164) |
| Miami-Dade | ZIP 33138 | Buy | $200,000–$400,000 | 73 | 1 |
| Miami-Dade | ZIP 33138 | Rent | $1,500–$4,000 | 159 | 1 |

Earlier runs the same day used narrower price filters and are kept locally but not scored. They show how much the filter matters: Broward Rent at $1,500–$2,500 returned 426 listings in 1 request, and at $1,500–$4,000 it returned 664 in 2.

**Requests used: 15 of the cap of 40** (and of the 50 included): 1 refused because the key had no active subscription yet (counted, though RentCast does not bill errors), 4 for the first pull, 5 rent estimates, and 5 for the pull scored here. **Spend: $0**, confirmed by Garnie on RentCast's billing page.

The checks were recorded on 2026-10-07 between 18:51 and 23:47 UTC, about 1 h 20 min to 6 h 20 min after the pull, inside the plan's 24 hours. The search areas and price ranges are the Milestone 0 sample; the plan still lists the product's search areas as an open decision.

## Measures

Required counts round up: required = ceiling(threshold × number checked). Sampled measures are judged per mode with both counties pooled (20 listings), plus a floor in each county and mode (10 listings). Freshness and verification are judged in every county-and-mode cell over all pulled active listings.

### Pooled, per mode

| Measure | Mode | Count | Required | Result |
|---|---|---:|---:|---|
| Coverage (≥ 80%) | Buy | 18 of 20 | 16 | Pass |
| Still available (≥ 85%) | Buy | 18 of 20 | 17 | Pass |
| Status agrees (≥ 90% of found) | Buy | 18 of 18 | 17 | Pass |
| Price agrees, within 1% (≥ 90% of found) | Buy | 18 of 18 | 17 | Pass |
| Coverage (≥ 80%) | Rent | 17 of 20 | 16 | Pass |
| Still available (≥ 85%) | Rent | 15 of 20 | 17 | **Fail** |
| Status agrees (≥ 90% of found) | Rent | 17 of 17 | 16 | Pass |
| Price agrees, within 1% (≥ 90% of found) | Rent | 17 of 17 | 16 | Pass |

Still available (Rent) misses by two, so the borderline rule (which needs a miss of exactly one) does not apply.

### Floors, each county and mode

| Measure | County | Mode | Count | Required | Result |
|---|---|---|---:|---:|---|
| Coverage (≥ 70%) | Broward | Buy | 8 of 10 | 7 | Pass |
| Coverage (≥ 70%) | Miami-Dade | Buy | 10 of 10 | 7 | Pass |
| Still available (≥ 80%) | Broward | Buy | 9 of 10 | 8 | Pass |
| Still available (≥ 80%) | Miami-Dade | Buy | 9 of 10 | 8 | Pass |
| Coverage (≥ 70%) | Broward | Rent | 9 of 10 | 7 | Pass |
| Coverage (≥ 70%) | Miami-Dade | Rent | 8 of 10 | 7 | Pass |
| Still available (≥ 80%) | Broward | Rent | 7 of 10 | 8 | **Fail** |
| Still available (≥ 80%) | Miami-Dade | Rent | 8 of 10 | 8 | Pass |

### All pulled active listings, each county and mode

| Measure | County | Mode | Count | Required | Result |
|---|---|---|---:|---:|---|
| Freshness: last seen within 7 days (≥ 90%) | Broward | Buy | 345 of 345 | 311 | Pass |
| | Broward | Rent | 664 of 664 | 598 | Pass |
| | Miami-Dade | Buy | 73 of 73 | 66 | Pass |
| | Miami-Dade | Rent | 159 of 159 | 144 | Pass |
| Verification: MLS number or agent contact (≥ 75%) | Broward | Buy | 345 of 345 | 259 | Pass |
| | Broward | Rent | 633 of 664 | 498 | Pass |
| | Miami-Dade | Buy | 73 of 73 | 55 | Pass |
| | Miami-Dade | Rent | 143 of 159 | 120 | Pass |

### Seeds

| Check | Mode | County | Seed |
|---|---|---|---|
| Still available (provider → public) | Buy and Rent | both | 76915740 |
| Coverage (public → provider) | Buy | Broward | 28160907 |
| Coverage (public → provider) | Buy | Miami-Dade | 28160908 |
| Coverage (public → provider) | Rent | Miami-Dade | 28160909 |
| Coverage (public → provider) | Rent | Broward | 28160910 |

### What the sampled checks found

- **Still available:** of the 40 picks, 33 were Available. The 7 that were not: 2 in Buy (one per county) and 5 in Rent (Broward 3, Miami-Dade 2). Their public status was Off market for 5 and Under contract for 1; 1 was Ambiguous (counts as not available). None was Not found.
- **Coverage:** 35 of the 40 public listings were found (Buy 18, Rent 17). The 5 not found: Broward Buy 2, Broward Rent 1, Miami-Dade Rent 2.
- **Status and price:** all 35 found listings were Active on both sides, and all 35 prices matched exactly.

### Sampling notes

- **The coverage sample came from one public site (Redfin, per Garnie's notes).** One Broward Buy pick had a withheld address, so it could not be matched, and it was recorded as Not found. The Buy result does not depend on it. As recorded, Buy coverage is 18 of 20 (16 required). If that pick were counted as found it would be 19 of 20, and if it were left out, 18 of 19 (16 required either way). The Broward floor passes in all three cases.
- **Redfin's result ordering shifted while the picks were being made.** The seeds are recorded, but the original result positions cannot be fully replayed, so the coverage picks can be re-scored from the sheet and not re-drawn.
- **Status agreement cannot fail in this design.** The pull holds active listings only, and the coverage sample was drawn from the public site's active results, so a found listing is Active on both sides unless it changed within hours. The 100% is a property of the sampling, not evidence about RentCast's status tracking. The still-available check is the one that tests staleness, and it is the one Rent fails.

I re-ran `score` on 2026-10-08 against the same raw responses and got identical output. I also recounted Still available (Rent) straight from the sheet's classifications, without `score`: Available 7 in Broward and 8 in Miami-Dade, 15 of 20.

## Field quality (not scored)

Shares of active listings, from the same pull.

| County | Mode | HOA fee | MLS number | History | Condo and townhome sale listings with no HOA fee |
|---|---|---:|---:|---:|---:|
| Broward | Buy | 327 of 345 (94.8%) | 345 of 345 | 345 of 345 | 11 of 336 (3.3%) |
| Broward | Rent | 21 of 664 (3.2%) | 633 of 664 (95.3%) | 664 of 664 | not measured |
| Miami-Dade | Buy | 66 of 73 (90.4%) | 73 of 73 | 73 of 73 | 4 of 70 (5.7%) |
| Miami-Dade | Rent | 2 of 159 (1.3%) | 143 of 159 (89.9%) | 159 of 159 | not measured |

In every cell, an agent or office contact was present on exactly the same listings as an MLS number. The plan treats HOA fee, beds, and baths as field-quality notes, not scored; only HOA fee is tabulated here, and beds and baths are not. Five rent estimates were run and are saved locally; they are not scored here, and the comparable-rent radius was not measured.

## Request budget, recalculated

Measured: one refresh of the four searches above costs **5 requests** (Broward Rent takes 2, the other three take 1). That is 1.25 requests per search on average.

| Setup | Plan said | Measured | RentCast tier |
|---|---:|---:|---|
| 4 saved searches (one area per county × Buy and Rent), weekly refresh | ~17 | **~22** (5 × 4.3) | Developer (free, 50 included) |
| Same 4 searches, daily refresh | ~120 | **~150** (5 × 30) | Foundation ($74/month, 1,000 included) |
| 8 saved searches, daily refresh, some over 500 results | ~300 | **~300** (8 × 1.25 × 30), if the other four resemble these | Foundation |
| Provider rent estimates, on request | +1 per shortlisted property | unchanged | Same ceiling |

The plan's Request budget table carries these numbers (version 2.5). Row 2 keeps Rent-mode data for local comps, so the Buy/Rent saved-search pairs are still needed and the budget stands. Weekly fits the free tier with about 28 requests a month to spare for rent estimates, and daily needs Foundation. The count is sensitive to the filter: widening Broward Rent's price band is what pushed it past 500 listings. A whole-city search would take several requests per refresh.

**Recommended refresh interval: weekly.** That is a recommendation from the request math. The decision above is taken, so the plan's open decision can now be settled, and it stays Garnie's.

## Photos

**A dashboard without photos is not acceptable** (Garnie, 2026-10-08), given a verification link to a public page for each listing. RentCast returns no photos, so where photos come from is an open decision in the plan. Cards must still read well without them, as the plan, `AGENTS.md`, and acceptance check 1.7 already require. The decision table has no photo condition, so the Go below is for listing data only.

## Decision

Decision-table row **2**: *Buy passes everything; Rent fails → go for purchase listings. Rent-mode data may still feed local comps, but Rent-mode search is not relied on for finding rentals.*

- **Buy:** go for purchase listings in both counties. The rent-vs-buy comparison needs them.
- **Rent:** Rent-mode search is not relied on for finding rentals in either county. Rent-mode data still feeds local comparable rents, since a listing that has since been rented still shows market rent.
- **Row 3 also matched** (*one county fails a floor or per-cell measure while the other passes: go in the passing county for that mode only, or test another provider for the failing county*): Broward fails its Rent floor while Miami-Dade passes its floors, with Miami-Dade at exactly the minimum (8 of 10). A pooled Rent measure also fails, and the plan does not say whether row 3 still applies then. The plan gives no precedence between rows 2 and 3. Garnie took row 2.
- **How the interface treats Rent mode** (the Buy/Rent switch, Rent-mode saved searches) is not settled by this and is an open decision in the plan.

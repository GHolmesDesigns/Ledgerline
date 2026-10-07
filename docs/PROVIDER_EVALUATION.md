# Provider evaluation: RentCast (Milestone 0)

**Status: draft.** The pull is done and its measures are scored below. The 80 manual checks are not recorded yet, so four of the six measures, the decision, and the photo-less decision are pending. Nothing in a pending section is an estimate; it is blank on purpose.

Follows plan version 2.4 (Provider evaluation, steps 1–6; Request budget). This doc holds counts, seeds, and rules only. No listing address, unit, or provider ID appears here. The record sheets and raw responses stay on Garnie's computer (`tools/rentcast-sample/local/`, git-ignored), and `node tools/rentcast-sample/cli.mjs score` re-scores them.

| Part | State |
|---|---|
| Pull, areas, filters, requests used | Done |
| Freshness and verification (all pulled active listings) | Scored: all eight cells pass |
| Coverage, still available, status agrees, price agrees | **Pending**: 0 of 80 checks recorded |
| Decision-table row | **Pending** |
| Photo-less decision | **Pending** (Garnie's call) |
| Request budget recalculated | Done below; the plan's table is not edited yet |

The plan wants steps 3 and 4 done within 24 hours of the pull. The pull finished at 2026-10-07 17:29 UTC (1:29 pm EDT), so the window closes at 2026-10-08 17:29 UTC. If it closes first, the doc must say so and the pull must be repeated (25 requests remain under the cap of 40; one full refresh of the four searches costs 5).

## Pull

Pulled on 2026-10-07 between 17:29:30 and 17:29:37 UTC with the free-tier key. Every search used `status=Active` and `limit=500`.

| County | Area | Mode | Filter | Active listings | Requests |
|---|---|---|---|---:|---:|
| Broward | ZIP 33009 | Buy | $250,000–$400,000 | 345 | 1 |
| Broward | ZIP 33009 | Rent | $1,500–$4,000 | 664 | 2 (500 + 164) |
| Miami-Dade | ZIP 33138 | Buy | $200,000–$400,000 | 73 | 1 |
| Miami-Dade | ZIP 33138 | Rent | $1,500–$4,000 | 159 | 1 |

Earlier runs the same day used narrower price filters and are kept locally but not scored. They show how much the filter matters: Broward Rent at $1,500–$2,500 returned 426 listings in 1 request, and at $1,500–$4,000 it returned 664 in 2.

**Requests used: 15 of the cap of 40** (and of the 50 included): 1 refused because the key had no active subscription yet (counted, though RentCast does not bill errors), 4 for the first pull, 5 rent estimates, and 5 for the pull scored here. **Spend: expected $0**, since 15 is inside the 50 included requests; confirm on RentCast's billing page before closing the card.

The search areas and price ranges are still an open decision in the plan. Those above are what was run, not a decision.

## Measures

### Scored from the pull

Judged in every county-and-mode cell over all pulled active listings. Required = ceiling(threshold × listings).

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

I recounted these straight from the raw responses with a separate script, and it matched the report.

### Pending: the 80 manual checks

Each is judged per mode with both counties pooled (20 listings), plus the floor in each county and mode (10 listings). Required counts round up. A pooled measure that misses by exactly one gets 10 more checks, once.

| Measure | Pass (per mode, pooled) | Floor (each county and mode) | Recorded |
|---|---|---|---|
| Coverage (public → provider) | ≥ 16 of 20 | ≥ 7 of 10 | 0 of 40 |
| Still available (provider → public) | ≥ 17 of 20 | ≥ 8 of 10 | 0 of 40 (sheet picked, seed 76915740, nothing classified) |
| Status agrees | ≥ 90% of listings found | none | waits for coverage |
| Price agrees, within 1% | ≥ 90% of listings found | none | waits for coverage |

Seeds: still available, 76915740 (Buy and Rent, both counties). Coverage: none yet.

## Field quality (not scored)

Shares of active listings, from the same pull.

| County | Mode | HOA fee | MLS number | History | Condo and townhome sale listings with no HOA fee |
|---|---|---:|---:|---:|---:|
| Broward | Buy | 327 of 345 (94.8%) | 345 of 345 | 345 of 345 | 11 of 336 (3.3%) |
| Broward | Rent | 21 of 664 (3.2%) | 633 of 664 (95.3%) | 664 of 664 | not measured |
| Miami-Dade | Buy | 66 of 73 (90.4%) | 73 of 73 | 73 of 73 | 4 of 70 (5.7%) |
| Miami-Dade | Rent | 2 of 159 (1.3%) | 143 of 159 (89.9%) | 159 of 159 | not measured |

In every cell, an agent or office contact was present on exactly the same listings as an MLS number. The plan treats HOA fee, beds, and baths as field-quality notes, not scored; only HOA fee is tabulated here, and beds and baths are not tabulated yet. Five rent estimates were run and are saved locally; they are not scored here.

## Request budget, recalculated

Measured: one refresh of the four searches above costs **5 requests** (Broward Rent takes 2, the other three take 1). That is 1.25 requests per search on average.

| Setup | Plan said | Measured | RentCast tier |
|---|---:|---:|---|
| 4 saved searches (one area per county × Buy and Rent), weekly refresh | ~17 | **~22** (5 × 4.3) | Developer (free, 50 included) |
| Same 4 searches, daily refresh | ~120 | **~150** (5 × 30) | Foundation ($74/month, 1,000 included) |
| 8 saved searches, daily refresh, some over 500 results | ~300 | **~300** (8 × 1.25 × 30), if the other four resemble these | Foundation |
| Provider rent estimates, on request | +1 per shortlisted property | unchanged | Same ceiling |

The conclusion in the plan's open decision holds: weekly fits the free tier with about 28 requests a month to spare for rent estimates, and daily needs Foundation. The measure is sensitive to the filter: widening Broward Rent's price band is what pushed it past 500 listings. A whole-city search would take several requests per refresh.

**Recommended refresh interval: weekly.** That is a recommendation. The plan's open decision stays open until Garnie takes it, and it only matters if the decision below is a Go.

## Photo-less decision

Pending. RentCast returns no photos. Garnie decides whether a dashboard without photos is acceptable, given a verification link to a public page for each listing.

## Decision

Pending the manual checks. The matching row of the plan's decision table goes here, with the counts that led to it.

## To finish this doc

1. Do the 80 checks and fill the record sheets (`tools/rentcast-sample/README.md`, "Record sheets and scoring").
2. Run `node tools/rentcast-sample/cli.mjs score`, and paste its tables over the "Pending" tables above, with the seeds.
3. Name the decision-table row, record the photo-less decision, and set the refresh interval.
4. Update the plan where these settle its open decisions (refresh interval, photo-less results, comparable-rent radius if measured), apply its bump rule, move `planVersion` in `fixtures/sample-data.json` with it, and run `node fixtures/check-fixtures.mjs`.

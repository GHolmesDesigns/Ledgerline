# Acceptance checks — Milestones 1–3

*Follows `PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.md` version 2.6.*

Run against the mock provider loaded from `fixtures/sample-data.json`. Each check names its expected result. A milestone is done when all of its checks pass and `node fixtures/check-fixtures.mjs` exits 0.

## Milestone 1 — interface and persistence

| # | Check | Expected |
|---|---|---|
| 1.1 | Load the app with no provider credentials | Full Search, Compare, Property, and Ranking & data flow works; no network call to a provider |
| 1.2 | Search, filter, sort, pan the map | Zero provider requests logged |
| 1.3 | Save, dismiss, add a note; restart the app | All personal state returns |
| 1.4 | Fort Lauderdale sale and rent listings | Shown as one property with two listings; notes attach to the property |
| 1.5 | Import "1500 Bay Rd, Unit 1204" with "1500 Bay Rd (no unit)" on file | Goes to the review queue; not merged or duplicated silently |
| 1.6 | Export personal data, wipe, import | Notes, saves, dismissals, saved searches, weights, and assumptions restored |
| 1.7 | Cards with no photo data | Read completely; no empty image boxes |
| 1.8 | Keyboard only | Every control reachable and operable; visible focus |

## Milestone 2 — refresh job and provider adapter

| # | Check | Expected |
|---|---|---|
| 2.1 | Switch mock ↔ RentCast by configuration | Same UI; no provider field names in UI code |
| 2.2 | Property present in mock and live data | Notes survive the switch |
| 2.3 | Refresh that would pass the ceiling (set ceiling below used + projected) | Refresh blocked and the reason shown |
| 2.4 | Rent estimate request | Counts 1 against the same ceiling; blocked when over |
| 2.5 | Header | Shows used / ceiling, projected monthly total, last successful refresh |
| 2.6 | Credentials | Only on the local server; absent from browser bundle and Git |

## Milestone 3 — Florida cost and ranking

| # | Check | Expected (sample data) |
|---|---|---|
| 3.1 | Every cost line and rent figure | Shows a text tag (Listing, Calc, Quote, Doc, N/A, Est., Unknown) or a rent source label |
| 3.2 | Fort Lauderdale total | $7,171 · "Estimate · needs flood quote" · gap "≈ +$1,971/mo" |
| 3.3 | Enter a flood quote on Fort Lauderdale | Flood line becomes Quote; checklist 4 of 4; total becomes Calculated; gap loses "≈" |
| 3.4 | Single-family home in a configured county with no extra data (North Miami) | Estimate, never Incomplete |
| 3.5 | Hollywood (assessment pending, no amount) | "at least $4,661/mo + special assessment" · Incomplete · no gap · never "Lowest" |
| 3.6 | Boca Raton (Palm Beach, no rates) | Tax, homeowners, flood, CDD Unknown · "at least $3,623" · "Set local rates for Palm Beach County" prompt |
| 3.7 | Set Palm Beach local rates | Boca total recomputes and leaves Incomplete (if no other trigger) |
| 3.8 | North Miami rent (2 comps) | "Unavailable · only 2 local comps" · no gap · score provisional "1 factor unknown: comparable rent" |
| 3.9 | Miami 33137 ($98/sq ft) | Implausible-value flag · score provisional "check price per sq ft" · size factor "Unknown · scored 0" |
| 3.10 | Sort by Price | Order $285k, $389k, $465k, $529k, $560k, $615k, $849k; ranks #4, #7, #2, #3, #5, #6, #1 |
| 3.11 | Change a weight | Results reorder by score; ranks update; breakdown shows new points |
| 3.12 | Compare shortlist | "Lowest complete total" on Miramar ($4,525), not Hollywood |
| 3.13 | Upfront cash row | $169,800 / $93,000 / $112,000 / "$77,800 + assessment (amount unknown)" |
| 3.14 | Search the UI and code for statewide figures | No single statewide millage, insurance, or flood value |
| 3.15 | Comp rules: change minimum comps to 2 | North Miami rent becomes "2 local comps · median"; gap appears with "≈" |
| 3.16 | Colors off (grayscale) | Every state still readable from text tags and badges |
| 3.17 | Enter a Boca tax bill showing no CDD (Palm Beach still unset) | CDD line becomes "Doc $0"; total stays Incomplete from the tax line |
| 3.18 | Estimate status chips | Name up to two lines in the plan's order, then "+n": Miramar "Estimate · needs insurance quote, assessments not checked +1"; North Miami "Estimate · needs insurance quote, flood quote +3" |

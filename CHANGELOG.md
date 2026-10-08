# Changelog

The project version is in `package.json`, and each release is tagged `vX.Y.Z`. The plan has its own version and bump rule (see the plan's Version history); each release below names the plan version it follows.

## Bump rule

Until 1.0.0, versions are `0.MINOR.PATCH`:

- **Minor:** a milestone is done, with all of its acceptance checks passing. 0.1.0 = Milestone 1, 0.2.0 = Milestone 2, 0.3.0 = Milestone 3.
- **Patch:** any other release: fixes, document or fixture changes, or work toward the next milestone.
- **1.0.0:** Milestone 4 (the 30-day review) is done.

From 1.0.0 on:

- **Major:** a JSON backup from the previous version can no longer be imported as is.
- **Minor:** a new or changed feature.
- **Patch:** fixes and document changes.

To release: move the notes under "Unreleased" to a new heading with the version, date, and plan version; set the version in `package.json`; commit; and tag that commit `vX.Y.Z`.

## Unreleased

- Store properties, listings, and personal data in SQLite (Issue 5 / C5): migration `002_core_schema.sql` adds properties, listings, snapshots, raw payloads, notes, favorites, dismissals, saved searches, and the match review queue as separate tables, with a data-access module (`apps/api/src/store.ts`) as the only place SQL lives. Property and listing IDs use distinct prefixes and notes, favorites, and dismissals reference properties only, so they survive replacing a property's listings; one property can hold a sale and a rent listing; the raw payload table has no reader outside the API. The saved search refresh interval is nullable with no default, because it is still an open decision. Foreign keys are now enforced on every connection (and again after each save, since `export()` resets them).
- Build the shared app shell for Wave 1 (Issue 4): desktop and mobile navigation, direct-load Search/Compare/Property/Ranking routes, persistent sample-data notice, brand tokens and fonts, skip link, and keyboard focus styling. Adds route coverage for component and Playwright checks.
- Scaffold the local npm workspaces with a React/Vite placeholder client, a localhost-only Node API, first-start SQLite creation and numbered migrations, web/API unit tests, a Playwright check, lint/format commands, and pull-request CI (Issue 3 / C3).
- Add the Milestone 0 RentCast sample pull (`tools/rentcast-sample/`, C1): one command per county area saves raw sale and rental responses locally, a hard cap of 40 requests (5 rent estimates) counted across runs and enforced before sending, a coverage report per county and mode, and seeded picks for the still-available check. Key, raw responses, and picks are git-ignored. Adds `npm test`.
- Record the Milestone 0 result (C2): `docs/PROVIDER_EVALUATION.md` holds the scored measures, seeds, sampling notes, and the decision. RentCast passes every measure for purchase listings and fails the still-available measure for rentals (15 of 20; Broward 7 of 10), so decision-table row 2 applies: go for purchase listings, and Rent-mode search is not relied on for finding rentals. A dashboard without photos is not acceptable. Plan 2.6 records this, closes the photo-less open decision, and opens two (the source of photos, and how the interface treats Rent mode). The UI spec, acceptance checks, `AGENTS.md`, and the fixtures' `planVersion` now name 2.6.
- Add the Milestone 0 scoring (C2): `score` reads the record sheets and applies the plan's step 5 rules (round-up counts, per-county floors, the borderline rule, status and price agreement) and lists the decision-table rows that apply, printing counts only. `lookup` lists the saved provider listings that could be a given public listing for the coverage check (it never classifies), and `picks` gains `--mode`, `--per-cell`, and `--exclude-checked` for the borderline extension. Adds `docs/PROVIDER_EVALUATION.md` as a draft: the pull, freshness and verification scored in all eight cells, field quality, and the request budget recalculated from measured requests per search. The 80 manual checks, the decision, and the photo-less decision are still pending; Plan 2.5: the request budget table is recalculated from the measured requests per search (weekly ~22 a month, daily ~150), and the documents that follow the plan now name 2.5. The refresh interval stays an open decision.
- Decide photos and the map (plan 2.7). No listing-photo API is open to a private individual, so photos are ones Garnie uploads for a property (local files, keyed to the property), and each property has a Street View link built as a Google Maps URL (no key, no request). The map is Google Maps, with a plain map of county borders and pins when no key is set, so Milestone 1 still needs no outside account. The Google Maps key is the one credential allowed in the browser: kept out of the bundle and Git, served at runtime, restricted to localhost and the Maps JavaScript API. Opens a decision on photos in backups. The UI spec, acceptance checks (1.1, 1.2, 2.6, new 1.9 and 1.10), `AGENTS.md`, `README.md`, the design note, and the fixtures' `planVersion` now name 2.7.

## 0.0.1 · 2026-10-07 · plan 2.4

Planning baseline, before Milestone 1. No app code yet.

- Plan, UI spec, acceptance checks for Milestones 1–3, design screens and tokens, and build instructions for coding agents.
- Fictional sample data with a checker that recomputes every derived number. The checker also compares full Estimate labels, insurance lines and county defaults, the triggers for Unknown lines, and the plan version the fixtures follow.
- Plan version 2.4, with its bump rule and the order in which an Estimate label names lines to verify.
- Project version and this changelog.

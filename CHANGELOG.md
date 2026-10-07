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

- Add the Milestone 0 RentCast sample pull (`tools/rentcast-sample/`, C1): one command per county area saves raw sale and rental responses locally, a hard cap of 40 requests (5 rent estimates) counted across runs and enforced before sending, a coverage report per county and mode, and seeded picks for the still-available check. Key, raw responses, and picks are git-ignored. Adds `npm test`.

## 0.0.1 · 2026-10-07 · plan 2.4

Planning baseline, before Milestone 1. No app code yet.

- Plan, UI spec, acceptance checks for Milestones 1–3, design screens and tokens, and build instructions for coding agents.
- Fictional sample data with a checker that recomputes every derived number. The checker also compares full Estimate labels, insurance lines and county defaults, the triggers for Unknown lines, and the plan version the fixtures follow.
- Plan version 2.4, with its bump rule and the order in which an Estimate label names lines to verify.
- Project version and this changelog.

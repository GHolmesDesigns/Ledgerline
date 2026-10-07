# Ledgerline

A personal, local-only web app for finding, ranking, and comparing Florida homes to rent or buy. It ranks listings by my own weighted criteria, sets the monthly cost of owning beside comparable rent, and shows flood, insurance, HOA, and CDD exposure. Every figure shows where it came from and how firm it is.

**Status:** planning complete; building Milestone 1 (interface and persistence on mock data). No app code yet.

## What's here

| Path | What it is |
|---|---|
| `PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.md` | The plan: scope, cost rules, data model, milestones. Wins every conflict. |
| `docs/UI_SPEC.md` | Screen-by-screen UI requirements and labels |
| `docs/ACCEPTANCE_CHECKS.md` | Testable checks for Milestones 1–3 |
| `fixtures/sample-data.json` | Fictional sample listings with every expected number |
| `fixtures/check-fixtures.mjs` | Recomputes every derived number in the fixtures |
| `tools/rentcast-sample/` | Milestone 0 script that pulls the RentCast free-tier sample. Garnie runs it; it is the only code that calls RentCast. See its README. |
| `design/` | Visual reference: screens, tokens, and which screens are current |
| `AGENTS.md`, `CLAUDE.md` | Build instructions for coding agents |
| `CHANGELOG.md` | Releases and the project's version bump rule |
| `package.json` | Project version |

## Versions

The project version is in `package.json`, and each release is tagged `vX.Y.Z`. Releases and the bump rule are in [CHANGELOG.md](CHANGELOG.md). Until 1.0.0, each completed milestone is a minor release (0.1.0 = Milestone 1). The plan has its own version and rule, in its Version history section.

## Check the fixtures

Requires Node 18 or later; no dependencies.

```bash
node fixtures/check-fixtures.mjs
```

Run it after any change to cost, score, or rank logic. It exits 0 when every check passes.

## Run the tests

```bash
npm test
```

Unit tests for the Milestone 0 sample-pull script. They use a fake network and invented listings, so they never call RentCast.

## Planned architecture

React frontend, a small local API, and SQLite, all running on this computer. The UI reads only the local database; only the refresh job calls a listing provider, behind a swappable `ListingProvider` interface. A mock provider comes first; RentCast is the candidate real source. Provider credentials stay on the local server and never enter Git.

## Sample data

All listings in this repo are fictional: sample data, not real listings. Local tax, insurance, and flood rates in the fixtures are layout placeholders, not real county rates.

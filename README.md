# Ledgerline

A personal, local-only web app for finding, ranking, and comparing Florida homes to rent or buy. It ranks listings by my own weighted criteria, sets the monthly cost of owning beside comparable rent, and shows flood, insurance, HOA, and CDD exposure. Every figure shows where it came from and how firm it is.

**Status:** Milestone 1 scaffold in progress. The current app is a placeholder; the later Wave 1 cards add the dashboard screens and persistence features.

## What's here

| Path                                     | What it is                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.md` | The plan: scope, cost rules, data model, milestones. Wins every conflict.                                                                                                 |
| `docs/UI_SPEC.md`                        | Screen-by-screen UI requirements and labels                                                                                                                               |
| `docs/ACCEPTANCE_CHECKS.md`              | Testable checks for Milestones 1–3                                                                                                                                        |
| `fixtures/sample-data.json`              | Fictional sample listings with every expected number                                                                                                                      |
| `fixtures/check-fixtures.mjs`            | Recomputes every derived number in the fixtures                                                                                                                           |
| `tools/rentcast-sample/`                 | Milestone 0 script that Garnie runs to pull and evaluate a capped RentCast sample. The app's adapter uses RentCast only during an explicit local refresh. See its README. |
| `tools/desktop-launcher/`                | Windows desktop shortcut that starts Ledgerline if it is not running and opens it, and the script that builds its icon. See its README.                                   |
| `design/`                                | Visual reference: screens, tokens, and which screens are current                                                                                                          |
| `AGENTS.md`, `CLAUDE.md`                 | Build instructions for coding agents                                                                                                                                      |
| `CHANGELOG.md`                           | Releases and the project's version bump rule                                                                                                                              |
| `package.json`                           | Project version                                                                                                                                                           |

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

This runs lint, formatting checks, unit tests for the web and API, the Playwright browser check, and the fixture checker. `npm install` installs the Chromium browser used by Playwright. The browser tests start their own API and web server on ports 4175 and 5174 with a throwaway database and settings file in the system temp folder, so they never reach a running app, your database, or a saved provider key. Set `LEDGERLINE_TEST_API_PORT` and `LEDGERLINE_TEST_WEB_PORT` to use other ports.

## Run it

Requires Node.js 18 or later and npm. From the repository root on Windows, macOS, or Linux:

```bash
npm install
npm run dev
```

Vite serves the placeholder web client at <http://127.0.0.1:5173> and proxies `/api` requests to the local API at <http://127.0.0.1:4174>. Both services bind to `127.0.0.1`; they are reachable only from this computer. Stop them with Ctrl+C.

On first API start, a SQLite database and migration ledger are created under `apps/api/data/`. That folder is ignored by Git. Remove it to reset the local database; the API recreates it on the next start. `LEDGERLINE_DATA_PATH` can point the API at a different SQLite file.

The mock provider is selected by default. To use RentCast, set `LISTING_PROVIDER=rentcast` in the ignored `apps/api/.env` file and restart the API. Set the key in Settings; the local API keeps it in that same file. Set `LISTING_PROVIDER=mock` to return to the fictional sample provider.

The API health endpoint is <http://127.0.0.1:4174/api/health>. The current screen is only the Wave 1 scaffold placeholder; later cards add the dashboard behavior.

The root npm workspace contains `apps/web` (React, TypeScript, Vite) and `apps/api` (Node, TypeScript, SQLite). Numbered SQL migrations live in `apps/api/migrations/`.

## Planned architecture

React frontend, a small local API, and SQLite, all running on this computer. The UI reads only the local database; only the refresh job calls a listing provider, behind a swappable `ListingProvider` interface. The mock provider is the default; RentCast can be selected in the ignored API `.env` file. Provider credentials stay on the local server and never enter Git. The map is Google Maps; its browser key is the one exception, restricted to localhost. Photos are ones I upload, plus a Street View link on each property.

## Sample data

All listings in this repo are fictional: sample data, not real listings. Local tax, insurance, and flood rates in the fixtures are layout placeholders, not real county rates.

# RentCast sample pull (Milestone 0)

A standalone script, outside the app, that pulls the free-tier sample for the provider data check (plan: Provider evaluation, steps 1, 2, and 4). Node 18 or later, no dependencies.

It is the only code in this repo that calls RentCast. Garnie runs it with the free key; tests and coding agents never do (the tests use a fake network and invented listings).

Nothing RentCast returns is committed. The repo is public and the provider's terms apply, so the key, raw responses, request count, estimates, and picks all live in git-ignored paths:

| Path | Holds |
|---|---|
| `config.local.json` | API key and search areas |
| `local/usage.json` | Every request sent, across all runs |
| `local/raw/<runId>/` | Raw responses and a manifest, one folder per run |
| `local/estimates/` | Raw rent-estimate responses |
| `local/picks/picks-<seed>.csv` | The still-available sheet, with real addresses |

## Before the first run

1. Get a free RentCast API key (Developer plan, 50 requests a month).
2. Choose one search area in each county. This is still an open decision in the plan ("Search areas within the test market"), so the example config has no defaults and the script refuses to run until every `REPLACE_ME` is replaced.
3. Copy the example and fill it in:

```bash
cp tools/rentcast-sample/config.example.json tools/rentcast-sample/config.local.json
```

| Setting | Meaning |
|---|---|
| `apiKey` | Your RentCast key. Sent in a header only; never printed or saved. |
| `requestCap` | Total requests across all runs. Default and maximum 40; you can lower it, not raise it. |
| `rentEstimateCap` | Rent-estimate calls, counted inside `requestCap`. Default and maximum 5. |
| `limit` | Listings per request, 1–500 (default 500). |
| `areas.<name>` | One area per county: a `county` label, plus `sale` and `rental` objects of RentCast search parameters (`zipCode`, or `city` with `state`, or `latitude` and `longitude`; `price`; `bedrooms`; and so on). They are passed through as written, so check RentCast's docs for each endpoint's range syntax. Each search needs a location. The script adds `status=Active`, `limit`, and `offset` itself. |

## Commands

Run from the project root. Each takes `node tools/rentcast-sample/cli.mjs <command>`.

| Command | What it does | Requests |
|---|---|---|
| `pull <area>` | Sale search, then rental search, for one area. Pages until a short page, so the manifest records requests per search. | 2 or more |
| `estimate --listing <id>` | Rent estimate for a saved sale listing (`id` as in the raw JSON). | 1 |
| `estimate --address "<street, city, state, zip>"` | The same for an address, with optional `--property-type`, `--bedrooms`, `--bathrooms`, `--square-footage`. | 1 |
| `report [--run <runId>]...` | Coverage report per county and mode. | 0 |
| `picks [--seed <seed>] [--run <runId>]...` | Seeded picks for the still-available check. | 0 |
| `usage` | Requests used so far. | 0 |

Suggested order: `pull` each county, `report`, up to 5 `estimate` calls on sample properties, then `picks` within 24 hours of the pull (plan step 4). `report` and `picks` use the latest run of each area unless you name runs with `--run`.

## The cap

- Every request is written to `local/usage.json` **before** it is sent, so a crash can't undercount.
- A request that would pass the cap is not sent. The run stops, says why, and exits with code 2. Anything already fetched is kept, and its search is marked incomplete.
- Failures are counted too. RentCast doesn't bill error responses, so the count is an upper bound. After any failure the run stops without retrying.
- A damaged `usage.json` is an error. The script never resets it to zero.
- Each run prints `Requests used: N of 40` when it ends. Keep the 10-request reserve the plan sets aside.

## Coverage report

Every share is out of the **active** listings in that search. Definitions, so the numbers can be re-scored later:

- **HOA fee:** a numeric `hoa.fee`, including 0.
- **Contact:** a phone or email on the listing agent or the listing office. A name alone doesn't count.
- **MLS number or contact:** the plan's verification measure.
- **History:** a non-empty `history` object.
- **Last seen within 7 days:** `lastSeenDate` is within 7 days of when the search was sent, so rerunning the report later gives the same answer.
- **Condo and townhome sale listings with no HOA fee:** property type contains condo, townhouse, townhome, or co-op; the share without a fee. Sale only.
- **Requests per search:** from the manifest.

## Picks

`picks` chooses 10 active listings per county and mode. It prints the seed; `--seed <seed>` over the same saved runs returns the same listings, whatever order RentCast returned them in. If a cell has fewer than 10 active listings, all are picked and nothing is replaced. It also writes `local/picks/picks-<seed>.csv` with the plan's record-sheet columns, leaving the last four (public status, public price, classification, time checked) for the manual check. An existing sheet is never overwritten.

## Tests

```bash
npm test
```

They cover the coverage report, the seeded picks, the cap, the config checks, and that the key and raw data are git-ignored. No live call is made.

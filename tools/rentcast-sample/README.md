# RentCast sample pull (Milestone 0)

A standalone script, outside the app, that pulls the free-tier sample for the provider data check (plan: Provider evaluation, steps 1, 2, and 4) and scores the result (step 5). Node 18 or later, no dependencies.

It is the only code in this repo that calls RentCast. Garnie runs it with the free key; tests and coding agents never do (the tests use a fake network and invented listings).

Nothing RentCast returns is committed. The repo is public and the provider's terms apply, so the key, raw responses, request count, estimates, and picks all live in git-ignored paths:

| Path | Holds |
|---|---|
| `config.local.json` | API key and search areas |
| `local/usage.json` | Every request sent, across all runs |
| `local/raw/<runId>/` | Raw responses and a manifest, one folder per run |
| `local/estimates/` | Raw rent-estimate responses |
| `local/picks/picks-<seed>.csv` | The still-available sheet, with real addresses |
| `local/picks/*.csv` | Any other record sheet, such as the coverage sheet (see below) |

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
| `picks [--seed <seed>] [--run <runId>]... [--mode sale\|rental] [--per-cell N] [--exclude-checked]` | Seeded picks for the still-available check. The three options are for the borderline extension (see Picks). | 0 |
| `lookup "<street address>" [--unit U] [--mode sale\|rental] [--beds N] [--sqft N] [--run <runId>]...` | Lists the saved provider listings that could be a given public listing, for the coverage check. | 0 |
| `score [--sheet <file>]... [--run <runId>]...` | Scores the record sheets with the plan's rules and lists the decision-table rows that apply. Counts only, no addresses. | 0 |
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

**Borderline extension.** When `score` marks a still-available measure **BORDERLINE**, the plan asks for 10 more checks for that mode: 5 per county, new random picks. Run `picks --mode <sale|rental> --per-cell 5 --exclude-checked`. It leaves out every listing already in a still-available sheet, uses a new seed unless you give one, and writes a new sheet that `score` reads with the others. Rerunning the same seed returns the same picks. (A coverage extension is picked from the public site by hand.)

## Record sheets and scoring

Both directions use the same columns as the sheet `picks` writes: `county, mode, direction, seed, address, unit, provider_id, mls_number, provider_status, provider_price, public_status, public_price, classification, time_checked`. `score` reads every CSV in `local/picks/` (or the ones named with `--sheet`).

**Still available (provider to public).** `picks` writes the 10 rows per county and mode. Fill in `public_status`, `public_price`, `classification` (**Available**, **Not available**, **Not found**, or **Ambiguous**; the last two count as not available), and `time_checked`.

**Coverage (public to provider).** There is no generated sheet, because the picks come from a public site's numbered results. Copy the header row into a new CSV in `local/picks/` (for example `coverage-<seed>.csv`), then add one row per checked public listing, 10 per county and mode, with `direction` set to `public to provider` and `seed` set to the seed you used for the random picks. Fill in the public listing's `address`, `unit`, `public_status`, and `public_price`. Look the property up in the saved provider data (same mode) for `provider_id`, `mls_number`, `provider_status`, and `provider_price`: `lookup "<street address>" --unit <unit> --mode <sale|rental>` lists the saved listings that could be it, best match first, with those four values. It matches street abbreviations (Ave and Avenue, NE and Northeast) and unit spellings (Apt 2B, #2B, Unit 2B), flags a different unit in the same building, and, for a record with no unit, shows beds and living area (add `--beds` and `--sqft` from the public listing) because the plan counts that record as found only when they match. It never classifies for you. The saved pull holds active listings only, so a property the provider has under another status shows as no candidate. Set `classification` to **Found** or **Not found**.

For a **Found** row, `score` needs a status and a price on both sides. Statuses use the plan's groups: **Active**; **Under contract** (pending, contingent, accepting backup offers); **Off market** (sold, rented, withdrawn, expired). Write one of those words; a status the plan doesn't name, such as RentCast's `Inactive`, is rejected so that you choose the group. Prices may include a dollar sign and commas.

`score` applies the plan's step 5 as written: required counts round up; each sampled measure is judged per mode with both counties pooled, plus the floor in each county and mode; freshness and verification are judged over every pulled active listing in each cell; and a pooled sampled measure that misses by exactly one is marked **BORDERLINE**. After 10 more checks for that mode and direction (5 per county, new random picks, a new seed, added to the sheets), it is judged on all 30 at the same percentage and a second miss is final. A cell left blank, or a county with fewer than 10 rows, is **PENDING**, and nothing is decided while any measure is pending or borderline.

It ends with the decision-table rows whose conditions are met. Rows can overlap, and the plan doesn't say which wins, so it lists all of them and you record which you take. A bad cell stops the run and is named by sheet row and column, never by address.

One rule is the tool's reading of the plan: the plan doesn't restate the floor for 15 checks in a cell, so `score` uses the same percentage of the checks in that cell, rounded up, and says so.

## Tests

```bash
npm test
```

They cover the coverage report, the seeded picks, the record-sheet reader, the scoring rules and decision rows, the cap, the config checks, and that the key and raw data are git-ignored. No live call is made.

# Florida Home Dashboard — build instructions for coding agents

A personal, local-only web app to find, rank, and compare Florida homes to rent or buy. One user, runs on this computer. Read this file first, then the documents below in order.

## Source of truth (in priority order)

1. `PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.md` — the plan (version 2.4, Oct 7, 2026). Product scope, cost rules, data model, milestones. **Wins every conflict.**
2. `docs/UI_SPEC.md` — screen-by-screen UI requirements and labels.
3. `docs/ACCEPTANCE_CHECKS.md` — testable checks for Milestones 1–3.
4. `fixtures/sample-data.json` — fictional sample data with every expected number. `node fixtures/check-fixtures.mjs` must pass.
5. `design/` — visual reference (layout, type, color). Some screens are out of date; `design/README.md` says which. Never copy numbers or labels from a stale screen.

If two sources disagree, follow the higher one and note the conflict in your summary. Don't resolve an open decision (plan, "Open decisions") on your own; leave it configurable and say so.

## Folder map

```
AGENTS.md                 this file (Codex reads it; CLAUDE.md imports it)
CLAUDE.md                 Claude Code entry point
PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.md
docs/UI_SPEC.md           screens, labels, states
docs/ACCEPTANCE_CHECKS.md checks to run before calling a milestone done
fixtures/sample-data.json sample listings, assumptions, expected results
fixtures/check-fixtures.mjs  recomputes every derived number
design/README.md          screen inventory, status, how to view
design/tokens.json        colors, type, spacing
design/screens/*.dc.html  screen sources from the design canvas (reference only)
```

`tmp/` and the `.pdf` / `.html` exports at the root are earlier review files; ignore them.

## Architecture rules (from the plan)

- Local browser app: React frontend + small local API + SQLite. Runs on this computer.
- **The UI reads only the local database. Only the refresh job calls a provider.** Searching, filtering, sorting, and panning the map never spend requests.
- Providers sit behind a `ListingProvider` interface: `search(criteria, page)`, `getListing(sourceId)`, optional `estimateRent(property)`, plus a capability declaration. Ship a mock provider first; RentCast is the candidate real adapter.
- The UI never uses provider-specific field names. Map provider responses to the normalized model.
- **Properties and listings are separate records.** Notes, saves, dismissals, ranking inputs, and cost entries belong to the property; price and status belong to the listing. Ambiguous address/unit matches go to a review queue, never a silent merge.
- Provider credentials stay on the local server; never in browser code or Git.
- Enforce a configurable monthly request ceiling in the app. Block and show any refresh or rent estimate that would exceed it.

## Cost and ranking rules that are easy to get wrong

These come from the plan, section 5; the fixtures exercise every one.

- Every cost line has a state: **Listing, Calc, Quote, Doc, N/A, Est., Unknown**. Show the tag as text, never color alone.
- Total status is the weakest line: any Est. → **Estimate**; any Unknown → **Incomplete**; otherwise **Calculated**. N/A lines count as $0 and don't weaken the total.
- **Incomplete only for four triggers:** an assessment pending/approved with no amount; a known CDD with no amount; a condo, co-op, or townhome with no HOA fee from the listing or same-building data; a county without local rates. Anything else missing is an Est.
- A property's own Quote or Doc always beats county rates. CDD line order: Doc → Unknown (known CDD, no amount) → Unknown (county not configured) → Est. at county typical.
- Townhomes use the house homeowners default; condos use HO-6.
- Estimate chips name up to two Est. lines in the plan's order (HOA median, insurance, high-risk flood, assessments with an association, other flood, CDD, …), then "+n" for the rest.
- "Doc $0" means verified none. An unchecked $0 is "Est. $0 · not checked". A single-family home in a configured county is never Incomplete.
- Own-vs-rent gap: shown with "≈" when the total is an Estimate; **hidden** when the total is Incomplete or rent is Unavailable. Incomplete totals show "at least $X" and never get "Lowest".
- Comparable rent always shows its source; fewer than 3 comps → "Unavailable". Never invent a rent figure.
- **Rank numbers follow score order under every sort.** Unknown factors score 0. Any unknown factor or flagged value makes a score provisional, with the reason shown.
- **No statewide rates.** Tax, insurance, flood, and non-ad valorem defaults come from per-county local assumptions. Outside configured counties those lines are Unknown and the UI prompts "Set local rates for [county]".

## Build order

Follow the plan's milestones. Milestone 0 (provider data check) is manual and done by Garnie; don't call RentCast unless asked. Start at Milestone 1 on mock data built from `fixtures/sample-data.json`.

## Sample data

All sample listings are fictional and must stay labeled "Sample data — not real listings". Local rates in the fixtures are placeholders, tagged `sample: true`. Don't replace them with real-looking rates; real rates are entered by the user.

## Working conventions

- Keep the brand look in `design/tokens.json`: Outfit (headings), Work Sans (body), DM Mono (labels/figures); near-black `#101820` with restrained cyan/magenta/yellow accents. Cards work without photos.
- Accessibility: real buttons/links/inputs with labels, 44 px touch targets, text contrast ≥ 4.5:1, keyboard navigation.
- After changing anything that computes costs, scores, or ranks, run `node fixtures/check-fixtures.mjs` and the checks in `docs/ACCEPTANCE_CHECKS.md`.
- When you change the plan, apply the bump rule in its "Version history" section.

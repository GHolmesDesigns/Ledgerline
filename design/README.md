# Design reference

Screens from the design canvas "Florida Home Dashboard UI" (claude.ai artifact). They're visual reference for layout, type, and color. **Numbers and labels come from `docs/UI_SPEC.md` and `fixtures/sample-data.json`, not from these files.** In particular, rank and score figures in these screens (for example Fort Lauderdale "#1 · 84") are the earlier hand-set examples; the computed ones are in `docs/UI_SPEC.md` §2.

## Status (Oct 8, 2026)

| Screen | File | Status |
|---|---|---|
| Search · desktop | `screens/Main.dc.html` | **Current** — Miami-Dade/Broward data, cost tags, status chips, rent sources, provisional scores, score-order ranks |
| Compare · desktop | `screens/Compare.dc.html` | **Current** — tag legend, CDD and special assessment rows, upfront cash, split assumptions |
| Property detail · desktop | `screens/Property.dc.html` | **Current** — tagged cost lines, verification checklist, local comps, rent estimate button |
| Ranking & data · desktop | `screens/Settings.dc.html` | **Current** — county assumptions, comparable-rent rules, paired searches, and match review |
| Search · mobile | `screens/MobileSearch.dc.html` | **Current** — current sample results, status chips, rent sources, provisional scores, score-order ranks |
| Compare · mobile | `screens/MobileCompare.dc.html` | **Current** — sample properties, line-state labels, incomplete totals and comparable-rent sources |
| Property · mobile | `screens/MobileProperty.dc.html` | **Current** — Fort Lauderdale sale/rent property, cost tags, verification, photos, and Street View link |
| Ranking & data · mobile | `screens/MobileSettings.dc.html` | **Current** — county assumptions, ranking, rent rules, request budget, and match review |

The PDF and the "Ranking & data" HTML export in the project root predate these revisions; treat them as superseded.

The three desktop screens already marked Current predate the photo decision in plan 2.7. Follow the plan and `docs/UI_SPEC.md` for uploaded property photos and the Street View link; provider photos are not supplied. The desktop Search map remains a local county-and-pin fallback when no Maps key is set.

## Reading the files

Each `.dc.html` is one artboard in the canvas's component format: markup inside `<x-dc>`, `{{holes}}` filled by a `renderVals()` method in the `text/x-dc` script at the bottom, `<sc-for>` for loops, `<sc-if>` for conditionals. They need the canvas runtime to render, so open the canvas link to see them live. For building, read them for structure and inline styles; don't port the runtime.

`canvas.json` lists artboard sizes: desktop pages are fluid at 1440 px design width; mobile frames are 390 × 844.

Tokens: `tokens.json`.

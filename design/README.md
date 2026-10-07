# Design reference

Screens from the design canvas "Florida Home Dashboard UI" (claude.ai artifact). They're visual reference for layout, type, and color. **Numbers and labels come from `docs/UI_SPEC.md` and `fixtures/sample-data.json`, not from these files.**

## Status (Oct 7, 2026)

| Screen | File | Status |
|---|---|---|
| Search · desktop | `screens/Main.dc.html` | **Current** — Miami-Dade/Broward data, cost tags, status chips, rent sources, provisional scores, score-order ranks |
| Compare · desktop | `screens/Compare.dc.html` | **Current** — tag legend, CDD and special assessment rows, upfront cash, split assumptions |
| Property detail · desktop | `screens/Property.dc.html` | **Current** — tagged cost lines, verification checklist, local comps, rent estimate button |
| Ranking & data · desktop | `screens/Settings.dc.html` | **Stale** — still Tallahassee data and one statewide millage. Build from `docs/UI_SPEC.md` §3 |
| Search · mobile | `screens/MobileSearch.dc.html` | **Stale** (layout still valid: List/Map toggle, bottom card, tab bar) |
| Compare · mobile | `screens/MobileCompare.dc.html` | **Stale** (layout still valid: two-up with Left/Right selectors) |
| Property · mobile | `screens/MobileProperty.dc.html` | **Stale** (layout still valid: Sale/Rent tabs, fixed bottom bar) |
| Ranking & data · mobile | `screens/MobileSettings.dc.html` | **Stale** (layout still valid: collapsible sections) |

The PDF and the "Ranking & data" HTML export in the project root predate these revisions; treat them as superseded.

## Reading the files

Each `.dc.html` is one artboard in the canvas's component format: markup inside `<x-dc>`, `{{holes}}` filled by a `renderVals()` method in the `text/x-dc` script at the bottom, `<sc-for>` for loops, `<sc-if>` for conditionals. They need the canvas runtime to render, so open the canvas link to see them live. For building, read them for structure and inline styles; don't port the runtime.

`canvas.json` lists artboard sizes: desktop pages are fluid at 1440 px design width; mobile frames are 390 × 844.

Tokens: `tokens.json`.

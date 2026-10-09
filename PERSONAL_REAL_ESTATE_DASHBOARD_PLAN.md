# Personal Florida Real Estate Dashboard — Planning Document

*Version 2.15 · October 9, 2026 · Intended use: one person, running locally · Changes and bump rule: [Version history](#version-history)*

## Goal

Create an easier way to discover and compare Florida homes for **rent or purchase**. The interface should work with realistic sample listings before any paid provider is selected. A replaceable data-source layer will allow provider trials without rebuilding the interface or losing personal notes and favorites.

### Why build this instead of using Zillow or Redfin plus a spreadsheet

Public listing sites already offer free search, maps, photos, favorites, and alerts with broad coverage. This dashboard is worth building only for what they don't do:

1. **Personal ranking:** results ordered by my own weighted criteria, not the site's.
2. **Rent vs. buy side by side:** an estimated monthly cost of owning a listed home next to comparable rents, with the source and certainty of every figure shown.
3. **Florida cost and risk in one view:** flood zone, insurance, HOA and condo assessment exposure, and a realistic post-purchase property tax estimate.
4. **Data I keep:** notes, dismissals, and observed price history that survive changing providers.

These are first-version features. If they don't hold up in use, the fallback is a public site plus a spreadsheet.

## Initial search profile

- Geography: Florida statewide. Start with a ZIP or a radius rather than loading the whole state at once. The first-version search offers two explicit location modes: **ZIP** (one five-digit ZIP, exact match) and **Radius** (any value from 0.1 to 25.0 miles inclusive). A radius center can be entered as latitude and longitude or as a street address. Resolve an address to coordinates locally, from the addresses of properties already stored (no outside lookup), before running the search; an address that is not stored is entered as latitude and longitude. Show the resolved center for review, and keep the entered address with the saved search. Reject an unresolved or ambiguous address and out-of-range coordinates or radius; never silently substitute a ZIP or city search. Radius membership uses straight-line distance from the resolved center to each property's coordinates, and a property exactly on the boundary is included. A property without coordinates is left out of radius results and stays findable by ZIP. The existing free-text city search stays as a third choice, **City text**, beside ZIP and Radius, so saved searches and pairs already built keep working.
- **Test market:** Miami and Fort Lauderdale, treated as two markets (Miami-Dade County and Broward County) for the provider test and for local tax, insurance, and flood assumptions. These are large, condo-heavy markets with many high-flood-risk zones, so they exercise the condo, assessment, and flood features well. Saved searches should be narrow enough (a ZIP, a radius, or tighter filters) that each returns under 500 listings per mode; a whole-city search here may take several requests per refresh.
- Modes: Buy and Rent, switched explicitly; keep separate price ranges and saved searches for each mode. The Rent view carries the visible label "Rent data may be incomplete", because Milestone 0 found the provider's active rentals not reliably still available. Rent-mode searches still run and feed local comparable rent.
- Default results: active listings, newest updates first. Show pending/under-contract only when requested.
- Filters: location, price/rent, beds, baths, property type, minimum square footage, **lot size, year built, and days on market**, an HOA fee limit, and personal tags (item 16). Lot size is a minimum and maximum in square feet; year built is a minimum and maximum year; days on market is "listed within [n] days" and uses the listing's days-on-market figure, or the days since its listed date when that is all there is. They work on the stored listings, so they spend no provider requests, and a saved search keeps them. RentCast supports lot size, year built, and days on market as search filters, so a refresh may also send them to narrow what it fetches; its HOA fee is a result field only, so the HOA limit is always a local filter. When a filter is set, a listing with no value for it is left out, and the results line says how many were left out for that reason (for example "12 hidden: lot size unknown"), never silently. RentCast has no waterfront, pool, pet, or other amenity field at all (checked in its documentation Oct 9, 2026; see Data-source providers and costs), which is why amenities are personal tags.
- Personal workflow: save, dismiss, add notes, rank, compare, and open a verification link.

## Interface scope

### First usable version (Milestones 1–3)

1. **Search:** clear Buy/Rent switch; ZIP/Radius location choice; compact filters; visible filter chips; saved search profiles. A saved profile stores its location mode, the ZIP or the radius center (the entered address when used, the resolved latitude and longitude, and the radius), and its Buy/Rent filters. For a radius search the map draws the center and the circle. Searching, address-center resolution, filtering, and panning the map read local data only and never spend provider requests. (Google's map tiles are billed per map load, separately from listing-provider requests; see Security and cost controls.)
2. **Results:** map and list views that stay in sync. Every card shows price, status, address, beds/baths, area, provider, and last-seen time.
   - **Map:** Google Maps (Maps JavaScript API) is the map the app is meant to run with, with the county borders drawn from a local boundary file. The map opens framed on the current results' pins, never on the whole state. Without a Google Maps key, or offline, the map panel shows a plain map of county borders and pins drawn from local data, with a note to add a key in Settings, so the app still works with no outside account. That fallback is a stand-in, not the intended map: it also frames the current results' pins rather than the whole state.
   - **Photos:** photos I upload for a property: my own, or ones saved by hand from a listing page whose terms allow it (see Data-source providers and costs). They are stored on this computer. A card shows the property's first uploaded photo, or a provider's licensed image if a provider ever supplies one. Otherwise it uses a layout that reads well **without photos**, because RentCast supplies none.
   - **Street View link:** each property has a link that opens Google Maps' interactive Street View at the property's coordinates in a new tab. It is a Maps URL (`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=LAT,LNG`), which needs no API key; the app makes no request, and like the verification links, I click it myself. On the property page the link sits at the top, in the header beside the property's address, not further down the page (see item 13).
3. **Shortlist:** favorites, dismissed listings, personal notes, and a side-by-side comparison of up to four listings, including estimated monthly cost for purchase listings.
4. **Personal ranking:** adjustable weights for the factors I care about; results can be sorted by score, and the score breakdown is visible on each card. Scores use the rules below on the current filtered result set.
   - **Buy factors and default weights:** price (25), own-vs-rent cost (20), flood (20), HOA (15), insurance (10), living area (10).
   - **Rent factors and default weights:** rent price (40), flood (25), lease fit (20), living area (15).
   - For a numeric factor scored relative to the current result set, scale known values linearly from 0 to 100: for factors where lower is better, the minimum is 100 and maximum is 0; where higher is better, the minimum is 0 and maximum is 100. Clamp outside the range; if all known values are equal, score them 100. Exclude Unknown values from the range. Scores can change when the result set changes.
   - **Price** (sale price for Buy, monthly rent for Rent): lower is better; use the numeric range rule above. Unknown if the listing has no usable price.
   - **Own-vs-rent cost** (Buy only): compare the monthly cost-to-own total with comparable monthly rent. Score 100 when ownership costs no more than rent; reduce by 100 points for each 1.0× of cost above rent, down to 0 at twice the rent. An Estimate total is usable; an Incomplete total or unavailable comparable rent is Unknown. Stale rent remains usable but is labeled stale.
   - **Flood** (both modes): use the FEMA zone table: X = 100, X500 = 80, A-family zones (A, AE, AH, AO) = 40, and V-family zones (V, VE) = 10. Unknown or an unrecognized zone is Unknown.
   - **HOA** (Buy only): use the property's monthly association fee, including a valid same-building Estimate or verified N/A $0; lower is better under the numeric range rule. Unknown if the fee is Unknown or absent.
   - **Insurance** (Buy only): use the monthly homeowners or HO-6 cost line, including a local Estimate or entered Quote; lower is better under the numeric range rule. Unknown if the line has no amount.
   - **Lease fit** (Rent only): compare the saved search's optional preferred lease term in months with the listing's advertised minimum and maximum term. Score 100 when the preferred term falls in the advertised range; otherwise score `100 × max(0, 1 − distance-to-range / preferred-term)`. Unknown if no preferred term or no advertised range is available.
   - **Living area** (both modes): use living square feet; higher is better under the numeric range rule. Missing or flagged implausible area is Unknown.
   - **Unknown factors** score 0 and show as Unknown in the breakdown. Any Unknown factor or implausible-value flag makes the overall score provisional, with the reason shown. The fixture's factor values, scores, and ranks are computed from its sample data with these formulas.
   - **Rank numbers (#1, #2, …) always reflect score order within the current results**, whatever sort is selected. Sorting by price or newest changes the card order, not the rank labels, so a #4 can appear at the top of a price-sorted list.
   - **Unknown factors never help a listing.** A factor with no data (for example, an own-vs-rent gap when comparable rent is unavailable or the cost total is incomplete) scores as the worst value for that factor.
   - **Provisional scores:** a score is labeled "provisional" when any factor is unknown or the listing has an implausible-value flag, with the reason shown in the score breakdown (for example "1 factor unknown: comparable rent" or "check price per sq ft").
5. **Rent vs. buy estimate:** for purchase listings, an estimated monthly cost of owning. The comparison must be usable for most listings, so **missing information with a reasonable local default is an Estimate, not Unknown.** Most totals are Estimates until I verify a shortlisted property; Incomplete is reserved for a known, material cost with no usable figure.

   **Line states:**

   | State | Meaning | Effect on the total |
   |---|---|---|
   | Listing | Amount from the provider record | Firm |
   | Calculated | From price and my assumptions | Firm |
   | Quote | A real quote I entered | Firm |
   | Document | An amount, including a verified $0, entered from a tax bill, association letter, or disclosure | Firm |
   | Not applicable | The charge cannot apply to this property | $0, firm |
   | Estimate | An unverified amount: a local default, a same-building median, or an assumed $0 not yet checked | Makes the total an Estimate |
   | Unknown | A cost known to exist, material, with no usable figure | Makes the total Incomplete |

   **Verified $0, Not applicable, or Estimate:**
   - *Not applicable* only when the charge structurally can't apply: association fees and association assessments on a property confirmed to have no association, or a flood policy I choose not to carry where it isn't required (see below).
   - *Document* $0 when the charge could exist and a document confirms it doesn't: the tax bill shows no CDD or other non-ad valorem charges, or an association letter confirms no pending assessments.
   - *Estimate* $0 when a charge is assumed absent but not yet checked. It is labeled "not checked", never shown as a verified $0.

   **Rules by cost line:**

   | Cost line | Firm when | Estimate when | Not applicable when | Unknown (total Incomplete) only when |
   |---|---|---|---|---|
   | Principal and interest | Always (Calculated) | — | — | — |
   | Property tax (millage-based) | Local millage is set (Calculated) | — | — | The county has no local rates set |
   | Non-ad valorem assessments, including CDD fees | Tax bill checked (Document, amount or $0) | Not yet checked: the county's typical non-ad valorem amount, labeled "CDD not checked" | — | The property is known to be in a CDD (listing, disclosure, or my note) and the amount isn't known; or the county has no local rates set and the tax bill hasn't been checked |
   | Homeowners (house or townhome) or HO-6 (condo) insurance | Quote | No quote: the local default for the property type (townhomes use the house default) | — | The county has no local rates set |
   | Flood insurance | Quote | No quote: the local default for the flood zone; if the zone isn't known yet, the local high-risk default | I choose not to carry it, allowed only outside FEMA high-risk zones (A and V zones), where federally backed mortgages require it | The county has no local rates set |
   | HOA / association fee | Listing amount, or Document | Condo, co-op, or townhome with no listing amount: median fee of at least 2 other units at the same street address seen in the last 12 months. Single-family with no listing amount: $0, labeled "HOA not confirmed" | Confirmed no association (Document or my own check) | Condo, co-op, or townhome with no listing amount and no same-building data |
   | Special assessments | Document (installment amount, or confirmed none) | An association exists or isn't ruled out, not yet checked: $0, labeled "assessments not checked" | The HOA line is Not applicable | An assessment is pending or approved and its amount isn't known |
   | Maintenance reserve | Always (Calculated) | — | — | — |

   A Quote or Document entry for a property always takes precedence over its county's local rates, so a verified line stays firm even where the county isn't configured. For non-ad valorem assessments the order is: Document (amount or verified $0); Unknown if a known CDD has no amount; Unknown if the county has no local rates; otherwise the county's typical amount as an Estimate labeled "CDD not checked".

   A one-time special assessment is shown as upfront cash beside the down payment, not in the monthly total; an assessment paid in installments uses the monthly installment.

   **Incomplete happens only for these triggers:** an assessment pending or approved with no amount; a known CDD with no amount; a condo, co-op, or townhome with no HOA amount from the listing or same-building data; or a county without local rates. A newly fetched single-family home in a configured county is never Incomplete. Milestone 0 measures how often condo and townhome listings lack an HOA fee, since that is the trigger most likely to be common.

   **Total status** is the weakest state among its lines (Not applicable lines are ignored):
   - All lines firm → **Calculated**.
   - Any Estimate line → **Estimate**, naming up to two lines to verify and counting the rest as "+n" (for example "Estimate · needs flood quote, CDD not checked +1"). The own-vs-rent difference is shown with "≈".
   - Any Unknown line → **Incomplete**, listing what's missing and showing the known subtotal as "at least $X". No own-vs-rent difference is shown, and the listing is not marked lowest-cost in comparisons.

   **Lines named in an Estimate label:** the first two Estimate lines in this order, with the item text shown; every other Estimate line counts toward "+n".
   1. HOA fee from a same-building median (condo, co-op, or townhome): "HOA confirmation"
   2. Homeowners or HO-6 insurance default: "insurance quote" or "HO-6 quote"
   3. Flood default in a high-risk zone (A or V zones), or with the zone not yet known: "flood quote"
   4. Special assessments not checked, where an association exists: "assessments not checked"
   5. Flood default in any other zone: "flood quote"
   6. Non-ad valorem assessments at the county's typical amount: "CDD not checked"
   7. Single-family HOA not confirmed: "HOA not confirmed"
   8. Special assessments not checked, where no association is known: "assessments not checked"

   **Verification checklist** for shortlisted properties; each item moves a line from Estimate to firm: homeowners or HO-6 quote; flood quote; tax bill (non-ad valorem and CDD); association letter (fees, pending assessments, reserves); and, for single-family homes, confirmation of whether there is an HOA.

   **Assumptions come in two sets:**
   - **Personal**, one set saved with the search profile: down payment, mortgage rate and term, maintenance reserve percentage.
   - **Local**, one set per county or ZIP group, set up for each market I search: millage rate (from the county property appraiser or tax collector), typical non-ad valorem assessments, homeowners insurance default (house, also used for townhomes), HO-6 default (condo), flood insurance defaults by flood zone, and an optional price-per-square-foot range used for implausibility checks.

   There are **no statewide defaults** for local figures. For a property outside every configured market, the tax, insurance, and flood lines are Unknown and the total is Incomplete, with a prominent "Set local rates for [county]" prompt. Sample values in design drafts (such as 18.5 mills) are layout placeholders only.
6. **Comparable rent:** shown beside each purchase listing's cost to own, from the first available source in this order:
   1. **Same home:** an active rental listing for the same property. Label: "same home · listed [date]".
   2. **Local comps:** active rental listings already stored from Rent-mode refreshes, so no extra requests. A comp must have the same property type and bedroom count, living area within 20%, be within 1 mile, and have been seen in the last 30 days. At least 3 comps are required; the value is their median. Label: "[n] local comps · median · within [distance]", with the comps viewable.
   3. **Provider rent estimate**, on request only, for shortlisted properties: RentCast's long-term rent estimate costs 1 request per property and counts against the request ceiling. Label: "RentCast estimate · range $[low]–$[high] · [date]".
   4. Otherwise, **Unavailable**. No rent figure is invented, and the own-vs-rent ranking factor is treated as unknown.

   Local comps only exist where a Rent-mode saved search covers the same area as the Buy-mode search, so each Buy area normally needs a matching Rent-mode search (see Request budget). Comps and estimates older than 30 days are labeled stale.
7. **Florida cost and risk fields** (per property, filled automatically where a source exists, otherwise entered by me):
   - **Flood zone** from FEMA's National Flood Hazard Layer, with a note that zone X does not mean no flood risk.
   - **Insurance:** quoted or estimated premium; roof age, year built, and wind-mitigation features (such as impact windows or shutters), which strongly affect insurability and cost.
   - **Condo association status:** milestone inspection and reserve-study status, recent or pending special assessments (amount, or "pending, amount unknown"), and rental or approval restrictions, entered from association documents. Florida's post-2021 condo safety laws have led to large special assessments at some older buildings. Miami-Dade and Broward also run their own building recertification programs; record that status too.
   - **Property tax estimate** based on the purchase price and the local millage rate, not the current owner's bill (see County property appraiser below).
   - **Non-ad valorem assessments, including CDD fees:** charges billed with property taxes but not based on millage, such as Community Development District fees, which are common in newer Florida communities and can be substantial. Taken from the property's tax bill or disclosures; until then, the county's typical amount is used as an Estimate labeled "CDD not checked" (see the rules by cost line).
8. **Trust cues:**
   - Flag missing fields and implausible values (for example: price per square foot far outside the area's range, 0 bedrooms on a single-family house, coordinates outside Florida). A flagged listing's score is provisional until I confirm or correct the value. Flags are stored per listing field. Confirm keeps the provider value and clears its flag; Correct stores a property-level override with its source and clears its flag. Flags and overrides are included in personal-data backups.
   - Label stale results using two timestamps: the provider's last-seen date (stale after 7 days by default) and my last local refresh (stale after the saved search's refresh interval).
   - **Verification links:** the provider's source URL when supplied; otherwise the MLS number and listing agent/office contact when supplied, plus an address search link I can click to check availability manually. The app never fetches those pages itself.
9. **Observed price and status history:** each refresh stores a snapshot of price and status, plus the provider's own history when supplied (RentCast includes a `history` field). Stored within the provider's retention terms.
10. **Local storage:** properties, listings, snapshots, rent figures, assumption sets, cost entries, search profiles, favorites, dismissals, and notes in a local SQLite database. Uploaded photos are files in a local folder kept out of Git; the database stores each one's path, source, and date added. Export/import personal data as JSON for backup. The backup carries each photo's details (path, source, date added) but not the photo files; the photo folder is backed up separately, and an import re-links photos that are present in the folder.
11. **Accessibility:** keyboard navigation, clear labels, legible status colors, and a responsive layout. Text contrast is at least 4.5:1 on every control in every state and in both themes (item 12); a button never has its text and background in the same or near-same color.
12. **App shell, Settings, and appearance** (items 12–15 were added in 2.10 at the end of the list, so references to items 1–11 stay valid):
    - **Sidebar navigation (desktop):** a left sidebar with Search, Compare, and Settings that I can collapse to a narrow icon rail and expand again. The toggle is a labelled button that reports whether the sidebar is expanded; each link keeps an accessible name and a visible focus when collapsed. The collapsed or expanded choice is remembered on this computer. On a phone the sidebar is replaced by the bottom tab bar (Search, Compare, Settings).
    - **App version:** the sidebar shows the app's version (for example "v0.3.1"), read from `package.json` so there is one source, and it stays visible when the sidebar is collapsed. Settings also shows it under About, so it is available on a phone, where there is no sidebar.
    - **Settings tab:** "Ranking & data" becomes **Settings**, the one place that configures the app rather than finds homes. Its sections, in the default order: Appearance; Ranking weights; Assumptions (personal, and local per county) with the comparable-rent rules; Saved searches; Personal tags; **RentCast usage**; Keys (the RentCast key and the Google Maps key); Property match review; Backup and restore; About (version). **RentCast usage** is where the RentCast figures are entered and checked: billing day, the plan's included requests, the monthly ceiling, outside requests (such as the Milestone 0 pull), and the dashboard's current "used" figure with the date it was read, next to the usage the app counts and any unexplained difference (see Security and cost controls). **The sections can be reordered by dragging** (see below). Anything that edits settings moves out of the Search, Compare, and Property screens into Settings; those screens keep a link to the matching section (for example Compare's "Edit" links for assumptions). Per-listing and per-property results, including each score breakdown, stay where they are.
    - **Reorder Settings sections:** each section header has a drag handle. Dragging a section moves it, and the new order is kept on this computer and applies after reload. Reordering also works without a mouse or a drag: the handle is a button that, once focused, moves the section up or down with the arrow keys (Enter or Space to pick up and drop, Escape to cancel), and the new position is announced ("Personal tags, position 5 of 10"). On a phone, the same handle works by touch and each section can also be moved with Move up and Move down buttons. A "Reset order" button restores the default order. Every section can be moved, including Appearance and About. The order is a display preference like the theme: not personal data, so it is not in the JSON backup. A section that a later version adds appears at its default place.
    - **Saved searches list:** Settings lists every saved search with its name, mode, location, refresh interval, and last refresh result, and a **Delete** button on each row. **Rename:** each row's name is editable in place and saved with "Save changes" (the same button that saves the refresh interval). A name is required (leading and trailing spaces are trimmed) and need not be unique, so each row also shows its mode and location. Renaming changes only the label: the search's filters, schedule, pairing, history, and the properties and listings it found are unchanged, and a paired search keeps pointing at it. A renamed search keeps its place in the Search picker and shows the new name there after reload. Search's "Update saved search" form can rename the open search too. **Delete** asks for confirmation and removes only the saved search and its refresh schedule; properties, listings, notes, saves, dismissals, and photos are not touched. Deleting a search that has a paired Rent or Buy search says so and leaves the pair in place. Search keeps its picker for opening a saved search.
    - **Dark mode:** Settings → Appearance offers Light, Dark, and System (the default, which follows the computer). Both themes meet the contrast rule above; state tags and chips still carry text, never color alone. Dark keeps the brand near-black `#101820` as its base, with the accents adjusted for contrast; `design/tokens.json` gets the dark counterparts. The choice is a display preference saved on this computer and is not personal data, so it is not part of the JSON backup.
13. **Property page map and Street View:** the top of the property page has, in order, the header with the address and the **Open Street View** link, then a Google map (Maps JavaScript API) showing the property's pin at its coordinates. Street View stays a link out; the app never shows Street View images. The map follows the same fallback as the Search map: with no key or offline it shows the plain local map with the pin and the note to add a key in Settings. Opening a property page loads one map, which counts as one Google map load (see Security and cost controls), not a listing-provider request.
14. **Desktop launcher:** a shortcut on this computer's desktop (Windows first) starts the local API and web server if they are not already running and opens the app in the browser. If it is already running, it only opens the browser. It reports a clear message if a port is in use or a server fails to start, and it does not change where credentials are stored or what the servers can reach. It only starts: the servers keep running after the browser closes, and stopping them is left to the user (no stop shortcut). This does not make the app a packaged desktop application (see Decisions made); it is a convenience for starting the same local browser app.
15. **Match the design:** built screens follow the layouts in `design/screens/` for spacing, type, color, and controls. In particular the ranking weights are sliders (with the current value shown as text and arrow-key adjustment), and map pins sit at the properties' coordinates, as in the Search mock-up. Labels and numbers still come from `docs/UI_SPEC.md` and the fixtures, and where a mock-up predates the plan (it does not yet show the sidebar, Settings, dark mode, or the property page map) the plan wins. Each screen is compared against its mock-up before the UI revision is called done.
16. **Personal tags** (added in 2.15): labels I attach to a property for things the provider does not supply, such as a pool or pet-friendly, since RentCast has no amenity data.
    - **Standard list and custom tags:** the picker offers a standard selection (Pool, Pet friendly, Waterfront, Water view, Garage, Fenced yard, Gated community, In-unit washer/dryer, Elevator, Balcony, Needs work) and an **Add custom tag** option. A custom tag is any short text I type (up to 30 characters, trimmed, not case-sensitive, no duplicates); once created it appears in the picker for every property beside the standard ones.
    - **Where:** tags are added and removed on the property page and from a search card, and appear as chips labelled as my own ("My tag") so they are never mistaken for provider data. Tags belong to the property, like notes (data model), so they survive a relisting and are not lost when the provider changes.
    - **Use:** Search can filter by one or more tags (a listing must have all the chosen tags) and the filter is kept in a saved search; Compare shows each property's tags in a row. Tags are not a ranking factor: the ranking factors and weights stay as decided in item 4.
    - **Managing them:** Settings → Personal tags lists the standard and custom tags with how many properties use each. A custom tag can be renamed or deleted; deleting asks for confirmation, says how many properties will lose it, and removes only the tag (never a property, listing, note, or photo). Standard tags cannot be deleted.
    - **Backup:** tags and the custom tag list are in the JSON backup.

### Later, after source validation

- Price-change alerts, if the provider permits and supports them.
- Selected county parcel and tax data integration, beyond links (see County property appraiser below).
- Travel-time or neighborhood overlays, each with its own data and cost review.
- Street View link aimed at the house: the refresh job checks shortlisted properties with Google's Street View metadata service (free, with no usage cap, as of Oct 8, 2026), stores the panorama ID (which Google allows), points the view at the house, and hides the link where no imagery exists.
- A second simultaneous listing feed, with cross-provider de-duplication on top of the property matching that already exists in v1.

## Architecture and replaceable source layer

A local browser-based web app (for example, a React frontend and a small local API). The key rule: **the interface reads only from the local database; only the refresh job calls a provider.**

```text
Search UI ──> Query service ──> local SQLite
                                 ├─ properties   (stable local ID, normalized address + unit)
                                 ├─ listings     (provider record, mode, price, status, dates) + snapshots
                                 └─ personal     (notes, favorites, dismissals, saved searches, ranking weights)
                                        ▲
Refresh job ──> ListingProvider interface ──> Mock / RentCast / future provider
  (manual or scheduled per saved search; enforces the request ceiling; logs usage)
```

The refresh job runs each saved search against the provider, maps the results to the normalized model, matches them to properties, and stores a snapshot. Normalized search criteria carry either a ZIP or a latitude/longitude center and radius, and a provider adapter must declare which it can refresh. If an adapter cannot refresh a saved radius search, the app shows that limitation and blocks the refresh instead of quietly broadening the area. Because browsing never calls the provider, request usage depends only on the number of saved searches and how often they refresh. Cached results remain viewable offline.

The map is the one outside service the interface itself uses: when a Google Maps key is set, the browser loads Google's map tiles, on the Search screen and at the top of each property page. They carry no listing data, and offline the map falls back to the plain map of county borders and pins.

The provider interface supports `search(criteria, page)`, `getListing(sourceId)`, an optional `estimateRent(property)`, and a capability declaration listing which optional fields, filters, and methods it supplies (photos, source URL, waterfront, full/half bath split, history, HOA fee, rent estimates). `estimateRent` is called only when I request it for a shortlisted property, and it goes through the same request ceiling as the refresh job. The UI must not use provider-specific field names. Search results already contain full listing records, so `getListing` is used only to refresh a single shortlisted listing on request, never when a card is opened. A mock provider is the default during interface development; a real adapter maps external responses to the same normalized model.

### Data model: properties vs. listings

The same Florida home is often listed for sale and for rent at the same time, relisted after expiring, or listed by unit within a condo building. Personal data belongs to the **property**; price and status belong to the **listing**.

- **Property:** stable local ID; normalized address (street, unit, city, ZIP); coordinates; property type; beds; baths (total, plus full/half split when known); living area; lot size; year built; parcel ID when known; Florida cost and risk fields; photos I upload (local file path, source, date added). Notes, favorites, dismissals, ranking inputs, and uploaded photos are keyed here, so they survive a relisting.
- **Personal tags:** the custom tag list (text), and the property-to-tag links keyed to the property, with the date added. The standard tag list is part of the app, not the data.
- **Listing:** internal ID; property ID; provider and provider ID; MLS name and number when supplied; sale/rent mode; price and price period; status; HOA fee; image URLs where supplied and licensed; source URL when supplied; listing agent and office contact when supplied; provider's listed/removed/last-seen dates; local first-fetched and last-fetched times; per-field quality flags.
- **Search profile:** Buy/Rent mode and filters; location mode (`ZIP` or `Radius`); either the ZIP or the radius center's latitude and longitude, the entered street address when used, and the radius in miles. The resolved center is kept in the JSON backup so an imported search can run locally without resolving the address again.
- **Snapshot:** listing ID, fetch time, price, status.
- **Rent figure:** property ID; source (same home, local comps, or provider estimate); value and range; comp count and maximum distance; IDs of the comps used; calculated or fetched time.
- **Assumption sets:** one personal set per search profile; one local set per county or ZIP group (millage, typical non-ad valorem assessments, insurance and flood defaults), each with its source and the date it was set.
- **Cost entries:** per property, the figures and checks I enter (quotes, CDD and other assessments, special assessments, HOA confirmation, flood-policy choice, roof age), each with its state (including verified $0 and Not applicable), source, and date.
- **Raw payload:** stored separately for debugging, subject to the provider's retention terms.

**Property matching is part of v1**, because personal data surviving a provider switch depends on it. On import, normalize addresses (standard street suffix and unit designator abbreviations, case, and punctuation). An exact match on normalized address and unit links automatically. Ambiguous cases (same street address with a missing or different unit, or nearby coordinates with a different address) go to a review queue instead of being merged or duplicated silently.

### Security and cost controls

- Listing-provider credentials (RentCast) remain on the local server, never in browser code or Git.
- **The Google Maps key is the one exception**, because the Maps JavaScript API runs in the browser. It is entered in Settings and stored on the local server in the same ignored, API-local config file as the RentCast key; it stays out of the code bundle and Git; the local server sends it to the page at runtime; and in Google Cloud it is restricted to this app's localhost address and to the Maps JavaScript API. Settings shows only whether it is set, never the value.
- Google Maps bills each map load (see Data-source providers and costs). The Search screen and each opened property page load one map, so the free 10,000 a month is ample for one person, but check usage in the Google Cloud console and cap it there if needed. Map loads are not listing-provider requests and don't count against the request ceiling.
- A configurable monthly request ceiling is enforced in the app. A refresh that would exceed it is blocked and shown, because the provider may permit unlimited overages.
- Display request usage, the projected monthly total, and the timestamp of the latest successful refresh.
- **The usage display matches RentCast's own dashboard.** RentCast offers no way to read usage programmatically (no endpoint or header for requests used, plan limit, or days remaining; checked Oct 9, 2026), so the app counts for itself and mirrors what the dashboard shows. The header and Settings show: requests used, the local ceiling, and the plan's included requests (for example "18 of 45 ceiling · 50 included"); the billing period with days remaining and the reset date (for example "29 days left · resets Nov 7"); and the latest successful refresh. RentCast bills a request when it succeeds and not when it errors; the app counts every request it sends, so its figure can run higher by the number of errors, and a known error count is shown beside it.
- **Billing date and outside requests:** RentCast bills on the day of the month the plan was activated, and the dashboard shows the billing period. Settings has a billing-day field to match it. Requests made outside the app, such as the Milestone 0 pull script, are recorded as dated "outside requests" that count toward the ceiling and the display, so the app's total equals the dashboard's. Settings can also be given the dashboard's current "used" figure; the app shows the difference as an unexplained gap rather than hiding it. A refresh is judged against the matched total, not just the app's own count.
- Store results only within the provider's terms.

**Request budget:** one refresh of one saved search usually costs one request (RentCast returns up to 500 listings per request), plus one more per additional 500 results. Because local comparable rents come from Rent-mode data, each Buy area normally has a matching Rent-mode search, so saved searches come in pairs. The refresh interval therefore decides the plan tier:

| Setup | Requests/month (approx.) | RentCast tier |
|---|---:|---|
| 4 saved searches (one Miami-Dade and one Broward area × Buy and Rent), weekly refresh | ~22 | Developer (free, 50 included) |
| Same 4 saved searches, daily refresh | ~150 | Foundation ($74/month, 1,000 included) |
| 8 saved searches, daily refresh, some over 500 results | ~300 | Foundation |
| Provider rent estimates, on request | +1 per shortlisted property | Counts toward the same ceiling |

The Milestone 0 pull measured these (details in `docs/PROVIDER_EVALUATION.md`). In ZIP-sized sample areas, one refresh of the four searches cost 5 requests: the Broward Rent search returned 664 listings at $1,500–$4,000 and took two, and the other three took one each. That is 1.25 requests per search, so weekly is 5 × 4.3 ≈ 22 a month and daily is 5 × 30 = 150. The 8-search row is 8 × 1.25 × 30 and assumes the other four searches resemble the measured four. The count depends on the area and the price filters: every additional 500 results costs one more request, and whole-city searches in Miami or Fort Lauderdale may take several.

## Data-source providers and costs

Plan prices below are published USD prices checked on **October 6, 2026**; RentCast's field list and billing terms were rechecked on **October 7, 2026**. Prices can change. RentCast's coverage in Miami-Dade and Broward was tested in Milestone 0 (see Decisions made). Google Maps prices were checked on **October 8, 2026**. "Cost" here excludes taxes, optional enrichment, and hosting (the first version runs locally).

| Source | Role and fit | Published cost | Decision |
|---|---|---:|---|
| [RentCast API](https://www.rentcast.io/api) | Candidate primary feed. Separate sale and long-term rental listing searches with address, coordinates, property fields, HOA fee, status, listed/removed/last-seen dates, MLS name and number, listing agent and office contacts, and listing history; up to 500 listings per request. **Not included:** photos, a source listing URL, or a waterfront field; bathrooms come as a single decimal (for example 2.5), not a full/half split. Its [listing documentation](https://developers.rentcast.io/reference/property-listings) says data is not retrieved directly from MLS. Also offers a [long-term rent estimate](https://developers.rentcast.io/reference/rent-estimate-long-term) that returns an estimate, a range, and 5–25 comparable rentals with distance and last-seen date; each call is a request. | Developer: **$0/month, 50 requests**, then **$0.20/request**. Foundation: **$74/month, 1,000 requests**, then **$0.06/request**. Growth: **$199/month, 5,000 requests**, then **$0.03/request**. Scale: **$449/month, 25,000 requests**, then **$0.015/request**. | Milestone 0 passed it for purchase listings and failed it for finding rentals (see Decisions made). Its documentation says there are no hard usage caps, so enforce one locally. [Pricing/billing](https://developers.rentcast.io/reference/billing-and-pricing). |
| [Repliers](https://repliers.com/) | MLS-centered search API and UI tooling; useful comparison of capability, but its own FAQ says users need to be licensed real estate agents. | Preview with sample data **$0/month**; Standard **$199/month**, Professional **$299/month**, Advanced **$399/month** on monthly billing. MLS agreements may also be required. | Not a primary route for this personal, broker-independent project unless eligibility changes. |
| [ATTOM Developer Platform](https://api.developer.attomdata.com/dlpv2docs) | Potential property-record or valuation enrichment, not selected as the live listing feed. | Public self-service price for this exact use was **not verified**; obtain a quote before considering it. | Defer until a specific missing data need is proven. |
| [FEMA National Flood Hazard Layer](https://www.fema.gov/flood-maps/national-flood-hazard-layer) | Flood zone for a property's coordinates, via FEMA's GIS web services or the Flood Map Service Center address search. Flood zones do not capture all flood risk. | Free. | Use in v1 for shortlisted properties; confirm the web service's usage terms before automating lookups. |
| Florida county property appraiser, tax collector, and parcel sites (Miami-Dade and Broward first) | Parcel, tax, assessed value, millage rates, and ownership context for shortlisted properties. The tax bill also lists non-ad valorem assessments, such as CDD fees, which a millage calculation misses. These records do not establish live sale/rental availability. Availability and reuse methods vary by county. **Caution:** the current owner's tax bill usually reflects the homestead exemption and the Save Our Homes assessment cap; assessed value resets after a sale, so a buyer's bill can be much higher. Estimate taxes from the purchase price and the local millage rate instead. | Public lookup may be free; bulk/API access and permitted reuse must be checked county by county. | Add as source links first; integrate specific counties only after verifying access terms. |
| [Google Maps Platform](https://developers.google.com/maps/billing-and-pricing/pricing) | The base map (Maps JavaScript API) and each property's Street View link. The link is a [Maps URL](https://developers.google.com/maps/documentation/urls/get-started), which needs no API key. Google doesn't allow storing Street View images, apart from panorama IDs ([policies](https://developers.google.com/maps/documentation/streetview/policies)), so the app links to Street View instead of showing its images. | Dynamic Maps: **10,000 map loads/month free**, then **$7.00 per 1,000**. Maps URLs: no key; no charge found. Street View metadata: free, no cap. | Use in v1 for the map and the Street View link. |

**RentCast search fields (checked in its documentation Oct 9, 2026; no request was made).** Sale and long-term rental listing searches take: location as `address`, `city` with `state`, `zipCode`, or `latitude`, `longitude`, and `radius` (miles, maximum 100; `address` also works as the center); `propertyType` (Single Family, Condo, Townhouse, Manufactured, Multi-Family, Apartment, and Land for sale); `bedrooms`, `bathrooms`, `squareFootage`, `lotSize`, `yearBuilt`, and `price`, each as a range or list; `status` (Active or Inactive); `daysOld`; `limit` (1 to 500) and `offset`; and `includeTotalCount`, which returns the match count in a header. Results are ordered by last-seen date. **There is no amenity, pool, pet, garage, waterfront, or lease-term filter, and no such field in the results**; the only HOA item is the result's fee. The result record carries address, coordinates, county, the property facts above, price, listing type, the listed, removed, created, and last-seen dates, days on market, MLS name and number, listing agent and office contacts, and `history`. So pet, pool, and amenity searches are not possible from RentCast data; if wanted, they would be personal tags I enter on a property (see Open decisions).

RentCast's separate consumer "Pro" subscription is **not** its API subscription. The dashboard would use the API plan above. Avoid treating public real-estate websites as an automated feed: [Zillow](https://www.zillow.com/corporate/terms-of-use/) and [Realtor.com](https://www.realtor.com/terms-of-service/) restrict automated extraction and reuse. They remain useful for manual verification through links I click myself.

**Listing photos:** no API that returns MLS listing photos is open to a private individual here. Repliers, the Miami MLS feeds (Bridge and Trestle), Spark, and ATTOM all require MLS membership or an MLS-approved vendor license (checked Oct 8, 2026). Photos therefore come from me. I may save photos by hand from a listing page for a property I'm considering only where that site's terms allow it. [Redfin's](https://www.redfin.com/about/terms-of-use) MLS terms (§2.9.3) allow copying "in connection with your consideration of the purchase or sale of an individual property"; read Zillow's or Realtor.com's terms before saving from them. Saved photos stay on this computer and are never shared.

## Provider evaluation, before interface development

The data source is the biggest risk, and the free tier makes testing it cost nothing, so it comes first.

1. Choose one search area in each test-market county (Miami-Dade and Broward), such as a ZIP or a radius. Get a free RentCast API key.
2. Spend at most 40 of the 50 free requests (keep 10 in reserve) on sale and rental searches in those areas, including up to 5 rent-estimate calls on sample properties to compare against local comps. Save the raw responses locally within the provider's terms. Record which fields are actually populated (HOA fee, MLS number, agent contact, history), how often condo and townhome sale listings lack an HOA fee, and how many requests a typical search in each county takes.
3. **Coverage check (public → provider).** Within 24 hours of the provider pull, run the same area and filters on one public listing site. Number its active results in the order shown, remove duplicates and listings first published less than 48 hours before the pull (normal feed lag), and pick **10 per county and mode** with a random number generator, recording the seed.
   - **Found:** the provider's pulled data has the same property (normalized address and unit) in the same mode, in any status. Status and price are then compared separately.
   - A provider record with no unit counts as found only if beds and living area match the public listing; otherwise it is **not found**.
4. **Still-available check (provider → public).** Within 24 hours of the pull, have the app pick **10 of the provider's "active" results per county and mode** at random, recording the seed. Look each up by address, unit, and MLS number on at least two public listing sites and classify it:
   - **Available:** shown as active on a public site and not under contract.
   - **Not available:** pending, under contract, sold, rented, withdrawn, or expired.
   - **Not found:** no current listing on either site. **Counts as not available**, because the dashboard would send me after something I can't act on.
   - **Ambiguous:** can't tell which property or unit the record refers to. Counts as not available.

   No sampled listing is skipped or replaced.

   Steps 3 and 4 total 80 manual checks (10 × 2 counties × 2 modes × 2 directions). Record each in a sheet with: county, mode, direction, seed, address, unit, provider ID, public status, provider status, public price, provider price, classification, and time checked. The sheet is kept with the decision so the result can be re-scored.
5. **Scoring rules**, set now, before seeing results:
   - **Status agrees** when both sides fall in the same group: *Active*; *Under contract* (pending, contingent, accepting backup offers); *Off market* (sold, rented, withdrawn, expired).
   - **Price agrees** when the provider's price is within **1%** of the public price, in both modes. A larger gap, including a price change the provider hasn't picked up, is a disagreement.
   - Beds, baths, and HOA fee are recorded as field-quality notes, not scored.
   - **Required counts round up:** required = ceiling(threshold × number checked).
   - **Granularity:** 10 listings per county and mode is too small to judge each cell on a fine threshold, so sampled measures are judged **per mode with both counties pooled (20 listings)**, plus a **floor in each county-and-mode cell** so one county can't fail badly while hidden by the other. Measures computed over all pulled listings have enough data to be judged **in every county-and-mode cell**.

   | Measure | Computed over | Pass (per mode, counties pooled) | Floor (each county and mode) |
   |---|---|---|---|
   | Coverage | 20 sampled public listings | ≥ 16 found (80%) | ≥ 7 of 10 |
   | Still available | 20 sampled provider "active" results | ≥ 17 available (85%) | ≥ 8 of 10 |
   | Status agrees | Listings found in step 3 | ≥ 90% | — |
   | Price agrees, within 1% | Listings found in step 3 | ≥ 90% | — |
   | Freshness: last seen within 7 days | All pulled active listings | — | ≥ 90% in each cell |
   | Verification: MLS number or agent contact | All pulled active listings | — | ≥ 75% in each cell |

   **Borderline rule:** if a pooled sampled measure misses its required count by exactly one listing, check 10 more for that mode and direction (5 per county, new random picks) and judge on all 30 at the same percentage. This happens at most once per measure.
6. Decide explicitly whether a dashboard **without photos** is acceptable, given verification links to public pages.

**Decision rules:**

| Result | Decision |
|---|---|
| Every measure passes, in both modes, with every floor met | Go: build Milestones 1–3 on RentCast |
| Buy passes everything; Rent fails | Go for purchase listings. Rent-mode data may still feed local comps (a listing that has since been rented still shows market rent), but Rent-mode search is not relied on for finding rentals |
| One county fails a floor or a per-cell measure in a mode; the other county passes everything in that mode | Go in the passing county for that mode only, or test another provider for the failing county |
| Buy fails | The rent-vs-buy comparison needs purchase listings: test another provider, or fall back to **manual-add mode** (listings found elsewhere are entered by address; ranking, notes, rent-vs-buy, and Florida cost features still apply without a feed) |

**Synthetic fixtures:** after Milestone 0, build 30–50 synthetic Miami-Dade and Broward fixtures **shaped like the real responses**, covering:
- sale and rent; houses, and high-rise and older condos with units
- the same property listed for sale and rent at once
- status and price changes; missing fields; implausible values
- duplicate addresses and an ambiguous unit match
- flood zones X, AE, and VE
- a condo with a special assessment pending and no amount
- a purchase listing with fewer than 3 local rent comps
- a property outside the configured markets, with no local rates set
- a home in a CDD
- a single-family home with no HOA data (an Estimate total, not Incomplete)
- a condo with no HOA fee in its record but other units listed in the same building
- a verified $0 (tax bill shows no CDD) and a Not applicable line (no association)

(The current UI draft uses Tallahassee sample data; switch its samples to these.)

**Exit criterion:** the interface works fully with mock data; a real adapter can be swapped in by configuration; personal data survives the switch (tested with a property present in both the mock and live data); and the provider evaluation reports observed Florida results against the thresholds and actual request usage.

## Delivery milestones

| Milestone | Deliverable | Acceptance check |
|---|---|---|
| 0. Data check | Free-tier sample in Miami-Dade and Broward; populated-field inventory; requests per typical search; coverage and still-available checks; photo decision | Every measure scored with the scoring rules; decision taken from the decision table; record sheet and random seeds saved; request budget recalculated; $0 spent |
| 1. Interface and persistence | Buy/Rent search, map/list (Google Maps with the plain-map fallback), shortlist, notes, photo upload, Street View link, comparison, saved searches, property/listing model with matching and review queue, JSON export/import, all on mock data in SQLite | Complete core flow without an external account or API call (the map shows the plain-map fallback with no Google Maps key); restart the app and recover all personal state, including uploaded photos |
| 2. Refresh job and provider adapter | RentCast adapter behind `ListingProvider`, refresh job, snapshots, credentials stored locally, request ceiling and usage display | Same UI works with mock or live source by configuration; an over-budget refresh is blocked; notes survive switching from mock to live |
| 3. Florida cost and ranking | Rent-vs-buy estimate with basis labels, comparable rent sources, personal and local assumption sets, FEMA flood zone lookup, tax and CDD lines, insurance and condo fields, personal ranking weights | Every cost line and rent figure shows its state or source; a newly fetched single-family home in a configured county shows an Estimate total, never Incomplete; Incomplete appears only for the four defined triggers, with no own-vs-rent gap; fewer than 3 comps shows Unavailable; a property outside configured markets prompts for local rates; changing a weight reorders results; rank numbers match score order under every sort; unknown factors and flagged listings show provisional scores |
| 4. 30-day review | Actual requests vs. budget, stale rate, coverage gaps found in use | Decide to keep, upgrade the tier, replace, or supplement the provider |

**UI revision (plan 2.10)** is not a new milestone. Interface scope items 12–15 (sidebar, version, Settings, saved-search list, dark mode, property page map, launcher, matching the mock-ups) are built on top of Milestones 1–3 and checked by the "UI revision" table in `docs/ACCEPTANCE_CHECKS.md`. The Milestone 1–3 checks keep passing, with "Ranking & data" read as "Settings".

## Decisions made

- **Local form:** browser-based app on this computer, not a packaged desktop app. A desktop shortcut that starts the local servers and opens the browser is part of it (Oct 9, 2026, plan 2.10); it launches the same browser app and does not package it.
- **Offline:** cached results, history, and personal data are viewable offline; refreshing requires a connection.
- **Provider evaluation comes first** (Milestone 0), with thresholds, scoring rules, and decision rules fixed above.
- **Test market:** Miami and Fort Lauderdale (Miami-Dade and Broward counties).
- **No statewide cost defaults:** local tax, insurance, and flood figures are set per county or ZIP group.
- **Milestone 0 result (Oct 8, 2026):** RentCast passes every measure and floor for purchase listings in Miami-Dade and Broward. It fails the still-available measure for rentals (15 of 20 where 17 are required; Broward 7 of 10 where 8 are required). Decision-table row 2: go for purchase listings; Rent-mode data may still feed local comps, but Rent-mode search is not relied on for finding rentals. Counts, seeds, and sampling notes are in `docs/PROVIDER_EVALUATION.md`.
- **Photos:** a dashboard without photos is not acceptable (Oct 8, 2026), given verification links to public pages. RentCast supplies none, and no listing-photo API is open to a private individual (see Data-source providers and costs). So photos are ones I upload for a property, and each property has a Street View link (Oct 8, 2026). Cards must still read well without photos (Interface scope).
- **Map:** Google Maps (Maps JavaScript API), with a plain map of county borders and pins when no key is set (Oct 8, 2026). Its key is the one credential allowed in the browser, under the restrictions in Security and cost controls. Revised Oct 9, 2026 (plan 2.10): Google Maps is the intended map on both Search and the property page, and the plain map is only the no-key or offline stand-in; both frame the current results or the property rather than the whole state.
- **Radius search choices (Oct 9, 2026, plan 2.13):** street addresses resolve only against addresses of properties already stored, otherwise latitude and longitude are entered (no bundled address dataset, no Google geocoding); the free-text city search stays as a third location choice; a Buy and a Rent radius search pair only when they have the same center and radius.
- **Photos in backups (Oct 9, 2026, plan 2.13):** the JSON backup holds photo details only; the photo folder is backed up separately.
- **Launcher (Oct 9, 2026, plan 2.13):** start only, servers left running, no stop shortcut.
- **Rent mode (Oct 9, 2026, plan 2.13):** the Buy/Rent switch and Rent-mode searches stay; the Rent view is labelled "Rent data may be incomplete".
- **Saved searches (Oct 9, 2026, plan 2.13):** Settings holds the list (rename, delete); Search keeps its picker; the sidebar does not list saved searches.
- **Refresh interval (Oct 9, 2026, plan 2.13):** weekly, on the free tier (about 22 requests a month). Daily, on the $74/month Foundation tier, is to be reconsidered at the 30-day review.
- **Amenity data (Oct 9, 2026, plan 2.15):** RentCast has none, so pool, pets, waterfront, and similar are personal tags (standard selection plus custom), used as a filter and display only.
- **Navigation and settings (Oct 9, 2026, plan 2.10):** a collapsible sidebar on desktop, a Settings tab that replaces "Ranking & data", a saved-search list with Delete, light/dark/system appearance, and the app version in the sidebar (Interface scope, item 12).
- **Ranking factors and default weights (Oct 8, 2026):** Buy uses price / own-vs-rent cost / flood / HOA / insurance / living area at 25/20/20/15/10/10; Rent uses price / flood / lease fit / living area at 40/25/20/15. Factor formulas and Unknown rules are in Interface scope, item 4.

## Open decisions

- **RentCast radius search:** RentCast's documentation shows radius search (center as latitude and longitude, or an address; up to 100 miles), so our 0.1 to 25.0 mile range fits. Not yet verified: that a real radius request behaves as documented, and how many requests a 25-mile radius costs, since the plan wants each search under 500 listings per mode. RentCast is not called unless asked. Until a real radius request is made, the adapter declares radius support as unverified and the first radius refresh is treated as a measurement.
- **Search areas within the test market:** which ZIPs, radius centers, or neighborhoods in Miami-Dade and Broward, and the Buy price range and Rent budget for each. The Milestone 0 sample used ZIP 33009 (Broward) and ZIP 33138 (Miami-Dade); the areas the product will search are still to choose.
- **Personal assumptions:** down payment, mortgage rate and term, maintenance reserve percentage.
- **Local assumptions for Miami-Dade and Broward:** millage rate, typical non-ad valorem assessments, and homeowners and flood insurance defaults by zone. Insurance and flood defaults are best taken from one or two real quotes, since South Florida premiums vary widely.
- **Comparable-rent rules:** the defaults above (same type and bedrooms, area within 20%, within 1 mile, seen in 30 days, at least 3 comps) may need a tighter radius in dense Miami neighborhoods. Milestone 0 did not measure the radius; adjust once real comps are seen.

## Version history

- **2.15** · Oct 9, 2026 · Makes lot size, year built, and days on market first-version Search filters (local, kept in saved searches, with a visible count of listings left out for a missing value). Adds personal tags (standard selection plus custom, on the property, filterable, in the backup, not a ranking factor), closing the amenity-filter question. Names a Settings "RentCast usage" section for entering and checking the dashboard figures. Makes Settings sections reorderable by drag, with a keyboard and phone alternative and a reset, saved on this computer. Minor bump: filters, a data type, and a setting are added; nothing built is invalidated.
- **2.14** · Oct 9, 2026 · Records the review of RentCast's search fields and billing documentation: it supports radius, lot size, year built, and days on market filters, has no amenity, pool, pet, or waterfront data, and offers no usage endpoint. Makes the request display match the RentCast dashboard (days remaining, requests used, plan size, billing date), with recorded outside requests so the Milestone 0 pull no longer causes a mismatch. Closes the RentCast radius question on paper (still unmeasured) and opens one on amenity tags. Minor bump: rules, labels, and filters are added or changed; nothing built is invalidated.
- **2.13** · Oct 9, 2026 · Records eight decisions, closing seven open ones: street addresses resolve only against stored property addresses (otherwise latitude and longitude); city text search stays beside ZIP and Radius; a Buy and a Rent radius search pair only on the same center and radius; backups carry photo details but not photo files; the launcher only starts the app; Rent mode stays, labelled "Rent data may be incomplete"; the sidebar does not list saved searches; and the refresh interval is weekly on the free tier. The RentCast radius question stays open. Minor bump: decisions and a label are added; nothing built is invalidated.
- **2.12** · Oct 9, 2026 · Makes ZIP and Radius the explicit first-version location modes (from a Codex proposal written against plan 2.5, ported here because it used a version number already taken). Radius is 0.1 to 25.0 miles from latitude/longitude or a locally resolved street address; saved searches keep the mode, entered address, resolved center, and radius; searching stays local-only; an adapter that cannot refresh a radius search is blocked, not broadened. Adds open decisions on the local address resolver and radius details. Minor bump: rules and labels are added; the current "City or ZIP" field is not removed.
- **2.11** · Oct 9, 2026 · Adds renaming of saved searches (Settings, and the Search screen's update form) with the rules for a valid name and what a rename leaves unchanged. Minor bump: a rule and label are added; the current app already renames in place, so nothing built is invalidated.
- **2.10** · Oct 9, 2026 · Adds the UI revision from review of the built app: a collapsible sidebar with the app version; a Settings tab replacing "Ranking & data" and collecting configuration sections; a saved-search list with Delete; dark mode; a desktop launcher; Google Maps as the intended map (the plain map only a no-key or offline stand-in, framed on the results), with the Maps key entered in Settings; the Street View link and a Google map at the top of the property page; ranking weights as sliders and map pins matching the mock-ups; and a contrast rule for every control, which records the unreadable "Search this address" button as a defect. Minor bump: rules, defaults, and labels are added or changed, and nothing built is invalidated beyond renaming the screen.
- **2.9** · Oct 9, 2026 · Defines listing-field implausibility flags, confirmation and sourced property overrides, backup persistence, and optional per-county price-per-square-foot ranges. Minor bump because it adds local-assumption and trust-cue rules.

The version line at the top is `MAJOR.MINOR`. Decide the bump for every change to this document:

- **Major** (2.6 → 3.0): product scope, architecture rules, the data model, or the milestone list changes in a way that can invalidate work already built.
- **Minor** (2.6 → 2.7): a rule, threshold, label, default, or decision is added or changed.
- **No bump:** wording, typo, formatting, or link fixes that don't change what any rule means.

When the version changes:

1. Update the version line and date at the top, and add an entry below, newest first, saying what changed.
2. Recheck the documents that follow this plan: `docs/UI_SPEC.md`, `docs/ACCEPTANCE_CHECKS.md`, `fixtures/sample-data.json` (its `planVersion` field), and `AGENTS.md`. Update the plan version each one names only after it agrees with this document.
3. Run `node fixtures/check-fixtures.mjs`. It fails while `planVersion` differs from the version line above.

Git history holds version 2.3 onward. Numbers before 2.4 were assigned on October 7, 2026 to revisions that had been named by order ("second revision" and so on); the bump rule applies from 2.4 on.

- **2.8** · Oct 8, 2026 · Resolves the ranking decision using the fixture's Buy and Rent factor sets and default weights, and defines each factor's inputs, 0–100 scoring rule, and Unknown behavior. Existing fixture factor values remain hand-set examples until Issue 35 implements score computation. Minor bump because a product rule and default weights are set; this does not invalidate Milestone 1 or 2 work.
- **2.7** · Oct 8, 2026 · Decides photos and the map, closing the photo-source open decision. No listing-photo API is open to a private individual (each needs MLS membership or an MLS-approved vendor license), so photos are ones I upload for a property, stored locally and keyed to the property, and each property has a Street View link built as a Google Maps URL (no key, no request). The map is Google Maps (Maps JavaScript API); without a key it shows county borders and pins from local data, so Milestone 1 still needs no outside account. The credentials rule now names listing providers, and the Google Maps key is the one browser-side exception: kept out of the bundle and Git, served at runtime, and restricted to localhost and the Maps JavaScript API. Adds Google Maps to the providers table, photo upload and the Street View link to Milestone 1, a later item for aiming the Street View link at the house, and an open decision on photos in backups. Minor bump: no app code exists yet, so nothing built is invalidated.
- **2.6** · Oct 8, 2026 · Records the Milestone 0 result: RentCast passes every measure for purchase listings and fails the still-available measure for rentals, so decision-table row 2 applies (go for purchase listings; Rent-mode search not relied on for finding rentals). A dashboard without photos is not acceptable. Closes the open decision on photo-less results and opens two: the source of photos, and how the interface treats Rent mode. Marks the refresh interval as ready to decide. No rule or threshold changes; no work built on the earlier text is invalidated, since no app code exists yet.
- **2.5** · Oct 7, 2026 · Request budget recalculated from the Milestone 0 pull, which measured 5 requests per refresh of the four-search setup (Broward Rent returned 664 listings and took two): weekly is about 22 requests a month (was ~17) and daily about 150 (was ~120). The tiers are unchanged, and the refresh interval stays an open decision. No Milestone 0 result is recorded here yet; those are in `docs/PROVIDER_EVALUATION.md` as a draft.
- **2.4** · Oct 7, 2026 · Adds this version number and bump rule. Sets the order in which an Estimate label names the lines to verify (Rent vs. buy estimate, Total status).
- **2.3** · Oct 7, 2026 · *Was "fourth revision."* Non-ad valorem lines in a county without local rates are Unknown unless the tax bill has been checked; a property's own Quote or Document always outranks county rates; townhomes use the house insurance default; Estimate labels count unnamed lines as "+n".
- **2.2** · Oct 7, 2026 · *Was "third revision."* Cost lines now have precise rules for when an amount is firm, an Estimate, a verified $0, Not applicable, or Unknown, so Incomplete totals are limited to four defined triggers; the provider test now has sampling, price-tolerance, not-found, rounding, per-county floor, and decision rules, so the Milestone 0 result can be reproduced.
- **2.1** · Oct 7, 2026 · *Was "second revision," after UI draft review.* Comparable rent now has defined sources, matching rules, labels, and an "Unavailable" state; every cost line shows its basis, and totals become "Estimate" or "Incomplete" instead of looking exact; rank numbers always follow score order; unknown factors and flagged listings make a score provisional; the provider test also checks whether "active" results are still available; assumptions are split into personal and local sets, with no statewide defaults; CDD fees and other non-ad valorem assessments are a separate cost line. The test market is set to Miami and Fort Lauderdale (Miami-Dade and Broward counties).
- **2.0** · Oct 7, 2026 · The provider data check now comes first (Milestone 0); provider calls happen only in a refresh job, never during browsing; properties and listings are separate records so personal data survives a provider switch; RentCast's confirmed field gaps (no photos, no source URL) are designed around; Florida cost and risk factors, rent-vs-buy comparison, and personal ranking move into the first usable version; provider pass/fail thresholds are set before testing.
- **1.0** · Oct 6, 2026 · First version, saved as `PERSONAL_REAL_ESTATE_DASHBOARD_PLAN.2026-10-06.md` (not in this repository).

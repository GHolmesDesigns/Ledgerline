# Local county boundaries

`florida-counties.geojson` contains the Miami-Dade, Broward, and Palm Beach County polygons used by the no-key map.

- Source: U.S. Census Bureau, TIGERweb `TIGERweb/State_County` service, BAS 2026 counties layer (layer 19), retrieved October 8, 2026.
- Query: Florida county GEOIDs 12086, 12011, and 12099; output in WGS 84 (EPSG:4326), generalized for display.
- Census Bureau TIGER/Line geographic data is public domain. Source information: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html

The map renders this checked-in file locally. It does not request map tiles or boundary data from Census at runtime.

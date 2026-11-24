# Milano Liscio

Bike routes in Milan that avoid sett paving (pavé) and tram rails. An installable web app for iPhone: map, address search and routing run on the phone and keep working without network after the first download.

**App:** https://Gunball8.github.io/milano-liscio/ — open it in Safari, then Share → *Add to Home Screen* (the app needs to be installed to keep its data and work offline).

## What it does

- Four detour tolerance levels: Court, Équilibré, Lisse, Zéro pavé. Each request also shows the shortest route and the level-3 route for comparison, with metres of pavé, metres along rails and shallow rail crossings.
- Embedded tram rails are detected spatially: OpenStreetMap maps rails as separate ways and no Milanese street carries `embedded_rails`, so rails near the axis of a carriageway (3 m) mark it.
- Live GPS tracking with screen wake lock, off-route recalculation and a report button.
- Personal corrections (surface, rails) stored on the phone, applied at the next calculation, exportable as JSON or as GeoJSON to fix OpenStreetMap by hand.

The interface is in French. The brief is in [SPEC.md](SPEC.md) (French); data audit and calibration in [docs/](docs/).

## Build

Requirements: Node 22+, pnpm, `osmium-tool` and `pmtiles` (Homebrew).

```
pnpm install
pnpm data:build      # OSM extract → graph, geocoder, basemap, manifest (public/data/)
pnpm test            # unit tests
pnpm e2e             # Playwright, iPhone viewport, WebKit + Chromium
pnpm run deploy      # GitHub Pages
```

## Data and credits

- Streets, surfaces, rails and addresses: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Extract by [Geofabrik](https://download.geofabrik.de/).
- Basemap: [Protomaps](https://protomaps.com) daily build; fonts Noto (OFL), sprites from protomaps/basemaps-assets.
- Map rendering: [MapLibre GL JS](https://maplibre.org).

No backend, no account, no telemetry: favourites, corrections and reports never leave the phone.

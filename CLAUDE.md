# Milano Liscio

Offline bike routing for Milan that avoids sett paving and tram rails. iPhone PWA, static hosting.

- **The brief is `SPEC.md`.** Read it before writing code. Work phase by phase (§11) and stop at each **STOP** milestone for validation.
- Conversation and UI in French; code, identifiers and commits in English.
- Package manager: pnpm. Node ≥ 22. Scripts run with `tsx`.
- `src/core/` is pure TypeScript (no DOM, no Node APIs), shared by the build scripts and the routing worker.
- `scripts/lib/` holds build-only helpers (Overpass client, edge splitting, spatial rail detection, polygons).
- Bulk OSM data comes from the Geofabrik Italy Nord-Ovest extract cut with osmium (Overpass was saturated on 2026-11-24; see docs/audit-notes.md). Raw files live in `data/raw/` (git-ignored). Always work from the cache once fetched; refetch only with `pnpm data:fetch --force`.
- Overpass: the main instances were saturated on 2026-11-24; the VK mirror (`maps.mail.ru`) is tried first. Don't hammer: the client already retries with backoff. Responses with OSM data older than 7 days are rejected (`overpass.private.coffee` served data frozen at 2026-05-31 and was dropped).
- Generated files not committed: `docs/*.data.js`, `public/data/`, `out/`. `docs/audit.md` and `docs/calibration.md` are generated too: comments go in `docs/audit-notes.md` / `docs/calibration-notes.md`.
- Real-graph tests (`tests/milan-graph.test.ts`) are skipped until `pnpm data:graph` has run.
- Readable deliverables (reports, captures) are also copied to the owner's documents folder outside the repo (see the assistant's memory); that folder is cloud-synced, so no code there.
- No personal addresses in the repo. No backend, no telemetry.

## Commands

```
pnpm data:fetch      # phase 0: boundaries via Overpass, bulk from the Geofabrik extract (needs `brew install osmium-tool`)
pnpm data:fetch --refresh          # same, with a newer Geofabrik extract
pnpm data:fetch --source=overpass  # bulk via Overpass instead
pnpm data:audit      # phase 0: write docs/audit.md + docs/audit-map.data.js
pnpm data:graph      # phase 1: build public/data/milano-graph.bin
pnpm data:build      # fetch + graph
pnpm route "45.4642,9.19" "45.452,9.177" --level 2   # CLI router, writes out/route.geojson
pnpm calibrate       # phase 1: docs/calibration.md + docs/calibration-map.html data
pnpm data:graph also writes public/data/milano-ways.bin (OSM tags per graph way, for the Corrections sheet)
pnpm data:geocoder   # phase 3: public/data/milano-geocoder.bin (streets, house numbers, places)
pnpm data:basemap    # phase 2: public/data/milano.pmtiles + local fonts/sprites (needs `brew install pmtiles`)
pnpm data:manifest   # phase 2: public/data/manifest.json (version, sizes, SHA-256)
pnpm dev             # app on localhost (no service worker in dev)
pnpm build && pnpm preview   # production build with service worker
pnpm e2e             # Playwright, iPhone viewport, WebKit + Chromium (builds first)
pnpm data:refresh    # monthly: newer Geofabrik extract and Protomaps build, rebuild everything
pnpm run deploy      # GitHub Pages: build under /milano-liscio/, force-push dist/ to gh-pages (single commit)
pnpm test            # vitest
pnpm typecheck       # tsc --noEmit
```

The audit map is `docs/audit-map.html` (open in a browser, needs `audit-map.data.js` next to it).

## App notes

- `src/app` (React + zustand), `src/storage/dataCache.ts` (download, SHA-256 check, versioned caches `data-<version>`), `src/sw.ts` (injectManifest: precaches shell, fonts, sprites; serves `/data/*` from cache).
- Data URLs carry `?v=<version>` so two versions never mix in caches.
- MapLibre 6 resolves its worker next to its own module, which breaks once bundled: `src/app/map/pmtiles.ts` imports `maplibre-gl/dist/maplibre-gl-worker.mjs?url` and calls `setWorkerUrl` (and `.mjs` is in the precache glob).
- PMTiles are read from a Blob through `FileSource` (key = file name `milano.pmtiles`), never via HTTP range requests.
- Graph format v2: edge geometry stores interior points only; use `edgeLngLats()` for full polylines.
- Read the installed package types before touching MapLibre, pmtiles, @protomaps/basemaps or vite-plugin-pwa integration (SPEC §0).
- Routing runs in `src/worker/router.worker.ts` (graph + geocoder from the data cache); the UI talks to it through `src/app/routing/client.ts` (typed messages in `src/worker/protocol.ts`).
- Long press: our own 550 ms timer (iOS fires no contextmenu on touch) plus MapLibre's `contextmenu` (desktop right click, Chromium long touch). The menu backdrop closes on pointerdown, not click, or releasing the press would close it.
- Real-touch long press is only testable in Chromium (CDP); check it on the iPhone during phase 6.
- Tracking (phase 4): pure logic in `src/core/tracking.ts` (RouteTracker, OffRouteDetector, courseFrom) and `src/core/screenLock.ts` (wake lock with injected API, unit tested); browser side in `src/app/tracking/session.ts`.
- Fix times come from `Date.now()` at reception: position timestamps are in microseconds in Playwright's WebKit. Emulated fixes carry no heading or speed, so the course is derived from successive fixes.
- Position and course are published in one store update; otherwise the map follows a new position with the previous bearing.
- Not testable headless: wake lock (denied in test browsers) and resume after lock screen; both are on the phase 6 checklist.
- Corrections (phase 5): model and re-attachment in `src/core/corrections.ts` (same way near the stored midpoint within 25 m, else same name within 100 m, else orphan; identical to OSM = obsolete). One record per edge; a whole-street action creates one per edge, grouped in the list by name + values + time.
- Every screen publishes the height of its bottom element as `--panel-h` (`usePanelHeight`): the map attribution sits above it. Without that, the attribution floated mid-screen in Corrections and swallowed taps.
- Attribution links open in a new tab: in the installed app a plain link would replace the map.
- File export: iOS share sheet when it accepts files, else a download; e2e forces the download path with localStorage `liscio.downloadOnly`.
- Published at https://gunball8.github.io/milano-liscio/ (public repo, gh-pages branch rewritten on each deploy). Never push tags: a local backup tag points to pre-publication history.
- Design (2026-11-25): tokens and glass surfaces in `src/app/styles.css`, icons in `components/Icon.tsx`. One level choice: four cards (all four levels computed per request, ~2 ms more) instead of the brief's selector + alternatives, which users found redundant.
- Position marker: `map/meLayer.ts`, arrow turned by the compass (`app/compass.ts`, permission asked from a tap: locate button or Démarrer), else by the course while tracking; dot when no direction. Chromium also has `DeviceOrientationEvent.requestPermission`, so tests grant accelerometer/gyroscope/magnetometer.
- Map attribution is bottom-left (the locate button is bottom-right).
- Closed gates (barrier + access=private/no, locked=yes, bicycle=no, turnstiles) cut the graph: split there, ends not connected (`barrierBlocksBikes`, 625 on the network). Audit report: `docs/audit-app.md`.
- `pnpm data:graph` and `pnpm data:geocoder` refresh the manifest; `pnpm run deploy` refuses data that does not match it (a stale SHA-256 makes the app refuse the download).
- Every e2e test runs under a console guard (`e2e/fixtures.ts`): any JS error or console error/warning fails it. Import `test`/`expect` from `./fixtures.ts`, not from `@playwright/test`.
- Hot paths are typed-array loops checked against reference implementations (`tests/optimized-equivalence.test.ts`): `computeArcCostsMulti` (all levels in one pass), `SnapIndex` (CSR grid), `EdgeLookup.edgesInBox` (coarse grid).
- Missing basemap icons go through `map.setMissingStyleImageResolver` (MapLibre 6); old data versions are deleted only after the map loaded the new one (`deleteOtherVersions`).

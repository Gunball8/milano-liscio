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
pnpm data:geocoder   # phase 3: public/data/milano-geocoder.bin (streets, house numbers, places)
pnpm data:basemap    # phase 2: public/data/milano.pmtiles + local fonts/sprites (needs `brew install pmtiles`)
pnpm data:manifest   # phase 2: public/data/manifest.json (version, sizes, SHA-256)
pnpm dev             # app on localhost (no service worker in dev)
pnpm build && pnpm preview   # production build with service worker
pnpm e2e             # Playwright, iPhone viewport, WebKit + Chromium (builds first)
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

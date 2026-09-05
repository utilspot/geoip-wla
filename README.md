# geoip-wla

A small **TypeScript + React** UI for a GeoIP address-lookup service, plus a
dependency-free **JS emulation server** that mimics the
[`geoip-api-c`](https://github.com/maxmind/geoip-api-c) library so the UI can be
developed and demoed without the real backend.

All requests and responses are **JSON**.

![GeoIP Lookup UI showing a resolved result for 8.8.8.8](docs/screenshot.png)

## Layout

```
src/            TypeScript/React source for the client
  index.html      HTML template (copied to dist as-is)
  index.tsx       entry point
  App.tsx         UI
  api.ts          JSON fetch client
  types.ts        response types (mirror geoip-api-c's GeoIPRecord)
  styles.css      styles (bundled into the hashed CSS file)
  favicon.svg     favicon (copied to dist)

server/         JS emulation server (no npm dependencies)
  server.js       Node http server, returns hardcoded JSON
  presets.js      the hardcoded response presets
  admin.html      admin page to pick the active preset (part of the server)

dist/           build output — client files only
  index.html
  index-<hash>.js       bundled app (React inlined)
  index-<hash>.css      bundled styles
  favicon.svg
  manifest.json         asset manifest (name, base URL, entries, file map)

build.mjs       esbuild build script (no framework CLI)
docs/           screenshot used in this README
```

`dist/` contains **only client files**. `admin.html` lives in `server/` because
it is part of the server.

## Requirements

- Node.js 18+ (uses only built-in modules on the server side)

## Install

```
npm install
```

Every dependency is in **`devDependencies`** — `react`/`react-dom` are bundled
into the hashed JS file at build time, and nothing is needed at runtime by the
client. The emulation server uses only Node built-ins.

## Build the client

```
npm run build      # -> dist/{index.html, index-<hash>.js, index-<hash>.css, favicon.svg, manifest.json}
npm run watch      # rebuild on change (unhashed names)

# served under a path prefix — accepted by build, watch and dev
# (CMake passes it to `npm run build`):
npm run build --base-url=/geoip/
npm run dev   --base-url=/geoip/
```

`--base-url` may also be given as a direct script argument
(`node build.mjs --base-url=/geoip/` or `npm run build -- --base-url=/geoip/`).
It sets `manifest.base`, `main` and every URL in `manifest.json`, and the asset
references in `dist/index.html`.

## Run the emulation server

```
npm run server     # http://localhost:8787  (set PORT to change)
```

It serves the built `dist/` at `/`, so open <http://localhost:8787/>.
`npm run dev` builds once and then starts the server.

## Changing the returned JSON

Open <http://localhost:8787/admin.html>, pick a preset, and click **Apply
preset**. Every subsequent `POST /lookup` returns that preset's JSON until you
change it again. Presets are defined in [`server/presets.js`](server/presets.js);
the selection is held in memory and resets to the default on restart.

## API

### `POST /lookup`

Request:

```json
{ "ip": "8.8.8.8" }
```

Response (preset `us-mountain-view`):

```json
{
  "ip": "8.8.8.8",
  "preset": "us-mountain-view",
  "found": true,
  "library": "GeoIP-1.6.12",
  "database": "GeoIPCity.dat",
  "database_build": "GEO-533LITE 20240604 Build 1",
  "record": {
    "country_code": "US",
    "country_code3": "USA",
    "country_name": "United States",
    "region": "CA",
    "region_name": "California",
    "city": "Mountain View",
    "postal_code": "94043",
    "latitude": 37.4056,
    "longitude": -122.0775,
    "dma_code": 807,
    "area_code": 650,
    "metro_code": 807,
    "continent_code": "NA",
    "time_zone": "America/Los_Angeles",
    "netmask": 24,
    "network_start": "8.8.8.0",
    "network_end": "8.8.8.255"
  }
}
```

`record` mirrors `geoip-api-c`'s `GeoIPRecord` struct, plus `time_zone`
(`GeoIP_time_zone_by_country_and_region`) and `network_start`/`network_end`
(`GeoIP_range_by_ip`, IPv4 only). `database_build` mirrors `GeoIP_database_info`
and `library` is `"GeoIP-" + GeoIP_lib_version()`.

When the address is not in the database, `record` is `null` and `found` is
`false` — this mirrors `GeoIP_record_by_addr()` returning `NULL` in
`geoip-api-c`.

`GET /lookup?ip=8.8.8.8` is also accepted for quick testing.

### Admin endpoints

| Method & path            | Purpose                                  |
| ------------------------ | ---------------------------------------- |
| `GET /api/admin/presets` | list all presets + the active one        |
| `GET /api/admin/state`   | active preset id + its response          |
| `POST /api/admin/state`  | `{ "preset": "<id>" }` — switch presets  |
| `GET /api/health`        | liveness probe                           |

## How the real server maps to `geoip-api-c`

The `record` fields correspond directly to the `GeoIPRecord` struct in
`geoip-api-c`'s `GeoIPCity.h`. A real implementation would roughly do:

```c
GeoIP *gi = GeoIP_open("GeoIPCity.dat", GEOIP_MEMORY_CACHE);
GeoIPRecord *r = GeoIP_record_by_addr(gi, ip);
/* serialize r (or null) to the JSON shape above */
GeoIPRecord_delete(r);
GeoIP_delete(gi);
```

The emulation server just returns a frozen version of that JSON, selectable from
`admin.html`.

'use strict';

/**
 * Hardcoded response presets for the emulation server.
 *
 * The real service will call the `geoip-api-c` library
 * (https://github.com/maxmind/geoip-api-c) under the hood. That library opens a
 * MaxMind `.dat` database and, for a given address, returns either:
 *
 *   - a `GeoIPRecord` struct  (GeoIP_record_by_addr), or
 *   - `NULL`                  when the address is not in the database.
 *
 * Each preset below is one such outcome, frozen as JSON. Switching presets from
 * admin.html is the emulation-time equivalent of swapping the `.dat` file /
 * looking up a different address. The `record` object uses the same field names
 * as `GeoIPRecord` in geoip-api-c's `GeoIPCity.h`, plus `time_zone` (from
 * `GeoIP_time_zone_by_country_and_region`) and `network_start`/`network_end`
 * (from `GeoIP_range_by_ip`). `database_build` mirrors `GeoIP_database_info`.
 */

/** @typedef {import('./presets.js')} */

const presets = [
  {
    id: 'us-mountain-view',
    label: 'United States — Mountain View, CA',
    description: 'Full city-level record, as read from GeoIPCity.dat.',
    response: {
      found: true,
      library: 'GeoIP-1.6.12',
      database: 'GeoIPCity.dat',
      database_build: 'GEO-533LITE 20240604 Build 1',
      record: {
        country_code: 'US',
        country_code3: 'USA',
        country_name: 'United States',
        region: 'CA',
        region_name: 'California',
        city: 'Mountain View',
        postal_code: '94043',
        latitude: 37.4056,
        longitude: -122.0775,
        dma_code: 807,
        area_code: 650,
        metro_code: 807,
        continent_code: 'NA',
        time_zone: 'America/Los_Angeles',
        netmask: 24,
        network_start: '8.8.8.0',
        network_end: '8.8.8.255',
      },
    },
  },
  {
    id: 'de-berlin',
    label: 'Germany — Berlin',
    description: 'City-level record for a European address.',
    response: {
      found: true,
      library: 'GeoIP-1.6.12',
      database: 'GeoIPCity.dat',
      database_build: 'GEO-533LITE 20240604 Build 1',
      record: {
        country_code: 'DE',
        country_code3: 'DEU',
        country_name: 'Germany',
        region: 'BE',
        region_name: 'Land Berlin',
        city: 'Berlin',
        postal_code: '10117',
        latitude: 52.5244,
        longitude: 13.4105,
        dma_code: 0,
        area_code: 0,
        metro_code: 0,
        continent_code: 'EU',
        time_zone: 'Europe/Berlin',
        netmask: 20,
        network_start: '85.214.128.0',
        network_end: '85.214.143.255',
      },
    },
  },
  {
    id: 'jp-tokyo',
    label: 'Japan — Tokyo',
    description: 'City-level record for an Asian address.',
    response: {
      found: true,
      library: 'GeoIP-1.6.12',
      database: 'GeoIPCity.dat',
      database_build: 'GEO-533LITE 20240604 Build 1',
      record: {
        country_code: 'JP',
        country_code3: 'JPN',
        country_name: 'Japan',
        region: '13',
        region_name: 'Tokyo',
        city: 'Tokyo',
        postal_code: '100-0001',
        latitude: 35.6893,
        longitude: 139.6899,
        dma_code: 0,
        area_code: 0,
        metro_code: 0,
        continent_code: 'AS',
        time_zone: 'Asia/Tokyo',
        netmask: 18,
        network_start: '133.11.0.0',
        network_end: '133.11.63.255',
      },
    },
  },
  {
    id: 'au-sydney',
    label: 'Australia — Sydney',
    description: 'City-level record in the southern hemisphere.',
    response: {
      found: true,
      library: 'GeoIP-1.6.12',
      database: 'GeoIPCity.dat',
      database_build: 'GEO-533LITE 20240604 Build 1',
      record: {
        country_code: 'AU',
        country_code3: 'AUS',
        country_name: 'Australia',
        region: 'NSW',
        region_name: 'New South Wales',
        city: 'Sydney',
        postal_code: '2000',
        latitude: -33.8591,
        longitude: 151.2002,
        dma_code: 0,
        area_code: 0,
        metro_code: 0,
        continent_code: 'OC',
        time_zone: 'Australia/Sydney',
        netmask: 16,
        network_start: '1.128.0.0',
        network_end: '1.128.255.255',
      },
    },
  },
  {
    id: 'fr-country-only',
    label: 'France — country only (GeoIP.dat)',
    description:
      'Country database: only the country-level fields are populated, the rest are null.',
    response: {
      found: true,
      library: 'GeoIP-1.6.12',
      database: 'GeoIP.dat',
      database_build: 'GEO-106FREE 20240604 Build 1',
      record: {
        country_code: 'FR',
        country_code3: 'FRA',
        country_name: 'France',
        region: null,
        region_name: null,
        city: null,
        postal_code: null,
        latitude: null,
        longitude: null,
        dma_code: null,
        area_code: null,
        metro_code: null,
        continent_code: 'EU',
        time_zone: null,
        netmask: 14,
        network_start: '2.0.0.0',
        network_end: '2.15.255.255',
      },
    },
  },
  {
    id: 'not-found',
    label: 'Not found (NULL record)',
    description: 'Emulates GeoIP_record_by_addr() returning NULL — no data for the address.',
    response: {
      found: false,
      library: 'GeoIP-1.6.12',
      database: 'GeoIPCity.dat',
      database_build: 'GEO-533LITE 20240604 Build 1',
      record: null,
    },
  },
  {
    id: 'private-range',
    label: 'Private / reserved range',
    description:
      'Reserved address block (RFC 1918 / loopback). No GeoIP database has an entry.',
    response: {
      found: false,
      library: 'GeoIP-1.6.12',
      database: 'GeoIPCity.dat',
      database_build: 'GEO-533LITE 20240604 Build 1',
      record: null,
    },
  },
];

const DEFAULT_PRESET_ID = 'us-mountain-view';

module.exports = { presets, DEFAULT_PRESET_ID };

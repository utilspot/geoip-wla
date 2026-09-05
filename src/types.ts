// Shape of the data returned by the GeoIP service.
//
// `record` mirrors the fields of the `GeoIPRecord` struct from geoip-api-c
// (MaxMind legacy GeoIP C API, see GeoIPCity.h). A `null` record corresponds to
// `GeoIP_record_by_addr()` returning `NULL` (address not in the database).

export interface GeoIpRecord {
  country_code: string | null;
  country_code3: string | null;
  country_name: string | null;
  region: string | null;
  region_name: string | null;
  city: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  dma_code: number | null;
  area_code: number | null;
  metro_code: number | null;
  continent_code: string | null;
  /** IANA time zone, e.g. "America/Los_Angeles". */
  time_zone: string | null;
  netmask: number | null;
  /** First/last address of the matched netblock (IPv4 only). */
  network_start: string | null;
  network_end: string | null;
}

export interface GeoIpResponse {
  /** The address that was looked up (echoed back by the service). */
  ip: string | null;
  /** Whether a record was found for the address. */
  found: boolean;
  /** Underlying library, as "GeoIP-<version>" (from GeoIP_lib_version()). */
  library?: string;
  /** Which GeoIP `.dat` database the (emulated) library read from. */
  database: string;
  /** Database build string (edition + date), when the service reports it. */
  database_build?: string | null;
  /** Emulation-only: the id of the preset the emulation server is serving. Absent from the real service. */
  preset?: string;
  record: GeoIpRecord | null;
}

export interface ApiErrorBody {
  error: string;
}

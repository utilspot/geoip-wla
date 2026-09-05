#include "config.h"

#define NQ_LOG_TAG "geoip"

#include <libnetq/Log.h>
#include <libnetq/String.h>
#include <libnetq/Library.h>
#include <libnetq/fs/Path.h>
#include <libnetq/ErrorCode.h>
#include <libnetq/http/HttpHeader.h>
#include <libnetq/http/HttpMethod.h>
#include <libnetq/http/HttpStatus.h>
#include <libnetq/http/MediaType.h>
#include <libnetq/Module.h>
#include <libnetq/Malloc.h>
#include <libnetq/ByteBuffer.h>
#include <libnetq/MinMax.h>
#include <libnetq/JSON.h>
#include <libnetq/http/HttpRequest.h>
#include <libnetq/web/WebRequest.h>
#include <libnetq/web/WebResponse.h>
#include <libnetq/web/WebServer.h>
#include <libnetq/web/WebManifest.h>
#include <libnetq/Mutex.h>

#include <GeoIP.h>
#include <GeoIPCity.h>

typedef struct WebGeoipExecutor WebGeoipExecutor;
struct WebGeoipExecutor {
  NQWebExecutor executor;
  NQWebManifestListeners manifestListeners;
  struct NQWebRequestListener lookupListener;
};

/* Per-request state: the request body plus a link back to the executor. */
typedef struct LookupContext LookupContext;
struct LookupContext {
  struct WebGeoipExecutor* geoip;
  NQByteBuffer body;
};

#ifdef GEOIP_CITYV4_DAT
static GeoIP* s_geoipv4 = NULL;
static NQ_MUTEX_DEFINE(s_mutex4);
#endif

#ifdef GEOIP_CITYV6_DAT
static GeoIP* s_geoipv6 = NULL;
static NQ_MUTEX_DEFINE(s_mutex6);
#endif

static bool responseJsonWrite(void* userdata, const char* characters, size_t size)
{
  NQWebResponse* response = (NQWebResponse*)userdata;
  return NQWebResponse_write(response, characters, size) >= 0;
}

static int writeError(NQWebResponse* response, int status, const char* kind, const char* message)
{
  NQJSONWriter writer;
  NQJSONWriter_init(&writer, &responseJsonWrite, response);
  NQJSONWriter_writeObjectBegin(&writer);
  NQJSONWriter_writeKeyString(&writer, "error", message);
  if (kind != NULL)
    NQJSONWriter_writeKeyString(&writer, "kind", kind);
  NQJSONWriter_writeObjectEnd(&writer);
  NQJSONWriter_finalize(&writer);
  return status;
}

static int requestLookupInit(NQWebRequest* request, void* data)
{
  LookupContext* ctx = (LookupContext*)NQMalloc(sizeof(*ctx));
  if (ctx == NULL)
    return -NQ_ENOMEM;

  ctx->geoip = (struct WebGeoipExecutor*)data;
  NQByteBuffer_init(&ctx->body);
  request->userdata = ctx;
  return 0;
}

static size_t requestLookupReceive(NQWebRequest* request, const char* data, size_t size)
{
  LookupContext* ctx = (LookupContext*)request->userdata;
  (void)NQByteBuffer_append(&ctx->body, (const uint8_t*)data, size);
  return size;
}

/* Write a JSON string member, or null when the value is missing/empty. */
static void writeKeyStringOrNull(NQJSONWriter* writer, const char* key, const char* value)
{
  if (value == NULL || value[0] == '\0')
    NQJSONWriter_writeKeyNull(writer, key);
  else
    NQJSONWriter_writeKeyString(writer, key, value);
}

/* Human-readable name of the database the handle was opened from. */
static const char* databaseDescription(GeoIP* gi)
{
  unsigned char edition = GeoIP_database_edition(gi);
  const char* desc = (edition < NUM_DB_TYPES) ? GeoIPDBDescription[edition] : NULL;
  return desc != NULL ? desc : "unknown";
}

/* IANA time zone for a (country, region) pair, or null when unknown. */
static void writeTimeZone(NQJSONWriter* writer, const char* countryCode, const char* region)
{
  writeKeyStringOrNull(writer, "time_zone",
                       GeoIP_time_zone_by_country_and_region(countryCode, region));
}

/* First/last address of the netblock the lookup matched (IPv4 only - libGeoIP
 * has no v6 range helper). Emits nulls for IPv6 or when the range is unknown. */
static void writeNetworkRange(NQJSONWriter* writer, GeoIP* gi, const char* ip)
{
  char** range = NULL;
  if (strchr(ip, ':') == NULL) {
    GeoIPLookup gl;
    range = GeoIP_range_by_ip_gl(gi, ip, &gl);
  }

  if (range != NULL) {
    writeKeyStringOrNull(writer, "network_start", range[0]);
    writeKeyStringOrNull(writer, "network_end", range[1]);
    GeoIP_range_by_ip_delete(range);
  } else {
    NQJSONWriter_writeKeyNull(writer, "network_start");
    NQJSONWriter_writeKeyNull(writer, "network_end");
  }
}

/* Serialise a full City/Cityv6 record (matches GeoIpRecord in src/types.ts). */
static void writeCityRecord(NQJSONWriter* writer, const GeoIPRecord* r, GeoIP* gi, const char* ip)
{
  const char* regionName = GeoIP_region_name_by_code(r->country_code, r->region);

  NQJSONWriter_writeKeyObjectBegin(writer, "record");
  writeKeyStringOrNull(writer, "country_code", r->country_code);
  writeKeyStringOrNull(writer, "country_code3", r->country_code3);
  writeKeyStringOrNull(writer, "country_name", r->country_name);
  writeKeyStringOrNull(writer, "region", r->region);
  writeKeyStringOrNull(writer, "region_name", regionName);
  writeKeyStringOrNull(writer, "city", r->city);
  writeKeyStringOrNull(writer, "postal_code", r->postal_code);
  NQJSONWriter_writeKeyDouble(writer, "latitude", (double)r->latitude);
  NQJSONWriter_writeKeyDouble(writer, "longitude", (double)r->longitude);
  NQJSONWriter_writeKeyInt32(writer, "dma_code", r->dma_code);
  NQJSONWriter_writeKeyInt32(writer, "area_code", r->area_code);
  NQJSONWriter_writeKeyInt32(writer, "metro_code", r->metro_code); /* alias of dma_code */
  writeKeyStringOrNull(writer, "continent_code", r->continent_code);
  writeTimeZone(writer, r->country_code, r->region);
  NQJSONWriter_writeKeyInt32(writer, "netmask", r->netmask);
  writeNetworkRange(writer, gi, ip);
  NQJSONWriter_writeObjectEnd(writer);
}

/* Serialise a country-only match: country fields populated, the rest null. */
static void writeCountryRecord(NQJSONWriter* writer, int id, int netmask, GeoIP* gi, const char* ip)
{
  const char* countryCode = GeoIP_code_by_id(id);

  NQJSONWriter_writeKeyObjectBegin(writer, "record");
  writeKeyStringOrNull(writer, "country_code", countryCode);
  writeKeyStringOrNull(writer, "country_code3", GeoIP_code3_by_id(id));
  writeKeyStringOrNull(writer, "country_name", GeoIP_name_by_id(id));
  NQJSONWriter_writeKeyNull(writer, "region");
  NQJSONWriter_writeKeyNull(writer, "region_name");
  NQJSONWriter_writeKeyNull(writer, "city");
  NQJSONWriter_writeKeyNull(writer, "postal_code");
  NQJSONWriter_writeKeyNull(writer, "latitude");
  NQJSONWriter_writeKeyNull(writer, "longitude");
  NQJSONWriter_writeKeyNull(writer, "dma_code");
  NQJSONWriter_writeKeyNull(writer, "area_code");
  NQJSONWriter_writeKeyNull(writer, "metro_code");
  writeKeyStringOrNull(writer, "continent_code", GeoIP_continent_by_id(id));
  writeTimeZone(writer, countryCode, NULL); /* no region -> only single-zone countries resolve */
  if (netmask > 0)
    NQJSONWriter_writeKeyInt32(writer, "netmask", netmask);
  else
    NQJSONWriter_writeKeyNull(writer, "netmask");
  writeNetworkRange(writer, gi, ip);
  NQJSONWriter_writeObjectEnd(writer);
}

static void writeResponse(GeoIP* gi, const char* ip, GeoIPRecord* gir, int countryId, NQJSONWriter* writer)
{
  int countryNetmask = gi->netmask;
  bool found = (gir != NULL) || (countryId > 0);
  char* databaseBuild = GeoIP_database_info(gi); /* malloc'd - freed below */
  const char* libVersion = GeoIP_lib_version();
  char library[64];

  snprintf(library, sizeof(library), "GeoIP-%s", libVersion != NULL ? libVersion : "unknown");

  NQJSONWriter_writeObjectBegin(writer);
  NQJSONWriter_writeKeyString(writer, "ip", ip);
  NQJSONWriter_writeKeyBool(writer, "found", found);
  NQJSONWriter_writeKeyString(writer, "library", library);
  NQJSONWriter_writeKeyString(writer, "database", databaseDescription(gi));
  writeKeyStringOrNull(writer, "database_build", databaseBuild);

  if (gir != NULL)
    writeCityRecord(writer, gir, gi, ip);
  else if (countryId > 0)
    writeCountryRecord(writer, countryId, countryNetmask, gi, ip);
  else
    NQJSONWriter_writeKeyNull(writer, "record");

  NQJSONWriter_writeObjectEnd(writer);

  free(databaseBuild);
}

static int requestLookupHandler(NQWebRequest* request, NQWebResponse* response)
{
  LookupContext* ctx = (LookupContext*)request->userdata;

  NQWebResponse_setHeader(response, NQHTTP_HEADER_CONTENT_TYPE, NQ_MEDIATYPE_APPLICATION_JSON);

  if (NQByteBuffer_isEmpty(&ctx->body)) {
    NQ_LOGW(GEOIP_SERVICE_URL " called with an empty body");
    return writeError(response, NQ_HTTP_BAD_REQUEST, NULL, "Request body is empty");
  }

  NQJSON* json = NQJSON_parse2((const char*)NQByteBuffer_data(&ctx->body), NQByteBuffer_size(&ctx->body));
  if (json == NULL) {
    NQ_LOGW(GEOIP_SERVICE_URL " received a malformed JSON body");
    return writeError(response, NQ_HTTP_BAD_REQUEST, NULL, "Request body is not valid JSON");
  }

  const char* ip = NULL;
  if (!NQJSON_isObject(json) || !NQJSON_objectGetString(json, "ip", &ip) || ip == NULL || ip[0] == '\0') {
    NQJSON_release(json);
    return writeError(response, NQ_HTTP_BAD_REQUEST, NULL, "Missing required string field: ip");
  }

  NQJSONWriter writer;
  NQJSONWriter_init(&writer, &responseJsonWrite, response);

  GeoIPRecord* gir = NULL;
  if (strchr(ip, ':') == NULL) {
#ifdef GEOIP_CITYV4_DAT
    NQMutex_lock(&s_mutex4);
    gir = GeoIP_record_by_addr(s_geoipv4, ip);
    int countryId = (gir == NULL) ? GeoIP_id_by_addr(s_geoipv4, ip) : 0;
    writeResponse(s_geoipv4, ip, gir, countryId, &writer);
    NQMutex_unlock(&s_mutex4);
#else
    NQ_LOGE(GEOIP_SERVICE_URL ": GeoIP V4 database is not open");
    NQJSONWriter_finalize(&writer);
    NQJSON_release(json);
    return writeError(response, NQ_HTTP_SERVICE_UNAVAILABLE, NULL, "GeoIP V4 database is unavailable");
#endif
  }
  else {
#ifdef GEOIP_CITYV6_DAT
    NQMutex_lock(&s_mutex6);
    gir = GeoIP_record_by_addr_v6(s_geoipv6, ip);
    int countryId = (gir == NULL) ? GeoIP_id_by_addr_v6(s_geoipv6, ip) : 0;
    writeResponse(s_geoipv6, ip, gir, countryId, &writer);
    NQMutex_unlock(&s_mutex6);
#else
    NQ_LOGE(GEOIP_SERVICE_URL ": GeoIP V6 database is not open");
    NQJSONWriter_finalize(&writer);
    NQJSON_release(json);
    return writeError(response, NQ_HTTP_SERVICE_UNAVAILABLE, NULL, "GeoIP V6 database is unavailable");
#endif
  }

  if (gir != NULL)
    GeoIPRecord_delete(gir);

  if (writer.hasError) {
    NQ_LOGE("failed to serialise " GEOIP_SERVICE_URL " response JSON");
    NQJSONWriter_finalize(&writer);
    NQJSON_release(json);
    return NQ_HTTP_INTERNAL_SERVER_ERROR;
  }

  NQJSONWriter_finalize(&writer);
  NQJSON_release(json);
  return NQ_HTTP_OK;
}

static void requestLookupRelease(NQWebRequest* request)
{
  LookupContext* ctx = (LookupContext*)request->userdata;
  if (ctx == NULL)
    return;
  NQByteBuffer_finalize(&ctx->body);
  NQFree(ctx);
  request->userdata = NULL;
}

static const NQWebRequestOperations kLookupOps = {
  .init = requestLookupInit,
  .receive = requestLookupReceive,
  .handler = requestLookupHandler,
  .release = requestLookupRelease,
};

static int executorInit(NQWebExecutor* executor, void* data)
{
  NQ_UNUSED_PARAM(data);

  struct WebGeoipExecutor* geoip = (struct WebGeoipExecutor*)executor;

  NQLibraryInfo info;
  int ret = NQLibraryInfoLoad(&info, &executorInit);
  if (ret != 0) {
    return ret;
  }
  NQPath* manifest = NQPath_join3(info.filename, "../../" GEOIP_ASSETS_DIR, NQ_WEBMANIFEST_FILE);
  NQLibraryInfoFinalize(&info);
  if (manifest == NULL) {
    return -NQ_ENOMEM;
  }

  ret = NQWebManifestListenersInit(executor, &geoip->manifestListeners, NQPath_characters(manifest));
  NQPath_destroy(manifest);
  if (ret != 0) {
    return ret;
  }

  ret = NQWebExecutor_addRequestListener(&geoip->executor, &geoip->lookupListener, &kLookupOps, geoip, NQ_HTTP_POST, GEOIP_SERVICE_URL);
  if (ret != 0) {
    NQWebManifestListenersFinalize(&geoip->executor, &geoip->manifestListeners);
    return ret;
  }

  return ret;
}

static void executorRelease(NQWebExecutor* executor)
{
  struct WebGeoipExecutor* geoip = (struct WebGeoipExecutor*)executor;
  NQWebExecutor_removeRequestListener(&geoip->executor, &geoip->lookupListener);
  NQWebManifestListenersFinalize(&geoip->executor, &geoip->manifestListeners);
}

static struct NQWebExecutorOperations s_executorOps = {
  .name = "geoip",
  .init = executorInit,
  .release = executorRelease,
  .size = sizeof(struct WebGeoipExecutor),
};

static int moduleInit(NQContext* context)
{
  NQLibraryInfo info;
  int ret = NQLibraryInfoLoad(&info, &executorInit);
  if (ret != 0) {
    return ret;
  }

#ifdef GEOIP_CITYV4_DAT
  NQPath* gefilev4 = NQPath_join3(info.filename, "../../" GEOIP_ASSETS_DIR, GEOIP_CITYV4_DAT);
  if (gefilev4 == NULL) {
    NQ_LOGE("Failed to open GeoIP database - " GEOIP_CITYV4_DAT);
    NQLibraryInfoFinalize(&info);
    return -NQ_ENOMEM;
  }
  s_geoipv4 = GeoIP_open(NQPath_characters(gefilev4), GEOIP_MEMORY_CACHE | GEOIP_CHECK_CACHE);
  NQPath_destroy(gefilev4);
  if (s_geoipv4 == NULL) {
    NQ_LOGE("Failed to open GeoIP database - " GEOIP_CITYV4_DAT);
    NQLibraryInfoFinalize(&info);
    return -NQ_ENOMEM;
  }
  GeoIP_set_charset(s_geoipv4, GEOIP_CHARSET_UTF8);
#endif

#ifdef GEOIP_CITYV6_DAT
  NQPath* gefilev6 = NQPath_join3(info.filename, "../../" GEOIP_ASSETS_DIR, GEOIP_CITYV6_DAT);
  if (gefilev6 == NULL) {
    NQ_LOGE("Failed to open GeoIP database - " GEOIP_CITYV6_DAT);
    NQLibraryInfoFinalize(&info);
    return -NQ_ENOMEM;
  }
  s_geoipv6 = GeoIP_open(NQPath_characters(gefilev6), GEOIP_MEMORY_CACHE | GEOIP_CHECK_CACHE);
  NQPath_destroy(gefilev6);
  if (s_geoipv6 == NULL) {
    NQ_LOGE("Failed to open GeoIP database - " GEOIP_CITYV6_DAT);
    NQLibraryInfoFinalize(&info);
    return -NQ_ENOMEM;
  }
  GeoIP_set_charset(s_geoipv6, GEOIP_CHARSET_UTF8);
#endif

  NQLibraryInfoFinalize(&info);
  return NQWebExecutorRegister(&s_executorOps);
}

static void moduleExit(NQContext* context)
{
  NQWebExecutorUnregister(&s_executorOps);

#ifdef GEOIP_CITYV4_DAT
  if (s_geoipv4 != NULL)
    GeoIP_delete(s_geoipv4);
#endif

#ifdef GEOIP_CITYV6_DAT
  if (s_geoipv6 != NULL)
    GeoIP_delete(s_geoipv6);
#endif

  GeoIP_cleanup();
}

NQ_MODULE_INIT(moduleInit);
NQ_MODULE_EXIT(moduleExit);

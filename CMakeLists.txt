cmake_minimum_required(VERSION 3.19)
project(geoip-wla VERSION 1.0.0 LANGUAGES C)

include(GNUInstallDirs)

find_program(NPM_EXECUTABLE npm REQUIRED)
mark_as_advanced(NPM_EXECUTABLE)

if (WIN32)
  set(NPM_PREFIX "cmd" "/c")
endif ()

find_package(LibNetQ REQUIRED)
find_package(GeoIP REQUIRED)

option(GEOIP_INSTALL_SERVER "Install the geoip server" ON)
option(GEOIP_INSTALL_MODULE "Install the geoip module" ON)
option(GEOIP_INSTALL_ASSETS "Install geoip supporting assets" ON)
option(GEOIP_INSTALL_DATABASES "Install the geoip databases" ON)

set(GEOIP_BASE_URL "/" CACHE STRING "URL path prefix the geoip module is served under (a trailing slash is appended if missing)")
set(GEOIP_ROOT_URL "${GEOIP_BASE_URL}")
if(NOT GEOIP_ROOT_URL MATCHES "/$")
  set(GEOIP_ROOT_URL "${GEOIP_ROOT_URL}/")
endif()

set(GEOIP_SERVICE_URL "${GEOIP_ROOT_URL}lookup")
set(GEOIP_ASSETS_DIR "${CMAKE_INSTALL_DATADIR}/${PROJECT_NAME}")

set(GEOIP_CITYV4_DAT "GeoIPCity.dat")
set(GEOIP_CITYV6_DAT "GeoIPCityv6.dat")

set(GEOIP_DATAFILES
  config.h.in
  )

file(GLOB_RECURSE GEOIP_TSXFILES
  "src/*.ts"
  "src/*.tsx"
  )

set(GEOIP_DISTFILES
  dist/index.html
  dist/manifest.json
  )

add_custom_command(
  COMMAND ${NPM_PREFIX} "${NPM_EXECUTABLE}" install
  COMMAND ${NPM_PREFIX} "${NPM_EXECUTABLE}" run build --base-url=${GEOIP_BASE_URL}
  DEPENDS package.json ${GEOIP_TSXFILES}
  OUTPUT ${GEOIP_DISTFILES}
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  )

configure_file(config.h.in "${CMAKE_CURRENT_BINARY_DIR}/config.h" @ONLY)

source_group(TREE "${CMAKE_CURRENT_SOURCE_DIR}" FILES module.c ${GEOIP_DATAFILES} ${GEOIP_DISTFILES})
add_library(geoip_wla SHARED module.c ${GEOIP_DATAFILES} ${GEOIP_DISTFILES})
target_include_directories(geoip_wla PRIVATE "$<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}>")
target_link_libraries(geoip_wla PUBLIC LibNetQ::LibNetQ GeoIP::GeoIP)
set_property(TARGET geoip_wla PROPERTY POSITION_INDEPENDENT_CODE ON)
set_target_properties(geoip_wla PROPERTIES PREFIX "" IMPORT_PREFIX "")

source_group(TREE "${CMAKE_CURRENT_SOURCE_DIR}" FILES server.c)
add_executable(geoip_server server.c)
target_link_libraries(geoip_server PRIVATE LibNetQ::LibNetQ)

if (APPLE)
  set_target_properties(geoip_server PROPERTIES INSTALL_RPATH "@loader_path/../lib")
elseif (UNIX)
  set_target_properties(geoip_server PROPERTIES INSTALL_RPATH "$ORIGIN/../lib")
  target_link_options(geoip_server PRIVATE -Wl,--disable-new-dtags)
endif ()

if (GEOIP_INSTALL_DATABASES AND GEOIP_CITYV4_DAT)
  find_program(GUNZIP_EXECUTABLE gunzip REQUIRED)
  set(GEOIP_BINARY_DATADIR "${CMAKE_CURRENT_BINARY_DIR}/${GEOIP_ASSETS_DIR}")
  file(MAKE_DIRECTORY "${GEOIP_BINARY_DATADIR}")
  if (NOT EXISTS "${GEOIP_BINARY_DATADIR}/${GEOIP_CITYV4_DAT}")
    message(STATUS "Downloading ${GEOIP_CITYV4_DAT}.gz...")
    file(DOWNLOAD "https://mailfud.org/geoip-legacy/${GEOIP_CITYV4_DAT}.gz"
      "${GEOIP_BINARY_DATADIR}/${GEOIP_CITYV4_DAT}.gz" SHOW_PROGRESS STATUS DOWNLOAD_STATUS)
    list(GET DOWNLOAD_STATUS 0 STATUS_CODE)
    if(NOT STATUS_CODE EQUAL 0)
      message(FATAL_ERROR "Failed to download ${GEOIP_CITYV4_DAT}.gz")
    endif()
    message(STATUS "Extracting ${GEOIP_CITYV4_DAT}.gz...")
    execute_process(COMMAND "${GUNZIP_EXECUTABLE}" -f "${GEOIP_BINARY_DATADIR}/${GEOIP_CITYV4_DAT}.gz"
      WORKING_DIRECTORY "${GEOIP_BINARY_DATADIR}" COMMAND_ERROR_IS_FATAL ANY)
  endif ()
  install(FILES "${GEOIP_BINARY_DATADIR}/${GEOIP_CITYV4_DAT}" DESTINATION "${GEOIP_ASSETS_DIR}")
endif ()

if (GEOIP_INSTALL_DATABASES AND GEOIP_CITYV6_DAT)
  find_program(GUNZIP_EXECUTABLE gunzip REQUIRED)
  set(GEOIP_BINARY_DATADIR "${CMAKE_CURRENT_BINARY_DIR}/${GEOIP_ASSETS_DIR}")
  file(MAKE_DIRECTORY "${GEOIP_BINARY_DATADIR}")
  if (NOT EXISTS "${GEOIP_BINARY_DATADIR}/${GEOIP_CITYV6_DAT}")
    message(STATUS "Downloading ${GEOIP_CITYV6_DAT}.gz...")
    file(DOWNLOAD "https://mailfud.org/geoip-legacy/${GEOIP_CITYV6_DAT}.gz"
      "${GEOIP_BINARY_DATADIR}/${GEOIP_CITYV6_DAT}.gz" SHOW_PROGRESS STATUS DOWNLOAD_STATUS)
    list(GET DOWNLOAD_STATUS 0 STATUS_CODE)
    if(NOT STATUS_CODE EQUAL 0)
      message(FATAL_ERROR "Failed to download ${GEOIP_CITYV6_DAT}.gz")
    endif()
    message(STATUS "Extracting ${GEOIP_CITYV6_DAT}.gz...")
    execute_process(COMMAND "${GUNZIP_EXECUTABLE}" -f "${GEOIP_BINARY_DATADIR}/${GEOIP_CITYV6_DAT}.gz"
      WORKING_DIRECTORY "${GEOIP_BINARY_DATADIR}" COMMAND_ERROR_IS_FATAL ANY)
  endif ()
  install(FILES "${GEOIP_BINARY_DATADIR}/${GEOIP_CITYV6_DAT}" DESTINATION "${GEOIP_ASSETS_DIR}")
endif ()

if (GEOIP_INSTALL_SERVER)
  install(TARGETS geoip_server
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    )
endif ()

if (GEOIP_INSTALL_MODULE)
  install(TARGETS geoip_wla
    LIBRARY DESTINATION ${CMAKE_INSTALL_BINDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    )
endif ()

if (GEOIP_INSTALL_ASSETS)
  install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/dist/"
    DESTINATION "${GEOIP_ASSETS_DIR}"
    )
endif ()

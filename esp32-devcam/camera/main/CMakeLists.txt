idf_component_register(
                    SRCS "camera.cpp" "fomo_detector.cpp" "camera_cloud.cpp"
                    "../../../src/NotificationPairingProtocol.cpp" "../../../src/NotificationHttpParser.cpp"
                    "../../../src/NotificationTransportResult.cpp" "../../../src/NotificationUtcClock.cpp"
                    INCLUDE_DIRS "." "../../../include" "../../../.pio/libdeps/esp32dev/ArduinoJson/src"
                    REQUIRES json mbedtls esp_http_client esp-tls esp_wifi esp_http_server esp_timer nvs_flash esp_driver_gpio lwip
                    PRIV_INCLUDE_DIRS "$ENV{IDF_PATH}/components/esp-tls/private_include"
                    PRIV_REQUIRES fomo
                    EMBED_FILES "index.html")
# SDK headers use legacy printf formats for 32-bit typedefs on this toolchain.
# Scope compatibility options to the SDK adapter, not the camera application.
set_source_files_properties("fomo_detector.cpp" PROPERTIES
    COMPILE_OPTIONS "-std=gnu++17;-Wno-error=format")

# Empty retains the existing unassigned camera. Provisioned ID must match this role.
set(HATCHAI_CAMERA_POSITION "" CACHE STRING "Physical camera position: upper or lower")
if(HATCHAI_CAMERA_POSITION STREQUAL "upper")
 target_compile_definitions(${COMPONENT_LIB} PRIVATE HATCHAI_CAMERA_UPPER)
elseif(HATCHAI_CAMERA_POSITION STREQUAL "lower")
 target_compile_definitions(${COMPONENT_LIB} PRIVATE HATCHAI_CAMERA_LOWER)
elseif(NOT HATCHAI_CAMERA_POSITION STREQUAL "")
 message(FATAL_ERROR "Camera position must be upper or lower")
endif()

# The shared legacy signer uses compact statements; retain its style warning.
set_source_files_properties("../../../src/NotificationPairingProtocol.cpp" "../../../src/NotificationHttpParser.cpp" "../../../src/NotificationTransportResult.cpp" "../../../src/NotificationUtcClock.cpp" PROPERTIES COMPILE_OPTIONS "-Wno-error=misleading-indentation")

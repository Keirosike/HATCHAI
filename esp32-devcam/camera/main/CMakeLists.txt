idf_component_register(
                    SRCS "camera.cpp" "fomo_detector.cpp"
                    INCLUDE_DIRS "."
                    REQUIRES esp_http_client esp-tls esp_wifi esp_http_server esp_timer nvs_flash esp_driver_gpio lwip
                    PRIV_REQUIRES fomo
                    EMBED_FILES "index.html")
# SDK headers use legacy printf formats for 32-bit typedefs on this toolchain.
# Scope compatibility options to the SDK adapter, not the camera application.
set_source_files_properties("fomo_detector.cpp" PROPERTIES
    COMPILE_OPTIONS "-std=gnu++17;-Wno-error=format")

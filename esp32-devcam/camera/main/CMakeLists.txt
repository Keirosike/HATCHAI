idf_component_register(
 SRCS "camera.cpp" "camera_local.cpp" "mobilenet_detector.cpp"
 INCLUDE_DIRS "." "../../../include"
 REQUIRES json esp_http_client esp_wifi esp_http_server esp_timer nvs_flash esp_driver_gpio lwip esp-dl esp-tflite-micro
 EMBED_FILES "index.html" "../../model/mobilenetv2_full_int8.tflite")
set_source_files_properties("mobilenet_detector.cpp" PROPERTIES COMPILE_OPTIONS "-std=gnu++17")
# Both physical cameras use this exact target and binary. Placement is MAC/NVS state.
file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/../../model/mobilenetv2_full_int8.tflite" MODEL_SHA256)
if(NOT MODEL_SHA256 STREQUAL "4566b60fb3b81b1a15536a287ca5743e9696a2e1925b3d8db2abc66ad3ce697d")
 message(FATAL_ERROR "Camera model differs from reviewed INT8 contract")
endif()

# Emit stack reports without changing optimization or runtime behavior.
target_compile_options(${COMPONENT_LIB} PRIVATE -fstack-usage)

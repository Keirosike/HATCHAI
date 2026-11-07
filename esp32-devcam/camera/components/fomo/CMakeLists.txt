# Build the unmodified Edge Impulse export as an ESP-IDF component.
get_filename_component(EI_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../../edge-impulse-model" ABSOLUTE)
set(EI_SDK "${EI_ROOT}/edge-impulse-sdk")
file(GLOB_RECURSE EI_SOURCES
    "${EI_SDK}/*.cpp" "${EI_SDK}/*.cc" "${EI_SDK}/*.c")
list(FILTER EI_SOURCES EXCLUDE REGEX "/(CMSIS|porting)/")
file(GLOB EI_MODEL_SOURCES "${EI_ROOT}/tflite-model/*.cpp")
idf_component_register(
    SRCS ${EI_SOURCES} ${EI_MODEL_SOURCES} "ei_port.cpp"
    INCLUDE_DIRS "${EI_ROOT}" "${EI_SDK}" "${EI_ROOT}/tflite-model"
    REQUIRES esp_timer ESP-NN)
target_compile_definitions(${COMPONENT_LIB} PUBLIC
    EI_PORTING_ESPRESSIF=1
    EI_CLASSIFIER_TFLITE_ENABLE_ESP_NN=1
    EI_CLASSIFIER_TFLITE_ENABLE_ESP_NN_S3=1
    EIDSP_USE_ESP_DSP=0 SILENCE_EI_CLASSFIER_OBJECT_DETECTION_COUNT_WARNING=1)
target_compile_options(${COMPONENT_LIB} PRIVATE -O3 -Wno-error
    -Wno-error=maybe-uninitialized -Wno-error=uninitialized
    "$<$<COMPILE_LANGUAGE:CXX>:-std=gnu++17>" -include sdkconfig.h)

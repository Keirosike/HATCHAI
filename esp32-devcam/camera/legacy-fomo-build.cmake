# The following five lines of boilerplate have to be in your project's
# CMakeLists in this exact order for cmake to work correctly
cmake_minimum_required(VERSION 3.16)
set(EXTRA_COMPONENT_DIRS "${CMAKE_CURRENT_LIST_DIR}/../edge-impulse-model/edge-impulse-sdk/porting/espressif/ESP-NN")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(camera)

# The bundled ESP-NN kernels include Edge Impulse's configuration header.
idf_component_get_property(FOMO_ESP_NN_LIB ESP-NN COMPONENT_LIB)
target_include_directories(${FOMO_ESP_NN_LIB} PRIVATE "${CMAKE_CURRENT_LIST_DIR}/../edge-impulse-model")
target_compile_options(${FOMO_ESP_NN_LIB} PRIVATE -include sdkconfig.h)
target_compile_definitions(${FOMO_ESP_NN_LIB} PRIVATE
    EI_CLASSIFIER_TFLITE_ENABLE_ESP_NN=1 EI_CLASSIFIER_TFLITE_ENABLE_ESP_NN_S3=1)

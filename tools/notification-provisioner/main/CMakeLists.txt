idf_component_register(SRCS "main.cpp" "idf_store.cpp" "provision_core.cpp" "codec_support.cpp"
  "../../../src/NotificationCredentialStore.cpp"
  INCLUDE_DIRS "." "../../../include"
  REQUIRES nvs_flash esp_partition spi_flash esp_timer mbedtls esp_hw_support bootloader_support)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_14)
target_link_options(${COMPONENT_LIB} INTERFACE
 "-Wl,--wrap=esp_flash_init_main" "-Wl,--wrap=esp_flash_write"
 "-Wl,--wrap=esp_flash_write_encrypted" "-Wl,--wrap=esp_flash_erase_region"
 "-Wl,--wrap=esp_flash_erase_chip")
target_link_options(${COMPONENT_LIB} INTERFACE "-Wl,--wrap=esp_partition_write"
 "-Wl,--wrap=esp_partition_write_raw" "-Wl,--wrap=esp_partition_erase_range")

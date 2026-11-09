idf_component_register(SRCS "main.cpp" "../../notification-provisioner/main/idf_store.cpp"
 "../../notification-provisioner/main/codec_support.cpp" "../../../src/NotificationCredentialStore.cpp"
 INCLUDE_DIRS "." "../../notification-provisioner/main" "../../../include"
 REQUIRES nvs_flash spi_flash esp_hw_support bootloader_support esp_timer mbedtls)
target_link_options(${COMPONENT_LIB} INTERFACE "-Wl,--wrap=esp_flash_init_main"
 "-Wl,--wrap=esp_flash_write" "-Wl,--wrap=esp_flash_write_encrypted"
 "-Wl,--wrap=esp_flash_erase_region" "-Wl,--wrap=esp_flash_erase_chip"
 "-Wl,--wrap=esp_partition_write" "-Wl,--wrap=esp_partition_write_raw"
 "-Wl,--wrap=esp_partition_erase_range")

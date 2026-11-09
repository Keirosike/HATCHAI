idf_component_register(SRCS "main.cpp" INCLUDE_DIRS "." REQUIRES spi_flash esp_hw_support bootloader_support)
# Deny persistent data writes even if an SDK recovery path is added later.
target_link_options(${COMPONENT_LIB} INTERFACE
  "-Wl,--wrap=esp_flash_init_main"
  "-Wl,--wrap=esp_flash_write" "-Wl,--wrap=esp_flash_write_encrypted"
  "-Wl,--wrap=esp_flash_erase_region" "-Wl,--wrap=esp_flash_erase_chip")

# Strict camera build cleanup

Only individually verified generated files were restored. No source/configuration inputs, camera.bin, camera.elf, backups or unrelated files were changed. Hashes were rechecked immediately before each write.

- RESTORED/UNCHANGED: esp32-devcam/camera/build/.ninja_deps — Ninja dependency cache
- PRESERVED (uncertain): esp32-devcam/camera/build/.ninja_log — Ninja execution log
- PRESERVED (uncertain): esp32-devcam/camera/build/CMakeFiles/CMakeConfigureLog.yaml — CMake appended log; prior content exact prefix
- RESTORED/UNCHANGED: esp32-devcam/camera/build/CMakeFiles/git-data/HEAD — CMake generated Git version snapshot
- RESTORED/UNCHANGED: esp32-devcam/camera/build/CMakeFiles/git-data/head-ref — CMake generated Git version snapshot
- PRESERVED (uncertain): esp32-devcam/camera/build/bootloader/.ninja_log — Ninja execution log
- RESTORED/UNCHANGED: esp32-devcam/camera/build/bootloader/CMakeFiles/git-data/HEAD — CMake generated Git version snapshot
- RESTORED/UNCHANGED: esp32-devcam/camera/build/bootloader/CMakeFiles/git-data/head-ref — CMake generated Git version snapshot
- RESTORED/UNCHANGED: esp32-devcam/camera/build/bootloader/build.ninja — CMake-generated build configuration
- PRESERVED (uncertain): esp32-devcam/camera/build/bootloader/gdbinit/symbols — ESP-IDF generated GDB symbol-loader
- RESTORED/UNCHANGED: esp32-devcam/camera/build/build.ninja — CMake-generated build configuration
- RESTORED/UNCHANGED: esp32-devcam/camera/build/compile_commands.json — CMake command export
- RESTORED/UNCHANGED: esp32-devcam/camera/build/esp-idf/esp_app_format/CMakeFiles/__idf_esp_app_format.dir/esp_app_desc.c.obj — generated ELF object
- RESTORED/UNCHANGED: esp32-devcam/camera/build/esp-idf/esp_app_format/libesp_app_format.a — generated archive
- RESTORED/UNCHANGED: esp32-devcam/camera/build/esp-idf/esp_bootloader_format/CMakeFiles/__idf_esp_bootloader_format.dir/esp_bootloader_desc.c.obj — generated ELF object
- RESTORED/UNCHANGED: esp32-devcam/camera/build/esp-idf/esp_bootloader_format/libesp_bootloader_format.a — generated archive
- RESTORED/UNCHANGED: esp32-devcam/camera/build/esp-idf/main/CMakeFiles/__idf_main.dir/camera.cpp.obj — generated ELF object
- PRESERVED (uncertain): esp32-devcam/camera/build/gdbinit/symbols — ESP-IDF generated GDB symbol-loader
- RESTORED/UNCHANGED: esp32-devcam/camera/build/index.html.S — generated assembly matches source HTML exactly
- RESTORED/UNCHANGED: esp32-devcam/camera/build/project_description.json — ESP-IDF generated description

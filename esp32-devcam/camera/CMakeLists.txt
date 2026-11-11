cmake_minimum_required(VERSION 3.16)
# Build only main and its declared dependencies; retired FOMO sources are retained.
set(COMPONENTS main)
set(EXCLUDE_COMPONENTS fomo)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(camera)

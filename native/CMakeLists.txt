cmake_minimum_required(VERSION 3.20)
project(TelecasttNative VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# DXGI Desktop Duplication Capture
add_library(telecastt_capture SHARED
  src/framebuffer-capture.cpp
  src/edid-spoofer.cpp
  src/input-injector.cpp
  src/power-hooks.cpp
)

target_link_libraries(telecastt_capture PRIVATE
  dxgi d3d11 user32 advapi32 powrprof
)
